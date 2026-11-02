# Angular Tools

Angular support for [Zed](https://zed.dev), built on the official Angular Language Server.

## Templates

Files ending in `.component.html` or `.ng.html` open as **Angular** and get Angular syntax highlighting. Other templates, such as `app.html`, open as HTML: the language server works there too, but Zed picks a language by file name only. For Angular highlighting in them, map them in the project's `.zed/settings.json`:

```json
{
  "file_types": { "Angular": ["**/src/**/*.html"] }
}
```

Typing `/` at the end of an unfinished opening tag closes it: `<app-card` becomes `<app-card/>`. The caret ends up after `>` in Zed builds that support the `cursor_after_end` bracket option and before it in others.

## Language server

The extension runs the official [`@angular/language-server`](https://www.npmjs.com/package/@angular/language-server) with Zed's Node.js. When the project has its own server in `node_modules`, that one runs with the project's TypeScript and `@angular/language-service`. Otherwise the extension installs the latest server of the project's Angular major version, read from `@angular/core` in `package.json`, and runs it with its own `@angular/language-service` and the project's TypeScript. Projects on Angular 10 or older, or with a version that names no number, get server 22. Each major version is installed once and kept, so projects on different Angular versions work side by side.

Like the official VS Code client, the server starts for every HTML file, so external templates work without any settings. In projects without `@angular/core` the server turns itself off.

In TypeScript files, Zed's TypeScript server vtsls does the work: in Angular projects the extension loads the `@angular/language-service` of the installed server for the project's Angular version into it as a tsserver plugin. Inline templates get completion, diagnostics and navigation, and renaming a component member also updates its templates. Find references on a member lists its uses in templates; the Angular plugin alone would point them into its generated `.ngtypecheck.ts` files, so the extension's plugin maps them back.

Emmet works in inline `template:` strings too. The Emmet extension does not cover TypeScript files, so the extension runs its own [`@olrtg/emmet-language-server`](https://www.npmjs.com/package/@olrtg/emmet-language-server) for them in Angular projects, behind a proxy that answers only inside these strings. In `.html` files Emmet still comes from the Emmet extension.

The official language service does not rename selectors, so the extension adds its own small tsserver plugin: renaming `app-card` or `[app-highlight]` in a `selector` string or in a template updates the selector and every matching tag or attribute in all templates and other HTML files of the project, such as `index.html`. Files outside the project, including targets of symbolic links and of a `templateUrl` that points elsewhere, are never read or edited. In HTML templates a small proxy in front of the server answers these renames; in projects without `@angular/core` it only passes messages through.

Ctrl-click on a component tag or a directive attribute opens the selector that declares it, such as `selector: 'app-card'`, in templates and in HTML pages that host a component, such as `index.html`. The server would open the class and does not know such pages, so the proxy and the plugin answer these requests.

Find references on a selector name lists the selector string and every tag or attribute that uses it, again including pages such as `index.html`. A selector string is its own definition, like any declaration: Ctrl-hover underlines it and Ctrl-click shows these references.

## Compatibility

Install either Angular Tools or the **Angular** extension (`angular`) from the Zed extension registry, not both. Both register a language named `Angular` and a grammar named `angular`, and Zed keeps only one of each, so highlighting and `/` closing depend on which extension loaded last. Both also start an Angular Language Server, so completions and diagnostics in templates would appear twice.

## Development

In Zed, run `zed: install dev extension` and select this directory.

The tests check the queries against the grammar that the dev install checks out into `grammars/angular`, the selector rename module, the tsserver plugin and the proxy:

```sh
npm install
npm test
```

## License

[MIT](LICENSE)
