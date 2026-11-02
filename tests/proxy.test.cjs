const assert = require('node:assert');
const {spawn} = require('node:child_process');
const path = require('node:path');
const {pathToFileURL} = require('node:url');
const test = require('node:test');

const frame = body => `Content-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`;

test('the proxy survives malformed frames and keeps passing messages through', async () => {
  const proxy = spawn(process.execPath, [
    path.join(__dirname, '../plugin/ngserver-proxy.js'),
    __dirname,
    path.join(__dirname, 'fixtures/echo-server.cjs'),
  ]);
  const replies = [];
  let output = '';
  const done = new Promise((resolve, reject) => {
    proxy.stdout.on('data', chunk => {
      output += chunk;
      for (const match of output.matchAll(/\{[^{}]*\}/g)) replies.push(JSON.parse(match[0]));
      output = output.replace(/[\s\S]*\}/, '');
      if (replies.length === 2) resolve();
    });
    proxy.on('exit', code => reject(new Error(`proxy exited with ${code}`)));
  });
  const root = pathToFileURL(__dirname).href;
  proxy.stdin.write('X-Header: no length\r\n\r\n');
  proxy.stdin.write(frame('{not json'));
  proxy.stdin.write(frame(JSON.stringify({jsonrpc: '2.0', id: 1, method: 'initialize', params: {rootUri: root}})));
  proxy.stdin.write(frame(JSON.stringify({jsonrpc: '2.0', id: 2, method: 'textDocument/hover', params: {}})));
  await done;
  proxy.stdin.end();
  assert.deepEqual(
    replies.map(({id, result}) => [id, result]),
    [
      [1, 'initialize'],
      [2, 'textDocument/hover'],
    ],
  );
});

test('the Emmet proxy forwards completion only inside inline templates', async () => {
  const {frames} = require('../plugin/lsp.js');
  const proxy = spawn(process.execPath, [
    path.join(__dirname, '../plugin/emmet-proxy.js'),
    __dirname,
    path.join(__dirname, 'fixtures/echo-server.cjs'),
  ]);
  const replies = new Map();
  const done = new Promise(resolve => {
    frames(proxy.stdout, message => {
      replies.set(message.id, message.result);
      if (replies.size === 2) resolve();
    });
  });
  const text = "const other = 'a';\n@Component({template: `ul>li`})\nexport class A {}\n";
  const uri = pathToFileURL(path.join(__dirname, 'a.ts')).href;
  const send = message => proxy.stdin.write(frame(JSON.stringify({jsonrpc: '2.0', ...message})));
  const completion = (id, line, character) =>
    send({id, method: 'textDocument/completion', params: {textDocument: {uri}, position: {line, character}}});
  send({method: 'textDocument/didOpen', params: {textDocument: {uri, languageId: 'html', version: 1, text}}});
  completion(1, 1, 28);
  completion(2, 0, 17);
  await done;
  proxy.stdin.end();
  assert.equal(replies.get(1), 'textDocument/completion');
  assert.equal(replies.get(2), null);
});

test('the Emmet proxy answers nothing without a server', async () => {
  const {frames} = require('../plugin/lsp.js');
  const proxy = spawn(process.execPath, [path.join(__dirname, '../plugin/emmet-proxy.js'), __dirname, path.join(__dirname, 'missing.js')]);
  const replies = [];
  const done = new Promise(resolve => {
    frames(proxy.stdout, message => {
      replies.push(message.result);
      if (replies.length === 2) resolve();
    });
  });
  proxy.stdin.write(frame(JSON.stringify({jsonrpc: '2.0', id: 1, method: 'initialize', params: {}})));
  proxy.stdin.write(frame(JSON.stringify({jsonrpc: '2.0', id: 2, method: 'textDocument/completion', params: {}})));
  await done;
  proxy.stdin.write(frame(JSON.stringify({jsonrpc: '2.0', method: 'exit'})));
  assert.deepEqual(replies, [{capabilities: {}}, null]);
});
