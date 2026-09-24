// An edit as a job: the row's shape and every decision about it that does not
// need the network — the limits, what the next step is, what a failure
// means. advance.ts does the steps; this file says which one.
//
// v2 (2026-09-25): our server reads and listens to the footage (probe, a
// word-timed transcript with the no-speech guard), then one Managed Agent
// session makes the whole video (agent.ts). The row's `render` column holds
// that session; its `plan` column holds what was delivered and the
// conversation the bench shows. (Column names are v1's; the table is unchanged.)

import type { ProbeResult } from "./analyze";
import type { Word } from "./transcribe";

export const EDITOR_BUCKET = "edit-footage";
export const MAX_CLIPS = 12;
export const MAX_CLIP_BYTES = 1024 * 1024 * 1024;
/** All footage together, seconds — 20 minutes of rushes per edit. */
export const MAX_TOTAL_SECONDS = 20 * 60;
export const MAX_BRIEF_CHARS = 4000;
export const MAX_NOTE_CHARS = 2000;
/** A step that fails this many times in a row fails the edit. */
export const MAX_ATTEMPTS = 3;
/** A session still working after this long is given up on (its budget caps the spend long before). */
export const SESSION_DEADLINE_MS = 75 * 60 * 1000;
/** A lock older than this was left by a function that died; the next tick may take the edit. */
export const LOCK_STALE_MS = 6 * 60 * 1000;
/** Signed footage links the agent downloads from: long enough for any session. */
export const FOOTAGE_URL_SECONDS = 12 * 60 * 60;

export type Stage = "uploading" | "analyzing" | "directing" | "bundling" | "rendering" | "done" | "failed";
export const WORKING_STAGES: readonly Stage[] = ["analyzing", "directing"];

/** "auto" = the editor decides the shape from the brief (the default). */
export type AspectHint = "auto" | "16:9" | "9:16" | "1:1";
export const ASPECT_HINTS: readonly AspectHint[] = ["auto", "9:16", "16:9", "1:1"];

export type ClipRecord = {
  path: string;
  /** The customer's file name — shown back to them and to the editor as a hint. */
  name: string;
  bytes: number;
  contentType: string;
  probe: ProbeResult | null;
  /** null until listened to. */
  speech: "speech" | "no-speech" | "silent" | null;
  words: Word[];
  analyzed: boolean;
};

/** The editing session (stored in the row's `render` column). */
export type SessionRecord = {
  sessionId: string;
  startedAt: number;
  /** 1 for the first delivery, +1 for each change asked for. */
  turn: number;
  /** When the current turn was asked for. */
  turnStartedAt: number;
  /** Our own spend before the session (transcription), US dollars. */
  preUsd: number;
  /** The result.json already turned into History rows. */
  lastResultId: string | null;
  /** The agent's latest words, for the progress line — only while nothing has happened since. */
  latest: string | null;
  /** What it is doing right now (agent.ts activityOf), when its words are older than its actions. */
  activity?: string | null;
};

export type Note = { role: "editor" | "you"; text: string };
export type Output = { title: string; summary: string; aspect: string; seconds: number; generationId: string; turn: number };

/** What was delivered, and the conversation (stored in the row's `plan` column). */
export type DeliveryRecord = { outputs: Output[]; history: Note[] };

export type EditRow = {
  id: string;
  user_id: string;
  brief: string;
  aspect: AspectHint;
  target_seconds: number | null;
  clips: ClipRecord[];
  stage: Stage;
  progress: string | null;
  director: unknown;
  plan: DeliveryRecord | null;
  render: SessionRecord | null;
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
      speech: null,
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

export type Step = { kind: "probe" } | { kind: "listen"; clip: number } | { kind: "start" } | { kind: "watch" } | { kind: "none" };

/** The one thing to do next for an edit in this state. */
export function nextStep(row: Pick<EditRow, "stage" | "clips" | "render">): Step {
  if (row.stage === "analyzing") {
    if (row.clips.some((c) => !c.probe)) return { kind: "probe" };
    const clip = row.clips.findIndex((c) => !c.analyzed);
    return clip >= 0 ? { kind: "listen", clip } : { kind: "start" };
  }
  if (row.stage === "directing") return row.render ? { kind: "watch" } : { kind: "start" };
  return { kind: "none" };
}

/** Steps that can take minutes — only started early in a tick. */
export function isHeavy(step: Step): boolean {
  return step.kind === "listen" || step.kind === "start";
}

/** Where a working edit is, as the page's step list reads it. */
export type Phase = "reading" | "watching" | "cutting" | "done" | "failed" | "uploading";

export function phaseOf(row: Pick<EditRow, "stage" | "clips">): Phase {
  switch (row.stage) {
    case "analyzing":
      return row.clips.some((c) => !c.probe) ? "reading" : "watching";
    case "directing":
    case "bundling":
    case "rendering":
      return "cutting";
    case "done":
      return "done";
    case "failed":
      return "failed";
    default:
      return "uploading";
  }
}

function shortName(name: unknown): string {
  const s = typeof name === "string" ? name.replace(/[\u0000-\u001f]/g, "").trim() : "";
  return (s || "clip").slice(0, 120);
}
