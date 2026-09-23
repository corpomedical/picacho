import { afterEach, describe, expect, it, vi } from "vitest";
import { allowLandscape } from "./orientation";

function fakeShell() {
  const calls: string[] = [];
  const plugin = {
    allowLandscape: () => (calls.push("allow"), Promise.resolve()),
    lockPortrait: () => (calls.push("lock"), Promise.resolve()),
  };
  vi.stubGlobal("window", { Capacitor: { Plugins: { PicachoOrientation: plugin } } });
  return calls;
}

afterEach(() => vi.unstubAllGlobals());

describe("allowLandscape", () => {
  it("unlocks on open and locks again on close", () => {
    const calls = fakeShell();
    const release = allowLandscape();
    release();
    expect(calls).toEqual(["allow", "lock"]);
  });

  it("keeps landscape while an outer viewer is still open", () => {
    const calls = fakeShell();
    const outer = allowLandscape();
    const inner = allowLandscape();
    inner();
    expect(calls).toEqual(["allow"]);
    inner(); // a second release of the same viewer counts once
    expect(calls).toEqual(["allow"]);
    outer();
    expect(calls).toEqual(["allow", "lock"]);
  });

  it("is a no-op without the plugin (web, or a shell older than 18)", () => {
    vi.stubGlobal("window", { Capacitor: { Plugins: {} } });
    expect(() => allowLandscape()()).not.toThrow();
  });
});
