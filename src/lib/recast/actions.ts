"use server";

import { revalidatePath } from "next/cache";
import { createAdminClient, createClient } from "@/lib/supabase/server";
import { rateLimited } from "@/lib/rate-limit";
import { ContentPolicyRefusal, type Scores } from "@/lib/generations/content-policy";
import { checkGenerationAllowance, consumePurchasedCredits } from "@/lib/generations/core";
import { recastTakeLock } from "@/lib/generations/face-lock";
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
  RECAST_CHAIN_NO_PLAN,
  RECAST_CHAIN_TOO_MANY,
  RECAST_CHARACTER_NEEDS_PHOTO,
  RECAST_CLIP_TOO_BIG,
  RECAST_CLIP_UNCHECKED,
  RECAST_COULDNT_START,
  RECAST_IMAGE_UNCHECKED,
  RECAST_IMAGE_UNUSABLE,
  RECAST_JOB_TOO_LONG,
  RECAST_GROUP_ONE_PART,
  RECAST_NEEDS_DATABASE,
  RECAST_NEEDS_PICTURE,
  RECAST_NEEDS_RIGHTS,
  RECAST_NEEDS_ROLES,
  RECAST_NEEDS_WORDS,
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
  RECAST_IMAGE_BUCKET,
  RECAST_IMAGE_SEND_MAX_PX,
  RECAST_MAX_BYTES,
  RECAST_MAX_IMAGES,
  RECAST_MODEL_IDS,
  recastClipProblem,
  recastContainerOf,
  recastCreditCost,
  recastCastsTogether,
  recastChainFits,
  recastEngineFits,
  recastImageRoom,
  recastImageSendsAsIs,
  recastImageUsable,
  recastMissing,
  recastRequestBody,
  recastRestageImageRoom,
  recastSourcePath,
  recastTakesCast,
  type RecastClip,
  type RecastContainer,
  type RecastEngine,
} from "@/lib/recast/recast";
import {
  composeRecastBrief,
  RECAST_DIRECTION_MAX_CHARS,
  recastBriefNames,
  recastSentBriefs,
  type RecastCasting,
} from "@/lib/recast/recast-brief";
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
import { isWholeClip, recastFitFor, recastSendWindow, recastWindowCredits, recastWindowProblem, type RecastWindow } from "@/lib/recast/trim";
import { cutRecastWindow } from "@/lib/recast/trim-run";
import {
  CHAIN_CLIP_PLACEHOLDER,
  CHAIN_LOOK_PLACEHOLDER,
  CHAIN_FPS,
  CHAIN_PREFIX_FRAMES,
  chainFolder,
  chainPieceCount,
  chainRequestOf,
  type ChainRequest,
  type ChainState,
} from "@/lib/generations/chain";
import { cleanupChain, prepareChain, storeFirstPiece, type PreparedChain } from "@/lib/generations/chain-run";

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
//   characters are the caller's own -> allowance for ALL the variants at
//   once, before any encoding (2026-09-22) -> the brief gated as text -> the
//   cut -> THE CLIP JUDGED (its middle frame, the strict lane) before
//   anything is spent -> reserve the rows -> guarded spend -> submit each ->
//   record each.
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

/**
 * An image the person added (2026-09-19): uploaded the composer's own way, to
 * the composer's own bucket, so its path is only ever trusted when it is in
 * the caller's folder. Read here for what it really is — never for what the
 * browser said — and refused if no redrawing could bring it inside the
 * engines' limits. Nothing is written yet: that waits for the gates.
 */
type AddedImage = { path: string; bytes: Buffer; format: string; width: number; height: number; orientation: number };

/** A cast character, as read from the caller's own profiles. */
type Character = { id: string; name: string; reference_image_urls: string[] | null };

async function readAddedImage(admin: Admin, userId: string, path: string): Promise<AddedImage | { error: string }> {
  if (!path.startsWith(`${userId}/`) || path.includes("..")) return { error: RECAST_IMAGE_UNUSABLE };
  const { data: blob, error } = await admin.storage.from(RECAST_IMAGE_BUCKET).download(path);
  if (error || !blob) return { error: RECAST_UPLOAD_UNREADABLE };
  const bytes = Buffer.from(await blob.arrayBuffer());
  try {
    const sharp = (await import("sharp")).default;
    const meta = await sharp(bytes).metadata();
    const orientation = meta.orientation ?? 1;
    // The size it DISPLAYS: EXIF 5–8 are turned a quarter.
    const turned = orientation >= 5;
    const width = (turned ? meta.height : meta.width) ?? 0;
    const height = (turned ? meta.width : meta.height) ?? 0;
    if (!meta.format || !recastImageUsable({ width, height })) return { error: RECAST_IMAGE_UNUSABLE };
    return { path, bytes, format: meta.format, width, height, orientation };
  } catch {
    return { error: RECAST_IMAGE_UNUSABLE };
  }
}

/**
 * The address the engine fetches the image from: the upload itself when it is
 * already a plain upright JPEG or PNG inside the limits, otherwise a JPEG
 * redrawn from it (turned upright, inside 2048 px) beside it in the same
 * folder — which is how a WebP, a sideways phone photo or a 12 MB PNG gets in.
 */
async function sendAddedImage(admin: Admin, userId: string, image: AddedImage): Promise<{ path: string; url: string; made: boolean } | { error: string }> {
  let path = image.path;
  let made = false;
  if (!recastImageSendsAsIs({ ...image, bytes: image.bytes.length })) {
    try {
      const sharp = (await import("sharp")).default;
      const jpeg = await sharp(image.bytes)
        .rotate()
        .resize(RECAST_IMAGE_SEND_MAX_PX, RECAST_IMAGE_SEND_MAX_PX, { fit: "inside", withoutEnlargement: true })
        .flatten({ background: "#ffffff" })
        .jpeg({ quality: 90 })
        .toBuffer();
      path = `${userId}/recast-${crypto.randomUUID()}.jpg`;
      const { error } = await admin.storage.from(RECAST_IMAGE_BUCKET).upload(path, jpeg, { contentType: "image/jpeg" });
      if (error) return { error: RECAST_COULDNT_START };
      made = true;
    } catch {
      return { error: RECAST_IMAGE_UNUSABLE };
    }
  }
  const { data: signed } = await admin.storage.from(RECAST_IMAGE_BUCKET).createSignedUrl(path, 60 * 60 * 24);
  if (!signed?.signedUrl) return { error: RECAST_COULDNT_START };
  return { path, url: signed.signedUrl, made };
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
  /** Images the person added, as paths in their own folder of the composer's upload bucket. */
  imagePaths?: string[];
  engine: string;
  keeps?: string[];
  direction?: string;
  castTag?: string;
  /** Several characters in ONE take instead of one take each (Into the clip and Restage — recastCastsTogether). */
  together?: boolean;
  /** Together: the person in the read each character plays, aligned with characterIds (null = as the words say). */
  castTags?: (string | null)[];
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
  /** How many of a character’s photos ride: the identity photo and up to three more, where the engine takes them. */
  const photosOfRow = (c: Character) => Math.min(spec.takesMorePhotos ? 4 : 1, Math.max(1, c.reference_image_urls?.length ?? 1));

  if (await rateLimited(userId, "recast-start", 60 * 60, access.isAdmin ? 30 : 8)) return { error: RECAST_TOO_FAST };

  // WHO OR WHAT GOES IN — not locked to characters (2026-09-19, the
  // operator: "Do not lock it just on characters"). Characters are the
  // variants, one take each; images the person added ride in every take;
  // their words say what to do. Any of them can be enough (recastMissing).
  // Restyle takes neither characters nor images: its look is words.
  const takesCast = recastTakesCast(spec.job);
  const ids =
    takesCast && Array.isArray(input?.characterIds) ? [...new Set(input.characterIds.filter((c) => typeof c === "string"))].slice(0, 4) : [];
  const askedImages =
    takesCast && Array.isArray(input?.imagePaths)
      ? [...new Set(input.imagePaths.filter((p): p is string => typeof p === "string"))].slice(0, RECAST_MAX_IMAGES)
      : [];
  const direction = typeof input?.direction === "string" ? input.direction.slice(0, RECAST_DIRECTION_MAX_CHARS) : "";
  const missing = recastMissing(spec.job, { characters: ids.length, images: askedImages.length, words: direction.trim().length > 0 });
  if (missing === "words") return { error: RECAST_NEEDS_WORDS };
  if (missing === "picture") return { error: RECAST_NEEDS_PICTURE };

  const { data: characterRows } =
    ids.length > 0
      ? await supabase
          .from("character_profiles")
          .select("id, name, reference_image_urls")
          .eq("user_id", userId)
          .in("id", ids)
      : { data: [] };
  const characters = (characterRows ?? []) as Character[];
  if (characters.length !== ids.length) return { error: "Couldn't find that character." };
  for (const c of characters) {
    if (!c.reference_image_urls?.length) return { error: RECAST_CHARACTER_NEEDS_PHOTO };
  }
  // Order follows what was asked for, so the first cast is the first take.
  const ordered = ids.map((id) => characters.find((c) => c.id === id)!);

  // TOGETHER (2026-09-19, "Selecting two characters still makes two videos
  // separately"): in Into the clip, several characters share ONE take, each
  // playing the person in the clip the door matched them to (castTags,
  // aligned with characterIds; a person is played once) — or, untagged, the
  // part the words give them. Otherwise each character is a take of their
  // own (variants), and with nobody cast there is still one take: the
  // words', or the image's. Photo to life builds the frame from ONE picture,
  // so it only ever takes one character at a time.
  const together = recastCastsTogether(spec.job) && input?.together === true && ordered.length > 1;
  const tagsIn: unknown[] = Array.isArray(input?.castTags) ? input.castTags : [];
  const playedBy = new Set<string>();
  const castTags = ids.map((_, i) => {
    const tag = tagsIn[i];
    if (typeof tag !== "string" || !/^[A-Z]$/.test(tag) || playedBy.has(tag)) return null;
    playedBy.add(tag);
    return tag;
  });
  if (together && castTags.some((tag) => tag === null) && !direction.trim()) return { error: RECAST_NEEDS_ROLES };
  const takes: Character[][] = together ? [ordered] : ordered.length > 0 ? ordered.map((c) => [c]) : [[]];

  // The photos ONE take carries, per character in it: everyone's when they
  // share the take; apart, the most any one character brings — every take of
  // the press is charged the same, so it is priced at its dearest.
  const photosPerTake = together ? ordered.map(photosOfRow) : ordered.length > 0 ? [Math.max(...ordered.map(photosOfRow))] : [];

  // Photo to life brings ONE picture to life — the character's photo when
  // someone is cast, otherwise the first image. Into the clip carries them
  // all, in the room the take's characters leave (four references in all);
  // Restage in the room their photos leave (nine pictures in all).
  const admin = createAdminClient();
  const imagePaths =
    spec.job === "motion"
      ? ids.length > 0
        ? []
        : askedImages.slice(0, 1)
      : spec.restages
        ? askedImages.slice(0, recastRestageImageRoom(photosPerTake))
        : askedImages.slice(0, recastImageRoom(together ? ordered.length : Math.min(1, ordered.length)));
  const added: AddedImage[] = [];
  for (const path of imagePaths) {
    const image = await readAddedImage(admin, userId, path);
    if ("error" in image) return { error: image.error };
    added.push(image);
  }

  // THE MONEY PATH READS THE FILE. Length and frame count price the take.
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
  // What is cut and sent: the window, a tenth under the engine's own
  // ceiling when it has one — H3 refused the operator's 0–15 s window as
  // "over 15.0 seconds" (2026-09-20), the take failed before a credit moved.
  const sendWindow = recastSendWindow(window, spec.maxSendSeconds);
  const cutting = !isWholeClip(sendWindow, clip.seconds);
  // Outside the engine's size or frame-rate limits (Kling O3 Edit: 720–3840
  // px, 24–60 fps) the clip is re-encoded to fit, cut or not — the
  // operator's own source was 324 px tall at 61 fps and would have been
  // refused at submit.
  const fit = recastFitFor(clip, spec.accepts);
  const preparing = cutting || fit !== null;
  // Price from the source's own numbers scaled to the window — the same call
  // the door quoted with, so the button's number is the number charged. (For
  // a long take that is the most its pieces can bill — chain.ts.)
  // Restage bills its reference pictures beside its seconds, so the quote
  // counts what will ride: each cast character’s photos, and the added images.
  const referenceCount = spec.restages ? photosPerTake.reduce((n, count) => n + count, 0) + added.length : 0;
  const perTake = recastWindowCredits(engine, clip, window, referenceCount);
  const windowSeconds = window.end - window.start;
  // THE LONG TAKE (chain.ts): past the engine's own 15 s, the take is
  // rendered in chained pieces and joined.
  const chaining = spec.chains === true && chainPieceCount(windowSeconds) > 1;
  /** How many characters ONE take carries: everyone together, or one each. */
  const charactersInTake = together ? ordered.length : Math.min(1, ordered.length);
  // A LONG TAKE'S CAST (2026-09-22). Every later part carries the finished
  // frame it goes on from, one of the four pictures a part can carry — so a
  // long take holds three characters, not four. Four used to go through, and
  // the request silently dropped the still that part's own words point at.
  // Refused here: before the words are judged, before the window is cut, and
  // before any credit moves.
  if (chaining && !recastChainFits(charactersInTake)) return { error: RECAST_CHAIN_TOO_MANY };
  // What a take has room to carry: four references in all, the characters in
  // it and — for a long take — the still at each switch taking one each.
  const sendImages = spec.restages ? added : added.slice(0, recastImageRoom(charactersInTake, chaining));

  // The read again, from what the door was shown — the brief is composed
  // server-side from the same fields, so what was on the door is what is
  // sent. Only the person's own choices travel: which keeps are still
  // ticked, and their direction.
  const keeps: RecastKeep[] = (Array.isArray(input?.keeps) ? input.keeps : [])
    .filter((k): k is string => typeof k === "string" && k.length > 0)
    .slice(0, 6)
    .map((what) => ({ what: what.slice(0, 120), kind: "object" as const }));
  const castTag = typeof input?.castTag === "string" && /^[A-D]$/.test(input.castTag) ? input.castTag : null;

  // The read described the whole clip; each brief describes its own stretch
  // of it — its length, and only the cuts inside it, on its own clock —
  // because composeRecastBrief is given the WHOLE read and the window, the
  // same way the door composes what it shows (2026-09-22).
  const read = reboundRecastRead(input?.read, clip.seconds);

  // A WHOLE GROUP, IN ONE PART ONLY (2026-09-20). Every part after the first
  // is handed the footage again, and on a take that turns a crowd into one
  // character the part follows the footage: two takes of the operator's own
  // crowd came back as his students at the second join. The still at the
  // switch did not hold it, so the take is kept to one part instead.
  //
  // Asked of the tags each take actually casts (2026-09-22): everyone's own
  // when they share one take, and the one person the door named when each
  // character has a take of their own — the variants, which until today were
  // asked about tags no take of theirs used, and so were never refused.
  const groupTags = new Set((read?.people ?? []).filter((p) => p.many).map((p) => p.tag));
  const castOverGroup = (together ? castTags : [castTag]).some((tag) => tag !== null && groupTags.has(tag));
  if (castOverGroup && chaining) return { error: RECAST_GROUP_ONE_PART };

  // THE CREDITS, ASKED BEFORE THE CUT (2026-09-22). One take per character —
  // or one for all of them together — and one when nobody is cast;
  // characters together share ONE take's price. The free daily slot never
  // covers a recast — plan or purchased credits only, the upscaler's rule.
  // Asked for the WHOLE press, with the very total the rows are reserved
  // at: a variant set that can only half-afford itself does not start.
  //
  // It used to be asked last, after the words were judged, the window cut
  // (a long take's prepared at 24 fps, its stillness measured) and every
  // picture checked: someone short of credits waited a minute to be told,
  // and the cut was left behind. It moves nothing — the reserve below
  // re-checks the same window under its own lock, and the purchased spend
  // is guarded — so it is asked here, where the answer takes seconds.
  const total = perTake * takes.length;
  const early = await checkGenerationAllowance(supabase, userId, total);
  if (early.error) return { error: early.error };
  // The engine that reads names in its prompt is told which photos are whose
  // by name; how many photos each character has decides which name (a lone
  // character is @Element1 or @Image1, as ever). Every name — the cast's,
  // the added images', a later part's still — comes from recastBriefNames,
  // the one place that knows how recastRequestBody binds them (2026-09-22).
  // Alone, a character plays the person the door named; together, each
  // plays their own.
  const namesFor = (chars: Character[]) =>
    recastBriefNames({ job: spec.job, engine, photos: chars.map(photosOfRow), images: sendImages.length });
  const castingsFor = (chars: Character[]): RecastCasting[] => {
    const tokens = namesFor(chars).cast;
    return chars.map((c, i) => {
      const tag = chars.length > 1 ? castTags[ids.indexOf(c.id)] : castTag;
      // A tag the read marked as MANY people is said as many in the brief.
      const many = tag ? read?.people.find((p) => p.tag === tag)?.many === true : false;
      return {
        tag,
        ...(many ? { many: true } : {}),
        characterName: c.name,
        ...(tokens[i] ? { token: tokens[i] } : {}),
      };
    });
  };
  const castingOf = (castings: RecastCasting[]): RecastCasting | RecastCasting[] | null =>
    castings.length === 0 ? null : castings.length === 1 ? castings[0] : castings;
  // A take's brief: composed for the WINDOW with the whole read — the door's
  // own call (mystique-door.tsx), so what it shows is what is sent — and
  // fitted inside this engine's own prompt (recast.ts promptMax). A take of
  // one piece lets the person's direction change what the keep list keeps;
  // a long take's parts never do (recast-brief.ts, YOUR WORDS WIN).
  const briefFor = (chars: Character[]) =>
    composeRecastBrief({
      job: spec.job,
      engine,
      read,
      window,
      casting: castingOf(castingsFor(chars)),
      keeps,
      direction,
      images: namesFor(chars).images,
      longTake: chaining,
    });
  // A long take's pieces each carry their own brief: their own stretch of the
  // window (its length, only the cuts inside it), and from the second piece
  // on the continuity words every passing seam test was sent with
  // (recast-brief.ts). Frames count from the window's start, the prepared
  // window's own clock.
  const pieceBriefsFor = (plan: PreparedChain["plan"], chars: Character[]): string[] =>
    plan.lengths.map((frames, k) => {
      const from = k === 0 ? 0 : plan.switches[k - 1] - CHAIN_PREFIX_FRAMES;
      const names = namesFor(chars);
      // A later piece also carries the STILL at its switch — the last
      // finished frame, named after the added images (chain.ts's look).
      const look = k > 0 && names.look ? names.look : undefined;
      return composeRecastBrief({
        job: spec.job,
        engine,
        read,
        window: { start: window.start + from / CHAIN_FPS, end: window.start + (from + frames) / CHAIN_FPS },
        casting: castingOf(castingsFor(chars)),
        keeps,
        direction,
        continuing: k > 0,
        images: names.images,
        ...(look ? { look } : {}),
        // Every part, the first included: the keep lines hold as they always did.
        longTake: true,
      });
    });

  // The words, judged before anything is spent. The brief is judged when it
  // will actually be sent; otherwise only the person's own direction is,
  // because it is stored and shown either way.
  let scores: Scores | undefined;
  let priorHits = 0;
  const judged = spec.takesDirection ? briefFor(takes[0]) : direction;
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
  // A long take's window is prepared at 24 fps, its stillness measured and
  // its switches placed, all before a credit moves — and the window it
  // stands on becomes the take's recorded source, like any cut.
  let chainPrep: PreparedChain | null = null;
  if (chaining) {
    if (!sourceBytes) return { error: RECAST_TRIM_FAILED };
    const windowClipId = crypto.randomUUID();
    const prep = await prepareChain(admin, {
      bucket: RECAST_BUCKET,
      windowPath: recastSourcePath(userId, windowClipId, "mp4"),
      source: sourceBytes,
      window,
      sourceSize: { width: clip.width, height: clip.height },
    });
    if ("error" in prep) return { error: prep.error === "no-plan" ? RECAST_CHAIN_NO_PLAN : RECAST_TRIM_FAILED };
    chainPrep = prep;
    cutPath = prep.windowPath;
    const { data: signedWindow } = await admin.storage.from(RECAST_BUCKET).createSignedUrl(prep.windowPath, 60 * 60 * 24);
    if (!signedWindow?.signedUrl) {
      await removeSource(admin, prep.windowPath);
      return { error: RECAST_COULDNT_START };
    }
    clipUrl = signedWindow.signedUrl;
    source = { kind: "upload", clipId: windowClipId, container: "mp4" };
  } else if (preparing) {
    if (!sourceBytes) return { error: RECAST_TRIM_FAILED };
    const cut = await cutRecastWindow(
      admin,
      userId,
      sourceBytes,
      sendWindow,
      fit,
      // Only where a ceiling is measured does the sound go: it is the track that ran past it.
      spec.keepsSound || spec.maxSendSeconds === undefined,
    );
    if ("error" in cut) return { error: RECAST_TRIM_FAILED };
    // Measured on the file, like the provider will: over the ceiling is refused here, before anything is spent.
    if (spec.maxSendSeconds !== undefined && cut.clip.seconds > spec.maxSendSeconds) {
      console.error(`[recast] cut came back ${cut.clip.seconds}s, over ${spec.maxSendSeconds}s`);
      await removeSource(admin, cut.path);
      return { error: RECAST_TRIM_FAILED };
    }
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

  // THE IMAGES ARE JUDGED the same way, and also before anything is spent:
  // an image added to real footage rides the strict lane like the clip does.
  // What is judged is what is sent — the redrawn copy, when one was made.
  const sentImages: { path: string; url: string }[] = [];
  const madeImages: string[] = [];
  const dropPrepared = async () => {
    if (cutPath) await removeSource(admin, cutPath);
    if (madeImages.length > 0) await admin.storage.from(RECAST_IMAGE_BUCKET).remove(madeImages);
  };
  for (const image of sendImages) {
    const sent = await sendAddedImage(admin, userId, image);
    if ("error" in sent) {
      await dropPrepared();
      return { error: sent.error };
    }
    if (sent.made) madeImages.push(sent.path);
    try {
      await judgeRender({ url: sent.url, kind: "image", strictLane: true, promptScores: scores ?? null, sessionPriorHits: priorHits });
    } catch (err) {
      if (!(err instanceof OutputPolicyRefusal)) throw err;
      await recordPolicyRefusal({ userId, gate: "output", reason: err.reason, strictLane: true, bands: err.readings, provider: "recast-image" });
      await dropPrepared();
      return { error: err.reason === "unavailable" ? RECAST_IMAGE_UNCHECKED : err.userMessage };
    }
    sentImages.push({ path: sent.path, url: sent.url });
  }

  const seconds = Math.max(1, Math.round(windowSeconds));
  const groupId = takes.length > 1 ? crypto.randomUUID() : null;

  // THE SPLIT IS DECIDED FRESH, just before it is spent (review, 2026-09-22).
  // The early check answers in seconds; by here it has aged through the
  // words gate, the cut and the picture checks, and a take landing in
  // another tab meanwhile could leave its purchased/monthly split spending
  // purchased credits the plan now covers — or the reverse. The reserve
  // re-checks the monthly side under its own lock either way; this keeps the
  // split it is handed as young as the reserve itself.
  const allowance = await checkGenerationAllowance(supabase, userId, total);
  if (allowance.error) {
    await dropPrepared();
    return { error: allowance.error };
  }
  const consumePurchased = allowance.consumePurchased ?? 0;
  const monthlyPortion = allowance.isAdmin ? 0 : Math.max(0, total - consumePurchased);

  const lockOn = await isRecastLockOn(supabase);
  // EVERY TAKE'S WORDS, composed once, here, and SENT from here (2026-09-22):
  // one brief, or one per part of a long take. The submit used to read its
  // brief back out of the recipe below, which store.ts bounds for keeping —
  // cut at 2,000 characters from the END, where the person's direction
  // stands. The recipe keeps a copy; this is what the engine is given.
  const takeBriefs = takes.map((chars) => (chainPrep ? pieceBriefsFor(chainPrep.plan, chars) : [briefFor(chars)]));
  const rows = takes.map((chars, i) => {
    return {
      id: crypto.randomUUID(),
      character_profile_id: chars[0]?.id ?? null,
      character_profile_ids: chars.map((c) => c.id),
      // What History shows as the take's words: who was cast, or what was asked.
      prompt_input:
        chars.length > 0
        ? `Recast: ${chars.map((c) => c.name).join(" & ")}`
        : spec.job === "world"
          ? "Restyle"
          : direction.trim()
            ? direction.trim().slice(0, 200)
            : "Your image",
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
      purchased_credits_used: Math.floor(consumePurchased / takes.length) + (i < consumePurchased % takes.length ? 1 : 0),
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
        castTag: chars.length === 1 ? castTag : null,
        // A long take records its first piece's brief; every part's rides the
        // pipeline log (partBriefs, below).
        brief: takeBriefs[i][0],
        lock: lockOn,
        groupId,
        window: cutting ? { start: window.start, end: window.end } : null,
        fromClipId: preparing || chaining ? fromClipId : null,
        images: sentImages.map((image) => image.path),
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
    return { error: "You're out of credits — top up under Settings → Plan & billing (credit packs need no plan)." };
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
      const chars = takes[i] ?? [];
      // The words composed above, whole — never the recipe's kept copy.
      const briefs = takeBriefs[i] ?? [];
      const brief = briefs[0] ?? "";
      // Every part's words, kept where they outlive the job row (which is
      // deleted when the take finishes, chain requests and all): the first
      // attempt of the pipeline log, read back by getRecastTakeBriefs.
      const partBriefs = chainPrep ? { partBriefs: briefs } : {};
      let pendingJob: QueuedJob | null = null;
      try {
        const signed = await Promise.all(chars.map((c) => signPhotos(c)));
        if (signed.some((p) => !p.first)) throw new Error("Couldn't prepare the character's photo.");
        const photos = signed[0] ?? { first: null, more: [] as string[] };
        // The picture: the character's photo, or — for Photo to life with
        // nobody cast — the person's own image. Into the clip carries the
        // added images beside it, named in the brief; characters together
        // go as an ensemble, each bound to their own photos.
        const picture = photos.first ?? (spec.job === "motion" ? (sentImages[0]?.url ?? null) : null);
        // Restage names them "Image n" after the cast's photos, so they ride too.
        const imageUrls = spec.job === "scene" || spec.restages ? sentImages.map((image) => image.url) : [];
        const ensemble = chars.length > 1 ? signed.map((p) => ({ front: p.first!, more: p.more })) : undefined;
        // A long take sends its FIRST piece now; the runner sends the rest,
        // each as the one before it finishes (job-runner.ts, chain-run.ts).
        let chain: ChainState | undefined;
        let sendUrl = clipUrl;
        let sendSeconds = windowSeconds;
        if (chainPrep) {
          const folder = chainFolder(userId, generationId);
          const { plan } = chainPrep;
          // Every piece's request composed whole now — this lane knows its
          // engine and its words, the runner does not (it fills in only each
          // piece's clip, where the placeholder stands).
          const requests = briefs.map((pieceBrief, k) =>
            chainRequestOf(
              spec.endpoint,
              spec.label,
              recastRequestBody(engine, {
                clipUrl: CHAIN_CLIP_PLACEHOLDER,
                ...(picture ? { characterImageUrl: picture } : {}),
                morePhotoUrls: photos.more,
                // From the second part on, a place for the still at its
                // switch; the runner fills it with the last finished frame
                // (chain.ts CHAIN_LOOK_PLACEHOLDER).
                imageUrls: k > 0 && spec.job === "scene" ? [...imageUrls, CHAIN_LOOK_PLACEHOLDER] : imageUrls,
                ...(ensemble ? { ensemble } : {}),
                ...(spec.takesDirection ? { brief: pieceBrief } : {}),
                clip: { seconds: plan.lengths[k] / CHAIN_FPS },
              }),
            ),
          );
          if (requests.some((r) => r === null)) throw new Error("Couldn't compose the long take's parts.");
          sendUrl = await storeFirstPiece(admin, RECAST_BUCKET, folder, chainPrep.firstPiece);
          sendSeconds = plan.lengths[0] / CHAIN_FPS;
          chain = {
            v: 2,
            bucket: RECAST_BUCKET,
            window: chainPrep.windowPath,
            folder,
            total: chainPrep.window.frames,
            switches: plan.switches,
            lengths: plan.lengths,
            stillness: plan.stillness,
            requests: requests as ChainRequest[],
            index: 0,
            // Where each part's last look is kept for the next one: the
            // composer's image bucket, since the clip bucket takes video only.
            look: { bucket: RECAST_IMAGE_BUCKET, prefix: `${userId}/recast-look-${generationId}` },
            starts: [0],
            renders: [],
            frames: [],
          };
        }
        pendingJob = await submitRecastJob(engine, {
          clipUrl: sendUrl,
          ...(picture ? { characterImageUrl: picture } : {}),
          morePhotoUrls: photos.more,
          imageUrls,
          ...(ensemble ? { ensemble } : {}),
          ...(spec.takesDirection ? { brief } : {}),
          clip: { seconds: sendSeconds },
        });
        await saveVideoJob({
          generationId,
          userId,
          job: { ...pendingJob, provider: "fal" },
          strictLane: true,
          // EVERY take with a character in it is read whole — each face at
          // the start, the middle and the end, against the photo actually
          // sent for them (face-lock.ts recastTakeLock, 2026-09-22). The
          // recast_lock switch decides only the refund, and only where ONE
          // face is cast: with several in the frame a miss could not be
          // pinned on the take rather than the reading.
          // A long take is judged whole, once it is joined.
          identityLock: recastTakeLock({
            cast: chars.map((c) => ({
              characterId: c.id,
              photoPath:
                typeof input?.photoPath === "string" && (c.reference_image_urls ?? []).includes(input.photoPath)
                  ? input.photoPath
                  : (c.reference_image_urls?.[0] ?? ""),
            })),
            threshold: RECAST_LOCK_THRESHOLD,
            lockOn,
          }),
          chain,
          attempts: [
            {
              attempt: 1,
              passed: true,
              issues: [],
              compiledPrompt: brief,
              ...partBriefs,
              steps: [
                {
                  step: "generate" as const,
                  detail: chain
                    ? `Submitted part 1 of ${chain.lengths.length} of a ${seconds}s clip to ${spec.label}. The sender confirmed the clip is theirs to use.`
                    : `Submitted a ${seconds}s clip to ${spec.label}. The sender confirmed the clip is theirs to use.`,
                },
              ],
            },
          ],
        });
        started.push(generationId);
      } catch (err) {
        if (pendingJob) await cancelQueuedJob(pendingJob);
        if (chainPrep) await cleanupChain(admin, { bucket: RECAST_BUCKET, folder: chainFolder(userId, generationId) });
        const message = err instanceof Error ? err.message : "Couldn't start the take.";
        await admin
          .from("generations")
          .update({
            status: "failed",
            progress_stage: null,
            pipeline_log: [
              { attempt: 1, passed: false, issues: [], compiledPrompt: brief, ...partBriefs, steps: [{ step: "generate" as const, detail: message }] },
            ],
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

/**
 * The words each part of a take was given (2026-09-22) — for the finished
 * take's card, fetched when it is opened rather than with the list: a long
 * take carries up to three briefs of 2,500 characters each. One brief for a
 * take of one piece; `expanded` is Restage's own rewrite of it, where one
 * was recorded (recast-brief.ts recastSentBriefs).
 */
export async function getRecastTakeBriefs(
  takeId: string,
): Promise<{ error: string } | { error: null; parts: string[]; expanded: string | null }> {
  const access = await recastAccess();
  if (access.error !== null) return { error: access.error };
  const { data: take } = await access.supabase
    .from("generations")
    .select("id, pipeline_log")
    .eq("id", typeof takeId === "string" ? takeId : "")
    .eq("user_id", access.userId)
    .is("deleted_at", null)
    .in("model_id", RECAST_MODEL_IDS)
    .maybeSingle<{ id: string; pipeline_log: unknown }>();
  if (!take) return { error: RECAST_UPLOAD_UNREADABLE };
  return { error: null, ...recastSentBriefs(take.pipeline_log) };
}
