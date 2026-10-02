// Clippings' engine: what the tab shows, a read of the person's own posts,
// an upload of a video they made, and the evidence an ad is planned on.
// Every entry takes its providers as dependencies (runtime.ts wires the real
// ones); the decisions that need no database are exported and tested.
//
// A READ (startRead → runRead, in after()):
//   1. each network whose switch is on and whose account is connected WITH
//      the reading permission: the newest POSTS_PER_NETWORK videos and their
//      counts, upserted by (person, network, post id);
//   2. a post Press Tour published (scheduled_posts, stage published) is
//      marked as that ad, and its words are the plan's on-screen lines;
//   3. words, once per video, within WORDS_PER_DAY and the time budget:
//      Instagram's file or an upload → Whisper → Luna (label.ts script);
//      an upload's file is removed once read, its cover frame kept;
//   4. the summary: every clip of this person → a format and a sentence;
//   5. what is left for later stays "pending": the door continues the read
//      on its own, and that continuation is not counted against the day.
//
// Alias-free (vitest has no '@/').

import type { SupabaseClient } from "@supabase/supabase-js";
import type { ConnectionRecord } from "../social/store";
import type { ClippingsSwitches } from "./enabled";
import { linesFromAnswer, scriptRequest, summaryFromAnswer, summaryRequest, type LunaAnswer, type SummaryClip } from "./label";
import type { NetworkVideo, ReadOutcome } from "./network-read";
import { INSTAGRAM_READ_SCOPE, TIKTOK_READ_SCOPE } from "./scopes";
import { usualViews } from "./stats";
import {
  CLIP_UPLOAD_BUCKET,
  POSTS_PER_NETWORK,
  READS_PER_DAY,
  RUN_STALE_MS,
  UPLOADS_PER_DAY,
  UPLOAD_MAX_BYTES,
  UPLOAD_TYPES,
  WORDS_PER_DAY,
  isWordsState,
  linesFrom,
  oneLine,
  parseClipId,
  type ClipError,
  type ClipFail,
  type ClipLine,
  type ClipNetwork,
  type ClipRunView,
  type ClipSource,
  type ClipView,
  type ClippingsHome,
  type SourceState,
  type WordsState,
} from "./types";
import type { WordsResult } from "./words";

export const PRESS_KIT_BUCKET = "press-kit";
/** A read stops starting new videos after this long (the route allows 300 s). */
export const READ_BUDGET_MS = 230_000;
const WORDS_AT_ONCE = 3;

export type ClipDeps = {
  /** The service role: every read and write here. */
  db: SupabaseClient;
  now(): Date;
  switches(): Promise<ClippingsSwitches>;
  connections(userId: string): Promise<ConnectionRecord[]>;
  /** The account's access key, refreshed if it needs to be. */
  token(conn: ConnectionRecord): Promise<{ ok: true; token: string } | { ok: false; reason: "reconnect" | "unavailable" }>;
  readNetwork(network: ClipNetwork, token: string, max: number): Promise<ReadOutcome>;
  readWords(source: { url: string } | { bytes: Buffer }, cover: boolean): Promise<WordsResult>;
  luna(request: object): Promise<LunaAnswer>;
  rateLimited(userId: string, scope: string, windowSeconds: number, max: number): Promise<boolean>;
  /** Runs after the answer is sent (next/server after). */
  later(job: () => Promise<void>): void;
};

const fail = (error: ClipError): ClipFail => ({ ok: false, error });

// ---------------------------------------------------------------------
// Pure decisions
// ---------------------------------------------------------------------

/** Whether an account was connected with the permission Clippings reads with. */
export function hasReadScope(network: ClipNetwork, scopes: readonly string[]): boolean {
  const want = network === "instagram" ? INSTAGRAM_READ_SCOPE : TIKTOK_READ_SCOPE;
  return scopes.some((s) => s.split(/[,\s]+/).includes(want));
}

export function sourceState(open: boolean, conn: Pick<ConnectionRecord, "status" | "scopes" | "network"> | null): SourceState {
  if (!open) return "closed";
  if (!conn) return "connect";
  if (conn.status === "needs_reconnect" || !hasReadScope(conn.network as ClipNetwork, conn.scopes)) return "reconnect";
  return "connected";
}

/** What a post's words become when it is read again from its network. */
export function nextWordsState(network: ClipNetwork, previous: WordsState | null, hasFile: boolean): WordsState {
  if (network === "tiktok") return previous === "read" ? "read" : "views_only";
  if (previous === "read" || previous === "none" || previous === "too_long") return previous;
  return hasFile ? "pending" : "no_file";
}

/** A Press Tour ad's script: each planned shot's words at its start. */
export function planLines(plan: unknown): ClipLine[] {
  const shots = plan && typeof plan === "object" ? (plan as Record<string, unknown>).shots : null;
  if (!Array.isArray(shots)) return [];
  const out: ClipLine[] = [];
  for (const s of shots) {
    if (!s || typeof s !== "object") continue;
    const o = s as Record<string, unknown>;
    const role = o.role === "hook" ? "hook" : o.role === "costar" ? "costar" : o.role === "line" ? "line" : null;
    const span = Array.isArray(o.span) && typeof o.span[0] === "number" ? o.span[0] : null;
    const said = oneLine(o.onScreenText, 200) ?? oneLine(o.caption, 200) ?? oneLine(o.direction, 200);
    if (!role || span === null || !said) continue;
    out.push({ t: Math.max(0, Math.round(span)), part: role, said });
  }
  return out.sort((a, b) => a.t - b.t);
}

/** How many words a person may still have read today. */
export function wordsLeft(readToday: number): number {
  return Math.max(0, WORDS_PER_DAY - Math.max(0, readToday));
}

export function cleanViews(v: unknown): number | null | undefined {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v.replace(/[\s,.]/g, "")) : NaN;
  if (!Number.isFinite(n) || n < 0 || n > 1e11 || Math.round(n) !== n) return undefined;
  return n;
}

export function cleanPostedAt(v: unknown, now: Date): string | null | undefined {
  if (v === null || v === undefined || v === "") return null;
  if (typeof v !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return undefined;
  const t = Date.parse(`${v}T12:00:00Z`);
  if (!Number.isFinite(t) || t > now.getTime() + 86_400_000 || t < Date.parse("2005-01-01")) return undefined;
  return new Date(t).toISOString();
}

// ---------------------------------------------------------------------
// Rows
// ---------------------------------------------------------------------

type ClipRow = {
  id: string;
  source: ClipSource;
  connection_id: string | null;
  external_id: string | null;
  campaign_id: string | null;
  posted_at: string | null;
  permalink: string | null;
  thumb_url: string | null;
  thumb_path: string | null;
  caption: string | null;
  duration_s: number | string | null;
  views: number | string | null;
  words_state: string;
  lines: unknown;
  format: string | null;
  why: string | null;
};

const CLIP_COLUMNS = "id, source, connection_id, external_id, campaign_id, posted_at, permalink, thumb_url, thumb_path, caption, duration_s, views, words_state, lines, format, why";

const numOrNull = (v: unknown): number | null => {
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN;
  return Number.isFinite(n) ? n : null;
};

function viewOf(r: ClipRow, thumbs: ReadonlyMap<string, string>): ClipView {
  return {
    id: r.id,
    source: r.source,
    pressTour: r.campaign_id !== null,
    postedAt: r.posted_at,
    permalink: r.permalink,
    thumbUrl: r.thumb_path ? (thumbs.get(r.thumb_path) ?? null) : r.thumb_url,
    durationS: numOrNull(r.duration_s),
    views: numOrNull(r.views),
    wordsState: isWordsState(r.words_state) ? r.words_state : "pending",
    lines: linesFrom(r.lines),
    format: r.format,
    why: r.why,
  };
}

async function clipRows(db: SupabaseClient, userId: string): Promise<ClipRow[]> {
  const { data, error } = await db.from("press_clips").select(CLIP_COLUMNS).eq("user_id", userId).order("posted_at", { ascending: false, nullsFirst: false }).limit(400);
  if (error || !Array.isArray(data)) throw new Error("clips unreadable");
  return data as ClipRow[];
}

function runView(row: Record<string, unknown> | null, now: Date): ClipRunView {
  const started = typeof row?.started_at === "string" ? row.started_at : null;
  const stale = started !== null && now.getTime() - Date.parse(started) > RUN_STALE_MS;
  const reading = row?.state === "reading" && !stale;
  const err = typeof row?.error === "string" ? row.error : null;
  return {
    state: reading ? "reading" : "idle",
    startedAt: started,
    finishedAt: typeof row?.finished_at === "string" ? row.finished_at : null,
    done: typeof row?.done === "number" ? row.done : 0,
    total: typeof row?.total === "number" ? row.total : 0,
    error: err === "unavailable" || err === "limit" ? err : null,
  };
}

// ---------------------------------------------------------------------
// What the tab shows
// ---------------------------------------------------------------------

export async function clippingsHome(deps: Pick<ClipDeps, "db" | "now" | "connections">, userId: string, input: { switches: ClippingsSwitches; webOnly: boolean }): Promise<ClippingsHome> {
  const [rows, run, conns] = await Promise.all([
    clipRows(deps.db, userId).catch(() => [] as ClipRow[]),
    deps.db.from("press_clip_runs").select("state, started_at, finished_at, done, total, error").eq("user_id", userId).maybeSingle().then(
      (r) => (r.data as Record<string, unknown> | null) ?? null,
      () => null,
    ),
    deps.connections(userId).catch(() => [] as ConnectionRecord[]),
  ]);
  const paths = rows.map((r) => r.thumb_path).filter((p): p is string => Boolean(p));
  const thumbs = new Map<string, string>();
  if (paths.length > 0) {
    try {
      const { data } = await deps.db.storage.from(PRESS_KIT_BUCKET).createSignedUrls(paths, 60 * 60);
      for (const s of data ?? []) if (s.path && s.signedUrl) thumbs.set(s.path, s.signedUrl);
    } catch {
      // tiles fall back to their tint
    }
  }
  const clips = rows.map((r) => viewOf(r, thumbs));
  const source = (network: ClipNetwork) => {
    const conn = conns.find((c) => c.network === network) ?? null;
    return {
      state: sourceState(network === "instagram" ? input.switches.instagram : input.switches.tiktok, conn),
      handle: conn?.handle ?? null,
      posts: rows.filter((r) => r.source === network).length,
    };
  };
  return {
    clips,
    run: runView(run, deps.now()),
    sources: { instagram: source("instagram"), tiktok: source("tiktok") },
    uploads: rows.filter((r) => r.source === "upload").length,
    pressTourAds: rows.filter((r) => r.campaign_id !== null).length,
    webOnly: input.webOnly,
  };
}

// ---------------------------------------------------------------------
// Starting a read
// ---------------------------------------------------------------------

async function hasPending(db: SupabaseClient, userId: string): Promise<boolean> {
  const { count } = await db.from("press_clips").select("id", { count: "exact", head: true }).eq("user_id", userId).in("words_state", ["pending", "failed"]);
  return (count ?? 0) > 0;
}

/**
 * Read the person's posts again (or carry on with one that ran out of time:
 * `carryOn`, free while words are still pending). Answers at once; the read
 * runs after the answer.
 */
export async function startRead(deps: ClipDeps, userId: string, input: { locale: string; carryOn?: boolean }): Promise<{ ok: true } | ClipFail> {
  const sw = await deps.switches();
  if (!sw.on) return fail("closed");
  const now = deps.now();
  const { data: run } = await deps.db.from("press_clip_runs").select("state, started_at").eq("user_id", userId).maybeSingle();
  if (runView(run as Record<string, unknown> | null, now).state === "reading") return { ok: true };
  if (input.carryOn) {
    if (!(await hasPending(deps.db, userId).catch(() => false))) return fail("nothing_to_read");
  } else if (await deps.rateLimited(userId, "press-clippings-read", 24 * 60 * 60, READS_PER_DAY)) {
    return fail("limit");
  }
  const { error } = await deps.db
    .from("press_clip_runs")
    .upsert({ user_id: userId, state: "reading", started_at: now.toISOString(), finished_at: null, done: 0, total: 0, error: null }, { onConflict: "user_id" });
  if (error) return fail("unavailable");
  const locale = ["en", "es", "pt", "it"].includes(input.locale) ? input.locale : "en";
  deps.later(() => runRead(deps, userId, locale));
  return { ok: true };
}

// ---------------------------------------------------------------------
// The read itself
// ---------------------------------------------------------------------

type Progress = { done: number; total: number; cost: number; trouble: boolean; capped: boolean };

async function saveProgress(db: SupabaseClient, userId: string, p: Progress): Promise<void> {
  await db.from("press_clip_runs").update({ done: Math.min(1000, p.done), total: Math.min(1000, p.total) }).eq("user_id", userId);
}

/** Step 1: one network's posts and counts into press_clips. Answers the file links this read can use. */
async function readNetwork(deps: ClipDeps, userId: string, conn: ConnectionRecord, network: ClipNetwork, p: Progress): Promise<Map<string, string>> {
  const files = new Map<string, string>();
  const key = await deps.token(conn);
  if (!key.ok) {
    if (key.reason === "unavailable") p.trouble = true;
    return files;
  }
  const read = await deps.readNetwork(network, key.token, POSTS_PER_NETWORK);
  if (!read.ok) {
    if (read.reason === "unavailable") p.trouble = true;
    return files;
  }
  const ids = read.videos.map((v) => v.externalId);
  const { data: known } = ids.length
    ? await deps.db.from("press_clips").select("id, external_id, words_state").eq("user_id", userId).eq("source", network).in("external_id", ids)
    : { data: [] };
  const before = new Map((known ?? []).map((k: { external_id: string; words_state: string }) => [k.external_id, k.words_state]));
  const rows = read.videos.map((v: NetworkVideo) => {
    if (v.mediaUrl) files.set(v.externalId, v.mediaUrl);
    const prev = before.get(v.externalId);
    const row: Record<string, unknown> = {
      user_id: userId,
      source: network,
      connection_id: conn.id,
      external_id: v.externalId,
      posted_at: v.postedAt,
      permalink: v.permalink,
      thumb_url: v.thumbUrl,
      caption: v.caption,
      views: v.views,
      likes: v.likes,
      comments: v.comments,
      words_state: nextWordsState(network, isWordsState(prev) ? prev : null, Boolean(v.mediaUrl)),
    };
    if (v.durationS !== null) row.duration_s = v.durationS;
    return row;
  });
  if (rows.length) await deps.db.from("press_clips").upsert(rows, { onConflict: "user_id,source,external_id" });
  return files;
}

/** Step 2: the posts Press Tour published, marked as their ad, with the plan's words. */
async function markPressTourAds(db: SupabaseClient, userId: string): Promise<void> {
  const { data: posts } = await db
    .from("scheduled_posts")
    .select("campaign_id, network, external_post_id")
    .eq("user_id", userId)
    .eq("stage", "published")
    .in("network", ["instagram", "tiktok"])
    .not("external_post_id", "is", null)
    .not("campaign_id", "is", null)
    .limit(200);
  const list = (posts ?? []) as { campaign_id: string; network: ClipNetwork; external_post_id: string }[];
  if (list.length === 0) return;
  const { data: plans } = await db.from("press_campaigns").select("id, plan").eq("user_id", userId).in("id", [...new Set(list.map((p) => p.campaign_id))]);
  const planOf = new Map(((plans ?? []) as { id: string; plan: unknown }[]).map((c) => [c.id, c.plan]));
  for (const p of list) {
    const lines = planLines(planOf.get(p.campaign_id));
    const patch: Record<string, unknown> = { campaign_id: p.campaign_id };
    if (lines.length) Object.assign(patch, { lines, words_state: "read" });
    await db.from("press_clips").update(patch).eq("user_id", userId).eq("source", p.network).eq("external_id", p.external_post_id);
  }
}

async function readOne(deps: ClipDeps, userId: string, row: ClipRow, files: ReadonlyMap<string, string>, p: Progress): Promise<void> {
  let result: WordsResult;
  let uploadPath: string | null = null;
  if (row.source === "upload") {
    uploadPath = `${userId}/${row.id}/video`;
    const { data, error } = await deps.db.storage.from(CLIP_UPLOAD_BUCKET).download(uploadPath);
    if (error || !data) {
      await deps.db.from("press_clips").update({ words_state: "failed" }).eq("id", row.id).eq("user_id", userId);
      return;
    }
    result = await deps.readWords({ bytes: Buffer.from(await data.arrayBuffer()) }, true);
  } else {
    const url = row.external_id ? files.get(row.external_id) : undefined;
    if (!url) return; // its link wasn't given this time: left pending
    result = await deps.readWords({ url }, false);
  }

  const patch: Record<string, unknown> = { read_at: deps.now().toISOString() };
  if (result.durationS !== null) patch.duration_s = Math.round(result.durationS * 10) / 10;
  let cost = 0;
  if (result.kind === "read") {
    cost += result.costUsd;
    const answer = await deps.luna(scriptRequest({ segments: result.segments, caption: row.caption, durationS: result.durationS }));
    cost += answer.costUsd;
    const lines = answer.ok ? linesFromAnswer(answer.json, result.durationS) : [];
    if (answer.ok) Object.assign(patch, { lines, words_state: lines.length ? "read" : "none" });
    else patch.words_state = "failed";
  } else if (result.kind === "none") {
    cost += result.costUsd;
    Object.assign(patch, { lines: [], words_state: "none" });
  } else {
    patch.words_state = result.kind;
  }
  if (row.source === "upload" && result.cover) {
    const coverPath = `${userId}/clippings/${row.id}.jpg`;
    const up = await deps.db.storage.from(PRESS_KIT_BUCKET).upload(coverPath, result.cover, { contentType: "image/jpeg", upsert: true });
    if (!up.error) patch.thumb_path = coverPath;
  }
  patch.cost_usd = Math.round(cost * 1e6) / 1e6;
  await deps.db.from("press_clips").update(patch).eq("id", row.id).eq("user_id", userId);
  // The person's file is not kept once its words are read (a failure keeps it for the next try).
  if (uploadPath && patch.words_state !== "failed") await deps.db.storage.from(CLIP_UPLOAD_BUCKET).remove([uploadPath]);
  p.cost += cost;
}

/** Steps 3–5. Never throws; the run row always ends idle. */
export async function runRead(deps: ClipDeps, userId: string, locale: string): Promise<void> {
  const started = deps.now().getTime();
  const p: Progress = { done: 0, total: 0, cost: 0, trouble: false, capped: false };
  try {
    const sw = await deps.switches();
    if (!sw.on) return;
    const conns = await deps.connections(userId).catch(() => [] as ConnectionRecord[]);
    const files = new Map<string, string>();
    for (const network of ["instagram", "tiktok"] as const) {
      const open = network === "instagram" ? sw.instagram : sw.tiktok;
      const conn = conns.find((c) => c.network === network) ?? null;
      if (sourceState(open, conn) !== "connected") continue;
      for (const [k, v] of await readNetwork(deps, userId, conn!, network, p)) files.set(k, v);
    }
    await markPressTourAds(deps.db, userId).catch(() => undefined);

    // Words, within the day's allowance and the time budget.
    const dayAgo = new Date(deps.now().getTime() - 86_400_000).toISOString();
    const { count: readToday } = await deps.db.from("press_clips").select("id", { count: "exact", head: true }).eq("user_id", userId).gte("read_at", dayAgo);
    let allowance = wordsLeft(readToday ?? 0);
    const rows = await clipRows(deps.db, userId);
    const waiting = rows.filter(
      (r) => (r.words_state === "pending" || r.words_state === "failed") && (r.source === "upload" || (r.external_id !== null && files.has(r.external_id))),
    );
    p.total = Math.min(waiting.length, allowance);
    // More waiting than today allows: the rest is read tomorrow (the door does not carry on).
    p.capped = waiting.length > allowance;
    await saveProgress(deps.db, userId, p);
    const queue = waiting.slice(0, allowance);
    const worker = async () => {
      while (queue.length > 0 && deps.now().getTime() - started < READ_BUDGET_MS) {
        const row = queue.shift()!;
        allowance--;
        await readOne(deps, userId, row, files, p).catch(() => undefined);
        p.done++;
        await saveProgress(deps.db, userId, p).catch(() => undefined);
      }
    };
    await Promise.all(Array.from({ length: WORDS_AT_ONCE }, worker));

    // The summary: every clip of this person, at once.
    const all = await clipRows(deps.db, userId);
    if (all.length > 0) {
      const views = all.map((r) => viewOf(r, new Map()));
      const usual = usualViews(views);
      const clips: SummaryClip[] = views.slice(0, 120).map((c, i) => ({
        views: c.views,
        durationS: c.durationS,
        caption: all[i].caption,
        lines: c.lines,
        pressTour: c.pressTour,
      }));
      const answer = await deps.luna(summaryRequest({ clips, usual, locale }));
      p.cost += answer.costUsd;
      if (answer.ok) {
        const got = summaryFromAnswer(answer.json, clips.length);
        for (const [i, s] of got) {
          await deps.db.from("press_clips").update({ format: s.format, why: s.why }).eq("id", all[i].id).eq("user_id", userId);
        }
      } else p.trouble = true;
    }
  } catch {
    p.trouble = true;
  } finally {
    const { data: prev } = await deps.db.from("press_clip_runs").select("cost_usd").eq("user_id", userId).maybeSingle().then(
      (r) => r,
      () => ({ data: null }),
    );
    const before = numOrNull((prev as { cost_usd?: unknown } | null)?.cost_usd) ?? 0;
    await deps.db
      .from("press_clip_runs")
      .update({
        state: "idle",
        finished_at: deps.now().toISOString(),
        done: Math.min(1000, p.done),
        total: Math.min(1000, p.total),
        error: p.capped ? "limit" : p.trouble ? "unavailable" : null,
        cost_usd: Math.round((before + p.cost) * 1e6) / 1e6,
      })
      .eq("user_id", userId)
      .then(
        () => undefined,
        () => undefined,
      );
  }
}

// ---------------------------------------------------------------------
// A video the person made
// ---------------------------------------------------------------------

export type UploadPlace = { ok: true; clipId: string; bucket: string; path: string; token: string };

export async function reserveUpload(deps: ClipDeps, userId: string, input: { type: unknown; size: unknown; clipId: unknown }): Promise<UploadPlace | ClipFail> {
  if (!(await deps.switches()).on) return fail("closed");
  const clipId = parseClipId(input.clipId);
  if (!clipId || typeof input.type !== "string" || !(UPLOAD_TYPES as readonly string[]).includes(input.type)) return fail("bad_file");
  if (typeof input.size !== "number" || !(input.size > 0)) return fail("bad_file");
  if (input.size > UPLOAD_MAX_BYTES) return fail("too_big");
  if (await deps.rateLimited(userId, "press-clippings-upload", 24 * 60 * 60, UPLOADS_PER_DAY)) return fail("limit");
  const path = `${userId}/${clipId}/video`;
  const { data, error } = await deps.db.storage.from(CLIP_UPLOAD_BUCKET).createSignedUploadUrl(path, { upsert: true });
  if (error || !data?.token) return fail("unavailable");
  return { ok: true, clipId, bucket: CLIP_UPLOAD_BUCKET, path, token: data.token };
}

/** The upload arrived: its row, then a read of its words (not counted against the day's reads). */
export async function finishUpload(
  deps: ClipDeps,
  userId: string,
  input: { clipId: unknown; views: unknown; postedAt: unknown; attest: unknown; locale: string },
): Promise<{ ok: true } | ClipFail> {
  if (!(await deps.switches()).on) return fail("closed");
  const clipId = parseClipId(input.clipId);
  if (!clipId) return fail("bad_file");
  if (input.attest !== true) return fail("attest");
  const views = cleanViews(input.views);
  const postedAt = cleanPostedAt(input.postedAt, deps.now());
  if (views === undefined || postedAt === undefined) return fail("bad_views");
  const { data: listed } = await deps.db.storage.from(CLIP_UPLOAD_BUCKET).list(`${userId}/${clipId}`, { limit: 5 });
  if (!(listed ?? []).some((f: { name: string }) => f.name === "video")) return fail("not_found");
  const { error } = await deps.db.from("press_clips").upsert(
    { id: clipId, user_id: userId, source: "upload", connection_id: null, external_id: null, views, posted_at: postedAt ?? deps.now().toISOString(), words_state: "pending" },
    { onConflict: "id" },
  );
  if (error) return fail("unavailable");
  // Its words are read right away; a read already running picks it up next time round.
  await startRead(deps, userId, { locale: input.locale, carryOn: true });
  return { ok: true };
}

/** Remove a video the person added (posts read from an account leave when it is disconnected). */
export async function removeUpload(deps: ClipDeps, userId: string, input: { clipId: unknown }): Promise<{ ok: true } | ClipFail> {
  const clipId = parseClipId(input.clipId);
  if (!clipId) return fail("not_found");
  const { data } = await deps.db.from("press_clips").select("id, source, thumb_path").eq("id", clipId).eq("user_id", userId).maybeSingle();
  const row = data as { id: string; source: string; thumb_path: string | null } | null;
  if (!row || row.source !== "upload") return fail("not_found");
  await deps.db.storage.from(CLIP_UPLOAD_BUCKET).remove([`${userId}/${clipId}/video`]).then(
    () => undefined,
    () => undefined,
  );
  if (row.thumb_path) await deps.db.storage.from(PRESS_KIT_BUCKET).remove([row.thumb_path]).then(
    () => undefined,
    () => undefined,
  );
  const { error } = await deps.db.from("press_clips").delete().eq("id", clipId).eq("user_id", userId);
  return error ? fail("unavailable") : { ok: true };
}

// ---------------------------------------------------------------------
// The evidence an ad is planned on ("Plan an ad like this")
// ---------------------------------------------------------------------

export type ClipEvidence = { format: string | null; times: number | null; lines: ClipLine[] };

/** One of the person's OWN clips, as the planner reads it; null when it isn't theirs or has no words. */
export async function clipEvidence(db: SupabaseClient, userId: string, clipId: string): Promise<ClipEvidence | null> {
  const id = parseClipId(clipId);
  if (!id) return null;
  const rows = await clipRows(db, userId).catch(() => [] as ClipRow[]);
  const row = rows.find((r) => r.id === id);
  if (!row) return null;
  const lines = linesFrom(row.lines);
  if (lines.length === 0) return null;
  const usual = usualViews(rows.map((r) => viewOf(r, new Map())));
  const views = numOrNull(row.views);
  return { format: row.format, times: views !== null && usual ? views / usual : null, lines };
}
