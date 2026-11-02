// A stand-in language server for proxy tests: it answers `initialize` with its
// command line arguments.
'use strict';

const {encode, frames} = require('../../plugin/lsp.js');

frames(process.stdin, ({id} = {}) => {
  if (id !== undefined) process.stdout.write(encode({jsonrpc: '2.0', id, result: {capabilities: {}, args: process.argv.slice(2)}}));
});
process.stdin.on('end', () => process.exit(0));
