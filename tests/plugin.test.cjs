const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const ts = require('typescript');
const init = require('../plugin/index.js');

function create({program, projectKind, currentDirectory = '/', service: methods = {}}) {
  const log = [];
  const service = {
    getProgram: program,
    getRenameInfo: () => 'renamed by the language service',
    findRenameLocations: () => 'located by the language service',
    ...methods,
  };
  const info = {
    languageService: service,
    languageServiceHost: {readFile: fileName => fs.readFileSync(fileName, 'utf8')},
    project: {projectKind, getCurrentDirectory: () => currentDirectory, projectService: {logger: {info: message => log.push(message)}}},
  };
  return {plugin: init({typescript: ts}).create(info), log};
}

test('a failing selector lookup leaves the request to the language service', () => {
  const {plugin, log} = create({
    program: () => {
      throw new Error('broken program');
    },
    projectKind: ts.server.ProjectKind.Configured,
  });
  assert.equal(plugin.getRenameInfo('/app/x.ts', 0), 'renamed by the language service');
  assert.equal(plugin.findRenameLocations('/app/x.ts', 0), 'located by the language service');
  assert.match(log[0], /broken program/);
});

test('a project without tsconfig searches no HTML files', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'angular-tools-'));
  try {
    // tsserver names files with forward slashes on every platform.
    const component = path.join(dir, 'x.ts').replaceAll(path.sep, '/');
    const source = "@Component({ selector: 'app-x', template: '' })\nexport class X {}\n";
    fs.writeFileSync(component, source);
    fs.writeFileSync(path.join(dir, 'page.html'), '<app-x></app-x>\n');
    const sourceFile = ts.createSourceFile(component, source, ts.ScriptTarget.Latest, true);
    const program = () => ({getSourceFiles: () => [sourceFile]});
    const position = source.indexOf('app-x') + 1;
    const files = kind =>
      create({program, projectKind: kind, currentDirectory: dir})
        .plugin.findRenameLocations(component, position)
        .map(({fileName}) => path.basename(fileName));
    assert.deepEqual(files(ts.server.ProjectKind.Configured), ['x.ts', 'page.html', 'page.html']);
    assert.deepEqual(files(ts.server.ProjectKind.Inferred), ['x.ts']);
  } finally {
    fs.rmSync(dir, {recursive: true, force: true});
  }
});

test('find references leads to templates instead of generated type-check files', () => {
  const source = 'export class Home {\n  items = [];\n}\n';
  const sourceFile = ts.createSourceFile('/app/home.ts', source, ts.ScriptTarget.Latest, true);
  const position = source.indexOf('items');
  const declaration = {fileName: '/app/home.ts', textSpan: {start: position, length: 5}, isWriteAccess: true};
  const {plugin} = create({
    program: () => ({getSourceFiles: () => [sourceFile]}),
    projectKind: ts.server.ProjectKind.Inferred,
    service: {
      findReferences: () => [
        {
          definition: {fileName: '/app/home.ts', textSpan: declaration.textSpan},
          references: [declaration, {fileName: '/app/home.ngtypecheck.ts', textSpan: {start: 300, length: 5}, isWriteAccess: false}],
        },
      ],
      getReferencesAtPosition: () => [declaration, {fileName: '/app/home.html', textSpan: {start: 14, length: 5}, isWriteAccess: false}],
    },
  });
  const [symbol] = plugin.findReferences('/app/home.ts', position);
  assert.deepEqual(
    symbol.references.map(({fileName, textSpan}) => [fileName, textSpan.start]),
    [
      ['/app/home.ts', position],
      ['/app/home.html', 14],
    ],
  );
});

test('Angular bindings complete as snippets, take in an unclosed bracket and keep it', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'angular-tools-'));
  try {
    const fileName = path.join(dir, 'a.html').replace(/\\/g, '/');
    fs.writeFileSync(fileName, '<p [ngc');
    let received;
    const entries = [
      {name: '[ngClass]', isSnippet: true, insertText: '[ngClass]="$1"'},
      {name: 'ngClass', isSnippet: true, insertText: 'ngClass="$1"', replacementSpan: {start: 4, length: 3}},
      {name: 'title', insertText: 'title'},
    ];
    const getCompletionsAtPosition = (_fileName, _position, options) => {
      received = options;
      return {entries};
    };
    const {plugin} = create({projectKind: ts.server.ProjectKind.Inferred, service: {getCompletionsAtPosition}});
    const result = plugin.getCompletionsAtPosition(fileName, 7, {includeInsertTextCompletions: true});
    assert.equal(received.includeCompletionsWithInsertText, true);
    assert.deepStrictEqual(
      result.entries.map(entry => [entry.name, entry.replacementSpan]),
      [['[ngClass]', {start: 3, length: 4}], ['title', undefined]],
    );
    fs.writeFileSync(fileName, '<p ngc');
    const plain = plugin.getCompletionsAtPosition(fileName, 6, {includeInsertTextCompletions: true});
    assert.deepStrictEqual(plain.entries.map(entry => entry.name), ['[ngClass]', 'ngClass', 'title']);
  } finally {
    fs.rmSync(dir, {recursive: true, force: true});
  }
});
