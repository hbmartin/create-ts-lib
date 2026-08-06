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

  it("retries text input until validation passes", async () => {
    const input = new PassThrough();
    const output = new PassThrough();
    const prompts = createFallbackPrompts(input, output);
    const result = prompts.input({
      message: "Project name",
      validate: (value) => (value === "valid-lib" ? true : "Invalid package name."),
    });

    input.write("My Lib\n");
    input.end("valid-lib\n");

    await expect(result).resolves.toBe("valid-lib");
  });

  it("uses a default validation message for false validation results", async () => {
    const input = new PassThrough();
    const output = new PassThrough();
    const prompts = createFallbackPrompts(input, output);
    const result = prompts.input({
      message: "Project name",
      validate: (value) => value === "valid-lib",
    });

    input.write("My Lib\n");
    input.end("valid-lib\n");

    await expect(result).resolves.toBe("valid-lib");
  });

  it("rejects when input closes during validation", async () => {
    const input = new PassThrough();
    const prompts = createFallbackPrompts(input, new PassThrough());
    const validatedValues: string[] = [];

    const result = prompts.input({
      message: "Project name",
      validate: (value) => {
        validatedValues.push(value);
        return "Invalid package name.";
      },
    });

    input.end("invalid\n");

    await expect(result).rejects.toThrow("Input stream closed");
    expect(validatedValues).toEqual(["invalid"]);
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

  it("rejects empty choices when no default can be selected", async () => {
    await expect(createPrompts("").select({ choices: [], message: "License" })).rejects.toThrow(
      "At least one choice is required.",
    );
  });
});

describe("createFallbackPrompts checkbox", () => {
  const choices = [
    { checked: true, name: "first", value: "a" },
    { checked: true, name: "second", value: "b" },
    { checked: false, name: "third", value: "c" },
  ];

  it("returns the pre-checked choices for an empty answer", async () => {
    await expect(createPrompts("").checkbox({ choices, message: "Pick" })).resolves.toEqual([
      "a",
      "b",
    ]);
  });

  it.each([
    ["1 3", ["a", "c"]],
    ["1,3", ["a", "c"]],
    ["2", ["b"]],
    ["3 3 1", ["c", "a"]],
  ])("parses the selection %j", async (answer, expected) => {
    await expect(createPrompts(answer).checkbox({ choices, message: "Pick" })).resolves.toEqual(
      expected,
    );
  });

  it.each(["a", "all", "A"])("selects everything for %j", async (answer) => {
    await expect(createPrompts(answer).checkbox({ choices, message: "Pick" })).resolves.toEqual([
      "a",
      "b",
      "c",
    ]);
  });

  it.each(["n", "none"])("selects nothing for %j", async (answer) => {
    await expect(createPrompts(answer).checkbox({ choices, message: "Pick" })).resolves.toEqual([]);
  });

  // `,` and `, ,` used to parse as an empty selection, silently dropping every
  // feature the user meant to keep. Only "n"/"none" mean nothing.
  it.each(["0", "4", "two", ",", ", ,"])("rejects the invalid selection %j", async (answer) => {
    await expect(createPrompts(answer).checkbox({ choices, message: "Pick" })).rejects.toThrow(
      "Invalid selection",
    );
  });

  it.each(["1,", " 2 "])("still accepts the padded selection %j", async (answer) => {
    await expect(
      createPrompts(answer).checkbox({ choices, message: "Pick" }),
    ).resolves.toHaveLength(1);
  });
});
