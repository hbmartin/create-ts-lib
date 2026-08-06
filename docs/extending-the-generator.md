# Extending the Generator

How to change what `create-ts-lib` emits. Read
[`CLAUDE.md`](../CLAUDE.md) first for the pipeline and the invariants that
constrain everything below.

## Adding a `ScaffoldConfig` field

All four steps, every time:

1. Add the field to `ScaffoldConfig` and to `defaultScaffoldConfigValues` in
   `source/templates/scaffold-config.ts`.
2. Add it to `scaffoldConfigSchema` in `source/templates/state.ts` **with a
   `.default()`**. This is not optional. Generated projects carry a
   `.create-ts-lib.json` written by whichever release scaffolded them, and
   `create-ts-lib update` has to keep parsing those older files — a field
   without a default breaks `update` for every project already on disk.
   `test/state-compatibility.test.ts` guards this against the deliberately
   stale fixtures in `test/__fixtures__/state/`. Do not regenerate those
   fixtures to make a failure go away; add the `.default()` instead.
3. If it is a reusable preference rather than a per-project answer, add it to
   `userConfigSchema` in `source/user-config.ts` **and** to the
   `userConfigValueParsers` table beside it. The table is typed so a missing
   entry fails to compile.
4. Add the CLI flag in `source/cli-helpers.ts` **and** document it in
   `helpText` in `source/cli.ts`. `test/cli.test.ts` fails if any parsed option
   is undocumented.

Then update the docs listed under
[Changing generated output](#changing-generated-output).

## Adding a generated file

Content that is static (or needs only placeholder substitution) lives as a
`*.tmpl` asset under `source/templates/assets/`. Content that needs real logic —
`package.json`, the README, CI workflows, the Biome config, community files — is
assembled by a `build*` / `render*` function in a sibling module under
`source/templates/`.

1. Add the template asset, or write the `build*` function.
2. **Register it in `buildProjectFiles`** (`source/templates/files.ts`) so it
   ends up in the returned `GeneratedFile[]`. `scripts/build.mjs` copies assets
   into `dist/` automatically, but copying is not emitting — an asset no
   function returns never reaches a scaffolded project.
3. If the published package needs it at runtime, confirm
   `scripts/verify-artifacts.mjs` covers it. It derives the asset list from
   `source/templates/assets/**`, so `.tmpl` files are automatic; the compiled
   entry points are a hand-listed `compiledArtifacts` array.
4. Add a structural assertion in `test/scaffold.test.ts`, and refresh the golden
   files — see [`checks-and-tests.md`](checks-and-tests.md).

Files that a parent repository should own are wrapped in the `rootOwnedFiles`
helper — see [Workspace mode](#workspace-mode).

## Template rendering

`renderTemplate(relativePath, replacements)` lives in
`source/templates/render.ts` (re-exported from `files.ts`). It reads from
`source/templates/assets/`, substitutes every `{{KEY}}`, and then **throws if any
`{{...}}` remains**, listing the unresolved placeholders. A typo'd key fails
loudly at render time rather than shipping a literal placeholder into someone's
project.

One deliberate exception: `${{ ... }}` is left alone, so GitHub Actions
expressions survive in workflow templates.

## Version pinning for generated projects

`source/templates/generated-versions.ts` is the single source of truth for
versions in generated projects. Most specifiers are read out of this repo's own
`package.json` via `readDependencySpecifier`, so the generator and its output
cannot drift apart.

The exceptions are pinned inline as **template-only**, because this repo neither
imports nor runs them: `meow` (a generated project's CLI dependency), and `jsr`
and `tsdown` among the dev dependencies.

`@types/node` is template-only too, but keyed by Node target rather than flat:
`nodeTypesVersionByTarget` holds one caret range per `NodeTarget`, and
`nodeTypesVersion(target)` resolves it. A module-load assertion rejects any
specifier whose major disagrees with its own key, so a pin can never drift off
the `engines.node` floor that `source/node-target.ts` derives from the same
target — and Node 25 stays unreachable without a visible change to the union.
The comment beside the table explains why a generated project's CI matrix cannot
catch a mismatch on its own.

The same module holds `semgrepVersion` and `githubActionRefs`, the SHA-pinned
GitHub Action references. `test/workflow-action-refs.test.ts` fails when this
repo's own workflows drift from `githubActionRefs`, because Renovate updates
`.github/workflows/**` here but cannot see the copies emitted into generated
projects.

## The state file and `update`

Every scaffold writes `.create-ts-lib.json` (`source/templates/state.ts`): the
full config plus a SHA-256 hash of each generated file. `create-ts-lib update`
(`source/update.ts`) re-renders from the stored config and classifies each file:

| Status          | Meaning                                                             |
| --------------- | ------------------------------------------------------------------- |
| `up-to-date`    | Disk already matches the newly rendered content.                     |
| `update`        | Disk matches the recorded hash, so overwriting is safe.              |
| `create`        | The file is absent.                                                  |
| `skip-modified` | The user edited it. Written only with `--force`, keeping a `.orig` backup. |

Because state files on disk were written by older releases, the schema is a
compatibility surface — see step 2 of
[Adding a `ScaffoldConfig` field](#adding-a-scaffoldconfig-field).

Two rules keep the classifier honest across runs. `applyUpdatePlan` rewrites the
state file to describe **what is on disk**, so a partial apply (`options.only`,
the interactive "choose files" path) keeps the previously recorded hash for every
entry it did not write — recording the freshly rendered hash for a skipped file
would make the next run read it as a user edit. And backups never overwrite: a
taken `<file>.orig` steps to `.orig.1`, and the path actually used comes back on
`UpdatePlanEntry.backupPath` for the CLI to print.

## Workspace mode

`config.workspaceMode` means "scaffold a package inside an existing repo." Git
setup is left to the parent, and nothing outside the target directory is ever
written.

A third thing is suppressed, outside the file list: `resolveGitHubRepository` in
`source/cli-prompts.ts` never offers to create a GitHub repository in workspace
mode, and defaults the URL prompt to the detected workspace remote. This is why
`resolveWorkspaceMode` runs before the GitHub prompt rather than after the
feature confirms — it cannot move above the description prompt, though, because
awaiting anything earlier lets the in-flight `gh` lookup settle and breaks the
interleaving `test/cli.test.ts` pins down.

Files the parent repository owns are skipped by **two** separate mechanisms — if
you add a root-owned file, use the one that matches:

- The `rootOwnedFiles` helper in `source/templates/files.ts` wraps `.gitignore`,
  VS Code settings, `lefthook.yml`, `pnpm-workspace.yaml`, and `renovate.json`.
- `hasGitHubWorkflows` in `source/templates/readme.ts` gates the
  `.github/workflows/**` files, because it already had to check
  `githubRepoUrl` and `packageManager`. It returns `false` in workspace mode,
  which also suppresses the CI badge and release section in the generated README.

`source/workspace-detection.ts` auto-detects a workspace root from
`package.json` (`workspaces`, array or Yarn object form) or `pnpm-workspace.yaml`.
It deliberately does **not** treat `packages: ["."]` as a workspace: that is the
single-package pnpm idiom this generator itself emits, and honouring it would
make every standalone generated project look like a workspace root to the next
scaffold.

## Changing generated output

A change to what gets scaffolded is not finished until these are updated in the
same commit:

- `README.md` — flags, prompt flow, the generated layout tree, the defaults table.
- `docs/generated-project-tour.md` — the per-file walkthrough.
- `test/scaffold.test.ts` — the structural assertions.
- `test/__snapshots__/generated-output/*.snap` — the golden files.
