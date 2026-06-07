import { afterEach, describe, expect, it, vi } from "vitest";

import { checkNpmPackageNameAvailability } from "../source/npm-registry.js";

afterEach(() => {
  vi.useRealTimers();
});

describe("checkNpmPackageNameAvailability", () => {
  it("reports existing package names", async () => {
    const fetchPackage = vi.fn(async () => ({ status: 200 }));

    await expect(
      checkNpmPackageNameAvailability("react", { fetch: fetchPackage }),
    ).resolves.toEqual({
      packageName: "react",
      status: "exists",
    });
    expect(fetchPackage).toHaveBeenCalledWith(
      "https://registry.npmjs.org/react",
      expect.objectContaining({
        headers: { Accept: "application/json" },
        signal: expect.any(AbortSignal),
      }),
    );
  });

  it("reports available package names", async () => {
    const fetchPackage = vi.fn(async () => ({ status: 404 }));

    await expect(
      checkNpmPackageNameAvailability("@scope/example-lib", { fetch: fetchPackage }),
    ).resolves.toEqual({
      packageName: "@scope/example-lib",
      status: "available",
    });
    expect(fetchPackage).toHaveBeenCalledWith(
      "https://registry.npmjs.org/%40scope%2Fexample-lib",
      expect.objectContaining({
        headers: { Accept: "application/json" },
        signal: expect.any(AbortSignal),
      }),
    );
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

  it("reports timed out registry requests as unknown", async () => {
    vi.useFakeTimers();
    const fetchPackage = vi.fn(
      (_url: string, init: RequestInit) =>
        new Promise<{ status: number }>((_resolve, reject) => {
          init.signal?.addEventListener("abort", () => {
            reject(new DOMException("The operation was aborted", "AbortError"));
          });
        }),
    );

    const availability = checkNpmPackageNameAvailability("example-lib", {
      fetch: fetchPackage,
      timeoutMilliseconds: 10,
    });

    await vi.advanceTimersByTimeAsync(10);

    await expect(availability).resolves.toEqual({
      error: "Request timed out",
      packageName: "example-lib",
      status: "unknown",
    });
  });

  it("reports thrown non-error values as unknown registry errors", async () => {
    const fetchPackage = vi.fn(() => Promise.reject("network unavailable"));

    await expect(
      checkNpmPackageNameAvailability("example-lib", { fetch: fetchPackage }),
    ).resolves.toEqual({
      error: "Unknown registry error",
      packageName: "example-lib",
      status: "unknown",
    });
  });

  it("normalizes custom registry URLs without trailing slashes", async () => {
    const fetchPackage = vi.fn(async () => ({ status: 404 }));

    await checkNpmPackageNameAvailability("example-lib", {
      fetch: fetchPackage,
      registryUrl: "https://registry.example.test/npm",
    });

    expect(fetchPackage).toHaveBeenCalledWith(
      "https://registry.example.test/npm/example-lib",
      expect.objectContaining({
        headers: { Accept: "application/json" },
        signal: expect.any(AbortSignal),
      }),
    );
  });
});
