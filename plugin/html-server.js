// Completes plain HTML tags and attributes, which the Angular Language Server
// leaves out, and CSS in `<style>` and `style=""`, and describes them on hover,
// in files of the Angular language and in inline `template:` strings of
// components. Angular syntax stays with that server. Without the HTML language
// service, in projects without Angular, it answers nothing.
// Usage: node html-server.js <project root> <HTML language service entry>
'use strict';

const fs = require('node:fs');
const path = require('node:path');
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
  const blank = part => part.replace(/[^\r\n]/g, ' ');

  const css = (() => {
    try {
      const entry = require.resolve('vscode-css-languageservice', {paths: [path.dirname(serviceEntry), __dirname]});
      const language = require(entry);
      return {language, service: language.getCSSLanguageService({clientCapabilities: language.ClientCapabilities.LATEST})};
    } catch {
      return undefined;
    }
  })();

  // The text as a style sheet when the offset is inside CSS, at the original
  // positions: a `<style>` element, or a `style` attribute as the body of a rule.
  const styleSheetAt = (text, offset) => {
    const scanner = service.createScanner(text);
    let attribute;
    for (let token = scanner.scan(); token !== html.TokenType.EOS; token = scanner.scan()) {
      const [start, end] = [scanner.getTokenOffset(), scanner.getTokenEnd()];
      if (start > offset) return undefined;
      if (token === html.TokenType.AttributeName) attribute = scanner.getTokenText();
      if (token === html.TokenType.Styles && offset <= end) {
        return blank(text.slice(0, start)) + text.slice(start, end) + blank(text.slice(end));
      }
      if (token === html.TokenType.AttributeValue && attribute === 'style' && /["']/.test(text[start]) && offset < end) {
        const value = text.slice(start + 1, end - 1);
        return `${blank(text.slice(0, start - 1))}*{${value}}${blank(text.slice(end))}`;
      }
    }
    return undefined;
  };

  // What the position holds: the HTML of the file or template, and CSS if any.
  const contentAt = ({textDocument: {uri}, position}) => {
    const stored = documents.get(uri) ?? '';
    const offset = toOffset(stored, position);
    const text = uri.endsWith('.ts') ? ts && templateOnly(ts, uri, stored, offset) : stored;
    if (text === undefined) return undefined;
    const styleSheet = css && styleSheetAt(text, offset);
    if (styleSheet !== undefined) {
      const document = css.language.TextDocument.create(uri, 'css', 0, styleSheet);
      return {styleSheet: document, parsed: css.service.parseStylesheet(document)};
    }
    if (isAngularSyntax(text, offset)) return undefined;
    const document = html.TextDocument.create(uri, 'html', 0, text);
    return {document, parsed: service.parseHTMLDocument(document)};
  };

  const complete = params => {
    const content = contentAt(params);
    if (!content) return null;
    if (!content.styleSheet) {
      return service.doComplete(content.document, params.position, content.parsed, {hideAutoCompleteProposals: true});
    }
    // Without these kinds the labels do not take the colors of tags and attributes.
    const list = css.service.doComplete(content.styleSheet, params.position, content.parsed);
    return {...list, items: list.items.map(({kind: _kind, ...item}) => item)};
  };

  const hover = params => {
    const content = contentAt(params);
    if (!content) return null;
    return content.styleSheet
      ? css.service.doHover(content.styleSheet, params.position, content.parsed)
      : service.doHover(content.document, params.position, content.parsed);
  };

  frames(process.stdin, ({method, params, id} = {}) => {
    if (method === 'exit') process.exit(0);
    if (method === 'initialize') {
      const completionProvider = {triggerCharacters: ['<', ' ', ':']};
      return reply(id, {capabilities: {textDocumentSync: 2, completionProvider, hoverProvider: true}});
    }
    if (method === 'textDocument/didOpen') documents.set(params.textDocument.uri, params.textDocument.text);
    else if (method === 'textDocument/didClose') documents.delete(params.textDocument.uri);
    else if (method === 'textDocument/didChange') {
      const {uri} = params.textDocument;
      documents.set(uri, applyChanges(documents.get(uri) ?? '', params.contentChanges));
    } else if (id !== undefined) {
      try {
        if (method === 'textDocument/completion') reply(id, complete(params));
        else if (method === 'textDocument/hover') reply(id, hover(params));
        else reply(id, null);
      } catch (error) {
        process.stderr.write(`angular-tools: ${error.stack ?? error}\n`);
        reply(id, null);
      }
    }
  });
}
