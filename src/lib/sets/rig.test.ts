import { existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  DEFAULT_SET_RIG,
  RIG_ERAS,
  RIG_FIXED_SENTENCES,
  RIG_FORMAT_ORDER,
  RIG_FORMATS,
  RIG_GENRE_SUGGESTS,
  RIG_GENRES,
  RIG_LENSES,
  RIG_LIGHTS,
  RIG_NUMBERED_SENTENCE,
  RIG_PALETTES,
  RIG_STOCKS,
  depthOfField,
  focalMm,
  formatFrame,
  isLabPalette,
  labLooksOf,
  lightDirectionWords,
  lookStill,
  normaliseSetRig,
  rigCheckItems,
  rigSentences,
  rigWordsByItem,
  type SetRig,
} from "./rig";
import { FILM_MOVES } from "./moves";

// The rig (Helios Cinema, canvas page I): one door in, real optics, and
// words that say exactly what each look is — every one unproven until its
// proof render.

const ctx = { distanceM: 4, fovDeg: 2 * Math.atan(12 / 35) * (180 / Math.PI), cameraBearingDeg: 0 };
const full: SetRig = {
  ...DEFAULT_SET_RIG,
  format: "scope",
  stock: "film35",
  lens: "anamorphic",
  stop: 2,
  light: { scheme: "contre-jour", azimuthDeg: 192, elevationDeg: 5 },
  palette: "amber-hour",
  era: "1980s",
};

describe("formats: the render asked for, and the band cut from it", () => {
  it("cuts each format from GPT Image's own sizes", () => {
    const px = (f: keyof typeof RIG_FORMATS) => {
      const fr = formatFrame(f);
      return [fr.renderW, fr.renderH, fr.bandW, fr.bandH, fr.size, fr.cut];
    };
    expect(px("square")).toEqual([1024, 1024, 1024, 1024, "1024x1024", false]);
    expect(px("scope")).toEqual([1536, 1024, 1536, 643, "1536x1024", true]);
    expect(px("flat")).toEqual([1536, 1024, 1536, 830, "1536x1024", true]);
    expect(px("wide")).toEqual([1536, 1024, 1536, 864, "1536x1024", true]);
    expect(px("classic")).toEqual([1536, 1024, 1365, 1024, "1536x1024", true]);
    expect(px("vertical")).toEqual([1024, 1536, 864, 1536, "1024x1536", true]);
  });

  it("offers every format, square first", () => {
    expect(RIG_FORMAT_ORDER[0]).toBe("square");
    expect([...RIG_FORMAT_ORDER].sort()).toEqual(Object.keys(RIG_FORMATS).sort());
  });
});

describe("normaliseSetRig", () => {
  it("turns junk into the default rig: square, nothing asked", () => {
    for (const junk of [null, undefined, 7, "rig", [], { format: "cinemascope" }]) {
      expect(normaliseSetRig(junk)).toEqual(DEFAULT_SET_RIG);
    }
  });

  it("keeps a real rig, and drops what it doesn't know", () => {
    expect(normaliseSetRig(full)).toEqual(full);
    const odd = normaliseSetRig({ ...full, stock: "70mm", lens: "fisheye", stop: 3.5, palette: "Blade", era: "1920s", genre: "musical" });
    expect(odd.stock).toBeNull();
    expect(odd.lens).toBeNull();
    expect(odd.stop).toBeNull();
    expect(odd.palette).toBeNull();
    expect(odd.era).toBeNull();
    expect(odd.genre).toBeNull();
    expect(odd.format).toBe("scope");
  });

  it("wraps the light's bearing and holds its height above the horizon", () => {
    const r = normaliseSetRig({ light: { scheme: "moonlight", azimuthDeg: -30, elevationDeg: 140 } });
    expect(r.light).toEqual({ scheme: "moonlight", azimuthDeg: 330, elevationDeg: 89 });
    expect(normaliseSetRig({ light: { scheme: "disco", azimuthDeg: 0, elevationDeg: 5 } }).light).toBeNull();
  });

  it("previews the grade unless told not to", () => {
    expect(normaliseSetRig({}).gradeStage).toBe(true);
    expect(normaliseSetRig({ gradeStage: false }).gradeStage).toBe(false);
  });
});

describe("focus: real optics from the real distance", () => {
  it("a 35 at f/2 focused at 4 m holds 3.3 to 5.0 m (full frame, 0.03 mm)", () => {
    const { nearM, farM } = depthOfField(35, 2, 4);
    expect(nearM).toBeCloseTo(3.35, 2);
    expect(farM).toBeCloseTo(4.96, 2);
  });

  it("past the hyperfocal distance the far limit is the horizon", () => {
    expect(depthOfField(24, 11, 10).farM).toBe(Infinity);
  });

  it("reads the stage's field of view back as the lens it is", () => {
    expect(focalMm(ctx.fovDeg)).toBeCloseTo(35, 6);
    // A tall frame is 36 mm tall.
    expect(focalMm(ctx.fovDeg, 36)).toBeCloseTo(52.5, 6);
  });
});

describe("the words that ride", () => {
  it("say the cut, then the light, focus, era and palette, in that order — never the stock or the lens, which the lab makes", () => {
    const lines = rigSentences(full, ctx);
    expect(lines[0]).toMatch(/^This frame will be cut to a wide 2\.39 : 1 band/);
    const at = (needle: string) => lines.findIndex((l) => l.includes(needle));
    expect(at("contre-jour")).toBeLessThan(at("Focus:"));
    expect(at("Focus:")).toBeLessThan(at("1980s"));
    expect(at("1980s")).toBeLessThan(at("Colour grade"));
    expect(at("anamorphic")).toBe(-1);
    expect(at("35 mm motion-picture film")).toBe(-1);
  });

  it("puts the focus numbers in words", () => {
    expect(rigWordsByItem(full, ctx).focus).toBe(
      "Focus: the person, 4.0 m from the camera, is sharp; the depth of field runs from 3.3 to 5.0 m, and everything nearer or farther falls progressively soft.",
    );
  });

  it("says a missed look harder when it is pushed, and only that look", () => {
    const pushed = rigWordsByItem(full, { ...ctx, push: ["era"] });
    expect(pushed.era).toBe(RIG_ERAS.find((l) => l.id === "1980s")!.pushed);
    expect(pushed.palette).toBe(RIG_PALETTES.find((l) => l.id === "amber-hour")!.block);
  });

  it("asks nothing of a square rig with nothing chosen", () => {
    expect(rigSentences(DEFAULT_SET_RIG, ctx)).toEqual([]);
    expect(rigCheckItems(DEFAULT_SET_RIG)).toEqual([]);
  });

  it("checks every look it asked for in words — never the frame, which the stage holds, nor what the lab makes", () => {
    expect(rigCheckItems(full)).toEqual(["light", "focus", "palette", "era"]);
    expect(Object.keys(rigWordsByItem(full, ctx)).sort()).toEqual(rigCheckItems(full).sort());
  });
});

describe("held by the lab", () => {
  it("never sends the stock, the lens or Silver Print as words, and never checks them", () => {
    const silver: SetRig = { ...full, palette: "silver-print" };
    const words = rigWordsByItem(silver, ctx);
    expect(words.stock).toBeUndefined();
    expect(words.lens).toBeUndefined();
    expect(words.palette).toBeUndefined();
    expect(rigCheckItems(silver)).toEqual(["light", "focus", "era"]);
    expect(rigSentences(silver, ctx).join(" ")).not.toContain("black and white");
  });

  it("names what the lab develops — nothing for the model's own clean render", () => {
    expect(labLooksOf(full)).toEqual({ stock: "film35", lens: "anamorphic", silver: false });
    expect(labLooksOf({ stock: "digital", lens: "clean", palette: "amber-hour" })).toBeNull();
    expect(labLooksOf({ stock: null, lens: null, palette: "silver-print" })).toEqual({ stock: null, lens: null, silver: true });
    expect(isLabPalette("silver-print")).toBe(true);
    expect(isLabPalette("amber-hour")).toBe(false);
  });

  it("keeps an era to the picture's look, never its objects", () => {
    for (const era of RIG_ERAS) {
      expect(era.block).toContain("not its objects");
      expect(era.pushed).toContain("not its objects");
    }
  });

  it("names where the light stands as the camera sees it", () => {
    const at = (az: number) => lightDirectionWords({ scheme: "contre-jour", azimuthDeg: az, elevationDeg: 5 }, 0);
    expect(at(180)).toContain("behind the person");
    expect(at(0)).toContain("from behind the camera");
    // The camera stands at bearing 0 looking along −Z: screen right is +X, bearing 90.
    expect(at(90)).toContain("from frame right");
    expect(at(270)).toContain("from frame left");
    expect(at(130)).toContain("from behind, frame right");
    expect(lightDirectionWords({ scheme: "hard-noon", azimuthDeg: 180, elevationDeg: 70 }, 0)).toContain("almost overhead");
  });
});

describe("the brand-rule strip can find every rig sentence", () => {
  it("lists every block and every pushed strength", () => {
    for (const list of [RIG_STOCKS, RIG_LENSES, RIG_ERAS, RIG_PALETTES, RIG_LIGHTS]) {
      for (const l of list) {
        expect(RIG_FIXED_SENTENCES).toContain(l.block);
        expect(RIG_FIXED_SENTENCES).toContain(l.pushed);
      }
    }
  });

  it("matches the numbered sentences whole, decimals and all", () => {
    const words = rigWordsByItem(full, ctx);
    const text = `${words.focus} ${words.light} After.`;
    const left = text.replace(RIG_NUMBERED_SENTENCE, "").trim();
    expect(left).not.toContain("Focus:");
    expect(left).not.toContain("Light direction:");
    expect(left).toContain("After.");
  });
});

describe("the proof rule", () => {
  const KINDS = [
    ["stock", RIG_STOCKS],
    ["lens", RIG_LENSES],
    ["era", RIG_ERAS],
    ["palette", RIG_PALETTES],
    ["light", RIG_LIGHTS],
  ] as const;

  it("proves every look: 33 passed on 2026-09-15's contact sheet, and Silhouette reworded and passed the same evening", () => {
    const unproven = KINDS.flatMap(([kind, list]) => list.filter((l) => !l.proven).map((l) => `${kind}:${l.id}`));
    expect(unproven).toEqual([]);
    expect(KINDS.reduce((n, [, list]) => n + list.filter((l) => l.proven).length, 0)).toBe(34);
    // The new words: the whole figure in shadow, never "the face just readable".
    const silhouette = RIG_LIGHTS.find((l) => l.id === "silhouette")!;
    expect(silhouette.block).toContain("face included");
    expect(silhouette.block).not.toContain("just readable");
  });

  it("gives every proven look with a picture its proof still, on disk — never an unproven one or an era", () => {
    for (const [kind, list] of KINDS) {
      for (const l of list) {
        const still = lookStill(kind, l.id);
        if (!l.proven || kind === "era") {
          expect(still, `${kind}:${l.id}`).toBeNull();
          continue;
        }
        expect(still).toBe(`/helios/looks/${kind}-${l.id}.jpg`);
        expect(existsSync(join(process.cwd(), "public", still!)), still!).toBe(true);
      }
    }
  });

  it("names no film and no person in any block", () => {
    const words = RIG_FIXED_SENTENCES.join(" ");
    for (const name of ["Technicolor", "Kodak", "ARRI", "Panavision", "Cooke", "Kubrick", "Nolan", "Blade Runner"]) {
      expect(words).not.toContain(name);
    }
  });

  it("suggests only looks and moves that exist", () => {
    for (const g of RIG_GENRES) {
      const sug = RIG_GENRE_SUGGESTS[g];
      expect(RIG_LIGHTS.map((l) => l.id)).toContain(sug.light);
      expect(RIG_PALETTES.map((p) => p.id)).toContain(sug.palette);
      for (const m of sug.moves) expect(FILM_MOVES as readonly string[]).toContain(m);
    }
  });
});
