import { execFile } from "node:child_process";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  deriveDirectoryName,
  detectDefaults,
  normalizeGitHubUrl,
  parseCliArguments,
} from "../source/cli-helpers.js";

vi.mock("node:child_process", () => ({
  execFile: vi.fn(),
}));

afterEach(() => {
  vi.clearAllMocks();
});

describe("parseCliArguments", () => {
  it("parses directory, yes, and dry-run flags", () => {
    expect(parseCliArguments(["my-lib", "--yes", "--dry-run"])).toEqual({
      directoryArgument: "my-lib",
      dryRun: true,
      help: false,
      version: false,
      yes: true,
    });
  });

  it("rejects unknown options and extra positional arguments", () => {
    expect(() => parseCliArguments(["--bad"])).toThrow("Unknown option");
    expect(() => parseCliArguments(["one", "two"])).toThrow("Unexpected extra argument");
  });
});

describe("deriveDirectoryName", () => {
  it("removes npm scopes", () => {
    expect(deriveDirectoryName("@scope/example-lib")).toBe("example-lib");
    expect(deriveDirectoryName("plain-lib")).toBe("plain-lib");
  });
});

describe("normalizeGitHubUrl", () => {
  it("normalizes common GitHub remote forms", () => {
    expect(normalizeGitHubUrl("git@github.com:hbmartin/example-lib.git")).toBe(
      "https://github.com/hbmartin/example-lib",
    );
    expect(normalizeGitHubUrl("https://github.com/hbmartin/example-lib.git")).toBe(
      "https://github.com/hbmartin/example-lib",
    );
    expect(normalizeGitHubUrl("")).toBe("");
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
