# Contributing

## Setup

Use Node 22 or newer and pnpm 11.5.2.

```bash
pnpm install
```

The install step also installs Lefthook. The local pre-commit hook runs the same lint command used by CI.

## Development

Useful checks:

```bash
pnpm run lint        # Biome + oxlint + oxfmt --check
pnpm run typecheck   # tsc --noEmit
pnpm run deps:lint   # dependency-cruiser architecture rules
pnpm run security:lint
pnpm test            # vitest run
pnpm build           # tsc + copy template assets into dist/
pnpm run smoke:scaffold
```

`pnpm run check` runs lint, typecheck, dependency and security checks, and coverage in the same order CI does.
`pnpm run smoke:scaffold` builds the generator, scaffolds pnpm projects with and
without CLI support, installs them from a frozen lockfile, and runs the generated
release checks. Use `SMOKE_INCLUDE_CLI=true` or `false` for a single variant.

To run a single test file or a single case:

```bash
pnpm exec vitest run test/scaffold.test.ts
pnpm exec vitest run test/scaffold.test.ts -t "generates a README"
```

## How scaffolding works

The generator turns a `ScaffoldConfig` into a list of files, then writes them:

1. **Prompts** (`source/prompts.ts`, `source/cli.ts`) collect a `ScaffoldConfig`.
2. **`buildProjectFiles(config)`** (`source/templates/files.ts`) returns a
   `GeneratedFile[]` — each entry is a `{ path, content }` pair (plus an optional
   `executable` flag).
3. **`scaffoldProject`** (`source/scaffold.ts`) writes those files to disk and
   runs post-scaffold setup (git init, install, build, test).

## Changing generated output

Static files live as `*.tmpl` assets under `source/templates/assets/` and are
copied verbatim into `dist/templates/assets/` by `scripts/build.mjs` (a recursive
directory copy — new `.tmpl` files are picked up automatically, no copy wiring
needed).

Placeholders in a template use `{{KEY}}` syntax and are filled in by
`renderTemplate(path, replacements)` in `source/templates/files.ts`. Files whose
content depends on more than simple substitution (for example `package.json`, the
README, and the CI workflow) are assembled by dedicated `build*` functions in the
same file.

To **add a new generated file**:

1. Add the template under `source/templates/assets/` (or write a `build*`
   function if the content is computed).
2. Register it in `buildProjectFiles` so it ends up in the returned list.
3. If it is required for the package to work after publish, add it to the
   `verify:artifacts` check in `package.json` so a missing copy fails the build.
4. Add or update a structural test in `test/scaffold.test.ts`.

## Tests

Generated output is verified with **structural assertions, not snapshots** — a
test calls `buildProjectFiles(config)`, finds the file it cares about, and asserts
the specific lines or fields that matter (see `test/scaffold.test.ts`). When you
change generated output, update these assertions rather than adding snapshot
files; this keeps tests readable and makes intentional changes explicit in the
diff.

## Release

This repository does not use release-please. Keep release automation changes
explicit and separate from scaffold output changes.
