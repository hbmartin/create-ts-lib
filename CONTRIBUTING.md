# Contributing

## Setup

Use Node 24 or newer and pnpm 11.5.2.

```bash
pnpm install
```

The install step also installs Lefthook. The local pre-commit hook runs the same lint command used by CI.

## Development

Useful checks:

```bash
pnpm run lint        # Biome + oxlint + oxfmt --check
pnpm run typecheck   # tsc --noEmit
pnpm run deps:lint   # fallow architecture and dependency rules
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

[`docs/checks-and-tests.md`](docs/checks-and-tests.md) documents every command in
detail, the full `SMOKE_*` environment matrix, and the cross-cutting guard tests.

## How scaffolding works

The generator turns a `ScaffoldConfig` into a list of files, then writes them:

1. **Prompts** (`source/prompts.ts`, `source/cli.ts`) collect a `ScaffoldConfig`.
2. **`buildProjectFiles(config)`** (`source/templates/files.ts`) returns a
   `GeneratedFile[]` — each entry is a `{ path, content }` pair (plus an optional
   `executable` flag).
3. **`scaffoldProject`** (`source/scaffold.ts`) writes those files to disk and
   runs post-scaffold setup (git init, install, build, test).

## Changing generated output

[`docs/extending-the-generator.md`](docs/extending-the-generator.md) is the
reference for this — template rendering, version pinning, the `update` classifier,
and workspace mode. Two procedures carry hard requirements:

**Adding a new generated file.** A `*.tmpl` asset under `source/templates/assets/`
is copied into `dist/templates/assets/` automatically by `scripts/build.mjs`, so
no copy wiring is needed. But copying is not emitting: the file only reaches a
scaffolded project once `buildProjectFiles` returns it, and only survives publish
once `scripts/verify-artifacts.mjs` covers it (automatic for `.tmpl` assets, a
hand-listed array for compiled entry points). Add a structural test in
`test/scaffold.test.ts` too.

**Adding a new `ScaffoldConfig` option.** Four steps, of which step 2 is
load-bearing: the `scaffoldConfigSchema` entry in `source/templates/state.ts`
needs a `.default()`. This is not optional — generated projects carry a
`.create-ts-lib.json` written by whichever release scaffolded them, and
`create-ts-lib update` has to keep parsing those older files. A field without a
default breaks `update` for every project already on disk.
`test/state-compatibility.test.ts` guards this against frozen fixtures in
`test/__fixtures__/state/`. Those fixtures are deliberately stale; do not
regenerate them to make a failure go away — add the `.default()` instead.

## Tests

Generated output is verified two ways, and a template change usually touches both:

- **Structural assertions** — a test calls `buildProjectFiles(config)`, finds the
  file it cares about, and asserts the specific lines or fields that matter (see
  `test/scaffold.test.ts`). This is the primary style: it keeps tests readable and
  makes intentional changes explicit in the diff. Prefer it for new behavior.
- **Golden files** — `test/generated-output-snapshot.test.ts` serializes five
  whole-project configs into `test/__snapshots__/generated-output/`, so
  *unintended* drift shows up even where no assertion covers it. Update with
  `pnpm exec vitest run test/generated-output-snapshot.test.ts -u` and read the
  diff rather than accepting it blindly.

When you change generated output, update `README.md` and
`docs/generated-project-tour.md` in the same commit.

## Release

This repository does not use release-please. Keep release automation changes
explicit and separate from scaffold output changes.
