// A stand-in language server for proxy tests: it exits with an error on `boom`,
// answers `opened` with the documents it was told about, and the rest with the
// method name or what the proxy expects from the Angular server.
'use strict';

const {encode, frames} = require('../../plugin/lsp.js');

const opened = [];
frames(process.stdin, ({id, method, params} = {}) => {
  if (method === 'boom') process.exit(1);
  if (method === 'textDocument/didOpen') opened.push(params.textDocument.text);
  if (id === undefined) return;
  const component = {uri: 'file:///a.ts', range: {start: {line: 1, character: 2}, end: {line: 1, character: 3}}};
  const results = {
    initialize: {capabilities: {}},
    opened,
    'textDocument/codeAction': null,
    'angular/getComponentsWithTemplateFile': [component],
  };
  const result = method in results ? results[method] : method;
  process.stdout.write(encode({jsonrpc: '2.0', id, result}));
});
process.stdin.on('end', () => process.exit(0));
