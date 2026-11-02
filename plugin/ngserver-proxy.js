// Runs the Angular Language Server and answers three requests on selector
// names in HTML: rename and find references, which the server cannot do, and
// go to definition, which leads to the selector string instead of the class.
// All three also work in pages such as `index.html` that the server does not
// know. Every other message passes through unchanged.
// Usage: node ngserver-proxy.js <project root> <fallback server entry> <server arguments...>
'use strict';

const {spawn} = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const {fileURLToPath, pathToFileURL} = require('node:url');
const {applyChanges, encode, frames, lineStarts, toOffset, toPosition} = require('./lsp.js');
const {inspect, versionNumbers} = require('./project.js');
const {containedIn, findFiles, renameLocations, selectorLocations, targetAt} = require('./selector-rename.js');

const [projectRoot, fallbackEntry, ...serverArgs] = process.argv.slice(2);
// The project's own server comes first, with the project's TypeScript and
// @angular/language-service. Otherwise the extension's server for the
// project's Angular version runs with its own language service and the
// project's TypeScript, since servers before 22 do not bring one.
const projectInfo = inspect(projectRoot);
const projectDirs = [projectRoot, ...projectInfo.dirs.filter(dir => dir !== projectRoot)];
const projectEntry = projectDirs
  .map(dir => path.join(dir, 'node_modules/@angular/language-server/index.js'))
  .find(entry => fs.existsSync(entry));
const serverEntry = projectEntry ?? fallbackEntry;
const serverDir = path.dirname(serverEntry);
const ngProbeLocations = projectEntry ? [...projectDirs, serverDir] : [serverDir];
const tsProbeLocations = [...projectDirs, serverDir];
const ts = require(require.resolve('typescript', {paths: tsProbeLocations}));

// What the official client tells the server about the project's Angular: the
// oldest version for compatibility, and syntax that no version here supports.
function versionArguments() {
  const versions = projectInfo.versions.map(versionNumbers);
  if (!versions.length) return [];
  const [major, minor = 0, patch = 0] = versions[0];
  const args = ['--angularCoreVersion', major === 0 ? '999.999.999' : `${major}.${minor}.${patch}`];
  if (versions.every(([major]) => major < 17)) args.push('--disableBlockSyntax');
  if (versions.every(([major, minor = 0]) => major < 18 || (major === 18 && minor < 1))) args.push('--disableLetSyntax');
  return args;
}

const server = spawn(
  process.execPath,
  [
    serverEntry,
    '--tsProbeLocations',
    tsProbeLocations.join(','),
    '--ngProbeLocations',
    ngProbeLocations.join(','),
    ...versionArguments(),
    ...serverArgs,
  ],
  {stdio: ['pipe', 'pipe', 'inherit']},
);
server.on('exit', code => process.exit(code ?? 0));

const documents = new Map();
let roots = [];

function reply(id, result) {
  process.stdout.write(encode({jsonrpc: '2.0', id, result}));
}

function readFile(fileName) {
  if (documents.has(fileName)) return documents.get(fileName);
  try {
    return fs.readFileSync(fileName, 'utf8');
  } catch {
    return undefined;
  }
}

// Parsed TypeScript files by name. A file is read and parsed again only when
// its open text or its modification time and size change, because go to
// definition runs on every Ctrl-hover.
const parsed = new Map();

function version(fileName) {
  if (documents.has(fileName)) return documents.get(fileName);
  try {
    const stat = fs.statSync(fileName);
    return `${stat.mtimeMs}:${stat.size}`;
  } catch {
    return undefined;
  }
}

function sourceFiles() {
  const files = findFiles(roots, '.ts').filter(fileName => !fileName.endsWith('.d.ts'));
  return files.flatMap(fileName => {
    const current = version(fileName);
    if (current === undefined) return [];
    const cached = parsed.get(fileName);
    if (cached && cached.version === current) return [cached.sourceFile];
    const text = readFile(fileName);
    if (text === undefined) return [];
    const sourceFile = ts.createSourceFile(fileName, text, ts.ScriptTarget.Latest, true);
    parsed.set(fileName, {version: current, sourceFile});
    return [sourceFile];
  });
}

// Selector features only run in Angular workspaces; elsewhere the server turns
// itself off and the proxy only passes messages through.
let angular = false;

const project = {ts, sourceFiles, readFile, htmlFiles: () => findFiles(roots, '.html'), contains: () => false};

function selectorAt(params) {
  if (!angular) return undefined;
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

// Formats templates with Prettier's Angular parser: the project's Prettier
// and configuration when it has them, otherwise the Prettier installed with
// the extension and the editor's indentation. Zed hands formatting to the
// language server for languages without its own Prettier support, such as
// Angular, so templates format without a formatter setting.
let initializeId;

// The .prettierignore closest to the file, up to the project root.
function nearestIgnoreFile(fileName) {
  let dir = path.dirname(fileName);
  while (dir !== projectRoot && dir !== path.dirname(dir) && !fs.existsSync(path.join(dir, '.prettierignore'))) {
    dir = path.dirname(dir);
  }
  return path.join(dir, '.prettierignore');
}

async function format(params) {
  const fileName = fileURLToPath(params.textDocument.uri);
  const text = documents.get(fileName);
  if (text === undefined) return null;
  const prettier = require(require.resolve('prettier', {paths: [path.dirname(fileName), projectRoot, __dirname]}));
  const {ignored} = await prettier.getFileInfo(fileName, {ignorePath: nearestIgnoreFile(fileName)});
  if (ignored) return [];
  const config = await prettier.resolveConfig(fileName, {editorconfig: true});
  const indentation = config ? {} : {tabWidth: params.options.tabSize, useTabs: !params.options.insertSpaces};
  const formatted = await prettier.format(text, {...indentation, ...config, filepath: fileName, parser: 'angular'});
  if (formatted === text) return [];
  const starts = lineStarts(text);
  return [{range: {start: {line: 0, character: 0}, end: toPosition(starts, text.length)}, newText: formatted}];
}

// Both tags of an element for editing them together, which the server does not
// answer. The HTML language service comes with the extension's HTML server.
function linkedEditingRanges(params) {
  const text = documents.get(fileURLToPath(params.textDocument.uri));
  if (text === undefined) return undefined;
  let html;
  try {
    html = require(require.resolve('vscode-html-languageservice', {paths: [__dirname]}));
  } catch {
    return undefined;
  }
  const service = html.getLanguageService();
  const document = html.TextDocument.create(params.textDocument.uri, 'html', 0, text);
  const ranges = service.findLinkedEditingRanges(document, params.position, service.parseHTMLDocument(document));
  return ranges ? {ranges} : null;
}

function toLocation(location) {
  const starts = lineStarts(readFile(location.fileName) ?? '');
  const range = {start: toPosition(starts, location.start), end: toPosition(starts, location.end)};
  return {uri: pathToFileURL(location.fileName).href, range};
}

frames(process.stdin, (message, frame) => {
  const {method, params, id} = message ?? {};
  try {
    if (method === 'initialize') {
      const folders = params.workspaceFolders?.map(folder => folder.uri) ?? (params.rootUri ? [params.rootUri] : []);
      roots = folders.map(uri => fileURLToPath(uri));
      angular = projectInfo.angular;
      project.contains = containedIn(roots);
      initializeId = id;
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
    } else if (method === 'textDocument/linkedEditingRange' && angular) {
      const ranges = linkedEditingRanges(params);
      if (ranges !== undefined) return reply(id, ranges);
    } else if (method === 'textDocument/formatting' && angular) {
      format(params).then(
        edits => reply(id, edits),
        error => {
          process.stderr.write(`angular-tools: ${error.stack ?? error}\n`);
          reply(id, null);
        },
      );
      return;
    }
  } catch (error) {
    process.stderr.write(`angular-tools: ${error.stack ?? error}\n`);
  }
  server.stdin.write(frame);
});

frames(server.stdout, (message, frame) => {
  if (angular && initializeId !== undefined && message?.id === initializeId && message.result?.capabilities) {
    message.result.capabilities.documentFormattingProvider = true;
    frame = encode(message);
  }
  process.stdout.write(frame);
});
process.stdin.on('end', () => server.stdin.end());
