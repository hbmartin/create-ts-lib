import { PassThrough, Readable } from "node:stream";

import { describe, expect, it } from "vitest";

import { createFallbackPrompts } from "../source/prompts.js";

const createPrompts = (answer: string) =>
  createFallbackPrompts(Readable.from([`${answer}\n`]), new PassThrough());

describe("createFallbackPrompts", () => {
  it("returns text input or the default value", async () => {
    await expect(
      createPrompts("custom").input({ default: "default", message: "Name" }),
    ).resolves.toBe("custom");
    await expect(createPrompts("").input({ default: "default", message: "Name" })).resolves.toBe(
      "default",
    );
  });

  it("parses confirmations with defaults", async () => {
    await expect(
      createPrompts("yes").confirm({ default: false, message: "Continue?" }),
    ).resolves.toBe(true);
    await expect(createPrompts("").confirm({ default: true, message: "Continue?" })).resolves.toBe(
      true,
    );
    await expect(
      createPrompts("no").confirm({ default: true, message: "Continue?" }),
    ).resolves.toBe(false);
  });

  it("selects by number, value, name, or default", async () => {
    const choices = [
      { name: "MIT", value: "MIT" },
      { name: "Apache-2.0", value: "Apache-2.0" },
    ] as const;

    await expect(
      createPrompts("2").select({ choices: [...choices], default: "MIT", message: "License" }),
    ).resolves.toBe("Apache-2.0");
    await expect(
      createPrompts("Apache-2.0").select({
        choices: [...choices],
        default: "MIT",
        message: "License",
      }),
    ).resolves.toBe("Apache-2.0");
    await expect(
      createPrompts("apache-2.0").select({
        choices: [...choices],
        default: "MIT",
        message: "License",
      }),
    ).resolves.toBe("Apache-2.0");
    await expect(
      createPrompts("").select({ choices: [...choices], default: "MIT", message: "License" }),
    ).resolves.toBe("MIT");
  });

  it("rejects invalid selections", async () => {
    await expect(
      createPrompts("3").select({
        choices: [{ name: "MIT", value: "MIT" }],
        default: "MIT",
        message: "License",
      }),
    ).rejects.toThrow("Invalid selection: 3");
  });
});
