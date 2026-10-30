// Runs the Angular Language Server and answers three requests on selector
// names in HTML: rename and find references, which the server cannot do, and
// go to definition, which leads to the selector string instead of the class.
// All three also work in pages such as `index.html` that the server does not
// know. Every other message passes through unchanged.
// Usage: node ngserver-proxy.js <server entry> <server arguments...>
'use strict';

const {spawn} = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const {fileURLToPath, pathToFileURL} = require('node:url');
const {findFiles, renameLocations, selectorLocations, targetAt} = require('./selector-rename.js');

const [serverEntry, ...serverArgs] = process.argv.slice(2);
const ts = require(require.resolve('typescript', {paths: [path.dirname(serverEntry)]}));
const server = spawn(process.execPath, [serverEntry, ...serverArgs], {stdio: ['pipe', 'pipe', 'inherit']});
server.on('exit', code => process.exit(code ?? 0));

const documents = new Map();
let roots = [];

function frames(stream, onMessage) {
  let buffer = Buffer.alloc(0);
  stream.on('data', chunk => {
    buffer = Buffer.concat([buffer, chunk]);
    for (;;) {
      const headerEnd = buffer.indexOf('\r\n\r\n');
      if (headerEnd < 0) return;
      const length = Number(/content-length:\s*(\d+)/i.exec(buffer.subarray(0, headerEnd).toString('ascii'))?.[1]);
      const end = headerEnd + 4 + length;
      if (buffer.length < end) return;
      const frame = buffer.subarray(0, end);
      onMessage(JSON.parse(buffer.subarray(headerEnd + 4, end).toString('utf8')), frame);
      buffer = buffer.subarray(end);
    }
  });
}

function reply(id, result) {
  const body = Buffer.from(JSON.stringify({jsonrpc: '2.0', id, result}), 'utf8');
  process.stdout.write(Buffer.concat([Buffer.from(`Content-Length: ${body.length}\r\n\r\n`, 'ascii'), body]));
}

function lineStarts(text) {
  const starts = [0];
  for (let i = 0; i < text.length; i++) if (text[i] === '\n') starts.push(i + 1);
  return starts;
}

function toOffset(text, {line, character}) {
  const starts = lineStarts(text);
  return Math.min((starts[line] ?? text.length) + character, text.length);
}

function toPosition(starts, offset) {
  let line = 0;
  while (line + 1 < starts.length && starts[line + 1] <= offset) line++;
  return {line, character: offset - starts[line]};
}

function applyChanges(text, changes) {
  for (const change of changes) {
    if (!change.range) {
      text = change.text;
      continue;
    }
    text = text.slice(0, toOffset(text, change.range.start)) + change.text + text.slice(toOffset(text, change.range.end));
  }
  return text;
}

function readFile(fileName) {
  if (documents.has(fileName)) return documents.get(fileName);
  try {
    return fs.readFileSync(fileName, 'utf8');
  } catch {
    return undefined;
  }
}

const parsed = new Map();

function sourceFiles() {
  const files = findFiles(roots, '.ts').filter(fileName => !fileName.endsWith('.d.ts'));
  return files.flatMap(fileName => {
    const text = readFile(fileName);
    if (text === undefined) return [];
    const cached = parsed.get(fileName);
    if (cached && cached.text === text) return [cached.sourceFile];
    const sourceFile = ts.createSourceFile(fileName, text, ts.ScriptTarget.Latest, true);
    parsed.set(fileName, {text, sourceFile});
    return [sourceFile];
  });
}

const project = {ts, sourceFiles, readFile, htmlFiles: () => findFiles(roots, '.html')};

function selectorAt(params) {
  const fileName = fileURLToPath(params.textDocument.uri);
  if (/\.[cm]?tsx?$/.test(fileName)) return undefined;
  const text = readFile(fileName);
  if (text === undefined) return undefined;
  const target = targetAt(project, fileName, toOffset(text, params.position));
  return target && {fileName, target, text};
}

/** Every use of the selector name at a position, for rename and references. */
function selectorUses(params) {
  const selector = selectorAt(params);
  const locations = selector && renameLocations(project, selector.target);
  return locations && {...selector, locations};
}

/**
 * The selector strings that declare a tag or attribute, as links whose origin
 * covers the whole name, so the editor underlines `app-root` rather than one
 * word of it.
 */
function selectorDefinition(params) {
  const selector = selectorAt(params);
  if (!selector) return undefined;
  const locations = selectorLocations(project, selector.target);
  if (!locations.length) return undefined;
  const starts = lineStarts(selector.text);
  const originSelectionRange = {
    start: toPosition(starts, selector.target.start),
    end: toPosition(starts, selector.target.end),
  };
  return locations.map(toLocation).map(({uri, range}) => ({
    originSelectionRange,
    targetUri: uri,
    targetRange: range,
    targetSelectionRange: range,
  }));
}

function toLocation(location) {
  const starts = lineStarts(readFile(location.fileName) ?? '');
  const range = {start: toPosition(starts, location.start), end: toPosition(starts, location.end)};
  return {uri: pathToFileURL(location.fileName).href, range};
}

frames(process.stdin, (message, frame) => {
  const {method, params, id} = message;
  try {
    if (method === 'initialize') {
      const folders = params.workspaceFolders?.map(folder => folder.uri) ?? (params.rootUri ? [params.rootUri] : []);
      roots = folders.map(uri => fileURLToPath(uri));
    } else if (method === 'textDocument/didOpen') {
      documents.set(fileURLToPath(params.textDocument.uri), params.textDocument.text);
    } else if (method === 'textDocument/didChange') {
      const fileName = fileURLToPath(params.textDocument.uri);
      documents.set(fileName, applyChanges(documents.get(fileName) ?? '', params.contentChanges));
    } else if (method === 'textDocument/didClose') {
      documents.delete(fileURLToPath(params.textDocument.uri));
    } else if (method === 'textDocument/prepareRename') {
      const rename = selectorUses(params);
      if (rename) {
        const starts = lineStarts(rename.text);
        const range = {start: toPosition(starts, rename.target.start), end: toPosition(starts, rename.target.end)};
        return reply(id, {range, placeholder: rename.target.name});
      }
    } else if (method === 'textDocument/rename') {
      const rename = selectorUses(params);
      if (rename) {
        const changes = {};
        for (const {uri, range} of rename.locations.map(toLocation)) {
          (changes[uri] ??= []).push({range, newText: params.newName});
        }
        return reply(id, {changes});
      }
    } else if (method === 'textDocument/references') {
      const uses = selectorUses(params);
      if (uses) return reply(id, uses.locations.map(toLocation));
    } else if (method === 'textDocument/definition') {
      const links = selectorDefinition(params);
      if (links) return reply(id, links);
    }
  } catch (error) {
    process.stderr.write(`angular-tools: ${error.stack ?? error}\n`);
  }
  server.stdin.write(frame);
});

frames(server.stdout, (_message, frame) => process.stdout.write(frame));
process.stdin.on('end', () => server.stdin.end());
