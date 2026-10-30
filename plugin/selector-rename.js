// Renames Angular element and attribute selectors together with their uses in
// templates. The official language service renames neither, so this module
// finds `selector` strings in `@Component` and `@Directive` decorators, scans
// inline and external templates for matching tag and attribute names, and
// reports every location as an offset range in its file.
'use strict';

const path = require('node:path');

const NAME = /[A-Za-z][\w.:-]*/y;

/**
 * Element names and attribute names in a selector such as `app-card`,
 * `[app-highlight]` or `button[app-button], a[app-button]`.
 */
function parseSelector(text) {
  const names = [];
  const element = /(^|[\s,>+~])([A-Za-z][\w-]*)/g;
  for (let match; (match = element.exec(text)); ) {
    const start = match.index + match[1].length;
    names.push({kind: 'element', name: match[2], start, end: start + match[2].length});
  }
  const attribute = /\[\s*([A-Za-z][\w-]*)/g;
  for (let match; (match = attribute.exec(text)); ) {
    const start = match.index + match[0].length - match[1].length;
    names.push({kind: 'attribute', name: match[1], start, end: start + match[1].length});
  }
  return names;
}

function skipPast(text, index, end) {
  const found = text.indexOf(end, index);
  return found < 0 ? text.length : found + end.length;
}

/**
 * Tag names and attribute names in a template. Attribute names come from
 * plain attributes and from property bindings like `[name]` and `[(name)]`.
 */
function scanTemplate(text) {
  const names = [];
  let i = 0;
  while (i < text.length) {
    if (text.startsWith('<!--', i)) {
      i = skipPast(text, i + 4, '-->');
    } else if (text.startsWith('{{', i)) {
      i = skipPast(text, i + 2, '}}');
    } else if (text[i] === '<' && /[A-Za-z/]/.test(text[i + 1] || '')) {
      const closing = text[i + 1] === '/';
      NAME.lastIndex = i + (closing ? 2 : 1);
      const tag = NAME.exec(text);
      if (!tag) {
        i++;
        continue;
      }
      names.push({kind: 'element', name: tag[0], start: tag.index, end: tag.index + tag[0].length});
      i = NAME.lastIndex;
      if (closing) {
        i = skipPast(text, i, '>');
        continue;
      }
      i = scanAttributes(text, i, names);
      if (/^(script|style)$/i.test(tag[0])) i = skipPast(text, i, `</${tag[0]}`) - tag[0].length - 2;
    } else {
      i++;
    }
  }
  return names;
}

function scanAttributes(text, i, names) {
  while (i < text.length) {
    while (/\s/.test(text[i] || '')) i++;
    if (i >= text.length || text[i] === '>') return i + 1;
    if (text.startsWith('/>', i)) return i + 2;
    if (text[i] === '<') return i;
    const start = i;
    while (i < text.length && !/[\s=>]/.test(text[i]) && !text.startsWith('/>', i)) i++;
    const raw = text.slice(start, i);
    const prefix = raw.startsWith('[(') ? 2 : raw.startsWith('[') ? 1 : 0;
    const suffix = prefix === 2 ? 2 : prefix === 1 ? 1 : 0;
    const name = raw.slice(prefix, raw.length - suffix);
    if (/^[A-Za-z][\w-]*$/.test(name) && (prefix === 0 || raw.endsWith(prefix === 2 ? ')]' : ']'))) {
      names.push({kind: 'attribute', name, start: start + prefix, end: start + prefix + name.length});
    }
    while (/\s/.test(text[i] || '')) i++;
    if (text[i] === '=') {
      i++;
      while (/\s/.test(text[i] || '')) i++;
      const quote = text[i];
      if (quote === '"' || quote === "'") i = skipPast(text, i + 1, quote);
      else while (i < text.length && !/[\s>]/.test(text[i])) i++;
    }
  }
  return i;
}

function propertyName(ts, property) {
  return property.name && (ts.isIdentifier(property.name) || ts.isStringLiteral(property.name)) ? property.name.text : undefined;
}

function stringValue(ts, node) {
  return node && (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) ? node : undefined;
}

/**
 * Components and directives declared in a source file, with the offsets of
 * their selector strings and their inline or external templates.
 */
function declarations(ts, sourceFile) {
  const found = [];
  const visit = node => {
    if (ts.isDecorator(node) && ts.isCallExpression(node.expression)) {
      const callee = node.expression.expression;
      const name = ts.isIdentifier(callee) ? callee.text : ts.isPropertyAccessExpression(callee) ? callee.name.text : '';
      const [options] = node.expression.arguments;
      if ((name === 'Component' || name === 'Directive') && options && ts.isObjectLiteralExpression(options)) {
        const declaration = {fileName: sourceFile.fileName, selector: undefined, template: undefined};
        for (const property of options.properties) {
          if (!ts.isPropertyAssignment(property)) continue;
          const key = propertyName(ts, property);
          const value = stringValue(ts, property.initializer);
          if (!value) continue;
          const offset = value.getStart(sourceFile) + 1;
          if (key === 'selector') declaration.selector = {text: value.text, offset};
          if (key === 'template') declaration.template = {fileName: sourceFile.fileName, text: value.text, offset};
          if (key === 'templateUrl') {
            declaration.template = {fileName: path.resolve(path.dirname(sourceFile.fileName), value.text), offset: 0};
          }
        }
        found.push(declaration);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return found;
}

/**
 * The selector name at an offset, or undefined when the offset is not on a
 * selector string, a tag name or an attribute name.
 * `project` provides `sourceFiles()`, `readFile(fileName)` and `ts`.
 */
function targetAt(project, fileName, offset) {
  const {ts} = project;
  const within = name => offset >= name.start && offset <= name.end;
  if (!/\.[cm]?tsx?$/.test(fileName)) {
    const text = project.readFile(fileName);
    const hit = text === undefined ? undefined : scanTemplate(text).find(within);
    return hit && {...hit, fileName};
  }
  const sourceFile = project.sourceFiles().find(file => file.fileName === fileName);
  if (!sourceFile) return undefined;
  for (const declaration of declarations(ts, sourceFile)) {
    const {selector, template} = declaration;
    if (selector) {
      const hit = parseSelector(selector.text).map(name => shift(name, selector.offset)).find(within);
      if (hit) return {...hit, fileName};
    }
    if (template && template.text !== undefined) {
      const hit = scanTemplate(template.text).map(name => shift(name, template.offset)).find(within);
      if (hit) return {...hit, fileName};
    }
  }
  return undefined;
}

function shift(name, offset) {
  return {...name, start: name.start + offset, end: name.end + offset};
}

/**
 * Every location of a selector name: in selector strings and in the templates
 * of all components. Returns undefined when no component or directive
 * declares that name, so other rename providers can handle it.
 */
function renameLocations(project, target) {
  const {ts} = project;
  const same = name => name.kind === target.kind && name.name === target.name;
  const locations = [];
  const templates = [];
  let declared = false;
  for (const sourceFile of project.sourceFiles()) {
    for (const {selector, template} of declarations(ts, sourceFile)) {
      if (selector) {
        for (const name of parseSelector(selector.text).filter(same)) {
          declared = true;
          locations.push({fileName: sourceFile.fileName, ...shift(name, selector.offset)});
        }
      }
      if (template) templates.push(template);
    }
  }
  if (!declared) return undefined;
  const seen = new Set();
  for (const template of templates) {
    const text = template.text !== undefined ? template.text : project.readFile(template.fileName);
    if (text === undefined) continue;
    for (const name of scanTemplate(text).filter(same)) {
      const location = {fileName: template.fileName, ...shift(name, template.offset)};
      const key = `${location.fileName}:${location.start}`;
      if (!seen.has(key)) {
        seen.add(key);
        locations.push(location);
      }
    }
  }
  return locations;
}

module.exports = {declarations, parseSelector, renameLocations, scanTemplate, targetAt};
