// The tools "Who comes back" counts (2026-10-03, operator: "Draft all three,
// both admins" → "Put them in the right place"). A tool is a door in the app
// a person can open and make something in; its key is what user_tool_days
// stores, so keys never change once shipped (rename the label instead).
//
// Pure and alias-free: the heartbeat route maps a path through toolForPath,
// and the admin pages list RETENTION_TOOLS in this order.

export type ToolKey =
  | "generate"
  | "chat"
  | "light"
  | "recast"
  | "sets"
  | "recce"
  | "live"
  | "cut"
  | "effects"
  | "upscale"
  | "layers"
  | "templates"
  | "notes"
  | "pressTour"
  | "characters"
  | "community";

export type RetentionTool = {
  key: ToolKey;
  label: string;
  /** Path prefixes under /app that belong to the tool. */
  paths: readonly string[];
};

export const RETENTION_TOOLS: readonly RetentionTool[] = [
  { key: "generate", label: "Generate", paths: ["/app/generate", "/app/stage"] },
  { key: "chat", label: "Aly chat", paths: ["/app/chat"] },
  { key: "light", label: "Light", paths: ["/app/light"] },
  { key: "recast", label: "Recast", paths: ["/app/mystique"] },
  { key: "sets", label: "Helios 3D", paths: ["/app/sets"] },
  { key: "recce", label: "Recce", paths: ["/app/recce"] },
  { key: "live", label: "Live", paths: ["/app/live"] },
  { key: "cut", label: "Director’s Cut", paths: ["/app/edit", "/app/editor"] },
  { key: "effects", label: "Effects", paths: ["/app/effects"] },
  { key: "upscale", label: "Upscale video", paths: ["/app/upscale"] },
  { key: "layers", label: "Layers", paths: ["/app/layers"] },
  { key: "templates", label: "Templates", paths: ["/app/templates"] },
  { key: "notes", label: "Notes", paths: ["/app/notes"] },
  { key: "pressTour", label: "Press Tour", paths: ["/app/press-tour"] },
  { key: "characters", label: "Characters", paths: ["/app/character"] },
  { key: "community", label: "Community", paths: ["/app/community"] },
];

const TOOL_KEYS = new Set<string>(RETENTION_TOOLS.map((t) => t.key));

export function isToolKey(value: unknown): value is ToolKey {
  return typeof value === "string" && TOOL_KEYS.has(value);
}

export function toolLabel(key: string): string {
  return RETENTION_TOOLS.find((t) => t.key === key)?.label ?? key;
}

/**
 * The tool a pathname belongs to, or null (home, history, settings, the
 * marketing site, anything unknown). Only the path is read — never a query
 * string — and anything that isn't a plain /app path answers null, so a
 * caller can hand it whatever the browser sent.
 */
export function toolForPath(path: unknown): ToolKey | null {
  if (typeof path !== "string" || path.length > 300) return null;
  const clean = path.split(/[?#]/)[0];
  for (const tool of RETENTION_TOOLS) {
    for (const prefix of tool.paths) {
      if (clean === prefix || clean.startsWith(`${prefix}/`)) return tool.key;
    }
  }
  return null;
}

const UNITS: Partial<Record<ToolKey, [string, string]>> = {
  generate: ["render", "renders"],
  recast: ["render", "renders"],
  upscale: ["upscale", "upscales"],
  layers: ["picture", "pictures"],
  pressTour: ["ad", "ads"],
  chat: ["message", "messages"],
  cut: ["edit", "edits"],
  effects: ["edit", "edits"],
  sets: ["set", "sets"],
  notes: ["note", "notes"],
  characters: ["character", "characters"],
  community: ["post", "posts"],
};

/** "9 renders", "1 message": what a person made in a tool, in that tool's own word. */
export function madeText(tool: ToolKey, n: number): string {
  const unit = UNITS[tool] ?? ["thing", "things"];
  return `${n} ${n === 1 ? unit[0] : unit[1]}`;
}
