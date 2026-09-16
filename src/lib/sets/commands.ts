// The command palette (the studio, cut 4, 2026-09-17): every choice the
// set page offers as a list you can type at — ⌘K, the key every pro tool
// shares. Pure: the page builds the commands from its own handlers and
// strings, the palette only filters, steps and runs.

import { LENSES_MM } from "./build-scene";
import { schemeDefaults } from "./light-schemes";
import {
  RIG_FORMAT_ORDER,
  RIG_LENSES,
  RIG_LIGHTS,
  RIG_OVERLAY_KEYS,
  RIG_PALETTES,
  RIG_SQUEEZES,
  RIG_STOCKS,
  RIG_STOPS,
  type RigFormat,
  type RigLens,
  type RigLightScheme,
  type RigOverlayKey,
  type RigPalette,
  type RigStock,
  type SetRig,
} from "./rig";
import { timeLabel } from "./time-of-day";

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
  build: string;
  shoot: string;
  film: string;
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
  filmOpen: boolean;
  setFilmOpen(open: boolean): void;
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
  openBuild(): void;
  canShoot: boolean;
  shoot(): void;
};

/** Every command the set page offers, in the order the palette lists them with no query. */
export function shootCommands(ctx: ShootCommandContext): Command[] {
  const w = ctx.words;
  const out: Command[] = [];
  const add = (id: string, group: CommandGroup, label: string, run: () => void, keys?: string) => out.push({ id, group, label, keys, run });

  add("mode:build", "modes", w.build, ctx.openBuild);
  if (ctx.filmOpen) add("mode:shoot", "modes", w.shoot, () => ctx.setFilmOpen(false));
  else add("mode:film", "modes", w.film, () => ctx.setFilmOpen(true));
  add("rig:toggle", "modes", ctx.rigOpen ? w.rigHide : w.rigShow, () => ctx.setRigOpen(!ctx.rigOpen), "R");
  add("chat:toggle", "modes", ctx.chatOpen ? w.chatHide : w.chatShow, () => ctx.setChatOpen(!ctx.chatOpen));

  add("stage:frame-figure", "stage", w.frameFigure, ctx.frameFigure, "F");
  add("stage:undo", "stage", w.undoStage, ctx.undoStage, "⌘Z");
  add("stage:download", "stage", w.downloadFrame, ctx.downloadFrame);
  for (const c of ctx.cameras) add(`camera:${c.id}`, "stage", w.camera(c.label), () => ctx.pickCamera(c.id));
  for (const m of ctx.marks) add(`mark:${m.id}`, "stage", w.mark(m.label), () => ctx.pickMark(m.id));
  if (ctx.canShoot) add("shoot", "shoot", w.shootNow, ctx.shoot);

  for (const f of RIG_FORMAT_ORDER) add(`format:${f}`, "frame", `${w.frame} · ${w.formats[f]}`, () => ctx.setRig({ format: f }));
  for (const q of RIG_SQUEEZES) add(`squeeze:${q}`, "frame", `${w.squeeze} · ${q}×`, () => ctx.setRig({ squeeze: q }));
  for (const mm of LENSES_MM) add(`lens:${mm}`, "lens", w.lensMm(mm), () => ctx.pickLens(mm));
  for (const st of RIG_STOPS) add(`stop:${st}`, "focus", `${w.stop} · f/${st}`, () => ctx.setRig({ stop: st }));
  add("stop:off", "focus", `${w.focus} · ${w.off}`, () => ctx.setRig({ stop: null }));
  for (const l of RIG_LIGHTS) add(`light:${l.id}`, "light", `${w.light} · ${w.lights[l.id]}`, () => ctx.setRig({ light: schemeDefaults(l.id, ctx.cameraBearingDeg) }));
  add("light:as-built", "light", `${w.light} · ${w.asBuilt}`, () => ctx.setRig({ light: null }));
  for (const t of TIME_PRESETS) add(`time:${t.id}`, "time", `${w.time} · ${w.timePresets[t.id] ?? t.id} · ${timeLabel(t.hour)}`, () => ctx.setRig({ time: t.hour }));
  add("time:as-built", "time", `${w.time} · ${w.asBuilt}`, () => ctx.setRig({ time: null }));
  for (const st of RIG_STOCKS) add(`stock:${st.id}`, "look", `${w.stock} · ${w.stocks[st.id]}`, () => ctx.setRig({ stock: st.id }));
  for (const l of RIG_LENSES) add(`character:${l.id}`, "look", `${w.lensCharacter} · ${w.lenses[l.id]}`, () => ctx.setRig({ lens: l.id }));
  for (const p of RIG_PALETTES) add(`palette:${p.id}`, "look", `${w.palette} · ${w.palettes[p.id]}`, () => ctx.setRig({ palette: p.id }));
  for (const k of RIG_OVERLAY_KEYS) add(`aid:${k}`, "viewfinder", w.overlays[k], () => ctx.setRig({ overlays: { ...ctx.rig.overlays, [k]: !ctx.rig.overlays[k] } }));
  return out;
}
