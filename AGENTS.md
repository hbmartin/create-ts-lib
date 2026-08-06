# AGENTS.md

Guidance for Codex and other coding agents working in this repository lives in
[`CLAUDE.md`](CLAUDE.md). **Read it first** — it is the authoritative source, and
it is not Claude-specific.

It covers the scaffold pipeline, the invariants that constrain any change, and
pointers into:

- [`docs/extending-the-generator.md`](docs/extending-the-generator.md) — changing
  what gets scaffolded.
- [`docs/checks-and-tests.md`](docs/checks-and-tests.md) — commands, smoke tests,
  and how generated output is verified.
- [`docs/generated-project-tour.md`](docs/generated-project-tour.md) — what a
  generated project contains.

Before handoff, run `pnpm run release:check`.

This file is deliberately a pointer. Guidance added here instead of `CLAUDE.md`
will drift out of sync with it.
