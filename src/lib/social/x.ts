// X (constraints §1 X, §5, §6; X API docs read at source 2026-09-25):
//   connect   OAuth 2.0 authorization code + PKCE (S256), run as a
//             CONFIDENTIAL client from the web backend (Basic auth on the
//             token calls), scopes tweet.read tweet.write users.read
//             media.write offline.access. Access keys last 2 h; refresh keys
//             are single-use and rotate (vault.ts holds the per-account lock).
//   upload    v2 chunked upload at SEND time: POST /2/media/upload/initialize
//             → /{id}/append (≤ 5 MB segments; 4 MB here) → /{id}/finalize →
//             GET /2/media/upload?command=STATUS while processing. A media id
//             expires after 86,400 s.
//   post      POST /2/tweets {text, media.media_ids, made_with_ai: true,
//             paid_partnership when the person ticked it}. NEVER sent twice:
//             a lost answer is 'unconfirmed' (X: "failed retries can still
//             record usage").
//   money     $0.015 per media object + $0.015 per post without a link =
//             $0.030 (X staff, 2026-08-31); a link would make the post
//             $0.200, so v1 refuses links (text.ts hasLink). Each call's cost
//             is recorded on the row (v2 #23).
//   dimension The docs contradict themselves (1280x1024 vs 720x1280
//             portrait); the 1080x1920 cut is sent as is and a rejection
//             reads MEDIA_REJECTED until the paid probe P3 settles it.
//
// Alias-free (vitest has no '@/').

import type { OAuthAdapter, PostingAdapter, SendContext, StepOutcome, TokenAnswer } from "./adapter";
import { OAuthExchangeError, nearDeadline } from "./adapter";
import { NoAnswerError, after, basicAuth, call, form, obj, str, withQuery, type FetchLike, UPLOAD_TIMEOUT_MS } from "./http";
import { MEDIA_REJECTED, NETWORK_BUSY, POST_REJECTED, UPLOAD_FAILED, X_REPEAT_REJECTED } from "./messages";
import type { RefreshAnswer } from "./vault";

export const X_AUTHORIZE_URL = "https://x.com/i/oauth2/authorize";
export const X_TOKEN_URL = "https://api.x.com/2/oauth2/token";
export const X_REVOKE_URL = "https://api.x.com/2/oauth2/revoke";
export const X_ME_URL = "https://api.x.com/2/users/me";
export const X_MEDIA_INIT_URL = "https://api.x.com/2/media/upload/initialize";
export const X_MEDIA_STATUS_URL = "https://api.x.com/2/media/upload";
export const X_TWEETS_URL = "https://api.x.com/2/tweets";
export const xAppendUrl = (id: string): string => `https://api.x.com/2/media/upload/${encodeURIComponent(id)}/append`;
export const xFinalizeUrl = (id: string): string => `https://api.x.com/2/media/upload/${encodeURIComponent(id)}/finalize`;

export const X_SCOPES = ["tweet.read", "tweet.write", "users.read", "media.write", "offline.access"] as const;
/** Segments at or below 5 MB (X's advice; its server maximum is 8 MB). */
export const X_CHUNK_BYTES = 4 * 1024 * 1024;
/** What X bills us (constraints §1 X). */
export const X_MEDIA_USD = 0.015;
export const X_POST_USD = 0.015;
/** v2 #23: at most ONE upload retry. */
export const X_MAX_UPLOAD_ATTEMPTS = 2;
/** A media id is good for 86,400 s; we stop trusting it an hour early. */
const MEDIA_SAFETY_MS = 60 * 60 * 1000;

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
    // X documents no absolute lifetime for refresh keys.
    refreshExpiresAt: null,
    scopes: scope ? scope.split(/\s+/).filter(Boolean) : [],
    externalId: null,
  };
}

/** X answers an unusable refresh key with 400 invalid_request "Value passed for the token was invalid". */
function invalidGrant(status: number, body: unknown): boolean {
  const b = obj(body);
  const error = String(b.error ?? "");
  const desc = String(b.error_description ?? "");
  return (status === 400 || status === 401) && (error === "invalid_grant" || /token was invalid/i.test(desc));
}

export const xOAuth: OAuthAdapter = {
  network: "x",
  scopes: X_SCOPES,
  usesPkce: true,
  envKeys: { id: "X_CLIENT_ID", secret: "X_CLIENT_SECRET" },

  authorizeUrl({ creds, redirectUri, state, codeChallenge }) {
    if (!codeChallenge) throw new Error("X needs a PKCE challenge");
    return withQuery(X_AUTHORIZE_URL, {
      response_type: "code",
      client_id: creds.clientId,
      redirect_uri: redirectUri,
      scope: X_SCOPES.join(" "),
      state,
      code_challenge: codeChallenge,
      code_challenge_method: "S256",
    });
  },

  async exchangeCode(fetchImpl, { creds, code, redirectUri, verifier, now }) {
    if (!verifier) throw new OAuthExchangeError("x", "missing verifier");
    let res;
    try {
      res = await call(fetchImpl, X_TOKEN_URL, {
        method: "POST",
        headers: { authorization: basicAuth(creds.clientId, creds.clientSecret), "content-type": "application/x-www-form-urlencoded" },
        body: form({ grant_type: "authorization_code", code, redirect_uri: redirectUri, code_verifier: verifier }),
      });
    } catch {
      throw new OAuthExchangeError("x", "no answer");
    }
    const tokens = res.ok ? tokenAnswer(res.body, now) : null;
    if (!tokens) throw new OAuthExchangeError("x", `token exchange ${res.status}`);
    return tokens;
  },

  async profile(fetchImpl, { accessToken }) {
    let res;
    try {
      res = await call(fetchImpl, X_ME_URL, { headers: { authorization: `Bearer ${accessToken}` } });
    } catch {
      throw new OAuthExchangeError("x", "no answer");
    }
    const data = obj(obj(res.body).data);
    const id = str(data.id, 64);
    if (!res.ok || !id) throw new OAuthExchangeError("x", `profile ${res.status}`);
    return { externalId: id, handle: str(data.username, 100), displayName: str(data.name, 200) };
  },

  async refresh(fetchImpl, { creds, refreshToken, now }): Promise<RefreshAnswer> {
    if (!refreshToken) return { ok: false, reason: "invalid" };
    let res;
    try {
      res = await call(fetchImpl, X_TOKEN_URL, {
        method: "POST",
        headers: { authorization: basicAuth(creds.clientId, creds.clientSecret), "content-type": "application/x-www-form-urlencoded" },
        body: form({ grant_type: "refresh_token", refresh_token: refreshToken }),
      });
    } catch {
      return { ok: false, reason: "unavailable" };
    }
    if (res.ok) {
      const t = tokenAnswer(res.body, now);
      return t
        ? { ok: true, keys: { accessToken: t.accessToken, refreshToken: t.refreshToken, accessExpiresAt: t.accessExpiresAt, refreshExpiresAt: null } }
        : { ok: false, reason: "unavailable" };
    }
    return invalidGrant(res.status, res.body) ? { ok: false, reason: "invalid" } : { ok: false, reason: "unavailable" };
  },

  async revoke(fetchImpl, { creds, token, kind }) {
    try {
      const res = await call(fetchImpl, X_REVOKE_URL, {
        method: "POST",
        headers: { authorization: basicAuth(creds.clientId, creds.clientSecret), "content-type": "application/x-www-form-urlencoded" },
        body: form({ token, token_type_hint: kind === "refresh" ? "refresh_token" : "access_token" }),
      });
      return res.ok ? "done" : "failed";
    } catch {
      return "failed";
    }
  },
};

// ---------------------------------------------------------------------
// Posting
// ---------------------------------------------------------------------

type XIds = {
  mediaId?: string;
  mediaExpiresAt?: string;
  finalized?: boolean;
  mediaReady?: boolean;
};

function readIds(raw: Record<string, unknown>): XIds {
  return {
    mediaId: typeof raw.mediaId === "string" ? raw.mediaId : undefined,
    mediaExpiresAt: typeof raw.mediaExpiresAt === "string" ? raw.mediaExpiresAt : undefined,
    finalized: raw.finalized === true,
    mediaReady: raw.mediaReady === true,
  };
}

function mediaStillGood(ids: XIds, now: Date): boolean {
  if (!ids.mediaId || !ids.mediaExpiresAt) return false;
  const exp = Date.parse(ids.mediaExpiresAt);
  return Number.isFinite(exp) && exp - now.getTime() > MEDIA_SAFETY_MS;
}

const bearer = (ctx: SendContext) => ({ authorization: `Bearer ${ctx.accessToken}` });

/** X's processing state from a finalize or status answer. */
function processing(body: unknown): { state: string | null; checkAfterS: number } {
  const info = obj(obj(obj(body).data).processing_info);
  const state = str(info.state, 32);
  const after = Number(info.check_after_secs);
  return { state, checkAfterS: Number.isFinite(after) && after > 0 ? Math.min(after, 30) : 2 };
}

/** A definite refusal of an upload call: which outcome it is. */
function uploadRefusal(status: number): StepOutcome {
  if (status === 401) return { kind: "reconnect" };
  if (status === 429) return { kind: "busy", error: NETWORK_BUSY };
  if (status >= 500) return { kind: "retry", error: UPLOAD_FAILED };
  return { kind: "failed", error: MEDIA_REJECTED };
}

async function upload(ctx: SendContext, ids: XIds): Promise<StepOutcome | XIds> {
  if (ctx.post.uploadAttempts >= X_MAX_UPLOAD_ATTEMPTS) return { kind: "failed", error: UPLOAD_FAILED };
  // A new upload: whatever an earlier attempt left is dropped.
  await ctx.save({ stage: "uploading", uploadAttempts: ctx.post.uploadAttempts + 1, externalIds: {} });
  const bytes = await ctx.media.bytes();

  let res;
  try {
    res = await call(ctx.fetch, X_MEDIA_INIT_URL, {
      method: "POST",
      headers: { ...bearer(ctx), "content-type": "application/json" },
      body: JSON.stringify({ media_type: "video/mp4", total_bytes: bytes.length, media_category: "tweet_video" }),
    });
  } catch {
    return { kind: "retry", error: UPLOAD_FAILED };
  }
  if (!res.ok) return uploadRefusal(res.status);
  const data = obj(obj(res.body).data);
  const mediaId = str(data.id, 64);
  if (!mediaId) return { kind: "retry", error: UPLOAD_FAILED };
  const expiresAt = after(ctx.now(), data.expires_after_secs ?? 86_400) ?? new Date(ctx.now().getTime() + 86_400_000);
  ids = { mediaId, mediaExpiresAt: expiresAt.toISOString() };
  // The id is saved before any byte goes; its cost too ("every attempt is recorded in cost").
  await ctx.save({ externalIds: ids, costUsd: X_MEDIA_USD });

  for (let offset = 0, index = 0; offset < bytes.length; offset += X_CHUNK_BYTES, index++) {
    const chunk = bytes.subarray(offset, Math.min(offset + X_CHUNK_BYTES, bytes.length));
    let sent = false;
    for (let attempt = 0; attempt < 2 && !sent; attempt++) {
      const body = new FormData();
      body.set("segment_index", String(index));
      body.set("media", new Blob([new Uint8Array(chunk)], { type: "application/octet-stream" }), `segment-${index}`);
      try {
        const r = await call(ctx.fetch, xAppendUrl(mediaId), { method: "POST", headers: bearer(ctx), body }, UPLOAD_TIMEOUT_MS);
        if (r.ok) sent = true;
        else if (r.status < 500) return uploadRefusal(r.status);
      } catch (err) {
        if (!(err instanceof NoAnswerError)) throw err;
      }
    }
    if (!sent) return { kind: "retry", error: UPLOAD_FAILED };
  }

  let fin;
  try {
    fin = await call(ctx.fetch, xFinalizeUrl(mediaId), { method: "POST", headers: bearer(ctx) });
  } catch {
    return { kind: "retry", error: UPLOAD_FAILED };
  }
  if (!fin.ok) return uploadRefusal(fin.status);
  ids = { ...ids, finalized: true };
  const p = processing(fin.body);
  if (p.state === null || p.state === "succeeded") ids = { ...ids, mediaReady: true };
  else if (p.state === "failed") return { kind: "failed", error: MEDIA_REJECTED };
  await ctx.save({ externalIds: ids });
  return ids;
}

/** Wait for X to finish processing the video, within the step's budget. */
async function awaitProcessing(ctx: SendContext, ids: XIds): Promise<StepOutcome | XIds> {
  let checkAfterS = 1;
  for (;;) {
    if (nearDeadline(ctx, (checkAfterS + 20) * 1000)) {
      return { kind: "wait", resumeAt: new Date(ctx.now().getTime() + checkAfterS * 1000) };
    }
    await ctx.sleep(checkAfterS * 1000);
    let res;
    try {
      res = await call(ctx.fetch, withQuery(X_MEDIA_STATUS_URL, { command: "STATUS", media_id: ids.mediaId }), { headers: bearer(ctx) });
    } catch {
      checkAfterS = 5;
      continue;
    }
    if (res.status === 401) return { kind: "reconnect" };
    if (!res.ok) {
      if (res.status === 429 || res.status >= 500) {
        checkAfterS = 10;
        continue;
      }
      return { kind: "failed", error: MEDIA_REJECTED };
    }
    const p = processing(res.body);
    if (p.state === "succeeded" || p.state === null) {
      const ready = { ...ids, mediaReady: true };
      await ctx.save({ externalIds: ready });
      return ready;
    }
    if (p.state === "failed") return { kind: "failed", error: MEDIA_REJECTED };
    checkAfterS = p.checkAfterS;
  }
}

/** The one call that makes it public. Built only from the consent object. */
export function xPostBody(ctx: Pick<SendContext, "consent">, mediaId: string): Record<string, unknown> {
  const body: Record<string, unknown> = {
    text: ctx.consent.text,
    media: { media_ids: [mediaId] },
    made_with_ai: true,
  };
  if (ctx.consent.commercial.paid_partnership) body.paid_partnership = true;
  return body;
}

async function publish(ctx: SendContext, ids: XIds): Promise<StepOutcome> {
  await ctx.save({ stage: "publishing" });
  let res;
  try {
    res = await call(ctx.fetch, X_TWEETS_URL, {
      method: "POST",
      headers: { ...bearer(ctx), "content-type": "application/json" },
      body: JSON.stringify(xPostBody(ctx, ids.mediaId as string)),
    });
  } catch {
    await ctx.save({ costUsd: X_POST_USD });
    return { kind: "unconfirmed" };
  }
  if (res.ok) {
    await ctx.save({ costUsd: X_POST_USD });
    const id = str(obj(obj(res.body).data).id, 64);
    if (!id) return { kind: "unconfirmed" };
    const handle = ctx.account.handle;
    return {
      kind: "published",
      externalPostId: id,
      permalink: handle ? `https://x.com/${encodeURIComponent(handle)}/status/${id}` : `https://x.com/i/web/status/${id}`,
    };
  }
  if (res.status >= 500) {
    await ctx.save({ costUsd: X_POST_USD });
    return { kind: "unconfirmed" };
  }
  if (res.status === 401) return { kind: "reconnect" };
  if (res.status === 429 || res.status === 402) return { kind: "busy", error: NETWORK_BUSY };
  const detail = `${String(obj(res.body).detail ?? "")} ${String(obj(res.body).title ?? "")}`;
  if (res.status === 403 && /duplicate/i.test(detail)) return { kind: "failed", error: X_REPEAT_REJECTED };
  return { kind: "failed", error: POST_REJECTED };
}

export const xPosting: PostingAdapter = {
  network: "x",
  maxUploadAttempts: X_MAX_UPLOAD_ATTEMPTS,
  async advance(ctx) {
    let ids = readIds(ctx.post.externalIds);
    const good = mediaStillGood(ids, ctx.now());

    if (!(good && ids.finalized)) {
      const up = await upload(ctx, ids);
      if ("kind" in up) return up;
      ids = up;
    }
    if (!ids.mediaReady) {
      const done = await awaitProcessing(ctx, ids);
      if ("kind" in done) return done;
      ids = done;
    }
    await ctx.save({ stage: "media_ready" });
    return publish(ctx, ids);
  },
};

/** For tests and Admin: the fetch the adapters take. */
export type { FetchLike };
