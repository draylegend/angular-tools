const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const {languageDir, loadGrammar, readQuery} = require('./grammar.cjs');

test('every query compiles and captures in the sample template', async () => {
  const {language, parser} = await loadGrammar();
  const sample = fs.readFileSync(path.join(__dirname, 'fixtures/sample.component.html'), 'utf8');
  const tree = parser.parse(sample);
  assert.equal(tree.rootNode.hasError, false, 'the sample template parses without errors');

  const queries = fs.readdirSync(languageDir).filter(name => name.endsWith('.scm'));
  assert.ok(queries.length > 0);
  for (const name of queries) {
    const captures = readQuery(language, name).captures(tree.rootNode);
    assert.ok(captures.length > 0, `${name} captures something`);
  }
});
