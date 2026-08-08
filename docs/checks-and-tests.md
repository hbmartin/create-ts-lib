# Checks and Tests

Every command is in `package.json`; this page records the parts that are not
obvious from reading it.

## Commands

```bash
pnpm run check          # lint + typecheck + deps:lint + security:lint + test:coverage
pnpm run release:check  # check + build + verify:artifacts + publint + types:lint + verify:package
```

`check` runs its steps in the same order CI does, so a local failure reproduces
the CI failure. `release:check` is `prepublishOnly` followed by
`verify:package`, which means the pre-publish gate is exercised locally rather
than first discovered during a release.

| Command                   | Runs                                                      |
| ------------------------- | --------------------------------------------------------- |
| `pnpm run lint`           | `biome check --error-on-warnings` + `oxlint --deny-warnings` + `oxfmt --check` |
| `pnpm run format`         | `oxfmt . --write`                                          |
| `pnpm run typecheck`      | `tsc -p tsconfig.typecheck.json --noEmit` — source **and** test |
| `pnpm run deps:lint`      | `fallow dead-code` — the architecture gate, configured in `.fallowrc.jsonc` |
| `pnpm run security:lint`  | `scripts/security-lint.mjs` — Semgrep against `semgrep.yml` |
| `pnpm run build`          | `scripts/build.mjs` — `tsc` plus a recursive copy of `source/templates/assets` into `dist/templates/assets` |
| `pnpm run verify:artifacts` | `scripts/verify-artifacts.mjs` — asserts compiled entry points and every template asset landed in `dist/` |
| `pnpm run types:lint`     | `attw --pack . --profile esm-only`                         |
| `pnpm run smoke:scaffold` | Builds, scaffolds real projects into a temp dir, installs them, and runs their generated checks |

`deps:lint` runs inside `check`, which runs before `build` — so it sees `dist/`
only on a machine where a build already happened. That made it pass locally and
fail on a clean CI checkout, on `scripts/smoke-test-scaffold.mjs` importing the
built package. Nothing in the gate may depend on build output being present:
that one import carries a `// fallow-ignore-next-line unresolved-import`, which
is also why `stale-suppressions` stays off (the suppression is inert whenever
`dist/` exists).

`security:lint` prefers a `semgrep` already on `PATH` and falls back to
`uvx semgrep@<pinned>`. When neither is available it explains how to install one
and exits non-zero, so `check` and `release:check` cannot pass without the scan
having run. Set `SECURITY_LINT_FORCE_UVX=1` to exercise the fallback path.

## Running single tests

```bash
pnpm exec vitest run test/scaffold.test.ts
pnpm exec vitest run test/scaffold.test.ts -t "generates a README"
pnpm exec vitest run test/generated-output-snapshot.test.ts -u   # accept golden-file changes
```

Coverage thresholds are 90% for branches, functions, lines, and statements over
`source/**` (`vitest.config.ts`).

## Smoke tests

`pnpm run smoke:scaffold` is env-driven. It scaffolds into a temp directory
unless `SMOKE_DIR` says otherwise, then installs from a frozen lockfile and runs
each generated project's own release checks.

| Variable                | Values                       | Default        |
| ----------------------- | ---------------------------- | -------------- |
| `SMOKE_INCLUDE_CLI`     | `true`, `false`, `all`       | `all` (both)   |
| `SMOKE_LINT_FORMAT`     | `oxlint-oxfmt`, `biome`      | `oxlint-oxfmt` |
| `SMOKE_BUNDLER`         | `tsc`, `tsdown`              | `tsc`          |
| `SMOKE_PACKAGE_MANAGER` | `pnpm`                       | `pnpm`         |
| `SMOKE_DIR`             | a path                       | a temp dir     |

`SMOKE_INCLUDE_CLI=true` or `false` pins a single variant instead of running
both, which roughly halves the run while iterating.

## How generated output is verified

Two complementary styles. A change to templates usually touches both.

**Structural assertions** — `test/scaffold.test.ts` and most others call
`buildProjectFiles(config)`, find the file they care about, and assert the
specific lines or fields that matter. This is the primary style: it keeps tests
readable and makes an intentional change explicit in the diff. Prefer it for new
behavior.

**Golden files** — `test/generated-output-snapshot.test.ts` serializes five
whole-project configs end to end into
`test/__snapshots__/generated-output/*.snap`, so *unintended* drift shows up in
the diff even where no assertion covers it. The generator version inside the
state file is redacted so version bumps do not churn them. Update with `-u`,
then read the diff rather than accepting it blindly.

## Cross-cutting guards

`test/` mirrors `source/`, plus a few tests that guard the repo rather than a
single module:

- **`architecture-gate`** — runs the real generated `.fallowrc.jsonc` against
  temp fixtures containing deliberate violations (source→test import, cycle,
  unresolved import, undeclared dep, dev dep in production, unused dev dep) plus
  a clean control case. It exists because the gate has twice reported success
  while analysing nothing. Keep these tests meaningful rather than adjusting
  them to pass.
- **`generated-formatting`** — renders a project and runs the real formatter that
  project was given (Biome or oxfmt) over it, for both toolings and for minimal
  and every-feature answers, plus a control case that plants a misformatted file
  so a run that checked nothing cannot pass. Nothing in this repo formats the
  template assets — oxfmt ignores JSON, JSONC, YAML and Markdown, Biome excludes
  `source/templates/assets`, and `.tmpl` keeps the rest out of both — so an asset
  the generated formatter would reprint used to reach a user before anything
  noticed. `.fallowrc.jsonc` and `jsr.json` both shipped that way.
- **`state-compatibility`** — parses deliberately stale fixtures in
  `test/__fixtures__/state/` so a new `scaffoldConfigSchema` field without a
  `.default()` fails here instead of in someone's `update`.
- **`workflow-action-refs`** — fails when this repo's own workflows drift from
  `githubActionRefs`, because Renovate cannot see the copies emitted into
  generated projects.
- **`security-lint`** — checks the Semgrep rules themselves. Most of it runs
  against fake `semgrep`/`uvx` shims, so only one test needs a real runner; it is
  skipped when neither `semgrep` nor `uvx` is on `PATH`. A `beforeAll` warms the
  pinned `uvx semgrep@<version>` install so a cold uv cache is not charged
  against that test's timeout — without it the first run on a fresh machine fails
  on the download rather than on a rule.
- **`generated-output-snapshot`** — the golden files described above.
