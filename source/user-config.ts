import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import process from "node:process";

import { z } from "zod";

import type { WarningSink } from "./cli-helpers.js";
import { formatErrorMessage, isFileNotFoundError } from "./filesystem-errors.js";
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
  includeCommunityFiles: z.boolean().optional(),
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

export const userConfigKeys = Object.keys(userConfigSchema.shape).sort();

type UserConfigKey = keyof UserConfig;

const parseBooleanValue = (raw: string, key: string): boolean => {
  if (raw === "true") {
    return true;
  }

  if (raw === "false") {
    return false;
  }

  throw new Error(`Invalid value for ${key}: ${raw}. Expected true or false.`);
};

const identity = (raw: string): string => raw;

/**
 * Turns a CLI string into the value each key expects. Typed against
 * `UserConfig`, so adding a schema key fails to compile until its coercion is
 * defined here rather than silently accepting raw strings.
 */
const userConfigValueParsers = {
  author: identity,
  bundler: identity,
  includeCli: parseBooleanValue,
  includeCodecov: parseBooleanValue,
  includeCommunityFiles: parseBooleanValue,
  includeJsr: parseBooleanValue,
  includeSecurityWorkflows: parseBooleanValue,
  includeZod: parseBooleanValue,
  license: identity,
  lintFormatTooling: identity,
  packageManager: identity,
} satisfies Record<UserConfigKey, (raw: string, key: string) => unknown>;

const isUserConfigKey = (key: string): key is UserConfigKey =>
  Object.hasOwn(userConfigValueParsers, key);

const assertUserConfigKey = (key: string): UserConfigKey => {
  if (!isUserConfigKey(key)) {
    throw new Error(`Unknown config key: ${key}. Expected one of: ${userConfigKeys.join(", ")}`);
  }

  return key;
};

const formatIssues = (error: z.ZodError): string =>
  error.issues.map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`).join("; ");

/**
 * Writes atomically (temp file in the same directory, then rename) so an
 * interrupted write cannot leave a half-written config behind.
 */
export const saveUserConfig = async (
  config: UserConfig,
  configPath: string = getUserConfigPath(),
): Promise<void> => {
  const result = userConfigSchema.safeParse(config);
  if (!result.success) {
    throw new Error(`Refusing to write invalid config: ${formatIssues(result.error)}.`);
  }

  await mkdir(dirname(configPath), { recursive: true });
  const temporaryPath = `${configPath}.${process.pid}.tmp`;
  try {
    await writeFile(temporaryPath, `${JSON.stringify(result.data, null, 2)}\n`, "utf8");
    await rename(temporaryPath, configPath);
  } catch (error) {
    await rm(temporaryPath, { force: true });
    throw error;
  }
};

export const setUserConfigValue = (config: UserConfig, key: string, value: string): UserConfig => {
  const configKey = assertUserConfigKey(key);
  const parsed = userConfigValueParsers[configKey](value, configKey);
  const candidate = { ...config, [configKey]: parsed };
  const result = userConfigSchema.safeParse(candidate);
  if (!result.success) {
    throw new Error(`Invalid value for ${configKey}: ${formatIssues(result.error)}.`);
  }

  return result.data;
};

export const unsetUserConfigValue = (config: UserConfig, key: string): UserConfig => {
  const configKey = assertUserConfigKey(key);
  const { [configKey]: _removed, ...rest } = config;

  return rest;
};

export const readUserConfigValue = (config: UserConfig, key: string): unknown =>
  config[assertUserConfigKey(key)];

export const loadUserConfig = async (
  warn: WarningSink,
  configPath: string = getUserConfigPath(),
): Promise<UserConfig> => {
  let raw: string;
  try {
    raw = await readFile(configPath, "utf8");
  } catch (error) {
    if (isFileNotFoundError(error)) {
      return {};
    }

    warn(
      `Ignoring user config at ${configPath}; could not read file: ${formatErrorMessage(error)}.`,
    );
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
