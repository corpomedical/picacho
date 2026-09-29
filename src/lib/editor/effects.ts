// Effects (operator, 2026-09-28/29: "Opus 5.5 visual effects implementation
// on Picacho" → "sometimes people only want visual. Now with our latest
// Ecosystem integration, make it its own door."): a finished film in, the
// same film out with the finishing Opus did by hand for LIFT on 2026-09-28 —
// opening titles, a corner badge, end credits, a vertical version with the
// words under it, a cover, and sound effects that can be switched off.
//
// It is a Director's Cut job underneath (the same video_edits row, the same
// Managed Agent, the same minute tick and delivery to History), so it needs
// no table, bucket or key of its own. What makes a row an Effects job is its
// `director` column — v1's director state, unused since v2 — holding
// { door: "effects", spec }. Pure: no network, no React.

export const EFFECTS_DOOR = "effects";

/** The customer's own words, each capped: they ride inside the agent's first message. */
export const EFFECTS_LIMITS = {
  presenter: 60,
  title: 60,
  badge: 60,
  credits: 800,
  endCard: 80,
  words: 3000,
  notes: 1000,
} as const;

/** A logo: small, one image the agent downloads. */
export const MAX_LOGO_BYTES = 10 * 1024 * 1024;
export const LOGO_TYPES: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "image/svg+xml": "svg",
};

/** One film per Effects job, and a film, not a feature: 10 minutes at most. */
export const MAX_FILM_SECONDS = 10 * 60;

export type EffectsSpec = {
  opening: { on: boolean; presenter: string; title: string };
  badge: { on: boolean; text: string };
  credits: { on: boolean; lines: string; endCard: string };
  vertical: { on: boolean; words: string };
  cover: { on: boolean };
  /** Off = picture only: nothing added to the sound, the film's own sound untouched. */
  sound: boolean;
  notes: string;
  /** The logo in the footage bucket, when one was uploaded (bytes: what the browser promised, checked on submit). */
  logo: { path: string; name: string; bytes: number } | null;
  /** Where the film came from: an upload, or one of their own History takes. */
  source: { kind: "upload" } | { kind: "take"; takeId: string };
};

export type EffectsMarker = { door: typeof EFFECTS_DOOR; spec: EffectsSpec };

/** The `director` column of a row → its Effects spec, or null for a Director's Cut edit. */
export function effectsOf(director: unknown): EffectsSpec | null {
  if (!director || typeof director !== "object") return null;
  const d = director as { door?: unknown; spec?: unknown };
  if (d.door !== EFFECTS_DOOR || !d.spec || typeof d.spec !== "object") return null;
  return d.spec as EffectsSpec;
}

export function isEffectsRow(row: { director?: unknown }): boolean {
  return effectsOf(row.director) !== null;
}

function text(value: unknown, max: number): string {
  if (typeof value !== "string") return "";
  // Control characters out (newlines and tabs kept); nothing else touched.
  return value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "").trim().slice(0, max);
}

function line(value: unknown, max: number): string {
  return text(value, max).replace(/\s+/g, " ");
}

const on = (value: unknown, fallback: boolean): boolean => (typeof value === "boolean" ? value : fallback);

/**
 * What the browser sent → a spec we store, or why not. Every field is read
 * defensively (the browser is the customer's); at least one effect must be
 * on, and a switched-on effect that needs words has them.
 */
export function parseEffects(input: unknown): { error: string } | { error: null; spec: Omit<EffectsSpec, "logo" | "source"> } {
  const b = (input && typeof input === "object" ? input : {}) as Record<string, Record<string, unknown> | unknown>;
  const part = (key: string) => (b[key] && typeof b[key] === "object" ? (b[key] as Record<string, unknown>) : {});
  const opening = part("opening");
  const badge = part("badge");
  const credits = part("credits");
  const vertical = part("vertical");
  const cover = part("cover");
  const spec: Omit<EffectsSpec, "logo" | "source"> = {
    opening: { on: on(opening.on, false), presenter: line(opening.presenter, EFFECTS_LIMITS.presenter), title: line(opening.title, EFFECTS_LIMITS.title) },
    badge: { on: on(badge.on, false), text: line(badge.text, EFFECTS_LIMITS.badge) },
    credits: { on: on(credits.on, false), lines: text(credits.lines, EFFECTS_LIMITS.credits), endCard: line(credits.endCard, EFFECTS_LIMITS.endCard) },
    vertical: { on: on(vertical.on, false), words: text(vertical.words, EFFECTS_LIMITS.words) },
    cover: { on: on(cover.on, false) },
    sound: on(b.sound, true),
    notes: text(b.notes, EFFECTS_LIMITS.notes),
  };
  if (!spec.opening.on && !spec.badge.on && !spec.credits.on && !spec.vertical.on && !spec.cover.on) {
    return { error: "Pick at least one effect." };
  }
  if (spec.opening.on && !spec.opening.title && !spec.opening.presenter) {
    return { error: "Give the opening titles a name or a title." };
  }
  if (spec.credits.on && !spec.credits.lines && !spec.credits.endCard) {
    return { error: "Write at least one credit line or an end card." };
  }
  return { error: null, spec };
}

/** The one short line a job is known by on the page and in History. */
export function effectsLabel(spec: EffectsSpec): string {
  return spec.opening.title || spec.opening.presenter || spec.badge.text || "Effects";
}

/** Which effects are on, in the order the page lists them — for the page's chips. */
export type EffectKey = "opening" | "badge" | "credits" | "vertical" | "cover" | "sound";
export function effectsOn(spec: EffectsSpec): EffectKey[] {
  const out: EffectKey[] = [];
  if (spec.opening.on) out.push("opening");
  if (spec.badge.on) out.push("badge");
  if (spec.credits.on) out.push("credits");
  if (spec.vertical.on) out.push("vertical");
  if (spec.cover.on) out.push("cover");
  if (spec.sound) out.push("sound");
  return out;
}

/** A logo about to be uploaded → where it goes, or why not. */
export function planLogo(userId: string, editId: string, f: { name?: unknown; size?: unknown; type?: unknown } | null | undefined): { error: string } | { error: null; path: string; name: string; type: string; bytes: number } {
  const type = typeof f?.type === "string" ? f.type.toLowerCase() : "";
  const ext = LOGO_TYPES[type];
  const name = line(f?.name, 120) || "logo";
  if (!ext) return { error: `"${name}" isn't a logo we can use (PNG, JPG, WebP, SVG).` };
  const bytes = Number(f?.size);
  if (!(bytes > 0)) return { error: `"${name}" is empty.` };
  if (bytes > MAX_LOGO_BYTES) return { error: `"${name}" is over ${MAX_LOGO_BYTES / 1024 / 1024} MB.` };
  return { error: null, path: `${userId}/${editId}/logo.${ext}`, name, type, bytes };
}

/** The brief line stored on the row (shown in History's prompt of each delivered video). */
export function effectsBrief(spec: Omit<EffectsSpec, "logo" | "source">): string {
  const parts: string[] = [];
  if (spec.opening.on) parts.push(`Opening titles${spec.opening.title ? `: ${spec.opening.title}` : ""}`);
  if (spec.badge.on) parts.push("corner badge");
  if (spec.credits.on) parts.push("end credits");
  if (spec.vertical.on) parts.push("vertical version");
  if (spec.cover.on) parts.push("cover");
  parts.push(spec.sound ? "sound effects" : "picture only");
  return `Effects — ${parts.join(", ")}`;
}
