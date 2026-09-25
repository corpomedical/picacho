import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  DEFAULT_SET_RIG,
  RIG_ERAS,
  RIG_FORMAT_ORDER,
  RIG_GENRE_SUGGESTS,
  RIG_GENRES,
  RIG_LENSES,
  RIG_LIGHTS,
  RIG_OVERLAY_KEYS,
  RIG_PALETTES,
  RIG_SQUEEZES,
  RIG_STOCKS,
  RIG_STOPS,
  normaliseSetRig,
} from "./rig";
import { LENSES_MM } from "./build-scene";
import { schemeDefaults } from "./light-schemes";
import {
  TIME_PRESETS,
  filterCommands,
  genreLookPatch,
  matchScore,
  rigCommandIds,
  rigCommandLabel,
  rigPatchFor,
  shootCommands,
  stepIndex,
  type Command,
  type CommandGroup,
  type ShootCommandContext,
} from "./commands";

// The command palette (the studio, cut 4): what matches, in what order,
// and every command the set page offers.

const groups: Record<CommandGroup, string> = {
  modes: "Modes",
  frame: "Frame",
  lens: "Lens",
  focus: "Focus",
  light: "Light",
  time: "Time of day",
  look: "Look",
  viewfinder: "Viewfinder",
  stage: "Stage",
  shoot: "Shoot",
};
const cmd = (id: string, label: string, group: CommandGroup = "stage"): Command => ({ id, label, group, run: () => {} });

describe("matching", () => {
  it("ranks a prefix over a word's start over a mention over letters in order over the group, and drops the rest", () => {
    expect(matchScore("fra", cmd("a", "Frame the figure"), "Stage")).toBe(0);
    expect(matchScore("fig", cmd("a", "Frame the figure"), "Stage")).toBe(1);
    expect(matchScore("e the", cmd("a", "Frame the figure"), "Stage")).toBe(2);
    expect(matchScore("fth", cmd("a", "Frame the figure"), "Stage")).toBe(3);
    expect(matchScore("stage", cmd("a", "Frame the figure"), "Stage")).toBe(4);
    expect(matchScore("zzz", cmd("a", "Frame the figure"), "Stage")).toBeNull();
    expect(matchScore("", cmd("a", "Frame the figure"), "Stage")).toBe(0);
  });

  it("ignores case and accents", () => {
    expect(matchScore("CÁMARA", cmd("a", "camara 2"), "x")).toBe(0);
  });

  it("lists everything for no query, and the best first among matches, keeping their order among equals", () => {
    const all = [cmd("1", "Lens · 35 mm", "lens"), cmd("2", "Frame the figure"), cmd("3", "Frame · Scope", "frame"), cmd("4", "Light · Window", "light")];
    expect(filterCommands("", all, groups).map((c) => c.id)).toEqual(["1", "2", "3", "4"]);
    expect(filterCommands("fr", all, groups).map((c) => c.id)).toEqual(["2", "3"]);
    expect(filterCommands("scope", all, groups).map((c) => c.id)).toEqual(["3"]);
    expect(filterCommands("stage", all, groups).map((c) => c.id)).toEqual(["2"]);
  });

  it("steps round the list", () => {
    expect(stepIndex(0, 1, 3)).toBe(1);
    expect(stepIndex(2, 1, 3)).toBe(0);
    expect(stepIndex(0, -1, 3)).toBe(2);
    expect(stepIndex(0, 1, 0)).toBe(-1);
  });
});

function context(over: Partial<ShootCommandContext> = {}): ShootCommandContext & { calls: Record<string, unknown[][]> } {
  const calls: Record<string, unknown[][]> = {};
  const spy =
    (name: string) =>
    (...args: unknown[]) => {
      (calls[name] ??= []).push(args);
    };
  const words: ShootCommandContext["words"] = {
    modes: { build: "Build", shoot: "Shoot", film: "Film", cut: "The cut" },
    rigShow: "Show the rig",
    rigHide: "Hide the rig",
    chatShow: "Show the conversation",
    chatHide: "Hide the conversation",
    formats: { square: "1 : 1", scope: "Scope", flat: "Flat", wide: "16 : 9", classic: "4 : 3", vertical: "9 : 16" },
    frame: "Frame",
    squeeze: "Squeeze",
    lensMm: (mm) => `${mm} mm`,
    focus: "Focus",
    stop: "Stop",
    off: "Off",
    light: "Light",
    lights: Object.fromEntries(RIG_LIGHTS.map((l) => [l.id, l.id])) as ShootCommandContext["words"]["lights"],
    asBuilt: "As built",
    time: "Time of day",
    timePresets: { dawn: "Morning", noon: "Noon", golden: "Golden hour", night: "Night" },
    stock: "Film stock",
    stocks: { digital: "Digital", film35: "35 mm film", film16: "16 mm film", homevideo: "Home video" },
    lensCharacter: "Lens",
    lenses: { clean: "Clean prime", anamorphic: "Anamorphic", vintage: "Vintage", halation: "Halation" },
    palette: "Palette",
    palettes: Object.fromEntries(RIG_PALETTES.map((p) => [p.id, p.id])) as ShootCommandContext["words"]["palettes"],
    era: "Era",
    eras: { "2000s": "2000s", "1990s": "1990s", "1980s": "1980s", "1970s": "1970s", "1960s": "1960s" },
    genre: "Genre",
    genres: { drama: "Drama", action: "Action", thriller: "Thriller", noir: "Noir", horror: "Horror", comedy: "Comedy", romance: "Romance" },
    overlays: Object.fromEntries(RIG_OVERLAY_KEYS.map((k) => [k, k])) as ShootCommandContext["words"]["overlays"],
    frameFigure: "Frame the figure",
    undoStage: "Undo the last move",
    downloadFrame: "Download the frame",
    camera: (l) => `Camera · ${l}`,
    mark: (l) => `Mark · ${l}`,
    shootNow: "Shoot · 1 credit",
  };
  return {
    calls,
    words,
    rig: DEFAULT_SET_RIG,
    setRig: spy("setRig"),
    mode: "shoot" as const,
    goToMode: spy("goToMode"),
    rigOpen: false,
    setRigOpen: spy("setRigOpen"),
    chatOpen: true,
    setChatOpen: spy("setChatOpen"),
    cameraBearingDeg: 90,
    cameras: [{ id: "c1", label: "Wide" }],
    pickCamera: spy("pickCamera"),
    marks: [{ id: "m1", label: "Grid" }],
    pickMark: spy("pickMark"),
    pickLens: spy("pickLens"),
    frameFigure: spy("frameFigure"),
    undoStage: spy("undoStage"),
    downloadFrame: spy("downloadFrame"),
    canShoot: true,
    shoot: spy("shoot"),
    ...over,
  };
}

describe("the set page's commands", () => {
  it("offer every format, lens, stop, plot, hour, look and aid, each running the right change", () => {
    const ctx = context();
    const all = shootCommands(ctx);
    const ids = all.map((c) => c.id);
    for (const f of RIG_FORMAT_ORDER) expect(ids).toContain(`format:${f}`);
    for (const mm of LENSES_MM) expect(ids).toContain(`lens:${mm}`);
    for (const st of RIG_STOPS) expect(ids).toContain(`stop:${st}`);
    for (const l of RIG_LIGHTS) expect(ids).toContain(`light:${l.id}`);
    for (const t of TIME_PRESETS) expect(ids).toContain(`time:${t.id}`);
    for (const k of RIG_OVERLAY_KEYS) expect(ids).toContain(`aid:${k}`);
    expect(new Set(ids).size).toBe(ids.length);
    const run = (id: string) => all.find((c) => c.id === id)?.run();
    run("format:scope");
    expect(ctx.calls.setRig.at(-1)).toEqual([{ format: "scope" }]);
    run("lens:85");
    expect(ctx.calls.pickLens.at(-1)).toEqual([85]);
    run("stop:off");
    expect(ctx.calls.setRig.at(-1)).toEqual([{ stop: null }]);
    run("light:window");
    const light = (ctx.calls.setRig.at(-1)?.[0] as { light: { scheme: string; azimuthDeg: number } }).light;
    expect(light.scheme).toBe("window");
    expect(light.azimuthDeg).toBe(180);
    run("time:golden");
    expect(ctx.calls.setRig.at(-1)).toEqual([{ time: 17.5 }]);
    run("aid:thirds");
    expect(ctx.calls.setRig.at(-1)).toEqual([{ overlays: { ...DEFAULT_SET_RIG.overlays, thirds: true } }]);
    run("camera:c1");
    expect(ctx.calls.pickCamera.at(-1)).toEqual(["c1"]);
    run("mark:m1");
    expect(ctx.calls.pickMark.at(-1)).toEqual(["m1"]);
    run("stage:frame-figure");
    expect(ctx.calls.frameFigure).toHaveLength(1);
    run("shoot");
    expect(ctx.calls.shoot).toHaveLength(1);
    run("mode:build");
    expect(ctx.calls.goToMode.at(-1)).toEqual(["build"]);
  });

  it("offer every mode but the one you are in, the cut included, and hide Shoot when nothing can be shot", () => {
    const closed = shootCommands(context()).map((c) => c.id);
    expect(closed).toContain("mode:film");
    expect(closed).toContain("mode:cut");
    expect(closed).toContain("mode:build");
    expect(closed).not.toContain("mode:shoot");
    // From the cut, every other mode — the palette had no way out of it.
    const inCut = shootCommands(context({ mode: "cut" }));
    expect(inCut.map((c) => c.id)).toContain("mode:shoot");
    const ctxCut = context({ mode: "cut" });
    shootCommands(ctxCut).find((c) => c.id === "mode:shoot")?.run();
    expect(ctxCut.calls.goToMode.at(-1)).toEqual(["shoot"]);
    // R is the Turn tool now: the rig command no longer claims it.
    expect(shootCommands(context()).find((c) => c.id === "rig:toggle")?.keys).toBeUndefined();
    const ctx = context({ canShoot: false, rigOpen: true });
    const cmds = shootCommands(ctx);
    expect(cmds.map((c) => c.id)).not.toContain("shoot");
    expect(cmds.find((c) => c.id === "rig:toggle")?.label).toBe("Hide the rig");
    cmds.find((c) => c.id === "rig:toggle")?.run();
    expect(ctx.calls.setRigOpen.at(-1)).toEqual([false]);
  });

  it("name the keys that do the same", () => {
    const all = shootCommands(context());
    expect(all.find((c) => c.id === "stage:frame-figure")?.keys).toBe("F");
    // The rig's command names no key: R picks the Turn tool (studio.ts).
    expect(all.find((c) => c.id === "rig:toggle")?.keys).toBeUndefined();
    vi.restoreAllMocks();
  });
});

// The rig's commands are one table for ⌘K and the chat (Helios Cut 2, step 3,
// 2026-09-25): the reader answers with these ids and the page applies each
// through rigPatchFor, so what the chat sets is what ⌘K sets, and its chip is
// ⌘K's label.
describe("the rig's commands, shared by ⌘K and the chat", () => {
  const ranBy = (id: string, cameraBearingDeg: number) => {
    const ctx = context({ cameraBearingDeg });
    const c = shootCommands(ctx).find((x) => x.id === id);
    expect(c, id).toBeDefined();
    c?.run();
    expect(ctx.calls.setRig, id).toHaveLength(1);
    return ctx.calls.setRig[0][0];
  };

  it("give the same change from ⌘K's run and from rigPatchFor, for every id, from any bearing", () => {
    const ids = rigCommandIds();
    expect(ids.length).toBeGreaterThan(0);
    for (const bearing of [0, 90, 213.4]) {
      for (const id of ids) expect(rigPatchFor(id, { cameraBearingDeg: bearing }), id).toEqual(ranBy(id, bearing));
    }
  });

  it("are listed by ⌘K under the same label rigCommandLabel gives the chat's chips", () => {
    const ctx = context();
    const byId = new Map(shootCommands(ctx).map((c) => [c.id, c]));
    for (const id of rigCommandIds()) expect(rigCommandLabel(id, ctx.words), id).toBe(byId.get(id)?.label);
    expect(rigCommandLabel("time:golden", ctx.words)).toBe("Time of day · Golden hour · 17:30");
  });

  it("list every frame, squeeze, stop, plot, hour, look, era and genre once, and no lens or viewfinder aid", () => {
    const ids = rigCommandIds();
    expect(new Set(ids).size).toBe(ids.length);
    const want = [
      ...RIG_FORMAT_ORDER.map((f) => `format:${f}`),
      ...RIG_SQUEEZES.map((q) => `squeeze:${q}`),
      ...RIG_STOPS.map((st) => `stop:${st}`),
      "stop:off",
      ...RIG_LIGHTS.map((l) => `light:${l.id}`),
      "light:as-built",
      ...TIME_PRESETS.map((t) => `time:${t.id}`),
      "time:as-built",
      ...RIG_STOCKS.map((st) => `stock:${st.id}`),
      "stock:none",
      ...RIG_LENSES.map((l) => `character:${l.id}`),
      "character:none",
      ...RIG_PALETTES.map((p) => `palette:${p.id}`),
      "palette:none",
      ...RIG_ERAS.map((e) => `era:${e.id}`),
      "era:none",
      ...RIG_GENRES.map((g) => `genre:${g}`),
    ];
    expect([...ids].sort()).toEqual([...want].sort());
    expect(ids.some((id) => id.startsWith("lens:") || id.startsWith("aid:"))).toBe(false);
    // ⌘K still lists the lens chips and the aids, beside the shared ones.
    const all = shootCommands(context()).map((c) => c.id);
    for (const id of ids) expect(all).toContain(id);
    expect(all).toContain("lens:50");
    expect(all).toContain("aid:thirds");
  });

  it("answer null for an id that is not one, and a fresh change every time", () => {
    for (const id of ["lens:50", "aid:thirds", "stop:2.0", "time:17.5", "palette:velvia", "genre:none", "format", "", "shoot"]) {
      expect(rigPatchFor(id, { cameraBearingDeg: 0 }), id).toBeNull();
      expect(rigCommandLabel(id, context().words), id).toBeNull();
    }
    const a = rigPatchFor("light:window", { cameraBearingDeg: 0 }) as { light: { azimuthDeg: number } };
    a.light.azimuthDeg = 999;
    expect((rigPatchFor("light:window", { cameraBearingDeg: 0 }) as { light: { azimuthDeg: number } }).light.azimuthDeg).not.toBe(999);
  });

  it("aim a light plot from the bearing they are handed: the chat hands the camera's final one", () => {
    for (const l of RIG_LIGHTS) {
      expect(rigPatchFor(`light:${l.id}`, { cameraBearingDeg: 30 })).toEqual({ light: schemeDefaults(l.id, 30) });
    }
    expect(rigPatchFor("light:contre-jour", { cameraBearingDeg: 30 })).not.toEqual(rigPatchFor("light:contre-jour", { cameraBearingDeg: 210 }));
  });

  it("take a look off in words: none for the stock, the lens character, the palette and the era", () => {
    expect(rigPatchFor("stock:none", { cameraBearingDeg: 0 })).toEqual({ stock: null });
    expect(rigPatchFor("character:none", { cameraBearingDeg: 0 })).toEqual({ lens: null });
    expect(rigPatchFor("palette:none", { cameraBearingDeg: 0 })).toEqual({ palette: null });
    expect(rigPatchFor("era:none", { cameraBearingDeg: 0 })).toEqual({ era: null });
    expect(rigPatchFor("era:1970s", { cameraBearingDeg: 0 })).toEqual({ era: "1970s" });
    expect(rigPatchFor("character:anamorphic", { cameraBearingDeg: 0 })).toEqual({ lens: "anamorphic" });
    const w = context().words;
    expect(rigCommandLabel("stock:none", w)).toBe("Film stock · Off");
    expect(rigCommandLabel("character:none", w)).toBe("Lens · Off");
    expect(rigCommandLabel("palette:none", w)).toBe("Palette · Off");
    expect(rigCommandLabel("era:none", w)).toBe("Era · Off");
    expect(rigCommandLabel("era:1970s", w)).toBe("Era · 1970s");
    expect(rigCommandLabel("genre:noir", w)).toBe("Genre · Noir");
  });

  it("set a genre with its light and grade, exactly the rig panel's Use these", () => {
    for (const g of RIG_GENRES) {
      const suggests = RIG_GENRE_SUGGESTS[g];
      expect(genreLookPatch(g, 75)).toEqual({ light: schemeDefaults(suggests.light, 75), palette: suggests.palette });
      expect(rigPatchFor(`genre:${g}`, { cameraBearingDeg: 75 })).toEqual({ genre: g, ...genreLookPatch(g, 75) });
    }
    // Romance brings a sun plot: the turn's hour rule reads that off the rig it makes (turn-plan.ts).
    expect(rigPatchFor("genre:romance", { cameraBearingDeg: 0 })).toMatchObject({ genre: "romance", palette: "peach-dusk", light: { scheme: "golden-hour" } });
    // The panel's button is this same mapping, not a copy of it.
    const panel = readFileSync(join(__dirname, "../../components/sets/rig-panel.tsx"), "utf8");
    expect(panel).toContain("onClick={() => set(genreLookPatch(genre, cameraBearingDeg))}");
    expect(panel).not.toContain("schemeDefaults(suggestion.light");
  });

  it("make changes the rig keeps as they are: every patch survives normaliseSetRig", () => {
    for (const id of rigCommandIds()) {
      const patch = rigPatchFor(id, { cameraBearingDeg: 123.4 }) ?? {};
      const next = { ...DEFAULT_SET_RIG, ...patch };
      expect(normaliseSetRig(next), id).toEqual(next);
    }
  });
});
