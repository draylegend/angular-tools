const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
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

test('the proxy formats templates in Angular workspaces with the Angular parser', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'angular-tools-'));
  try {
    fs.writeFileSync(path.join(dir, 'angular.json'), '{}');
    const proxy = spawn(process.execPath, [
      path.join(__dirname, '../plugin/ngserver-proxy.js'),
      dir,
      path.join(__dirname, 'fixtures/echo-server.cjs'),
    ]);
    const replies = [];
    let output = '';
    const done = new Promise((resolve, reject) => {
      proxy.stdout.on('data', chunk => {
        output += chunk;
        for (;;) {
          const match = /Content-Length: (\d+)\r\n\r\n/.exec(output);
          if (!match || Buffer.byteLength(output.slice(match.index + match[0].length)) < Number(match[1])) break;
          const body = output.slice(match.index + match[0].length, match.index + match[0].length + Number(match[1]));
          replies.push(JSON.parse(body));
          output = output.slice(match.index + match[0].length + body.length);
        }
        if (replies.length === 2) resolve();
      });
      proxy.on('exit', code => reject(new Error(`proxy exited with ${code}`)));
    });
    const uri = pathToFileURL(path.join(dir, 'app.html')).href;
    const send = message => proxy.stdin.write(frame(JSON.stringify({jsonrpc: '2.0', ...message})));
    send({id: 1, method: 'initialize', params: {rootUri: pathToFileURL(dir).href}});
    send({method: 'textDocument/didOpen', params: {textDocument: {uri, languageId: 'html', version: 1, text: '@if (a) {\n<p   >{{a}}</p>\n  }\n'}}});
    send({id: 2, method: 'textDocument/formatting', params: {textDocument: {uri}, options: {tabSize: 2, insertSpaces: true}}});
    await done;
    proxy.stdin.end();
    assert.deepEqual(replies[1].result.map(edit => edit.newText), ['@if (a) {\n  <p>{{ a }}</p>\n}\n']);
  } finally {
    fs.rmSync(dir, {recursive: true, force: true});
  }
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

test('the stand-in server has no capabilities and answers nothing', async () => {
  const {frames} = require('../plugin/lsp.js');
  const server = spawn(process.execPath, [path.join(__dirname, '../plugin/no-server.js')]);
  const replies = [];
  const done = new Promise(resolve => {
    frames(server.stdout, message => {
      replies.push(message.result);
      if (replies.length === 2) resolve();
    });
  });
  server.stdin.write(frame(JSON.stringify({jsonrpc: '2.0', id: 1, method: 'initialize', params: {}})));
  server.stdin.write(frame(JSON.stringify({jsonrpc: '2.0', id: 2, method: 'textDocument/completion', params: {}})));
  await done;
  server.stdin.write(frame(JSON.stringify({jsonrpc: '2.0', method: 'exit'})));
  assert.deepEqual(replies, [{capabilities: {}}, null]);
});

test('the HTML server completes plain HTML and stays out of Angular syntax and TypeScript', async () => {
  const {frames} = require('../plugin/lsp.js');
  const server = spawn(process.execPath, [
    path.join(__dirname, '../plugin/html-server.js'),
    path.join(__dirname, '..'),
    require.resolve('vscode-html-languageservice'),
  ]);
  const replies = new Map();
  const done = new Promise(resolve => {
    frames(server.stdout, message => {
      replies.set(message.id, message.result);
      if (replies.size === 7) resolve();
    });
  });
  const send = message => server.stdin.write(frame(JSON.stringify({jsonrpc: '2.0', ...message})));
  const open = (uri, text) => send({method: 'textDocument/didOpen', params: {textDocument: {uri, languageId: 'html', version: 1, text}}});
  const completion = (id, uri, line, character) =>
    send({id, method: 'textDocument/completion', params: {textDocument: {uri}, position: {line, character}}});
  const html = pathToFileURL(path.join(__dirname, 'a.html')).href;
  const ts = pathToFileURL(path.join(__dirname, 'a.ts')).href;
  send({id: 1, method: 'initialize', params: {}});
  open(html, '<di></di>\n<p cl></p>\n<p [cl]></p>\n<p>{{ cl }}</p>\n');
  open(ts, "const other = '<di';\n@Component({template: `<p cl></p>`})\nexport class A {}\n");
  completion(2, html, 0, 3);
  completion(3, html, 1, 5);
  completion(4, html, 2, 6);
  completion(5, html, 3, 8);
  completion(6, ts, 1, 27);
  completion(7, ts, 0, 18);
  await done;
  send({method: 'exit'});
  const labels = id => replies.get(id).items.map(item => item.label);
  assert.ok(labels(2).includes('div'));
  assert.ok(labels(3).includes('class'));
  assert.equal(replies.get(4), null);
  assert.equal(replies.get(5), null);
  assert.ok(labels(6).includes('class'));
  assert.equal(replies.get(7), null);
});

test('the Emmet proxy stays out of opening tags and interpolations', async () => {
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
      if (replies.size === 3) resolve();
    });
  });
  const template = '<p [class.a></p><b>{{ c</b>';
  const start = '@Component({template: `'.length;
  const text = `@Component({template: \`${template}\`})\nexport class A {}\n`;
  const uri = pathToFileURL(path.join(__dirname, 'a.ts')).href;
  const send = message => proxy.stdin.write(frame(JSON.stringify({jsonrpc: '2.0', ...message})));
  const completion = (id, inTemplate) =>
    send({id, method: 'textDocument/completion', params: {textDocument: {uri}, position: {line: 0, character: start + inTemplate}}});
  send({method: 'textDocument/didOpen', params: {textDocument: {uri, languageId: 'html', version: 1, text}}});
  completion(1, '<p [class.a'.length);
  completion(2, '<p [class.a></p><b>{{ c'.length);
  completion(3, '<p [class.a></p>'.length);
  await done;
  proxy.stdin.end();
  assert.equal(replies.get(1), null);
  assert.equal(replies.get(2), null);
  assert.equal(replies.get(3), 'textDocument/completion');
});

test('the proxy tells the server about the oldest Angular version and its syntax', async () => {
  const {frames} = require('../plugin/lsp.js');
  const args = async dependencies => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'angular-tools-'));
    try {
      fs.mkdirSync(path.join(dir, 'node_modules'));
      fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({private: true}));
      for (const [name, version] of Object.entries(dependencies)) {
        fs.mkdirSync(path.join(dir, name));
        fs.writeFileSync(path.join(dir, name, 'package.json'), JSON.stringify({dependencies: {'@angular/core': version}}));
      }
      const proxy = spawn(process.execPath, [
        path.join(__dirname, '../plugin/ngserver-proxy.js'),
        dir,
        path.join(__dirname, 'fixtures/args-server.cjs'),
      ]);
      const result = await new Promise(resolve => {
        frames(proxy.stdout, message => resolve(message.result.args));
        proxy.stdin.write(frame(JSON.stringify({jsonrpc: '2.0', id: 1, method: 'initialize', params: {}})));
      });
      proxy.stdin.end();
      return result;
    } finally {
      fs.rmSync(dir, {recursive: true, force: true});
    }
  };
  const after = (list, name) => list[list.indexOf(name) + 1];
  const old = await args({a: '^16.2.0'});
  assert.equal(after(old, '--angularCoreVersion'), '16.2.0');
  assert.ok(old.includes('--disableBlockSyntax') && old.includes('--disableLetSyntax'));
  const mixed = await args({a: '^17.1.0', b: '~22.0.0'});
  assert.equal(after(mixed, '--angularCoreVersion'), '17.1.0');
  assert.ok(!mixed.includes('--disableBlockSyntax') && !mixed.includes('--disableLetSyntax'));
  assert.ok(!(await args({})).includes('--angularCoreVersion'));
});
