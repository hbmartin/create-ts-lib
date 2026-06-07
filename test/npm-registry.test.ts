import { describe, expect, it, vi } from "vitest";

import { checkNpmPackageNameAvailability } from "../source/npm-registry.js";

describe("checkNpmPackageNameAvailability", () => {
  it("reports existing package names", async () => {
    const fetchPackage = vi.fn(async () => ({ status: 200 }));

    await expect(
      checkNpmPackageNameAvailability("react", { fetch: fetchPackage }),
    ).resolves.toEqual({
      packageName: "react",
      status: "exists",
    });
    expect(fetchPackage).toHaveBeenCalledWith("https://registry.npmjs.org/react", {
      headers: { Accept: "application/json" },
    });
  });

  it("reports available package names", async () => {
    const fetchPackage = vi.fn(async () => ({ status: 404 }));

    await expect(
      checkNpmPackageNameAvailability("@scope/example-lib", { fetch: fetchPackage }),
    ).resolves.toEqual({
      packageName: "@scope/example-lib",
      status: "available",
    });
    expect(fetchPackage).toHaveBeenCalledWith("https://registry.npmjs.org/%40scope%2Fexample-lib", {
      headers: { Accept: "application/json" },
    });
  });

  it("reports unexpected registry statuses as unknown", async () => {
    const fetchPackage = vi.fn(async () => ({ status: 503 }));

    await expect(
      checkNpmPackageNameAvailability("example-lib", { fetch: fetchPackage }),
    ).resolves.toEqual({
      packageName: "example-lib",
      status: "unknown",
      statusCode: 503,
    });
  });

  it("reports network failures as unknown", async () => {
    const fetchPackage = vi.fn(async () => {
      throw new Error("network unavailable");
    });

    await expect(
      checkNpmPackageNameAvailability("example-lib", { fetch: fetchPackage }),
    ).resolves.toEqual({
      error: "network unavailable",
      packageName: "example-lib",
      status: "unknown",
    });
  });
});
