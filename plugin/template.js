// Finds inline `template:` strings of components in TypeScript files.
'use strict';

const {fileURLToPath} = require('node:url');
const {declarations} = require('./selector-rename.js');

// The file's text with everything but the template at the offset blanked out,
// at its original position, or undefined outside templates.
function templateOnly(ts, uri, text, offset) {
  const sourceFile = ts.createSourceFile(fileURLToPath(uri), text, ts.ScriptTarget.Latest, true);
  const template = declarations(ts, sourceFile)
    .map(declaration => declaration.template)
    .find(found => found?.text !== undefined && offset >= found.offset && offset <= found.offset + found.text.length);
  if (!template) return undefined;
  const blank = part => part.replace(/[^\r\n]/g, ' ');
  const end = template.offset + template.text.length;
  return blank(text.slice(0, template.offset)) + text.slice(template.offset, end) + blank(text.slice(end));
}

module.exports = {templateOnly};
