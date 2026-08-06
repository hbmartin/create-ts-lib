# AGENTS.md

Before making any edit, read [`CLAUDE.md`](CLAUDE.md). It is the authoritative
source of guidance for Codex and other coding agents; despite its name, it is
not Claude-specific.

Use pnpm for package management and scripts.

It covers the scaffold pipeline, the invariants that constrain any change, and
pointers into these task-specific guides:

- [`docs/extending-the-generator.md`](docs/extending-the-generator.md) — changing
  generated output, templates, `ScaffoldConfig`, state handling, `update`, or
  workspace mode.
- [`docs/checks-and-tests.md`](docs/checks-and-tests.md) — commands, smoke tests,
  generated-output verification, CI, build, test, lint, or release work.
- [`docs/generated-project-tour.md`](docs/generated-project-tour.md) — what a
  generated project contains.

Before handoff, run `pnpm run release:check`.

Keep detailed guidance in `CLAUDE.md`; keep this file as the concise,
always-loaded entry point for critical rules and task routing.
