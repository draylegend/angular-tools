// Completes plain HTML tags and attributes, which the Angular Language Server
// leaves out, in files of the Angular language and in inline `template:`
// strings of components. Angular syntax stays with that server. Without the
// HTML language service, in projects without Angular, it answers nothing.
// Usage: node html-server.js <project root> <HTML language service entry>
'use strict';

const fs = require('node:fs');
const {answerNothing, applyChanges, encode, frames, toOffset} = require('./lsp.js');
const {inspect, resolvePackage} = require('./project.js');
const {templateOnly} = require('./template.js');

const [projectRoot, serviceEntry] = process.argv.slice(2);

const reply = (id, result) => process.stdout.write(encode({jsonrpc: '2.0', id, result}));

function resolveTypeScript() {
  try {
    return require(resolvePackage('typescript', projectRoot, inspect(projectRoot).dirs));
  } catch {
    return undefined;
  }
}

// Bindings, references, structural directives and interpolations belong to
// Angular, and plain attributes would be wrong in them.
function isAngularSyntax(text, offset) {
  const before = text.slice(0, offset);
  if (before.lastIndexOf('{{') > before.lastIndexOf('}}')) return true;
  return /(^|[\s<])[[(*#@][^\s<>"'=]*$/.test(before);
}

if (!fs.existsSync(serviceEntry)) {
  answerNothing();
} else {
  const html = require(serviceEntry);
  const ts = resolveTypeScript();
  const service = html.getLanguageService({clientCapabilities: html.ClientCapabilities.LATEST});
  const documents = new Map();

  const complete = ({textDocument: {uri}, position}) => {
    const stored = documents.get(uri) ?? '';
    const offset = toOffset(stored, position);
    const text = uri.endsWith('.ts') ? ts && templateOnly(ts, uri, stored, offset) : stored;
    if (text === undefined || isAngularSyntax(text, offset)) return null;
    const document = html.TextDocument.create(uri, 'html', 0, text);
    return service.doComplete(document, position, service.parseHTMLDocument(document), {hideAutoCompleteProposals: true});
  };

  frames(process.stdin, ({method, params, id} = {}) => {
    if (method === 'exit') process.exit(0);
    if (method === 'initialize') {
      const completionProvider = {triggerCharacters: ['<', ' ']};
      return reply(id, {capabilities: {textDocumentSync: 2, completionProvider}});
    }
    if (method === 'textDocument/didOpen') documents.set(params.textDocument.uri, params.textDocument.text);
    else if (method === 'textDocument/didClose') documents.delete(params.textDocument.uri);
    else if (method === 'textDocument/didChange') {
      const {uri} = params.textDocument;
      documents.set(uri, applyChanges(documents.get(uri) ?? '', params.contentChanges));
    } else if (id !== undefined) {
      try {
        reply(id, method === 'textDocument/completion' ? complete(params) : null);
      } catch (error) {
        process.stderr.write(`angular-tools: ${error.stack ?? error}\n`);
        reply(id, null);
      }
    }
  });
}
