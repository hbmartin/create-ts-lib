import { describe, expect, it } from "vitest";

import { validatePackageName } from "../source/package-name.js";

describe("validatePackageName", () => {
  it.each(["example-lib", "@scope/example-lib", "example.lib", "example_lib", "-example"])(
    "accepts valid package name %s",
    (packageName) => {
      expect(validatePackageName(packageName)).toMatchObject({
        errors: [],
        valid: true,
      });
    },
  );

  it.each(["", "My Lib", "@scope/", "@/name", "example lib", ".example", "_example"])(
    "rejects invalid package name %s",
    (packageName) => {
      expect(validatePackageName(packageName).valid).toBe(false);
    },
  );

  it("rejects package names longer than npm allows", () => {
    expect(validatePackageName("a".repeat(215)).errors).toContain(
      "Package name must be 214 characters or fewer.",
    );
  });
});
