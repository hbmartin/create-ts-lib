#!/usr/bin/env node
import { basename, resolve } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

import packageJson from "../package.json" with { type: "json" };

import { scaffoldProject } from "./scaffold.js";
import type { LicenseName, PackageManager, ScaffoldConfig } from "./templates/files.js";

const execFileAsync = promisify(execFile);

interface PromptModule {
  confirm(options: { default?: boolean; message: string }): Promise<boolean>;
  input(options: { default?: string; message: string }): Promise<string>;
  select<T extends string>(options: {
    choices: Array<{ name: string; value: T }>;
    default?: T;
    message: string;
  }): Promise<T>;
}

const helpText = `create-ts-lib

Usage:
  create-ts-lib [directory]

Examples:
  pnpm create ts-lib my-lib
  npm create ts-lib my-lib
  npx create-ts-lib my-lib
`;

const main = async (): Promise<void> => {
  const [firstArgument] = process.argv.slice(2);

  if (firstArgument === "--help" || firstArgument === "-h") {
    process.stdout.write(helpText);
    return;
  }

  if (firstArgument === "--version" || firstArgument === "-v") {
    process.stdout.write(`${packageJson.version}\n`);
    return;
  }

  const promptModule = await loadPromptModule();
  const defaults = await detectDefaults(firstArgument);

  const projectName = await promptModule.input({
    default: defaults.projectName,
    message: "Project name",
  });
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
      { name: "MIT", value: "MIT" },
      { name: "ISC", value: "ISC" },
      { name: "Apache-2.0", value: "Apache-2.0" },
      { name: "UNLICENSED", value: "UNLICENSED" },
    ],
    default: "MIT",
    message: "License",
  });
  const githubRepoUrl = await promptModule.input({
    default: defaults.githubRepoUrl,
    message: "GitHub repo URL",
  });
  const includeReleasePlease = await promptModule.confirm({
    default: githubRepoUrl.length > 0,
    message: "Include release-please?",
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

  const config: ScaffoldConfig = {
    author,
    description,
    githubRepoUrl,
    includeCli,
    includeCodecov,
    includeReleasePlease,
    license,
    packageManager,
    projectName,
  };
  const targetDirectory = resolve(firstArgument ?? deriveDirectoryName(projectName));

  await scaffoldProject(config, {
    targetDirectory,
  });

  const runPrefix = packageManager === "pnpm" ? "pnpm run" : `${packageManager} run`;
  process.stdout.write(`Created ${projectName}

Next steps:
  cd ${basename(targetDirectory)}
  ${runPrefix} dev
  ${runPrefix} lint
  ${runPrefix} test
`);
};

const deriveDirectoryName = (projectName: string): string =>
  projectName.replace(/^@[^/]+\//u, "");

const loadPromptModule = async (): Promise<PromptModule> => {
  try {
    const importer = new Function("return import('@inquirer/prompts');") as () => Promise<PromptModule>;
    return await importer();
  } catch {
    return createFallbackPrompts();
  }
};

const detectDefaults = async (
  directoryArgument: string | undefined,
): Promise<{ author: string; githubRepoUrl: string; projectName: string }> => {
  const defaultProjectName = directoryArgument ? basename(directoryArgument) : "my-lib";
  const [userName, userEmail, remoteUrl] = await Promise.all([
    readGitConfigValue("user.name"),
    readGitConfigValue("user.email"),
    readGitRemoteOrigin(),
  ]);

  const author = [userName, userEmail ? `<${userEmail}>` : ""].filter(Boolean).join(" ").trim();

  return {
    author,
    githubRepoUrl: normalizeGitHubUrl(remoteUrl),
    projectName: defaultProjectName,
  };
};

const readGitConfigValue = async (key: string): Promise<string> => {
  try {
    const { stdout } = await execFileAsync("git", ["config", key]);
    return stdout.trim();
  } catch {
    return "";
  }
};

const readGitRemoteOrigin = async (): Promise<string> => {
  try {
    const { stdout } = await execFileAsync("git", ["remote", "get-url", "origin"]);
    return stdout.trim();
  } catch {
    return "";
  }
};

const normalizeGitHubUrl = (input: string): string => {
  if (input.length === 0) {
    return "";
  }

  if (input.startsWith("git@github.com:")) {
    return `https://github.com/${input.slice("git@github.com:".length).replace(/\.git$/u, "")}`;
  }

  if (input.startsWith("https://github.com/")) {
    return input.replace(/\.git$/u, "");
  }

  return input;
};

const createFallbackPrompts = (): PromptModule => {
  const readline = new Function("return import('node:readline/promises');") as () => Promise<{
    createInterface(options: { input: NodeJS.ReadableStream; output: NodeJS.WritableStream }): {
      close(): void;
      question(message: string): Promise<string>;
    };
  }>;

  const ask = async (message: string): Promise<string> => {
    const { createInterface } = await readline();
    const rl = createInterface({
      input: process.stdin,
      output: process.stdout,
    });
    const answer = await rl.question(message);
    rl.close();
    return answer.trim();
  };

  return {
    confirm: async ({ default: defaultValue = false, message }) => {
      const suffix = defaultValue ? "Y/n" : "y/N";
      const answer = await ask(`${message} (${suffix}) `);
      if (answer.length === 0) {
        return defaultValue;
      }

      return ["y", "yes"].includes(answer.toLowerCase());
    },
    input: async ({ default: defaultValue = "", message }) => {
      const answer = await ask(defaultValue.length > 0 ? `${message} (${defaultValue}) ` : `${message} `);
      return answer.length > 0 ? answer : defaultValue;
    },
    select: async ({ choices, default: defaultValue, message }) => {
      const choiceSummary = choices
        .map((choice, index) => `${index + 1}. ${choice.name}${choice.value === defaultValue ? " [default]" : ""}`)
        .join("\n");
      const answer = await ask(`${message}\n${choiceSummary}\n> `);
      if (answer.length === 0) {
        return defaultValue ?? choices[0].value;
      }

      const numericIndex = Number(answer);
      if (Number.isInteger(numericIndex) && numericIndex >= 1 && numericIndex <= choices.length) {
        return choices[numericIndex - 1]!.value;
      }

      const matchingChoice = choices.find(
        (choice) => choice.value === answer || choice.name.toLowerCase() === answer.toLowerCase(),
      );

      if (matchingChoice) {
        return matchingChoice.value;
      }

      throw new Error(`Invalid selection: ${answer}`);
    },
  };
};

await main();
