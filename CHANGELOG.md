# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [2.0.0] - 2026-08-08

A generator that only scaffolded now also maintains: `update` re-renders tooling
in projects it created, and `config` remembers your answers between runs. Most of
the release is new choices about what a generated project contains, and the
machinery to keep those choices honest.

### Breaking

- **Node 24 is now the floor for the generator itself** (`engines.node: ">=24"`,
  was `">=22"`). Generated projects target Node 24 by default and are CI-tested
  on 24 and 26.
- **`ScaffoldConfig` is a complete required shape**, grown from 8 fields to 16.
  Callers building the object as a literal will not typecheck. Use the new
  `defaultScaffoldConfig(overrides?)` factory and override only what you care
  about:

  ```ts
  import { defaultScaffoldConfig, scaffoldProject } from "@hbmartin/create-ts-lib";

  const config = defaultScaffoldConfig({ projectName: "my-lib", license: "MIT" });
  ```

  `undefined` override values are ignored rather than overwriting a default.
- **Generated projects use [fallow](https://www.npmjs.com/package/fallow)
  instead of dependency-cruiser** for the architecture gate. `.dependency-cruiser.cjs`
  is no longer emitted; `.fallowrc.jsonc` takes its place, and `deps:lint` runs
  `fallow dead-code`.
- **Generated toolchain moved forward**: TypeScript 7, Biome 2.5, and a
  `@types/node` pin that now tracks the project's own Node target instead of
  being fixed at `^22`.
- **`zod` is now a runtime dependency** of the generator, used to validate state
  files, personal config, and `gh` responses.

### Added

- **`update` command** — re-renders generated tooling in an existing project and
  applies template improvements, skipping files you have modified. Supports
  `--dry-run`, `--force`, `--yes`, `--no-backup`, and `--remove-orphans`.
  Overwrites leave a `<file>.orig` backup by default.
- **`.create-ts-lib.json` state file** — every scaffold records its full config
  plus a SHA-256 hash of each generated file, which is what lets `update`
  distinguish untouched files from ones you edited.
- **`--remove-orphans`** — with `--force`, deletes unmodified files the templates
  no longer generate. Symlinks are resolved and containment-checked before any
  read or delete.
- **`config` command** — manages personal defaults at
  `$XDG_CONFIG_HOME/create-ts-lib/config.json`, with `config path`, `config get [key]`,
  `config set <key> <value>`, and `config unset <key>`. Also `--save-defaults` to
  store a run's answers and `--config <path>` to relocate the file.
- **Workspace mode** (`--[no-]workspace`) — scaffolds a package inside an existing
  workspace, leaving root-owned files (git ignore, CI workflows, Renovate, editor
  settings, hooks, the workspace manifest) to the parent repository. Nothing
  outside the target directory is written.
- **A full non-interactive flag surface.** Previously only `--yes`, `--dry-run`,
  and `--force`; now every answer has a flag: `--name`, `--description`,
  `--author`, `--license`, `--repo-url`, `--package-manager`, `--lint-format`,
  `--bundler`, `--node-target`, `--[no-]cli`, `--[no-]codecov`,
  `--[no-]community-files`, `--[no-]zod`, `--[no-]jsr`,
  `--[no-]security-workflows`, `--skip-git`, and `--skip-install`.
- **GitHub repository automation** — interactive mode looks up a matching personal
  repo with `gh` while you answer the remaining prompts, offers to create a public
  or private repo when none exists, and wires the `origin` remote. Never offered
  in workspace mode, where the parent repository already owns the remote.
- **npm name availability check** — warns when the chosen package name is already
  taken and lets you rename or continue.
- **New generated-project options**: Zod (`--zod`), JSR publishing (`--jsr`,
  emits `jsr.json`), a `tsdown` bundler build (`--bundler tsdown`), Biome as an
  alternative to Oxlint + Oxfmt (`--lint-format biome`), community files
  (`--community-files`, emits `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md`,
  `SECURITY.md`), security workflows (`--security-workflows`, emits CodeQL and
  Scorecard), and a configurable Node target (`--node-target 24|26`).
- Generated projects also now receive `.vscode/extensions.json`,
  `.vscode/settings.json`, `renovate.json`, and a `test/cli.test.ts` covering the
  generated CLI entry point.
- **Golden-file coverage** for generated output across five configuration
  permutations, so any change to what a project contains shows up as a reviewable
  diff.
- **`docs/`** — `extending-the-generator.md`, `checks-and-tests.md`, and
  `generated-project-tour.md`, with `AGENTS.md` and `CLAUDE.md` routing to them.

### Fixed

- **Feature answers no longer silently do nothing.** Codecov and the security
  workflows are carried by files that `hasGitHubWorkflows` can suppress — in
  workspace mode, without a repo URL, and for non-pnpm projects — so the CLI could
  report `Codecov: yes` for a project with no workflow at all. Activation
  conditions are now declared per answer in `source/templates/feature-activation.ts`,
  reporting reads that declaration instead of re-deriving it, and a matrix test
  fails both an answer declared live that changes nothing and one declared inert
  that changes something.
- Workspace mode no longer offers GitHub repo creation or prints next steps for
  work it skipped.
- `buildProjectFiles` is pure again: `copyrightYear` is recorded in
  `ScaffoldConfig` at scaffold time, so re-running `update` in a later year keeps
  the original year rather than rewriting the LICENSE.
- Update-only options passed to a scaffold run are now rejected rather than
  silently ignored.
- Schema defaults are applied instead of rendering as `undefined` in generated
  output.
- State-file `files` keys are unvalidated strings that `update` turns into
  deletion paths; they are now containment-checked rather than trusted through
  `resolve`.
- `.git` suffixes are stripped correctly from repository URLs, and `git+ssh://`,
  `ssh://`, and `git://` remotes normalize to HTTPS.

### Changed

- Generated action pins are bumped and propagated to generated projects, with a
  test asserting the generator and its templates cannot drift apart.
- Generated dependency versions are centralized in
  `source/templates/generated-versions.ts` and read from the generator's own
  `package.json`, so Renovate updates both at once.
- `verify:artifacts` moved from an inline `node -e` to
  `scripts/verify-artifacts.mjs`, deriving its template list from
  `source/templates/assets/**` so new `.tmpl` files are covered automatically.

### Migration

Projects scaffolded by 1.x have no `.create-ts-lib.json`, so `update` cannot run
against them — it needs the recorded config and per-file hashes to tell your edits
from generated content. Scaffold a fresh project and port changes across, or
hand-write a state file matching `source/templates/state.ts`.

## [1.1.0] - 2026-06-07

### Added

- Release workflow publishing to npm with provenance, plus `verify:artifacts`,
  `verify:package`, `size:report`, and `types:lint` scripts.
- Generated `AGENTS.md` guidance.
- A real generated-project smoke check that scaffolds, installs, and runs the
  generated project's own release checks.
- Semgrep security linting with a `uvx` fallback, wired into `check` for both the
  generator and generated projects.

### Fixed

- Git remote URLs normalize to HTTPS across `git+ssh://`, `ssh://`, and `git://`
  forms.

## [1.0.1] - 2026-06-07

### Added

- `--force` and non-empty target directory protection.
- npm package-name validation across prompts, `--yes`, and the programmatic API.
- Generated projects receive README content, release scripts,
  `@arethetypeswrong/cli`, and a release workflow.

### Changed

- All pnpm pins normalized to 11.5.2; generated CI is emitted only for pnpm
  projects.
- GitHub Actions pinned by commit SHA.

### Fixed

- Fallback prompts throw `Input stream closed` on EOF instead of treating it as
  empty input.

## [1.0.0] - 2026-03-17

Initial release.

- Interactive and `--yes` scaffolding of an opinionated, ESM-only TypeScript
  library with Vitest, Lefthook, Biome, Oxlint, and Oxfmt.
- Templates under `source/templates/assets`, pinned workflow actions, and
  `--dry-run` with scaffold summaries and progress reporting.

[2.0.0]: https://github.com/hbmartin/create-ts-lib/compare/1.1.0...2.0.0
[1.1.0]: https://github.com/hbmartin/create-ts-lib/compare/1.0.1...1.1.0
[1.0.1]: https://github.com/hbmartin/create-ts-lib/compare/1.0.0...1.0.1
[1.0.0]: https://github.com/hbmartin/create-ts-lib/releases/tag/1.0.0
