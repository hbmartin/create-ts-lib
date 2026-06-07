import { describe, expect, it } from "vitest";

import { equalResolvedPaths } from "../source/path-comparison.js";

describe("equalResolvedPaths", () => {
  it("compares resolved paths case-insensitively when requested", () => {
    expect(equalResolvedPaths("/tmp/Example", "/tmp/example", { caseInsensitive: true })).toBe(
      true,
    );
  });

  it("preserves case-sensitive path comparison when requested", () => {
    expect(equalResolvedPaths("/tmp/Example", "/tmp/example", { caseInsensitive: false })).toBe(
      false,
    );
  });
});
