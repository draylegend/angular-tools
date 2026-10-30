// Loads the Angular grammar built from the dev install checkout in
// grammars/angular, with the language's queries and configuration.
const fs = require('node:fs');
const path = require('node:path');
const {Parser, Language, Query} = require('web-tree-sitter');

const root = path.join(__dirname, '..');
const languageDir = path.join(root, 'languages/angular');
// Built by `npm test` from the grammar checkout that a dev install leaves in
// grammars/angular; Zed's own grammars/angular.wasm targets WASI instead.
const wasm = path.join(root, 'target/tests/angular.wasm');

async function loadGrammar() {
  if (!fs.existsSync(wasm)) {
    throw new Error('target/tests/angular.wasm is missing; run npm test after a dev install in Zed');
  }
  await Parser.init();
  const language = await Language.load(wasm);
  const parser = new Parser();
  parser.setLanguage(language);
  return {language, parser};
}

function readQuery(language, name) {
  return new Query(language, fs.readFileSync(path.join(languageDir, name), 'utf8'));
}

module.exports = {languageDir, loadGrammar, readQuery};
