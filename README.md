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

The extension installs the official [`@angular/language-server`](https://www.npmjs.com/package/@angular/language-server) with Zed's Node.js. The server package pins its own TypeScript and `@angular/language-service`.

Like the official VS Code client, the server starts for every HTML file, so external templates work without any settings. In projects without `@angular/core` the server turns itself off.

In TypeScript files, Zed's TypeScript server vtsls does the work: in Angular projects the extension loads the same `@angular/language-service` into it as a tsserver plugin. Inline templates get completion, diagnostics and navigation, and renaming a component member also updates its templates.

The official language service does not rename selectors, so the extension adds its own small tsserver plugin: renaming `app-card` or `[app-highlight]` in a `selector` string or in a template updates the selector and every matching tag or attribute in all templates and other HTML files of the project, such as `index.html`. In HTML templates a small proxy in front of the server answers these renames.

## Development

In Zed, run `zed: install dev extension` and select this directory.

The tests check the queries against the grammar that the dev install checks out into `grammars/angular`, and the selector rename module:

```sh
npm install
npm test
```

## License

[MIT](LICENSE)
