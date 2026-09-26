// Threads (constraints §1 Meta, §5; Meta's Threads docs as read 2026-09-25):
//   connect   https://threads.net/oauth/authorize with threads_basic,
//             threads_content_publish; the code → a short key at
//             graph.threads.net/oauth/access_token → a 60-day key
//             (th_exchange_token), refreshed with th_refresh_token once at
//             least 24 h old. No revoke call.
//   post      at SEND time: POST /{user-id}/threads media_type=VIDEO,
//             video_url (the TAGGED cut), text → poll status → wait at least
//             30 s after creating it (Meta's advice) → POST
//             /{user-id}/threads_publish ONCE → permalink.
//   AI label  Threads has NO label field: the text carries a visible "Made
//             with AI" line (text.ts composeText), shown on the sheet before
//             consent, and the file carries the tag and its C2PA marking.
//   limits    500 characters of text; 250 posts a day per account.
//
// Alias-free (vitest has no '@/').

import type { OAuthAdapter, PostingAdapter, SendContext, StepOutcome, TokenAnswer } from "./adapter";
import { OAuthExchangeError } from "./adapter";
import { after, call, form, obj, str, withQuery } from "./http";
import { CONTAINER_PATIENCE_MS, META_MAX_UPLOAD_ATTEMPTS, META_MEDIA_URL_SECONDS, containerState, metaError } from "./meta";
import { MEDIA_REJECTED, NETWORK_BUSY, NETWORK_LIMIT_REACHED, POST_REJECTED, UPLOAD_FAILED } from "./messages";
import type { RefreshAnswer } from "./vault";

export const THREADS_GRAPH = "https://graph.threads.net/v1.0";
export const THREADS_AUTHORIZE_URL = "https://threads.net/oauth/authorize";
export const THREADS_TOKEN_URL = "https://graph.threads.net/oauth/access_token";
export const THREADS_EXCHANGE_URL = "https://graph.threads.net/access_token";
export const THREADS_REFRESH_URL = "https://graph.threads.net/refresh_access_token";
export const THREADS_SCOPES = ["threads_basic", "threads_content_publish"] as const;
/** Meta: "wait on average 30 seconds before publishing a Threads media container". */
export const THREADS_PUBLISH_DELAY_MS = 30_000;

export const threadsOAuth: OAuthAdapter = {
  network: "threads",
  scopes: THREADS_SCOPES,
  usesPkce: false,
  envKeys: { id: "THREADS_APP_ID", secret: "THREADS_APP_SECRET" },

  authorizeUrl({ creds, redirectUri, state }) {
    return withQuery(THREADS_AUTHORIZE_URL, {
      client_id: creds.clientId,
      redirect_uri: redirectUri,
      scope: THREADS_SCOPES.join(","),
      response_type: "code",
      state,
    });
  },

  async exchangeCode(fetchImpl, { creds, code, redirectUri, now }): Promise<TokenAnswer> {
    let short;
    try {
      short = await call(fetchImpl, THREADS_TOKEN_URL, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: form({ client_id: creds.clientId, client_secret: creds.clientSecret, grant_type: "authorization_code", redirect_uri: redirectUri, code }),
      });
    } catch {
      throw new OAuthExchangeError("threads", "no answer");
    }
    const b = obj(short.body);
    const shortToken = str(b.access_token, 4096);
    if (!short.ok || !shortToken) throw new OAuthExchangeError("threads", `token exchange ${short.status}`);
    let long;
    try {
      long = await call(fetchImpl, withQuery(THREADS_EXCHANGE_URL, { grant_type: "th_exchange_token", client_secret: creds.clientSecret, access_token: shortToken }));
    } catch {
      throw new OAuthExchangeError("threads", "no answer");
    }
    const lb = obj(long.body);
    const accessToken = str(lb.access_token, 4096);
    if (!long.ok || !accessToken) throw new OAuthExchangeError("threads", `long-lived exchange ${long.status}`);
    return {
      accessToken,
      refreshToken: null,
      accessExpiresAt: after(now, lb.expires_in),
      refreshExpiresAt: null,
      scopes: [...THREADS_SCOPES],
      externalId: str(b.user_id, 64),
    };
  },

  async profile(fetchImpl, { accessToken }) {
    let res;
    try {
      res = await call(fetchImpl, withQuery(`${THREADS_GRAPH}/me`, { fields: "id,username,name", access_token: accessToken }));
    } catch {
      throw new OAuthExchangeError("threads", "no answer");
    }
    const b = obj(res.body);
    const id = str(b.id, 64);
    if (!res.ok || !id) throw new OAuthExchangeError("threads", `profile ${res.status}`);
    return { externalId: id, handle: str(b.username, 100), displayName: str(b.name, 200) ?? str(b.username, 100) };
  },

  async refresh(fetchImpl, { accessToken, now }): Promise<RefreshAnswer> {
    let res;
    try {
      res = await call(fetchImpl, withQuery(THREADS_REFRESH_URL, { grant_type: "th_refresh_token", access_token: accessToken }));
    } catch {
      return { ok: false, reason: "unavailable" };
    }
    const b = obj(res.body);
    const token = str(b.access_token, 4096);
    if (res.ok && token) {
      return { ok: true, keys: { accessToken: token, refreshToken: null, accessExpiresAt: after(now, b.expires_in), refreshExpiresAt: null } };
    }
    return metaError(res.status, res.body).kind === "reconnect" ? { ok: false, reason: "invalid" } : { ok: false, reason: "unavailable" };
  },

  async revoke() {
    return "unsupported";
  },
};

type ThIds = { containerId?: string; containerAt?: string; ready?: boolean };

function readIds(raw: Record<string, unknown>): ThIds {
  return {
    containerId: typeof raw.containerId === "string" ? raw.containerId : undefined,
    containerAt: typeof raw.containerAt === "string" ? raw.containerAt : undefined,
    ready: raw.ready === true,
  };
}

/** The container's body, built ONLY from the consent object (its text carries "Made with AI") and the consented file's link. */
export function threadsContainerBody(ctx: Pick<SendContext, "consent" | "accessToken">, videoUrl: string): URLSearchParams {
  return form({ media_type: "VIDEO", video_url: videoUrl, text: ctx.consent.text, access_token: ctx.accessToken });
}

function refusal(status: number, body: unknown, whenRefused: StepOutcome): StepOutcome {
  const e = metaError(status, body);
  if (e.kind === "reconnect") return { kind: "reconnect" };
  if (e.kind === "limit") return { kind: "busy", error: NETWORK_LIMIT_REACHED };
  if (e.kind === "busy") return { kind: "busy", error: NETWORK_BUSY };
  return whenRefused;
}

export const threadsPosting: PostingAdapter = {
  network: "threads",
  maxUploadAttempts: META_MAX_UPLOAD_ATTEMPTS,
  async advance(ctx) {
    const ids = readIds(ctx.post.externalIds);
    const user = encodeURIComponent(ctx.account.externalId);

    if (!ids.containerId) {
      if (ctx.post.uploadAttempts >= META_MAX_UPLOAD_ATTEMPTS) return { kind: "failed", error: UPLOAD_FAILED };
      await ctx.save({ stage: "uploading", uploadAttempts: ctx.post.uploadAttempts + 1, externalIds: {} });
      const videoUrl = await ctx.media.publicUrl(META_MEDIA_URL_SECONDS);
      let res;
      try {
        res = await call(ctx.fetch, `${THREADS_GRAPH}/${user}/threads`, {
          method: "POST",
          headers: { "content-type": "application/x-www-form-urlencoded" },
          body: threadsContainerBody(ctx, videoUrl),
        });
      } catch {
        return { kind: "retry", error: UPLOAD_FAILED };
      }
      const id = str(obj(res.body).id, 64);
      if (!res.ok || !id) {
        if (res.status >= 500) return { kind: "retry", error: UPLOAD_FAILED };
        return refusal(res.status, res.body, { kind: "failed", error: MEDIA_REJECTED });
      }
      await ctx.save({ externalIds: { containerId: id, containerAt: ctx.now().toISOString() } });
      return { kind: "wait", resumeAt: new Date(ctx.now().getTime() + THREADS_PUBLISH_DELAY_MS) };
    }

    if (!ids.ready) {
      let res;
      try {
        res = await call(ctx.fetch, withQuery(`${THREADS_GRAPH}/${encodeURIComponent(ids.containerId)}`, { fields: "status,error_message", access_token: ctx.accessToken }));
      } catch {
        return { kind: "wait", resumeAt: new Date(ctx.now().getTime() + 60_000) };
      }
      if (!res.ok) {
        if (metaError(res.status, res.body).kind === "reconnect") return { kind: "reconnect" };
        return { kind: "wait", resumeAt: new Date(ctx.now().getTime() + 60_000) };
      }
      const state = containerState(res.body);
      if (state === "ERROR") return { kind: "failed", error: MEDIA_REJECTED };
      if (state === "EXPIRED") return { kind: "retry", error: UPLOAD_FAILED };
      if (state === "PUBLISHED") return { kind: "unconfirmed" };
      const age = ctx.now().getTime() - Date.parse(ids.containerAt ?? ctx.post.createdAt);
      if (state !== "FINISHED") {
        if (Number.isFinite(age) && age > CONTAINER_PATIENCE_MS) return { kind: "retry", error: UPLOAD_FAILED };
        return { kind: "wait", resumeAt: new Date(ctx.now().getTime() + 60_000) };
      }
      await ctx.save({ stage: "media_ready", externalIds: { ...ids, ready: true } });
      if (Number.isFinite(age) && age < THREADS_PUBLISH_DELAY_MS) {
        return { kind: "wait", resumeAt: new Date(ctx.now().getTime() + (THREADS_PUBLISH_DELAY_MS - age)) };
      }
    }

    await ctx.save({ stage: "publishing" });
    let res;
    try {
      res = await call(ctx.fetch, `${THREADS_GRAPH}/${user}/threads_publish`, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: form({ creation_id: ids.containerId, access_token: ctx.accessToken }),
      });
    } catch {
      return { kind: "unconfirmed" };
    }
    const postId = str(obj(res.body).id, 64);
    if (res.ok && postId) {
      let permalink: string | null = null;
      try {
        const p = await call(ctx.fetch, withQuery(`${THREADS_GRAPH}/${encodeURIComponent(postId)}`, { fields: "permalink", access_token: ctx.accessToken }), {}, 8_000);
        permalink = p.ok ? str(obj(p.body).permalink, 500) : null;
      } catch {
        permalink = null;
      }
      return { kind: "published", externalPostId: postId, permalink };
    }
    if (res.ok || res.status >= 500) return { kind: "unconfirmed" };
    const e = metaError(res.status, res.body);
    if (e.kind === "not_ready") {
      await ctx.save({ stage: "uploading", externalIds: { ...ids, ready: false } });
      return { kind: "wait", resumeAt: new Date(ctx.now().getTime() + 60_000) };
    }
    return refusal(res.status, res.body, { kind: "failed", error: POST_REJECTED });
  },
};
