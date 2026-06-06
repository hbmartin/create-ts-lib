import { describe, expect, it } from "vitest";

import { scaffoldProject } from "../source/index.js";

describe("public API", () => {
  it("exports scaffoldProject from the package root", () => {
    expect(scaffoldProject).toBeTypeOf("function");
  });
});
