# Angular Tools

Angular support for [Zed](https://zed.dev), built on the official Angular Language Server.

## Templates

Files ending in `.component.html` or `.ng.html` open as **Angular**. For other templates, such as `app.html`, map them in the project's `.zed/settings.json`:

```json
{
  "file_types": { "Angular": ["**/src/**/*.html"] }
}
```

## Language server

The extension installs the official [`@angular/language-server`](https://www.npmjs.com/package/@angular/language-server) with Zed's Node.js and starts it for Angular templates. The server package pins its own TypeScript and `@angular/language-service`.

## Development

In Zed, run `zed: install dev extension` and select this directory.

## License

[MIT](LICENSE)
