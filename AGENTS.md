# AGENTS.md

Guidance for Codex and other coding agents working in this repository.

## Project Conventions

- Use pnpm for package management and scripts.
- Treat this package as Node 22+ and ESM-only.
- Keep implementation code in `source/` and Vitest coverage in `test/`.
- Keep scaffolded file templates in `source/templates/assets/`, and register emitted files in `source/templates/files.ts`.
- Do not add Prettier. Formatting is handled by oxfmt, and linting is handled by Biome and oxlint.
- Use Zod for external input validation and anywhere runtime validation is needed.

## Code Changes

- Keep the public API intentional. Export from `source/index.ts` deliberately.
- Keep CLI code focused on argument parsing, prompts, progress output, and process I/O. Put reusable behavior in library modules.
- When generated output changes, update scaffold tests and README documentation in the same change.
- When adding or changing template assets, verify they are copied by `pnpm run build` and covered by generated-file assertions.
- Prefer small, direct dependencies when they materially simplify the implementation.
- Update or add Vitest tests for every behavior change.

## Verification

- Before handoff, run `pnpm run release:check`.
- Use smaller targeted checks while iterating, such as `pnpm run test`, `pnpm run lint`, `pnpm run typecheck`, or `pnpm run build`.
- For template behavior changes, scaffold a scratch project and run its generated checks when the change affects generated scripts, configs, or package metadata.
