import process from "node:process";

import { cyan, green } from "yoctocolors";

import type { CliArguments, WarningSink } from "./cli-helpers.js";
import {
  getUserConfigPath,
  loadUserConfig,
  readUserConfigValue,
  saveUserConfig,
  setUserConfigValue,
  type UserConfig,
  unsetUserConfigValue,
  userConfigKeys,
} from "./user-config.js";

const formatValue = (value: unknown): string =>
  typeof value === "string" ? value : JSON.stringify(value);

const printConfig = (config: UserConfig): void => {
  const entries = Object.entries(config).sort(([left], [right]) => left.localeCompare(right));

  if (entries.length === 0) {
    process.stdout.write(`${cyan("info")} No personal defaults are set.\n`);
    return;
  }

  for (const [key, value] of entries) {
    process.stdout.write(`  ${key}: ${formatValue(value)}\n`);
  }
};

export const runConfigWorkflow = async (
  cliArguments: CliArguments,
  warn: WarningSink,
): Promise<void> => {
  const configPath = cliArguments.configPath ?? getUserConfigPath();

  if (cliArguments.configAction === "path") {
    process.stdout.write(`${configPath}\n`);
    return;
  }

  const config = await loadUserConfig(warn, configPath);

  switch (cliArguments.configAction) {
    case "get": {
      if (cliArguments.configKey === undefined) {
        printConfig(config);
        return;
      }

      const value = readUserConfigValue(config, cliArguments.configKey);
      if (value === undefined) {
        process.stdout.write(`${cyan("info")} ${cliArguments.configKey} is not set.\n`);
        return;
      }

      process.stdout.write(`${formatValue(value)}\n`);
      return;
    }

    case "set": {
      // The parser guarantees both are present for `set`.
      const key = cliArguments.configKey ?? "";
      const value = cliArguments.configValue ?? "";
      await saveUserConfig(setUserConfigValue(config, key, value), configPath);
      process.stdout.write(`${green("done")} Set ${key} in ${configPath}.\n`);
      return;
    }

    case "unset": {
      const key = cliArguments.configKey ?? "";
      if (readUserConfigValue(config, key) === undefined) {
        process.stdout.write(`${cyan("info")} ${key} was not set; nothing to do.\n`);
        return;
      }

      await saveUserConfig(unsetUserConfigValue(config, key), configPath);
      process.stdout.write(`${green("done")} Unset ${key} in ${configPath}.\n`);
      return;
    }

    default: {
      throw new Error(
        `Missing config action. Expected one of: get, path, set, unset. Keys: ${userConfigKeys.join(", ")}`,
      );
    }
  }
};
