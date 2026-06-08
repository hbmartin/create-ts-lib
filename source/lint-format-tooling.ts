import { z } from "zod";

export const lintFormatToolingSchema = z.enum(["oxlint-oxfmt", "biome"]);

export type LintFormatTooling = z.infer<typeof lintFormatToolingSchema>;

export const defaultLintFormatTooling = "oxlint-oxfmt" satisfies LintFormatTooling;

export const lintFormatToolingOptions = lintFormatToolingSchema.options;

const lintFormatToolingLabels = {
  biome: "Biome",
  "oxlint-oxfmt": "Oxlint + Oxfmt",
} satisfies Record<LintFormatTooling, string>;

export const formatLintFormatTooling = (tooling: LintFormatTooling): string =>
  lintFormatToolingLabels[tooling];
