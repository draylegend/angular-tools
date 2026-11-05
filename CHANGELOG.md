# Changelog

## Unreleased

- Fixed the TypeScript server crashing in projects that depend on a package whose types are export conditions, such as `@types/ws` 8.18.2.

## 0.23.0 - 2026-11-03

- Added the closing tag after typing `>` of an opening tag in inline `template:` strings.
- Fixed attribute completions showing up right after the closing quote of an attribute value and after `>` of a tag in inline `template:` strings.
- Fixed brackets and quotes not closing right before a tag, such as `{` in `<p>{</p>`, in files of the Angular language and inline `template:` strings.
- Added completion right after `{{`: the members of the component in inline `template:` strings until the first character, and the full list of the Angular Language Server in templates.

## 0.22.0 - 2026-11-03

- Fixed text in inline `template:` strings taking the color of a TypeScript string.
- Fixed a large library hiding a nested Angular project in workspaces of over 50,000 files.
- Added completion of directives that a component does not import yet in libraries that do not use their package, such as `[ngClass]` without any use of `@angular/common`.
- Added the imports of such a completion when it is chosen in an `.html` template, and fixed them naming an internal file such as `@angular/common/types/_common_module-chunk` instead of the package.
- Fixed Zed dropping the new `imports: […]` of such a completion in an inline `template:` string.
- Fixed bindings such as `[ngClass]` completing in inline `template:` strings without `="…"`, with a doubled bracket after an unclosed `[`, and with variants such as `ngClass` that drop a typed `[`.
- Added Tailwind completion for unquoted keys in `[ngClass]="{flex: a}"` and `[class]="{flex: a}"`.

## 0.21.0 - 2026-11-02

- Added the code action "Go to component" in templates of the Angular language.

## 0.20.0 - 2026-11-02

- Added restarts of the Angular Language Server after a crash, up to five times, with the open documents.
- Added text objects for comments, elements and control flow blocks in files of the Angular language.
- Added `editor: wrap selections in tag` in files of the Angular language.
- Added hover for plain HTML tags and attributes, and completion and hover for CSS in `<style>` and `style=""`, in files of the Angular language and in inline `template:` strings.
- Added editing of both tags of an element together in files of the Angular language.
- Fixed `editor: rename` on a plain tag, which offered the name with its angle brackets and then renamed nothing.
- Added the closing tag after typing `>` of an opening tag in files of the Angular language.

## 0.19.0 - 2026-11-02

- Added support for Angular projects in nested folders of a workspace, such as `apps/web` in a monorepo.
- Added updates of the installed Angular Language Server within its major version, at most once a day.
- Added the `angular.*` settings of the official VS Code client under `lsp.angular-tools.settings`, such as `forceStrictTemplates` and inlay hints.
- Changed inlay hints in templates to the defaults of the official client, which turn most of them off.
- Changed the server to get the project's Angular version the way the official client does, which keeps old projects from getting syntax they do not support.
- Fixed the server choice for `catalog:` and `workspace:` versions of `@angular/core`, which now come from the installed package.

## 0.18.0 - 2026-11-02

- Added formatting of files in the Angular language with Prettier's Angular parser, using the project's Prettier and configuration when it has them.
- Added Emmet abbreviations in inline `template:` strings of components.
- Added Tailwind class completion in files of the Angular language.
- Added completion of plain HTML tags and attributes in files of the Angular language and in inline `template:` strings.
- Added Tailwind class completion in bindings such as `[class.flex]`.

## 0.17.0 - 2026-11-01

- Changed the Angular Language Server to the project's own one when its `node_modules` has it, and otherwise to the latest server of the project's Angular major version instead of always 22.2.3.
- Fixed find references on a component member in TypeScript leading to an empty generated `.ngtypecheck.ts` file instead of its uses in templates.

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
