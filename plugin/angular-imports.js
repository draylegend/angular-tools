// What the Angular language service needs to complete directives that a
// component does not import yet, and to import them. It knows only the
// directives in the program, and a library that does not use, for example,
// @angular/common leaves it out. And it names the import after the file that
// declares the directive, which in packages split into chunks is an internal
// path such as `../../node_modules/@angular/common/types/_common_module-chunk`.
'use strict';

const fs = require('node:fs');
const path = require('node:path');

function readManifest(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return undefined;
  }
}

const ancestors = dir => {
  const parent = path.dirname(dir);
  return parent === dir ? [dir] : [dir, ...ancestors(parent)];
};

// The installed package seen from a folder, with its type declarations.
function findPackage(name, dir) {
  for (const current of ancestors(dir)) {
    const root = path.join(current, 'node_modules', name);
    const manifest = readManifest(path.join(root, 'package.json'));
    if (manifest) {
      const types = manifest.exports?.['.']?.types ?? manifest.types ?? manifest.typings;
      return {manifest, types: types && path.join(root, types)};
    }
  }
  return undefined;
}

/** The type declarations of the Angular libraries that a folder depends on. */
function angularLibraries(dir) {
  const names = new Set();
  for (const current of ancestors(dir)) {
    const manifest = readManifest(path.join(current, 'package.json'));
    for (const name of Object.keys({...manifest?.dependencies, ...manifest?.devDependencies})) names.add(name);
  }
  return [...names]
    .filter(name => name !== '@angular/core')
    .map(name => findPackage(name, dir))
    .filter(found => found?.types && found.manifest.peerDependencies?.['@angular/core'] && fs.existsSync(found.types))
    .map(found => found.types.replaceAll(path.sep, '/'));
}

/** Adds these libraries to the program of a tsserver project with a tsconfig. */
function addAngularLibraries(project) {
  const rootNames = project.getScriptFileNames?.bind(project);
  if (!rootNames) return;
  let libraries;
  project.getScriptFileNames = () => {
    const names = rootNames();
    if (!names.length) return names;
    libraries ??= angularLibraries(project.getCurrentDirectory());
    return [...names, ...libraries.filter(library => !names.includes(library))];
  };
}

/**
 * A stand-in for an Angular language service, for the server to load as its
 * plugin, that adds the libraries first. The server has no other way to load
 * code into its projects. Returns the folder to probe, or undefined to keep
 * the real one, which older versions that cannot import directives do.
 */
function languageServiceStandIn(probeLocations, folder) {
  const name = '@angular/language-service';
  const entry = require.resolve(name, {paths: probeLocations});
  const {version} = readManifest(path.join(path.dirname(entry), 'package.json')) ?? {};
  if (!(Number.parseInt(version, 10) >= 17)) return undefined;
  const dir = path.join(folder, 'node_modules', name);
  fs.mkdirSync(dir, {recursive: true});
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({name, version, main: 'index.js'}));
  fs.writeFileSync(
    path.join(dir, 'index.js'),
    `const {addAngularLibraries} = require(${JSON.stringify(__filename)});
const factory = require(${JSON.stringify(entry)});
module.exports = modules => {
  const plugin = factory(modules);
  const create = info => {
    if (info.project.projectKind === modules.typescript.server.ProjectKind.Configured) addAngularLibraries(info.project);
    return plugin.create(info);
  };
  return {...plugin, create};
};
`,
  );
  return folder;
}

const INTERNAL_IMPORT = /(import\s*\{([^}]*)\}\s*from\s*['"])[^'"]*node_modules\/((?:@[^/'"]+\/)?[^/'"]+)\/[^'"]*(['"])/g;

// An internal path becomes the package, if the package exports all the names.
function publicImports(text, dirs) {
  return text.replace(INTERNAL_IMPORT, (original, start, names, name, end) => {
    const {types} = dirs.map(dir => findPackage(name, dir)).find(found => found?.types) ?? {};
    if (!types) return original;
    const entry = fs.readFileSync(types, 'utf8');
    const exported = names.split(',').map(part => part.trim().split(/\s+/)[0]).filter(Boolean);
    return exported.every(part => new RegExp(`\\b${part.replace(/\$/g, '\\$')}\\b`).test(entry)) ? `${start}${name}${end}` : original;
  });
}

/** A copy of edits, in any form, with public imports in their new text. */
function withPublicImports(edits, dirs) {
  return JSON.parse(JSON.stringify(edits), (key, value) =>
    (key === 'newText' || key === 'text') && typeof value === 'string' ? publicImports(value, dirs) : value,
  );
}

const IMPORTS_AFTER_PROPERTY = /^,(\r?\n[ \t]*)(imports:[^]*)$/;

// Zed asks for these edits after it inserts the completion and reads them
// against the changed text, so an insertion later on the same line lands in
// the wrong place or is dropped. A new `imports` after the property that holds
// the completion, as in an inline template, moves to a line of its own: after
// the trailing comma if the line ends there, or else to the start of the object.
function importsBeforeCompletion(ts, sourceFile, position, actions) {
  if (!sourceFile) return actions;
  const line = offset => sourceFile.getLineAndCharacterOfPosition(offset).line;
  const objectEndingAt = offset => {
    const find = node => {
      if (node.pos > offset || node.end < offset) return undefined;
      if (ts.isObjectLiteralExpression(node) && node.properties.at(-1)?.end === offset) return node;
      return ts.forEachChild(node, find);
    };
    return find(sourceFile);
  };
  const moved = change => {
    const match = IMPORTS_AFTER_PROPERTY.exec(change.newText);
    const {start, length} = change.span;
    if (!match || length !== 0 || start < position || line(start) !== line(position)) return change;
    const object = objectEndingAt(start);
    if (!object) return change;
    const [, newLine, indent] = /^(\r?\n)(.*)$/.exec(match[1]);
    const trailingComma = /^[ \t]*,[ \t]*\r?\n/.exec(sourceFile.text.slice(start));
    if (trailingComma) {
      return {span: {start: start + trailingComma[0].length, length: 0}, newText: `${indent}${match[2]},${newLine}`};
    }
    return {span: {start: object.getStart(sourceFile) + 1, length: 0}, newText: `${newLine}${indent}${match[2]},`};
  };
  return actions.map(action => ({
    ...action,
    changes: action.changes.map(file =>
      file.fileName === sourceFile.fileName ? {...file, textChanges: file.textChanges.map(moved)} : file,
    ),
  }));
}

module.exports = {addAngularLibraries, angularLibraries, importsBeforeCompletion, languageServiceStandIn, withPublicImports};
