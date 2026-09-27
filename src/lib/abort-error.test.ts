import { describe, expect, it } from "vitest";
import { isAbortError } from "./abort-error";

describe("isAbortError", () => {
  it("knows a cancel, however it arrives", () => {
    expect(isAbortError(new DOMException("The operation was aborted.", "AbortError"))).toBe(true);
    expect(isAbortError({ name: "AbortError", message: "Fetch is aborted" })).toBe(true);
  });

  it("leaves every other rejection to be filed", () => {
    expect(isAbortError(new Error("The operation was aborted."))).toBe(false);
    expect(isAbortError(new DOMException("Not allowed", "NotAllowedError"))).toBe(false);
    expect(isAbortError("AbortError")).toBe(false);
    expect(isAbortError(null)).toBe(false);
    expect(isAbortError(undefined)).toBe(false);
  });
});
