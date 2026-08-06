# Generated Project Tour

A guided walkthrough of everything `create-ts-lib` scaffolds and why it is
there. Paths marked _optional_ only appear for certain answers in the prompt
flow (or their matching CLI flags).

## Source and tests

| Path                            | Purpose                                                                                                 |
| ------------------------------- | ------------------------------------------------------------------------------------------------------- |
| `source/index.ts`               | The public entry point. Export your API deliberately from here.                                         |
| `source/types/index.ts`         | A starting point for shared type definitions.                                                           |
| `source/utils/formatting.ts`    | A small example utility so the project builds and tests out of the box.                                 |
| `source/cli.ts` _(optional)_    | A [meow](https://github.com/sindresorhus/meow)-based CLI entry point, wired to `bin` in `package.json`. |
| `test/utils/formatting.test.ts` | An example Vitest test covering the sample utility.                                                     |
| `test/cli.test.ts` _(optional)_ | CLI coverage with a mocked `meow` so the CLI stays tested.                                              |

The layout convention is enforced: implementation code lives in `source/`,
tests live in `test/`, and fallow fails the build if `source/`
ever imports from `test/`.

## Build

| Path                               | Purpose                                                                          |
| ---------------------------------- | -------------------------------------------------------------------------------- |
| `tsconfig.json`                    | Extends `@sindresorhus/tsconfig`; used by `typecheck` and your editor.           |
| `tsconfig.build.json` _(tsc only)_ | Adds declarations and `rootDir` for the `tsc` production build.                  |
| `tsdown.config.ts` _(tsdown only)_ | [tsdown](https://tsdown.dev) bundler config emitting ESM + `.d.ts` into `dist/`. |

Both build options are ESM-only and target Node 24+. `tsc` is the default —
plain, predictable compilation. Choose `tsdown` when you want bundling,
multiple entry points collapsed into one file, or faster builds; the emitted
artifacts (`dist/index.js`, `dist/index.d.ts`) are the same either way, so
`package.json` needs no changes if you switch later.

## Lint and format

| Path                                                  | Purpose                                                                                       |
| ----------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| `.oxlintrc.json` / `.oxfmtrc.json` _(Oxlint + Oxfmt)_ | Fast Rust-based linting and formatting — the default stack.                                   |
| `biome.jsonc` _(Biome)_                               | One tool for linting and formatting when you pick Biome.                                      |
| `.vscode/extensions.json`                             | Recommends the editor extension matching your lint tooling (plus the Vitest explorer).        |
| `.vscode/settings.json`                               | Enables format-on-save with the matching formatter and pins the workspace TypeScript version. |
| `lefthook.yml`                                        | A lint-only `pre-commit` hook via [Lefthook](https://lefthook.dev).                           |

## Policy checks

| Path                        | Purpose                                                                                                                                                                                               |
| --------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `.fallowrc.jsonc`           | Architecture rules: no circular deps, no unresolvable imports, no undeclared packages, no `source/` → `test/` imports, no dev-dependency imports from `source/`.                                      |
| `semgrep.yml`               | Security rules: no `eval`-like execution, no `child_process` `exec`/`execSync`, no `shell: true`, no transient JSR CLI execution, no weak crypto hashes, no `Math.random` in security-sensitive code. |
| `scripts/security-lint.mjs` | Wrapper that prefers `semgrep` on PATH and falls back to a pinned `uvx semgrep` run.                                                                                                                  |

## Packaging and publishing

| Path                    | Purpose                                                                                                                                       |
| ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `package.json`          | ESM-only `exports`, `files: ["dist"]`, engines pin, and a full script suite (see below).                                                      |
| `jsr.json` _(optional)_ | [JSR](https://jsr.io) manifest publishing the TypeScript source directly; pairs with the pinned `jsr` devDependency and `jsr:publish` script. |
| `LICENSE`               | Rendered from your license choice with your name and the current year.                                                                        |

Key scripts:

- `check` — lint + typecheck + dependency and security policy checks + coverage
- `verify:artifacts`, `publint`, `types:lint` (`attw`) — packaging validation
- `release:check` — everything above plus an `npm publish` dry run
- `size:report` — packed package size

## CI and automation (pnpm + GitHub repo URL)

| Path                                           | Purpose                                                                                                                                                                                                                                     |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `.github/workflows/ci.yml`                     | SHA-pinned CI on Node 24 and 26: audit, full check suite, TS 7 probe, build, publint, optional Codecov upload.                                                                                                                              |
| `.github/workflows/release.yml`                | Publishes to npm when you publish a GitHub release, authenticating with [npm trusted publishing](https://docs.npmjs.com/trusted-publishers) (OIDC) and `--provenance` — no `NPM_TOKEN` secret. Adds a JSR publish step when JSR is enabled. |
| `.github/workflows/codeql.yml` _(optional)_    | CodeQL static analysis on pushes, PRs, and a weekly schedule.                                                                                                                                                                               |
| `.github/workflows/scorecard.yml` _(optional)_ | [OpenSSF Scorecard](https://scorecard.dev) supply-chain posture checks.                                                                                                                                                                     |
| `renovate.json`                                | Renovate config with pinned-digest GitHub Actions updates (generated whenever a repo URL is provided).                                                                                                                                      |

## Housekeeping

| Path                                | Purpose                                                                                                                                                                 |
| ----------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `.create-ts-lib.json`               | Scaffold state: the config you chose plus a hash of every generated file. `create-ts-lib update` uses it to re-sync tooling files without touching anything you edited. |
| `.gitignore`                        | Ignores build output, coverage, env files, and editor clutter while keeping the generated `.vscode` files.                                                              |
| `pnpm-workspace.yaml` _(pnpm only)_ | Explicitly allows Lefthook's install script under pnpm's build-script policy.                                                                                           |
| `AGENTS.md`                         | Conventions for coding agents (and humans): where code lives, which tools run, and how to verify changes.                                                               |
| `README.md`                         | Pre-filled with badges, install/usage snippets, development commands, and release instructions.                                                                         |
| `vitest.config.ts`                  | Vitest with v8 coverage and 80% thresholds on lines, branches, functions, and statements.                                                                               |
