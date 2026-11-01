# Changelog

## Unreleased

- Changed the Angular Language Server to the project's own one when its `node_modules` has it, and otherwise to the latest server of the project's Angular major version instead of always 22.2.3.

## 0.16.2

- Fixed a hang of the Angular Language Server and of TypeScript features on a template with an unclosed `<script>` or `<style>` tag.
- Fixed selector renames editing files outside the project through a `templateUrl` or a symbolic link.
- Fixed TypeScript rename, references and go to definition failing when a selector lookup hits an error; they now get the regular answer.
- Fixed selector renames and references in a TypeScript file without a tsconfig searching every HTML file in its folder.

## 0.16.1

- Fixed Ctrl-hover in HTML files rereading every TypeScript file of the project; only changed files are read again.
- Fixed selector lookups running in HTML files of projects without Angular.

## 0.16.0

- Added find references for component and directive selectors, so Ctrl-click on a selector string, now underlined on Ctrl-hover, lists every tag and attribute that uses it, including `index.html`.

## 0.15.0

- Changed go to definition on a component tag or directive attribute to open the selector that declares it instead of the class, with the whole name underlined on Ctrl-hover.
- Added go to definition from component tags in HTML pages that host them, such as `index.html`.

## 0.14.1

- Fixed selector renames to also update HTML pages that host a component, such as `index.html`.

## 0.14.0

- Added renaming of component and directive selectors from HTML templates.

## 0.13.0

- Added renaming of component and directive selectors from TypeScript files, updating every template that uses them.

## 0.12.0

- Added the Angular language service to vtsls in Angular projects, so renaming a component member in TypeScript also updates its templates.
- Stopped starting the Angular Language Server for TypeScript files, which vtsls now handles.

## 0.11.0

- Filtered completions by the whole hyphenated name, such as `app-card`, in Angular templates.

## 0.10.1

- Placed the caret after `>` when `/` closes a tag, in Zed builds that support it.

## 0.10.0

- Added closing of unfinished opening tags with `/` in Angular templates.

## 0.9.0

- Added the Angular Language Server to HTML and TypeScript files.

## 0.8.0

- Added the Angular Language Server for completion, diagnostics, hover and navigation in Angular templates.

## 0.7.0

- Added an outline for Angular templates.

## 0.6.0

- Added automatic indentation for Angular templates.

## 0.5.0

- Added CSS and JavaScript highlighting inside Angular templates.

## 0.4.0

- Added autoclosing of brackets and quotes in Angular templates.

## 0.3.0

- Added bracket matching for Angular templates.

## 0.2.0

- Added syntax highlighting for Angular templates.

## 0.1.0

- Added the Angular language for component templates.

## 0.0.0

- Initialized the extension.
