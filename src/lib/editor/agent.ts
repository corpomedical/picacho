// Director's Cut v2: the edit is made by a Claude Managed Agent (Opus 5.5 in
// its own sandbox, HyperFrames skills attached — scripts/directors-cut-setup.mts
// creates it). This file is the only one that talks to it: start a session
// for an edit, read where it stands, collect what it delivered, send a
// change back in. The job runner (advance.ts) calls these once per tick; no
// function ever holds a session's stream.
//
// What the platform proved on 2026-09-25 (a $1-capped probe, $0.12 spent):
// opus-5-5 runs as a managed agent; the sandbox (4 CPU, 16 GB, Node 22,
// ffmpeg) installs hyperframes, fetches its own Chrome, renders; the outputs
// folder refuses symlinks, so the agent renders elsewhere and copies in.

import Anthropic, { toFile } from "@anthropic-ai/sdk";
import { changeMessage, jobMessage } from "./agent-prompt";
import type { Word } from "./transcribe";

const BETAS = ["managed-agents-2026-04-01"] as const;
/** Hard cap per session at list prices, in US cents (the platform's own budget, pre-request gate). */
export const DEFAULT_BUDGET_CENTS = 600;

export type JobClip = {
  index: number;
  name: string;
  seconds: number;
  hasVideo: boolean;
  hasAudio: boolean;
  url: string;
  speech: "speech" | "no-speech" | "silent";
  words: Word[];
};

/**
 * What the editor is doing right now, read from its latest tool call — it
 * works through tools and rarely writes prose between them (seen on the first
 * real v2 session, 2026-09-25), so its words alone left the progress line
 * blank for minutes. A code, so the page can say it in the reader's language.
 */
export type Activity = "skills" | "footage" | "building" | "sound" | "checking" | "looking" | "rendering" | "delivering";

export function activityOf(tool: { name?: string; input?: unknown }): Activity | null {
  const input = (tool.input && typeof tool.input === "object" ? tool.input : {}) as Record<string, unknown>;
  const text = [input.command, input.file_path, input.path, input.pattern].filter((v) => typeof v === "string").join(" ");
  if (/\/mnt\/session\/outputs|result\.json/.test(text)) return "delivering";
  if (/hyperframes\s+render|--quality\s+delivery/.test(text)) return "rendering";
  if (/hyperframes\s+snapshot|contact|\.png\b/.test(text) || (tool.name === "read" && /\.(png|jpe?g|webp)$/i.test(text))) return "looking";
  if (/hyperframes\s+(check|lint|validate)|ffprobe|loudnorm|ebur128/.test(text)) return "checking";
  if (/SKILL\.md|\/skills\//.test(text)) return "skills";
  if (/beatgrid|audio|duck|carve|sfx|\.mp3|\.wav|\.m4a/.test(text)) return "sound";
  if (/footage|clip-\d|scene|showinfo|thumbnail/.test(text)) return "footage";
  if (tool.name === "write" || tool.name === "edit" || /index\.html|compositions\/|hyperframes\s+(add|init)/.test(text)) return "building";
  return null;
}

export type SessionView = {
  status: "rescheduling" | "running" | "idle" | "terminated";
  /** Why it went idle, when it is idle: end_turn = delivered (or gave up) and waiting. */
  stopReason: string | null;
  /** When it last went idle (ms). An idle older than the latest change asked for is the previous turn's. */
  idleAt: number | null;
  /** List cost so far, US dollars, as the platform prices it. */
  costUsd: number;
  /** The agent's latest words, for the progress line. */
  latest: string | null;
  /** What it is doing right now, from its latest tool call. */
  activity: Activity | null;
};

export type Delivered = {
  /** The result.json this delivery was read from — a later turn must bring a different one. */
  resultId: string;
  outputs: { file: string; title: string; summary: string; aspect: string; seconds: number; bytes: Uint8Array }[];
  notes: string;
};

export class AgentError extends Error {}

export function agentConfig(): { agentId: string; environmentId: string } | null {
  const agentId = process.env.DIRECTORS_CUT_AGENT_ID;
  const environmentId = process.env.DIRECTORS_CUT_ENVIRONMENT_ID;
  return agentId && environmentId ? { agentId, environmentId } : null;
}

function budgetCents(): string {
  const n = Number(process.env.DIRECTORS_CUT_BUDGET_CENTS);
  return String(Number.isInteger(n) && n > 0 ? n : DEFAULT_BUDGET_CENTS);
}

/** Start the edit: transcripts mounted as files, footage fetched by the agent from signed URLs. */
export async function startSession(
  job: { editId: string; brief: string; aspectHint: string; lengthHint: number | null; clips: JobClip[] },
  client: Anthropic = new Anthropic(),
): Promise<string> {
  const config = agentConfig();
  if (!config) throw new AgentError("Director's Cut agent is not configured (DIRECTORS_CUT_AGENT_ID / DIRECTORS_CUT_ENVIRONMENT_ID)");
  const resources: { type: "file"; file_id: string; mount_path: string }[] = [];
  const clips: Parameters<typeof jobMessage>[0]["clips"] = [];
  for (const c of job.clips) {
    let transcript: string | null = null;
    if (c.speech === "speech" && c.words.length > 0) {
      const mountPath = `/workspace/job/clip-${c.index}.transcript.json`;
      const body = JSON.stringify({ clip: c.index, name: c.name, words: c.words.map((w) => ({ w: w.text, s: w.start, e: w.end })) });
      const file = await client.beta.files.upload({ file: await toFile(Buffer.from(body), `clip-${c.index}.transcript.json`) });
      resources.push({ type: "file", file_id: file.id, mount_path: mountPath });
      transcript = mountPath;
    }
    clips.push({ index: c.index, name: c.name, seconds: c.seconds, hasVideo: c.hasVideo, hasAudio: c.hasAudio, url: c.url, transcript, speech: c.speech });
  }
  const session = await client.beta.sessions.create({
    agent: config.agentId,
    environment_id: config.environmentId,
    title: `Director's Cut ${job.editId}`,
    metadata: { edit_id: job.editId },
    resources,
    budget: { type: "limit", max_list_cost: { amount: budgetCents(), currency: "USD" } },
    initial_events: [
      {
        type: "user.message",
        content: [{ type: "text", text: jobMessage({ brief: job.brief, aspectHint: job.aspectHint, lengthHint: job.lengthHint, clips }) }],
      },
    ],
  });
  return session.id;
}

export async function readSession(sessionId: string, client: Anthropic = new Anthropic()): Promise<SessionView> {
  const session = await client.beta.sessions.retrieve(sessionId);
  const cents = Number(session.usage?.list_cost?.amount ?? 0);
  let stopReason: string | null = null;
  let idleAt: number | null = null;
  let latest: string | null = null;
  let activity: Activity | null = null;
  const events = await client.beta.sessions.events.list(sessionId, {
    order: "desc",
    limit: 30,
    types: ["session.status_idle", "agent.message", "agent.tool_use"],
  });
  // Newest first: the agent's words count only while nothing has happened since them.
  let acted = false;
  for (const e of events.data) {
    if (e.type === "agent.tool_use") {
      if (activity === null) activity = activityOf(e as { name?: string; input?: unknown });
      acted = true;
    }
    if (e.type === "session.status_idle" && stopReason === null && session.status === "idle") {
      stopReason = (e.stop_reason as { type?: string } | null)?.type ?? null;
      const at = Date.parse(e.processed_at);
      idleAt = Number.isFinite(at) ? at : null;
    }
    if (e.type === "agent.message" && latest === null && !acted) {
      const text = e.content
        .filter((b): b is { type: "text"; text: string } => b.type === "text")
        .map((b) => b.text)
        .join(" ")
        .replace(/\s+/g, " ")
        .trim();
      if (text) latest = text.slice(0, 200);
    }
  }
  return { status: session.status, stopReason, idleAt, costUsd: Number.isFinite(cents) ? cents / 100 : 0, latest, activity };
}

/**
 * What the agent delivered in its latest turn: result.json names the videos;
 * each named file is downloaded. Files from earlier turns are ignored because
 * result.json lists only the newest ones.
 */
export async function collectDelivery(
  sessionId: string,
  opts: { alreadyDelivered?: string | null } = {},
  client: Anthropic = new Anthropic(),
): Promise<Delivered | null> {
  let files: { id: string; filename: string; created_at?: string }[] = [];
  for (let attempt = 0; attempt < 3 && files.length === 0; attempt++) {
    const page = await client.beta.files.list({ scope_id: sessionId, limit: 100, betas: [...BETAS] });
    files = page.data as typeof files;
    if (files.length === 0) await new Promise((r) => setTimeout(r, 2000));
  }
  // The newest result.json wins (each turn writes a fresh one); one already
  // delivered means this turn delivered nothing new.
  const results = files.filter((f) => f.filename === "result.json").sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
  if (results.length === 0 || results[0].id === opts.alreadyDelivered) return null;
  const raw = await (await client.beta.files.download(results[0].id)).text();
  const parsed = parseResult(raw);
  if (!parsed) throw new AgentError("the editor's result.json could not be read");
  const outputs: Delivered["outputs"] = [];
  for (const o of parsed.outputs) {
    const file = files
      .filter((f) => f.filename === o.file)
      .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))[0];
    if (!file) throw new AgentError(`the editor listed ${o.file} but did not deliver it`);
    const bytes = new Uint8Array(await (await client.beta.files.download(file.id)).arrayBuffer());
    outputs.push({ ...o, bytes });
  }
  return { resultId: results[0].id, outputs, notes: parsed.notes };
}

/** result.json → the delivered list. Tolerant of extra fields; strict about what we store. */
export function parseResult(raw: string): { outputs: Omit<Delivered["outputs"][number], "bytes">[]; notes: string } | null {
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return null;
  }
  const b = (body && typeof body === "object" ? body : {}) as { outputs?: unknown; notes?: unknown };
  if (!Array.isArray(b.outputs)) return null;
  const outputs = b.outputs
    .map((o) => (o && typeof o === "object" ? (o as Record<string, unknown>) : {}))
    .filter((o) => typeof o.file === "string" && /^[\w.-]+\.mp4$/.test(o.file as string))
    .slice(0, 10)
    .map((o) => ({
      file: o.file as string,
      title: typeof o.title === "string" ? o.title.slice(0, 120) : "",
      summary: typeof o.summary === "string" ? o.summary.slice(0, 600) : "",
      aspect: o.aspect === "9:16" || o.aspect === "1:1" || o.aspect === "16:9" ? (o.aspect as string) : "16:9",
      seconds: Number.isFinite(Number(o.seconds)) ? Math.max(0, Number(o.seconds)) : 0,
    }));
  if (outputs.length === 0) return null;
  return { outputs, notes: typeof b.notes === "string" ? b.notes.slice(0, 1000) : "" };
}

export async function sendChange(sessionId: string, note: string, client: Anthropic = new Anthropic()): Promise<void> {
  await client.beta.sessions.events.send(sessionId, {
    events: [{ type: "user.message", content: [{ type: "text", text: changeMessage(note) }] }],
  });
}
