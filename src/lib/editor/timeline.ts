// The Edit Bay's timeline, read from a video's HyperFrames project (board A,
// operator 2026-09-25: "a track to visualize the video cuts and audio are
// placed as a professional video editor").
//
// A project is HTML: every clip, sound and text is an element with
// data-start / data-duration (and data-media-start, data-volume for media).
// The HyperFrames SDK opens it in the browser and edits it; this file is the
// pure part — which track each element belongs on, and what a trim, move or
// split turns into as SDK operations — so it is tested without a browser.

export type LaneKey = "graphics" | "titles" | "story" | "backdrop" | "clip-sound" | "music" | "effects" | "voice";

export type TimelineClip = {
  /** The SDK's element id (data-hf-id). */
  id: string;
  lane: LaneKey;
  kind: "video" | "audio" | "text" | "image" | "other";
  label: string;
  start: number;
  end: number;
  /** Where in its source file the clip begins (data-media-start). */
  mediaStart: number;
  /** The file it plays, as the project refers to it. */
  src: string | null;
  /** The customer's clip number when it plays footage/clip-N. */
  footage: number | null;
  /** data-volume, 0..1, for sound. */
  volume: number | null;
  muted: boolean;
};

export type TimelineLane = { key: LaneKey; code: string; name: string; audio: boolean; clips: TimelineClip[] };
export type TimelineModel = { duration: number; lanes: TimelineLane[] };

/** The slice of the SDK's element snapshot this file reads (structural, so tests need no SDK). */
export type ProjectElement = {
  id: string;
  tag: string;
  attributes: Readonly<Record<string, string>>;
  classNames: readonly string[];
  text: string | null;
  children: readonly ProjectElement[];
};
export type ProjectTimings = Record<string, { enterAt: number; exitAt: number }>;

const LANES: { key: LaneKey; code: string; name: string; audio: boolean; always: boolean }[] = [
  { key: "graphics", code: "V3", name: "Graphics", audio: false, always: false },
  { key: "titles", code: "V2", name: "Titles", audio: false, always: true },
  { key: "story", code: "V1", name: "Story", audio: false, always: true },
  { key: "clip-sound", code: "A1", name: "Clip sound", audio: true, always: false },
  { key: "music", code: "A2", name: "Music", audio: true, always: true },
  { key: "effects", code: "A3", name: "Effects", audio: true, always: true },
  { key: "voice", code: "A4", name: "Voice", audio: true, always: false },
];

const FOOTAGE = /^(?:\.\/)?footage\/clip-(\d{1,2})\.[a-z0-9]{2,5}$/i;
const TEXT_TAGS = new Set(["div", "span", "p", "h1", "h2", "h3", "h4", "h5", "h6", "section", "article", "header", "footer"]);
const IMAGE_TAGS = new Set(["img", "svg", "picture", "canvas"]);

function num(v: string | undefined, fallback: number): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function textOf(el: ProjectElement): string {
  const own = (el.text ?? "").trim();
  if (own) return own;
  return el.children.map(textOf).filter(Boolean).join(" ").trim();
}

function fileName(src: string): string {
  return src.split("/").pop()?.replace(/\.[a-z0-9]+$/i, "").replace(/[-_]+/g, " ") ?? src;
}

function laneFor(el: ProjectElement, seconds: number): { lane: LaneKey; kind: TimelineClip["kind"] } {
  const tag = el.tag.toLowerCase();
  const src = (el.attributes.src ?? "").toLowerCase();
  const cls = el.classNames.join(" ").toLowerCase();
  const role = (el.attributes["data-role"] ?? "").toLowerCase();
  if (tag === "video") {
    const backdrop = "muted" in el.attributes && /\b(fill|blur|backdrop|bg|background)\b/.test(cls);
    return { lane: backdrop ? "backdrop" : "story", kind: "video" };
  }
  if (tag === "audio") {
    if (role === "music" || role === "voice" || role === "effects") return { lane: role as LaneKey, kind: "audio" };
    if (FOOTAGE.test(src)) return { lane: "clip-sound", kind: "audio" };
    if (/(^|\/)(sfx|effects?|hits?|whoosh|riser|impact)/.test(src)) return { lane: "effects", kind: "audio" };
    if (/(^|\/|[-_])(voice|vo|narration)([-_./]|$)/.test(src)) return { lane: "voice", kind: "audio" };
    if (/(^|\/)(music|songs?|score|tracks?|bed)/.test(src)) return { lane: "music", kind: "audio" };
    return { lane: seconds >= 6 ? "music" : "effects", kind: "audio" };
  }
  if (IMAGE_TAGS.has(tag)) return { lane: "graphics", kind: "image" };
  if (TEXT_TAGS.has(tag) && textOf(el)) return { lane: "titles", kind: "text" };
  return { lane: "graphics", kind: "other" };
}

/** Every timed element of a project, placed on its track. `clipNames` labels the customer's own clips. */
export function buildTimeline(roots: readonly ProjectElement[], timings: ProjectTimings, clipNames: readonly string[] = []): TimelineModel {
  const clips: TimelineClip[] = [];
  let duration = 0;
  const walk = (el: ProjectElement) => {
    const t = timings[el.id];
    const isRoot = el.attributes["data-composition-id"] !== undefined;
    if (isRoot && t) duration = Math.max(duration, t.exitAt);
    if (!isRoot && t && el.attributes["data-start"] !== undefined) {
      const seconds = Math.max(0, t.exitAt - t.enterAt);
      const { lane, kind } = laneFor(el, seconds);
      const src = el.attributes.src ?? null;
      const m = src ? FOOTAGE.exec(src) : null;
      const footage = m ? Number(m[1]) : null;
      const label =
        kind === "text"
          ? textOf(el).replace(/\s+/g, " ").slice(0, 60)
          : footage !== null
            ? (clipNames[footage] ?? `Clip ${footage + 1}`)
            : src
              ? fileName(src)
              : (el.attributes.id ?? el.tag);
      clips.push({
        id: el.id,
        lane,
        kind,
        label,
        start: t.enterAt,
        end: t.exitAt,
        mediaStart: num(el.attributes["data-media-start"], 0),
        src,
        footage,
        volume: el.attributes["data-volume"] !== undefined ? Math.min(1, Math.max(0, num(el.attributes["data-volume"], 1))) : kind === "audio" || kind === "video" ? 1 : null,
        muted: "muted" in el.attributes,
      });
      duration = Math.max(duration, t.exitAt);
      // A timed element's own timed children (a caption's words) are part of it, not new clips.
      return;
    }
    el.children.forEach(walk);
  };
  roots.forEach(walk);
  clips.sort((a, b) => a.start - b.start || a.end - b.end);
  const lanes: TimelineLane[] = LANES.filter((l) => l.always || clips.some((c) => c.lane === l.key)).map((l) => ({
    key: l.key,
    code: l.code,
    name: l.name,
    audio: l.audio,
    clips: clips.filter((c) => c.lane === l.key),
  }));
  return { duration, lanes };
}

/** The backdrops sit behind their story shots: the story lane draws them, never as a track of their own. */
export function backdrops(roots: readonly ProjectElement[], timings: ProjectTimings): TimelineClip[] {
  const all: TimelineClip[] = [];
  const walk = (el: ProjectElement) => {
    const t = timings[el.id];
    if (t && el.attributes["data-start"] !== undefined && el.tag.toLowerCase() === "video" && laneFor(el, t.exitAt - t.enterAt).lane === "backdrop") {
      all.push({ id: el.id, lane: "backdrop", kind: "video", label: "Backdrop", start: t.enterAt, end: t.exitAt, mediaStart: num(el.attributes["data-media-start"], 0), src: el.attributes.src ?? null, footage: null, volume: null, muted: true });
    }
    el.children.forEach(walk);
  };
  roots.forEach(walk);
  return all;
}

// ------------------------------------------------------------------ edits

export type TimingEdit = { id: string; start?: number; duration?: number; mediaStart?: number };

const MIN_CLIP = 0.1;
const round = (n: number) => Math.round(n * 1000) / 1000;

/** Drag the whole clip: same length, new start (never before 0). */
export function moveClip(clip: TimelineClip, start: number): TimingEdit {
  return { id: clip.id, start: round(Math.max(0, start)) };
}

/** Drag the right edge: new end, at least a tenth of a second long. */
export function trimEnd(clip: TimelineClip, end: number): TimingEdit {
  return { id: clip.id, duration: round(Math.max(MIN_CLIP, end - clip.start)) };
}

/**
 * Drag the left edge: the clip starts later (or earlier) on the timeline AND
 * later (or earlier) in its source, so the frames that stay keep their place.
 * A source cannot be read from before its own start.
 */
export function trimStart(clip: TimelineClip, start: number): TimingEdit {
  const media = clip.kind === "video" || clip.kind === "audio";
  let s = Math.min(start, clip.end - MIN_CLIP);
  if (media) s = Math.max(s, clip.start - clip.mediaStart);
  s = Math.max(0, s);
  const shift = s - clip.start;
  return { id: clip.id, start: round(s), duration: round(clip.end - s), ...(media ? { mediaStart: round(clip.mediaStart + shift) } : {}) };
}

/**
 * Cut one clip in two at `at`: the first part keeps the id, the second is a
 * copy of the element starting at `at`, reading its source from the matching
 * point. Media elements only (a caption split in two is a different thing).
 */
export function splitClip(
  clip: TimelineClip,
  at: number,
  element: { tag: string; attributes: Readonly<Record<string, string>>; classNames: readonly string[] },
  newId: string,
): { first: TimingEdit; secondHtml: string } | null {
  if (clip.kind !== "video" && clip.kind !== "audio") return null;
  if (at <= clip.start + MIN_CLIP || at >= clip.end - MIN_CLIP) return null;
  const attrs: Record<string, string> = { ...element.attributes };
  delete attrs["data-hf-id"];
  attrs.id = newId;
  attrs["data-start"] = String(round(at));
  attrs["data-duration"] = String(round(clip.end - at));
  attrs["data-media-start"] = String(round(clip.mediaStart + (at - clip.start)));
  if (element.classNames.length) attrs.class = element.classNames.join(" ");
  const attrText = Object.entries(attrs)
    .map(([k, v]) => (v === "" ? k : `${k}="${v.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;")}"`))
    .join(" ");
  return {
    first: { id: clip.id, duration: round(at - clip.start) },
    secondHtml: `<${element.tag} ${attrText}></${element.tag}>`,
  };
}

/** Where a dragged time lands: the nearest snap point within `tolerance` seconds, else where it was dropped. */
export function snap(t: number, points: readonly number[], tolerance: number): number {
  let best = t;
  let gap = tolerance;
  for (const p of points) {
    const d = Math.abs(p - t);
    if (d <= gap) {
      gap = d;
      best = p;
    }
  }
  return best;
}
