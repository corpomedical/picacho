import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// Who may say a build settled (2026-09-11). The finisher pushes "ready" or
// "couldn't be built" only when the tick reports settledHere, and nothing
// else stands between it and a duplicate or false notification: the page
// and the finisher both find a stale build and both close it, or two
// overlapping runs both deliver its draft, and only the tick whose
// conditional write returned a row may report it. finisher.test.ts drives a
// fake tick, so this pins the real one. Read as source: build-tick.ts
// imports through "@/" and cannot load here.

const source = readFileSync(join(__dirname, "build-tick.ts"), "utf8");
const between = (from: string, to: string) => {
  const start = source.indexOf(from);
  expect(start, from).toBeGreaterThan(-1);
  const end = source.indexOf(to, start + from.length);
  expect(end, to).toBeGreaterThan(start);
  return source.slice(start, end);
};

describe("a tick reports a settle only for its own write", () => {
  it("settles in exactly two places: the close as failed, and the save as ready", () => {
    expect([...source.matchAll(/\bsettle\("(\w+)"\)/g)].map((m) => m[1]).sort()).toEqual(["failed", "ready"]);
    // Anything else that reached the callback would be a third.
    expect(source.match(/\bsettle\(/g)).toHaveLength(2);
  });

  it("the close as failed: only when its write, conditioned on the row still building, moved a row", () => {
    const close = between("const closeFailed = async", "const deletedMeanwhile = async");
    const guard = close.indexOf('.eq("status", "building")');
    const settled = close.indexOf('if (closed?.length) settle("failed");');
    expect(guard).toBeGreaterThan(-1);
    expect(settled).toBeGreaterThan(guard);
  });

  it("the save as ready: only after its write, conditioned on the row still building, returned a row", () => {
    const save = between("const finishReady = async", "\n  };");
    const guard = save.indexOf('.eq("status", "building")');
    const none = save.indexOf("if (!saved?.length) return");
    const settled = save.indexOf('settle("ready")');
    for (const [name, at] of Object.entries({ guard, none, settled })) expect(at, name).toBeGreaterThan(-1);
    expect(none).toBeGreaterThan(guard);
    expect(settled).toBeGreaterThan(none);
    // A failed save is handed to closeFailed, which decides for itself.
    expect(save.indexOf('return closeFailed("save", costUsd);')).toBeLessThan(none);
  });

  it("reports what the callback was told, and nothing else", () => {
    const advance = between("export async function advanceSetBuild(", "\n}\n");
    expect(advance).toContain('let settledHere: SetBuildTick["settledHere"] = null;');
    expect(advance).toContain("settledHere = how;");
    expect(advance).toContain("return { result, settledHere };");
    expect(advance.match(/\bsettledHere = /g)).toHaveLength(1);
  });

  it("notifies nobody itself: its callers decide, and only the finisher pushes", () => {
    expect(source).not.toMatch(/push\/send|notifyUser|sendToWebPushDevice|showNotification/);
  });
});
