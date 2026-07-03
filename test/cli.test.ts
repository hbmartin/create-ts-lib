import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import packageJson from "../package.json" with { type: "json" };
import type { DetectedDefaults } from "../source/cli-helpers.js";
import type {
  CreateGitHubRepositoryRequest,
  CreateGitHubRepositoryResult,
  GitHubRepositoryLookupResult,
} from "../source/github-cli.js";
import type { NpmPackageNameAvailability } from "../source/npm-registry.js";
import { PostScaffoldSetupError, type ScaffoldProgress } from "../source/scaffold.js";

const originalArgv = process.argv;
const originalExitCode = process.exitCode;

interface CliResult {
  exitCode: NodeJS.Process["exitCode"];
  stderr: string;
  stdout: string;
}

interface PromptInputOptions {
  default?: string;
  message: string;
  validate?: (value: string) => boolean | string;
}

interface PromptSelectOptions {
  choices?: Array<{ name: string; value: string }>;
  default?: string;
  message: string;
}

interface PromptModule {
  confirm(options: { default?: boolean; message: string }): Promise<boolean>;
  input(options: PromptInputOptions): Promise<string>;
  select(options: PromptSelectOptions): Promise<string>;
}

interface RunCliOptions {
  checkNpmPackageNameAvailability?: (packageName: string) => Promise<NpmPackageNameAvailability>;
  createGitHubRepository?: (
    request: CreateGitHubRepositoryRequest,
  ) => Promise<CreateGitHubRepositoryResult>;
  detectedDefaults?: Partial<DetectedDefaults>;
  inspectPersonalGitHubRepository?: (projectName: string) => Promise<GitHubRepositoryLookupResult>;
  promptModule?: PromptModule;
  ora?: (message: string) => {
    start(): { fail(message: string): void; succeed(message: string): void };
  };
  scaffoldProject?: ReturnType<typeof vi.fn>;
  stdoutIsTTY?: boolean;
}

afterEach(() => {
  process.argv = originalArgv;
  process.exitCode = originalExitCode;
  vi.restoreAllMocks();
  vi.resetModules();
});

describe("cli entrypoint", () => {
  it("prints the package version", async () => {
    const result = await runCli(["--version"]);

    expect(result).toMatchObject({
      exitCode: undefined,
      stderr: "",
      stdout: `${packageJson.version}\n`,
    });
  });

  it("prints help with the pnpm create example", async () => {
    const result = await runCli(["--help"]);

    expect(result.exitCode).toBeUndefined();
    expect(result.stderr).toBe("");
    expect(result.stdout).toContain("pnpm create @hbmartin/ts-lib my-lib");
    expect(result.stdout).toContain("--[no-]codecov");
    expect(result.stdout).toContain("--[no-]zod");
    expect(result.stdout).toContain("--skip-install");
    expect(result.stdout).toContain("create-ts-lib update [directory]");
  });

  it("prints an error and help for invalid arguments", async () => {
    const result = await runCli(["--bad"]);

    expect(result.exitCode).toBe(1);
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain("Unknown option: --bad");
    expect(result.stderr).toContain("Usage:");
  });

  it("prints a dry-run scaffold plan without writing files", async () => {
    const result = await runCli(["demo-lib", "--yes", "--dry-run"]);

    expect(result.exitCode).toBeUndefined();
    expect(result.stderr).toBe("");
    expect(result.stdout).toContain("Dry run");
    expect(result.stdout).toContain("Project: demo-lib");
    expect(result.stdout).toContain("License: Apache-2.0");
    expect(result.stdout).toContain("Lint/format: Oxlint + Oxfmt");
    expect(result.stdout).toContain("Zod: no");
    expect(result.stdout).toContain("Files to create:");
    expect(result.stdout).toContain("package.json");
    expect(result.stdout).not.toContain("Set up Codecov:");
  });

  it("passes --lint-format to the scaffold operation", async () => {
    const scaffoldProject = vi.fn(async () => undefined);

    const result = await runCli(["demo-lib", "--yes", "--lint-format", "biome"], {
      scaffoldProject,
    });

    expect(result.exitCode).toBeUndefined();
    expect(result.stdout).toContain("Lint/format: Biome");
    expect(scaffoldProject).toHaveBeenCalledWith(
      expect.objectContaining({
        lintFormatTooling: "biome",
        projectName: "demo-lib",
      }),
      expect.any(Object),
    );
  });

  it("passes --lint-format equals form to the scaffold operation", async () => {
    const scaffoldProject = vi.fn(async () => undefined);

    const result = await runCli(["demo-lib", "--yes", "--lint-format=biome"], {
      scaffoldProject,
    });

    expect(result.exitCode).toBeUndefined();
    expect(result.stdout).toContain("Lint/format: Biome");
    expect(scaffoldProject).toHaveBeenCalledWith(
      expect.objectContaining({
        lintFormatTooling: "biome",
        projectName: "demo-lib",
      }),
      expect.any(Object),
    );
  });

  it("passes --zod to the scaffold operation", async () => {
    const scaffoldProject = vi.fn(async () => undefined);

    const result = await runCli(["demo-lib", "--yes", "--zod"], {
      scaffoldProject,
    });

    expect(result.exitCode).toBeUndefined();
    expect(result.stdout).toContain("Zod: yes");
    expect(scaffoldProject).toHaveBeenCalledWith(
      expect.objectContaining({
        includeZod: true,
        projectName: "demo-lib",
      }),
      expect.any(Object),
    );
  });

  it("passes --no-codecov to the scaffold operation", async () => {
    const scaffoldProject = vi.fn(async () => undefined);

    const result = await runCli(["demo-lib", "--yes", "--no-codecov"], {
      scaffoldProject,
    });

    expect(result.exitCode).toBeUndefined();
    expect(result.stdout).toContain("Codecov: no");
    expect(result.stdout).not.toContain("Set up Codecov:");
    expect(scaffoldProject).toHaveBeenCalledWith(
      expect.objectContaining({
        includeCodecov: false,
        projectName: "demo-lib",
      }),
      expect.any(Object),
    );
  });

  it.each<[string, string[]]>([
    ["missing value", ["--lint-format"]],
    ["invalid value", ["--lint-format", "eslint"]],
  ])("rejects %s for --lint-format", async (_label, args) => {
    const result = await runCli(args);

    expect(result.exitCode).toBe(1);
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain("--lint-format");
    expect(result.stderr).toContain("Usage:");
  });

  it("rejects invalid project names in --yes mode", async () => {
    const result = await runCli(["My Lib", "--yes", "--dry-run"]);

    expect(result.exitCode).toBe(1);
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain('Invalid project name "My Lib"');
    expect(result.stderr).toContain("lowercase");
    expect(result.stderr).toContain("whitespace");
  });

  it("uses prompted values when --yes is omitted", async () => {
    const promptModule = {
      confirm: vi.fn(
        async ({ message }: { message: string }) => message === "Include CLI entry point?",
      ),
      input: vi.fn(
        async ({
          default: defaultValue,
          message,
          validate,
        }: {
          default?: string;
          message: string;
          validate?: (value: string) => boolean | string;
        }) => {
          if (message === "Project name") {
            expect(validate?.("My Lib")).toContain("lowercase");
            expect(validate?.("prompt-lib")).toBe(true);
            return defaultValue ?? "prompt-lib";
          }

          if (message === "Description") {
            return "Prompted description";
          }

          if (message === "Author") {
            return "Prompt Author <prompt@example.com>";
          }

          return "https://github.com/hbmartin/prompt-lib";
        },
      ),
      select: vi.fn(async ({ message }: { message: string }) => {
        if (message === "License") {
          return "Apache-2.0";
        }

        if (message === "Lint and format tooling") {
          return "biome";
        }

        if (message === "Build tool") {
          return "tsdown";
        }

        return "pnpm";
      }),
    };

    const result = await runCli(["prompt-lib", "--dry-run"], { promptModule });

    expect(result.exitCode).toBeUndefined();
    expect(result.stdout).toContain("Description: Prompted description");
    expect(result.stdout).toContain("Author: Prompt Author <prompt@example.com>");
    expect(result.stdout).toContain("License: Apache-2.0");
    expect(result.stdout).toContain("Lint/format: Biome");
    expect(result.stdout).toContain("Build tool: tsdown");
    expect(result.stdout).toContain("Package manager: pnpm");
    expect(result.stdout).toContain("CLI entry: yes");
    expect(result.stdout).toContain("Zod: no");
    expect(result.stdout).toContain("JSR: no");
    expect(promptModule.input).toHaveBeenCalledTimes(4);
    expect(promptModule.confirm).toHaveBeenCalledTimes(5);
    expect(promptModule.select).toHaveBeenCalledTimes(4);
  });

  it("uses an existing personal GitHub repository as the URL prompt default", async () => {
    const inspectPersonalGitHubRepository = vi.fn(
      async (): Promise<GitHubRepositoryLookupResult> => ({
        owner: "hbmartin",
        repositoryName: "prompt-lib",
        status: "found",
        url: "https://github.com/hbmartin/prompt-lib",
      }),
    );
    const promptModule = buildGitHubPromptModule({
      description: "Prompted description",
      expectedGithubRepoUrlDefault: "https://github.com/hbmartin/prompt-lib",
      githubRepoUrl: "https://github.com/hbmartin/prompt-lib",
      projectName: "prompt-lib",
    });

    const result = await runCli(["prompt-lib", "--dry-run"], {
      inspectPersonalGitHubRepository,
      promptModule,
    });

    expect(result.exitCode).toBeUndefined();
    expect(result.stdout).toContain("GitHub repo: https://github.com/hbmartin/prompt-lib");
    expect(inspectPersonalGitHubRepository).toHaveBeenCalledWith("prompt-lib");
  });

  it("continues local prompts while the GitHub lookup is in flight", async () => {
    const events: string[] = [];
    const inspectPersonalGitHubRepository = vi.fn(
      async (): Promise<GitHubRepositoryLookupResult> => {
        events.push("lookup-start");
        await Promise.resolve();
        events.push("lookup-finish");

        return {
          owner: "hbmartin",
          repositoryName: "prompt-lib",
          status: "found",
          url: "https://github.com/hbmartin/prompt-lib",
        };
      },
    );
    const promptModule = {
      confirm: vi.fn(async () => false),
      input: vi.fn(async ({ default: defaultValue, message }: PromptInputOptions) => {
        if (message === "Project name") {
          return "prompt-lib";
        }

        if (message === "Description") {
          events.push("description-prompt");
          return "Prompted description";
        }

        if (message === "Author") {
          return "Prompt Author <prompt@example.com>";
        }

        if (message === "GitHub repo URL") {
          return defaultValue ?? "https://github.com/hbmartin/prompt-lib";
        }

        throw new Error(`Unexpected input prompt: ${message}`);
      }),
      select: vi.fn(async ({ message }: PromptSelectOptions) => {
        if (message === "License") {
          return "Apache-2.0";
        }

        if (message === "Lint and format tooling") {
          return "oxlint-oxfmt";
        }

        return "pnpm";
      }),
    };

    const result = await runCli(["prompt-lib", "--dry-run"], {
      inspectPersonalGitHubRepository,
      promptModule,
    });

    expect(result.exitCode).toBeUndefined();
    expect(events.indexOf("lookup-start")).toBeLessThan(events.indexOf("description-prompt"));
    expect(events.indexOf("description-prompt")).toBeLessThan(events.indexOf("lookup-finish"));
  });

  it("predicts and reports GitHub repo creation in dry-run without calling gh create", async () => {
    const createGitHubRepository = vi.fn();
    const inspectPersonalGitHubRepository = vi.fn(
      async (): Promise<GitHubRepositoryLookupResult> => ({
        owner: "hbmartin",
        predictedUrl: "https://github.com/hbmartin/new-lib",
        repositoryName: "new-lib",
        status: "missing",
      }),
    );
    const promptModule = buildGitHubPromptModule({
      description: "New library",
      missingRepositoryChoice: "create-public",
      projectName: "new-lib",
    });

    const result = await runCli(["new-lib", "--dry-run"], {
      createGitHubRepository,
      inspectPersonalGitHubRepository,
      promptModule,
    });

    expect(result.exitCode).toBeUndefined();
    expect(result.stdout).toContain("GitHub repo: https://github.com/hbmartin/new-lib");
    expect(result.stdout).toContain("GitHub repo creation skipped by --dry-run");
    expect(createGitHubRepository).not.toHaveBeenCalled();
    expect(promptModule.input).toHaveBeenCalledTimes(3);
  });

  it("can create a private GitHub repo from the missing-repository prompt", async () => {
    const createGitHubRepository = vi.fn(
      async (): Promise<CreateGitHubRepositoryResult> => ({
        owner: "hbmartin",
        repositoryName: "private-lib",
        status: "created",
        url: "https://github.com/hbmartin/private-lib",
      }),
    );
    const scaffoldProject = vi.fn(async () => undefined);
    const inspectPersonalGitHubRepository = vi.fn(
      async (): Promise<GitHubRepositoryLookupResult> => ({
        owner: "hbmartin",
        predictedUrl: "https://github.com/hbmartin/private-lib",
        repositoryName: "private-lib",
        status: "missing",
      }),
    );
    const promptModule = buildGitHubPromptModule({
      description: "Private library",
      missingRepositoryChoice: "create-private",
      projectName: "private-lib",
    });

    const result = await runCli(["private-lib"], {
      createGitHubRepository,
      inspectPersonalGitHubRepository,
      promptModule,
      scaffoldProject,
    });

    expect(result.exitCode).toBeUndefined();
    expect(result.stdout).toContain(
      "GitHub repo action: will create private repo hbmartin/private-lib",
    );
    expect(createGitHubRepository).toHaveBeenCalledWith({
      description: "Private library",
      owner: "hbmartin",
      repositoryName: "private-lib",
      visibility: "private",
    });
  });

  it("lets users manually enter a URL when no matching GitHub repo exists", async () => {
    const createGitHubRepository = vi.fn();
    const inspectPersonalGitHubRepository = vi.fn(
      async (): Promise<GitHubRepositoryLookupResult> => ({
        owner: "hbmartin",
        predictedUrl: "https://github.com/hbmartin/manual-lib",
        repositoryName: "manual-lib",
        status: "missing",
      }),
    );
    const promptModule = buildGitHubPromptModule({
      description: "Manual library",
      expectedGithubRepoUrlDefault: "https://github.com/hbmartin/create-ts-lib",
      githubRepoUrl: "https://github.com/hbmartin/manual-lib",
      missingRepositoryChoice: "manual",
      projectName: "manual-lib",
    });

    const result = await runCli(["manual-lib", "--dry-run"], {
      createGitHubRepository,
      inspectPersonalGitHubRepository,
      promptModule,
    });

    expect(result.exitCode).toBeUndefined();
    expect(result.stdout).toContain("GitHub repo: https://github.com/hbmartin/manual-lib");
    expect(result.stdout).not.toContain("GitHub repo creation skipped by --dry-run");
    expect(createGitHubRepository).not.toHaveBeenCalled();
  });

  it("creates a missing GitHub repo before scaffolding and continues if creation fails", async () => {
    const events: string[] = [];
    const createGitHubRepository = vi.fn(async (): Promise<CreateGitHubRepositoryResult> => {
      events.push("create");
      return {
        owner: "hbmartin",
        reason: "repository already exists",
        repositoryName: "new-lib",
        status: "failed",
        url: "https://github.com/hbmartin/new-lib",
      };
    });
    const scaffoldProject = vi.fn(async () => {
      events.push("scaffold");
    });
    const inspectPersonalGitHubRepository = vi.fn(
      async (): Promise<GitHubRepositoryLookupResult> => ({
        owner: "hbmartin",
        predictedUrl: "https://github.com/hbmartin/new-lib",
        repositoryName: "new-lib",
        status: "missing",
      }),
    );
    const promptModule = buildGitHubPromptModule({
      description: "New library",
      missingRepositoryChoice: "create-public",
      projectName: "new-lib",
    });

    const result = await runCli(["new-lib"], {
      createGitHubRepository,
      inspectPersonalGitHubRepository,
      promptModule,
      scaffoldProject,
    });

    expect(result.exitCode).toBeUndefined();
    expect(result.stderr).toContain('Could not create GitHub repo "hbmartin/new-lib"');
    expect(result.stdout).toContain("GitHub repo action: will create public repo hbmartin/new-lib");
    expect(events).toEqual(["create", "scaffold"]);
    expect(createGitHubRepository).toHaveBeenCalledWith({
      description: "New library",
      owner: "hbmartin",
      repositoryName: "new-lib",
      visibility: "public",
    });
    expect(scaffoldProject).toHaveBeenCalledWith(
      expect.objectContaining({
        githubRepoUrl: "https://github.com/hbmartin/new-lib",
        projectName: "new-lib",
      }),
      expect.objectContaining({
        gitRemoteOriginUrl: "https://github.com/hbmartin/new-lib",
      }),
    );
    expect(result.stdout).toContain('git commit -m "Initial scaffold"');
    expect(result.stdout).toContain("git push -u origin HEAD");
  });

  it("does not create a GitHub repo when the target directory preflight fails", async () => {
    const tempDirectory = await mkdtemp(join(tmpdir(), "create-ts-lib-cli-non-empty-"));
    const targetDirectory = join(tempDirectory, "new-lib");
    await mkdir(targetDirectory);
    await writeFile(join(targetDirectory, "existing.txt"), "existing\n", "utf8");
    const createGitHubRepository = vi.fn();
    const scaffoldProject = vi.fn(async () => undefined);
    const inspectPersonalGitHubRepository = vi.fn(
      async (): Promise<GitHubRepositoryLookupResult> => ({
        owner: "hbmartin",
        predictedUrl: "https://github.com/hbmartin/new-lib",
        repositoryName: "new-lib",
        status: "missing",
      }),
    );
    const promptModule = buildGitHubPromptModule({
      description: "New library",
      missingRepositoryChoice: "create-public",
      projectName: "new-lib",
    });

    const result = await runCli([targetDirectory], {
      createGitHubRepository,
      inspectPersonalGitHubRepository,
      promptModule,
      scaffoldProject,
    });

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("Target directory is not empty");
    expect(createGitHubRepository).not.toHaveBeenCalled();
    expect(scaffoldProject).not.toHaveBeenCalled();
  });

  it("uses the detected git remote default when gh lookup is unavailable", async () => {
    const createGitHubRepository = vi.fn();
    const inspectPersonalGitHubRepository = vi.fn(
      async (): Promise<GitHubRepositoryLookupResult> => ({
        reason: "gh CLI is not authenticated",
        repositoryName: "manual-lib",
        status: "unavailable",
      }),
    );
    const promptModule = buildGitHubPromptModule({
      description: "Manual library",
      expectedGithubRepoUrlDefault: "https://github.com/hbmartin/create-ts-lib",
      githubRepoUrl: "https://github.com/hbmartin/manual-lib",
      projectName: "manual-lib",
    });

    const result = await runCli(["manual-lib", "--dry-run"], {
      createGitHubRepository,
      inspectPersonalGitHubRepository,
      promptModule,
    });

    expect(result.exitCode).toBeUndefined();
    expect(result.stderr).toContain("Could not inspect GitHub repositories with gh");
    expect(result.stderr).toContain("gh CLI is not authenticated");
    expect(result.stdout).toContain("GitHub repo: https://github.com/hbmartin/manual-lib");
    expect(createGitHubRepository).not.toHaveBeenCalled();
  });

  it("keeps --yes mode non-interactive and does not configure a git remote origin", async () => {
    const inspectPersonalGitHubRepository = vi.fn();
    const createGitHubRepository = vi.fn();
    const scaffoldProject = vi.fn(async () => undefined);

    const result = await runCli(["demo-lib", "--yes"], {
      createGitHubRepository,
      inspectPersonalGitHubRepository,
      scaffoldProject,
    });

    expect(result.exitCode).toBeUndefined();
    expect(inspectPersonalGitHubRepository).not.toHaveBeenCalled();
    expect(createGitHubRepository).not.toHaveBeenCalled();
    expect(scaffoldProject).toHaveBeenCalledWith(
      expect.objectContaining({
        githubRepoUrl: "https://github.com/hbmartin/create-ts-lib",
        lintFormatTooling: "oxlint-oxfmt",
        projectName: "demo-lib",
      }),
      expect.not.objectContaining({
        gitRemoteOriginUrl: expect.any(String),
      }),
    );
  });

  it("lets interactive users rename when the npm package name exists", async () => {
    const projectNames = ["react", "renamed-lib"];
    const checkNpmPackageNameAvailability = vi.fn(
      async (packageName: string): Promise<NpmPackageNameAvailability> => ({
        packageName,
        status: packageName === "react" ? "exists" : "available",
      }),
    );
    const promptModule = {
      confirm: vi.fn(async () => false),
      input: vi.fn(
        async ({
          message,
          validate,
        }: {
          default?: string;
          message: string;
          validate?: (value: string) => boolean | string;
        }) => {
          if (message === "Project name") {
            const projectName = projectNames.shift() ?? "renamed-lib";
            expect(validate?.(projectName)).toBe(true);
            return projectName;
          }

          if (message === "Description") {
            return "Prompted description";
          }

          if (message === "Author") {
            return "Prompt Author <prompt@example.com>";
          }

          return "https://github.com/hbmartin/renamed-lib";
        },
      ),
      select: vi.fn(async ({ message }: { message: string }) => {
        if (message === "Package name already exists on npm") {
          return "rename";
        }

        if (message === "License") {
          return "Apache-2.0";
        }

        if (message === "Lint and format tooling") {
          return "oxlint-oxfmt";
        }

        return "pnpm";
      }),
    };

    const result = await runCli(["react", "--dry-run"], {
      checkNpmPackageNameAvailability,
      promptModule,
    });

    expect(result.exitCode).toBeUndefined();
    expect(result.stderr).toContain('Package name "react" already exists on npm.');
    expect(result.stdout).toContain("Project: renamed-lib");
    expect(result.stdout).toContain(`Target: ${process.cwd()}/react`);
    expect(checkNpmPackageNameAvailability).toHaveBeenCalledTimes(2);
    expect(checkNpmPackageNameAvailability).toHaveBeenNthCalledWith(1, "react");
    expect(checkNpmPackageNameAvailability).toHaveBeenNthCalledWith(2, "renamed-lib");
    expect(promptModule.input).toHaveBeenCalledTimes(5);
    expect(promptModule.select).toHaveBeenCalledTimes(5);
  });

  it("lets interactive users keep an existing npm package name", async () => {
    const checkNpmPackageNameAvailability = vi.fn(
      async (packageName: string): Promise<NpmPackageNameAvailability> => ({
        packageName,
        status: "exists",
      }),
    );
    const promptModule = {
      confirm: vi.fn(async () => false),
      input: vi.fn(
        async ({
          message,
          validate,
        }: {
          default?: string;
          message: string;
          validate?: (value: string) => boolean | string;
        }) => {
          if (message === "Project name") {
            expect(validate?.("react")).toBe(true);
            return "react";
          }

          if (message === "Description") {
            return "Prompted description";
          }

          if (message === "Author") {
            return "Prompt Author <prompt@example.com>";
          }

          return "https://github.com/hbmartin/react";
        },
      ),
      select: vi.fn(async ({ message }: { message: string }) => {
        if (message === "Package name already exists on npm") {
          return "use-anyway";
        }

        if (message === "License") {
          return "Apache-2.0";
        }

        if (message === "Lint and format tooling") {
          return "oxlint-oxfmt";
        }

        return "pnpm";
      }),
    };

    const result = await runCli(["react", "--dry-run"], {
      checkNpmPackageNameAvailability,
      promptModule,
    });

    expect(result.exitCode).toBeUndefined();
    expect(result.stderr).toContain('Package name "react" already exists on npm.');
    expect(result.stdout).toContain("Project: react");
    expect(checkNpmPackageNameAvailability).toHaveBeenCalledOnce();
    expect(promptModule.input).toHaveBeenCalledTimes(4);
    expect(promptModule.select).toHaveBeenCalledTimes(5);
  });

  it("warns and continues when interactive npm availability cannot be checked", async () => {
    const checkNpmPackageNameAvailability = vi.fn(
      async (packageName: string): Promise<NpmPackageNameAvailability> => ({
        error: "network unavailable",
        packageName,
        status: "unknown",
      }),
    );
    const promptModule = {
      confirm: vi.fn(async () => false),
      input: vi.fn(
        async ({
          message,
          validate,
        }: {
          default?: string;
          message: string;
          validate?: (value: string) => boolean | string;
        }) => {
          if (message === "Project name") {
            expect(validate?.("network-lib")).toBe(true);
            return "network-lib";
          }

          if (message === "Description") {
            return "Prompted description";
          }

          if (message === "Author") {
            return "Prompt Author <prompt@example.com>";
          }

          return "https://github.com/hbmartin/network-lib";
        },
      ),
      select: vi.fn(async ({ message }: { message: string }) => {
        if (message === "License") {
          return "Apache-2.0";
        }

        if (message === "Lint and format tooling") {
          return "oxlint-oxfmt";
        }

        return "pnpm";
      }),
    };

    const result = await runCli(["network-lib", "--dry-run"], {
      checkNpmPackageNameAvailability,
      promptModule,
    });

    expect(result.exitCode).toBeUndefined();
    expect(result.stderr).toContain('Could not check npm availability for "network-lib"');
    expect(result.stderr).toContain("network unavailable");
    expect(result.stdout).toContain("Project: network-lib");
    expect(promptModule.input).toHaveBeenCalledTimes(4);
  });

  it("warns and continues in --yes mode when the npm package name exists", async () => {
    const scaffoldProject = vi.fn(async () => undefined);
    const checkNpmPackageNameAvailability = vi.fn(
      async (packageName: string): Promise<NpmPackageNameAvailability> => ({
        packageName,
        status: "exists",
      }),
    );

    const result = await runCli(["react", "--yes"], {
      checkNpmPackageNameAvailability,
      scaffoldProject,
    });

    expect(result.exitCode).toBeUndefined();
    expect(result.stderr).toContain('Package name "react" already exists on npm.');
    expect(result.stdout).toContain("Created react");
    expect(scaffoldProject).toHaveBeenCalledWith(
      expect.objectContaining({ projectName: "react" }),
      expect.any(Object),
    );
  });

  it("warns and continues when npm availability cannot be checked", async () => {
    const checkNpmPackageNameAvailability = vi.fn(
      async (packageName: string): Promise<NpmPackageNameAvailability> => ({
        packageName,
        status: "unknown",
        statusCode: 503,
      }),
    );

    const result = await runCli(["demo-lib", "--yes", "--dry-run"], {
      checkNpmPackageNameAvailability,
    });

    expect(result.exitCode).toBeUndefined();
    expect(result.stderr).toContain('Could not check npm availability for "demo-lib"; continuing.');
    expect(result.stderr).toContain("HTTP 503");
    expect(result.stdout).toContain("Project: demo-lib");
  });

  it("scaffolds the project and prints next steps", async () => {
    const scaffoldProject = vi.fn(async () => undefined);

    const result = await runCli(["demo-lib", "--yes"], { scaffoldProject });

    expect(result.exitCode).toBeUndefined();
    expect(result.stdout).toContain("Created demo-lib");
    expect(result.stdout).toContain("cd demo-lib");
    expect(result.stdout).toContain("pnpm run lint");
    expect(result.stdout).toContain(
      "Set up Codecov: https://app.codecov.io/gh/hbmartin/create-ts-lib/new",
    );
    expect(
      result.stdout.endsWith(
        "Set up Codecov: https://app.codecov.io/gh/hbmartin/create-ts-lib/new\n",
      ),
    ).toBe(true);
    expect(scaffoldProject).toHaveBeenCalledWith(
      expect.objectContaining({
        lintFormatTooling: "oxlint-oxfmt",
        packageManager: "pnpm",
        projectName: "demo-lib",
      }),
      expect.objectContaining({ targetDirectory: expect.stringContaining("demo-lib") }),
    );
  });

  it.each([
    ["SSH shorthand", "git@github.com:hbmartin/example-lib.git"],
    ["git+HTTPS", "git+https://github.com/hbmartin/example-lib.git"],
    ["git+SSH", "git+ssh://git@github.com/hbmartin/example-lib.git"],
    ["SSH URL", "ssh://git@github.com/hbmartin/example-lib.git"],
    ["git protocol", "git://github.com/hbmartin/example-lib.git"],
  ])("prints a normalized Codecov setup URL for %s defaults", async (_label, githubRepoUrl) => {
    const scaffoldProject = vi.fn(async () => undefined);

    const result = await runCli(["demo-lib", "--yes"], {
      detectedDefaults: { githubRepoUrl },
      scaffoldProject,
    });

    expect(result.exitCode).toBeUndefined();
    expect(result.stdout).toContain(
      "Set up Codecov: https://app.codecov.io/gh/hbmartin/example-lib/new",
    );
  });

  it.each([
    ["blank", ""],
    ["non-GitHub", "https://gitlab.com/hbmartin/example-lib.git"],
  ])("omits the Codecov setup URL for a %s repo URL", async (_label, githubRepoUrl) => {
    const scaffoldProject = vi.fn(async () => undefined);

    const result = await runCli(["demo-lib", "--yes"], {
      detectedDefaults: { githubRepoUrl },
      scaffoldProject,
    });

    expect(result.exitCode).toBeUndefined();
    expect(result.stdout).not.toContain("Set up Codecov:");
  });

  it.each(["npm", "yarn"] as const)(
    "omits the Codecov setup URL for %s projects",
    async (packageManager) => {
      const scaffoldProject = vi.fn(async () => undefined);
      const promptModule = buildGitHubPromptModule({
        description: "Prompted description",
        expectedGithubRepoUrlDefault: `https://github.com/hbmartin/codecov-${packageManager}-lib`,
        githubRepoUrl: "https://github.com/hbmartin/example-lib",
        includeCodecov: true,
        packageManager,
        projectName: `codecov-${packageManager}-lib`,
      });

      const result = await runCli([`codecov-${packageManager}-lib`], {
        promptModule,
        scaffoldProject,
      });

      expect(result.exitCode).toBeUndefined();
      expect(result.stdout).not.toContain("Set up Codecov:");
      expect(scaffoldProject).toHaveBeenCalledWith(
        expect.objectContaining({
          includeCodecov: true,
          packageManager,
        }),
        expect.any(Object),
      );
    },
  );

  it.each([
    {
      excludedCommands: [],
      includedCommands: ["pnpm install", "pnpm run build", "pnpm run test"],
      step: "install",
    },
    {
      excludedCommands: ["pnpm install"],
      includedCommands: ["pnpm run build", "pnpm run test"],
      step: "build",
    },
    {
      excludedCommands: ["pnpm install", "pnpm run build"],
      includedCommands: ["pnpm run test"],
      step: "test",
    },
  ] as const)(
    "prints recovery steps when post-scaffold $step setup fails",
    async ({ excludedCommands, includedCommands, step }) => {
      const scaffoldProject = vi.fn(
        async (
          _config: unknown,
          options: {
            targetDirectory: string;
          },
        ) => {
          throw new PostScaffoldSetupError({
            cause: new Error(`pnpm ${step} failed`),
            packageManager: "pnpm",
            step,
            targetDirectory: options.targetDirectory,
          });
        },
      );

      const result = await runCli(["demo-lib", "--yes"], { scaffoldProject });

      expect(result.exitCode).toBe(1);
      expect(result.stdout).not.toContain("Created demo-lib");
      expect(result.stderr).toContain(`pnpm ${step} failed`);
      expect(result.stderr).toContain("Project files were created at");
      expect(result.stderr).toContain("/demo-lib");
      expect(result.stderr).toContain("cd ");
      for (const command of includedCommands) {
        expect(result.stderr).toContain(`  ${command}\n`);
      }
      for (const command of excludedCommands) {
        expect(result.stderr).not.toContain(`  ${command}\n`);
      }
    },
  );

  it("does not print recovery steps for scaffold write failures", async () => {
    const scaffoldProject = vi.fn(async () => {
      throw new Error("Target directory is not empty");
    });

    const result = await runCli(["demo-lib", "--yes"], { scaffoldProject });

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("Target directory is not empty");
    expect(result.stderr).not.toContain("Project files were created at");
    expect(result.stderr).not.toContain("pnpm install");
  });

  it("reports scaffold progress without a TTY", async () => {
    const scaffoldProject = vi.fn(
      async (
        _config: unknown,
        options: {
          progress?: ScaffoldProgress;
        },
      ) => {
        options.progress?.start("Preparing git repository");
        options.progress?.info("Using cached packages");
        options.progress?.succeed("Git repository ready");
        options.progress?.fail("Installing dependencies");
      },
    );

    const result = await runCli(["demo-lib", "--yes"], { scaffoldProject });

    expect(result.exitCode).toBeUndefined();
    expect(result.stdout).toContain("start Preparing git repository");
    expect(result.stdout).toContain("info Using cached packages");
    expect(result.stdout).toContain("done Git repository ready");
    expect(result.stdout).toContain("failed Installing dependencies");
  });

  it("reports scaffold progress with an ora spinner when stdout is a TTY", async () => {
    const spinner = {
      fail: vi.fn(),
      succeed: vi.fn(),
    };
    const ora = vi.fn(() => ({
      start: vi.fn(() => spinner),
    }));
    const scaffoldProject = vi.fn(
      async (
        _config: unknown,
        options: {
          progress?: ScaffoldProgress;
        },
      ) => {
        options.progress?.start("Installing dependencies");
        options.progress?.succeed("Dependencies installed");
        options.progress?.start("Testing generated project");
        options.progress?.fail("Testing generated project");
      },
    );

    const result = await runCli(["demo-lib", "--yes"], {
      ora,
      scaffoldProject,
      stdoutIsTTY: true,
    });

    expect(result.exitCode).toBeUndefined();
    expect(ora).toHaveBeenCalledWith("Installing dependencies");
    expect(ora).toHaveBeenCalledWith("Testing generated project");
    expect(spinner.succeed).toHaveBeenCalledWith("Dependencies installed");
    expect(spinner.fail).toHaveBeenCalledWith("Testing generated project");
  });

  it("passes --force to the scaffold operation", async () => {
    const scaffoldProject = vi.fn(async () => undefined);

    await runCli(["demo-lib", "--yes", "--force"], { scaffoldProject });

    expect(scaffoldProject).toHaveBeenCalledWith(
      expect.objectContaining({ projectName: "demo-lib" }),
      expect.objectContaining({ force: true }),
    );
  });
});

interface BuildGitHubPromptModuleOptions {
  author?: string;
  description: string;
  expectedGithubRepoUrlDefault?: string;
  githubRepoUrl?: string;
  includeCodecov?: boolean;
  missingRepositoryChoice?: "create-private" | "create-public" | "manual";
  packageManager?: "npm" | "pnpm" | "yarn";
  projectName: string;
}

const buildGitHubPromptModule = ({
  author = "Prompt Author <prompt@example.com>",
  description,
  expectedGithubRepoUrlDefault,
  githubRepoUrl,
  includeCodecov = false,
  missingRepositoryChoice,
  packageManager = "pnpm",
  projectName,
}: BuildGitHubPromptModuleOptions): PromptModule => ({
  confirm: vi.fn(
    async ({ message }: { default?: boolean; message: string }) =>
      message === "Include Codecov?" && includeCodecov,
  ),
  input: vi.fn(async ({ default: defaultValue, message }: PromptInputOptions) => {
    if (message === "Project name") {
      return projectName;
    }

    if (message === "Description") {
      return description;
    }

    if (message === "Author") {
      return author;
    }

    if (message === "GitHub repo URL" && githubRepoUrl !== undefined) {
      expect(defaultValue).toBe(expectedGithubRepoUrlDefault);
      return githubRepoUrl;
    }

    throw new Error(`Unexpected input prompt: ${message}`);
  }),
  select: vi.fn(async ({ default: defaultValue, message }: PromptSelectOptions) => {
    if (message === "No matching GitHub repo was found" && missingRepositoryChoice !== undefined) {
      expect(defaultValue).toBe("create-public");
      return missingRepositoryChoice;
    }

    if (message === "License") {
      return "Apache-2.0";
    }

    if (message === "Lint and format tooling") {
      return "oxlint-oxfmt";
    }

    if (message === "Build tool") {
      return "tsc";
    }

    return packageManager;
  }),
});

const ciEnvironmentVariable = "CI";
const forceColorEnvironmentVariable = "FORCE_COLOR";
const noColorEnvironmentVariable = "NO_COLOR";
const xdgConfigHomeEnvironmentVariable = "XDG_CONFIG_HOME";

const runCli = async (args: string[], options: RunCliOptions = {}): Promise<CliResult> => {
  vi.resetModules();
  vi.doUnmock("../source/cli-helpers.js");
  vi.doUnmock("../source/github-cli.js");
  vi.doUnmock("../source/npm-registry.js");
  vi.doUnmock("../source/prompts.js");
  vi.doUnmock("../source/scaffold.js");
  vi.doUnmock("ora");

  vi.doMock("../source/cli-helpers.js", async (importOriginal) => {
    const actual = await importOriginal<typeof import("../source/cli-helpers.js")>();

    return {
      ...actual,
      detectDefaults: vi.fn(async (directoryArgument: string | undefined) => ({
        ...buildDetectedDefaults(directoryArgument),
        ...options.detectedDefaults,
      })),
    };
  });

  vi.doMock("../source/github-cli.js", async (importOriginal) => {
    const actual = await importOriginal<typeof import("../source/github-cli.js")>();
    const inspectPersonalGitHubRepository =
      options.inspectPersonalGitHubRepository ??
      vi.fn(async (projectName: string): Promise<GitHubRepositoryLookupResult> => {
        const repositoryName = projectName.includes("/")
          ? (projectName.split("/").at(-1) ?? projectName)
          : projectName;

        return {
          owner: "hbmartin",
          repositoryName,
          status: "found",
          url: `https://github.com/hbmartin/${repositoryName}`,
        };
      });
    const createGitHubRepository =
      options.createGitHubRepository ??
      vi.fn(
        async (request: CreateGitHubRepositoryRequest): Promise<CreateGitHubRepositoryResult> => ({
          owner: request.owner,
          repositoryName: request.repositoryName,
          status: "created",
          url: `https://github.com/${request.owner}/${request.repositoryName}`,
        }),
      );

    return {
      ...actual,
      createGitHubRepository,
      inspectPersonalGitHubRepository,
    };
  });

  if (options.promptModule) {
    vi.doMock("../source/prompts.js", () => ({
      loadPromptModule: async () => options.promptModule,
    }));
  }

  vi.doMock("../source/npm-registry.js", () => ({
    checkNpmPackageNameAvailability:
      options.checkNpmPackageNameAvailability ??
      vi.fn(
        async (packageName: string): Promise<NpmPackageNameAvailability> => ({
          packageName,
          status: "available",
        }),
      ),
  }));

  if (options.scaffoldProject) {
    vi.doMock("../source/scaffold.js", () => ({
      PostScaffoldSetupError,
      scaffoldProject: options.scaffoldProject,
    }));
  }

  if (options.ora) {
    vi.doMock("ora", () => ({
      default: options.ora,
    }));
  }

  const stdout: string[] = [];
  const stderr: string[] = [];
  const stdoutSpy = vi.spyOn(process.stdout, "write").mockImplementation(((chunk: string) => {
    stdout.push(chunk);
    return true;
  }) as typeof process.stdout.write);
  const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(((chunk: string) => {
    stderr.push(chunk);
    return true;
  }) as typeof process.stderr.write);

  process.argv = [process.execPath, "create-ts-lib", ...args];
  process.exitCode = undefined;
  const originalCi = process.env[ciEnvironmentVariable];
  const originalForceColor = process.env[forceColorEnvironmentVariable];
  const originalNoColor = process.env[noColorEnvironmentVariable];
  const originalXdgConfigHome = process.env[xdgConfigHomeEnvironmentVariable];
  const originalStdoutIsTTY = process.stdout.isTTY;
  delete process.env[ciEnvironmentVariable];
  delete process.env[forceColorEnvironmentVariable];
  process.env[noColorEnvironmentVariable] = "1";
  // Point user-config loading at an isolated directory so developer machines
  // with a real ~/.config/create-ts-lib/config.json do not affect tests.
  process.env[xdgConfigHomeEnvironmentVariable] = await mkdtemp(
    join(tmpdir(), "create-ts-lib-xdg-"),
  );
  if (options.stdoutIsTTY !== undefined) {
    Object.defineProperty(process.stdout, "isTTY", {
      configurable: true,
      value: options.stdoutIsTTY,
    });
  }

  try {
    await import("../source/cli.js");
    return {
      exitCode: process.exitCode,
      stderr: stderr.join(""),
      stdout: stdout.join(""),
    };
  } finally {
    if (options.stdoutIsTTY !== undefined) {
      Object.defineProperty(process.stdout, "isTTY", {
        configurable: true,
        value: originalStdoutIsTTY,
      });
    }
    restoreEnvironmentVariable(ciEnvironmentVariable, originalCi);
    restoreEnvironmentVariable(forceColorEnvironmentVariable, originalForceColor);
    restoreEnvironmentVariable(noColorEnvironmentVariable, originalNoColor);
    restoreEnvironmentVariable(xdgConfigHomeEnvironmentVariable, originalXdgConfigHome);
    stdoutSpy.mockRestore();
    stderrSpy.mockRestore();
  }
};

const restoreEnvironmentVariable = (name: string, value: string | undefined): void => {
  if (value === undefined) {
    delete process.env[name];
    return;
  }

  process.env[name] = value;
};

const buildDetectedDefaults = (directoryArgument: string | undefined): DetectedDefaults => ({
  author: "Test Author <test@example.com>",
  githubRepoUrl: "https://github.com/hbmartin/create-ts-lib",
  projectName: directoryArgument ? basename(directoryArgument) : "my-lib",
});
