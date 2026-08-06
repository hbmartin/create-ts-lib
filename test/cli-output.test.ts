import process from "node:process";

import { describe, expect, it, vi } from "vitest";

import { formatShellArgument, printNextSteps } from "../source/cli-output.js";
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
