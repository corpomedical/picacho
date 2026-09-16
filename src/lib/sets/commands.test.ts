import { describe, expect, it, vi } from "vitest";
import { DEFAULT_SET_RIG, RIG_FORMAT_ORDER, RIG_LIGHTS, RIG_OVERLAY_KEYS, RIG_PALETTES, RIG_STOPS } from "./rig";
import { LENSES_MM } from "./build-scene";
import { TIME_PRESETS, filterCommands, matchScore, shootCommands, stepIndex, type Command, type CommandGroup, type ShootCommandContext } from "./commands";

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
    build: "Build",
    shoot: "Shoot",
    film: "Film",
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
    filmOpen: false,
    setFilmOpen: spy("setFilmOpen"),
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
    openBuild: spy("openBuild"),
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
    expect(ctx.calls.openBuild).toHaveLength(1);
  });

  it("say Film when the film is closed and Shoot when it is open, and hide Shoot when nothing can be shot", () => {
    const closed = shootCommands(context()).map((c) => c.id);
    expect(closed).toContain("mode:film");
    expect(closed).not.toContain("mode:shoot");
    const open = shootCommands(context({ filmOpen: true }));
    expect(open.map((c) => c.id)).toContain("mode:shoot");
    open.find((c) => c.id === "mode:shoot")?.run();
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
    expect(all.find((c) => c.id === "rig:toggle")?.keys).toBe("R");
    vi.restoreAllMocks();
  });
});
