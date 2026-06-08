# `@hbmartin/create-ts-lib`

> One command scaffolds a modern, publish-ready TypeScript library.

[![npm version](https://img.shields.io/npm/v/@hbmartin/create-ts-lib.svg)](https://www.npmjs.com/package/@hbmartin/create-ts-lib)
[![CI](https://github.com/hbmartin/create-ts-lib/actions/workflows/ci.yml/badge.svg)](https://github.com/hbmartin/create-ts-lib/actions/workflows/ci.yml)
[![npm downloads](https://img.shields.io/npm/dm/@hbmartin/create-ts-lib.svg)](https://www.npmjs.com/package/@hbmartin/create-ts-lib)
[![node](https://img.shields.io/node/v/@hbmartin/create-ts-lib.svg)](https://nodejs.org)
[![types included](https://img.shields.io/npm/types/@hbmartin/create-ts-lib.svg)](https://www.npmjs.com/package/@hbmartin/create-ts-lib)
[![install size](https://img.shields.io/packagephobia/install/@hbmartin/create-ts-lib.svg)](https://packagephobia.com/result?p=@hbmartin/create-ts-lib)
[![license](https://img.shields.io/npm/l/@hbmartin/create-ts-lib.svg)](LICENSE)

An opinionated initializer that turns a single command into a building, testing, lint-clean TypeScript library you can publish the same day. See [Why this tool](#why-this-tool) for the full stack and the rationale behind each choice.

## Contents

- [Why this tool](#why-this-tool)
- [How it compares](#how-it-compares)
- [Requirements](#requirements)
- [Usage](#usage)
- [CLI Options](#cli-options)
- [Prompt Flow](#prompt-flow)
- [Generated Project Layout](#generated-project-layout)
- [Generated Defaults](#generated-defaults)
- [Post-Scaffold Behavior](#post-scaffold-behavior)
- [Next Steps After Scaffolding](#next-steps-after-scaffolding)
- [Programmatic API](#programmatic-api)
- [Local Development](#local-development)
- [Contributing](#contributing)
- [License](#license)

## Why this tool

Setting up a publishable TypeScript library means making the same dozen decisions every time: module format, build output, lint and format tooling, test runner and coverage, git hooks, and packaging validation. `create-ts-lib` makes those decisions for you with a single, modern, opinionated stack:

- **ESM-only, Node 22+** — no dual-format build complexity.
- **Oxlint + Oxfmt or Biome** for fast linting and formatting instead of ESLint + Prettier.
- **Vitest** with v8 coverage and enforced thresholds out of the box.
- **dependency-cruiser + Semgrep** for lightweight architecture and security policy checks.
- **Lefthook** for lightweight pre-commit hooks.
- **publint + are-the-types-wrong** wired in so your published package is correct before you ship it.

If you'd rather not maintain this boilerplate by hand — or you want every library you publish to share one consistent setup — this gets you from zero to a building, testing, lint-clean package in one command.

## How it compares

How `create-ts-lib` stacks up against the common ways to start a TypeScript library:

| Concern                       | `create-ts-lib`                         | tsdx                 | Hand-rolled template |
| ----------------------------- | --------------------------------------- | -------------------- | -------------------- |
| Output format                 | ESM-only (Node 22+)                     | CJS + ESM            | You decide           |
| Lint + format                 | Oxlint + Oxfmt or Biome                 | ESLint + Prettier    | You wire it up       |
| Tests + coverage              | Vitest + v8, 80% gate                   | Jest                 | You wire it up       |
| Architecture + security gates | dependency-cruiser + Semgrep            | —                    | —                    |
| Publish validation            | publint + are-the-types-wrong + dry-run | —                    | Manual               |
| Git hooks                     | Lefthook (pre-wired)                    | Husky (manual)       | Manual               |
| CI + release workflow         | GitHub Actions (pnpm)                   | —                    | Manual               |
| Project status                | Actively maintained                     | Inactive since ~2021 | n/a                  |

The trade-off is deliberate: `create-ts-lib` is **opinionated and ESM-only** with a focused lint/format choice between Oxlint + Oxfmt and Biome. If you need a dual CJS/ESM build or a different broader tooling stack, a hand-rolled template gives you more control at the cost of the wiring.

## Requirements

- **Node.js 22 or newer** (the generator and the generated project both target Node 22+).
- A package manager: **pnpm** (recommended), npm, or yarn.

## Usage

Recommended (pnpm):

```bash
pnpm create @hbmartin/ts-lib my-lib
```

<details>
<summary>Other package managers</summary>

```bash
npm create @hbmartin/ts-lib my-lib
npx @hbmartin/create-ts-lib my-lib
```

</details>

By default the generator asks interactive prompts. To accept all detected/default answers without prompting:

```bash
npx @hbmartin/create-ts-lib my-lib --yes
```

To preview the target options and file list without writing anything:

```bash
npx @hbmartin/create-ts-lib my-lib --dry-run
```

To choose Biome instead of the default Oxlint + Oxfmt stack:

```bash
npx @hbmartin/create-ts-lib my-lib --lint-format biome
```

To include Zod as a generated runtime dependency:

```bash
npx @hbmartin/create-ts-lib my-lib --zod
```

To omit the default Codecov upload step from generated pnpm CI:

```bash
npx @hbmartin/create-ts-lib my-lib --no-codecov
```

By default the generator refuses to write into a non-empty target directory. Use `--force` only when you intentionally want generated files written into an existing directory:

```bash
npx @hbmartin/create-ts-lib my-lib --force
```

## CLI Options

```text
create-ts-lib [directory] [options]
```

| Option            | Description                                     |
| ----------------- | ----------------------------------------------- |
| `[directory]`     | Target directory / default project name         |
| `--yes`, `-y`     | Use detected/default answers without prompting  |
| `--dry-run`       | Print the scaffold plan without writing files   |
| `--force`         | Allow writing into a non-empty target directory |
| `--lint-format`   | Choose `oxlint-oxfmt` or `biome`                |
| `--no-codecov`    | Omit the Codecov upload step from generated CI  |
| `--zod`           | Include Zod in the generated project            |
| `--help`, `-h`    | Print usage and exit                            |
| `--version`, `-v` | Print the CLI version and exit                  |

## Prompt Flow

The generator asks for:

| Prompt                   | Default                                          | Notes                                                                                                                 |
| ------------------------ | ------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------- |
| Project name             | directory arg or `my-lib`                        | Used as the package name; must be npm-name compatible and is checked against npm                                      |
| Description              | empty string                                     | Written to `package.json`                                                                                             |
| Author                   | `git config user.name` + `git config user.email` | Combined as `Name <email>` when available                                                                             |
| License                  | `Apache-2.0`                                     | `Apache-2.0`, `MIT`, `ISC`, `UNLICENSED`                                                                              |
| Lint and format tooling  | `Oxlint + Oxfmt`                                 | `Oxlint + Oxfmt` or `Biome`; automation can pass `--lint-format oxlint-oxfmt` or `--lint-format biome`                |
| GitHub repo URL          | existing personal GitHub repo found by `gh`      | Missing repos can be created public/private or entered manually; normalizes SSH and `git+https://github.com/` remotes |
| Include Codecov?         | `yes`                                            | Adds a Codecov upload step to pnpm-generated CI; automation can pass `--no-codecov` to omit it                        |
| Include CLI entry point? | `no`                                             | Adds `bin`, `meow`, `source/cli.ts`, and CLI coverage                                                                 |
| Include Zod?             | `no`                                             | Adds `zod` as a runtime dependency and Zod guidance to generated `AGENTS.md`; automation can pass `--zod`             |
| Package manager          | `pnpm`                                           | `pnpm`, `npm`, or `yarn`; generated CI is pnpm-only                                                                   |

After the final project name is accepted, interactive mode starts a `gh` lookup for a matching personal GitHub repository while it continues asking local project prompts. Existing repos are offered as the repo URL default. When no matching repo exists, the CLI lets you create a public or private repo with `gh repo create` after the scaffold summary and before files are written; `--dry-run` shows the predicted URL and skips creation. When `gh` is unavailable, unauthenticated, or returns an unexpected error, the CLI warns and asks for a repo URL with no default.

If the project name already exists on npm, interactive mode warns and lets you rename it or continue anyway. `--yes` uses defaults directly, still uses `git remote origin` as the GitHub repo URL default for generated metadata such as `package.json` repository fields, warns on an existing npm name, and continues without `gh` lookup, repo creation, or remote setup. Pass `--zod` with `--yes` to opt into Zod without prompting, or `--no-codecov` to omit the default Codecov upload. If `@inquirer/prompts` cannot load, the CLI prints a warning and falls back to a basic readline prompt implementation.

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
├── scripts/
│   └── security-lint.mjs
├── test/
│   ├── cli.test.ts             # optional
│   └── utils/
│       └── formatting.test.ts
├── .github/
│   └── workflows/
│       ├── ci.yml              # pnpm + GitHub repo URL only
│       └── release.yml         # pnpm + GitHub repo URL only
├── AGENTS.md
├── .dependency-cruiser.cjs
├── .gitignore
├── biome.jsonc                # Biome projects only
├── .oxfmtrc.json              # Oxlint + Oxfmt projects only
├── .oxlintrc.json             # Oxlint + Oxfmt projects only
├── lefthook.yml
├── pnpm-workspace.yaml         # pnpm only
├── package.json
├── README.md
├── semgrep.yml
├── tsconfig.json
├── tsconfig.build.json
├── vitest.config.ts
└── LICENSE
```

GitHub CI and release workflows are generated only for pnpm projects when a GitHub repo URL is provided. The CLI file and `bin` mapping are generated only when CLI support is enabled. Pnpm projects include `pnpm-workspace.yaml` so Lefthook's install script is allowed explicitly.

## Generated Defaults

Generated packages include:

- `version: "0.1.0"`
- `type: "module"`
- `packageManager` matching this generator's pnpm version for pnpm projects
- a package-manager-specific `@types/node` pin via `overrides`,
  `pnpm.overrides`, or `resolutions`
- `exports` pointing at `dist/index.js` and `dist/index.d.ts`
- `engines.node: ">=22"`
- `@sindresorhus/tsconfig`
- `oxlint` and `oxfmt` by default, or `@biomejs/biome` when selected
- matching lint/format scripts and config files for the selected tooling
- dependency-cruiser architecture checks
- Semgrep policy checks
- Vitest with v8 coverage and 80% thresholds
- SHA-pinned GitHub Actions CI and release workflows for pnpm projects
- Lefthook with a lint-only `pre-commit` hook
- optional `zod` runtime dependency when selected
- `meow` and CLI coverage only when CLI support is enabled, including a CLI test
  mock with default `flags` and `input`
- `@arethetypeswrong/cli` and `publint` release checks
- `check`, `deps:lint`, `security:lint`, `prepublishOnly`, `publint`,
  `types:lint`, `verify:artifacts`, `verify:package`, `size:report`, and
  `release:check` scripts
- `AGENTS.md` with opinionated guidance for Codex and other coding agents
- `Apache-2.0` license by default

**Versioning:** generated packages start at `0.1.0`, signaling a pre-1.0 library where minor bumps may carry breaking changes until you cut `1.0.0`. You own the version with `pnpm version` — nothing bumps it for you.

**Release automation:** rather than bundling release-please or changesets, pnpm projects with a GitHub repo URL include a lightweight release workflow that publishes to npm when you publish a GitHub release. This keeps versioning fully in your hands while still automating the npm publish.

## Post-Scaffold Behavior

Before creating a GitHub repo or writing files, the generator rejects non-empty target directories unless `--force` is provided. After writing files, it performs:

1. `git init` when the target directory is not already inside a Git repository
2. `git remote add origin <repo-url>` when a repo URL is provided and the target is its own Git repository
3. `<package-manager> install`
4. `<package-manager> run build`
5. `<package-manager> run test`

Remote setup is best-effort: if the target is inside a parent Git repository, or if `origin` already exists, the CLI reports the issue and continues. The CLI prints a summary before writing and shows progress during post-scaffold setup. When a repo URL is configured interactively, the final next steps include `git add`, `git commit`, and `git push -u origin HEAD`. When Codecov is enabled for a pnpm project with a GitHub repo URL, the final next steps also include the Codecov setup URL for that repository. In non-TTY or CI environments it uses plain step logs instead of spinners. If a setup command fails after files are written, the CLI prints the created project path and the commands to retry the failed and remaining setup steps.

## Next Steps After Scaffolding

Once the generator finishes, your library already builds, lints, and tests. Write your code in `source/`, then follow the path below.

**1. Validate before publishing (required):**

```bash
cd my-lib
pnpm run release:check  # full check suite + package validation + npm publish dry run
```

`release:check` already runs `pnpm run check` (lint + dep/security checks + typecheck + coverage) for you, so there's no need to run `check` separately first.

**2. Inspect the packed package (optional):**

```bash
pnpm run size:report    # packed package size report
```

**3. Cut a release:**

```bash
pnpm version patch      # or minor / major — bumps package.json and creates a git tag
git push --follow-tags  # push the commit and the new tag
```

**What actually triggers the publish:** the tag push alone does _not_ publish. For pnpm projects with a GitHub repo URL, **creating a GitHub release** for the pushed tag runs the generated npm-publish workflow. Prereleases publish under the `next` tag; normal releases publish under `latest`.

`prepublishOnly`-style validation (`verify:artifacts`, `publint`, are-the-types-wrong,
and a dry-run publish) is wired into the generated package so packaging problems surface
before you ship.

`pnpm run security:lint` prefers a `semgrep` binary on PATH and otherwise runs
the pinned `uvx semgrep` scan. Install Semgrep directly or install uv if both
commands are missing locally.

## Programmatic API

The package exports:

- `scaffoldProject(config, options)`
- `ScaffoldConfig`
- `ScaffoldOptions`
- `ScaffoldProgress`

`scaffoldProject` writes the generated project, rejects invalid package names, refuses non-empty target directories unless `force: true` is set, can optionally receive progress callbacks for post-scaffold steps, and can add a best-effort `origin` remote with `gitRemoteOriginUrl`.

```ts
import { scaffoldProject, type ScaffoldConfig } from "@hbmartin/create-ts-lib";

const config: ScaffoldConfig = {
  projectName: "my-lib",
  description: "An example library",
  author: "Jane Doe <jane@example.com>",
  license: "Apache-2.0",
  lintFormatTooling: "oxlint-oxfmt",
  githubRepoUrl: "https://github.com/jane/my-lib",
  packageManager: "pnpm",
  includeCodecov: true,
  includeCli: false,
  includeZod: false,
};

await scaffoldProject(config, {
  targetDirectory: "./my-lib",
  force: false,
  gitRemoteOriginUrl: config.githubRepoUrl,
  postScaffold: true, // run git init + optional origin setup + install + build + test
  progress: {
    start: (m) => console.log(`▶ ${m}`),
    succeed: (m) => console.log(`✔ ${m}`),
    info: (m) => console.log(`· ${m}`),
    fail: (m) => console.error(`✖ ${m}`),
  },
});
```

## Local Development

Install dependencies:

```bash
pnpm install
```

Useful commands:

```bash
pnpm run lint
pnpm run deps:lint
pnpm run security:lint
pnpm run typecheck
pnpm run test
pnpm run test:coverage
pnpm run build
pnpm run smoke:scaffold
pnpm run publint
pnpm run types:lint
```

`pnpm run smoke:scaffold` builds the generator, scaffolds pnpm projects with and
without CLI support, installs them from a frozen lockfile, and runs their generated
release checks. Set `SMOKE_INCLUDE_CLI=true` or `false` to run one variant, and
set `SMOKE_DIR` to choose the generated project directory.

Template assets live under `source/templates/assets` and are copied into `dist/templates/assets` during `pnpm build`.

## Contributing

Contributions are welcome — see [CONTRIBUTING.md](CONTRIBUTING.md) and the [Code of Conduct](CODE_OF_CONDUCT.md).

## License

[Apache-2.0](LICENSE) © Harold Martin.

Generated projects default to the `Apache-2.0` license as well; you can choose `MIT`, `ISC`, or `UNLICENSED` during the prompt flow.
