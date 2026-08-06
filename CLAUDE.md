# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

`@hbmartin/create-ts-lib` is an opinionated scaffolder that generates TypeScript library projects. Node 22+, ESM-only, pnpm. Almost every change here changes _someone else's_ generated project, which drives most of the conventions below.

## Commands

```bash
pnpm run check          # lint + typecheck + deps:lint + security:lint + test:coverage (CI order)
pnpm run release:check  # check + build + verify:artifacts + publint + types:lint + verify:package

pnpm run lint           # biome check --error-on-warnings + oxlint --deny-warnings + oxfmt --check
pnpm run format         # oxfmt . --write
pnpm run typecheck      # tsc -p tsconfig.typecheck.json --noEmit (source + test)
pnpm run deps:lint      # fallow dead-code — architecture gate, config in .fallowrc.jsonc
pnpm run security:lint  # semgrep against semgrep.yml (falls back to uvx semgrep@<pinned>)
pnpm run build          # tsc + recursive copy of source/templates/assets → dist/templates/assets
pnpm run smoke:scaffold # build, scaffold real projects in a temp dir, install, run their checks
```

Single test file / single case:

```bash
pnpm exec vitest run test/scaffold.test.ts
pnpm exec vitest run test/scaffold.test.ts -t "generates a README"
pnpm exec vitest run test/generated-output-snapshot.test.ts -u   # accept golden-file changes
```

`smoke:scaffold` variants are env-driven: `SMOKE_INCLUDE_CLI`, `SMOKE_LINT_FORMAT` (`biome`), `SMOKE_BUNDLER` (`tsdown`), `SMOKE_PACKAGE_MANAGER`, `SMOKE_DIR`. Coverage thresholds are 90% (branches/functions/lines/statements) over `source/**`.

## Architecture

The generator is a pure function from config to file list, plus a thin writer:

1. **Collect config** — `source/cli.ts` parses argv via `source/cli-helpers.ts`, merges personal defaults (`source/user-config.ts`) with values detected from git config and the target directory name, then either takes `--yes` values or prompts (`source/cli-prompts.ts`, `source/prompts.ts`) to produce a `ScaffoldConfig` (`source/templates/scaffold-config.ts`).
2. **Render** — `buildProjectFiles(config)` in `source/templates/files.ts` returns `GeneratedFile[]` (`{ path, content, executable? }`). This is the single place that decides which files a project gets. It must stay a **pure function of its config** — no clock, no filesystem probing, no env. `copyrightYear` lives in the config for exactly this reason.
3. **Write** — `scaffoldProject` (`source/scaffold.ts`) writes the list, then runs post-scaffold steps (git init, remote, install, build, test), each wrapped in `PostScaffoldSetupError` carrying the failing step so the CLI can print targeted recovery.

Three commands share this pipeline: `scaffold` (default), `update`, and `config`. `source/index.ts` is the deliberate public API — export from it intentionally.

### Templates

Static files are `*.tmpl` assets under `source/templates/assets/`, copied verbatim into `dist/` by `scripts/build.mjs` (recursive copy — new `.tmpl` files need no wiring). `renderTemplate(path, replacements)` substitutes `{{KEY}}` and **throws on any unresolved `{{...}}`**, so a typo'd key fails loudly rather than shipping a literal placeholder. Content needing real logic (`package.json`, README, CI workflows, biome config, community files) is assembled by `build*` / `render*` functions in sibling modules under `source/templates/`.

### The state file and `update`

Every scaffold writes `.create-ts-lib.json` (`source/templates/state.ts`): the full config plus a SHA-256 hash of each generated file. `create-ts-lib update` (`source/update.ts`) re-renders from the stored config and classifies each file: `up-to-date`, `update` (disk matches the recorded hash → safe to overwrite), `create` (absent), `skip-modified` (user edited it → only with `--force`, and then a `.orig` backup is kept).

This makes the state schema a **compatibility surface**: projects on disk carry state files written by older releases.

### Version pinning for generated projects

`source/templates/generated-versions.ts` is the single source of truth for versions in generated projects. Most specifiers are read out of this repo's own `package.json`, so the generator and its output stay aligned. Two exceptions are pinned inline as "template-only" because this repo neither imports nor runs them (`meow`, `jsr`, `tsdown`, `@types/node`) — `@types/node` must stay on the same major as the generated `engines.node` floor. `githubActionRefs` holds SHA-pinned action refs; `test/workflow-action-refs.test.ts` fails when this repo's own workflows drift from it, because Renovate updates `.github/workflows/**` but cannot see the generated copies.

### Workspace mode

`config.workspaceMode` means "scaffold a package inside an existing repo": root-owned files (`.gitignore`, lefthook, Renovate, VS Code settings, `pnpm-workspace.yaml`) are skipped via the `rootOwnedFiles` helper, and git setup is left to the parent. `source/workspace-detection.ts` auto-detects a workspace root; it deliberately does **not** treat `packages: ["."]` as a workspace, since that is what this generator emits for standalone pnpm projects. Nothing outside the target directory is ever written.

## Invariants worth knowing before you edit

**Adding a `ScaffoldConfig` field** (all four steps, in `CONTRIBUTING.md` too):

1. Field on `ScaffoldConfig` + `defaultScaffoldConfigValues` in `source/templates/scaffold-config.ts`.
2. Entry in `scaffoldConfigSchema` (`source/templates/state.ts`) **with `.default()`** — non-negotiable. A field without a default breaks `update` for every project already on disk. `test/state-compatibility.test.ts` enforces this against deliberately stale fixtures in `test/__fixtures__/state/`; never regenerate those fixtures to silence a failure.
3. If it is a reusable preference (not a per-project answer), add it to `userConfigSchema` **and** the `userConfigValueParsers` table beside it in `source/user-config.ts` — the table is typed so a missing entry fails to compile.
4. CLI flag in `source/cli-helpers.ts` **and** a line in `helpText` in `source/cli.ts`; `test/cli.test.ts` fails on any parsed option that is undocumented.

**Adding a generated file:** register it in `buildProjectFiles`, and if the published package needs it at runtime, make sure `scripts/verify-artifacts.mjs` covers it (it derives the asset list from `source/templates/assets/**`, so `.tmpl` files are automatic; compiled entry points are a hand-listed array).

**Biome's `noNodejsModules` / `noProcessEnv` / `noConsole` are errors by default**, switched off only for a hand-maintained file list in the last `overrides` block of `biome.jsonc` (plus `source/templates/**` and `scripts/**`). A new module outside `source/templates/` that imports a `node:` builtin must be added there or `pnpm run lint` fails.

**Formatting is oxfmt; linting is Biome + oxlint. Do not add Prettier.** JSON/JSONC/YAML are excluded from Biome to avoid ownership conflicts with oxfmt. `source/templates/assets` is excluded from Biome entirely (templates are not valid standalone sources).

**The architecture gate has a canary.** `test/architecture-gate.test.ts` runs the real generated `.fallowrc.jsonc` against temp fixtures containing deliberate violations (source→test import, cycle, unresolved import, undeclared dep, dev dep in production, unused dev dep) plus a clean control case. This exists because the gate has twice reported success while analysing nothing. If you touch `.fallowrc.jsonc` or its template, keep those tests meaningful rather than adjusting them to pass.

**Use Zod for runtime validation** of anything external (state files, user config).

## Tests

`test/` mirrors `source/`, with a few cross-cutting guards: `architecture-gate`, `state-compatibility`, `workflow-action-refs`, `security-lint`, `generated-output-snapshot`.

Generated output is verified two ways, and a change to templates usually touches both:

- **Structural assertions** (`test/scaffold.test.ts`, and most others) — call `buildProjectFiles(config)`, find the file, assert the specific lines or fields that matter. This is the primary style; prefer it for new behavior.
- **Golden files** (`test/generated-output-snapshot.test.ts` → `test/__snapshots__/generated-output/*.snap`) — five whole-project configs serialized end to end, so unintended output drift shows up in the diff. The generator version inside the state file is redacted so version bumps don't churn them. Update with `-u` and read the diff.

(`CONTRIBUTING.md` still describes the structural style as the only approach; the golden files are newer.)

## Keep docs in sync with generated output

When generated output changes, update in the same change: `README.md` (flags, prompt flow, generated layout, defaults), `docs/generated-project-tour.md` (per-file walkthrough of what gets scaffolded), and `AGENTS.md` if the guidance for agents shifts. `AGENTS.md` is the Codex-facing sibling of this file.
