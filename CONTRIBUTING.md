# Contributing

## Setup

Use Node 22 or newer and pnpm 10.

```bash
pnpm install
```

The install step also installs Lefthook. The local pre-commit hook runs the same lint command used by CI.

## Development

Useful checks:

```bash
pnpm run lint
pnpm typecheck
pnpm test
pnpm build
```

Generated project templates live in `source/templates/assets` and are copied into `dist` during `pnpm build`.
When changing generated output, update structural tests rather than adding snapshots.

## Release

This repository does not use release-please. Keep release automation changes explicit and separate from scaffold output changes.
