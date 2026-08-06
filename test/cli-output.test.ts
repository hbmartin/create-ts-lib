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

  it("omits the Codecov setup URL in workspace mode", () => {
    // The upload step lives in the CI workflow workspace mode does not emit, so
    // the URL would point at a parent repository this scaffold does not own.
    const output = captureNextSteps(
      {
        githubRepoUrl: "https://github.com/hbmartin/monorepo",
        includeCodecov: true,
        projectName: "example-lib",
        workspaceMode: true,
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

  const rootOwnedAnswers = {
    includeCodecov: true,
    includeCommunityFiles: true,
    includeSecurityWorkflows: true,
    projectName: "example-lib",
  };

  it("reports the answers plainly outside workspace mode", () => {
    const output = captureSummary(rootOwnedAnswers);

    expect(output).toContain("Codecov: yes\n");
    expect(output).toContain("Security workflows: yes\n");
    expect(output).toContain("Community files: yes\n");
  });

  it("marks the answers workspace mode makes inert", () => {
    // Reporting a plain "yes" here claims the scaffold did something it did not:
    // all three are gated behind files the workspace root owns.
    const output = captureSummary({ ...rootOwnedAnswers, workspaceMode: true });

    expect(output).toContain("Codecov: yes (root-owned)\n");
    expect(output).toContain("Security workflows: yes (root-owned)\n");
    expect(output).toContain("Community files: yes (root-owned)\n");
    // The recorded answer is still shown: it applies again if the package is
    // lifted out of the workspace.
    expect(output).not.toContain("Codecov: no");
  });

  it("leaves answers that still take effect unqualified", () => {
    const output = captureSummary({ ...rootOwnedAnswers, includeCli: true, workspaceMode: true });

    expect(output).toContain("CLI entry: yes\n");
  });
});
