// Runs the Emmet language server for TypeScript files, but only for inline
// `template:` strings of components. The server sees nothing but the template
// at the caret, at its original position, so it treats it as an HTML document.
// Without a server, in projects without Angular, it answers nothing.
// Usage: node emmet-proxy.js <project root> <server entry> <server arguments...>
'use strict';

const {spawn} = require('node:child_process');
const fs = require('node:fs');
const {fileURLToPath} = require('node:url');
const {answerNothing, applyChanges, encode, frames, toOffset} = require('./lsp.js');
const {declarations} = require('./selector-rename.js');

const [projectRoot, serverEntry, ...serverArgs] = process.argv.slice(2);

const reply = (id, result) => process.stdout.write(encode({jsonrpc: '2.0', id, result}));

function resolveTypeScript() {
  try {
    return require(require.resolve('typescript', {paths: [projectRoot]}));
  } catch {
    return undefined;
  }
}

const ts = fs.existsSync(serverEntry) ? resolveTypeScript() : undefined;

if (!ts) {
  answerNothing();
} else {
  const server = spawn(process.execPath, [serverEntry, ...serverArgs], {stdio: ['pipe', 'pipe', 'inherit']});
  server.on('exit', code => process.exit(code ?? 0));

  const documents = new Map();
  let version = 0;

  // The file's text with everything but the template at the offset blanked
  // out, or undefined outside templates.
  const templateOnly = (uri, text, offset) => {
    const fileName = fileURLToPath(uri);
    const sourceFile = ts.createSourceFile(fileName, text, ts.ScriptTarget.Latest, true);
    const template = declarations(ts, sourceFile)
      .map(declaration => declaration.template)
      .find(found => found?.text !== undefined && offset >= found.offset && offset <= found.offset + found.text.length);
    if (!template) return undefined;
    const blank = part => part.replace(/[^\r\n]/g, ' ');
    const end = template.offset + template.text.length;
    return blank(text.slice(0, template.offset)) + text.slice(template.offset, end) + blank(text.slice(end));
  };

  frames(process.stdin, (message, frame) => {
    const {method, params, id} = message ?? {};
    try {
      if (method === 'textDocument/didOpen') {
        documents.set(params.textDocument.uri, params.textDocument.text);
        const textDocument = {...params.textDocument, text: ''};
        return server.stdin.write(encode({...message, params: {...params, textDocument}}));
      }
      if (method === 'textDocument/didChange') {
        const {uri} = params.textDocument;
        documents.set(uri, applyChanges(documents.get(uri) ?? '', params.contentChanges));
        return;
      }
      if (method === 'textDocument/didClose') {
        documents.delete(params.textDocument.uri);
      } else if (method === 'textDocument/completion') {
        const {uri} = params.textDocument;
        const text = documents.get(uri) ?? '';
        const visible = templateOnly(uri, text, toOffset(text, params.position));
        if (visible === undefined) return reply(id, null);
        const textDocument = {uri, version: ++version};
        server.stdin.write(encode({jsonrpc: '2.0', method: 'textDocument/didChange', params: {textDocument, contentChanges: [{text: visible}]}}));
      }
    } catch (error) {
      process.stderr.write(`angular-tools: ${error.stack ?? error}\n`);
      if (method === 'textDocument/completion') return reply(id, null);
    }
    server.stdin.write(frame);
  });

  frames(server.stdout, (_message, frame) => process.stdout.write(frame));
  process.stdin.on('end', () => server.stdin.end());
}
