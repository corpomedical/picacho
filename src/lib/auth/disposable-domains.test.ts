import { describe, expect, it } from "vitest";
import { isDisposableEmail } from "./disposable-domains";

describe("isDisposableEmail", () => {
  it("catches the major disposable providers", () => {
    expect(isDisposableEmail("a@mailinator.com")).toBe(true);
    expect(isDisposableEmail("b@YOPMAIL.com")).toBe(true);
    expect(isDisposableEmail("c@temp-mail.org")).toBe(true);
    expect(isDisposableEmail("d@sharklasers.com")).toBe(true);
  });

  it("catches per-user subdomains of listed providers", () => {
    expect(isDisposableEmail("x@anything.mailinator.com")).toBe(true);
  });

  it("fails open: real hosts, garbage, and near-misses all pass", () => {
    expect(isDisposableEmail("me@gmail.com")).toBe(false);
    expect(isDisposableEmail("me@hotmail.com")).toBe(false);
    expect(isDisposableEmail("me@my-company.io")).toBe(false);
    // A domain that merely CONTAINS a listed name is not a match.
    expect(isDisposableEmail("me@notmailinator.company.com")).toBe(false);
    expect(isDisposableEmail("no-at-sign")).toBe(false);
    expect(isDisposableEmail("")).toBe(false);
  });
});
