import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { normaliseShotRig } from "./shot-rig";

// A shot keeps the rig it was shot with. Until helios-rig.sql runs, the
// columns do not exist — so only shot-rig.ts may name them, each in a
// statement of its own whose failure is ignored.

describe("normaliseShotRig", () => {
  it("keeps the format and each checked look's words; drops the rest", () => {
    expect(normaliseShotRig({ format: "scope", squeeze: 2, words: { lens: "  An  anamorphic lens. ", mood: "x", focus: "" } })).toEqual({
      format: "scope",
      squeeze: 2,
      words: { lens: "An anamorphic lens." },
    });
    // A row from before the squeeze was kept, and one with a squeeze the rig
    // does not have, both read as spherical (2026-09-18).
    expect(normaliseShotRig({ format: "scope" })).toEqual({ format: "scope", squeeze: 1, words: {} });
    expect(normaliseShotRig({ format: "scope", squeeze: 3 })).toEqual({ format: "scope", squeeze: 1, words: {} });
    expect(normaliseShotRig({ format: "imax" })).toEqual({ format: "square", squeeze: 1, words: {} });
    // A shot recorded without a format was a square, whatever a new set's
    // rig frames in now (16:9 since 2026-09-25, rig.ts DEFAULT_SET_RIG).
    expect(normaliseShotRig({ words: {} })!.format).toBe("square");
    for (const junk of [null, 7, "rig", []]) expect(normaliseShotRig(junk)).toBeNull();
  });
});

describe("the columns are named in one place", () => {
  it("only shot-rig.ts names location_set_shots' rig and rig_check", () => {
    const root = join(__dirname, "../..");
    const hits: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const p = join(dir, name);
        if (statSync(p).isDirectory()) walk(p);
        else if (/\.(ts|tsx)$/.test(name) && !name.endsWith(".test.ts")) {
          const text = readFileSync(p, "utf8");
          if (/["'`]rig_check["'`]|select\(["'`][^"'`]*\brig_check\b/.test(text)) hits.push(p);
        }
      }
    };
    walk(root);
    expect(hits.map((p) => p.slice(root.length + 1))).toEqual(["lib/sets/shot-rig.ts"]);
  });
});
