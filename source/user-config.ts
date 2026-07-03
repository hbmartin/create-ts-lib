import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import process from "node:process";

import { z } from "zod";

import type { WarningSink } from "./cli-helpers.js";
import { lintFormatToolingSchema } from "./lint-format-tooling.js";
import { bundlerSchema, licenseNameSchema, packageManagerSchema } from "./templates/state.js";

/**
 * Personal defaults applied to every scaffold. Per-project answers
 * (project name, description, GitHub repo URL) are deliberately excluded.
 */
export const userConfigSchema = z.strictObject({
  author: z.string().optional(),
  bundler: bundlerSchema.optional(),
  includeCli: z.boolean().optional(),
  includeCodecov: z.boolean().optional(),
  includeJsr: z.boolean().optional(),
  includeSecurityWorkflows: z.boolean().optional(),
  includeZod: z.boolean().optional(),
  license: licenseNameSchema.optional(),
  lintFormatTooling: lintFormatToolingSchema.optional(),
  packageManager: packageManagerSchema.optional(),
});

export type UserConfig = z.infer<typeof userConfigSchema>;

export const getUserConfigPath = (
  env: Record<string, string | undefined> = process.env,
): string => {
  const { XDG_CONFIG_HOME: xdgConfigHome } = env;
  const configBase =
    xdgConfigHome !== undefined && xdgConfigHome.length > 0
      ? xdgConfigHome
      : join(homedir(), ".config");

  return join(configBase, "create-ts-lib", "config.json");
};

export const loadUserConfig = async (
  warn: WarningSink,
  configPath: string = getUserConfigPath(),
): Promise<UserConfig> => {
  let raw: string;
  try {
    raw = await readFile(configPath, "utf8");
  } catch {
    return {};
  }

  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(raw);
  } catch {
    warn(`Ignoring user config at ${configPath}; it is not valid JSON.`);
    return {};
  }

  const result = userConfigSchema.safeParse(parsedJson);
  if (!result.success) {
    const detail = result.error.issues
      .map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`)
      .join("; ");
    warn(`Ignoring user config at ${configPath}; ${detail}.`);
    return {};
  }

  return result.data;
};
