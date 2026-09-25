// The command palette (the studio, cut 4, 2026-09-17): every choice the
// set page offers as a list you can type at — ⌘K, the key every pro tool
// shares. Pure: the page builds the commands from its own handlers and
// strings, the palette only filters, steps and runs.
//
// THE RIG'S COMMANDS ARE SHARED (Helios Cut 2, step 3, 2026-09-25 —
// operator: "Run, keep going."). The set's chat reads "golden hour, 35 mm
// film, in black and white" into the very ids ⌘K lists (time:golden,
// stock:film35, palette:silver-print), and both change the rig through one
// table below: rigCommandIds() is the list the reader may answer with,
// rigPatchFor() what each id does to the rig. So a look the chat sets is
// exactly the look ⌘K sets, and its chip reads exactly ⌘K's label
// (rigCommandLabel). The table has no lens (the chat's lens_mm carries it,
// through the page's pickLens) and no viewfinder aid (never in a picture).

import { LENSES_MM } from "./build-scene";
import { schemeDefaults } from "./light-schemes";
import {
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
  type RigEra,
  type RigFormat,
  type RigGenre,
  type RigLens,
  type RigLightScheme,
  type RigOverlayKey,
  type RigPalette,
  type RigStock,
  type SetRig,
} from "./rig";
import { timeLabel } from "./time-of-day";
import { STUDIO_MODES, type StudioMode } from "./studio";

export type CommandGroup = "modes" | "frame" | "lens" | "focus" | "light" | "time" | "look" | "viewfinder" | "stage" | "shoot";

export type Command = {
  id: string;
  label: string;
  group: CommandGroup;
  /** A key that does the same, shown at the right. */
  keys?: string;
  run: () => void;
};

const fold = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");

/** The score of a command for a query: lower is better; null is no match. */
export function matchScore(query: string, command: Pick<Command, "label" | "group">, groupName: string): number | null {
  const q = fold(query).trim();
  if (!q) return 0;
  const label = fold(command.label);
  if (label.startsWith(q)) return 0;
  if (label.split(/[\s·/]+/).some((w) => w.startsWith(q))) return 1;
  if (label.includes(q)) return 2;
  // In order, letters apart: "fth" finds "Frame the figure".
  let i = 0;
  for (const c of label) if (c === q[i]) i += 1;
  if (i === q.length) return 3;
  if (fold(groupName).includes(q)) return 4;
  return null;
}

/** The commands that match, best first, in their own order among equals. */
export function filterCommands(query: string, commands: readonly Command[], groupNames: Record<CommandGroup, string>): Command[] {
  const scored = commands.map((c, i) => ({ c, i, s: matchScore(query, c, groupNames[c.group]) })).filter((x): x is { c: Command; i: number; s: number } => x.s !== null);
  scored.sort((a, b) => a.s - b.s || a.i - b.i);
  return scored.map((x) => x.c);
}

/** The next index, wrapping round; -1 with nothing to step through. */
export function stepIndex(current: number, delta: number, count: number): number {
  if (count <= 0) return -1;
  return (((current + delta) % count) + count) % count;
}

/** The hours the palette offers by name. */
export const TIME_PRESETS: readonly { id: string; hour: number }[] = [
  { id: "dawn", hour: 7 },
  { id: "noon", hour: 12 },
  { id: "golden", hour: 17.5 },
  { id: "night", hour: 21 },
];

export type ShootCommandWords = {
  /** Every mode's own word, for the one command that takes you there. */
  modes: Record<StudioMode, string>;
  rigShow: string;
  rigHide: string;
  chatShow: string;
  chatHide: string;
  formats: Record<RigFormat, string>;
  frame: string;
  squeeze: string;
  lensMm: (mm: number) => string;
  focus: string;
  stop: string;
  off: string;
  light: string;
  lights: Record<RigLightScheme, string>;
  asBuilt: string;
  time: string;
  timePresets: Record<string, string>;
  stock: string;
  stocks: Record<RigStock, string>;
  lensCharacter: string;
  lenses: Record<RigLens, string>;
  palette: string;
  palettes: Record<RigPalette, string>;
  /** The rig panel's own words (s.rig.era, eras, genre, genres): the chat sets an era or a genre as ⌘K does (Cut 2, step 3). */
  era: string;
  eras: Record<RigEra, string>;
  genre: string;
  genres: Record<RigGenre, string>;
  overlays: Record<RigOverlayKey, string>;
  frameFigure: string;
  undoStage: string;
  downloadFrame: string;
  camera: (label: string) => string;
  mark: (label: string) => string;
  shootNow: string;
};

export type ShootCommandContext = {
  words: ShootCommandWords;
  rig: SetRig;
  setRig(patch: Partial<SetRig>): void;
  /** Where the page is now, and the page's own way of going somewhere else (the bar's). */
  mode: StudioMode;
  goToMode(mode: StudioMode): void;
  rigOpen: boolean;
  setRigOpen(open: boolean): void;
  chatOpen: boolean;
  setChatOpen(open: boolean): void;
  cameraBearingDeg: number;
  cameras: readonly { id: string; label: string }[];
  pickCamera(id: string): void;
  marks: readonly { id: string; label: string }[];
  pickMark(id: string): void;
  pickLens(mm: number): void;
  frameFigure(): void;
  undoStage(): void;
  downloadFrame(): void;
  canShoot: boolean;
  shoot(): void;
  /**
   * List Cut 2's new rig commands (the looks taken off, eras, genres): the
   * chat's reader v2 page only, until check A opens it to everyone — the
   * spec's rule for steps 3–13 (review of Cut 2, R3). The chat answers with
   * every id either way (rigCommandIds).
   */
  rigExtras?: boolean;
};

/** Every command the set page offers, in the order the palette lists them with no query. */
export function shootCommands(ctx: ShootCommandContext): Command[] {
  const w = ctx.words;
  const out: Command[] = [];
  const add = (id: string, group: CommandGroup, label: string, run: () => void, keys?: string) => out.push({ id, group, label, keys, run });

  // Every mode but the one you are in — Cut included, which had no way in
  // or out of the palette (found reviewing Helios, 2026-09-17), and each
  // through the bar's own handler, so the address and the stage follow.
  for (const m of STUDIO_MODES) {
    if (m !== ctx.mode) add(`mode:${m}`, "modes", w.modes[m], () => ctx.goToMode(m));
  }
  // No key: R is the Turn tool since the frame's rail (studio.ts).
  add("rig:toggle", "modes", ctx.rigOpen ? w.rigHide : w.rigShow, () => ctx.setRigOpen(!ctx.rigOpen));
  add("chat:toggle", "modes", ctx.chatOpen ? w.chatHide : w.chatShow, () => ctx.setChatOpen(!ctx.chatOpen));

  add("stage:frame-figure", "stage", w.frameFigure, ctx.frameFigure, "F");
  add("stage:undo", "stage", w.undoStage, ctx.undoStage, "⌘Z");
  add("stage:download", "stage", w.downloadFrame, ctx.downloadFrame);
  for (const c of ctx.cameras) add(`camera:${c.id}`, "stage", w.camera(c.label), () => ctx.pickCamera(c.id));
  for (const m of ctx.marks) add(`mark:${m.id}`, "stage", w.mark(m.label), () => ctx.pickMark(m.id));
  if (ctx.canShoot) add("shoot", "shoot", w.shootNow, ctx.shoot);

  // The rig's commands from the shared table, in ⌘K's own order: the frame,
  // then the lens ring's chips (not the chat's: its lens_mm goes through the
  // page's pickLens, which reads the rig's sensor), then focus, light, time
  // and look.
  const rigCommand = (c: RigCommand) => (c.extra && !ctx.rigExtras ? 0 : add(c.id, c.group, c.label(w), () => ctx.setRig(c.patch(ctx.cameraBearingDeg))));
  for (const c of RIG_COMMANDS) if (c.group === "frame") rigCommand(c);
  for (const mm of LENSES_MM) add(`lens:${mm}`, "lens", w.lensMm(mm), () => ctx.pickLens(mm));
  for (const c of RIG_COMMANDS) if (c.group !== "frame") rigCommand(c);
  for (const k of RIG_OVERLAY_KEYS) add(`aid:${k}`, "viewfinder", w.overlays[k], () => ctx.setRig({ overlays: { ...ctx.rig.overlays, [k]: !ctx.rig.overlays[k] } }));
  return out;
}

// ---------------------------------------------------------------------------
// The rig's commands, one table for ⌘K and the chat (Cut 2, step 3).
// ---------------------------------------------------------------------------

/** The words a rig command's label is made of: ⌘K's, which the chat's chips repeat exactly. */
export type RigCommandWords = Pick<
  ShootCommandWords,
  | "formats"
  | "frame"
  | "squeeze"
  | "focus"
  | "stop"
  | "off"
  | "light"
  | "lights"
  | "asBuilt"
  | "time"
  | "timePresets"
  | "stock"
  | "stocks"
  | "lensCharacter"
  | "lenses"
  | "palette"
  | "palettes"
  | "era"
  | "eras"
  | "genre"
  | "genres"
>;

type RigCommand = {
  id: string;
  group: "frame" | "focus" | "light" | "time" | "look";
  label: (w: RigCommandWords) => string;
  /** A light plot is aimed from where the camera stands (light-schemes.ts schemeDefaults): the chat hands the bearing the camera ends the turn on. */
  patch: (cameraBearingDeg: number) => Partial<SetRig>;
  /** New in Cut 2 (step 3): listed by ⌘K only with ShootCommandContext.rigExtras. */
  extra?: true;
};

/**
 * What a genre suggests, set the way the rig panel's "Use these" sets it:
 * its light plot, aimed from the camera as it stands, and its palette.
 * rig-panel.tsx calls this too, so a genre from ⌘K or the chat is the
 * panel's suggestion exactly.
 */
export function genreLookPatch(genre: RigGenre, cameraBearingDeg: number): Pick<SetRig, "light" | "palette"> {
  const s = RIG_GENRE_SUGGESTS[genre];
  return { light: schemeDefaults(s.light, cameraBearingDeg), palette: s.palette };
}

const RIG_COMMANDS: readonly RigCommand[] = [
  ...RIG_FORMAT_ORDER.map((f): RigCommand => ({ id: `format:${f}`, group: "frame", label: (w) => `${w.frame} · ${w.formats[f]}`, patch: () => ({ format: f }) })),
  ...RIG_SQUEEZES.map((q): RigCommand => ({ id: `squeeze:${q}`, group: "frame", label: (w) => `${w.squeeze} · ${q}×`, patch: () => ({ squeeze: q }) })),
  ...RIG_STOPS.map((st): RigCommand => ({ id: `stop:${st}`, group: "focus", label: (w) => `${w.stop} · f/${st}`, patch: () => ({ stop: st }) })),
  { id: "stop:off", group: "focus", label: (w) => `${w.focus} · ${w.off}`, patch: () => ({ stop: null }) },
  ...RIG_LIGHTS.map((l): RigCommand => ({
    id: `light:${l.id}`,
    group: "light",
    label: (w) => `${w.light} · ${w.lights[l.id]}`,
    patch: (bearing) => ({ light: schemeDefaults(l.id, bearing) }),
  })),
  { id: "light:as-built", group: "light", label: (w) => `${w.light} · ${w.asBuilt}`, patch: () => ({ light: null }) },
  ...TIME_PRESETS.map((t): RigCommand => ({
    id: `time:${t.id}`,
    group: "time",
    label: (w) => `${w.time} · ${w.timePresets[t.id] ?? t.id} · ${timeLabel(t.hour)}`,
    patch: () => ({ time: t.hour }),
  })),
  { id: "time:as-built", group: "time", label: (w) => `${w.time} · ${w.asBuilt}`, patch: () => ({ time: null }) },
  // A look can be taken off in words too ("no grain", "not black and
  // white"), so each look group has its own "none", with the rig's "Off".
  ...RIG_STOCKS.map((st): RigCommand => ({ id: `stock:${st.id}`, group: "look", label: (w) => `${w.stock} · ${w.stocks[st.id]}`, patch: () => ({ stock: st.id }) })),
  { id: "stock:none", group: "look", label: (w) => `${w.stock} · ${w.off}`, patch: () => ({ stock: null }), extra: true },
  ...RIG_LENSES.map((l): RigCommand => ({ id: `character:${l.id}`, group: "look", label: (w) => `${w.lensCharacter} · ${w.lenses[l.id]}`, patch: () => ({ lens: l.id }) })),
  { id: "character:none", group: "look", label: (w) => `${w.lensCharacter} · ${w.off}`, patch: () => ({ lens: null }), extra: true },
  ...RIG_PALETTES.map((p): RigCommand => ({ id: `palette:${p.id}`, group: "look", label: (w) => `${w.palette} · ${w.palettes[p.id]}`, patch: () => ({ palette: p.id }) })),
  { id: "palette:none", group: "look", label: (w) => `${w.palette} · ${w.off}`, patch: () => ({ palette: null }), extra: true },
  ...RIG_ERAS.map((e): RigCommand => ({ id: `era:${e.id}`, group: "look", label: (w) => `${w.era} · ${w.eras[e.id]}`, patch: () => ({ era: e.id }), extra: true })),
  { id: "era:none", group: "look", label: (w) => `${w.era} · ${w.off}`, patch: () => ({ era: null }), extra: true },
  // A genre adds no words of its own (rig.ts): it is its light and its
  // grade, so picking one sets both, as the panel's "Use these" does.
  ...RIG_GENRES.map((g): RigCommand => ({
    id: `genre:${g}`,
    group: "look",
    label: (w) => `${w.genre} · ${w.genres[g]}`,
    patch: (bearing) => ({ genre: g, ...genreLookPatch(g, bearing) }),
    extra: true,
  })),
];

const RIG_COMMAND_BY_ID = new Map(RIG_COMMANDS.map((c) => [c.id, c]));

/** Every rig command's id, in ⌘K's order: the only rig ids the chat's reader may answer with (shot-reading.ts). */
export function rigCommandIds(): string[] {
  return RIG_COMMANDS.map((c) => c.id);
}

/** What a rig command does to the rig, with a light plot aimed from `cameraBearingDeg`; null for an id that is not one. */
export function rigPatchFor(id: string, at: { cameraBearingDeg: number }): Partial<SetRig> | null {
  return RIG_COMMAND_BY_ID.get(id)?.patch(at.cameraBearingDeg) ?? null;
}

/** A rig command's label, exactly as ⌘K lists it ("Time of day · Golden hour · 17:30"); null for an id that is not one. */
export function rigCommandLabel(id: string, words: RigCommandWords): string | null {
  return RIG_COMMAND_BY_ID.get(id)?.label(words) ?? null;
}
