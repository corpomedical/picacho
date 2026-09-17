import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { UnrecognizedActionError } from "next/dist/client/components/unrecognized-action-error";
import { isStaleDeployError, reloadForNewDeploy, STALE_RELOAD_GUARD_MS, STALE_RELOAD_KEY } from "./stale-deploy";

// Next 16.3's client throws exactly this from fetchServerAction
// (router-reducer/reducers/server-action-reducer.js) when the server answers
// x-nextjs-action-not-found: a deploy landed while the tab was open. The
// composer's own copy of the detector knew only the older wording and showed
// "submit failed" instead of reloading (2026-09-11). Built from Next's real
// class, so an upgrade that renames it fails here rather than in a stale tab.
function nextUnrecognizedAction(actionId: string) {
  return new UnrecognizedActionError(
    `Server Action "${actionId}" was not found on the server. \nRead more: https://nextjs.org/docs/messages/failed-to-find-server-action`,
  );
}

describe("isStaleDeployError", () => {
  it("recognises Next 16's UnrecognizedActionError by its name, even reworded", () => {
    expect(isStaleDeployError(nextUnrecognizedAction("7f3a9c"))).toBe(true);
    expect(isStaleDeployError(new UnrecognizedActionError("reworded by a later Next"))).toBe(true);
  });

  it("recognises its message as bare text, which is all the error reporter may get", () => {
    expect(isStaleDeployError(nextUnrecognizedAction("7f3a9c").message)).toBe(true);
  });

  it("still recognises the older wording", () => {
    expect(isStaleDeployError(new Error("An unexpected response was received from the server."))).toBe(true);
  });

  it("leaves real failures alone", () => {
    for (const err of [
      new Error("Failed to fetch"),
      new TypeError("Cannot read properties of undefined (reading 'id')"),
      "Unhandled promise rejection",
      undefined,
      null,
    ]) {
      expect(isStaleDeployError(err)).toBe(false);
    }
  });
});

// A page that saves by itself (Helios's autosaves, 2026-09-16) reloads for a
// new deploy on its own, not only when a person presses something — so a
// failure a reload does not cure must not reload it for ever. One guard,
// shared with the error reporter: at most one reload per 30 s per tab.
describe("reloadForNewDeploy", () => {
  let kept: Map<string, string>;
  let blocked: boolean;
  let steps: string[];
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000_000);
    kept = new Map();
    blocked = false;
    steps = [];
    vi.stubGlobal("window", {
      sessionStorage: {
        getItem: (key: string) => {
          if (blocked) throw new Error("SecurityError");
          return kept.get(key) ?? null;
        },
        setItem: (key: string, value: string) => {
          if (blocked) throw new Error("SecurityError");
          kept.set(key, value);
        },
      },
      location: { reload: () => steps.push("reload") },
    });
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("reloads after the delay, keeping what the page could not save first", () => {
    expect(reloadForNewDeploy({ delayMs: 1800, before: () => steps.push("kept") })).toBe(true);
    expect(kept.get(STALE_RELOAD_KEY)).toBe("1000000");
    vi.advanceTimersByTime(1799);
    expect(steps).toEqual([]);
    vi.advanceTimersByTime(1);
    expect(steps).toEqual(["kept", "reload"]);
  });

  it("does not reload a tab that reloaded for this in the last 30 s, whoever reloaded it", () => {
    kept.set(STALE_RELOAD_KEY, String(1_000_000 - STALE_RELOAD_GUARD_MS));
    expect(reloadForNewDeploy({ before: () => steps.push("kept") })).toBe(false);
    vi.advanceTimersByTime(60_000);
    expect(steps).toEqual([]);
    kept.set(STALE_RELOAD_KEY, String(1_000_000 - STALE_RELOAD_GUARD_MS - 1));
    expect(reloadForNewDeploy()).toBe(true);
    vi.advanceTimersByTime(0);
    expect(steps).toEqual(["reload"]);
  });

  it("still reloads a tab that keeps nothing, and at once when there is no delay", () => {
    blocked = true;
    expect(reloadForNewDeploy()).toBe(true);
    expect(steps).toEqual(["reload"]);
  });

  it("is every page's guard: no page that knows about a stale deploy reloads on its own", () => {
    // Fourteen call sites reloaded the page themselves, so a failure that
    // only looks stale — a timed-out function reads as "an unexpected
    // response" — could reload an autosaving page again and again, and a
    // reporter reload could stack on a page reload inside the same 30 s
    // (found reviewing Helios, fixed 2026-09-18).
    const root = join(__dirname, "..", "components");
    const walk = (dir: string): string[] =>
      readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
        e.isDirectory() ? walk(join(dir, e.name)) : e.name.endsWith(".tsx") ? [join(dir, e.name)] : [],
      );
    const offenders = walk(root).filter((file) => {
      const text = readFileSync(file, "utf8");
      // Only the pages that know about a stale deploy: a reload for another
      // reason (settings/privacy-panel.tsx, after a data wipe) is its own.
      return text.includes("isStaleDeployError") && /window\.location\.reload\(/.test(text);
    });
    expect(offenders.map((f) => f.slice(root.length + 1))).toEqual([]);
  });

  it("is the error reporter's guard too", () => {
    const reporter = readFileSync(join(__dirname, "../components/app-error-reporter.tsx"), "utf8");
    expect(reporter).toContain("if (stale && reloadForNewDeploy()) return;");
    expect(reporter).not.toContain("picacho-stale-build-reload");
    expect(reporter).not.toContain("window.location.reload(");
  });
});
