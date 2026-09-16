import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import beach from "./fixtures-beach.json";
import raceTrack from "./fixtures-race-track.json";
import rainyMarket from "./fixtures-rainy-market.json";
import showroomClosed from "./fixtures-showroom-closed.json";
import showroomOpen from "./fixtures-showroom-open.json";
import { addCamera, addLight, addMark, addObject, holdEditedText, patchObject, type EditResult } from "./editor-model";
import { normaliseSetFilm } from "./film";
import { normaliseSetRig } from "./rig";
import { normaliseSetSpec, type SetSpec } from "./set-spec";
import { dropUnsaved, keepUnsaved, savedEditKey, savedFilmKey, savedRigKey, takeUnsaved, UNSAVED_MAX_AGE_MS } from "./unsaved";

// What a tab left behind by a deploy could not save (2026-09-16): kept for
// the reload, and put back only onto the copy it was made from. The page
// compares "what the server holds" as a key, so the keys must survive the
// round trip: saved by the action, loaded by the page.

const SET = "22222222-2222-4222-8222-222222222222";
const OTHER = "33333333-3333-4333-8333-333333333333";
const STILL = "44444444-4444-4444-8444-444444444444";
const CLIP = "55555555-5555-4555-8555-555555555555";

class TabStorage {
  readonly map = new Map<string, string>();
  full = false;
  getItem(key: string): string | null {
    return this.map.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    if (this.full) throw new Error("QuotaExceededError");
    this.map.set(key, value);
  }
  removeItem(key: string): void {
    this.map.delete(key);
  }
}

let tab: TabStorage;
beforeEach(() => {
  tab = new TabStorage();
  vi.stubGlobal("window", { sessionStorage: tab });
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe("a change kept for the reload", () => {
  it("comes back once, onto the copy it was made from", () => {
    keepUnsaved(SET, "rig", { format: "scope" }, "held-1", 1_000);
    expect(takeUnsaved(SET, "rig", "held-1", 2_000)).toEqual({ format: "scope" });
    expect(takeUnsaved(SET, "rig", "held-1", 2_000)).toBeNull();
  });

  it("keeps only the latest change of a kind", () => {
    keepUnsaved(SET, "film", { n: 1 }, "held-1", 1_000);
    keepUnsaved(SET, "film", { n: 2 }, "held-1", 1_500);
    expect(takeUnsaved(SET, "film", "held-1", 2_000)).toEqual({ n: 2 });
  });

  it("is dropped, and gone, when something else was saved in between", () => {
    keepUnsaved(SET, "edit", { n: 1 }, "held-1", 1_000);
    expect(takeUnsaved(SET, "edit", "held-2", 2_000)).toBeNull();
    expect(tab.map.size).toBe(0);
    expect(takeUnsaved(SET, "edit", "held-1", 2_000)).toBeNull();
  });

  it("is dropped after ten minutes, and when its clock is ahead", () => {
    keepUnsaved(SET, "rig", { n: 1 }, "held-1", 1_000);
    expect(takeUnsaved(SET, "rig", "held-1", 1_000 + UNSAVED_MAX_AGE_MS)).toEqual({ n: 1 });
    keepUnsaved(SET, "rig", { n: 1 }, "held-1", 1_000);
    expect(takeUnsaved(SET, "rig", "held-1", 1_001 + UNSAVED_MAX_AGE_MS)).toBeNull();
    keepUnsaved(SET, "rig", { n: 1 }, "held-1", 5_000);
    expect(takeUnsaved(SET, "rig", "held-1", 4_999)).toBeNull();
  });

  it("is forgotten by a save sent after it was kept that landed, or by leaving it behind", () => {
    keepUnsaved(SET, "film", { n: 1 }, "held-1", 2_000);
    // A save sent before the change was kept (its answer came late) holds less than it.
    dropUnsaved(SET, "film", 1_999);
    expect(tab.map.size).toBe(1);
    dropUnsaved(SET, "film", 2_000);
    expect(tab.map.size).toBe(0);
    keepUnsaved(SET, "edit", { n: 1 }, "held-1", 2_000);
    dropUnsaved(SET, "edit");
    expect(takeUnsaved(SET, "edit", "held-1", 2_100)).toBeNull();
    // Only its own set and kind; an unreadable one goes; nothing throws.
    keepUnsaved(SET, "rig", { n: 1 }, "held-1", 2_000);
    dropUnsaved(OTHER, "rig");
    dropUnsaved(SET, "film");
    expect(tab.map.size).toBe(1);
    tab.map.set(`helios-unsaved:film:${SET}`, "not json");
    dropUnsaved(SET, "film", 0);
    expect([...tab.map.keys()]).toEqual([`helios-unsaved:rig:${SET}`]);
    vi.stubGlobal("window", {
      get sessionStorage(): Storage {
        throw new Error("SecurityError");
      },
    });
    expect(() => dropUnsaved(SET, "rig", 5_000)).not.toThrow();
  });

  it("belongs to one set and one kind", () => {
    keepUnsaved(SET, "film", { n: 1 }, "held-1", 1_000);
    expect(takeUnsaved(OTHER, "film", "held-1", 2_000)).toBeNull();
    expect(takeUnsaved(SET, "rig", "held-1", 2_000)).toBeNull();
    expect(takeUnsaved(SET, "film", "held-1", 2_000)).toEqual({ n: 1 });
  });

  it("never throws, and hands back nothing it cannot read", () => {
    tab.full = true;
    expect(() => keepUnsaved(SET, "rig", { n: 1 }, "held-1")).not.toThrow();
    expect(takeUnsaved(SET, "rig", "held-1")).toBeNull();
    tab.full = false;
    for (const raw of ["not json", "null", '{"base":"held-1","value":1}', '{"at":"1","base":"held-1","value":1}']) {
      tab.map.set(`helios-unsaved:rig:${SET}`, raw);
      expect(takeUnsaved(SET, "rig", "held-1", 2_000), raw).toBeNull();
      expect(tab.map.size).toBe(0);
    }
    // Storage that refuses to be touched, and a page rendering on the server.
    vi.stubGlobal("window", {
      get sessionStorage(): Storage {
        throw new Error("SecurityError");
      },
    });
    expect(() => keepUnsaved(SET, "rig", { n: 1 }, "held-1")).not.toThrow();
    expect(takeUnsaved(SET, "rig", "held-1")).toBeNull();
    vi.stubGlobal("window", undefined);
    expect(() => keepUnsaved(SET, "rig", { n: 1 }, "held-1")).not.toThrow();
    expect(takeUnsaved(SET, "rig", "held-1")).toBeNull();
  });
});

describe("what the server holds, as a key", () => {
  it("a film the page sends and the film it loads back are the same key", () => {
    const sent = {
      engine: "veo",
      startId: STILL.toUpperCase(),
      beats: [
        {
          words: "  she walks   to the car ",
          end: { position: [1.23456, 2, 3], target: [0, 1, 0], fovDeg: 40.126 },
          move: "push-in",
          textures: ["handheld", "handheld", "whip-pan"],
        },
        { words: "", end: { position: [4, 1.6, -2], target: [0, 1, 0], fovDeg: 35 }, move: null, textures: [] },
      ],
      clips: [CLIP, null],
      ends: [null, null],
      context: "ab12",
    };
    // saveSetFilm stores normaliseSetFilm(sent); the page loads that back.
    expect(savedFilmKey(sent)).toBe(savedFilmKey(normaliseSetFilm(sent)));
    expect(savedFilmKey(sent)).not.toBe(savedFilmKey({ ...sent, engine: "omni" }));
  });

  it("a rig the page sends and the rig it loads back are the same key", () => {
    const sent = {
      genre: "noir",
      era: "1970s",
      format: "scope",
      stock: "film35",
      lens: "anamorphic",
      stop: 2.8,
      light: { scheme: "window", azimuthDeg: 400.04, elevationDeg: 12.34 },
      palette: "amber-hour",
      gradeStage: false,
    };
    expect(savedRigKey(sent)).toBe(savedRigKey(normaliseSetRig(sent)));
    expect(savedRigKey(sent)).not.toBe(savedRigKey({ ...sent, palette: "silver-print" }));
  });

  it("an editor copy, saved and held, loads back as the same key", () => {
    const fixtures = { beach, raceTrack, rainyMarket, showroomClosed, showroomOpen };
    for (const [name, fixture] of Object.entries(fixtures)) {
      const n = normaliseSetSpec(fixture);
      if (!n.ok) throw new Error(`fixture ${name}`);
      const original = n.spec;
      // Edits as the editor makes them: each one a whole spec, renormalised.
      const edits: ((s: SetSpec) => EditResult)[] = [
        (s) => patchObject(s, 0, { color: "#aa3322", position: [1.23456, s.objects[0].position[1], -2.5] }),
        (s) => addObject(s, "box", [2, -3]),
        (s) => addLight(s, "point"),
        (s) => addMark(s, [1.5, 0.5]),
        (s) => addCamera(s, { position: [3, 1.7, 6], target: [0, 1.2, 0], fovDeg: 42.5 }),
      ];
      let copy = original;
      for (const edit of edits) {
        const r = edit(copy);
        if (r.ok) copy = r.spec;
      }
      expect(copy, name).not.toEqual(original);
      // saveSetEdit stores the copy held against what the server had;
      // the page loads it through normaliseSetSpec (data.ts).
      const loaded = normaliseSetSpec(holdEditedText(copy, [original]));
      if (!loaded.ok) throw new Error(`loaded ${name}`);
      expect(savedEditKey(loaded.spec), name).toBe(savedEditKey(copy));
      // Astra's original, when the working copy is cleared, is the copy the page opens on.
      const reopened = normaliseSetSpec(original);
      if (!reopened.ok) throw new Error(`reopened ${name}`);
      expect(savedEditKey(reopened.spec), name).toBe(savedEditKey(original));
    }
  });
});
