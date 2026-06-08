import { execFile } from "node:child_process";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  deriveDirectoryName,
  detectDefaults,
  normalizeGitHubUrl,
  parseCliArguments,
} from "../source/cli-helpers.js";
import {
  parseGitHubRepositoryUrl,
  stripGitSuffix,
  stripPackageScope,
} from "../source/name-helpers.js";

vi.mock("node:child_process", () => ({
  execFile: vi.fn(),
}));

afterEach(() => {
  vi.clearAllMocks();
});

describe("parseCliArguments", () => {
  it("parses directory, yes, dry-run, and force flags", () => {
    expect(parseCliArguments(["my-lib", "--yes", "--dry-run", "--force"])).toEqual({
      directoryArgument: "my-lib",
      dryRun: true,
      force: true,
      help: false,
      version: false,
      yes: true,
      zod: false,
    });
  });

  it("parses Zod opt-in", () => {
    expect(parseCliArguments(["my-lib", "--zod"])).toEqual({
      directoryArgument: "my-lib",
      dryRun: false,
      force: false,
      help: false,
      version: false,
      yes: false,
      zod: true,
    });
  });

  it("parses Codecov opt-out", () => {
    expect(parseCliArguments(["my-lib", "--no-codecov"])).toEqual({
      codecov: false,
      directoryArgument: "my-lib",
      dryRun: false,
      force: false,
      help: false,
      version: false,
      yes: false,
      zod: false,
    });
  });

  it("parses lint and format tooling selection", () => {
    expect(parseCliArguments(["my-lib", "--lint-format", "biome"])).toEqual({
      directoryArgument: "my-lib",
      dryRun: false,
      force: false,
      help: false,
      lintFormatTooling: "biome",
      version: false,
      yes: false,
      zod: false,
    });
  });

  it("parses lint and format tooling selection with equals syntax", () => {
    expect(parseCliArguments(["my-lib", "--lint-format=biome"])).toEqual({
      directoryArgument: "my-lib",
      dryRun: false,
      force: false,
      help: false,
      lintFormatTooling: "biome",
      version: false,
      yes: false,
      zod: false,
    });
  });

  it("rejects unknown options and extra positional arguments", () => {
    expect(() => parseCliArguments(["--bad"])).toThrow("Unknown option");
    expect(() => parseCliArguments(["--lint-format"])).toThrow("Missing value");
    expect(() => parseCliArguments(["--lint-format="])).toThrow("Missing value");
    expect(() => parseCliArguments(["--lint-format", "eslint"])).toThrow(
      "Invalid --lint-format value",
    );
    expect(() => parseCliArguments(["--lint-format=eslint"])).toThrow(
      "Invalid --lint-format value",
    );
    expect(() => parseCliArguments(["one", "two"])).toThrow("Unexpected extra argument");
  });
});

describe("shared name helpers", () => {
  it("removes npm scopes and git suffixes", () => {
    expect(stripPackageScope("@scope/example-lib")).toBe("example-lib");
    expect(stripPackageScope("plain-lib")).toBe("plain-lib");
    expect(stripGitSuffix("https://github.com/hbmartin/example-lib.git")).toBe(
      "https://github.com/hbmartin/example-lib",
    );
  });
});

describe("deriveDirectoryName", () => {
  it("removes npm scopes", () => {
    expect(deriveDirectoryName("@scope/example-lib")).toBe("example-lib");
    expect(deriveDirectoryName("plain-lib")).toBe("plain-lib");
  });
});

describe("normalizeGitHubUrl", () => {
  it.each([
    ["SSH shorthand", "git@github.com:hbmartin/example-lib.git"],
    ["HTTPS", "https://github.com/hbmartin/example-lib.git"],
    ["git+HTTPS", "git+https://github.com/hbmartin/example-lib.git"],
    ["git+SSH", "git+ssh://git@github.com/hbmartin/example-lib.git"],
    ["SSH URL", "ssh://git@github.com/hbmartin/example-lib.git"],
    ["git protocol", "git://github.com/hbmartin/example-lib.git"],
  ])("normalizes %s GitHub remote forms", (_label, githubRepoUrl) => {
    expect(normalizeGitHubUrl(githubRepoUrl)).toBe("https://github.com/hbmartin/example-lib");
  });

  it("keeps empty input empty", () => {
    expect(normalizeGitHubUrl("")).toBe("");
  });

  it("leaves unsupported remote URLs unchanged", () => {
    expect(normalizeGitHubUrl("https://gitlab.com/hbmartin/example-lib.git")).toBe(
      "https://gitlab.com/hbmartin/example-lib.git",
    );
  });
});

describe("parseGitHubRepositoryUrl", () => {
  it.each([
    ["SSH shorthand", "git@github.com:hbmartin/example-lib.git"],
    ["HTTPS", "https://github.com/hbmartin/example-lib.git"],
    ["HTTPS trailing slash", "https://github.com/hbmartin/example-lib/"],
    ["git+HTTPS", "git+https://github.com/hbmartin/example-lib.git"],
    ["git+SSH", "git+ssh://git@github.com/hbmartin/example-lib.git"],
    ["SSH URL", "ssh://git@github.com/hbmartin/example-lib.git"],
    ["git protocol", "git://github.com/hbmartin/example-lib.git"],
  ])("parses %s GitHub repository URLs", (_label, githubRepoUrl) => {
    expect(parseGitHubRepositoryUrl(githubRepoUrl)).toEqual({
      owner: "hbmartin",
      repo: "example-lib",
    });
  });

  it.each([
    "",
    "https://gitlab.com/hbmartin/example-lib.git",
    "http://github.com/hbmartin/example-lib",
    "https://github.com/hbmartin",
    "https://github.com/hbmartin/example-lib/issues",
    "https://github.com/hbmartin/example-lib?tab=readme-ov-file",
  ])("rejects unsupported repository URL %s", (githubRepoUrl) => {
    expect(parseGitHubRepositoryUrl(githubRepoUrl)).toBeUndefined();
  });
});

describe("detectDefaults", () => {
  it("derives author and GitHub defaults from injected git readers", async () => {
    await expect(
      detectDefaults("packages/example-lib", {
        gitReaders: {
          readGitConfigValue: async (key) =>
            key === "user.name" ? "Harold Martin" : "harold@example.com",
          readGitRemoteOrigin: async () => "git@github.com:hbmartin/create-ts-lib.git",
        },
      }),
    ).resolves.toEqual({
      author: "Harold Martin <harold@example.com>",
      githubRepoUrl: "https://github.com/hbmartin/create-ts-lib",
      projectName: "example-lib",
    });
  });

  it("warns and falls back when default git readers fail", async () => {
    const warnings: string[] = [];
    vi.mocked(execFile).mockImplementation(((...args: unknown[]) => {
      const callback = args.findLast(
        (argument): argument is (error: Error, stdout: string, stderr: string) => void =>
          typeof argument === "function",
      );

      callback?.(new Error("git failed"), "", "");

      return {} as ReturnType<typeof execFile>;
    }) as typeof execFile);

    const defaults = await detectDefaults(undefined, {
      warn: (message) => warnings.push(message),
    });

    expect(defaults).toEqual({
      author: "",
      githubRepoUrl: "",
      projectName: "my-lib",
    });
    expect(warnings).toHaveLength(3);
    expect(warnings).toEqual(
      expect.arrayContaining([
        "Could not read git config user.name; using a blank default.",
        "Could not read git config user.email; using a blank default.",
        "Could not read git remote origin; using a blank GitHub repo default.",
      ]),
    );
  });
});
