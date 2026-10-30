# Changelog

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
