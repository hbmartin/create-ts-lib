#!/usr/bin/env node
import { resolve } from "node:path";
import process from "node:process";

import { red, yellow } from "yoctocolors";

import packageJson from "../package.json" with { type: "json" };

import {
  type CliArguments,
  deriveDirectoryName,
  detectDefaults,
  parseCliArguments,
  type WarningSink,
} from "./cli-helpers.js";
import {
  createProgressReporter,
  printDryRunDetails,
  printNextSteps,
  printPostScaffoldRecovery,
  printSummary,
} from "./cli-output.js";
import {
  type PendingGitHubRepositoryCreation,
  promptForConfig,
  warnForNpmPackageNameAvailability,
} from "./cli-prompts.js";
import { runUpdateWorkflow } from "./cli-update.js";
import { formatGitHubRepositoryCreateWarning } from "./cli-warnings.js";
import { createGitHubRepository } from "./github-cli.js";
import { assertValidPackageName } from "./package-name.js";
import { loadPromptModule } from "./prompts.js";
import { PostScaffoldSetupError, scaffoldProject } from "./scaffold.js";
import { assertTargetDirectoryIsSafe } from "./target-directory.js";
import { defaultScaffoldConfig, type ScaffoldConfig } from "./templates/files.js";
import { stripUndefinedOverrides } from "./templates/scaffold-config.js";
import { loadUserConfig } from "./user-config.js";

const helpText = `create-ts-lib

Usage:
  create-ts-lib [directory] [options]
  create-ts-lib update [directory] [--dry-run] [--force] [--yes]

Options:
  --yes, -y                 Use detected/default answers without prompting
  --dry-run                 Print the scaffold plan without writing files
  --force                   Allow writing into a non-empty target directory
  --name <name>             Package name (defaults to the directory name)
  --description <text>      Package description
  --author <author>         Package author, e.g. "Ada <ada@example.com>"
  --license <license>       Choose Apache-2.0, MIT, ISC, or UNLICENSED
  --repo-url <url>          GitHub repository URL for generated metadata
  --package-manager <pm>    Choose pnpm, npm, or yarn
  --lint-format <tooling>   Choose oxlint-oxfmt or biome
  --bundler <bundler>       Choose tsc or tsdown
  --[no-]codecov            Include or omit Codecov upload in generated CI
  --[no-]zod                Include or omit Zod in the generated project
  --[no-]jsr                Include or omit JSR publishing support
  --[no-]security-workflows Include or omit CodeQL and Scorecard workflows
  --skip-git                Skip git init and git remote setup
  --skip-install            Skip dependency install, build, and test
  --help, -h                Show help
  --version, -v             Show version

The update command re-renders generated tooling files in an existing project
and applies template improvements, skipping files you have modified.

Personal defaults are read from $XDG_CONFIG_HOME/create-ts-lib/config.json
(usually ~/.config/create-ts-lib/config.json).

Examples:
  pnpm create @hbmartin/ts-lib my-lib
  npm create @hbmartin/ts-lib my-lib
  npx @hbmartin/create-ts-lib my-lib
  npx @hbmartin/create-ts-lib my-lib --yes --license MIT --no-codecov
  npx @hbmartin/create-ts-lib update my-lib --dry-run
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
    await (cliArguments.update
      ? runUpdateWorkflow(cliArguments, warn)
      : runScaffoldWorkflow(cliArguments, warn));
  } catch (error) {
    handleCliError(error);
  }
};

const buildProvidedOverrides = (cliArguments: CliArguments): Partial<ScaffoldConfig> =>
  stripUndefinedOverrides({
    author: cliArguments.author,
    bundler: cliArguments.bundler,
    description: cliArguments.description,
    githubRepoUrl: cliArguments.repoUrl,
    includeCli: cliArguments.cli,
    includeCodecov: cliArguments.codecov,
    includeJsr: cliArguments.jsr,
    includeSecurityWorkflows: cliArguments.securityWorkflows,
    includeZod: cliArguments.zod,
    license: cliArguments.license,
    lintFormatTooling: cliArguments.lintFormatTooling,
    packageManager: cliArguments.packageManager,
    projectName: cliArguments.projectName,
  });

const runScaffoldWorkflow = async (
  cliArguments: CliArguments,
  warn: WarningSink,
): Promise<void> => {
  const userConfig = await loadUserConfig(warn);
  const defaults = await detectDefaults(cliArguments.directoryArgument, { warn });
  const promptDefaults = defaultScaffoldConfig({
    ...userConfig,
    author: userConfig.author ?? defaults.author,
    githubRepoUrl: defaults.githubRepoUrl,
    projectName: defaults.projectName,
  });
  const provided = buildProvidedOverrides(cliArguments);
  const configResult = cliArguments.yes
    ? { config: defaultScaffoldConfig({ ...promptDefaults, ...provided }) }
    : await promptForConfig({
        defaults: promptDefaults,
        promptModule: await loadPromptModule(warn),
        provided,
        warn,
      });
  const { config, githubRepositoryCreation } = configResult;
  assertValidPackageName(config.projectName);
  if (cliArguments.yes) {
    await warnForNpmPackageNameAvailability(config.projectName, warn);
  }

  const targetDirectory = resolve(
    cliArguments.directoryArgument ?? deriveDirectoryName(config.projectName),
  );

  if (!cliArguments.dryRun) {
    await assertTargetDirectoryIsSafe(targetDirectory, cliArguments.force);
  }

  printSummary(config, targetDirectory, cliArguments.dryRun, githubRepositoryCreation);

  if (cliArguments.dryRun) {
    printDryRunDetails(config, githubRepositoryCreation);
    return;
  }

  const gitRemoteOriginUrl = getGitRemoteOriginUrl(cliArguments, config);
  await createGitHubRepositoryIfNeeded(config, githubRepositoryCreation, warn);
  await scaffoldProject(config, {
    force: cliArguments.force,
    ...(gitRemoteOriginUrl === undefined ? {} : { gitRemoteOriginUrl }),
    progress: createProgressReporter(),
    skipGit: cliArguments.skipGit,
    skipInstall: cliArguments.skipInstall,
    targetDirectory,
  });
  printNextSteps(config, targetDirectory, {
    includeGitHubPublishSteps: !cliArguments.skipGit && gitRemoteOriginUrl !== undefined,
    skipGit: cliArguments.skipGit,
    skipInstall: cliArguments.skipInstall,
  });
};

const handleCliError = (error: unknown): void => {
  if (error instanceof PostScaffoldSetupError) {
    process.stderr.write(`${red("error")} ${error.message}\n\n`);
    printPostScaffoldRecovery(error);
    process.exitCode = 1;
    return;
  }

  process.stderr.write(
    `${red("error")} ${error instanceof Error ? error.message : "Scaffolding failed"}\n`,
  );
  process.exitCode = 1;
};

const createGitHubRepositoryIfNeeded = async (
  config: ScaffoldConfig,
  githubRepositoryCreation: PendingGitHubRepositoryCreation | undefined,
  warn: WarningSink,
): Promise<void> => {
  if (!githubRepositoryCreation) {
    return;
  }

  const createResult = await createGitHubRepository({
    description: config.description,
    owner: githubRepositoryCreation.owner,
    repositoryName: githubRepositoryCreation.repositoryName,
    visibility: githubRepositoryCreation.visibility,
  });

  if (createResult.status === "failed") {
    warn(formatGitHubRepositoryCreateWarning(createResult));
  }
};

const getGitRemoteOriginUrl = (
  cliArguments: CliArguments,
  config: ScaffoldConfig,
): string | undefined => {
  if (config.githubRepoUrl.length === 0) {
    return undefined;
  }

  // --yes historically skips remote setup unless the repo URL was passed explicitly.
  if (cliArguments.yes && cliArguments.repoUrl === undefined) {
    return undefined;
  }

  return config.githubRepoUrl;
};

await main();
