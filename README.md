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
- [Personal Defaults](#personal-defaults)
- [Prompt Flow](#prompt-flow)
- [Generated Project Layout](#generated-project-layout)
- [Generated Defaults](#generated-defaults)
- [Workspace Mode](#workspace-mode)
- [Post-Scaffold Behavior](#post-scaffold-behavior)
- [Updating a Generated Project](#updating-a-generated-project)
- [Next Steps After Scaffolding](#next-steps-after-scaffolding)
- [Programmatic API](#programmatic-api)
- [Local Development](#local-development)
- [Contributing](#contributing)
- [License](#license)

For a guided walkthrough of everything a scaffolded project contains, see the
[generated project tour](docs/generated-project-tour.md).

## Why this tool

Setting up a publishable TypeScript library means making the same dozen decisions every time: module format, build output, lint and format tooling, test runner and coverage, git hooks, and packaging validation. `create-ts-lib` makes those decisions for you with a single, modern, opinionated stack:

- **ESM-only, Node 24+** — no dual-format build complexity.
- **Oxlint + Oxfmt or Biome** for fast linting and formatting instead of ESLint + Prettier.
- **Vitest** with v8 coverage and enforced thresholds out of the box.
- **fallow + Semgrep** for lightweight architecture and security policy checks.
- **Lefthook** for lightweight pre-commit hooks.
- **publint + are-the-types-wrong** wired in so your published package is correct before you ship it.

If you'd rather not maintain this boilerplate by hand — or you want every library you publish to share one consistent setup — this gets you from zero to a building, testing, lint-clean package in one command.

## How it compares

How `create-ts-lib` stacks up against the common ways to start a TypeScript library:

| Concern                       | `create-ts-lib`                         | tsdx                 | Hand-rolled template |
| ----------------------------- | --------------------------------------- | -------------------- | -------------------- |
| Output format                 | ESM-only (Node 24+)                     | CJS + ESM            | You decide           |
| Lint + format                 | Oxlint + Oxfmt or Biome                 | ESLint + Prettier    | You wire it up       |
| Tests + coverage              | Vitest + v8, 80% gate                   | Jest                 | You wire it up       |
| Architecture + security gates | fallow + Semgrep                        | —                    | —                    |
| Publish validation            | publint + are-the-types-wrong + dry-run | —                    | Manual               |
| Git hooks                     | Lefthook (pre-wired)                    | Husky (manual)       | Manual               |
| CI + release workflow         | GitHub Actions (pnpm)                   | —                    | Manual               |
| Project status                | Actively maintained                     | Inactive since ~2021 | n/a                  |

The trade-off is deliberate: `create-ts-lib` is **opinionated and ESM-only** with a focused lint/format choice between Oxlint + Oxfmt and Biome. If you need a dual CJS/ESM build or a different broader tooling stack, a hand-rolled template gives you more control at the cost of the wiring.

## Requirements

- **Node.js 24 or newer** — both to run the generator and to work in the projects
  it generates, which declare the same `engines.node: ">=24"` floor and are
  CI-tested on Node 24 and 26.
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

Every prompt has a matching flag, so a fully non-interactive scaffold needs no
`--yes` guesswork:

```bash
npx @hbmartin/create-ts-lib my-lib --yes \
  --name @scope/my-lib \
  --description "An example library" \
  --author "Ada Lovelace <ada@example.com>" \
  --license MIT \
  --repo-url https://github.com/ada/my-lib \
  --package-manager pnpm \
  --lint-format biome \
  --bundler tsdown \
  --no-codecov --jsr --security-workflows
```

In interactive mode, any provided flag skips its prompt and the generator only
asks about the rest.

To scaffold without running git setup or the install/build/test steps
(useful in CI, monorepos, or offline):

```bash
npx @hbmartin/create-ts-lib my-lib --yes --skip-git --skip-install
```

By default the generator refuses to write into a non-empty target directory. Use `--force` only when you intentionally want generated files written into an existing directory:

```bash
npx @hbmartin/create-ts-lib my-lib --force
```

## CLI Options

```text
create-ts-lib [directory] [options]
create-ts-lib update [directory] [--dry-run] [--force] [--yes]
create-ts-lib config path
create-ts-lib config get [key]
create-ts-lib config set <key> <value>
create-ts-lib config unset <key>
```

| Option                      | Description                                           |
| --------------------------- | ----------------------------------------------------- |
| `[directory]`               | Target directory / default project name               |
| `--yes`, `-y`               | Use detected/default answers without prompting        |
| `--dry-run`                 | Print the scaffold plan without writing files         |
| `--force`                   | Allow writing into a non-empty target directory       |
| `--name <name>`             | Package name (defaults to the directory name)         |
| `--description <text>`      | Package description                                   |
| `--author <author>`         | Package author, e.g. `"Ada <ada@example.com>"`        |
| `--license <license>`       | Choose `Apache-2.0`, `MIT`, `ISC`, or `UNLICENSED`    |
| `--repo-url <url>`          | GitHub repository URL for generated metadata          |
| `--package-manager <pm>`    | Choose `pnpm`, `npm`, or `yarn`                       |
| `--lint-format <tooling>`   | Choose `oxlint-oxfmt` or `biome`                      |
| `--bundler <bundler>`       | Choose `tsc` or `tsdown`                              |
| `--[no-]cli`                | Include or omit the CLI entry point                   |
| `--[no-]codecov`            | Include or omit Codecov upload in generated CI        |
| `--[no-]zod`                | Include or omit Zod in the generated project          |
| `--[no-]jsr`                | Include or omit JSR publishing support                |
| `--[no-]security-workflows` | Include or omit CodeQL and Scorecard workflows        |
| `--[no-]community-files`    | Include or omit CONTRIBUTING/CODE_OF_CONDUCT/SECURITY |
| `--[no-]workspace`          | Scaffold as a package inside an existing workspace    |
| `--skip-git`                | Skip git init and git remote setup                    |
| `--skip-install`            | Skip dependency install, build, and test              |
| `--help`, `-h`              | Print usage and exit                                  |
| `--version`, `-v`           | Print the CLI version and exit                        |

## Personal Defaults

The generator reads personal defaults from
`$XDG_CONFIG_HOME/create-ts-lib/config.json` (usually
`~/.config/create-ts-lib/config.json`). Values there become the prompt
defaults and the `--yes` answers; CLI flags always win over the config file.

```json
{
  "author": "Ada Lovelace <ada@example.com>",
  "license": "MIT",
  "lintFormatTooling": "biome",
  "bundler": "tsdown",
  "packageManager": "pnpm",
  "includeCodecov": false
}
```

Supported keys: `author`, `license`, `lintFormatTooling`, `bundler`,
`packageManager`, `includeCli`, `includeCodecov`, `includeCommunityFiles`,
`includeJsr`, `includeSecurityWorkflows`, and `includeZod`. Per-project answers (name,
description, repo URL, workspace mode) are deliberately not configurable here.
Invalid config files are reported and ignored.

### Managing defaults from the CLI

You do not have to hand-write that file:

```bash
create-ts-lib config path                 # print the resolved config path
create-ts-lib config get                  # print every set key
create-ts-lib config get license          # print one key
create-ts-lib config set license MIT      # set a key (validated before writing)
create-ts-lib config unset license        # remove a key
```

Boolean keys take `true` or `false`. Unknown keys and invalid values are
rejected without touching the file, and writes are atomic.

You can also save the answers from a scaffold run:

```bash
npx @hbmartin/create-ts-lib my-lib --save-defaults
```

That persists only the reusable answers — never the project name, description,
repo URL, copyright year, or workspace mode.

Pass `--config <path>` to any of these (and to a scaffold run) to read and write
somewhere other than the default location, which is useful in CI and for
project-local presets.

## Prompt Flow

The generator asks for:

| Prompt                                                     | Default                                          | Notes                                                                                                                      |
| ---------------------------------------------------------- | ------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------- |
| Project name                                               | directory arg or `my-lib`                        | Used as the package name; must be npm-name compatible and is checked against npm; `--name` skips the prompt                |
| Description                                                | empty string                                     | Written to `package.json`; `--description` skips the prompt                                                                |
| Author                                                     | `git config user.name` + `git config user.email` | Combined as `Name <email>` when available; `--author` skips the prompt                                                     |
| License                                                    | `Apache-2.0`                                     | `Apache-2.0`, `MIT`, `ISC`, `UNLICENSED`; `--license` skips the prompt                                                     |
| Lint and format tooling                                    | `Oxlint + Oxfmt`                                 | `Oxlint + Oxfmt` or `Biome`; automation can pass `--lint-format oxlint-oxfmt` or `--lint-format biome`                     |
| Build tool                                                 | `tsc`                                            | `tsc` or `tsdown`; automation can pass `--bundler tsc` or `--bundler tsdown`                                               |
| GitHub repo URL                                            | existing personal GitHub repo found by `gh`      | Missing repos can be created public/private or entered manually; normalizes SSH remotes; `--repo-url` skips the flow       |
| Include Codecov?                                           | `yes`                                            | Adds a Codecov upload step to pnpm-generated CI; automation can pass `--no-codecov` to omit it                             |
| Include CodeQL and Scorecard workflows?                    | `no`                                             | Adds SHA-pinned `codeql.yml` and `scorecard.yml` for pnpm + GitHub projects; automation can pass `--security-workflows`    |
| Include CONTRIBUTING, CODE_OF_CONDUCT, and SECURITY files? | `no`                                             | Adds the three community-health files OpenSSF Scorecard grades; automation can pass `--community-files`                    |
| Scaffold as a workspace package?                           | `yes` when a workspace is detected               | Only asked when a parent workspace is found; omits root-owned files. Automation can pass `--workspace` or `--no-workspace` |
| Include CLI entry point?                                   | `no`                                             | Adds `bin`, `meow`, `source/cli.ts`, and CLI coverage; automation can pass `--cli` or `--no-cli`                           |
| Include Zod?                                               | `no`                                             | Adds `zod` as a runtime dependency and Zod guidance to generated `AGENTS.md`; automation can pass `--zod`                  |
| Also publish to JSR?                                       | `no`                                             | Adds `jsr.json`, pinned `jsr` tooling, a `jsr:publish` script, and a JSR release step; automation can pass `--jsr`         |
| Package manager                                            | `pnpm`                                           | `pnpm`, `npm`, or `yarn`; generated CI is pnpm-only                                                                        |

Defaults come from your [personal defaults file](#personal-defaults) when one
exists, then from git detection and the built-in values. Any prompt whose value
was provided as a CLI flag is skipped.

After the final project name is accepted, interactive mode starts a `gh` lookup for a matching personal GitHub repository while it continues asking local project prompts. Existing repos are offered as the repo URL default. When no matching repo exists, the CLI lets you create a public or private repo with `gh repo create` after the scaffold summary and before files are written; `--dry-run` shows the predicted URL and skips creation. When `gh` is unavailable, unauthenticated, or returns an unexpected error, the CLI warns and asks for a repo URL with no default. Passing `--repo-url` skips the lookup and prompts entirely.

If the project name already exists on npm, interactive mode warns and lets you rename it or continue anyway. `--yes` uses defaults directly, still uses `git remote origin` as the GitHub repo URL default for generated metadata such as `package.json` repository fields, warns on an existing npm name, and continues without `gh` lookup, repo creation, or remote setup (unless `--repo-url` is passed explicitly, which also configures the `origin` remote). If `@inquirer/prompts` cannot load, the CLI prints a warning and falls back to a basic readline prompt implementation.

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
│       ├── release.yml         # pnpm + GitHub repo URL only
│       ├── codeql.yml          # optional (--security-workflows)
│       └── scorecard.yml       # optional (--security-workflows)
├── .vscode/
│   ├── extensions.json
│   └── settings.json
├── AGENTS.md
├── CODE_OF_CONDUCT.md          # optional (--community-files)
├── CONTRIBUTING.md             # optional (--community-files)
├── SECURITY.md                 # optional (--community-files)
├── .create-ts-lib.json         # scaffold state used by the update command
├── .fallowrc.jsonc
├── .gitignore
├── biome.jsonc                # Biome projects only
├── .oxfmtrc.json              # Oxlint + Oxfmt projects only
├── .oxlintrc.json             # Oxlint + Oxfmt projects only
├── jsr.json                    # optional (--jsr)
├── lefthook.yml
├── pnpm-workspace.yaml         # pnpm only
├── package.json
├── README.md
├── renovate.json               # GitHub repo URL only
├── semgrep.yml
├── tsconfig.json
├── tsconfig.build.json         # tsc bundler only
├── tsdown.config.ts            # tsdown bundler only
├── vitest.config.ts
└── LICENSE
```

GitHub CI and release workflows are generated only for pnpm projects when a GitHub repo URL is provided; the optional CodeQL and Scorecard workflows follow the same rule. The CLI file and `bin` mapping are generated only when CLI support is enabled. Pnpm projects include `pnpm-workspace.yaml` so Lefthook's install script is allowed explicitly. The `.vscode/` files recommend and configure the editor extension matching the chosen lint tooling (Biome or Oxc) with format-on-save enabled.

For a deeper explanation of what each file does, read the
[generated project tour](docs/generated-project-tour.md).

## Generated Defaults

Generated packages include:

- `version: "0.1.0"`
- `type: "module"`
- `packageManager` matching this generator's pnpm version for pnpm projects
- a package-manager-specific `@types/node` pin via `overrides`,
  `pnpm.overrides`, or `resolutions`
- `exports` pointing at `dist/index.js` and `dist/index.d.ts`
- `engines.node: ">=24"`
- `@sindresorhus/tsconfig`
- a `tsc` build by default, or a `tsdown` bundler build when selected
- `oxlint` and `oxfmt` by default, or `@biomejs/biome` when selected
- matching lint/format scripts and config files for the selected tooling
- VS Code extension recommendations and format-on-save settings for the
  selected tooling
- fallow architecture and dependency checks
- Semgrep policy checks
- Vitest with v8 coverage and 80% thresholds
- SHA-pinned GitHub Actions CI and release workflows for pnpm projects, with
  npm publishing via OIDC trusted publishing and provenance
- optional SHA-pinned CodeQL and Scorecard workflows when selected
- optional `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md` (Contributor Covenant 2.1),
  and `SECURITY.md` when selected — the three files OpenSSF Scorecard grades, so
  they pair naturally with the security workflows
- a Renovate config whenever a GitHub repo URL is provided
- Lefthook with a lint-only `pre-commit` hook
- optional `zod` runtime dependency when selected
- optional JSR publishing (`jsr.json`, pinned `jsr` tooling, a `jsr:publish`
  script, and a release workflow step) when selected
- `meow` and CLI coverage only when CLI support is enabled, including a CLI test
  mock with default `flags` and `input`
- `@arethetypeswrong/cli` and `publint` release checks
- `check`, `deps:lint`, `security:lint`, `prepublishOnly`, `publint`,
  `types:lint`, `verify:artifacts`, `verify:package`, `size:report`, and
  `release:check` scripts
- `AGENTS.md` with opinionated guidance for Codex and other coding agents
- a `.create-ts-lib.json` state file so `create-ts-lib update` can re-sync
  tooling files later
- `Apache-2.0` license by default, stamped with the scaffold year and recorded in
  `.create-ts-lib.json` so `update` never rewrites your copyright year later

**Versioning:** generated packages start at `0.1.0`, signaling a pre-1.0 library where minor bumps may carry breaking changes until you cut `1.0.0`. You own the version with `pnpm version` — nothing bumps it for you.

**Release automation:** rather than bundling release-please or changesets, pnpm projects with a GitHub repo URL include a lightweight release workflow that publishes to npm when you publish a GitHub release. This keeps versioning fully in your hands while still automating the npm publish. The workflow authenticates with [npm trusted publishing](https://docs.npmjs.com/trusted-publishers) (OIDC) and publishes with provenance — no long-lived `NPM_TOKEN` secret required. The generated README documents the one-time trusted-publisher setup.

## Workspace Mode

When the generator finds a workspace manifest above the target directory, it
offers to scaffold the new package as a **workspace package**. Detection looks
for a `pnpm-workspace.yaml` or a `package.json` with a `workspaces` field,
searching upward but never past the enclosing Git repository. A manifest whose
only package pattern is `"."` — the single-package pnpm idiom this generator
itself emits — is deliberately ignored, so a standalone generated project is
never mistaken for a monorepo root.

In workspace mode the generator omits the files a repository root already owns:

| Omitted (root-owned)  | Still generated                            |
| --------------------- | ------------------------------------------ |
| `.gitignore`          | `package.json`, `tsconfig.json`            |
| `.github/workflows/*` | `vitest.config.ts`, `.fallowrc.jsonc`      |
| `renovate.json`       | `semgrep.yml`, `scripts/security-lint.mjs` |
| `.vscode/*`           | lint/format config, `source/`, `test/`     |
| `lefthook.yml`        | `README.md`, `LICENSE`, `AGENTS.md`        |
| `pnpm-workspace.yaml` | `.create-ts-lib.json`                      |

The generated `package.json` also drops `packageManager`, the `prepare` hook,
and the `lefthook` devDependency, since the root pins all three. Git setup is
skipped entirely — the workspace repository owns it.

**Workspace mode never writes outside the target directory.** Registering the
package in the parent workspace globs is left to you, and the printed next steps
say so. Pass `--workspace` or `--no-workspace` to skip the prompt; under `--yes`
a detected workspace enables the mode automatically and the scaffold summary
reports it.

## Post-Scaffold Behavior

Before creating a GitHub repo or writing files, the generator rejects non-empty target directories unless `--force` is provided. After writing files, it performs:

1. `git init` when the target directory is not already inside a Git repository
2. `git remote add origin <repo-url>` when a repo URL is provided and the target is its own Git repository
3. `<package-manager> install`
4. `<package-manager> run build`
5. `<package-manager> run test`

`--skip-git` skips step 1–2 and `--skip-install` skips steps 3–5; the printed next steps then include the commands you skipped. Remote setup is best-effort: if the target is inside a parent Git repository, or if `origin` already exists, the CLI reports the issue and continues. The CLI prints a summary before writing and shows progress during post-scaffold setup. When a repo URL is configured interactively or passed with `--repo-url` (and `--skip-git` is not set), the final next steps include `git add`, `git commit`, and `git push -u origin HEAD`. When Codecov is enabled for a pnpm project with a GitHub repo URL, the final next steps also include the Codecov setup URL for that repository. In non-TTY or CI environments it uses plain step logs instead of spinners. If a setup command fails after files are written, the CLI prints the created project path and the commands to retry the failed and remaining setup steps.

## Updating a Generated Project

Generated projects include a `.create-ts-lib.json` state file recording the
scaffold configuration and a hash of every generated file. When a new
`create-ts-lib` release improves the templates, re-sync from inside the
project (or pass its path):

```bash
npx @hbmartin/create-ts-lib update              # plan + choose + apply
npx @hbmartin/create-ts-lib update --dry-run    # preview only
npx @hbmartin/create-ts-lib update --force      # also overwrite files you changed
npx @hbmartin/create-ts-lib update --yes        # apply every safe update, no prompt
npx @hbmartin/create-ts-lib update --no-backup  # skip .orig backups
```

For every generated file, the update command reports one of:

| Status   | Meaning                                                               |
| -------- | --------------------------------------------------------------------- |
| `ok`     | Already matches the current template                                  |
| `update` | Unmodified since scaffolding — safely rewritten with the new template |
| `create` | Missing on disk — recreated                                           |
| `skip`   | You modified it after scaffolding — left alone unless `--force`       |

Files you have edited (usually `package.json`, `source/`, and `test/`) are
detected via the recorded hashes and never overwritten by default. After an
update that touches `package.json`, re-run your package manager's install.

### Choosing what to apply

Interactively, `update` prints the plan and then offers three choices:

- **Apply all** — write every pending file
- **Choose files…** — pick individual files from a checklist
- **Cancel** — write nothing

`--yes` applies every pending file without prompting.

### Backups

When `--force` overwrites a file you modified, your previous contents are kept
alongside it as `<file>.orig` before the new template is written, and the paths
are printed. Generated `.gitignore` files ignore `*.orig`. Files that were never
modified are not backed up — there is nothing to lose. Pass `--no-backup` to opt
out.

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

- `defaultScaffoldConfig(overrides?)`
- `buildProjectFiles(config)`
- `scaffoldProject(config, options)`
- `readScaffoldState(targetDirectory)`
- `planUpdate(targetDirectory, state)`
- `applyUpdatePlan(targetDirectory, plan, options?)`
- `Bundler`, `LicenseName`, `PackageManager`
- `GeneratedFile`
- `ScaffoldConfig`
- `ScaffoldConfigOverrides`
- `ScaffoldOptions`
- `ScaffoldProgress`
- `ScaffoldState`, `UpdateFileStatus`, `UpdatePlan`, `UpdatePlanEntry`

`ScaffoldConfig` is a complete required config shape. Use `defaultScaffoldConfig()` to start from the documented defaults and override only the project-specific values. `undefined` override values are ignored, preserving the documented defaults. `defaultScaffoldConfig()` also fills `copyrightYear` with the current UTC year; pass it explicitly to render a project deterministically.

`buildProjectFiles(config)` renders the whole project to an in-memory
`GeneratedFile[]` (`{ path, content, executable? }`) without touching the
filesystem. It is a pure function of its config, so it is the entry point to use
for previewing a scaffold, diffing template changes, or writing to a virtual
filesystem.

`scaffoldProject` writes the generated project, rejects invalid package names, refuses non-empty target directories unless `force: true` is set, can optionally receive progress callbacks for post-scaffold steps, and can add a best-effort `origin` remote with `gitRemoteOriginUrl`. `skipGit: true` and `skipInstall: true` skip the corresponding post-scaffold steps.

`readScaffoldState`, `planUpdate`, and `applyUpdatePlan` power the `update`
command programmatically: read a project's `.create-ts-lib.json`, classify
every generated file (`up-to-date`, `update`, `create`, or `skip-modified`),
and apply the safe subset.

```ts
import { defaultScaffoldConfig, scaffoldProject } from "@hbmartin/create-ts-lib";

const config = defaultScaffoldConfig({
  projectName: "my-lib",
  description: "An example library",
  author: "Jane Doe <jane@example.com>",
  githubRepoUrl: "https://github.com/jane/my-lib",
});

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
release checks. Set `SMOKE_INCLUDE_CLI=true` or `false` to run one variant,
`SMOKE_LINT_FORMAT=biome` to exercise the Biome stack, `SMOKE_BUNDLER=tsdown`
to exercise the tsdown build, and `SMOKE_DIR` to choose the generated project
directory. CI runs the oxlint-oxfmt/tsc matrix on Node 24 and 26, plus Biome and
tsdown variants on Node 24, matching the `engines.node` floor of the projects it
generates.

Template assets live under `source/templates/assets` and are copied into `dist/templates/assets` during `pnpm build`.

## Contributing

Contributions are welcome — see [CONTRIBUTING.md](CONTRIBUTING.md) and the [Code of Conduct](CODE_OF_CONDUCT.md).

## License

[Apache-2.0](LICENSE) © Harold Martin.

Generated projects default to the `Apache-2.0` license as well; you can choose `MIT`, `ISC`, or `UNLICENSED` during the prompt flow.
