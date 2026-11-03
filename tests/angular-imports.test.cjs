const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const ts = require('typescript');

const {addAngularLibraries, angularLibraries, importsBeforeCompletion, withPublicImports} = require('../plugin/angular-imports.js');

function workspace() {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'angular-tools-')));
  const write = (file, content) => {
    fs.mkdirSync(path.dirname(path.join(root, file)), {recursive: true});
    fs.writeFileSync(path.join(root, file), content);
  };
  const dependencies = {'@angular/core': '1', '@angular/common': '1', 'plain-tool': '1', '@angular/cli': '1'};
  write('package.json', JSON.stringify({dependencies}));
  const peerDependencies = {'@angular/core': '1'};
  const library = {peerDependencies, exports: {'.': {types: './types/common.d.ts'}}};
  write('node_modules/@angular/core/package.json', JSON.stringify({types: './core.d.ts'}));
  write('node_modules/@angular/core/core.d.ts', '');
  write('node_modules/@angular/common/package.json', JSON.stringify(library));
  write('node_modules/@angular/common/types/common.d.ts', 'export { NgClass } from "./chunk";\n');
  write('node_modules/plain-tool/package.json', JSON.stringify({types: './tool.d.ts'}));
  write('node_modules/plain-tool/tool.d.ts', '');
  write('node_modules/@angular/cli/package.json', JSON.stringify({peerDependencies}));
  fs.mkdirSync(path.join(root, 'libs/ui'), {recursive: true});
  return root;
}

const common = root => path.join(root, 'node_modules/@angular/common/types/common.d.ts').replaceAll(path.sep, '/');

test('a library folder finds the Angular libraries of the workspace, and nothing else', () => {
  const root = workspace();
  assert.deepEqual(angularLibraries(path.join(root, 'libs/ui')), [common(root)]);
});

test('the libraries join the program once there are files in it', () => {
  const root = workspace();
  let names = [];
  const project = {getScriptFileNames: () => names, getCurrentDirectory: () => root};
  addAngularLibraries(project);
  assert.deepEqual(project.getScriptFileNames(), []);
  names = ['/a.ts'];
  assert.deepEqual(project.getScriptFileNames(), ['/a.ts', common(root)]);
  names = ['/a.ts', common(root)];
  assert.deepEqual(project.getScriptFileNames(), names);
});

test('an import from a chunk of a package names the package, if it exports the name', () => {
  const root = workspace();
  const edit = names => ({newText: `\nimport { ${names} } from '../../node_modules/@angular/common/types/_chunk';`});
  assert.deepEqual(withPublicImports([edit('NgClass')], [root]), [{newText: "\nimport { NgClass } from '@angular/common';"}]);
  assert.deepEqual(withPublicImports([edit('Hidden')], [root]), [edit('Hidden')]);
  const local = {newText: "import { NgClass } from './local';"};
  assert.deepEqual(withPublicImports([local], [root]), [local]);
});

test('a new imports array moves off the line of the completion in an inline template', () => {
  const action = (fileName, changes) => [{description: '', changes: [{fileName, textChanges: changes}]}];
  const header = {span: {start: 0, length: 0}, newText: "import { NgClass } from '@angular/common';\n"};
  const moved = (text, position) => {
    const sourceFile = ts.createSourceFile('/a.ts', text, ts.ScriptTarget.Latest, true);
    const imports = {span: {start: text.indexOf('`', text.indexOf('<p')) + 1, length: 0}, newText: ',\n  imports: [NgClass]'};
    const [result] = importsBeforeCompletion(ts, sourceFile, position ?? text.indexOf('ngc') + 3, action('/a.ts', [header, imports]));
    return result.changes[0].textChanges;
  };

  const trailing = "@Component({\n  selector: 'r',\n  template: `<p [ngc`,\n})\nclass A {}\n";
  assert.deepStrictEqual(moved(trailing), [
    header,
    {span: {start: trailing.indexOf('})'), length: 0}, newText: '  imports: [NgClass],\n'},
  ]);
  const last = "@Component({\n  selector: 'r',\n  template: `<p [ngc`\n})\nclass A {}\n";
  assert.deepStrictEqual(moved(last)[1], {span: {start: last.indexOf('{') + 1, length: 0}, newText: '\n  imports: [NgClass],'});
  assert.strictEqual(moved(trailing, 0)[1].newText, ',\n  imports: [NgClass]');
});
