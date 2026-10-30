// Models how Zed decides whether typing `/` closes the `/`-`>` pair: the
// override scope at the caret is the smallest capture containing it (inclusive
// captures also count their ends, `_` captures are ignored), the pair closes
// unless that scope is in its `not_in` list, and the next character must be
// whitespace or listed in `autoclose_before`.
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const {languageDir, loadGrammar, readQuery} = require('./grammar.cjs');

const config = fs.readFileSync(path.join(languageDir, 'config.toml'), 'utf8');
const notIn = JSON.parse(/start = "\/".*?not_in = (\[[^\]]*\])/.exec(config)[1]);
const autocloseBefore = JSON.parse('"' + /autoclose_before = "((?:[^"\\]|\\.)*)"/.exec(config)[1] + '"');

// Each case is `close` or `plain` on the first line, then a template with `‸`
// at the caret. Cases are separated by `====` lines.
const cases = fs.readFileSync(path.join(__dirname, 'fixtures/slash-cases.txt'), 'utf8')
  .split(/\n====\n/)
  .map(block => {
    const [expected, ...lines] = block.split('\n');
    const marked = lines.join('\n');
    return {expected, marked, offset: Buffer.byteLength(marked.slice(0, marked.indexOf('‸'))), text: marked.replace('‸', '')};
  });

function scopeAt(query, tree, offset) {
  let best = null;
  for (const match of query.matches(tree.rootNode)) {
    for (const {name, node} of match.captures) {
      if (name.startsWith('_')) continue;
      const inclusive = name.endsWith('.inclusive');
      const {startIndex: start, endIndex: end} = node;
      if (inclusive ? offset < start || offset > end : offset <= start || offset >= end) continue;
      if (!best || end - start < best.length) best = {name: name.replace(/\.inclusive$/, ''), length: end - start};
    }
  }
  return best && best.name;
}

test('`/` closes only unfinished opening tags', async () => {
  const {language, parser} = await loadGrammar();
  const query = readQuery(language, 'overrides.scm');
  for (const {expected, marked, offset, text} of cases) {
    const scope = scopeAt(query, parser.parse(text), offset);
    const next = text[offset];
    const closes = !notIn.includes(scope) && (next === undefined || /\s/.test(next) || autocloseBefore.includes(next));
    assert.equal(closes ? 'close' : 'plain', expected, `scope ${scope} in ${JSON.stringify(marked)}`);
  }
});
