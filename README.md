# `@hbmartin/create-ts-lib`

An opinionated initializer for TypeScript libraries.

It scaffolds a Node 22+ ESM library with TypeScript, strict Biome linting, Oxc lint/format tooling, Vitest coverage, Lefthook, publint, optional GitHub Actions CI, semantic PR checks, optional Codecov upload, and an optional CLI entry point.

## Usage

```bash
pnpm create ts-lib my-lib
npm create ts-lib my-lib
npx create-ts-lib my-lib
```

Run without `--yes` to answer prompts:

```bash
create-ts-lib my-lib
```

Use defaults without prompts:

```bash
create-ts-lib my-lib --yes
```

Preview the target options and file list without writing files:

```bash
create-ts-lib my-lib --dry-run
```

## Prompt Flow

The generator asks for:

| Prompt                   | Default                                          | Notes                                         |
| ------------------------ | ------------------------------------------------ | --------------------------------------------- |
| Project name             | directory arg or `my-lib`                        | Used as the package name                      |
| Description              | empty string                                     | Written to `package.json`                     |
| Author                   | `git config user.name` + `git config user.email` | Combined as `Name <email>` when available     |
| License                  | `MIT`                                            | `MIT`, `ISC`, `Apache-2.0`, `UNLICENSED`      |
| GitHub repo URL          | detected from `git remote origin`                | Normalizes `git@github.com:` remotes to HTTPS |
| Include Codecov?         | `yes`                                            | Adds a Codecov upload step to generated CI    |
| Include CLI entry point? | `no`                                             | Adds `bin`, `meow`, and `source/cli.ts`       |
| Package manager          | `pnpm`                                           | `pnpm`, `npm`, or `yarn`                      |

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
│       ├── ci.yml
│       └── semantic-pr.yml
├── .gitignore
├── biome.jsonc
├── lefthook.yml
├── pnpm-workspace.yaml # pnpm only
├── package.json
├── tsconfig.json
├── tsconfig.build.json
├── vitest.config.ts
└── LICENSE
```

GitHub workflows are generated only when a GitHub repo URL is provided. The CLI file and `bin` mapping are generated only when CLI support is enabled.
Pnpm projects include `pnpm-workspace.yaml` to allow Lefthook's install script explicitly.

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

Release-please is not generated.

## Post-Scaffold Behavior

After writing files, the generator performs:

1. `git init` when the target directory is not already inside a Git repository
2. `<package-manager> install`
3. `<package-manager> run build`
4. `<package-manager> run test`

The CLI prints a summary before writing and shows progress during post-scaffold setup. In non-TTY or CI environments it uses plain step logs instead of spinners.

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
pnpm publint --pack npm
pnpm attw --pack . --profile esm-only
```

Template assets live under `source/templates/assets` and are copied into `dist/templates/assets` during `pnpm build`.

## Programmatic API

The package exports:

- `scaffoldProject(config, options)`
- `ScaffoldConfig`
- `ScaffoldProgress`

`scaffoldProject` writes the generated project and can optionally receive progress callbacks for post-scaffold steps.
