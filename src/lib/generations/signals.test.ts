import { describe, expect, it } from "vitest";
import { SIGNAL_KINDS, isKeepingSignal, isSignalKind, verdictFor } from "./signals";

// Revealed preference (2026-09-07).
//
// The identity score is a model's opinion and a competitor can buy ten
// thousand of them in a week. What a real customer DID with a render is the
// one label nobody can manufacture, and until now none of it was recorded.
//
// What this file exists to catch: an edit that makes the label lie. Counting a
// look as approval, letting a tidy-up erase a download, or renaming a kind
// after rows carry it are all quiet ways to poison the only dataset here that
// cannot be bought.

describe("the vocabulary", () => {
  it("accepts exactly the kinds it defines", () => {
    for (const k of SIGNAL_KINDS) expect(isSignalKind(k)).toBe(true);
    expect(isSignalKind("liked")).toBe(false);
    expect(isSignalKind("")).toBe(false);
  });

  // These names end up in stored rows. Renaming one splits a dataset in half
  // without any error being raised, so the list is pinned rather than trusted.
  it("is pinned, because a rename silently splits stored data", () => {
    expect([...SIGNAL_KINDS]).toEqual(["downloaded", "continued", "shared", "opened", "deleted"]);
  });
});

describe("which signals mean the person wanted it", () => {
  it("counts acting to keep, not looking", () => {
    expect(isKeepingSignal("downloaded")).toBe(true);
    expect(isKeepingSignal("continued")).toBe(true);
    expect(isKeepingSignal("shared")).toBe(true);
    expect(isKeepingSignal("deleted")).toBe(false);
  });

  // The one that matters most. Someone opens a render to find out WHETHER it
  // worked, which happens just as often when it did not — so counting a look
  // as approval labels every bad render positive.
  it("never treats opening as approval", () => {
    expect(isKeepingSignal("opened")).toBe(false);
    expect(verdictFor([{ kind: "opened" }])).toBe("unknown");
    expect(verdictFor([{ kind: "opened" }, { kind: "opened" }])).toBe("unknown");
  });
});

describe("the verdict for one render", () => {
  it("reads a keeping action as kept", () => {
    expect(verdictFor([{ kind: "downloaded" }])).toBe("kept");
    expect(verdictFor([{ kind: "continued" }])).toBe("kept");
    expect(verdictFor([{ kind: "shared" }])).toBe("kept");
  });

  it("reads a bare delete as rejected", () => {
    expect(verdictFor([{ kind: "deleted" }])).toBe("rejected");
    expect(verdictFor([{ kind: "opened" }, { kind: "deleted" }])).toBe("rejected");
  });

  // Downloading a render and later clearing it out of the grid is
  // housekeeping, not a retraction — the person took the file.
  it("does not let a later tidy-up erase a download", () => {
    expect(verdictFor([{ kind: "downloaded" }, { kind: "deleted" }])).toBe("kept");
    expect(verdictFor([{ kind: "deleted" }, { kind: "downloaded" }])).toBe("kept");
  });

  // Silence is the common case, and calling it rejection would measure how
  // often people bother to click rather than how good the renders were.
  it("says unknown when nothing was done, and means it", () => {
    expect(verdictFor([])).toBe("unknown");
  });
});
