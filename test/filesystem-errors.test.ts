import { describe, expect, it } from "vitest";

import {
  formatErrorMessage,
  isErrorWithCode,
  isFileNotFoundError,
} from "../source/filesystem-errors.js";

const errnoError = (code: string): Error => Object.assign(new Error(`${code}: failed`), { code });

describe("isErrorWithCode", () => {
  it("matches string and numeric codes on error-like objects", () => {
    expect(isErrorWithCode(errnoError("ENOENT"), "ENOENT")).toBe(true);
    expect(isErrorWithCode({ code: 4 }, 4)).toBe(true);
    expect(isErrorWithCode(errnoError("ENOENT"), "EACCES")).toBe(false);
    expect(isErrorWithCode(new Error("no code"), "ENOENT")).toBe(false);
    expect(isErrorWithCode("ENOENT", "ENOENT")).toBe(false);
    expect(isErrorWithCode(null, "ENOENT")).toBe(false);
  });
});

describe("isFileNotFoundError", () => {
  it("treats ENOENT and ENOTDIR as file-not-found", () => {
    expect(isFileNotFoundError(errnoError("ENOENT"))).toBe(true);
    expect(isFileNotFoundError(errnoError("ENOTDIR"))).toBe(true);
  });

  it("rejects other errors", () => {
    expect(isFileNotFoundError(errnoError("EACCES"))).toBe(false);
    expect(isFileNotFoundError(errnoError("EISDIR"))).toBe(false);
    expect(isFileNotFoundError(new Error("plain"))).toBe(false);
    expect(isFileNotFoundError(undefined)).toBe(false);
  });
});

describe("formatErrorMessage", () => {
  it("prefers the Error message", () => {
    expect(formatErrorMessage(new Error("boom"))).toBe("boom");
    expect(formatErrorMessage(new Error("boom"), "fallback")).toBe("boom");
  });

  it("uses the fallback, then String coercion, for non-Error values", () => {
    expect(formatErrorMessage("boom", "fallback")).toBe("fallback");
    expect(formatErrorMessage("boom")).toBe("boom");
    expect(formatErrorMessage(42)).toBe("42");
  });
});
