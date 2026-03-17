# `@hbmartin/create-ts-lib`

An opinionated initializer for TypeScript libraries.

It scaffolds a Node 22+ ESM library with TypeScript, Biome, Vitest, Husky, commitlint, publint, optional GitHub workflows, and an optional CLI entry point. The goal is to generate a project that starts with a strict quality bar instead of leaving the first hour of setup to every new package.

## What It Creates

Generated libraries are set up with:

- TypeScript source under `source/` and tests under `test/`
- ESM package output in `dist/`
- declaration file emission for consumers
- Biome configuration with a large curated ruleset and test-specific overrides
- Vitest with Istanbul coverage and 80% thresholds
- Husky commit-msg hook with commitlint
- publint in CI to validate package publishing shape
- optional GitHub Actions CI, semantic PR checks, and release-please automation
- optional `meow`-based CLI entry point

The generated library favors:

- `type: "module"`
- `node >=22`
- explicit `exports`
- `zod` as the default runtime dependency
- browser-safe library source by default via Biome’s `noNodejsModules` rule

## Usage

The package is intended to be invoked through create-style commands:

```bash
pnpm create ts-lib my-lib
npm create ts-lib my-lib
npx create-ts-lib my-lib
```

You can also run the built CLI directly:

```bash
create-ts-lib my-lib
```

Help and version:

```bash
create-ts-lib --help
create-ts-lib --version
```

## Prompt Flow

The generator asks for:

| Prompt | Type | Default | Notes |
| --- | --- | --- | --- |
| Project name | text | directory arg or `my-lib` | Used as the package name |
| Description | text | empty string | Written to `package.json` |
| Author | text | `git config user.name` + `git config user.email` | Combined as `Name <email>` when available |
| License | select | `MIT` | `MIT`, `ISC`, `Apache-2.0`, `UNLICENSED` |
| GitHub repo URL | text | auto-detected from `git remote origin` | Normalizes `git@github.com:` remotes to HTTPS |
| Include release-please? | confirm | `yes` when repo URL is present | Adds release workflow and config |
| Include Codecov? | confirm | `yes` | Adds Codecov upload step to CI |
| Include CLI entry point? | confirm | `no` | Adds `bin`, `meow`, and `source/cli.ts` |
| Package manager | select | `pnpm` | `pnpm`, `npm`, or `yarn` |

If `@inquirer/prompts` is unavailable at runtime, the CLI falls back to a readline-based prompt implementation so scaffolding can still proceed.

## Generated Project Layout

Typical output:

```text
my-lib/
├── source/
│   ├── index.ts
│   ├── cli.ts                  # optional
│   ├── types/
│   │   └── index.ts
│   └── utils/
│       └── formatting.ts
├── test/
│   └── utils/
│       └── formatting.test.ts
├── .github/
│   └── workflows/
│       ├── ci.yml
│       ├── semantic-pr.yml
│       └── release-please.yml # optional
├── .husky/
│   └── commit-msg
├── .gitignore
├── biome.jsonc
├── commitlint.config.js
├── package.json
├── release-please-config.json     # optional
├── .release-please-manifest.json  # optional
├── tsconfig.json
├── tsconfig.build.json
├── vitest.config.ts
└── LICENSE
```

Notes:

- GitHub workflows are generated only when a GitHub repo URL is provided.
- `release-please` files are generated only when a GitHub repo URL is present and the prompt is accepted.
- The CLI file and `bin` mapping are generated only when the CLI option is enabled.
- The lockfile is created by the selected package manager during install.

## Generated Library Defaults

### `package.json`

Generated packages include:

- `version: "0.1.0"`
- `type: "module"`
- `exports` pointing at `dist/index.js` and `dist/index.d.ts`
- `files: ["dist"]`
- `engines.node: ">=22"`
- `build`, `typecheck`, `dev`, `lint`, `format`, `test`, and `prepare` scripts
- `zod` as a runtime dependency
- `meow` only when CLI support is enabled
- repository, homepage, and bugs fields when a GitHub repo URL is provided

### TypeScript

The generated library uses:

- `@sindresorhus/tsconfig`
- `outDir: "dist"`
- declaration output enabled in `tsconfig.build.json`
- source inclusion limited to `source/`

The intent is that a generated library publishes declarations for consumers instead of behaving like a pure internal app.

### Biome

`biome.jsonc` is shipped as a full project-local config rather than as an external shared config. That keeps the output editable without indirection and makes the generated project self-contained.

Important characteristics:

- strict rules across correctness, complexity, style, suspicious, performance, security, and nursery groups
- test-specific overrides for Node and pragmatic test behavior
- CLI-specific override when `source/cli.ts` is generated
- no React or JSX rules

The template is tuned to pass with current Biome releases while preserving the intent of the stricter ruleset.

### Tests and Coverage

The sample test suite uses Vitest with:

- `environment: "node"`
- `istanbul` coverage
- `lcov` and text reporters
- 80% thresholds for branches, functions, lines, and statements

The starter example is intentionally small but valid, so the generated package builds and tests cleanly immediately after scaffold.

### CI and Release Automation

When a GitHub repo URL is provided, the generator adds:

- `ci.yml`
- `semantic-pr.yml`

The CI workflow:

- installs with the selected package manager
- runs a production dependency audit
- runs `biome ci .`
- runs `build`
- runs `publint`
- runs tests with coverage
- optionally uploads to Codecov

If release-please is enabled, the generator also adds:

- `release-please.yml`
- `release-please-config.json`
- `.release-please-manifest.json`

The release workflow publishes with provenance and uses the `next` tag when the package version is a prerelease.

## Post-Scaffold Behavior

After writing files, the generator performs:

1. `git init` when the target directory is not already inside a Git repository
2. `<package-manager> install`
3. `<package-manager> run build`
4. `<package-manager> run test`

Finally it prints:

```text
Created <name>

Next steps:
  cd <directory>
  <pm> run dev
  <pm> run lint
  <pm> run test
```

## Package Manager Differences

The selected package manager affects:

- the lockfile created during install
- the generated Husky commit-msg hook command
- the CI install, audit, and publint commands
- the next-step instructions printed at the end

Examples:

- `pnpm`: `pnpm install`, `pnpm audit --prod`, `pnpm exec publint --pack npm`
- `npm`: `npm ci`, `npm audit --omit=dev`, `npx --no -- publint --pack npm`
- `yarn`: `yarn install --immutable`, `yarn npm audit --environment production`, `yarn publint --pack npm`

## Local Development

This repository is the scaffolder package itself.

Install dependencies:

```bash
pnpm install
```

Useful commands:

```bash
pnpm run typecheck
pnpm run test
pnpm run build
```

The build script cleans `dist/` before compiling so the published package does not retain stale output.

To run the scaffolder from a local build:

```bash
pnpm run build
node dist/cli.js my-lib
```

## Programmatic API

The package also exports a small programmatic API:

- `scaffoldProject(config, options)`

That API is useful for tests and smoke checks, and is what the CLI calls internally after collecting prompt answers.

## Verification Status

The current implementation has been verified with:

- local `typecheck`, `test`, and `build` on this package
- `--help` and `--version` on the built CLI
- fresh generated-project smoke tests covering `install`, `build`, `test`, and `lint`

## Scope

This initializer is intentionally opinionated.

It does not try to support every possible library layout. It gives you a solid default for:

- modern ESM TypeScript libraries
- Node 22+ targets
- strict linting and CI from day one
- optional CLI packaging when the library also needs a command entry point
