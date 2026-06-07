#!/usr/bin/env node
import { basename, resolve } from "node:path";

import ora, { type Ora } from "ora";
import { cyan, green, red, yellow } from "yoctocolors";

import packageJson from "../package.json" with { type: "json" };

import {
  type CliArguments,
  type DetectedDefaults,
  deriveDirectoryName,
  detectDefaults,
  parseCliArguments,
  type WarningSink,
} from "./cli-helpers.js";
import {
  checkNpmPackageNameAvailability,
  type NpmPackageNameAvailability,
} from "./npm-registry.js";
import { assertValidPackageName, validatePackageName } from "./package-name.js";
import { loadPromptModule, type PromptModule } from "./prompts.js";
import { type ScaffoldProgress, scaffoldProject } from "./scaffold.js";
import {
  buildProjectFiles,
  type LicenseName,
  type PackageManager,
  type ScaffoldConfig,
} from "./templates/files.js";

const helpText = `create-ts-lib

Usage:
  create-ts-lib [directory] [--yes] [--dry-run] [--force]

Options:
  --yes, -y    Use detected/default answers without prompting
  --dry-run    Print the scaffold plan without writing files
  --force      Allow writing into a non-empty target directory
  --help, -h   Show help
  --version, -v Show version

Examples:
  pnpm create @hbmartin/ts-lib my-lib
  npm create @hbmartin/ts-lib my-lib
  npx @hbmartin/create-ts-lib my-lib
`;

const main = async (): Promise<void> => {
  const warn: WarningSink = (message) => {
    process.stderr.write(`${yellow("warning")} ${message}\n`);
  };

  let cliArguments: CliArguments;
  try {
    cliArguments = parseCliArguments(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(
      `${red("error")} ${error instanceof Error ? error.message : "Invalid arguments"}\n\n`,
    );
    process.stderr.write(helpText);
    process.exitCode = 1;
    return;
  }

  if (cliArguments.help) {
    process.stdout.write(helpText);
    return;
  }

  if (cliArguments.version) {
    process.stdout.write(`${packageJson.version}\n`);
    return;
  }

  try {
    const defaults = await detectDefaults(cliArguments.directoryArgument, { warn });
    const config = cliArguments.yes
      ? buildDefaultConfig(defaults)
      : await promptForConfig(defaults, await loadPromptModule(warn), warn);
    assertValidPackageName(config.projectName);
    if (cliArguments.yes) {
      await warnForNpmPackageNameAvailability(config.projectName, warn);
    }

    const targetDirectory = resolve(
      cliArguments.directoryArgument ?? deriveDirectoryName(config.projectName),
    );

    printSummary(config, targetDirectory, cliArguments.dryRun);

    if (cliArguments.dryRun) {
      printDryRunFiles(config);
      return;
    }

    await scaffoldProject(config, {
      force: cliArguments.force,
      progress: createProgressReporter(),
      targetDirectory,
    });

    const runPrefix =
      config.packageManager === "pnpm" ? "pnpm run" : `${config.packageManager} run`;
    process.stdout.write(`Created ${config.projectName}

Next steps:
  cd ${basename(targetDirectory)}
  ${runPrefix} dev
  ${runPrefix} lint
  ${runPrefix} test
`);
  } catch (error) {
    process.stderr.write(
      `${red("error")} ${error instanceof Error ? error.message : "Scaffolding failed"}\n`,
    );
    process.exitCode = 1;
  }
};

const buildDefaultConfig = (defaults: DetectedDefaults): ScaffoldConfig => ({
  author: defaults.author,
  description: "",
  githubRepoUrl: defaults.githubRepoUrl,
  includeCli: false,
  includeCodecov: true,
  license: "Apache-2.0",
  packageManager: "pnpm",
  projectName: defaults.projectName,
});

const promptForConfig = async (
  defaults: DetectedDefaults,
  promptModule: PromptModule,
  warn: WarningSink,
): Promise<ScaffoldConfig> => {
  const projectName = await promptForProjectName(defaults, promptModule, warn);
  const description = await promptModule.input({
    default: "",
    message: "Description",
  });
  const author = await promptModule.input({
    default: defaults.author,
    message: "Author",
  });
  const license = await promptModule.select<LicenseName>({
    choices: [
      { name: "Apache-2.0", value: "Apache-2.0" },
      { name: "MIT", value: "MIT" },
      { name: "ISC", value: "ISC" },
      { name: "UNLICENSED", value: "UNLICENSED" },
    ],
    default: "Apache-2.0",
    message: "License",
  });
  const githubRepoUrl = await promptModule.input({
    default: defaults.githubRepoUrl,
    message: "GitHub repo URL",
  });
  const includeCodecov = await promptModule.confirm({
    default: true,
    message: "Include Codecov?",
  });
  const includeCli = await promptModule.confirm({
    default: false,
    message: "Include CLI entry point?",
  });
  const packageManager = await promptModule.select<PackageManager>({
    choices: [
      { name: "pnpm", value: "pnpm" },
      { name: "npm", value: "npm" },
      { name: "yarn", value: "yarn" },
    ],
    default: "pnpm",
    message: "Package manager",
  });

  return {
    author,
    description,
    githubRepoUrl,
    includeCli,
    includeCodecov,
    license,
    packageManager,
    projectName,
  };
};

type ExistingPackageNameDecision = "rename" | "use-anyway";

const promptForProjectName = async (
  defaults: DetectedDefaults,
  promptModule: PromptModule,
  warn: WarningSink,
): Promise<string> => {
  let defaultProjectName: string | undefined = defaults.projectName;

  for (;;) {
    const projectName = await promptModule.input({
      ...(defaultProjectName === undefined ? {} : { default: defaultProjectName }),
      message: "Project name",
      validate: validateProjectNameForPrompt,
    });
    const availability = await checkNpmPackageNameAvailability(projectName);

    if (availability.status === "available") {
      return projectName;
    }

    if (availability.status === "unknown") {
      warn(formatNpmAvailabilityUnknownWarning(availability));
      return projectName;
    }

    warn(formatNpmPackageNameExistsWarning(projectName));
    const decision = await promptModule.select<ExistingPackageNameDecision>({
      choices: [
        { name: "Rename", value: "rename" },
        { name: "Use anyway", value: "use-anyway" },
      ],
      default: "rename",
      message: "Package name already exists on npm",
    });

    if (decision === "use-anyway") {
      return projectName;
    }

    defaultProjectName = undefined;
  }
};

const validateProjectNameForPrompt = (projectName: string): true | string => {
  const validation = validatePackageName(projectName);

  return validation.valid ? true : validation.errors.join(" ");
};

const warnForNpmPackageNameAvailability = async (
  packageName: string,
  warn: WarningSink,
): Promise<void> => {
  const availability = await checkNpmPackageNameAvailability(packageName);

  if (availability.status === "exists") {
    warn(formatNpmPackageNameExistsWarning(packageName));
    return;
  }

  if (availability.status === "unknown") {
    warn(formatNpmAvailabilityUnknownWarning(availability));
  }
};

const formatNpmPackageNameExistsWarning = (packageName: string): string =>
  `Package name "${packageName}" already exists on npm.`;

const formatNpmAvailabilityUnknownWarning = (availability: NpmPackageNameAvailability): string => {
  const detail =
    availability.statusCode === undefined
      ? availability.error
      : `npm registry returned HTTP ${availability.statusCode}`;

  return detail
    ? `Could not check npm availability for "${availability.packageName}"; continuing. ${detail}.`
    : `Could not check npm availability for "${availability.packageName}"; continuing.`;
};

const printSummary = (config: ScaffoldConfig, targetDirectory: string, dryRun: boolean): void => {
  const rows = [
    ["Project", config.projectName],
    ["Target", targetDirectory],
    ["Description", config.description || "(empty)"],
    ["Author", config.author || "(empty)"],
    ["License", config.license],
    ["Package manager", config.packageManager],
    ["GitHub repo", config.githubRepoUrl || "(none)"],
    ["Codecov", config.includeCodecov ? "yes" : "no"],
    ["CLI entry", config.includeCli ? "yes" : "no"],
  ];

  process.stdout.write(`${dryRun ? cyan("Dry run") : cyan("Scaffold summary")}\n`);
  for (const [label, value] of rows) {
    process.stdout.write(`  ${label}: ${value}\n`);
  }
  process.stdout.write("\n");
};

const printDryRunFiles = (config: ScaffoldConfig): void => {
  process.stdout.write("Files to create:\n");
  for (const file of buildProjectFiles(config)) {
    process.stdout.write(`  ${file.path}\n`);
  }
};

const createProgressReporter = (): ScaffoldProgress => {
  const { CI: continuousIntegration } = process.env;
  const useSpinner = Boolean(process.stdout.isTTY) && continuousIntegration !== "true";
  let spinner: Ora | undefined;

  return {
    fail: (message) => {
      if (spinner) {
        spinner.fail(message);
        spinner = undefined;
        return;
      }

      process.stdout.write(`${red("failed")} ${message}\n`);
    },
    info: (message) => {
      process.stdout.write(`${cyan("info")} ${message}\n`);
    },
    start: (message) => {
      if (useSpinner) {
        spinner = ora(message).start();
        return;
      }

      process.stdout.write(`${cyan("start")} ${message}\n`);
    },
    succeed: (message) => {
      if (spinner) {
        spinner.succeed(message);
        spinner = undefined;
        return;
      }

      process.stdout.write(`${green("done")} ${message}\n`);
    },
  };
};

await main();
