// A tsserver plugin for Angular selectors. Load it after
// @angular/language-service, so it wraps the Angular-aware language service.
// It answers rename on selector names, and go to definition on tags and
// attributes in inline templates, which leads to the declaring selector string
// instead of the class. Every other request passes through.
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
    const selectorRename = (fileName, position) => {
      const target = targetAt(project, fileName, position);
      const locations = target && renameLocations(project, target);
      return locations && {target, locations};
    };

    const selectorDefinition = (fileName, position) => {
      const target = targetAt(project, fileName, position);
      if (!target || target.source !== 'template') return undefined;
      const locations = selectorLocations(project, target);
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
      const rename = selectorRename(fileName, position);
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
      const rename = selectorRename(fileName, position);
      if (!rename) return service.findRenameLocations(fileName, position, ...rest);
      return rename.locations.map(location => ({
        fileName: location.fileName,
        textSpan: {start: location.start, length: location.end - location.start},
      }));
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
