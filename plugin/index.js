// A tsserver plugin for Angular selectors. Load it after
// @angular/language-service, so it wraps the Angular-aware language service.
// It answers rename and find references on selector names, and go to
// definition on them: from a tag or attribute in an inline template it leads
// to the declaring selector string instead of the class, and a selector string
// is its own definition, like any declaration, so the editor underlines it and
// shows its references on click. Every other request passes through, and so
// does any request this plugin fails to answer.
'use strict';

const {addAngularLibraries, importsBeforeCompletion, withPublicImports} = require('./angular-imports.js');
const {containedIn, findFiles, renameLocations, selectorLocations, targetAt} = require('./selector-rename.js');

// The snippet of an Angular binding or attribute, such as `[ngClass]="$1"`.
const BINDING_SNIPPET = /^[[(]*[\w.@$-]+[\])]*="\$1"$/;

function init({typescript: ts}) {
  function create(info) {
    const service = info.languageService;
    const host = info.languageServiceHost;
    // HTML files are searched in the folder of the project's tsconfig. A
    // project without one, such as a single file opened on its own, has no
    // folder that bounds the search, so it gets none.
    const configured = info.project.projectKind === ts.server.ProjectKind.Configured;
    const roots = configured ? [info.project.getCurrentDirectory()] : [];
    // Directives of the libraries that the project depends on complete even
    // where nothing in the program uses these libraries yet.
    if (configured) addAngularLibraries(info.project);

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
      htmlFiles: () => findFiles(roots, '.html'),
      contains: containedIn(roots),
    };

    // Runs a selector lookup; on any error the request goes to the wrapped
    // language service as if the plugin were not there.
    const attempt = lookup => {
      try {
        return lookup();
      } catch (error) {
        info.project.projectService.logger.info(`angular-tools: ${error.stack ?? error}`);
        return undefined;
      }
    };

    // Every use of the selector name at a position: selector strings, tags and
    // attributes in templates and in HTML pages.
    const selectorUses = (fileName, position) =>
      attempt(() => {
        const target = targetAt(project, fileName, position);
        const locations = target && renameLocations(project, target);
        return locations && {target, locations};
      });

    const selectorDefinition = (fileName, position) =>
      attempt(() => {
        const target = targetAt(project, fileName, position);
        if (!target) return undefined;
        const locations = target.source === 'selector' ? [target] : selectorLocations(project, target);
        if (!locations.length) return undefined;
        const definitions = locations.map(location => ({
          fileName: location.fileName,
          textSpan: span(location),
          kind: ts.ScriptElementKind.string,
          name: target.name,
          containerKind: ts.ScriptElementKind.unknown,
          containerName: '',
        }));
        return {definitions, textSpan: span(target)};
      });

    const span = location => ({start: location.start, length: location.end - location.start});

    // The Angular language service maps uses in templates back to the
    // templates only in getReferencesAtPosition. findReferences, which
    // tsserver answers find references with, leaves them in the generated
    // type-check file, such as `home.ngtypecheck.ts`, so they are replaced
    // with the mapped ones.
    const isTypeCheckFile = fileName => fileName.endsWith('.ngtypecheck.ts');
    const templateReferences = (fileName, position, symbols) =>
      attempt(() => {
        if (!symbols?.some(symbol => symbol.references.some(reference => isTypeCheckFile(reference.fileName)))) {
          return symbols;
        }
        const key = reference => `${reference.fileName}:${reference.textSpan.start}`;
        const result = symbols
          .map(symbol => ({...symbol, references: symbol.references.filter(reference => !isTypeCheckFile(reference.fileName))}))
          .filter(symbol => symbol.references.length);
        const known = new Set(result.flatMap(symbol => symbol.references.map(key)));
        const mapped = (service.getReferencesAtPosition(fileName, position) ?? []).filter(
          reference => !isTypeCheckFile(reference.fileName) && !known.has(key(reference)),
        );
        if (!result.length || !mapped.length) return result;
        result[0] = {...result[0], references: [...result[0].references, ...mapped]};
        return result;
      }) ?? symbols;

    const proxy = Object.create(null);
    for (const key of Object.keys(service)) proxy[key] = (...args) => service[key](...args);

    const publicActions = actions => withPublicImports(actions, [info.project.getCurrentDirectory()]);

    // TypeScript reads includeInsertTextCompletions, which vtsls sends, as
    // includeCompletionsWithInsertText, but the Angular service reads only the
    // latter, so without it bindings complete without `="…"`. Before an
    // unclosed `[` or `(`, the service leaves the name to be replaced, and a binding
    // such as `[ngClass]="…"` would double the bracket, so the span takes it in.
    // A variant that does not start with the typed brackets, such as the
    // attribute `ngClass="…"` after `[ngc`, would remove them. Clients that
    // filter by the whole span, as VS Code does, hide it, and Zed, which
    // filters by the word, gets it no more.
    proxy.getCompletionsAtPosition = (fileName, position, options, ...rest) => {
      const withInsertText = options && {
        ...options,
        includeCompletionsWithInsertText: options.includeCompletionsWithInsertText || options.includeInsertTextCompletions,
      };
      const completions = service.getCompletionsAtPosition(fileName, position, withInsertText, ...rest);
      if (!completions) return completions;
      return (
        attempt(() => {
          const text = project.readFile(fileName);
          if (text === undefined) return completions;
          const entries = completions.entries.flatMap(entry => {
            if (!entry.isSnippet || !BINDING_SNIPPET.test(entry.insertText ?? '')) return [entry];
            const word = /[\w.@$-]*$/.exec(text.slice(0, position))[0];
            const span = entry.replacementSpan ?? {start: position - word.length, length: word.length};
            const opening = /[[(]*$/.exec(text.slice(0, span.start))[0];
            const start = span.start - opening.length;
            const typed = /^[[(]*/.exec(text.slice(start, position))[0];
            if (!entry.insertText.startsWith(typed)) return [];
            if (!opening) return [entry];
            return [{...entry, replacementSpan: {start, length: span.length + opening.length}}];
          });
          return {...completions, entries};
        }) ?? completions
      );
    };

    proxy.getCompletionEntryDetails = (fileName, position, ...rest) => {
      const details = service.getCompletionEntryDetails(fileName, position, ...rest);
      if (!details?.codeActions) return details;
      return (
        attempt(() => {
          const sourceFile = service.getProgram()?.getSourceFile(fileName);
          const codeActions = importsBeforeCompletion(ts, sourceFile, position, publicActions(details.codeActions));
          return {...details, codeActions};
        }) ?? details
      );
    };

    proxy.getCodeFixesAtPosition = (...args) => {
      const fixes = service.getCodeFixesAtPosition(...args);
      return attempt(() => publicActions(fixes)) ?? fixes;
    };

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
        triggerSpan: span(target),
      };
    };

    proxy.findRenameLocations = (fileName, position, ...rest) => {
      const rename = selectorUses(fileName, position);
      if (!rename) return service.findRenameLocations(fileName, position, ...rest);
      return rename.locations.map(location => ({fileName: location.fileName, textSpan: span(location)}));
    };

    proxy.getReferencesAtPosition = (fileName, position, ...rest) => {
      const uses = selectorUses(fileName, position);
      if (!uses) return service.getReferencesAtPosition(fileName, position, ...rest);
      return uses.locations.map(location => ({fileName: location.fileName, textSpan: span(location), isWriteAccess: false}));
    };

    proxy.findReferences = (fileName, position, ...rest) => {
      const uses = selectorUses(fileName, position);
      if (!uses) return templateReferences(fileName, position, service.findReferences(fileName, position, ...rest));
      const {target, locations} = uses;
      const [declaration] = locations;
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
