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

The version follows [semantic versioning](https://semver.org) and names a release: what users install from the Zed extension registry.

A commit that adds, changes or removes user-facing behaviour keeps the version and adds one line to the `## Unreleased` section at the top of `CHANGELOG.md`, in the past tense, like Zed's release notes. Documentation, tests, tooling and refactoring without behaviour changes add nothing.

A release is its own commit, made only when the maintainer asks for it. The most significant change in `Unreleased` sets the version:

- **New capability — minor**: 0.16.2 → 0.17.0.
- **Only fixes of existing behaviour — patch**: 0.16.2 → 0.16.3.
- **Incompatible change**: in 0.x a new minor that describes the incompatibility and the migration in the changelog; from 1.0.0 a new major.

The release commit updates together `extension.toml`, the package version in `Cargo.toml` and `Cargo.lock`, and renames `## Unreleased` to `## X.Y.Z - YYYY-MM-DD`. It gets the tag `vX.Y.Z` and a GitHub release with the same changelog section.

Versions 0.0.0 to 0.16.2 were numbered per change before the first release. They stay in the changelog as history and have no tags.
