# Development rules

## Commits

- Build the extension in small steps: one commit per concrete change.
- Follow Zed's [publishing prerequisites](https://zed.dev/docs/extensions/publishing/prerequisites) and [license requirements](https://zed.dev/docs/extensions/publishing/license-requirements).
- Write everything in this repository in English.
- Keep local paths and names of private projects out of files and commits.
- Add no AI attribution, such as `Co-Authored-By` trailers for AI assistants, to commits or pull requests.
- Write commit messages like Zed: an imperative title, a short body that explains why, and a `Release Notes:` section with one user-facing line per change or `- N/A`.
- Run `npm test` before committing changes to `languages/` or `plugin/`.
- Pushing and publishing to the Zed extension registry need the maintainer's confirmation.
- Propose your own initiatives before acting on them: workarounds, new folders or repositories, moving or deleting files, and changes beyond the requested step wait for the maintainer's answer.

## Consistency

Documents never contradict the behaviour or each other. When a commit adds, changes or removes behaviour, the same commit updates every place that describes it: the `CHANGELOG.md` entry, the commit's release notes, the README and code comments. A removed or replaced behaviour is stated as such, not left implied. Before committing, check every document that mentions the changed behaviour.

A mismatch found in history that is not yet pushed is fixed in the commit that introduced it, so every commit stays consistent on its own. Pushed history is never rewritten; there the fix is a new commit.

## Versioning

The version follows [semantic versioning](https://semver.org). A commit that changes user-facing behaviour bumps the version in that same commit:

- **New capability — minor**: 0.3.0 → 0.4.0.
- **Fix of existing behaviour — patch**: 0.4.0 → 0.4.1.
- **Incompatible change**: in 0.x a new minor that describes the incompatibility and the migration in the changelog; from 1.0.0 a new major.

Documentation, tests, tooling and refactoring without behaviour changes keep the version.

On a bump, update together `extension.toml`, the package version in `Cargo.toml` and `Cargo.lock`, and add the version to `CHANGELOG.md`: one short line per change in the past tense, like Zed's release notes.
