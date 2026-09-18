"use server";

import { revalidatePath } from "next/cache";
import { createAdminClient, createClient } from "@/lib/supabase/server";
import { rateLimited } from "@/lib/rate-limit";
import { ContentPolicyRefusal, type Scores } from "@/lib/generations/content-policy";
import { checkGenerationAllowance, consumePurchasedCredits } from "@/lib/generations/core";
import { refundGenerationCosts, saveVideoJob } from "@/lib/generations/job-runner";
import { judgeRender, OutputPolicyRefusal } from "@/lib/generations/output-policy";
import { gatePrompt, recentRefusalCount, recordPolicyRefusal } from "@/lib/generations/policy-log";
import { cancelQueuedJob, submitRecastJob, type QueuedJob } from "@/lib/generations/providers/fal";
import { providerDownloadUrl } from "@/lib/generations/providers/provider-url";
import { SESSION_EXPIRED_MESSAGE } from "@/lib/generations/user-facing-error";
import { probeMp4 } from "@/lib/media/mp4-probe";
import { isRenderableUrl, toMediaUrl } from "@/lib/media/url";
import { isRecastEnabled, isRecastLockOn } from "@/lib/recast/enabled";
import {
  RECAST_ALREADY_STARTED,
  RECAST_CHARACTER_NEEDS_PHOTO,
  RECAST_CLIP_TOO_BIG,
  RECAST_CLIP_UNCHECKED,
  RECAST_COULDNT_START,
  RECAST_JOB_TOO_LONG,
  RECAST_NEEDS_CAST,
  RECAST_NEEDS_DATABASE,
  RECAST_NEEDS_RIGHTS,
  RECAST_NOT_A_VIDEO,
  RECAST_NOT_OPEN,
  RECAST_REFUSED_BRIEF,
  RECAST_TOO_FAST,
  RECAST_TRIM_FAILED,
  RECAST_WINDOW_INVALID,
  RECAST_UNAVAILABLE,
  RECAST_UPLOAD_UNREADABLE,
  recastClipProblemMessage,
} from "@/lib/recast/messages";
import {
  parseRecastEngine,
  parseRecastSourcePath,
  RECAST_BUCKET,
  RECAST_ENGINE_ORDER,
  RECAST_ENGINES,
  RECAST_MAX_BYTES,
  RECAST_MODEL_IDS,
  recastClipProblem,
  recastContainerOf,
  recastCreditCost,
  recastEngineFits,
  recastNeedsCharacter,
  recastSourcePath,
  type RecastClip,
  type RecastContainer,
  type RecastEngine,
} from "@/lib/recast/recast";
import { composeRecastBrief, RECAST_DIRECTION_MAX_CHARS, type RecastCasting } from "@/lib/recast/recast-brief";
import {
  askRecastRead,
  parseRecastRead,
  RECAST_FRAMES_MIN,
  RECAST_FRAME_COUNT,
  reboundRecastRead,
  recastReadInstructions,
  recastSampleTimes,
  recastWarnings,
  type RecastKeep,
  type RecastRead,
  type RecastWarning,
} from "@/lib/recast/recast-read";
import { RECAST_LOCK_THRESHOLD, readRecastRecipes, recastRow, type RecastSource } from "@/lib/recast/store";
import { cutsInWindow, isWholeClip, recastWindowCredits, recastWindowProblem, type RecastWindow } from "@/lib/recast/trim";
import { cutRecastWindow } from "@/lib/recast/trim-run";

// Recast — "Mystique" on the door (working title, 2026-09-17).
//
// A clip of someone performing goes in; the same performance comes out with
// a saved character in their place. Cut 2 (2026-09-18) is the answer to
// "nothing like the features of Genjutsu": the clip is READ before anything
// is spent, the performance can come from the motion library instead of a
// file, several characters can be cast in one press, the brief is composed
// and shown, and the face is judged end to end.
//
// THE ORDER a take is taken in, and why:
//
//   reserve a path (a CLIP id is minted here; several takes can stand on one
//   clip, which is what variants are) -> the browser uploads straight to
//   storage AND samples frames -> inspect: the file is read for the real
//   numbers, the frames are read for what is in the clip, every engine is
//   quoted -> start: rights ticked -> the file read AGAIN (the money path
//   reads the file, never the form and never the inspect's answer) -> the
//   characters are the caller's own -> the brief gated as text -> THE CLIP
//   JUDGED (its middle frame, the strict lane) before anything is spent ->
//   allowance for ALL the variants at once -> reserve the rows -> guarded
//   spend -> submit each -> record each.
//
// FROM THE JOB ROW ON, A RECAST IS AN ORDINARY VIDEO RENDER: stage "video",
// so the webhook, the poll, the reaper, Stop, the output gate, the poster,
// the notification and the refund rules are the ones every video already
// runs. The one thing this lane asks for is the identity LOCK, and it asks
// through the job payload — job-runner.ts does not know this lane exists.
//
// WHO: admins only while it is proved, behind the `recast` switch. The
// operator's decision (2026-09-17) is every paid plan after that, credits
// doing the gating — a change to recastAccess alone.

type Access =
  | { error: string }
  | { error: null; supabase: Awaited<ReturnType<typeof createClient>>; userId: string; isAdmin: boolean };

async function recastAccess(): Promise<Access> {
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  if (!data.user) return { error: SESSION_EXPIRED_MESSAGE };
  const { data: profile } = await supabase.from("profiles").select("role").eq("id", data.user.id).maybeSingle();
  const isAdmin = profile?.role === "admin";
  if (!isAdmin) return { error: RECAST_NOT_OPEN };
  if (!(await isRecastEnabled(supabase))) return { error: RECAST_UNAVAILABLE };
  return { error: null, supabase, userId: data.user.id, isAdmin };
}

type Admin = ReturnType<typeof createAdminClient>;

async function removeSource(admin: Admin, path: string): Promise<void> {
  const { error } = await admin.storage.from(RECAST_BUCKET).remove([path]);
  if (error) console.error("recast source remove failed:", error.message);
}

/** The bytes of an uploaded clip, read from storage — kept, so a window can be cut from them. */
async function readUpload(admin: Admin, path: string): Promise<{ clip: RecastClip; bytes: Buffer } | { error: string }> {
  const { data: blob, error } = await admin.storage.from(RECAST_BUCKET).download(path);
  if (error || !blob) return { error: RECAST_UPLOAD_UNREADABLE };
  const buf = Buffer.from(await blob.arrayBuffer());
  const probe = probeMp4(buf);
  if (!probe) return { error: RECAST_NOT_A_VIDEO };
  return { clip: { seconds: probe.seconds, frames: probe.frames, width: probe.width, height: probe.height, bytes: buf.length }, bytes: buf };
}

/** One of the person's own finished takes, used as the performance. */
const TAKE_CLIP_MAX_BYTES = 80 * 1024 * 1024;

async function readOwnTake(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string,
  takeId: string,
): Promise<{ clip: RecastClip; url: string; bytes: Buffer | null } | { error: string }> {
  const { data: take } = await supabase
    .from("generations")
    .select("id, result_url, video_duration_seconds")
    .eq("id", takeId)
    .eq("user_id", userId)
    .eq("content_type", "video")
    .eq("status", "succeeded")
    .is("deleted_at", null)
    .maybeSingle<{ id: string; result_url: string | null; video_duration_seconds: number | null }>();
  const stored = toMediaUrl(take?.result_url ?? null);
  if (!take || !stored || !isRenderableUrl(stored)) return { error: RECAST_UPLOAD_UNREADABLE };
  // Absolute, because the provider fetches it from its own network — and
  // because this read does too.
  const url = providerDownloadUrl(stored);

  // The real file, for the same reason an upload is read: one engine bills
  // by FRAMES, and a duration column cannot say how many there are. A take
  // that will not read falls back to its recorded length, which prices at
  // the safe end.
  const fallback: RecastClip = {
    seconds: take.video_duration_seconds ?? 0,
    frames: null,
    width: 1280,
    height: 720,
    bytes: 0,
  };
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(20_000) });
    if (!res.ok) return { clip: fallback, url, bytes: null };
    const length = Number(res.headers.get("content-length") ?? 0);
    if (length > TAKE_CLIP_MAX_BYTES) return { clip: fallback, url, bytes: null };
    const buf = Buffer.from(await res.arrayBuffer());
    const probe = probeMp4(buf);
    if (!probe) return { clip: fallback, url, bytes: null };
    return { clip: { seconds: probe.seconds, frames: probe.frames, width: probe.width, height: probe.height, bytes: buf.length }, url, bytes: buf };
  } catch {
    return { clip: fallback, url, bytes: null };
  }
}

/** Step 1: a place for the clip, and the id it will be known by. */
export async function reserveRecastUpload(input: {
  size: number;
  type: string;
}): Promise<{ error: string } | { error: null; path: string; contentType: string }> {
  const access = await recastAccess();
  if (access.error !== null) return { error: access.error };

  const container = recastContainerOf(typeof input?.type === "string" ? input.type : "");
  if (!container) return { error: RECAST_NOT_A_VIDEO };
  const size = typeof input?.size === "number" ? input.size : 0;
  if (!(size > 0) || size > RECAST_MAX_BYTES) return { error: RECAST_CLIP_TOO_BIG };
  if (await rateLimited(access.userId, "recast-upload", 600, 12)) return { error: RECAST_TOO_FAST };

  // The bucket arrives with recast.sql; without it the browser's upload
  // would fail with storage's own words.
  const admin = createAdminClient();
  const { error: bucketError } = await admin.storage.getBucket(RECAST_BUCKET);
  if (bucketError) return { error: RECAST_NEEDS_DATABASE };

  return { error: null, path: recastSourcePath(access.userId, crypto.randomUUID(), container), contentType: input.type };
}

export type RecastQuote = { engine: RecastEngine; credits: number; fits: boolean };

export type RecastInspection = {
  error: null;
  seconds: number;
  /** The file's own frame count (null when it will not say) — what a window is priced from. */
  frames: number | null;
  width: number;
  height: number;
  quotes: RecastQuote[];
  read: RecastRead | null;
  warnings: RecastWarning[];
};

/**
 * Step 2: what the clip really is, what is in it, and what each engine would
 * cost for it. The frames were sampled in the browser (recast-client.ts) and
 * arrive as one newline-joined string — the action codec refuses a large
 * array of large strings, a lesson the Recce paid for.
 */
export async function inspectRecastClip(input: {
  path?: string;
  takeId?: string;
  frames: string;
}): Promise<{ error: string } | RecastInspection> {
  const access = await recastAccess();
  if (access.error !== null) return { error: access.error };
  const admin = createAdminClient();

  let clip: RecastClip;
  if (typeof input?.takeId === "string" && input.takeId) {
    const own = await readOwnTake(access.supabase, access.userId, input.takeId);
    if ("error" in own) return { error: own.error };
    clip = own.clip;
  } else {
    const parsed = parseRecastSourcePath(typeof input?.path === "string" ? input.path : "");
    if (!parsed || parsed.userId !== access.userId) return { error: RECAST_UPLOAD_UNREADABLE };
    const read = await readUpload(admin, input.path!);
    if ("error" in read) {
      await removeSource(admin, input.path!);
      return { error: read.error };
    }
    clip = read.clip;
    const problem = recastClipProblem(clip);
    if (problem) {
      await removeSource(admin, input.path!);
      return { error: recastClipProblemMessage(problem) };
    }
  }

  // The read. A brake, because it is a model call on every clip dropped;
  // never a refusal of the take itself — a clip that cannot be read can
  // still be taken, it is simply not understood.
  let read: RecastRead | null = null;
  const frames = typeof input?.frames === "string" ? input.frames.split("\n").filter((f) => f.startsWith("data:image/jpeg;base64,")) : [];
  if (frames.length >= RECAST_FRAMES_MIN && !(await rateLimited(access.userId, "recast-read", 600, 20))) {
    const used = frames.slice(0, RECAST_FRAME_COUNT);
    const times = recastSampleTimes(clip.seconds, used.length);
    const answer = await askRecastRead(recastReadInstructions(times, Math.round(clip.seconds * 10) / 10), used, times);
    read = answer === null ? null : parseRecastRead(answer, clip.seconds);
  }

  return {
    error: null,
    seconds: Math.round(clip.seconds * 10) / 10,
    // The frame count the door prices a window with (trim.ts) — the same
    // number the action will scale when it charges.
    frames: clip.frames,
    width: clip.width,
    height: clip.height,
    quotes: RECAST_ENGINE_ORDER.map((engine) => ({
      engine,
      credits: recastCreditCost(engine, clip),
      fits: recastEngineFits(engine, clip),
    })),
    read,
    warnings: read ? recastWarnings(read) : [],
  };
}

/** A clip the person changed their mind about: gone, unless a take stands on it. */
export async function discardRecastUpload(path: string): Promise<void> {
  const access = await recastAccess();
  if (access.error !== null) return;
  const parsed = parseRecastSourcePath(typeof path === "string" ? path : "");
  if (!parsed || parsed.userId !== access.userId) return;
  const admin = createAdminClient();
  const { data: standing } = await admin
    .from("generations")
    .select("id")
    .eq("user_id", access.userId)
    .contains("recast", { source: { clipId: parsed.takeId } })
    .limit(1);
  if (standing?.length) return;
  await removeSource(admin, path);
}

/**
 * Step 3: the takes. One press, one clip, and one take per character cast —
 * the variants. Either every take starts or none does: the allowance is
 * asked for the whole press, the rows are reserved in one transaction, and
 * a submit that fails refunds its own row.
 */
export async function startRecastTakes(input: {
  path?: string;
  takeId?: string;
  characterIds: string[];
  photoPath?: string;
  engine: string;
  keeps?: string[];
  direction?: string;
  castTag?: string;
  /** The read the door was shown — bounded again here, and never trusted for money. */
  read?: unknown;
  /** Which stretch of the clip to perform, in seconds of the file. */
  window?: unknown;
  rights: boolean;
}): Promise<{ error: string } | { error: null; ids: string[] }> {
  const access = await recastAccess();
  if (access.error !== null) return { error: access.error };
  const { supabase, userId } = access;

  if (input?.rights !== true) return { error: RECAST_NEEDS_RIGHTS };
  const engine = parseRecastEngine(input?.engine);
  if (!engine) return { error: RECAST_COULDNT_START };
  const spec = RECAST_ENGINES[engine];

  if (await rateLimited(userId, "recast-start", 60 * 60, access.isAdmin ? 30 : 8)) return { error: RECAST_TOO_FAST };

  // The cast. The restyle job recasts nobody, so it takes none.
  const wantsCast = recastNeedsCharacter(spec.job);
  const ids = Array.isArray(input?.characterIds) ? [...new Set(input.characterIds.filter((c) => typeof c === "string"))].slice(0, 4) : [];
  if (wantsCast && ids.length === 0) return { error: RECAST_NEEDS_CAST };

  const { data: characterRows } = wantsCast
    ? await supabase
        .from("character_profiles")
        .select("id, name, reference_image_urls")
        .eq("user_id", userId)
        .in("id", ids)
    : { data: [] };
  const characters = (characterRows ?? []) as { id: string; name: string; reference_image_urls: string[] | null }[];
  if (wantsCast && characters.length !== ids.length) return { error: "Couldn't find that character." };
  for (const c of characters) {
    if (!c.reference_image_urls?.length) return { error: RECAST_CHARACTER_NEEDS_PHOTO };
  }
  // Order follows what was asked for, so the first cast is the first take.
  const cast = wantsCast ? ids.map((id) => characters.find((c) => c.id === id)!) : [null];

  // THE MONEY PATH READS THE FILE. Length and frame count price the take.
  const admin = createAdminClient();
  let clip: RecastClip;
  let source: RecastSource;
  let clipUrl: string;
  let sourceBytes: Buffer | null;
  let uploadPath: string | null = null;
  if (typeof input?.takeId === "string" && input.takeId) {
    const own = await readOwnTake(supabase, userId, input.takeId);
    if ("error" in own) return { error: own.error };
    clip = own.clip;
    clipUrl = own.url;
    sourceBytes = own.bytes;
    source = { kind: "take", takeId: input.takeId };
  } else {
    const parsed = parseRecastSourcePath(typeof input?.path === "string" ? input.path : "");
    if (!parsed || parsed.userId !== userId) return { error: RECAST_UPLOAD_UNREADABLE };
    uploadPath = input.path!;
    const read = await readUpload(admin, uploadPath);
    if ("error" in read) return { error: read.error };
    clip = read.clip;
    sourceBytes = read.bytes;
    source = { kind: "upload", clipId: parsed.takeId, container: parsed.container as RecastContainer };
    const { data: signed } = await admin.storage.from(RECAST_BUCKET).createSignedUrl(uploadPath, 60 * 60 * 24);
    if (!signed?.signedUrl) return { error: RECAST_COULDNT_START };
    clipUrl = signed.signedUrl;
  }

  const problem = recastClipProblem(clip);
  if (problem) {
    if (uploadPath) await removeSource(admin, uploadPath);
    return { error: recastClipProblemMessage(problem) };
  }

  // THE WINDOW (trim.ts). The door always sends one; a client that predates
  // it is given the whole clip, and refused only if the whole clip is longer
  // than the job takes. Checked against the FILE's length, never trusted.
  const window: RecastWindow = input?.window === undefined ? { start: 0, end: clip.seconds } : (input.window as RecastWindow);
  const windowProblem = recastWindowProblem(window, clip.seconds, spec.job);
  if (windowProblem === "too-long") return { error: RECAST_JOB_TOO_LONG };
  if (windowProblem) return { error: RECAST_WINDOW_INVALID };
  const cutting = !isWholeClip(window, clip.seconds);
  // Price from the source's own numbers scaled to the window — the same call
  // the door quoted with, so the button's number is the number charged.
  const perTake = recastWindowCredits(engine, clip, window);
  const windowSeconds = window.end - window.start;

  // The read again, from what the door was shown — the brief is composed
  // server-side from the same fields, so what was on the door is what is
  // sent. Only the person's own choices travel: which keeps are still
  // ticked, and their direction.
  const keeps: RecastKeep[] = (Array.isArray(input?.keeps) ? input.keeps : [])
    .filter((k): k is string => typeof k === "string" && k.length > 0)
    .slice(0, 6)
    .map((what) => ({ what: what.slice(0, 120), kind: "object" as const }));
  const direction = typeof input?.direction === "string" ? input.direction.slice(0, RECAST_DIRECTION_MAX_CHARS) : "";
  const castTag = typeof input?.castTag === "string" && /^[A-D]$/.test(input.castTag) ? input.castTag : null;

  // The read described the whole clip; the brief describes the window —
  // its own length, and only the cuts that fall inside it, on its own clock.
  const wholeRead = reboundRecastRead(input?.read, clip.seconds);
  const read = wholeRead ? { ...wholeRead, cuts: cutsInWindow(wholeRead.cuts, window) } : null;
  const briefFor = (casting: RecastCasting | null) =>
    composeRecastBrief({ job: spec.job, read, seconds: windowSeconds, casting, keeps, direction });

  // The words, judged before anything is spent. The brief is judged when it
  // will actually be sent; otherwise only the person's own direction is,
  // because it is stored and shown either way.
  let scores: Scores | undefined;
  let priorHits = 0;
  const judged = spec.takesDirection ? briefFor(cast[0] ? { tag: castTag, characterName: cast[0].name } : null) : direction;
  if (judged.trim()) {
    try {
      ({ scores, priorHits } = await gatePrompt({ prompt: judged, userId, hasRealPersonReference: true }));
    } catch (err) {
      if (err instanceof ContentPolicyRefusal) {
        // A brief is mostly OUR words about their footage, so the sentence
        // back does not accuse them of writing it.
        return { error: spec.takesDirection && !direction.trim() ? RECAST_REFUSED_BRIEF : err.userMessage };
      }
      throw err;
    }
  } else {
    priorHits = await recentRefusalCount(userId);
  }

  // THE CUT. After the words (a refused brief costs no encoding) and before
  // the picture check, because what is judged must be what is sent. The
  // cut is a new clip of its own; the original stays, named in the recipe,
  // so the take can be recut later.
  let cutPath: string | null = null;
  const fromClipId = source.kind === "upload" ? source.clipId : null;
  if (cutting) {
    if (!sourceBytes) return { error: RECAST_TRIM_FAILED };
    const cut = await cutRecastWindow(admin, userId, sourceBytes, window);
    if ("error" in cut) return { error: RECAST_TRIM_FAILED };
    cutPath = cut.path;
    const { data: signedCut } = await admin.storage.from(RECAST_BUCKET).createSignedUrl(cut.path, 60 * 60 * 24);
    if (!signedCut?.signedUrl) {
      await removeSource(admin, cut.path);
      return { error: RECAST_COULDNT_START };
    }
    clipUrl = signedCut.signedUrl;
    source = { kind: "upload", clipId: cut.clipId, container: "mp4" };
  }

  // THE CLIP IS JUDGED before anything is spent: real footage of real
  // people, so the strict lane, and a frame that cannot be read is a
  // refusal. Only an UPLOAD — one of our own finished takes met the output
  // gate on the way out and is not re-judged on the way back in (nor is a
  // window cut from one). What is judged is what is sent: the cut, if any.
  if (uploadPath) {
    try {
      await judgeRender({ url: clipUrl, kind: "video", strictLane: true, promptScores: scores ?? null, sessionPriorHits: priorHits });
    } catch (err) {
      if (!(err instanceof OutputPolicyRefusal)) throw err;
      await recordPolicyRefusal({ userId, gate: "output", reason: err.reason, strictLane: true, bands: err.readings, provider: "recast-source" });
      if (cutPath) await removeSource(admin, cutPath);
      if (err.reason === "unavailable") return { error: RECAST_CLIP_UNCHECKED };
      await removeSource(admin, uploadPath);
      return { error: err.userMessage };
    }
  }

  const total = perTake * cast.length;
  const seconds = Math.max(1, Math.round(windowSeconds));
  const groupId = cast.length > 1 ? crypto.randomUUID() : null;

  // The free daily slot never covers a recast — plan or purchased credits
  // only, the upscaler's rule. Asked for the WHOLE press: a variant set
  // that can only half-afford itself does not start.
  const allowance = await checkGenerationAllowance(supabase, userId, total);
  if (allowance.error) return { error: allowance.error };
  const consumePurchased = allowance.consumePurchased ?? 0;
  const monthlyPortion = allowance.isAdmin ? 0 : Math.max(0, total - consumePurchased);

  const lockOn = await isRecastLockOn(supabase);
  const rows = cast.map((character, i) => {
    const casting = character ? { tag: castTag, characterName: character.name } : null;
    return {
      id: crypto.randomUUID(),
      character_profile_id: character?.id ?? null,
      character_profile_ids: character ? [character.id] : [],
      prompt_input: character ? `Recast: ${character.name}` : "Restyle",
      content_type: "video",
      status: "generating",
      attempts: 0,
      result_url: null,
      pipeline_log: [],
      video_model_id: spec.modelId,
      model_id: spec.modelId,
      video_duration_seconds: seconds,
      video_aspect_ratio: null,
      credits_used: perTake,
      // Spread across the rows the way a fan-out does, so no row is charged
      // purchased credits the press did not consume.
      purchased_credits_used: Math.floor(consumePurchased / cast.length) + (i < consumePurchased % cast.length ? 1 : 0),
      free_generation_used: false,
      // Dropped silently by jsonb_populate_record until recast.sql runs, so
      // a take before the migration still works — it simply cannot be
      // replayed or opened as a before-and-after.
      recast: recastRow({
        source,
        job: spec.job,
        engine,
        keeps,
        direction,
        castTag,
        brief: briefFor(casting),
        lock: lockOn,
        groupId,
        window: cutting ? { start: window.start, end: window.end } : null,
        fromClipId: cutting ? fromClipId : null,
      }),
    };
  });

  const { data: reservedIds, error: reserveError } = await admin.rpc("reserve_generations", {
    p_user_id: userId,
    p_monthly_portion: monthlyPortion,
    p_limit: allowance.monthlyLimit ?? 0,
    p_since: allowance.periodStartIso ?? new Date(0).toISOString(),
    p_rows: rows,
  });
  if (reserveError) {
    const duplicate = reserveError.code === "23505" || /duplicate key/i.test(reserveError.message);
    if (!duplicate) console.error("reserve_generations failed for recast:", reserveError);
    return { error: duplicate ? RECAST_ALREADY_STARTED : RECAST_COULDNT_START };
  }
  const takeIds = (reservedIds as string[] | null) ?? [];
  if (takeIds.length === 0) return { error: "You've used all the credits included in your plan this month." };

  // Guarded purchased-credit spend — nothing paid has run yet, so losing the
  // race releases every placeholder.
  if (!(await consumePurchasedCredits(supabase, userId, consumePurchased))) {
    const { error: releaseError } = await admin
      .from("generations")
      .update({ status: "failed", credits_used: 0, purchased_credits_used: 0, progress_stage: null })
      .in("id", takeIds);
    if (releaseError) console.error("recast guarded-spend abort couldn't release the placeholders:", releaseError.message);
    return { error: "You're out of credits — top up under Settings → Usage (credit packs need no plan)." };
  }

  // Signed photos for the engines: the identity photo the product already
  // calls the identity photo, plus the other angles for the one engine that
  // binds to several.
  const DAY = 60 * 60 * 24;
  const signPhotos = async (character: { reference_image_urls: string[] | null } | null) => {
    if (!character?.reference_image_urls?.length) return { first: null as string | null, more: [] as string[] };
    const photos = character.reference_image_urls;
    const chosen = typeof input?.photoPath === "string" && photos.includes(input.photoPath) ? input.photoPath : photos[0];
    const others = spec.takesMorePhotos ? photos.filter((p) => p !== chosen).slice(0, 3) : [];
    const signed = await Promise.all(
      [chosen, ...others].map((p) => admin.storage.from("character-references").createSignedUrl(p, DAY)),
    );
    const urls = signed.map((s) => s.data?.signedUrl ?? null);
    return { first: urls[0], more: urls.slice(1).filter((u): u is string => u !== null) };
  };

  // Submit each; a failure refunds only its own row, so one bad variant
  // never takes the others down.
  const started: string[] = [];
  await Promise.all(
    takeIds.map(async (generationId, i) => {
      const character = cast[i] ?? null;
      const brief = (rows[i].recast as { brief?: string } | null)?.brief ?? "";
      let pendingJob: QueuedJob | null = null;
      try {
        const photos = await signPhotos(character);
        if (character && !photos.first) throw new Error("Couldn't prepare the character's photo.");
        pendingJob = await submitRecastJob(engine, {
          clipUrl,
          ...(photos.first ? { characterImageUrl: photos.first } : {}),
          morePhotoUrls: photos.more,
          ...(spec.takesDirection ? { brief } : {}),
          clip: { seconds: windowSeconds },
        });
        await saveVideoJob({
          generationId,
          userId,
          job: { ...pendingJob, provider: "fal" },
          strictLane: true,
          // The promise on the door: judged at the start, the middle and the
          // end, and a miss is not charged for. Only where a face is cast.
          identityLock: character && lockOn ? { threshold: RECAST_LOCK_THRESHOLD, refund: true } : undefined,
          attempts: [
            {
              attempt: 1,
              passed: true,
              issues: [],
              compiledPrompt: brief,
              steps: [
                {
                  step: "generate" as const,
                  detail: `Submitted a ${seconds}s clip to ${spec.label}. The sender confirmed the clip is theirs to use.`,
                },
              ],
            },
          ],
        });
        started.push(generationId);
      } catch (err) {
        if (pendingJob) await cancelQueuedJob(pendingJob);
        const message = err instanceof Error ? err.message : "Couldn't start the take.";
        await admin
          .from("generations")
          .update({
            status: "failed",
            progress_stage: null,
            pipeline_log: [{ attempt: 1, passed: false, issues: [], compiledPrompt: brief, steps: [{ step: "generate" as const, detail: message }] }],
          })
          .eq("id", generationId);
        try {
          // Nothing was delivered, so nothing was billed — force the refund.
          await refundGenerationCosts(generationId, { force: true });
        } catch (refundErr) {
          console.error(`recast submit-failure refund failed for ${generationId}:`, refundErr);
        }
      }
    }),
  );
  if (started.length === 0) return { error: RECAST_COULDNT_START };

  revalidatePath("/app/mystique");
  revalidatePath("/app/history");
  return { error: null, ids: started };
}

/** The before/after viewer's two films: the take, and the footage it stands on. */
export async function getRecastTakeMedia(
  takeId: string,
): Promise<{ error: string } | { error: null; resultUrl: string | null; sourceUrl: string | null }> {
  const access = await recastAccess();
  if (access.error !== null) return { error: access.error };
  const { data: take } = await access.supabase
    .from("generations")
    .select("id, result_url")
    .eq("id", typeof takeId === "string" ? takeId : "")
    .eq("user_id", access.userId)
    .is("deleted_at", null)
    .in("model_id", RECAST_MODEL_IDS)
    .maybeSingle<{ id: string; result_url: string | null }>();
  if (!take) return { error: RECAST_UPLOAD_UNREADABLE };

  // The recipe is read through the one module that names its column, in a
  // query of its own: without the migration a take still plays, it simply
  // has no before-and-after (store.ts readRecastRecipes).
  const source = (await readRecastRecipes(access.supabase, [take.id])).get(take.id)?.source ?? null;
  let sourceUrl: string | null = null;
  if (source?.kind === "upload") {
    const admin = createAdminClient();
    const { data } = await admin.storage
      .from(RECAST_BUCKET)
      .createSignedUrl(recastSourcePath(access.userId, source.clipId, source.container), 60 * 60);
    sourceUrl = data?.signedUrl ?? null;
  } else if (source?.kind === "take") {
    const { data: origin } = await access.supabase
      .from("generations")
      .select("result_url")
      .eq("id", source.takeId)
      .eq("user_id", access.userId)
      .is("deleted_at", null)
      .maybeSingle<{ result_url: string | null }>();
    sourceUrl = toMediaUrl(origin?.result_url ?? null);
  }
  return { error: null, resultUrl: toMediaUrl(take.result_url), sourceUrl };
}
