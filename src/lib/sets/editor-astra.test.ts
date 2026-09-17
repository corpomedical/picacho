import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { selectionAfter } from "./editor-model";
import { normaliseSetSpec, type SetSpec } from "./set-spec";
import raceTrack from "./fixtures-race-track.json";

// The Build editor when Astra's answer lands (found reviewing Helios,
// 2026-09-17):
// - `commitFromServer` kept the selection as it was. A change that
//   shortens a list — "remove the two carts" — left it pointing past the
//   end, and the editor threw while drawing the thing's name, so the whole
//   page went to the error screen with the answer on it.
// - A hand edit made in the last 1.2 s before the answer had a save on a
//   timer. It landed after Astra's, so the server kept the copy Astra was
//   given, while the screen showed Astra's answer and thought it saved.
// - The editor's keys fired while the Material dropdown had the keyboard.

const editor = readFileSync(join(__dirname, "../../components/sets/set-editor.tsx"), "utf8");
const built = normaliseSetSpec(raceTrack);
if (!built.ok) throw new Error("fixture invalid");
const spec: SetSpec = built.spec;

describe("an Astra change in the Build editor", () => {
  it("keeps the thing in hand, and lets go of one the change removed", () => {
    const shorter: SetSpec = { ...spec, objects: spec.objects.slice(0, spec.objects.length - 2) };
    // The last object is gone: nothing is in hand.
    expect(selectionAfter({ kind: "object", index: spec.objects.length - 1 }, spec, shorter)).toBeNull();
    // One that is still there is found again, wherever it now sits.
    const moved: SetSpec = { ...spec, objects: [...spec.objects.slice(1)] };
    expect(selectionAfter({ kind: "object", index: 4 }, spec, moved)).toEqual({ kind: "object", index: 3 });
  });

  it("the editor runs that rule on the answer, and never draws a thing that is gone", () => {
    const commit = editor.slice(editor.indexOf("  function commitFromServer("), editor.indexOf("\n  }\n", editor.indexOf("  function commitFromServer(")));
    expect(commit).toContain("const keep = selectionAfter(selRef.current, specRef.current, next);");
    expect(commit).toContain("selRef.current = keep;");
    expect(commit.indexOf("selRef.current = keep;")).toBeLessThan(commit.indexOf("applySpec(next);"));
    // The name and the inspector cope with a list that shortened under them.
    expect(editor).toContain("const selName = !sel || selGone");
    expect(editor).toContain('const selObject = sel?.kind === "object" ? (spec.objects[sel.index] ?? null) : null;');
  });

  it("drops a hand edit's pending save, which would land on top of the answer", () => {
    const commit = editor.slice(editor.indexOf("  function commitFromServer("), editor.indexOf("\n  }\n", editor.indexOf("  function commitFromServer(")));
    expect(commit).toContain("clearTimeout(saveTimerRef.current);");
    expect(commit).toContain("saveTimerRef.current = null;");
  });

  it("leaves the keyboard to a dropdown", () => {
    expect(editor).toContain('el.tagName === "SELECT"');
  });
});
