import { describe, expect, it } from "vitest";

import { formatShellArgument } from "../source/cli-output.js";

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
