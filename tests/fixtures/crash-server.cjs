// A stand-in language server for proxy tests: it exits with an error on `boom`,
// answers `opened` with the documents it was told about, and every other request
// with its method name.
'use strict';

const {encode, frames} = require('../../plugin/lsp.js');

const opened = [];
frames(process.stdin, ({id, method, params} = {}) => {
  if (method === 'boom') process.exit(1);
  if (method === 'textDocument/didOpen') opened.push(params.textDocument.text);
  if (id === undefined) return;
  const result = method === 'initialize' ? {capabilities: {}} : method === 'opened' ? opened : method;
  process.stdout.write(encode({jsonrpc: '2.0', id, result}));
});
process.stdin.on('end', () => process.exit(0));
