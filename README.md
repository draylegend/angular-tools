# Angular Tools

Angular support for [Zed](https://zed.dev), built on the official Angular Language Server.

## Templates

Files ending in `.component.html` or `.ng.html` open as **Angular** and get Angular syntax highlighting. Other templates, such as `app.html`, open as HTML: the language server works there too, but Zed picks a language by file name only. For Angular highlighting in them, map them in the project's `.zed/settings.json`:

```json
{
  "file_types": { "Angular": ["**/src/**/*.html"] }
}
```

## Language server

The extension installs the official [`@angular/language-server`](https://www.npmjs.com/package/@angular/language-server) with Zed's Node.js. The server package pins its own TypeScript and `@angular/language-service`.

Like the official VS Code client, the server starts for every HTML and TypeScript file, so external templates, inline templates and components work without any settings. In projects without `@angular/core` the server turns itself off.

## Development

In Zed, run `zed: install dev extension` and select this directory.

## License

[MIT](LICENSE)
