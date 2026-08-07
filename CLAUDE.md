# CLAUDE.md

`@hbmartin/create-ts-lib` is an opinionated scaffolder that generates TypeScript library projects. Node 24+, ESM-only, pnpm. Almost every change here changes _someone else's_ generated project, which drives the invariants below.

## Architecture

The generator is a pure function from config to file list, plus a thin writer:

1. **Collect** — `source/cli.ts` parses argv via `source/cli-helpers.ts`, merges personal defaults (`source/user-config.ts`) with values detected from git config and the target directory name, then either takes `--yes` values or prompts (`source/cli-prompts.ts`, `source/prompts.ts`) to produce a `ScaffoldConfig` (`source/templates/scaffold-config.ts`).
2. **Render** — `buildProjectFiles(config)` in `source/templates/files.ts` returns `GeneratedFile[]` (`{ path, content, executable? }`). This is the single place that decides which files a project gets.
3. **Write** — `scaffoldProject` (`source/scaffold.ts`) writes the list, then runs post-scaffold steps (git init, remote, install, build, test), each wrapped in `PostScaffoldSetupError` carrying the failing step so the CLI can print targeted recovery.

Three commands share this pipeline: `scaffold` (default), `update` (`source/update.ts`), and `config` (`source/cli-config.ts`). `source/index.ts` is the deliberate public API — export from it intentionally.

## Critical invariants

**`buildProjectFiles` must stay a pure function of its config.** No clock, no filesystem probing, no env, no network. `copyrightYear` lives in `ScaffoldConfig` for exactly this reason. The golden files and the state file's per-file hashes both depend on this holding.

**Copying a template and emitting a file are different registrations, and a new file usually needs both.** `.tmpl` assets under `source/templates/assets/` are copied into `dist/` by a recursive copy in `scripts/build.mjs`, so they need no build wiring — but copying is not emitting, and a file only reaches a scaffolded project when `buildProjectFiles` returns it. `scripts/verify-artifacts.mjs` covers the third link, that the asset survived into the published `dist/`; it derives its list from `source/templates/assets/**` so `.tmpl` files are automatic, while compiled entry points are a hand-listed array.

**The state schema is a compatibility surface.** Every scaffold writes `.create-ts-lib.json` (`source/templates/state.ts`) — the full config plus a SHA-256 hash of each generated file — and `update` re-renders from it. Projects on disk carry state files written by older releases, so a new `scaffoldConfigSchema` field needs `.default()` or `update` breaks for all of them. `test/state-compatibility.test.ts` enforces this against deliberately stale fixtures in `test/__fixtures__/state/`; never regenerate those fixtures to silence a failure. The file is also user-editable and its `files` keys are unvalidated strings that `update` turns into deletion paths, so anything reading them must check containment (`isInsideDirectory`) rather than trusting `resolve` — which restarts at an absolute segment.

**Changing generated output means updating its whole documentation set in the same change:** `README.md` (flags, prompt flow, generated layout tree, defaults table), `docs/generated-project-tour.md` (the per-file walkthrough), the structural assertions in `test/scaffold.test.ts`, and the golden files in `test/__snapshots__/generated-output/` (`vitest -u`, then read the diff).

**The architecture gate has a canary.** `test/architecture-gate.test.ts` runs the real generated `.fallowrc.jsonc` against temp fixtures containing deliberate violations plus a clean control case. This exists because the gate has twice reported success while analysing nothing. If you touch `.fallowrc.jsonc` or its template, keep those tests meaningful rather than adjusting them to pass.

**Tooling is fixed.** Formatting is oxfmt; linting is Biome + oxlint. Do not add Prettier. JSON/JSONC/YAML are excluded from Biome to avoid ownership conflicts with oxfmt, and `source/templates/assets` is excluded from Biome entirely (templates are not valid standalone sources). Use Zod for runtime validation of anything external (state files, user config).

**`biome.jsonc` sets `noNodejsModules`, `noProcessGlobal`, `noProcessEnv`, `noConsole`, and `noDefaultExport` to `error` repo-wide**, then switches them off in `overrides`: broadly for `test/**`, and for production code only via the hand-maintained list in the **last** `overrides` block. That list globs `scripts/**/*.mjs` and `source/templates/**/*.ts` but names every other module individually — so a new module outside those two globs that imports a `node:` builtin, touches `process`, or logs must be added to it or `pnpm run lint` fails.

## Going deeper

Load these when the task calls for them rather than up front:

- [`docs/extending-the-generator.md`](docs/extending-the-generator.md) — adding a `ScaffoldConfig` field or a generated file, template rendering, version pinning, the `update` classifier, workspace mode.
- [`docs/checks-and-tests.md`](docs/checks-and-tests.md) — every command and what is non-obvious about it, the smoke-test env matrix, how generated output is verified, and the cross-cutting guard tests.
- [`docs/generated-project-tour.md`](docs/generated-project-tour.md) — a per-file walkthrough of what a scaffolded project actually contains.

`AGENTS.md` points here; keep this file authoritative rather than duplicating guidance into it.
