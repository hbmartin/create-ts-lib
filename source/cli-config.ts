import process from "node:process";

import { cyan, green } from "yoctocolors";

import {
  type CliArguments,
  type ConfigAction,
  configActionList,
  type WarningSink,
} from "./cli-helpers.js";
import {
  getUserConfigPath,
  loadUserConfig,
  readUserConfigValue,
  saveUserConfig,
  setUserConfigValue,
  type UserConfig,
  unsetUserConfigValue,
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
  // Narrowed once, up front, so the switch below is exhaustive over the three
  // remaining actions and needs no unreachable `default` arm repeating the
  // action list. `main()` returns for `--help`/`--version` before dispatching
  // here, and the parser rejects a missing action otherwise, so this only
  // guards a caller that bypassed both.
  const { configAction } = cliArguments;
  if (configAction === undefined) {
    throw new Error(`Missing config action. Expected one of: ${configActionList}`);
  }

  if (configAction === "path") {
    process.stdout.write(`${configPath}\n`);
    return;
  }

  const config = await loadUserConfig(warn, configPath);
  // Annotated rather than relying on control-flow narrowing so the switch is
  // exhaustive to the linter as well as the compiler. A new `ConfigAction`
  // still fails to compile here until it is handled.
  const remainingAction: Exclude<ConfigAction, "path"> = configAction;

  switch (remainingAction) {
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
  }
};
