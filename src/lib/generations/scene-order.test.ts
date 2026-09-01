import { describe, expect, it } from "vitest";
import { angleSortIndex, sceneShotKey } from "./angles";
import { MAX_SCENE_SHOTS } from "./scene-plan";

// Shot ordering (2026-09-01, with Cinema Studio).
//
// For a shot list the order IS the content. Every row in a batch shares one
// created_at — reserve_generations inserts them in a single transaction and
// Postgres now() is transaction start time — so created_at cannot break a tie
// and angleSortIndex is the only thing deciding what plays when.

describe("sceneShotKey", () => {
  it("is 1-based, so shot 1 reads as shot 1", () => {
    expect(sceneShotKey(0)).toBe("shot-1");
    expect(sceneShotKey(5)).toBe("shot-6");
  });

  it("REGRESSION: every shot in a scene gets a DISTINCT key", () => {
    // A pending unique index on (user_id, angle_group_id, angle) is
    // load-bearing, and reserve_generations has no exception handler — a
    // duplicate key aborts the whole batch insert.
    const keys = Array.from({ length: MAX_SCENE_SHOTS }, (_, i) => sceneShotKey(i));
    expect(new Set(keys).size).toBe(MAX_SCENE_SHOTS);
  });
});

describe("angleSortIndex for scenes", () => {
  it("REGRESSION: shots sort in narrative order, not arbitrarily", () => {
    const keys = Array.from({ length: MAX_SCENE_SHOTS }, (_, i) => sceneShotKey(i));
    const shuffled = [...keys].reverse();
    const sorted = [...shuffled].sort((a, b) => angleSortIndex(a) - angleSortIndex(b));
    expect(sorted).toEqual(keys);
  });

  it("gives every shot a distinct sort key", () => {
    const idx = Array.from({ length: MAX_SCENE_SHOTS }, (_, i) => angleSortIndex(sceneShotKey(i)));
    expect(new Set(idx).size).toBe(MAX_SCENE_SHOTS);
  });

  it("sorts past 9 correctly, not lexicographically", () => {
    // "shot-10" < "shot-9" as strings. As shots it must not be.
    expect(angleSortIndex("shot-9")).toBeLessThan(angleSortIndex("shot-10"));
  });

  it("leaves the five fixed angles exactly as they were", () => {
    const angles = ["front", "side", "three-quarter", "back", "close-up"];
    const idx = angles.map(angleSortIndex);
    expect(idx).toEqual([...idx].sort((a, b) => a - b));
    expect(idx[0]).toBe(0);
  });

  it("never lets a shot interleave with an angle group", () => {
    for (const a of ["front", "close-up", "legacy-angle", null]) {
      expect(angleSortIndex("shot-1")).toBeGreaterThan(angleSortIndex(a));
    }
  });

  it("ignores something that merely looks like a shot key", () => {
    for (const junk of ["shot-", "shot-x", "shot-1a", "SHOT-1", "shot-1234"]) {
      expect(angleSortIndex(junk), junk).toBe(5);
    }
  });
});
