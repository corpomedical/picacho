// TikTok (constraints §1 TikTok, §5, §6A; TikTok's developer docs as read
// 2026-09-25):
//   connect   Login Kit for the web: https://www.tiktok.com/v2/auth/authorize/
//             with client_key and scopes user.info.basic, video.publish,
//             video.upload; the code is exchanged with the app's secret at
//             /v2/oauth/token/. Access keys last 24 h; refresh keys 365 days
//             and ROTATE (always keep the newly returned one: vault.ts).
//   sheet     creator_info (POST /v2/post/publish/creator_info/query/) when
//             the sheet opens AND right before sending: the nickname shown,
//             the privacy options (no default), which toggles the creator
//             turned off, the longest video they may post.
//   post      Direct Post, FILE_UPLOAD: POST /v2/post/publish/video/init/
//             with post_info {title, privacy_level, disable_comment,
//             disable_duet, disable_stitch, brand_content_toggle,
//             brand_organic_toggle, is_aigc: true} → PUT the bytes to the
//             upload address (valid 1 h) in chunks → TikTok publishes on its
//             own → POST /v2/post/publish/status/fetch/ until PUBLISH_COMPLETE.
//             NEVER scheduled (S8), NEVER init again blindly (v2 #36).
//   test mode Until the Content Posting audit passes (access.ts
//             TIKTOK_AUDITED = false): "SELF_ONLY" only, the account must be
//             private, branded content unavailable, at most 5 people a day
//             (access.ts TIKTOK_TEST_PEOPLE_PER_DAY), behind
//             press_post_tiktok_direct for listed testers.
//   file      the CLEAN cut: no Picacho tag, logo or end card (TikTok: "should
//             not add promotional watermarks/logos"); is_aigc labels it.
//
// Alias-free (vitest has no '@/').

import type { OAuthAdapter, PostingAdapter, SendContext, StepOutcome, TokenAnswer } from "./adapter";
import { OAuthExchangeError, nearDeadline } from "./adapter";
import { NoAnswerError, after, call, form, num, obj, str, withQuery, type FetchLike, UPLOAD_TIMEOUT_MS } from "./http";
import {
  MEDIA_REJECTED,
  NETWORK_BUSY,
  POST_REJECTED,
  TIKTOK_ACCOUNT_PUBLIC,
  TIKTOK_BRANDED_PRIVATE,
  TIKTOK_BRANDED_TEST,
  TIKTOK_CANT_POST_NOW,
  TIKTOK_INTERACTION_OFF,
  TIKTOK_PRIVACY_NOT_OFFERED,
  TIKTOK_PRIVACY_REQUIRED,
  TIKTOK_TEST_FULL,
  TIKTOK_TEST_ONLY_ME,
  TIKTOK_TOO_LONG,
  TIKTOK_UNAVAILABLE,
  UPLOAD_FAILED,
} from "./messages";
import type { RefreshAnswer } from "./vault";
import { TIKTOK_PRIVACY_LEVELS, type TikTokChoices, type TikTokPrivacy, type TikTokSheetState } from "../press-tour/publish-types";

export const TIKTOK_AUTHORIZE_URL = "https://www.tiktok.com/v2/auth/authorize/";
export const TIKTOK_TOKEN_URL = "https://open.tiktokapis.com/v2/oauth/token/";
export const TIKTOK_REVOKE_URL = "https://open.tiktokapis.com/v2/oauth/revoke/";
export const TIKTOK_CREATOR_INFO_URL = "https://open.tiktokapis.com/v2/post/publish/creator_info/query/";
export const TIKTOK_INIT_URL = "https://open.tiktokapis.com/v2/post/publish/video/init/";
export const TIKTOK_STATUS_URL = "https://open.tiktokapis.com/v2/post/publish/status/fetch/";

export const TIKTOK_SCOPES = ["user.info.basic", "video.publish", "video.upload"] as const;
/** One PUT carries the whole file up to 64 MB (TikTok: a chunk is 5-64 MB, a file under 5 MB goes whole). */
export const TIKTOK_SINGLE_CHUNK_MAX = 64 * 1024 * 1024;
export const TIKTOK_CHUNK_BYTES = 16 * 1024 * 1024;
/** How long we keep asking TikTok whether a post went out, before 'unconfirmed'. */
const STATUS_GIVE_UP_MS = 45 * 60 * 1000;
/** The upload address dies an hour after init. */
const UPLOAD_URL_LIFE_MS = 60 * 60 * 1000;

const JSON_HEADERS = { "content-type": "application/json; charset=UTF-8" };

// ---------------------------------------------------------------------
// Connecting
// ---------------------------------------------------------------------

function tokenAnswer(body: unknown, now: Date): TokenAnswer | null {
  const b = obj(body);
  const accessToken = str(b.access_token, 4096);
  if (!accessToken) return null;
  const scope = str(b.scope, 1000);
  return {
    accessToken,
    refreshToken: str(b.refresh_token, 4096),
    accessExpiresAt: after(now, b.expires_in),
    refreshExpiresAt: after(now, b.refresh_expires_in),
    scopes: scope ? scope.split(/[,\s]+/).filter(Boolean) : [],
    externalId: str(b.open_id, 128),
  };
}

export const tiktokOAuth: OAuthAdapter = {
  network: "tiktok",
  scopes: TIKTOK_SCOPES,
  usesPkce: false,
  envKeys: { id: "TIKTOK_CLIENT_KEY", secret: "TIKTOK_CLIENT_SECRET" },

  authorizeUrl({ creds, redirectUri, state }) {
    return withQuery(TIKTOK_AUTHORIZE_URL, {
      client_key: creds.clientId,
      scope: TIKTOK_SCOPES.join(","),
      response_type: "code",
      redirect_uri: redirectUri,
      state,
    });
  },

  async exchangeCode(fetchImpl, { creds, code, redirectUri, now }) {
    let res;
    try {
      res = await call(fetchImpl, TIKTOK_TOKEN_URL, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: form({ client_key: creds.clientId, client_secret: creds.clientSecret, code, grant_type: "authorization_code", redirect_uri: redirectUri }),
      });
    } catch {
      throw new OAuthExchangeError("tiktok", "no answer");
    }
    const tokens = res.ok ? tokenAnswer(res.body, now) : null;
    if (!tokens || !tokens.externalId) throw new OAuthExchangeError("tiktok", `token exchange ${res.status}`);
    return tokens;
  },

  async profile(fetchImpl, { accessToken, token }) {
    // creator_info names the account the way the sheet must show it.
    const info = await creatorInfo(fetchImpl, accessToken);
    if (!info.ok || !token.externalId) throw new OAuthExchangeError("tiktok", "profile");
    return { externalId: token.externalId, handle: info.info.username, displayName: info.info.nickname };
  },

  async refresh(fetchImpl, { creds, refreshToken, now }): Promise<RefreshAnswer> {
    if (!refreshToken) return { ok: false, reason: "invalid" };
    let res;
    try {
      res = await call(fetchImpl, TIKTOK_TOKEN_URL, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: form({ client_key: creds.clientId, client_secret: creds.clientSecret, grant_type: "refresh_token", refresh_token: refreshToken }),
      });
    } catch {
      return { ok: false, reason: "unavailable" };
    }
    const t = res.ok ? tokenAnswer(res.body, now) : null;
    if (t) {
      return {
        ok: true,
        keys: { accessToken: t.accessToken, refreshToken: t.refreshToken, accessExpiresAt: t.accessExpiresAt, refreshExpiresAt: t.refreshExpiresAt },
      };
    }
    const error = String(obj(res.body).error ?? "");
    return error === "invalid_grant" || res.status === 401 ? { ok: false, reason: "invalid" } : { ok: false, reason: "unavailable" };
  },

  async revoke(fetchImpl, { creds, token }) {
    try {
      const res = await call(fetchImpl, TIKTOK_REVOKE_URL, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: form({ client_key: creds.clientId, client_secret: creds.clientSecret, token }),
      });
      return res.ok ? "done" : "failed";
    } catch {
      return "failed";
    }
  },
};

// ---------------------------------------------------------------------
// creator_info and the sheet (pure where it can be)
// ---------------------------------------------------------------------

export type CreatorInfo = {
  nickname: string;
  username: string;
  avatarUrl: string | null;
  privacyOptions: TikTokPrivacy[];
  commentDisabled: boolean;
  duetDisabled: boolean;
  stitchDisabled: boolean;
  maxDurationSeconds: number;
};

/** TikTok's error code from an answer ('ok' on success). */
export function tiktokErrorCode(body: unknown): string {
  return String(obj(obj(body).error).code ?? "");
}

export type CreatorInfoAnswer =
  | { ok: true; info: CreatorInfo }
  | { ok: false; outcome: "reconnect" | "cant_post" | "busy" | "unavailable" };

export async function creatorInfo(fetchImpl: FetchLike, accessToken: string): Promise<CreatorInfoAnswer> {
  let res;
  try {
    res = await call(fetchImpl, TIKTOK_CREATOR_INFO_URL, {
      method: "POST",
      headers: { ...JSON_HEADERS, authorization: `Bearer ${accessToken}` },
      body: "{}",
    });
  } catch {
    return { ok: false, outcome: "unavailable" };
  }
  const code = tiktokErrorCode(res.body);
  if (!res.ok || (code && code !== "ok")) {
    if (code === "access_token_invalid" || code === "scope_not_authorized" || res.status === 401) return { ok: false, outcome: "reconnect" };
    if (code === "spam_risk_too_many_posts" || code === "spam_risk_user_banned_from_posting" || code === "reached_active_user_cap") {
      return { ok: false, outcome: "cant_post" };
    }
    if (code === "rate_limit_exceeded" || res.status === 429) return { ok: false, outcome: "busy" };
    return { ok: false, outcome: "unavailable" };
  }
  const d = obj(obj(res.body).data);
  const options = Array.isArray(d.privacy_level_options)
    ? (d.privacy_level_options.filter((o) => (TIKTOK_PRIVACY_LEVELS as readonly unknown[]).includes(o)) as TikTokPrivacy[])
    : [];
  return {
    ok: true,
    info: {
      nickname: str(d.creator_nickname, 200) ?? "",
      username: str(d.creator_username, 100) ?? "",
      avatarUrl: str(d.creator_avatar_url, 2000),
      privacyOptions: options,
      commentDisabled: d.comment_disabled === true,
      duetDisabled: d.duet_disabled === true,
      stitchDisabled: d.stitch_disabled === true,
      maxDurationSeconds: num(d.max_video_post_duration_sec) ?? 0,
    },
  };
}

/**
 * Pure: the sheet from creator_info. In test mode only "SELF_ONLY" is
 * offered and branded content is unavailable; an account that TikTok lets
 * post to everyone is a PUBLIC account, which TikTok refuses before the
 * audit ("unaudited_client_can_only_post_to_private_accounts"), so the
 * sheet says so before anything is sent.
 */
export function sheetFrom(info: CreatorInfo, input: { audited: boolean; now: Date }): TikTokSheetState {
  const testMode = !input.audited;
  const publicAccount = testMode && info.privacyOptions.includes("PUBLIC_TO_EVERYONE");
  const options: TikTokPrivacy[] = testMode ? (info.privacyOptions.includes("SELF_ONLY") ? ["SELF_ONLY"] : []) : [...info.privacyOptions];
  let blocker: string | null = null;
  if (publicAccount) blocker = TIKTOK_ACCOUNT_PUBLIC;
  else if (options.length === 0) blocker = TIKTOK_CANT_POST_NOW;
  return {
    nickname: info.nickname,
    username: info.username,
    avatarUrl: info.avatarUrl,
    privacyOptions: options,
    commentDisabled: info.commentDisabled,
    duetDisabled: info.duetDisabled,
    stitchDisabled: info.stitchDisabled,
    maxDurationSeconds: info.maxDurationSeconds,
    testMode,
    brandedContentAvailable: !testMode,
    canPost: blocker === null,
    blocker,
    fetchedAt: input.now.toISOString(),
  };
}

/** The sheet when creator_info said no. */
export function sheetUnavailable(outcome: "cant_post" | "busy" | "unavailable", now: Date, audited: boolean): TikTokSheetState {
  return {
    nickname: "",
    username: "",
    avatarUrl: null,
    privacyOptions: [],
    commentDisabled: true,
    duetDisabled: true,
    stitchDisabled: true,
    maxDurationSeconds: 0,
    testMode: !audited,
    brandedContentAvailable: false,
    canPost: false,
    blocker: outcome === "cant_post" ? TIKTOK_CANT_POST_NOW : TIKTOK_UNAVAILABLE,
    fetchedAt: now.toISOString(),
  };
}

/**
 * Pure: the person's choices against the sheet and the file. The first
 * problem, or null. Every rule is TikTok's own (constraints §6A): a privacy
 * chosen by the person from TikTok's options (no default), "Only me" only in
 * test mode, branded content never "Only me" and not in test mode, a toggle
 * the creator turned off stays off, and the video no longer than the
 * creator may post.
 */
export function tiktokChoiceError(choices: TikTokChoices | null | undefined, sheet: TikTokSheetState, durationSeconds: number | null): string | null {
  if (!sheet.canPost) return sheet.blocker ?? TIKTOK_CANT_POST_NOW;
  if (!choices || choices.privacy === null || choices.privacy === undefined) return TIKTOK_PRIVACY_REQUIRED;
  if (!(TIKTOK_PRIVACY_LEVELS as readonly string[]).includes(choices.privacy)) return TIKTOK_PRIVACY_NOT_OFFERED;
  if (!sheet.privacyOptions.includes(choices.privacy)) {
    return sheet.testMode && choices.privacy !== "SELF_ONLY" ? TIKTOK_TEST_ONLY_ME : TIKTOK_PRIVACY_NOT_OFFERED;
  }
  if (choices.brandedContent && (sheet.testMode || !sheet.brandedContentAvailable)) return TIKTOK_BRANDED_TEST;
  if (choices.brandedContent && choices.privacy === "SELF_ONLY") return TIKTOK_BRANDED_PRIVATE;
  if ((choices.allowComment && sheet.commentDisabled) || (choices.allowDuet && sheet.duetDisabled) || (choices.allowStitch && sheet.stitchDisabled)) {
    return TIKTOK_INTERACTION_OFF;
  }
  if (durationSeconds !== null && sheet.maxDurationSeconds > 0 && durationSeconds > sheet.maxDurationSeconds) return TIKTOK_TOO_LONG;
  return null;
}

// ---------------------------------------------------------------------
// Posting
// ---------------------------------------------------------------------

/** How the file is cut for FILE_UPLOAD: whole up to 64 MB, else 16 MB chunks with the remainder in the last. */
export function chunkPlan(size: number): { chunkSize: number; count: number } {
  if (size <= TIKTOK_SINGLE_CHUNK_MAX) return { chunkSize: size, count: 1 };
  return { chunkSize: TIKTOK_CHUNK_BYTES, count: Math.floor(size / TIKTOK_CHUNK_BYTES) };
}

/** The init body, built ONLY from the consent object and the file's size. */
export function tiktokInitBody(ctx: Pick<SendContext, "consent">, size: number): Record<string, unknown> {
  const c = ctx.consent;
  const plan = chunkPlan(size);
  return {
    post_info: {
      title: c.text,
      privacy_level: c.privacy,
      disable_comment: !(c.interactions?.comment === true),
      disable_duet: !(c.interactions?.duet === true),
      disable_stitch: !(c.interactions?.stitch === true),
      brand_content_toggle: c.commercial.branded_content,
      brand_organic_toggle: c.commercial.your_brand,
      is_aigc: true,
    },
    source_info: {
      source: "FILE_UPLOAD",
      video_size: size,
      chunk_size: plan.chunkSize,
      total_chunk_count: plan.count,
    },
  };
}

type TikTokIds = { publishId?: string; initAt?: string; uploaded?: boolean };

function readIds(raw: Record<string, unknown>): TikTokIds {
  return {
    publishId: typeof raw.publishId === "string" ? raw.publishId : undefined,
    initAt: typeof raw.initAt === "string" ? raw.initAt : undefined,
    uploaded: raw.uploaded === true,
  };
}

/** A definite "no" from init or creator_info: nothing was posted. */
function initRefusal(code: string, status: number): StepOutcome {
  switch (code) {
    case "access_token_invalid":
    case "scope_not_authorized":
      return { kind: "reconnect" };
    case "spam_risk_too_many_posts":
    case "spam_risk_user_banned_from_posting":
      return { kind: "busy", error: TIKTOK_CANT_POST_NOW };
    case "reached_active_user_cap":
      return { kind: "busy", error: TIKTOK_TEST_FULL };
    case "unaudited_client_can_only_post_to_private_accounts":
      return { kind: "failed", error: TIKTOK_ACCOUNT_PUBLIC };
    case "privacy_level_option_mismatch":
      return { kind: "failed", error: TIKTOK_PRIVACY_NOT_OFFERED };
    case "rate_limit_exceeded":
      return { kind: "busy", error: NETWORK_BUSY };
    case "file_format_check_failed":
    case "duration_check_failed":
    case "frame_rate_check_failed":
    case "picture_size_check_failed":
      return { kind: "failed", error: MEDIA_REJECTED };
    default:
      if (status === 401) return { kind: "reconnect" };
      if (status === 429) return { kind: "busy", error: NETWORK_BUSY };
      return { kind: "failed", error: POST_REJECTED };
  }
}

/**
 * The public post ids from a status answer's RAW text. TikTok spells the
 * field "publicaly_available_post_id" and sends 19-digit ids as JSON
 * NUMBERS, which JSON.parse rounds (7300000000000000001 reads back as
 * 7300000000000000000): the digits are taken from the text instead.
 */
export function publicPostIds(raw: string): string[] {
  const m = /"publicaly_available_post_id"\s*:\s*\[([^\]]*)\]/.exec(raw);
  if (!m) return [];
  return m[1]
    .split(",")
    .map((v) => v.trim().replace(/^"|"$/g, ""))
    .filter((v) => /^\d{1,32}$/.test(v));
}

async function fetchStatus(ctx: SendContext, publishId: string): Promise<{ status: string; failReason: string | null; publicIds: string[] } | null> {
  let res;
  try {
    res = await call(ctx.fetch, TIKTOK_STATUS_URL, {
      method: "POST",
      headers: { ...JSON_HEADERS, authorization: `Bearer ${ctx.accessToken}` },
      body: JSON.stringify({ publish_id: publishId }),
    });
  } catch {
    return null;
  }
  if (!res.ok) return null;
  const d = obj(obj(res.body).data);
  return {
    status: str(d.status, 64) ?? "",
    failReason: str(d.fail_reason, 200),
    publicIds: publicPostIds(res.text),
  };
}

async function poll(ctx: SendContext, ids: TikTokIds): Promise<StepOutcome> {
  const publishId = ids.publishId as string;
  const since = Date.parse(ids.initAt ?? ctx.post.createdAt);
  const st = await fetchStatus(ctx, publishId);
  const age = ctx.now().getTime() - (Number.isFinite(since) ? since : ctx.now().getTime());
  if (st === null) {
    return age > STATUS_GIVE_UP_MS ? { kind: "unconfirmed" } : { kind: "wait", resumeAt: new Date(ctx.now().getTime() + 30_000) };
  }
  if (st.status === "PUBLISH_COMPLETE") {
    const publicId = st.publicIds[0] ?? null;
    const handle = ctx.account.handle;
    return {
      kind: "published",
      externalPostId: publicId,
      permalink: publicId && handle ? `https://www.tiktok.com/@${encodeURIComponent(handle)}/video/${publicId}` : null,
    };
  }
  if (st.status === "FAILED") {
    const reason = st.failReason ?? "";
    if (/spam_risk/.test(reason)) return { kind: "busy", error: TIKTOK_CANT_POST_NOW };
    if (/check_failed|file_format|duration|frame_rate|picture_size/.test(reason)) return { kind: "failed", error: MEDIA_REJECTED };
    return { kind: "failed", error: ids.uploaded ? POST_REJECTED : UPLOAD_FAILED };
  }
  // PROCESSING_UPLOAD / PROCESSING_DOWNLOAD / SEND_TO_USER_INBOX: still going.
  if (!ids.uploaded && age > UPLOAD_URL_LIFE_MS + 5 * 60_000) return { kind: "failed", error: UPLOAD_FAILED };
  if (age > STATUS_GIVE_UP_MS && ids.uploaded) return { kind: "unconfirmed" };
  return { kind: "wait", resumeAt: new Date(ctx.now().getTime() + 20_000) };
}

export const tiktokPosting: PostingAdapter = {
  network: "tiktok",
  maxUploadAttempts: 1,
  async advance(ctx) {
    let ids = readIds(ctx.post.externalIds);

    // Already initialised: only ever ask how it went. Never init twice.
    if (ids.publishId) return poll(ctx, ids);
    // Died between "publishing" and saving init's answer: no bytes were
    // ever sent, so TikTok has nothing it could publish.
    if (ctx.post.stage === "publishing") return { kind: "failed", error: UPLOAD_FAILED };
    if (ctx.post.uploadAttempts >= 1) return { kind: "failed", error: UPLOAD_FAILED };

    // creator_info right before sending (TikTok requires the latest).
    const info = await creatorInfo(ctx.fetch, ctx.accessToken);
    if (!info.ok) {
      if (info.outcome === "reconnect") return { kind: "reconnect" };
      if (info.outcome === "cant_post") return { kind: "busy", error: TIKTOK_CANT_POST_NOW };
      return { kind: "busy", error: NETWORK_BUSY };
    }
    const sheet = sheetFrom(info.info, { audited: ctx.tiktokAudited, now: ctx.now() });
    const c = ctx.consent;
    const choiceError = tiktokChoiceError(
      {
        privacy: c.privacy,
        allowComment: c.interactions?.comment === true,
        allowDuet: c.interactions?.duet === true,
        allowStitch: c.interactions?.stitch === true,
        yourBrand: c.commercial.your_brand,
        brandedContent: c.commercial.branded_content,
      },
      sheet,
      ctx.media.durationSeconds,
    );
    if (choiceError) return choiceError === TIKTOK_CANT_POST_NOW ? { kind: "busy", error: choiceError } : { kind: "failed", error: choiceError };

    const bytes = await ctx.media.bytes();
    if (nearDeadline(ctx, 90_000)) return { kind: "wait", resumeAt: new Date(ctx.now().getTime() + 5_000) };

    // From here on the post may become public without another word from us:
    // TikTok publishes once the last byte lands. init is never sent twice.
    await ctx.save({ stage: "publishing", uploadAttempts: 1 });
    let res;
    try {
      res = await call(ctx.fetch, TIKTOK_INIT_URL, {
        method: "POST",
        headers: { ...JSON_HEADERS, authorization: `Bearer ${ctx.accessToken}` },
        body: JSON.stringify(tiktokInitBody(ctx, bytes.length)),
      });
    } catch {
      // No answer to init: whatever TikTok made has no bytes and can never
      // publish, so nothing went out. It is not sent again.
      return { kind: "failed", error: UPLOAD_FAILED };
    }
    const code = tiktokErrorCode(res.body);
    const data = obj(obj(res.body).data);
    const publishId = str(data.publish_id, 128);
    const uploadUrl = str(data.upload_url, 4000);
    const answered = res.ok && (!code || code === "ok") && publishId !== null && uploadUrl !== null;
    if (!answered) {
      if (code && code !== "ok") return initRefusal(code, res.status);
      // No usable answer: no bytes were sent, so nothing can go out.
      if (res.ok || res.status >= 500) return { kind: "failed", error: UPLOAD_FAILED };
      return initRefusal("", res.status);
    }
    ids = { publishId: publishId as string, initAt: ctx.now().toISOString() };
    await ctx.save({ externalIds: ids });

    // The bytes, in order. A chunk's PUT names its byte range, so sending it
    // again is safe; the whole upload is not.
    const plan = chunkPlan(bytes.length);
    for (let i = 0; i < plan.count; i++) {
      const start = i * plan.chunkSize;
      const end = i === plan.count - 1 ? bytes.length - 1 : start + plan.chunkSize - 1;
      const part = bytes.subarray(start, end + 1);
      let sent = false;
      let lostLast = false;
      for (let attempt = 0; attempt < 3 && !sent; attempt++) {
        try {
          const r = await call(
            ctx.fetch,
            uploadUrl,
            {
              method: "PUT",
              // Content-Length comes from the body itself (a fixed-length Uint8Array).
              headers: {
                "content-type": "video/mp4",
                "content-range": `bytes ${start}-${end}/${bytes.length}`,
              },
              body: new Uint8Array(part),
            },
            UPLOAD_TIMEOUT_MS,
          );
          if (r.ok) sent = true;
          else if (r.status < 500) break;
        } catch (err) {
          if (!(err instanceof NoAnswerError)) throw err;
          if (i === plan.count - 1) lostLast = true;
        }
      }
      if (!sent) {
        // The last chunk's answer lost: it may have landed, so ask TikTok.
        if (lostLast) return { kind: "wait", resumeAt: new Date(ctx.now().getTime() + 15_000) };
        return { kind: "failed", error: UPLOAD_FAILED };
      }
    }
    ids = { ...ids, uploaded: true };
    await ctx.save({ externalIds: ids });
    return { kind: "wait", resumeAt: new Date(ctx.now().getTime() + 15_000) };
  },
};
