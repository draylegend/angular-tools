# Angular Tools

Angular support for [Zed](https://zed.dev), built on the official Angular Language Server.

## Templates

Files ending in `.component.html` or `.ng.html` open as **Angular**. For other templates, such as `app.html`, map them in the project's `.zed/settings.json`:

```json
{
  "file_types": { "Angular": ["**/src/**/*.html"] }
}
```

## Development

In Zed, run `zed: install dev extension` and select this directory.

## License

[MIT](LICENSE)
