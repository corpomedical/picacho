// The tools behind the sidebar's one door (operator, 2026-09-25: "B" on the
// sidebar draft — places in the menu, every tool behind a single Tools row
// whose panel says what each one does). One list, so the panel, the pinned
// rows, the New dot and ⌘K all agree on what exists and who may see it.
//
// A new tool is one line here (plus its two words in the catalogs), never a
// new row in the menu.

export type ToolKey =
  | "generate"
  | "pressTour"
  | "live"
  | "recast"
  | "sets"
  | "recce"
  | "cut"
  | "upscale"
  | "layers"
  | "templates"
  | "notes";

/** The panel's three shelves, in order. */
export type ToolGroup = "make" | "edit" | "start";
export const TOOL_GROUPS: readonly ToolGroup[] = ["make", "edit", "start"];

export type NavTool = {
  key: ToolKey;
  href: string;
  group: ToolGroup;
  /**
   * The last day (yyyy-mm-dd, inclusive) the tool wears New: its launch plus
   * 14 days. Past it, or once the person has opened the tool, the dot goes.
   * When a tool opens to more people (Live to paid plans, say), move its
   * date to that day plus 14 so the new audience gets the dot too.
   */
  newUntil?: string;
};

export const NAV_TOOLS: readonly NavTool[] = [
  { key: "generate", href: "/app/generate", group: "make" },
  // Press Tour (2026-09-26): an ad for your product, starring your character.
  // Admins first, behind the press_tour switch; pinned by default (below).
  { key: "pressTour", href: "/app/press-tour", group: "make", newUntil: "2026-10-10" },
  { key: "live", href: "/app/live", group: "make", newUntil: "2026-10-08" },
  { key: "recast", href: "/app/mystique", group: "make", newUntil: "2026-10-05" },
  { key: "sets", href: "/app/sets", group: "make", newUntil: "2026-10-03" },
  { key: "recce", href: "/app/recce", group: "make", newUntil: "2026-10-01" },
  { key: "cut", href: "/app/edit", group: "edit", newUntil: "2026-10-08" },
  { key: "upscale", href: "/app/upscale", group: "edit" },
  { key: "layers", href: "/app/layers", group: "edit" },
  { key: "templates", href: "/app/templates", group: "start" },
  { key: "notes", href: "/app/notes", group: "start" },
];

/** The layout's own gates, the same ones the sidebar has always taken. */
export type ToolGates = {
  setsVisible: boolean;
  recceVisible: boolean;
  mystiqueVisible: boolean;
  liveVisible: boolean;
  cutVisible: boolean;
  pressTourVisible: boolean;
};

const GATE: Partial<Record<ToolKey, keyof ToolGates>> = {
  pressTour: "pressTourVisible",
  sets: "setsVisible",
  recce: "recceVisible",
  recast: "mystiqueVisible",
  live: "liveVisible",
  cut: "cutVisible",
};

/** The tools this account may open, in panel order. */
export function visibleTools(gates: ToolGates): NavTool[] {
  return NAV_TOOLS.filter((tool) => {
    const gate = GATE[tool.key];
    return gate ? gates[gate] : true;
  });
}

/** Whether `pathname` is inside `href` (the page itself or anything under it). */
export function isUnder(pathname: string | null | undefined, href: string): boolean {
  if (!pathname) return false;
  return pathname === href || pathname.startsWith(`${href}/`);
}

/** The tool whose page this is, if any. */
export function toolForPath(pathname: string | null | undefined, tools: readonly NavTool[]): NavTool | undefined {
  return tools.find((tool) => isUnder(pathname, tool.href));
}

/** yyyy-mm-dd of a date in the viewer's own calendar. */
export function localDay(now: Date): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/** New = inside its window and not yet opened by this person. */
export function isToolNew(tool: NavTool, today: string, seen: ReadonlySet<string>): boolean {
  return tool.newUntil !== undefined && today <= tool.newUntil && !seen.has(tool.key);
}

const KEYS = new Set<string>(NAV_TOOLS.map((tool) => tool.key));

/**
 * A stored list of tool keys, read defensively: storage is the person's own
 * browser, so anything (another build's keys, hand edits, junk) can be there.
 * Unknown keys and repeats are dropped; the order is kept.
 */
export function parseToolKeys(raw: string | null | undefined): ToolKey[] {
  if (!raw) return [];
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(value)) return [];
  const out: ToolKey[] = [];
  for (const item of value) {
    if (typeof item === "string" && KEYS.has(item) && !out.includes(item as ToolKey)) out.push(item as ToolKey);
  }
  return out;
}

/**
 * The tools pinned under the Tools row for someone who has never pinned or
 * unpinned anything (Spec v2 N1, 2026-09-26: Press Tour is a pinned row under
 * Tools, never a new row in the menu). Seeded only while no pin list is
 * stored, and only for the tools this account can see; the first pin or
 * unpin stores the list, and from then on the person's own list is the only
 * one read.
 */
export const DEFAULT_PINNED: readonly ToolKey[] = ["pressTour"];

/**
 * The pins to start from. `raw` is the stored list: null (or undefined) when
 * nothing is stored, and then the default pins this account can see
 * (`visible`, the keys of visibleTools) are the answer. Anything stored, even
 * an empty list or junk, is the person's own choice and is read as it is.
 */
export function startingPins(raw: string | null | undefined, visible: readonly string[]): ToolKey[] {
  if (raw !== null && raw !== undefined) return parseToolKeys(raw);
  return DEFAULT_PINNED.filter((key) => visible.includes(key));
}

/** Pin or unpin one tool; a new pin goes to the end. */
export function togglePin(pinned: readonly ToolKey[], key: ToolKey): ToolKey[] {
  return pinned.includes(key) ? pinned.filter((k) => k !== key) : [...pinned, key];
}

// Per-browser conveniences, like the sidebar's collapse preference.
export const PINNED_STORAGE_KEY = "picacho_tools_pinned";
export const SEEN_STORAGE_KEY = "picacho_tools_seen";
