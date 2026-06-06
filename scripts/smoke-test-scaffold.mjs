import { scaffoldProject } from "../dist/index.js";

const packageManagers = new Set(["pnpm"]);

const getRequiredEnv = (name) => {
  const value = process.env[name];

  if (!value) {
    throw new Error(`${name} must be set`);
  }

  return value;
};

const parseBooleanEnv = (name) => {
  const value = getRequiredEnv(name);

  if (value === "true") {
    return true;
  }

  if (value === "false") {
    return false;
  }

  throw new Error(`${name} must be "true" or "false"`);
};

const parsePackageManagerEnv = (name) => {
  const value = getRequiredEnv(name);

  if (!packageManagers.has(value)) {
    throw new Error(`${name} must be one of: ${[...packageManagers].join(", ")}`);
  }

  return value;
};

const includeCli = parseBooleanEnv("SMOKE_INCLUDE_CLI");
const packageManager = parsePackageManagerEnv("SMOKE_PACKAGE_MANAGER");

await scaffoldProject(
  {
    author: "Smoke Test <smoke@example.com>",
    description: "Generated project smoke test",
    githubRepoUrl: "https://github.com/hbmartin/create-ts-lib",
    includeCli,
    includeCodecov: false,
    license: "MIT",
    packageManager,
    projectName: includeCli ? "e2e-cli-lib" : "e2e-lib",
  },
  {
    postScaffold: false,
    targetDirectory: getRequiredEnv("SMOKE_DIR"),
  },
);
