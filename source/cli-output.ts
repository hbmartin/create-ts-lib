import process from "node:process";

import ora, { type Ora } from "ora";
import { cyan, green, red, yellow } from "yoctocolors";

import type { PendingGitHubRepositoryCreation } from "./cli-prompts.js";
import { formatLintFormatTooling } from "./lint-format-tooling.js";
import { parseGitHubRepositoryUrl } from "./name-helpers.js";
import type { PostScaffoldSetupError, ScaffoldProgress } from "./scaffold.js";
import { buildProjectFiles, type PackageManager, type ScaffoldConfig } from "./templates/files.js";
import { hasGitHubWorkflows } from "./templates/readme.js";

export interface NextStepsOptions {
  includeGitHubPublishSteps: boolean;
  skipGit: boolean;
  skipInstall: boolean;
}

export const printSummary = (
  config: ScaffoldConfig,
  targetDirectory: string,
  dryRun: boolean,
  githubRepositoryCreation: PendingGitHubRepositoryCreation | undefined,
): void => {
  const rows = [
    ["Project", config.projectName],
    ["Target", targetDirectory],
    ["Description", config.description || "(empty)"],
    ["Author", config.author || "(empty)"],
    ["License", config.license],
    ["Lint/format", formatLintFormatTooling(config.lintFormatTooling)],
    ["Build tool", config.bundler],
    ["Package manager", config.packageManager],
    ["GitHub repo", config.githubRepoUrl || "(none)"],
    ["Codecov", config.includeCodecov ? "yes" : "no"],
    ["Security workflows", config.includeSecurityWorkflows ? "yes" : "no"],
    ["CLI entry", config.includeCli ? "yes" : "no"],
    ["Zod", config.includeZod ? "yes" : "no"],
    ["JSR", config.includeJsr ? "yes" : "no"],
  ];

  process.stdout.write(`${dryRun ? cyan("Dry run") : cyan("Scaffold summary")}\n`);
  for (const [label, value] of rows) {
    process.stdout.write(`  ${label}: ${value}\n`);
  }
  if (!dryRun && githubRepositoryCreation) {
    process.stdout.write(
      `  GitHub repo action: will create ${githubRepositoryCreation.visibility} repo ${githubRepositoryCreation.owner}/${githubRepositoryCreation.repositoryName}\n`,
    );
  }
  process.stdout.write("\n");
};

export const printDryRunDetails = (
  config: ScaffoldConfig,
  githubRepositoryCreation: PendingGitHubRepositoryCreation | undefined,
): void => {
  if (githubRepositoryCreation) {
    printDryRunGitHubCreation(githubRepositoryCreation);
  }

  printDryRunFiles(config);
};

const printDryRunGitHubCreation = (creation: PendingGitHubRepositoryCreation): void => {
  process.stdout.write(
    `${cyan("info")} GitHub repo creation skipped by --dry-run; would create ${creation.visibility} repo ${creation.owner}/${creation.repositoryName}.\n`,
  );
};

const printDryRunFiles = (config: ScaffoldConfig): void => {
  process.stdout.write("Files to create:\n");
  for (const file of buildProjectFiles(config)) {
    process.stdout.write(`  ${file.path}\n`);
  }
};

export const printNextSteps = (
  config: ScaffoldConfig,
  targetDirectory: string,
  options: NextStepsOptions,
): void => {
  const runPrefix = getPackageManagerRunPrefix(config.packageManager);
  const skippedSetupSteps = [
    ...(options.skipGit ? ["  git init"] : []),
    ...(options.skipInstall ? [`  ${config.packageManager} install`] : []),
  ]
    .map((step) => `${step}\n`)
    .join("");
  const githubPublishSteps = options.includeGitHubPublishSteps
    ? `
Publish to GitHub:
  git add .
  git commit -m "Initial scaffold"
  git push -u origin HEAD
`
    : "";
  const trustedPublishingStep = hasGitHubWorkflows(config)
    ? `
Enable npm trusted publishing for the release workflow: https://docs.npmjs.com/trusted-publishers
`
    : "";
  const codecovSetupStep = buildCodecovSetupStep(config);

  process.stdout.write(`Created ${config.projectName}

Next steps:
  cd ${formatShellArgument(targetDirectory)}
${skippedSetupSteps}  ${runPrefix} dev
  ${runPrefix} lint
  ${runPrefix} test
${githubPublishSteps}${trustedPublishingStep}${codecovSetupStep}`);
};

const buildCodecovSetupStep = (config: ScaffoldConfig): string => {
  if (!config.includeCodecov || config.packageManager !== "pnpm") {
    return "";
  }

  const repository = parseGitHubRepositoryUrl(config.githubRepoUrl);
  if (repository === undefined) {
    return "";
  }

  return `
Set up Codecov: https://app.codecov.io/gh/${repository.owner}/${repository.repo}/new
`;
};

export const printPostScaffoldRecovery = (error: PostScaffoldSetupError): void => {
  process.stderr.write(
    `${yellow("recovery")} Project files were created at ${error.targetDirectory}, but setup did not finish.\n`,
  );
  process.stderr.write("Run these commands to retry the failed setup steps:\n");
  process.stderr.write(`  cd ${formatShellArgument(error.targetDirectory)}\n`);

  for (const command of buildPostScaffoldRecoveryCommands(error)) {
    process.stderr.write(`  ${command}\n`);
  }
};

const buildPostScaffoldRecoveryCommands = (error: PostScaffoldSetupError): string[] => {
  const runPrefix = getPackageManagerRunPrefix(error.packageManager);
  const installCommand = `${error.packageManager} install`;
  const buildCommand = `${runPrefix} build`;
  const testCommand = `${runPrefix} test`;

  switch (error.step) {
    case "git":
      return ["git init", installCommand, buildCommand, testCommand];
    case "install":
      return [installCommand, buildCommand, testCommand];
    case "build":
      return [buildCommand, testCommand];
    case "test":
      return [testCommand];
  }
};

export const getPackageManagerRunPrefix = (packageManager: PackageManager): string =>
  packageManager === "pnpm" ? "pnpm run" : `${packageManager} run`;

const safeShellArgumentRegex = /^[\w./:@%+=,-]+$/;

export const formatShellArgument = (
  value: string,
  platform: NodeJS.Platform = process.platform,
): string => {
  if (safeShellArgumentRegex.test(value)) {
    return value;
  }

  // cmd.exe treats single quotes as literal characters; double quotes work in
  // both cmd.exe and PowerShell, and `"` cannot appear in Windows paths.
  return platform === "win32" ? `"${value}"` : `'${value.replaceAll("'", "'\\''")}'`;
};

export const createProgressReporter = (): ScaffoldProgress => {
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
