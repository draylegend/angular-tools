// A tsserver plugin that renames Angular selectors. Load it after
// @angular/language-service, so it wraps the Angular-aware language service
// and only answers rename requests on selector names.
'use strict';

const {findFiles, renameLocations, targetAt} = require('./selector-rename.js');

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

    return proxy;
  }

  return {create};
}

module.exports = init;
