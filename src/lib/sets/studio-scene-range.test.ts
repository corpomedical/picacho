import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { normaliseStudioScene, savedPlaybackRange } from "./studio-scene";

// The playback range is kept with the scene (2026-09-30): it reset to 1–240
// on every reopen, which turned a 3-credit "Video with your character" into
// a 6-credit one without a word.

describe("the saved playback range", () => {
  it("comes back as it was set, whole frames inside the timeline", () => {
    expect(savedPlaybackRange([1, 120], 240)).toEqual([1, 120]);
    expect(savedPlaybackRange([24.4, 96.6], 240)).toEqual([24, 97]);
  });
  it("a scene saved before it was kept, or a broken one, opens on the full timeline", () => {
    for (const bad of [undefined, null, [], [1], [120, 1], [0, 120], [1, 999], ["1", "120"], [1, NaN], { start: 1, end: 120 }]) {
      expect(savedPlaybackRange(bad, 240), JSON.stringify(bad)).toBeNull();
    }
  });
  it("rides the account's copy untouched", () => {
    const n = normaliseStudioScene({ v: 1, items: [], range: [1, 120] });
    expect(n.ok && n.scene.range).toEqual([1, 120]);
  });
  it("the Studio writes it into every snapshot and reads it back on open", () => {
    const engine = readFileSync(join(__dirname, "../../components/studio/studio-engine.ts"), "utf8");
    expect(engine).toContain("markers, range: [pStart, pEnd], items:");
    expect(engine).toContain("const savedRange = savedPlaybackRange(data.range, FRAMES); if (savedRange) { [pStart, pEnd] = savedRange; renderTimeline(); }");
  });
});
