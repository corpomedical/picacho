// An edit as a job: the row's shape and every decision about it that does not
// need the network — the limits, what the next step is, what a failure
// means. advance.ts does the steps; this file says which one.

import type { ProbeResult, Silence } from "./analyze";
import type { DirectorState } from "./director";
import type { Aspect, EditPlan } from "./plan";
import type { Word } from "./timeline";

export const EDITOR_BUCKET = "edit-footage";
export const MAX_CLIPS = 12;
export const MAX_CLIP_BYTES = 1024 * 1024 * 1024;
/** All footage together, seconds — 20 minutes of rushes per edit. */
export const MAX_TOTAL_SECONDS = 20 * 60;
export const MAX_BRIEF_CHARS = 4000;
export const MAX_NOTE_CHARS = 2000;
/** A step that fails this many times in a row fails the edit. */
export const MAX_ATTEMPTS = 3;
/** A render HeyGen has not finished in this long is given up on. */
export const RENDER_DEADLINE_MS = 30 * 60 * 1000;
/** A lock older than this was left by a function that died; the next tick may take the edit. */
export const LOCK_STALE_MS = 6 * 60 * 1000;

export type Stage = "uploading" | "analyzing" | "directing" | "bundling" | "rendering" | "done" | "failed";
export const WORKING_STAGES: readonly Stage[] = ["analyzing", "directing", "bundling", "rendering"];

export type ClipRecord = {
  path: string;
  /** The customer's file name — shown back to them and to the director as a hint. */
  name: string;
  bytes: number;
  contentType: string;
  probe: ProbeResult | null;
  interval: number | null;
  /** Storage paths of the contact sheets, in order. */
  sheets: string[];
  sceneChanges: number[];
  silences: Silence[];
  words: Word[];
  analyzed: boolean;
};

export type RenderRecord = { assetId: string; renderId: string; startedAt: number };

export type EditRow = {
  id: string;
  user_id: string;
  brief: string;
  aspect: Aspect;
  target_seconds: number | null;
  clips: ClipRecord[];
  stage: Stage;
  progress: string | null;
  director: DirectorState | null;
  plan: EditPlan | null;
  render: RenderRecord | null;
  generation_id: string | null;
  error: string | null;
  cost_usd: number;
  attempts: number;
  locked_at: string | null;
  created_at: string;
  updated_at: string;
};

export const EDIT_COLUMNS =
  "id, user_id, brief, aspect, target_seconds, clips, stage, progress, director, plan, render, generation_id, error, cost_usd, attempts, locked_at, created_at, updated_at";

const VIDEO_TYPES: Record<string, string> = {
  "video/mp4": "mp4",
  "video/quicktime": "mov",
  "video/webm": "webm",
};
const AUDIO_TYPES: Record<string, string> = {
  "audio/mpeg": "mp3",
  "audio/mp4": "m4a",
  "audio/x-m4a": "m4a",
  "audio/wav": "wav",
  "audio/x-wav": "wav",
};

export type FileOffer = { name: string; size: number; type: string };

/** What the browser says it is about to upload → the paths it may upload to, or why not. */
export function planUploads(userId: string, editId: string, files: FileOffer[]): { error: string } | { error: null; clips: ClipRecord[] } {
  if (!Array.isArray(files) || files.length === 0) return { error: "Add at least one clip." };
  if (files.length > MAX_CLIPS) return { error: `Up to ${MAX_CLIPS} files per edit.` };
  const clips: ClipRecord[] = [];
  for (const [i, f] of files.entries()) {
    const type = typeof f?.type === "string" ? f.type.toLowerCase() : "";
    const ext = VIDEO_TYPES[type] ?? AUDIO_TYPES[type];
    if (!ext) return { error: `"${shortName(f?.name)}" isn't a video or audio file we can read (MP4, MOV, WebM, MP3, M4A, WAV).` };
    const size = Number(f?.size);
    if (!(size > 0)) return { error: `"${shortName(f?.name)}" is empty.` };
    if (size > MAX_CLIP_BYTES) return { error: `"${shortName(f?.name)}" is over 1 GB.` };
    clips.push({
      path: `${userId}/${editId}/clip-${i}.${ext}`,
      name: shortName(f?.name),
      bytes: size,
      contentType: type,
      probe: null,
      interval: null,
      sheets: [],
      sceneChanges: [],
      silences: [],
      words: [],
      analyzed: false,
    });
  }
  return { error: null, clips };
}

/** After probing: can this footage be edited at all? */
export function footageProblem(clips: ClipRecord[]): string | null {
  let total = 0;
  for (const c of clips) {
    if (!c.probe) return `"${c.name}" couldn't be read.`;
    if (!c.probe.hasVideo && !c.probe.hasAudio) return `"${c.name}" has neither picture nor sound.`;
    if (!(c.probe.duration > 0.5)) return `"${c.name}" is too short to use.`;
    if (c.probe.hasVideo) total += c.probe.duration;
  }
  if (!clips.some((c) => c.probe?.hasVideo)) return "Add at least one clip with picture — audio alone can only be the music.";
  if (total > MAX_TOTAL_SECONDS) return `That's ${Math.round(total / 60)} minutes of footage; an edit takes up to ${MAX_TOTAL_SECONDS / 60} minutes.`;
  return null;
}

/** Total seconds of picture — what the sheet budget is shared across. */
export function totalVideoSeconds(clips: ClipRecord[]): number {
  return clips.reduce((sum, c) => sum + (c.probe?.hasVideo ? c.probe.duration : 0), 0);
}

export type Step =
  | { kind: "probe" }
  | { kind: "analyze"; clip: number }
  | { kind: "direct" }
  | { kind: "bundle" }
  | { kind: "poll" }
  | { kind: "none" };

/** The one thing to do next for an edit in this state. */
export function nextStep(row: Pick<EditRow, "stage" | "clips" | "director" | "plan" | "render">): Step {
  switch (row.stage) {
    case "analyzing": {
      if (row.clips.some((c) => !c.probe)) return { kind: "probe" };
      const clip = row.clips.findIndex((c) => !c.analyzed);
      return clip >= 0 ? { kind: "analyze", clip } : { kind: "direct" };
    }
    case "directing":
      return row.director?.phase === "done" && row.plan ? { kind: "bundle" } : { kind: "direct" };
    case "bundling":
      return { kind: "bundle" };
    case "rendering":
      return row.render ? { kind: "poll" } : { kind: "bundle" };
    default:
      return { kind: "none" };
  }
}

/** Steps that can take minutes — only started early in a tick. */
export function isHeavy(step: Step): boolean {
  return step.kind === "analyze" || step.kind === "direct" || step.kind === "bundle";
}

/** The customer-facing line for where an edit is. */
export function progressLine(step: Step, row: Pick<EditRow, "clips" | "director">): string {
  switch (step.kind) {
    case "probe":
      return "Reading your footage";
    case "analyze":
      return `Watching and listening — clip ${step.clip + 1} of ${row.clips.length}`;
    case "direct":
      return row.director?.phase === "review" ? "Checking the cut" : row.director?.phase === "fix" ? "Tightening the cut" : "Cutting the edit";
    case "bundle":
      return "Preparing the render";
    case "poll":
      return "Rendering";
    default:
      return "";
  }
}

function shortName(name: unknown): string {
  const s = typeof name === "string" ? name.replace(/[\u0000-\u001f]/g, "").trim() : "";
  return (s || "clip").slice(0, 120);
}
