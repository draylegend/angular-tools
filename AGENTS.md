# Development rules

## Commits

- Build the extension in small steps: one commit per concrete change.
- Follow Zed's [publishing prerequisites](https://zed.dev/docs/extensions/publishing/prerequisites) and [license requirements](https://zed.dev/docs/extensions/publishing/license-requirements).
- Write everything in this repository in English.
- Run `npm test` before committing changes to `languages/` or `plugin/`.
- Pushing and publishing to the Zed extension registry need the maintainer's confirmation.

## Versioning

The version follows [semantic versioning](https://semver.org). A commit that changes user-facing behaviour bumps the version in that same commit:

- **New capability — minor**: 0.3.0 → 0.4.0.
- **Fix of existing behaviour — patch**: 0.4.0 → 0.4.1.
- **Incompatible change**: in 0.x a new minor that describes the incompatibility and the migration in the changelog; from 1.0.0 a new major.

Documentation, tests, tooling and refactoring without behaviour changes keep the version.

On a bump, update together `extension.toml`, the package version in `Cargo.toml` and `Cargo.lock`, and add the version to `CHANGELOG.md`: one short line per change in the past tense, like Zed's release notes.
