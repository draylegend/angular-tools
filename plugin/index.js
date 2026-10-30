// A tsserver plugin for Angular selectors. Load it after
// @angular/language-service, so it wraps the Angular-aware language service.
// It answers rename and find references on selector names, and go to
// definition on them: from a tag or attribute in an inline template it leads
// to the declaring selector string instead of the class, and a selector string
// is its own definition, like any declaration, so the editor underlines it and
// shows its references on click. Every other request passes through.
'use strict';

const {findFiles, renameLocations, selectorLocations, targetAt} = require('./selector-rename.js');

function init({typescript: ts}) {
  function create(info) {
    const service = info.languageService;
    const host = info.languageServiceHost;
    const project = {
      ts,
      sourceFiles: () =>
        (service.getProgram()?.getSourceFiles() ?? []).filter(
          file => !file.isDeclarationFile && !file.fileName.includes('/node_modules/'),
        ),
      readFile: fileName => {
        const snapshot = host.getScriptSnapshot?.(fileName);
        if (snapshot) return snapshot.getText(0, snapshot.getLength());
        return (host.readFile ?? ts.sys.readFile)(fileName);
      },
      htmlFiles: () => findFiles([info.project.getCurrentDirectory()], '.html'),
    };
    // Every use of the selector name at a position: selector strings, tags and
    // attributes in templates and in HTML pages.
    const selectorUses = (fileName, position) => {
      const target = targetAt(project, fileName, position);
      const locations = target && renameLocations(project, target);
      return locations && {target, locations};
    };

    const selectorDefinition = (fileName, position) => {
      const target = targetAt(project, fileName, position);
      if (!target) return undefined;
      const locations = target.source === 'selector' ? [target] : selectorLocations(project, target);
      if (!locations.length) return undefined;
      const definitions = locations.map(location => ({
        fileName: location.fileName,
        textSpan: {start: location.start, length: location.end - location.start},
        kind: ts.ScriptElementKind.string,
        name: target.name,
        containerKind: ts.ScriptElementKind.unknown,
        containerName: '',
      }));
      return {definitions, textSpan: {start: target.start, length: target.end - target.start}};
    };

    const proxy = Object.create(null);
    for (const key of Object.keys(service)) proxy[key] = (...args) => service[key](...args);

    proxy.getRenameInfo = (fileName, position, ...rest) => {
      const rename = selectorUses(fileName, position);
      if (!rename) return service.getRenameInfo(fileName, position, ...rest);
      const {target} = rename;
      return {
        canRename: true,
        displayName: target.name,
        fullDisplayName: target.name,
        kind: ts.ScriptElementKind.string,
        kindModifiers: '',
        triggerSpan: {start: target.start, length: target.end - target.start},
      };
    };

    proxy.findRenameLocations = (fileName, position, ...rest) => {
      const rename = selectorUses(fileName, position);
      if (!rename) return service.findRenameLocations(fileName, position, ...rest);
      return rename.locations.map(location => ({
        fileName: location.fileName,
        textSpan: {start: location.start, length: location.end - location.start},
      }));
    };

    const span = location => ({start: location.start, length: location.end - location.start});

    proxy.getReferencesAtPosition = (fileName, position, ...rest) => {
      const uses = selectorUses(fileName, position);
      if (!uses) return service.getReferencesAtPosition(fileName, position, ...rest);
      return uses.locations.map(location => ({fileName: location.fileName, textSpan: span(location), isWriteAccess: false}));
    };

    proxy.findReferences = (fileName, position, ...rest) => {
      const uses = selectorUses(fileName, position);
      if (!uses) return service.findReferences(fileName, position, ...rest);
      const {target, locations} = uses;
      const [declaration] = selectorLocations(project, target);
      const definition = {
        fileName: declaration.fileName,
        textSpan: span(declaration),
        kind: ts.ScriptElementKind.string,
        name: target.name,
        containerKind: ts.ScriptElementKind.unknown,
        containerName: '',
        displayParts: [{text: target.name, kind: 'text'}],
      };
      const references = locations.map(location => ({fileName: location.fileName, textSpan: span(location), isWriteAccess: false}));
      return [{definition, references}];
    };

    proxy.getDefinitionAndBoundSpan = (fileName, position, ...rest) =>
      selectorDefinition(fileName, position) ?? service.getDefinitionAndBoundSpan(fileName, position, ...rest);

    proxy.getDefinitionAtPosition = (fileName, position, ...rest) =>
      selectorDefinition(fileName, position)?.definitions ?? service.getDefinitionAtPosition(fileName, position, ...rest);

    return proxy;
  }

  return {create};
}

module.exports = init;
