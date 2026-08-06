import { spawn } from "node:child_process";
import { access, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { scaffoldProject } from "../dist/index.js";

const packageManagers = new Set(["pnpm"]);
const includeCliValues = new Set(["true", "false", "all"]);
const lintFormatValues = new Set(["oxlint-oxfmt", "biome"]);
const bundlerValues = new Set(["tsc", "tsdown"]);
const nodeTargetValues = new Set(["24", "26"]);

const log = (message) => {
  process.stdout.write(`[smoke] ${message}\n`);
};

const getOptionalEnv = (name, defaultValue) => process.env[name] || defaultValue;

const parseIncludeCliEnv = (name) => {
  const value = getOptionalEnv(name, "all");
  if (!includeCliValues.has(value)) {
    throw new Error(`${name} must be one of: ${[...includeCliValues].join(", ")}`);
  }

  return value === "all" ? [false, true] : [value === "true"];
};

const parsePackageManagerEnv = (name) => {
  const value = getOptionalEnv(name, "pnpm");

  if (!packageManagers.has(value)) {
    throw new Error(`${name} must be one of: ${[...packageManagers].join(", ")}`);
  }

  return value;
};

const parseChoiceEnv = (name, choices, defaultValue) => {
  const value = getOptionalEnv(name, defaultValue);

  if (!choices.has(value)) {
    throw new Error(`${name} must be one of: ${[...choices].join(", ")}`);
  }

  return value;
};

const runCommand = async (command, args, options = {}) => {
  log(`${command} ${args.join(" ")}`);
  await new Promise((resolve, reject) => {
    const childProcess = spawn(command, args, {
      cwd: options.cwd,
      env: {
        ...process.env,
        ...options.env,
      },
      stdio: "inherit",
    });

    childProcess.on("error", reject);
    childProcess.on("close", (code) => {
      if (code === 0) {
        resolve(undefined);
        return;
      }

      reject(new Error(`${command} ${args.join(" ")} exited with code ${code ?? "unknown"}`));
    });
  });
};

const checkCommand = async (command, args, options = {}) =>
  new Promise((resolve, reject) => {
    const childProcess = spawn(command, args, {
      cwd: options.cwd,
      stdio: "ignore",
    });

    childProcess.on("error", reject);
    childProcess.on("close", resolve);
  });

const assertLockfileIsNotIgnored = async (targetDirectory) => {
  await access(join(targetDirectory, "pnpm-lock.yaml"));

  const checkIgnoreCode = await checkCommand("git", ["check-ignore", "-q", "pnpm-lock.yaml"], {
    cwd: targetDirectory,
  });

  if (checkIgnoreCode === 0) {
    throw new Error("Generated pnpm-lock.yaml must not be ignored by git.");
  }

  if (checkIgnoreCode !== 1) {
    throw new Error(`git check-ignore exited with code ${checkIgnoreCode ?? "unknown"}.`);
  }
};

const targetDirectoryForVariant = (rootDirectory, variants, includeCli) => {
  if (variants.length === 1) {
    return rootDirectory;
  }

  return join(rootDirectory, includeCli ? "e2e-pnpm-cli" : "e2e-pnpm-lib");
};

const includeCliVariants = parseIncludeCliEnv("SMOKE_INCLUDE_CLI");
const packageManager = parsePackageManagerEnv("SMOKE_PACKAGE_MANAGER");
const lintFormatTooling = parseChoiceEnv("SMOKE_LINT_FORMAT", lintFormatValues, "oxlint-oxfmt");
const bundler = parseChoiceEnv("SMOKE_BUNDLER", bundlerValues, "tsc");
// The only check that actually installs the target's @types/node and
// typechecks a real project against it.
const nodeTarget = parseChoiceEnv("SMOKE_NODE_TARGET", nodeTargetValues, "24");
const configuredSmokeDirectory = process.env.SMOKE_DIR;
const baseDirectory =
  configuredSmokeDirectory || (await mkdtemp(join(tmpdir(), "create-ts-lib-smoke-")));
let smokeSucceeded = false;

try {
  for (const includeCli of includeCliVariants) {
    const projectName = includeCli ? "e2e-cli-lib" : "e2e-lib";
    const targetDirectory = targetDirectoryForVariant(
      baseDirectory,
      includeCliVariants,
      includeCli,
    );

    log(`Scaffolding ${projectName} in ${targetDirectory}`);
    await scaffoldProject(
      {
        author: "Smoke Test <smoke@example.com>",
        bundler,
        copyrightYear: "2026",
        description: "Generated project smoke test",
        githubRepoUrl: "https://github.com/hbmartin/create-ts-lib",
        includeCli,
        includeCodecov: false,
        includeCommunityFiles: false,
        includeJsr: false,
        includeSecurityWorkflows: false,
        includeZod: false,
        license: "MIT",
        lintFormatTooling,
        nodeTarget,
        packageManager,
        projectName,
      },
      {
        postScaffold: false,
        targetDirectory,
      },
    );

    await runCommand("git", ["init"], { cwd: targetDirectory });
    await runCommand(packageManager, ["install"], { cwd: targetDirectory });
    await assertLockfileIsNotIgnored(targetDirectory);
    await rm(join(targetDirectory, "node_modules"), {
      force: true,
      recursive: true,
    });
    await runCommand(packageManager, ["install", "--frozen-lockfile"], { cwd: targetDirectory });
    await runCommand(packageManager, ["run", "release:check"], {
      cwd: targetDirectory,
      env: {
        SECURITY_LINT_FORCE_UVX: "1",
      },
    });
  }

  smokeSucceeded = true;
} finally {
  if (configuredSmokeDirectory) {
    log(`Smoke project directory: ${baseDirectory}`);
  } else if (smokeSucceeded) {
    await rm(baseDirectory, { force: true, recursive: true });
    log(`Removed smoke project directory ${baseDirectory}`);
  } else {
    log(`Smoke project preserved for inspection at ${baseDirectory}`);
  }
}
