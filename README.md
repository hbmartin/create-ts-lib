# `@hbmartin/create-ts-lib`

[![npm version](https://img.shields.io/npm/v/@hbmartin/create-ts-lib.svg)](https://www.npmjs.com/package/@hbmartin/create-ts-lib)
[![CI](https://github.com/hbmartin/create-ts-lib/actions/workflows/ci.yml/badge.svg)](https://github.com/hbmartin/create-ts-lib/actions/workflows/ci.yml)
[![npm downloads](https://img.shields.io/npm/dm/@hbmartin/create-ts-lib.svg)](https://www.npmjs.com/package/@hbmartin/create-ts-lib)
[![license](https://img.shields.io/npm/l/@hbmartin/create-ts-lib.svg)](LICENSE)

An opinionated initializer for TypeScript libraries.

It scaffolds a Node 22+ ESM library with TypeScript, strict Biome linting, Oxc lint/format tooling, Vitest coverage, Lefthook, publint, optional GitHub Actions CI, optional Codecov upload, and an optional CLI entry point.

## Contents

- [Why this tool](#why-this-tool)
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
- **Biome + Oxc** for fast linting and formatting instead of ESLint + Prettier.
- **Vitest** with v8 coverage and enforced thresholds out of the box.
- **Lefthook** for lightweight pre-commit hooks.
- **publint + are-the-types-wrong** wired in so your published package is correct before you ship it.

If you'd rather not maintain this boilerplate by hand — or you want every library you publish to share one consistent setup — this gets you from zero to a building, testing, lint-clean package in one command.

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
| `--help`, `-h`    | Print usage and exit                            |
| `--version`, `-v` | Print the CLI version and exit                  |

## Prompt Flow

The generator asks for:

| Prompt                   | Default                                          | Notes                                                 |
| ------------------------ | ------------------------------------------------ | ----------------------------------------------------- |
| Project name             | directory arg or `my-lib`                        | Used as the package name; must be npm-name compatible |
| Description              | empty string                                     | Written to `package.json`                             |
| Author                   | `git config user.name` + `git config user.email` | Combined as `Name <email>` when available             |
| License                  | `Apache-2.0`                                     | `Apache-2.0`, `MIT`, `ISC`, `UNLICENSED`              |
| GitHub repo URL          | detected from `git remote origin`                | Normalizes `git@github.com:` remotes to HTTPS         |
| Include Codecov?         | `yes`                                            | Adds a Codecov upload step to pnpm generated CI       |
| Include CLI entry point? | `no`                                             | Adds `bin`, `meow`, and `source/cli.ts`               |
| Package manager          | `pnpm`                                           | `pnpm`, `npm`, or `yarn`; generated CI is pnpm-only   |

`--yes` uses those defaults directly. If `@inquirer/prompts` cannot load, the CLI prints a warning and falls back to a basic readline prompt implementation.

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
│       ├── ci.yml              # pnpm + GitHub repo URL only
│       └── release.yml         # pnpm + GitHub repo URL only
├── .gitignore
├── biome.jsonc
├── lefthook.yml
├── pnpm-workspace.yaml         # pnpm only
├── package.json
├── README.md
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
- `exports` pointing at `dist/index.js` and `dist/index.d.ts`
- `engines.node: ">=22"`
- `@sindresorhus/tsconfig`
- strict Biome linting with formatting disabled
- `oxlint` and `oxfmt`
- Vitest with v8 coverage and 80% thresholds
- Lefthook with a lint-only `pre-commit` hook
- `zod` as a default runtime dependency
- `meow` only when CLI support is enabled
- `@arethetypeswrong/cli` and `publint` release checks
- `check`, `prepublishOnly`, `publint`, `types:lint`, `verify:artifacts`,
  `verify:package`, `size:report`, and `release:check` scripts
- `Apache-2.0` license by default

Release-please is not generated. Pnpm projects with a GitHub repo URL include a release workflow that publishes to npm when a GitHub release is published.

## Post-Scaffold Behavior

Before writing files, the generator rejects non-empty target directories unless `--force` is provided. After writing files, it performs:

1. `git init` when the target directory is not already inside a Git repository
2. `<package-manager> install`
3. `<package-manager> run build`
4. `<package-manager> run test`

The CLI prints a summary before writing and shows progress during post-scaffold setup. In non-TTY or CI environments it uses plain step logs instead of spinners.

## Next Steps After Scaffolding

Once the generator finishes, your library already builds, lints, and tests. To publish it:

```bash
cd my-lib
# write your code in source/, then:
pnpm run check          # lint + typecheck + coverage
pnpm run release:check  # package validation + npm publish dry run
pnpm run size:report    # packed package size report
pnpm version patch      # or minor / major
git push --follow-tags
```

For pnpm projects with a GitHub repo URL, publishing a GitHub release for the pushed tag runs the generated npm publish workflow. Prereleases publish with the `next` tag; normal releases publish with `latest`.

`prepublishOnly`-style validation (`verify:artifacts`, `publint`, are-the-types-wrong,
and a dry-run publish) is wired into the generated package so packaging problems surface
before you ship.

## Programmatic API

The package exports:

- `scaffoldProject(config, options)`
- `ScaffoldConfig`
- `ScaffoldOptions`
- `ScaffoldProgress`

`scaffoldProject` writes the generated project, rejects invalid package names, refuses non-empty target directories unless `force: true` is set, and can optionally receive progress callbacks for post-scaffold steps.

```ts
import { scaffoldProject, type ScaffoldConfig } from "@hbmartin/create-ts-lib";

const config: ScaffoldConfig = {
  projectName: "my-lib",
  description: "An example library",
  author: "Jane Doe <jane@example.com>",
  license: "Apache-2.0",
  githubRepoUrl: "https://github.com/jane/my-lib",
  packageManager: "pnpm",
  includeCodecov: true,
  includeCli: false,
};

await scaffoldProject(config, {
  targetDirectory: "./my-lib",
  force: false,
  postScaffold: true, // run git init + install + build + test
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
pnpm run typecheck
pnpm run test
pnpm run test:coverage
pnpm run build
pnpm publint --pack pnpm
pnpm attw --pack . --profile esm-only
```

Template assets live under `source/templates/assets` and are copied into `dist/templates/assets` during `pnpm build`.

## Contributing

Contributions are welcome — see [CONTRIBUTING.md](CONTRIBUTING.md) and the [Code of Conduct](CODE_OF_CONDUCT.md).

## License

[Apache-2.0](LICENSE) © Harold Martin.

Generated projects default to the `Apache-2.0` license as well; you can choose `MIT`, `ISC`, or `UNLICENSED` during the prompt flow.
