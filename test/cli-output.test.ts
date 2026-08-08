import process from "node:process";

import { describe, expect, it, vi } from "vitest";

import { formatShellArgument, printNextSteps, printSummary } from "../source/cli-output.js";
import { defaultScaffoldConfig } from "../source/templates/files.js";

describe("formatShellArgument", () => {
  it("returns safe values unquoted", () => {
    expect(formatShellArgument("/home/user/my-lib", "linux")).toBe("/home/user/my-lib");
    expect(formatShellArgument("C:/projects/my-lib", "win32")).toBe("C:/projects/my-lib");
  });

  it("single-quotes unsafe values on POSIX platforms", () => {
    expect(formatShellArgument("/home/user/my lib", "linux")).toBe("'/home/user/my lib'");
    expect(formatShellArgument("/home/user/it's here", "darwin")).toBe(
      "'/home/user/it'\\''s here'",
    );
  });

  it("double-quotes unsafe values on Windows", () => {
    expect(formatShellArgument(String.raw`C:\Users\jane\my lib`, "win32")).toBe(
      String.raw`"C:\Users\jane\my lib"`,
    );
  });
});

describe("printNextSteps", () => {
  const captureNextSteps = (
    overrides: Parameters<typeof defaultScaffoldConfig>[0],
    includeGitHubPublishSteps: boolean,
  ): string => {
    const write = vi.spyOn(process.stdout, "write").mockReturnValue(true);
    try {
      printNextSteps(defaultScaffoldConfig(overrides), "/tmp/example-lib", {
        includeGitHubPublishSteps,
        skipGit: false,
        skipInstall: false,
      });

      return write.mock.calls.map(([chunk]) => String(chunk)).join("");
    } finally {
      write.mockRestore();
    }
  };

  it("prints the publish steps when a remote was configured", () => {
    const output = captureNextSteps(
      { githubRepoUrl: "https://github.com/hbmartin/example-lib", projectName: "example-lib" },
      true,
    );

    expect(output).toContain("git push -u origin HEAD");
  });

  it("prints the Codecov setup URL when generated CI can upload to it", () => {
    const output = captureNextSteps(
      {
        githubRepoUrl: "https://github.com/hbmartin/example-lib",
        includeCodecov: true,
        projectName: "example-lib",
      },
      false,
    );

    expect(output).toContain("https://app.codecov.io/gh/hbmartin/example-lib/new");
  });

  // Wherever no CI workflow is generated there is nothing for Codecov to
  // receive, so the setup URL is an instruction that cannot be carried out --
  // and in workspace mode it names a repository this scaffold does not own.
  it.each([
    ["workspace mode", { workspaceMode: true }],
    ["an npm project", { packageManager: "npm" } as const],
  ])("omits the Codecov setup URL for %s", (_name, overrides) => {
    const output = captureNextSteps(
      {
        githubRepoUrl: "https://github.com/hbmartin/monorepo",
        includeCodecov: true,
        projectName: "example-lib",
        ...overrides,
      },
      false,
    );

    expect(output).not.toContain("app.codecov.io");
  });

  it("omits the publish steps in workspace mode", () => {
    // Workspace mode skips git setup entirely, so no remote was ever added --
    // printing the push command would name a remote that does not exist.
    const output = captureNextSteps(
      {
        githubRepoUrl: "https://github.com/hbmartin/example-lib",
        projectName: "example-lib",
        workspaceMode: true,
      },
      true,
    );

    expect(output).not.toContain("git push -u origin HEAD");
    expect(output).toContain("Workspace package:");
  });
});

describe("printSummary", () => {
  const captureSummary = (overrides: Parameters<typeof defaultScaffoldConfig>[0]): string => {
    const write = vi.spyOn(process.stdout, "write").mockReturnValue(true);
    try {
      printSummary(defaultScaffoldConfig(overrides), "/tmp/example-lib", false, undefined);

      return write.mock.calls.map(([chunk]) => String(chunk)).join("");
    } finally {
      write.mockRestore();
    }
  };

  const everyFeatureOn = {
    githubRepoUrl: "https://github.com/hbmartin/example-lib",
    includeCli: true,
    includeCodecov: true,
    includeCommunityFiles: true,
    includeJsr: true,
    includeSecurityWorkflows: true,
    includeZod: true,
    packageManager: "pnpm",
    projectName: "example-lib",
  } as const;

  it("reports the answers plainly when every one of them takes effect", () => {
    const output = captureSummary(everyFeatureOn);

    expect(output).toContain("Codecov: yes\n");
    expect(output).toContain("Security workflows: yes\n");
    expect(output).toContain("Community files: yes\n");
  });

  // Each of these withholds `.github/workflows/**`, which is the only route
  // Codecov and the security workflows have into the project. Reporting a bare
  // "yes" claims the scaffold did something it did not. The first commit to fix
  // this handled only workspace mode and left the other two lying.
  it.each([
    ["a workspace package", { workspaceMode: true }, "root-owned"],
    ["a project with no repo URL", { githubRepoUrl: "" }, "needs a repo URL"],
    ["an npm project", { packageManager: "npm" } as const, "generated CI is pnpm-only"],
  ])("qualifies the workflow-backed answers for %s", (_name, overrides, reason) => {
    const output = captureSummary({ ...everyFeatureOn, ...overrides });

    expect(output).toContain(`Codecov: yes (${reason})\n`);
    expect(output).toContain(`Security workflows: yes (${reason})\n`);
    // The recorded answer stays visible: it applies again as soon as whatever
    // suppresses it changes.
    expect(output).not.toContain("Codecov: no");
  });

  it("qualifies community files only in workspace mode", () => {
    // Unlike the other two, these do not depend on the workflows, so an npm
    // project still gets them.
    expect(captureSummary({ ...everyFeatureOn, packageManager: "npm" })).toContain(
      "Community files: yes\n",
    );
    expect(captureSummary({ ...everyFeatureOn, workspaceMode: true })).toContain(
      "Community files: yes (root-owned)\n",
    );
  });

  it("leaves answers that still take effect unqualified", () => {
    const output = captureSummary({ ...everyFeatureOn, workspaceMode: true });

    expect(output).toContain("CLI entry: yes\n");
    expect(output).toContain("Zod: yes\n");
    expect(output).toContain("JSR: yes\n");
  });

  it("never qualifies a declined answer", () => {
    // A "no" claims nothing, so there is nothing to correct and the marker
    // would only be noise.
    const output = captureSummary({
      ...everyFeatureOn,
      includeCodecov: false,
      workspaceMode: true,
    });

    expect(output).toContain("Codecov: no\n");
  });
});
