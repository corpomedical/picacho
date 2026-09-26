// Instagram (constraints §1 Meta, §5, §6; Meta's docs as read 2026-09-25):
//   connect   Instagram Login (a professional account, no Facebook Page):
//             https://www.instagram.com/oauth/authorize with scopes
//             instagram_business_basic, instagram_business_content_publish;
//             the code (1 h, single use) → a short key at
//             api.instagram.com/oauth/access_token → a 60-day key
//             (ig_exchange_token), refreshed with ig_refresh_token once it
//             is at least 24 h old (the posts clock does it with 10 days
//             left). There is no revoke call: disconnecting deletes our copy.
//   post      at SEND time: read content_publishing_limit (plan for 50 a
//             day, read quota_total) → POST /{ig-id}/media media_type=REELS,
//             video_url (a short-lived link to the TAGGED cut), caption,
//             share_to_feed, is_ai_generated=true → poll status_code once a
//             minute → POST /{ig-id}/media_publish ONCE → permalink.
//   who       testers only until Meta's App Review passes
//             (press_post_meta; "Coming soon" for everyone else).
//
// Alias-free (vitest has no '@/').

import type { OAuthAdapter, PostingAdapter, SendContext, StepOutcome, TokenAnswer } from "./adapter";
import { OAuthExchangeError } from "./adapter";
import { after, call, form, num, obj, str, withQuery } from "./http";
import { CONTAINER_PATIENCE_MS, META_MAX_UPLOAD_ATTEMPTS, META_MEDIA_URL_SECONDS, containerState, metaError } from "./meta";
import { MEDIA_REJECTED, NETWORK_BUSY, NETWORK_LIMIT_REACHED, POST_REJECTED, UPLOAD_FAILED } from "./messages";
import type { RefreshAnswer } from "./vault";

export const INSTAGRAM_GRAPH = "https://graph.instagram.com/v25.0";
export const INSTAGRAM_AUTHORIZE_URL = "https://www.instagram.com/oauth/authorize";
export const INSTAGRAM_TOKEN_URL = "https://api.instagram.com/oauth/access_token";
export const INSTAGRAM_EXCHANGE_URL = "https://graph.instagram.com/access_token";
export const INSTAGRAM_REFRESH_URL = "https://graph.instagram.com/refresh_access_token";
export const INSTAGRAM_SCOPES = ["instagram_business_basic", "instagram_business_content_publish"] as const;

// ---------------------------------------------------------------------
// Connecting
// ---------------------------------------------------------------------

export const instagramOAuth: OAuthAdapter = {
  network: "instagram",
  scopes: INSTAGRAM_SCOPES,
  usesPkce: false,
  envKeys: { id: "INSTAGRAM_APP_ID", secret: "INSTAGRAM_APP_SECRET" },

  authorizeUrl({ creds, redirectUri, state }) {
    return withQuery(INSTAGRAM_AUTHORIZE_URL, {
      client_id: creds.clientId,
      redirect_uri: redirectUri,
      response_type: "code",
      scope: INSTAGRAM_SCOPES.join(","),
      state,
    });
  },

  async exchangeCode(fetchImpl, { creds, code, redirectUri, now }): Promise<TokenAnswer> {
    // Instagram appends "#_" to the code in the browser; it is not part of it.
    const clean = code.replace(/#_$/, "");
    let short;
    try {
      short = await call(fetchImpl, INSTAGRAM_TOKEN_URL, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: form({ client_id: creds.clientId, client_secret: creds.clientSecret, grant_type: "authorization_code", redirect_uri: redirectUri, code: clean }),
      });
    } catch {
      throw new OAuthExchangeError("instagram", "no answer");
    }
    // Answered either flat or as {data: [{...}]}.
    const b = obj(short.body);
    const first = Array.isArray(b.data) ? obj(b.data[0]) : b;
    const shortToken = str(first.access_token, 4096);
    const userId = str(first.user_id, 64);
    if (!short.ok || !shortToken) throw new OAuthExchangeError("instagram", `token exchange ${short.status}`);

    let long;
    try {
      long = await call(fetchImpl, withQuery(INSTAGRAM_EXCHANGE_URL, { grant_type: "ig_exchange_token", client_secret: creds.clientSecret, access_token: shortToken }));
    } catch {
      throw new OAuthExchangeError("instagram", "no answer");
    }
    const lb = obj(long.body);
    const accessToken = str(lb.access_token, 4096);
    if (!long.ok || !accessToken) throw new OAuthExchangeError("instagram", `long-lived exchange ${long.status}`);
    const permissions = Array.isArray(first.permissions) ? first.permissions.map((p) => String(p)) : typeof first.permissions === "string" ? first.permissions.split(",") : [];
    return {
      accessToken,
      refreshToken: null,
      accessExpiresAt: after(now, lb.expires_in),
      refreshExpiresAt: null,
      scopes: permissions,
      externalId: userId,
    };
  },

  async profile(fetchImpl, { accessToken }) {
    let res;
    try {
      res = await call(fetchImpl, withQuery(`${INSTAGRAM_GRAPH}/me`, { fields: "user_id,username", access_token: accessToken }));
    } catch {
      throw new OAuthExchangeError("instagram", "no answer");
    }
    const b = obj(res.body);
    // user_id is the professional account's id, the one content publishing names.
    const id = str(b.user_id, 64) ?? str(b.id, 64);
    if (!res.ok || !id) throw new OAuthExchangeError("instagram", `profile ${res.status}`);
    const username = str(b.username, 100);
    return { externalId: id, handle: username, displayName: username };
  },

  async refresh(fetchImpl, { accessToken, now }): Promise<RefreshAnswer> {
    let res;
    try {
      res = await call(fetchImpl, withQuery(INSTAGRAM_REFRESH_URL, { grant_type: "ig_refresh_token", access_token: accessToken }));
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

// ---------------------------------------------------------------------
// Posting
// ---------------------------------------------------------------------

type IgIds = { containerId?: string; containerAt?: string; ready?: boolean };

function readIds(raw: Record<string, unknown>): IgIds {
  return {
    containerId: typeof raw.containerId === "string" ? raw.containerId : undefined,
    containerAt: typeof raw.containerAt === "string" ? raw.containerAt : undefined,
    ready: raw.ready === true,
  };
}

/** The account's posting room today: false when content_publishing_limit says it is full. Unknown = room (Meta enforces it anyway). */
async function hasRoom(ctx: SendContext): Promise<boolean> {
  try {
    const res = await call(
      ctx.fetch,
      withQuery(`${INSTAGRAM_GRAPH}/${encodeURIComponent(ctx.account.externalId)}/content_publishing_limit`, {
        fields: "quota_usage,config",
        access_token: ctx.accessToken,
      }),
    );
    if (!res.ok) return true;
    const row = obj(Array.isArray(obj(res.body).data) ? (obj(res.body).data as unknown[])[0] : null);
    const usage = num(row.quota_usage);
    const total = num(obj(row.config).quota_total);
    return usage === null || total === null || usage < total;
  } catch {
    return true;
  }
}

/** The container's body, built ONLY from the consent object and the consented file's link. */
export function instagramContainerBody(ctx: Pick<SendContext, "consent" | "accessToken">, videoUrl: string): URLSearchParams {
  return form({
    media_type: "REELS",
    video_url: videoUrl,
    caption: ctx.consent.text,
    share_to_feed: true,
    is_ai_generated: true,
    access_token: ctx.accessToken,
  });
}

function refusal(status: number, body: unknown, whenRefused: StepOutcome): StepOutcome {
  const e = metaError(status, body);
  if (e.kind === "reconnect") return { kind: "reconnect" };
  if (e.kind === "limit") return { kind: "busy", error: NETWORK_LIMIT_REACHED };
  if (e.kind === "busy") return { kind: "busy", error: NETWORK_BUSY };
  return whenRefused;
}

async function createContainer(ctx: SendContext): Promise<StepOutcome> {
  if (ctx.post.uploadAttempts >= META_MAX_UPLOAD_ATTEMPTS) return { kind: "failed", error: UPLOAD_FAILED };
  if (!(await hasRoom(ctx))) return { kind: "busy", error: NETWORK_LIMIT_REACHED };
  await ctx.save({ stage: "uploading", uploadAttempts: ctx.post.uploadAttempts + 1, externalIds: {} });
  const videoUrl = await ctx.media.publicUrl(META_MEDIA_URL_SECONDS);
  let res;
  try {
    res = await call(ctx.fetch, `${INSTAGRAM_GRAPH}/${encodeURIComponent(ctx.account.externalId)}/media`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: instagramContainerBody(ctx, videoUrl),
    });
  } catch {
    // A container is not a post: making another is safe (an unused one expires in 24 h).
    return { kind: "retry", error: UPLOAD_FAILED };
  }
  const id = str(obj(res.body).id, 64);
  if (!res.ok || !id) {
    if (res.status >= 500) return { kind: "retry", error: UPLOAD_FAILED };
    return refusal(res.status, res.body, { kind: "failed", error: MEDIA_REJECTED });
  }
  await ctx.save({ externalIds: { containerId: id, containerAt: ctx.now().toISOString() } });
  return { kind: "wait", resumeAt: new Date(ctx.now().getTime() + 30_000) };
}

async function publish(ctx: SendContext, ids: IgIds): Promise<StepOutcome> {
  if (!(await hasRoom(ctx))) return { kind: "busy", error: NETWORK_LIMIT_REACHED };
  await ctx.save({ stage: "publishing" });
  let res;
  try {
    res = await call(ctx.fetch, `${INSTAGRAM_GRAPH}/${encodeURIComponent(ctx.account.externalId)}/media_publish`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: form({ creation_id: ids.containerId, access_token: ctx.accessToken }),
    });
  } catch {
    return { kind: "unconfirmed" };
  }
  const mediaId = str(obj(res.body).id, 64);
  if (res.ok && mediaId) {
    let permalink: string | null = null;
    try {
      const p = await call(ctx.fetch, withQuery(`${INSTAGRAM_GRAPH}/${encodeURIComponent(mediaId)}`, { fields: "permalink", access_token: ctx.accessToken }), {}, 8_000);
      permalink = p.ok ? str(obj(p.body).permalink, 500) : null;
    } catch {
      permalink = null;
    }
    return { kind: "published", externalPostId: mediaId, permalink };
  }
  if (res.ok || res.status >= 500) return { kind: "unconfirmed" };
  const e = metaError(res.status, res.body);
  if (e.kind === "not_ready") {
    // Not published: the container needs longer. Back to waiting on it.
    await ctx.save({ stage: "uploading", externalIds: { ...ids, ready: false } });
    return { kind: "wait", resumeAt: new Date(ctx.now().getTime() + 60_000) };
  }
  return refusal(res.status, res.body, { kind: "failed", error: POST_REJECTED });
}

export const instagramPosting: PostingAdapter = {
  network: "instagram",
  maxUploadAttempts: META_MAX_UPLOAD_ATTEMPTS,
  async advance(ctx) {
    const ids = readIds(ctx.post.externalIds);
    if (!ids.containerId) return createContainer(ctx);
    if (!ids.ready) {
      let res;
      try {
        res = await call(
          ctx.fetch,
          withQuery(`${INSTAGRAM_GRAPH}/${encodeURIComponent(ids.containerId)}`, { fields: "status_code,status", access_token: ctx.accessToken }),
        );
      } catch {
        return { kind: "wait", resumeAt: new Date(ctx.now().getTime() + 60_000) };
      }
      if (!res.ok) {
        const e = metaError(res.status, res.body);
        if (e.kind === "reconnect") return { kind: "reconnect" };
        return { kind: "wait", resumeAt: new Date(ctx.now().getTime() + 60_000) };
      }
      const state = containerState(res.body);
      if (state === "ERROR") return { kind: "failed", error: MEDIA_REJECTED };
      if (state === "EXPIRED") return { kind: "retry", error: UPLOAD_FAILED };
      if (state === "PUBLISHED") return { kind: "unconfirmed" };
      if (state !== "FINISHED") {
        const age = ctx.now().getTime() - Date.parse(ids.containerAt ?? ctx.post.createdAt);
        if (Number.isFinite(age) && age > CONTAINER_PATIENCE_MS) return { kind: "retry", error: UPLOAD_FAILED };
        return { kind: "wait", resumeAt: new Date(ctx.now().getTime() + 60_000) };
      }
      await ctx.save({ stage: "media_ready", externalIds: { ...ids, ready: true } });
    }
    return publish(ctx, { ...ids, ready: true });
  },
};
