const assert = require('node:assert');
const {execFileSync} = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const {inspect} = require('../plugin/project.js');

function workspace(files) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'angular-tools-'));
  for (const [file, content] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(root, file)), {recursive: true});
    fs.writeFileSync(path.join(root, file), content);
  }
  return root;
}

const manifest = dependencies => JSON.stringify({dependencies});

test('finds Angular and Tailwind in nested folders, but not in node_modules', () => {
  const root = workspace({
    'package.json': manifest({}),
    'apps/web/package.json': manifest({'@angular/core': '^21.1.0', tailwindcss: '4.0.0'}),
    'node_modules/other/package.json': manifest({'@angular/core': '^9.0.0'}),
  });
  const info = inspect(root);
  assert.equal(info.angular, true);
  assert.equal(info.tailwind, true);
  assert.deepEqual(info.versions, ['^21.1.0']);
  assert.deepEqual(info.dirs, [path.join(root, 'apps/web')]);
});

test('takes the installed version over a range without a number', () => {
  const root = workspace({
    'package.json': manifest({'@angular/core': 'catalog:'}),
    'node_modules/@angular/core/package.json': JSON.stringify({version: '20.3.1'}),
  });
  assert.deepEqual(inspect(root).versions, ['20.3.1']);
});

test('sorts versions numerically and prints the newest major', () => {
  const root = workspace({
    'a/package.json': manifest({'@angular/core': '9.0.0'}),
    'b/package.json': manifest({'@angular/core': '21.0.0'}),
    'c/package.json': manifest({'@angular/core': '~10.2.0'}),
  });
  assert.deepEqual(inspect(root).versions, ['9.0.0', '~10.2.0', '21.0.0']);
  const printed = execFileSync(process.execPath, [path.join(__dirname, '../plugin/project.js'), root], {encoding: 'utf8'});
  assert.deepEqual(JSON.parse(printed), {angular: true, major: 21, tailwind: false});
});

test('an angular.json alone marks a project, and other workspaces have none', () => {
  assert.equal(inspect(workspace({'angular.json': '{}'})).angular, true);
  assert.deepEqual(inspect(workspace({'package.json': manifest({react: '19.0.0'})})), {
    angular: false,
    dirs: [],
    tailwind: false,
    versions: [],
  });
});
