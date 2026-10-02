// Press Tour › Clippings (2026-10-02, operator: "Build C, leave X out"; board
// C of claude.ai/artifact/X8W76bPZJL8r72a4XwH7wS): the person's OWN posts on
// one chart by views, each script broken into its parts, and the formats
// that beat their usual. The shapes the door, the service and the database
// share.
//
// The platforms' rules (official docs, read 2026-10-02) are the design:
//   - only the person's own posts, read with the keys they gave us, or a
//     video they upload and say they made;
//   - one person's posts are never pooled with anyone else's (YouTube forbids
//     it outright; Meta's terms don't allow it plainly, so nowhere does);
//   - disconnecting deletes what was read through that account (the clips
//     point at the connection ON DELETE CASCADE: press-clippings.sql).
//
// Pure. Alias-free (vitest has no '@/').

export const CLIP_SOURCES = ["instagram", "tiktok", "upload"] as const;
export type ClipSource = (typeof CLIP_SOURCES)[number];

/** The networks Clippings reads (X is left out: operator, 2026-10-02). */
export const CLIP_NETWORKS = ["instagram", "tiktok"] as const;
export type ClipNetwork = (typeof CLIP_NETWORKS)[number];

/**
 * A script's parts, in Press Tour's own words: the hook, the co-star (the
 * product shows up), the proof, and the line (the one ask).
 */
export const CLIP_PARTS = ["hook", "costar", "proof", "line"] as const;
export type ClipPart = (typeof CLIP_PARTS)[number];

/** One line of a script: when it starts (whole seconds), which part it is, and what was said. */
export type ClipLine = { t: number; part: ClipPart; said: string };

/**
 * Why a post has (or has no) words:
 *   pending      not read yet (the next read does it)
 *   read         the words are in `lines`
 *   none         read, and nobody speaks or writes in it
 *   no_file      the network doesn't share the file (Instagram: licensed music)
 *   too_long     longer than we read (WORDS_MAX_SECONDS)
 *   failed       the reading failed; the next read tries again
 *   views_only   TikTok: it shares counts, never the file
 */
export const WORDS_STATES = ["pending", "read", "none", "no_file", "too_long", "failed", "views_only"] as const;
export type WordsState = (typeof WORDS_STATES)[number];

/** A clip as the door sees it. */
export type ClipView = {
  id: string;
  source: ClipSource;
  /** Posted by Press Tour (a published post of one of the person's ads). */
  pressTour: boolean;
  postedAt: string | null;
  permalink: string | null;
  thumbUrl: string | null;
  durationS: number | null;
  views: number | null;
  wordsState: WordsState;
  lines: ClipLine[];
  format: string | null;
  why: string | null;
};

/** One network's place in the sources strip. */
export type SourceState =
  /** Its switch is off: "Opens soon". */
  | "closed"
  /** Not connected: Connect (on the web). */
  | "connect"
  /** Connected, but before Clippings asked for the reading permission: Connect again. */
  | "reconnect"
  | "connected";

export type ClipRunView = {
  state: "idle" | "reading";
  startedAt: string | null;
  finishedAt: string | null;
  done: number;
  total: number;
  /** A code the door words (clippings messages), or null. */
  error: ClipError | null;
};

export type ClippingsHome = {
  clips: ClipView[];
  run: ClipRunView;
  sources: Record<ClipNetwork, { state: SourceState; handle: string | null; posts: number }>;
  uploads: number;
  pressTourAds: number;
  /** Connecting happens on the web only (the apps send people there). */
  webOnly: boolean;
};

/** What an action answers when it can't: a code the door words in the person's language. */
export const CLIP_ERRORS = [
  "closed",
  "unavailable",
  "busy",
  "limit",
  "bad_file",
  "too_big",
  "bad_views",
  "attest",
  "not_found",
  "nothing_to_read",
] as const;
export type ClipError = (typeof CLIP_ERRORS)[number];

export type ClipFail = { ok: false; error: ClipError };

// ---------------------------------------------------------------------
// Limits
// ---------------------------------------------------------------------

/** The newest videos read per network, per read. */
export const POSTS_PER_NETWORK = 60;
/** A video longer than this keeps its views but not its words. */
export const WORDS_MAX_SECONDS = 180;
/** Words read per person per day (each costs a transcription): the money guard. */
export const WORDS_PER_DAY = 150;
/** Reads a person may start a day (a continuation of an unfinished read is free). */
export const READS_PER_DAY = 8;
/** Videos a person may add a day. */
export const UPLOADS_PER_DAY = 20;
export const UPLOAD_MAX_BYTES = 50 * 1024 * 1024;
export const UPLOAD_TYPES = ["video/mp4", "video/quicktime", "video/webm"] as const;
export const CLIP_UPLOAD_BUCKET = "press-clip-uploads";
/** A read nobody finished (a function that died) is let go after this. */
export const RUN_STALE_MS = 6 * 60 * 1000;

export const SAID_MAX = 200;
export const FORMAT_MAX = 40;
export const WHY_MAX = 300;
export const LINES_MAX = 20;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function parseClipId(v: unknown): string | null {
  return typeof v === "string" && UUID_RE.test(v) ? v.toLowerCase() : null;
}

export function isClipPart(v: unknown): v is ClipPart {
  return typeof v === "string" && (CLIP_PARTS as readonly string[]).includes(v);
}

export function isWordsState(v: unknown): v is WordsState {
  return typeof v === "string" && (WORDS_STATES as readonly string[]).includes(v);
}

/** One line of text, trimmed and cut; null when nothing is left. */
export function oneLine(v: unknown, max: number): string | null {
  if (typeof v !== "string") return null;
  const s = v.replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim();
  if (!s) return null;
  return s.length > max ? `${s.slice(0, max - 1).trimEnd()}…` : s;
}

/** Stored lines, read defensively (the column is jsonb). */
export function linesFrom(v: unknown): ClipLine[] {
  if (!Array.isArray(v)) return [];
  const out: ClipLine[] = [];
  for (const raw of v) {
    if (!raw || typeof raw !== "object") continue;
    const r = raw as Record<string, unknown>;
    const t = typeof r.t === "number" && Number.isFinite(r.t) ? Math.max(0, Math.round(r.t)) : null;
    const said = oneLine(r.said, SAID_MAX);
    if (t === null || !said || !isClipPart(r.part)) continue;
    out.push({ t, part: r.part, said });
    if (out.length >= LINES_MAX) break;
  }
  return out.sort((a, b) => a.t - b.t);
}
