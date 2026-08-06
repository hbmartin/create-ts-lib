import { createHash } from "node:crypto";

import { z } from "zod";

import packageJson from "../../package.json" with { type: "json" };

import { lintFormatToolingSchema } from "../lint-format-tooling.js";
import { defaultNodeTarget, nodeTargetSchema } from "../node-target.js";
import {
  currentCopyrightYear,
  type GeneratedFile,
  type ScaffoldConfig,
} from "./scaffold-config.js";

/**
 * Marker file written into every scaffolded project. It records the scaffold
 * configuration and a hash of every generated file so `create-ts-lib update`
 * can re-render templates later and tell user-modified files apart from
 * files that are safe to re-sync.
 */
export const stateFileName = ".create-ts-lib.json";

export const packageManagerSchema = z.enum(["pnpm", "npm", "yarn"]);
export const licenseNameSchema = z.enum(["MIT", "ISC", "Apache-2.0", "UNLICENSED"]);
export const bundlerSchema = z.enum(["tsc", "tsdown"]);

// Fields added after state files ship must use .default() so `update` keeps
// accepting state files written by older generator versions.
export const scaffoldConfigSchema = z.object({
  author: z.string(),
  bundler: bundlerSchema,
  copyrightYear: z.string().default(currentCopyrightYear),
  description: z.string(),
  githubRepoUrl: z.string(),
  includeCli: z.boolean(),
  includeCodecov: z.boolean(),
  includeCommunityFiles: z.boolean().default(false),
  includeJsr: z.boolean(),
  includeSecurityWorkflows: z.boolean(),
  includeZod: z.boolean(),
  license: licenseNameSchema,
  lintFormatTooling: lintFormatToolingSchema,
  // Every project scaffolded before this field existed was emitted with a >=24
  // floor, so this default is behavioural continuity: `update` re-renders those
  // projects byte-identically rather than migrating them to a newer Node.
  nodeTarget: nodeTargetSchema.default(defaultNodeTarget),
  packageManager: packageManagerSchema,
  projectName: z.string(),
  workspaceMode: z.boolean().default(false),
}) satisfies z.ZodType<ScaffoldConfig>;

export const scaffoldStateSchema = z.object({
  config: scaffoldConfigSchema,
  files: z.record(z.string(), z.string()),
  generator: z.string(),
  version: z.string(),
});

export type ScaffoldState = z.infer<typeof scaffoldStateSchema>;

/**
 * Guards the public entry points, which JavaScript callers can reach with any
 * object at all. Without this a bad `packageManager` surfaces as a TypeError
 * from a lookup table several frames later instead of a message naming the
 * field. Deliberately asserts rather than returning `result.data`: substituting
 * the parsed object would reorder the caller's keys in the state file and
 * silently repair configs instead of reporting them.
 */
export const assertValidScaffoldConfig = (config: ScaffoldConfig): void => {
  const result = scaffoldConfigSchema.safeParse(config);
  if (result.success) {
    return;
  }

  throw new Error(
    `Invalid scaffold config: ${result.error.issues
      .map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`)
      .join("; ")}`,
  );
};

export const hashFileContent = (content: string): string =>
  createHash("sha256").update(content, "utf8").digest("hex");

export const buildStateFile = (config: ScaffoldConfig, files: GeneratedFile[]): GeneratedFile => {
  const state: ScaffoldState = {
    config,
    files: Object.fromEntries(files.map((file) => [file.path, hashFileContent(file.content)])),
    generator: packageJson.name,
    version: packageJson.version,
  };

  return {
    content: `${JSON.stringify(state, null, 2)}\n`,
    path: stateFileName,
  };
};
