// The studio's frame (canvas page J, board J1; cut A of closing the gap,
// 2026-09-17): one page with a fixed frame around every mode — a tool rail
// on the left, the viewport, a dock on the right, a status bar — the
// grammar every pro tool shares. Pure: the two pages (set-view.tsx for
// Shoot and Film, set-editor.tsx for Build) read these tables, and the
// test holds them.

import { isLabPalette, rigCheckItems, type RigCheckItem, type SetRig } from "./rig";
import { schemeHasSun } from "./light-schemes";

export const STUDIO_MODES = ["build", "shoot", "film", "cut"] as const;
export type StudioMode = (typeof STUDIO_MODES)[number];

/** The rail's nine tools, as drawn: transform, place, kit — each on a single key. */
export const RAIL_TOOLS = [
  { id: "select", key: "V", group: 1 },
  { id: "move", key: "G", group: 1 },
  { id: "turn", key: "R", group: 1 },
  { id: "size", key: "S", group: 1 },
  { id: "camera", key: "C", group: 2 },
  { id: "light", key: "L", group: 2 },
  { id: "mark", key: "M", group: 2 },
  { id: "measure", key: "D", group: 2 },
  { id: "kit", key: "K", group: 3 },
] as const;
export type RailTool = (typeof RAIL_TOOLS)[number]["id"];
export type RailGroup = (typeof RAIL_TOOLS)[number]["group"];

/**
 * What a tool is in a mode: a "tool" stays picked and changes what a drag
 * does; an "action" fires once (adds a camera, opens a tab); "off" is not
 * here, with the note that says where it is (Build) or when (cut C).
 */
export type RailToolUse = "tool" | "action" | "off";
export type RailToolNote = "measure" | "build";
export type RailToolState = { id: RailTool; key: string; group: RailGroup; use: RailToolUse; note: RailToolNote | null };

const BUILD_USE: Record<RailTool, RailToolUse> = {
  select: "tool",
  move: "tool",
  turn: "tool",
  size: "tool",
  camera: "action",
  light: "action",
  mark: "action",
  measure: "tool",
  kit: "action",
};
const SHOOT_USE: Record<RailTool, RailToolUse> = {
  select: "tool",
  move: "tool",
  turn: "tool",
  size: "off",
  camera: "action",
  light: "action",
  mark: "action",
  measure: "tool",
  kit: "off",
};

/** The rail for a mode, in drawn order. Shoot, Film and Cut share one rail (Measure joined every mode in cut C). */
export function railToolsFor(mode: StudioMode): RailToolState[] {
  const use = mode === "build" ? BUILD_USE : SHOOT_USE;
  return RAIL_TOOLS.map((t) => ({
    id: t.id,
    key: t.key,
    group: t.group,
    use: use[t.id],
    note: use[t.id] === "off" ? (t.id === "measure" ? "measure" : "build") : null,
  }));
}

/** The tool a bare key picks in a mode, or null: a key that is off here does nothing. */
export function railToolForKey(mode: StudioMode, key: string): RailTool | null {
  const k = key.length === 1 ? key.toUpperCase() : "";
  const hit = railToolsFor(mode).find((t) => t.key === k);
  return hit && hit.use !== "off" ? hit.id : null;
}

/** The dock's tabs, as drawn (Scene · Camera · Light · Look · History) plus Film while the film is open and Astra, where the conversation lives. */
export const DOCK_TABS = ["scene", "camera", "light", "look", "film", "history", "astra"] as const;
export type DockTab = (typeof DOCK_TABS)[number];

/**
 * The tabs a mode shows. Build has the scene and its edits; the rig's
 * departments are the shoot's, so Build does not carry them (its dock
 * would show a rig it cannot shoot with). Film joins while the film is
 * open, in front of History.
 */
export function dockTabsFor(mode: StudioMode, filmOpen: boolean): DockTab[] {
  if (mode === "build") return ["scene", "history", "astra"];
  // The cut (cut C): the film's clips in order; the dock keeps the scene, the frames and the conversation.
  if (mode === "cut") return ["scene", "history", "astra"];
  return filmOpen ? ["scene", "camera", "light", "look", "film", "history", "astra"] : ["scene", "camera", "light", "look", "history", "astra"];
}

/** The tab to show after the film opens or closes: Film when it opens; Camera when it closes on Film. Any tab the mode lacks falls back to the first. */
export function dockTabAfter(current: DockTab, mode: StudioMode, filmOpen: boolean, filmJustOpened: boolean): DockTab {
  const tabs = dockTabsFor(mode, filmOpen);
  if (filmJustOpened && tabs.includes("film")) return "film";
  if (tabs.includes(current)) return current;
  return current === "film" && tabs.includes("camera") ? "camera" : tabs[0];
}

/** What the status bar says the stage holds, what is checked after the render, and what the lab makes. */
export const STATUS_ITEMS = ["frame", "lens", "stop", "focus", "sun", "hour", "move", "pose", "plot", "stock", "palette", "character", "era", "grain"] as const;
export type StatusItem = (typeof STATUS_ITEMS)[number];

/** Held by the stage: in the picture by construction. The frame and the lens always; the rest as the rig sets them. */
export function studioHeld(rig: SetRig, extras: { move: boolean; pose: boolean }): StatusItem[] {
  const out: StatusItem[] = ["frame", "lens"];
  if (rig.stop !== null) out.push("stop", "focus");
  if (rig.time !== null || (rig.light !== null && schemeHasSun(rig.light.scheme))) out.push("sun");
  if (rig.time !== null) out.push("hour");
  if (extras.move) out.push("move");
  if (extras.pose) out.push("pose");
  return out;
}

const CHECK_TO_STATUS: Record<RigCheckItem, StatusItem | null> = {
  light: "plot",
  focus: null, // held by the stage: the stop draws it
  palette: "palette",
  stock: "stock",
  lens: "character",
  era: "era",
};

/** Checked after the render (rig-check.ts): what the rig asks for in words and reads back off the still. */
export function studioChecked(rig: SetRig): StatusItem[] {
  const out: StatusItem[] = [];
  for (const item of rigCheckItems(rig)) {
    const s = CHECK_TO_STATUS[item];
    if (s && !out.includes(s)) out.push(s);
  }
  return out;
}

/** Made by the lab after the cut (lab-grade.ts): the stock's grain, the lens's character, black and white. */
export function studioLab(rig: SetRig): StatusItem[] {
  const out: StatusItem[] = [];
  if (rig.stock && rig.stock !== "digital") out.push("grain");
  if (rig.lens && rig.lens !== "clean") out.push("character");
  if (isLabPalette(rig.palette)) out.push("palette");
  return out;
}
