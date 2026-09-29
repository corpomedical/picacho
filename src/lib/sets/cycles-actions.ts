"use server";

// Helios Studio · Blender (Cycles) renders on a cloud GPU (2026-09-29,
// operator picked "Real Blender renders"). Three doors, each asking
// setsAccess first and refusing on its answer, then the admin gate
// (HELIOS_CYCLES_FOR_ALL false), the set's owner, and the switch (the
// Modal address and proxy-auth token in the environment):
//
// 1. reserveCyclesScene — a one-time place in storage for the scene file.
//    A scene is often tens of megabytes, past what a request to our own
//    server may carry, so the Studio sends it there itself (as a thing's
//    model is kept, model-actions.ts).
// 2. renderCyclesInSet — checks the job (cycles.ts caps) and the file,
//    signs a read address for the scene and a one-time upload address for
//    the result, and asks the Modal app to start. It answers at once; a
//    render can run far longer than a request may (300 s).
// 3. readCyclesRender — where the render is: starting, frame n of m, done
//    (the file's address), or why it failed.
//
// ONE render per press. The page names each press (a fresh id) and the
// press's first write is a small ticket file under that id, written only if
// none is there: a second delivery of the same press (Chromium resends a
// POST on a dropped connection, generations/repeat-send.ts) finds it, starts
// nothing, and follows the first. No table, no SQL.
//
// Credits: none while this is the team's (cycles.ts HELIOS_CYCLES_CREDITS).

import { createAdminClient } from "@/lib/supabase/server";
import { rateLimited } from "@/lib/rate-limit";
import { mediaUrl } from "@/lib/media/url";
import { fetchWithTimeout } from "@/lib/generations/providers/fetch-with-timeout";
import { setsAccess, UUID_RE } from "@/lib/sets/access";
import { HELIOS_CYCLES_FOR_ALL } from "@/lib/sets/set-config";
import { SET_NOT_FOUND } from "@/lib/sets/messages";
import { glbHeaderOk } from "@/lib/sets/thing-model";
import {
  CYCLES_BUCKET,
  CYCLES_FAILED,
  CYCLES_GLB_MAX_BYTES,
  CYCLES_GONE,
  CYCLES_JOB_MAX_CHARS,
  CYCLES_NOT_A_SCENE,
  CYCLES_NOT_SWITCHED_ON,
  CYCLES_SAVE_FAILED,
  CYCLES_TEAM_ONLY,
  CYCLES_TIMED_OUT,
  CYCLES_TOO_BIG,
  CYCLES_TOO_FAST,
  CYCLES_UNREACHABLE,
  HELIOS_CYCLES_CREDITS,
  cyclesPath,
  cyclesUsd,
  validateCyclesJob,
  type CyclesKind,
} from "@/lib/sets/cycles";

/** How long Modal may take to accept a job, and to say where one is. */
const START_TIMEOUT_MS = 30_000;
const READ_TIMEOUT_MS = 15_000;
/** The scene's read address: long enough for a queued start. */
const SCENE_URL_SECONDS = 3600;
/** Renders a person may start in an hour. */
const RENDERS_PER_HOUR = 20;

type Ticket = { v: 1; kind: CyclesKind; at: number; callId?: string; failed?: string };
type Ok<T> = { error: null } & T;

/** The Modal app's address and proxy-auth token, or null while any is missing. */
function endpoint(): { url: string; headers: Record<string, string> } | null {
  const url = process.env.MODAL_CYCLES_URL?.trim();
  const key = process.env.MODAL_KEY?.trim();
  const secret = process.env.MODAL_SECRET?.trim();
  if (!url || !key || !secret || !/^https:\/\//.test(url)) return null;
  return { url: url.replace(/\/+$/, ""), headers: { "Modal-Key": key, "Modal-Secret": secret } };
}

/** The set is the person's own and not deleted. */
async function ownsSet(userId: string, setId: string): Promise<boolean> {
  const { data } = await createAdminClient()
    .from("location_sets")
    .select("id")
    .eq("id", setId)
    .eq("user_id", userId)
    .is("deleted_at", null)
    .maybeSingle();
  return !!data;
}

/** Everyone but an admin waits for HELIOS_CYCLES_FOR_ALL, and for a price once it opens. */
function teamGate(isAdmin: boolean): string | null {
  if (isAdmin) return null;
  if (!HELIOS_CYCLES_FOR_ALL || HELIOS_CYCLES_CREDITS === null) return CYCLES_TEAM_ONLY;
  return null;
}

const pressOf = (v: unknown): string | null => (typeof v === "string" && UUID_RE.test(v) ? v.toLowerCase() : null);

async function readTicket(path: string): Promise<Ticket | null> {
  const { data, error } = await createAdminClient().storage.from(CYCLES_BUCKET).download(path);
  if (error || !data) return null;
  try {
    const t = JSON.parse(await data.text()) as Ticket;
    return t && t.v === 1 && (t.kind === "still" || t.kind === "animation") ? t : null;
  } catch {
    return null;
  }
}

async function writeTicket(path: string, ticket: Ticket, upsert: boolean): Promise<boolean> {
  const { error } = await createAdminClient()
    .storage.from(CYCLES_BUCKET)
    .upload(path, JSON.stringify(ticket), { contentType: "application/json", upsert });
  return !error;
}

/** Step 1: a one-time place in storage for this press's scene file. */
export async function reserveCyclesScene(
  setId: string,
  input: { pressId: string; size: number },
): Promise<{ error: string } | Ok<{ path: string; token: string }>> {
  const access = await setsAccess();
  if (access.error !== null) return { error: access.error };
  const gate = teamGate(access.isAdmin);
  if (gate) return { error: gate };
  const pressId = pressOf(input?.pressId);
  if (typeof setId !== "string" || !UUID_RE.test(setId) || !pressId) return { error: SET_NOT_FOUND };
  if (!endpoint()) return { error: CYCLES_NOT_SWITCHED_ON };
  const size = typeof input?.size === "number" ? input.size : 0;
  if (!(size > 12)) return { error: CYCLES_NOT_A_SCENE };
  if (size > CYCLES_GLB_MAX_BYTES) return { error: CYCLES_TOO_BIG };
  if (!(await ownsSet(access.userId, setId))) return { error: SET_NOT_FOUND };
  const path = cyclesPath(access.userId, setId, pressId, "glb");
  const { data, error } = await createAdminClient().storage.from(CYCLES_BUCKET).createSignedUploadUrl(path, { upsert: true });
  if (error || !data?.token) return { error: CYCLES_SAVE_FAILED };
  return { error: null, path, token: data.token };
}

/** Step 2: the scene is in storage; check the job and start the render. */
export async function renderCyclesInSet(
  setId: string,
  input: { pressId: string; job: unknown },
): Promise<{ error: string } | Ok<{ state: "started" }>> {
  const access = await setsAccess();
  if (access.error !== null) return { error: access.error };
  const gate = teamGate(access.isAdmin);
  if (gate) return { error: gate };
  const pressId = pressOf(input?.pressId);
  if (typeof setId !== "string" || !UUID_RE.test(setId) || !pressId) return { error: SET_NOT_FOUND };
  const modal = endpoint();
  if (!modal) return { error: CYCLES_NOT_SWITCHED_ON };
  const checked = validateCyclesJob(input?.job);
  if (!checked.ok) return { error: checked.error };
  const job = checked.job;
  if (JSON.stringify(job).length > CYCLES_JOB_MAX_CHARS) return { error: CYCLES_TOO_BIG };
  const userId = access.userId;
  if (!(await ownsSet(userId, setId))) return { error: SET_NOT_FOUND };

  // The press's claim: written only if no delivery of it wrote one first.
  const ticketPath = cyclesPath(userId, setId, pressId, "json");
  const ticket: Ticket = { v: 1, kind: job.kind, at: Date.now() };
  if (!(await writeTicket(ticketPath, ticket, false))) {
    // Already there: this press was delivered before, and that delivery starts it.
    return (await readTicket(ticketPath)) ? { error: null, state: "started" } : { error: CYCLES_SAVE_FAILED };
  }
  const fail = async (error: string) => {
    await writeTicket(ticketPath, { ...ticket, failed: error }, true);
    return { error };
  };
  if (!access.isAdmin && (await rateLimited(userId, "set-cycles", 3600, RENDERS_PER_HOUR))) return fail(CYCLES_TOO_FAST);

  const admin = createAdminClient();
  const scenePath = cyclesPath(userId, setId, pressId, "glb");
  const { data: blob, error: readError } = await admin.storage.from(CYCLES_BUCKET).download(scenePath);
  if (readError || !blob) return fail(CYCLES_NOT_A_SCENE);
  if (blob.size > CYCLES_GLB_MAX_BYTES) return fail(CYCLES_TOO_BIG);
  if (!glbHeaderOk(new Uint8Array(await blob.slice(0, 12).arrayBuffer()), blob.size)) return fail(CYCLES_NOT_A_SCENE);
  const { data: sceneUrl } = await admin.storage.from(CYCLES_BUCKET).createSignedUrl(scenePath, SCENE_URL_SECONDS);
  const ext = job.kind === "still" ? "png" : "mp4";
  const { data: upload } = await admin.storage.from(CYCLES_BUCKET).createSignedUploadUrl(cyclesPath(userId, setId, pressId, ext), { upsert: true });
  if (!sceneUrl?.signedUrl || !upload?.signedUrl) return fail(CYCLES_SAVE_FAILED);

  let callId: string | null = null;
  try {
    const res = await fetchWithTimeout(
      `${modal.url}/render`,
      {
        method: "POST",
        headers: { ...modal.headers, "content-type": "application/json" },
        body: JSON.stringify({
          job,
          glb_url: sceneUrl.signedUrl,
          upload_url: upload.signedUrl,
          content_type: ext === "png" ? "image/png" : "video/mp4",
        }),
      },
      START_TIMEOUT_MS,
    );
    if (res.ok) {
      const body = (await res.json()) as { call_id?: unknown };
      if (typeof body.call_id === "string" && /^[\w-]{4,128}$/.test(body.call_id)) callId = body.call_id;
    } else {
      console.warn("[sets] Blender render not started:", res.status, (await res.text()).slice(0, 300));
    }
  } catch (e) {
    console.warn("[sets] Blender render endpoint unreachable:", e instanceof Error ? e.message : e);
  }
  if (!callId) return fail(CYCLES_UNREACHABLE);
  if (!(await writeTicket(ticketPath, { ...ticket, callId }, true))) {
    // Started, but the ticket didn't take the call's id: the read can't follow it.
    console.warn("[sets] Blender render started but its ticket wasn't updated:", pressId);
    return { error: CYCLES_SAVE_FAILED };
  }
  return { error: null, state: "started" };
}

export type CyclesRenderState =
  | { error: string }
  | Ok<{ state: "working"; done: number; total: number }>
  | Ok<{ state: "done"; kind: CyclesKind; url: string; seconds: number; renderSeconds: number; usd: number; device: string; credits: 0 }>;

/** Step 3: where the press's render is. */
export async function readCyclesRender(setId: string, input: { pressId: string }): Promise<CyclesRenderState> {
  const access = await setsAccess();
  if (access.error !== null) return { error: access.error };
  const gate = teamGate(access.isAdmin);
  if (gate) return { error: gate };
  const pressId = pressOf(input?.pressId);
  if (typeof setId !== "string" || !UUID_RE.test(setId) || !pressId) return { error: SET_NOT_FOUND };
  const modal = endpoint();
  if (!modal) return { error: CYCLES_NOT_SWITCHED_ON };
  const userId = access.userId;
  if (!(await ownsSet(userId, setId))) return { error: SET_NOT_FOUND };
  const ticket = await readTicket(cyclesPath(userId, setId, pressId, "json"));
  if (!ticket) return { error: CYCLES_GONE };
  if (ticket.failed) return { error: ticket.failed };
  // Claimed, and the first delivery is still asking Modal to start — or it
  // was cut off before it could say: past the start's own time, it didn't.
  if (!ticket.callId) {
    return Date.now() - ticket.at > START_TIMEOUT_MS + 90_000 ? { error: CYCLES_UNREACHABLE } : { error: null, state: "working", done: 0, total: 0 };
  }

  let body: { state?: string; done?: number; total?: number; error?: string; seconds?: number; render_seconds?: number; device?: string };
  try {
    const res = await fetchWithTimeout(`${modal.url}/result/${encodeURIComponent(ticket.callId)}`, { headers: modal.headers }, READ_TIMEOUT_MS);
    if (!res.ok) return { error: null, state: "working", done: 0, total: 0 };
    body = (await res.json()) as typeof body;
  } catch {
    // A missed read is not a failure: the next one asks again.
    return { error: null, state: "working", done: 0, total: 0 };
  }
  const admin = createAdminClient();
  const clearScene = () => admin.storage.from(CYCLES_BUCKET).remove([cyclesPath(userId, setId, pressId, "glb")]);
  if (body.state === "running") {
    const n = (v: unknown) => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? Math.floor(v) : 0);
    return { error: null, state: "working", done: n(body.done), total: n(body.total) };
  }
  if (body.state === "expired") return { error: CYCLES_GONE };
  if (body.state !== "done") {
    await clearScene();
    const why = body.state === "timeout" ? CYCLES_TIMED_OUT : `${CYCLES_FAILED}${typeof body.error === "string" && body.error ? ` ${body.error.slice(0, 300)}` : ""}`;
    return { error: why };
  }
  await clearScene();
  const seconds = typeof body.seconds === "number" && body.seconds > 0 ? body.seconds : 0;
  const renderSeconds = typeof body.render_seconds === "number" && body.render_seconds > 0 ? body.render_seconds : seconds;
  const ext = ticket.kind === "still" ? "png" : "mp4";
  return {
    error: null,
    state: "done",
    kind: ticket.kind,
    url: mediaUrl(CYCLES_BUCKET, cyclesPath(userId, setId, pressId, ext)),
    seconds,
    renderSeconds,
    usd: cyclesUsd(seconds),
    device: typeof body.device === "string" ? body.device.slice(0, 20) : "",
    credits: 0,
  };
}
