import { describe, expect, it } from "vitest";
import {
  INSTAGRAM_AUTHORIZE_URL,
  INSTAGRAM_EXCHANGE_URL,
  INSTAGRAM_GRAPH,
  INSTAGRAM_REFRESH_URL,
  INSTAGRAM_TOKEN_URL,
  instagramOAuth,
  instagramPosting,
} from "./instagram";
import { MEDIA_REJECTED, NETWORK_LIMIT_REACHED, THREADS_AI_TAG, UPLOAD_FAILED } from "./messages";
import { metaError } from "./meta";
import { T0, sendContext } from "./test-context";
import { formOf, json, scriptedFetch } from "./test-fetch";
import { THREADS_EXCHANGE_URL, THREADS_GRAPH, THREADS_TOKEN_URL, threadsOAuth, threadsPosting } from "./threads";

const creds = { clientId: "app", clientSecret: "secret" };
const IG = "1784";
const quota = (usage: number, total = 50) => json(200, { data: [{ quota_usage: usage, config: { quota_total: total, quota_duration: 86400 } }] });

describe("Meta's errors", () => {
  it("reads a bad key, a rate limit, the posting limit and a container not ready", () => {
    expect(metaError(400, { error: { code: 190, message: "Error validating access token" } }).kind).toBe("reconnect");
    expect(metaError(400, { error: { code: 4 } }).kind).toBe("busy");
    expect(metaError(400, { error: { code: 9, error_subcode: 2207042 } }).kind).toBe("limit");
    expect(metaError(400, { error: { code: 9007, error_subcode: 2207027 } }).kind).toBe("not_ready");
    expect(metaError(400, { error: { code: 100 } }).kind).toBe("refused");
  });
});

describe("Instagram: connecting (Instagram Login)", () => {
  it("asks for the two business scopes", () => {
    const url = new URL(instagramOAuth.authorizeUrl({ creds, redirectUri: "https://picacho.ai/api/social/instagram/callback", state: "S", codeChallenge: null }));
    expect(`${url.origin}${url.pathname}`).toBe(INSTAGRAM_AUTHORIZE_URL);
    expect(url.searchParams.get("scope")).toBe("instagram_business_basic,instagram_business_content_publish");
    expect(url.searchParams.get("client_id")).toBe("app");
  });

  it("trades the code for a short key, then a 60-day key, and names the professional account", async () => {
    const f = scriptedFetch([
      { method: "POST", url: INSTAGRAM_TOKEN_URL, reply: () => json(200, { data: [{ access_token: "SHORT", user_id: "1784", permissions: "instagram_business_basic,instagram_business_content_publish" }] }) },
      { url: INSTAGRAM_EXCHANGE_URL, reply: () => json(200, { access_token: "LONG", token_type: "bearer", expires_in: 5184000 }) },
      { url: `${INSTAGRAM_GRAPH}/me`, reply: () => json(200, { user_id: "1784", username: "brand", id: "app-scoped-9" }) },
    ]);
    const t = await instagramOAuth.exchangeCode(f.fetch, { creds, code: "CODE#_", redirectUri: "https://picacho.ai/api/social/instagram/callback", verifier: null, now: T0 });
    expect(t).toMatchObject({ accessToken: "LONG", refreshToken: null, externalId: "1784" });
    expect(t.accessExpiresAt?.toISOString()).toBe(new Date(T0.getTime() + 5_184_000_000).toISOString());
    expect(formOf(f.calls[0]).code).toBe("CODE");
    expect(new URL(f.calls[1].url).searchParams.get("grant_type")).toBe("ig_exchange_token");
    const p = await instagramOAuth.profile(f.fetch, { accessToken: "LONG", token: t });
    expect(p).toEqual({ externalId: "1784", handle: "brand", displayName: "brand" });
  });

  it("refreshes a 60-day key with the key itself; there is no revoke call", async () => {
    const f = scriptedFetch([{ url: INSTAGRAM_REFRESH_URL, reply: () => json(200, { access_token: "LONG2", expires_in: 5184000 }) }]);
    const r = await instagramOAuth.refresh(f.fetch, { creds, accessToken: "LONG", refreshToken: null, now: T0 });
    expect(r.ok && r.keys.accessToken).toBe("LONG2");
    expect(new URL(f.calls[0].url).searchParams.get("grant_type")).toBe("ig_refresh_token");
    expect(await instagramOAuth.revoke(f.fetch, { creds, token: "x", kind: "access" })).toBe("unsupported");
  });
});

describe("Instagram: posting a Reel", () => {
  it("container at send time with is_ai_generated → poll → publish ONCE → permalink", async () => {
    const f = scriptedFetch([
      { url: `${INSTAGRAM_GRAPH}/${IG}/content_publishing_limit`, reply: () => quota(3) },
      { method: "POST", url: `${INSTAGRAM_GRAPH}/${IG}/media`, times: 1, reply: () => json(200, { id: "C1" }) },
    ]);
    const first = sendContext({ network: "instagram", fetch: f.fetch });
    const out1 = await instagramPosting.advance(first.ctx);
    expect(out1.kind).toBe("wait");
    const container = formOf(f.calls.find((c) => c.url.endsWith("/media"))!);
    expect(container).toMatchObject({
      media_type: "REELS",
      caption: "Morning ritual.\n\n#coffee",
      share_to_feed: "true",
      is_ai_generated: "true",
      access_token: "ACCESS",
    });
    expect(container.video_url).toMatch(/^https:\/\/files\.test\/press-kit\/cut\.mp4\?ttl=\d+$/);
    expect(first.ctx.post.externalIds).toMatchObject({ containerId: "C1" });

    const g = scriptedFetch([
      { url: `${INSTAGRAM_GRAPH}/C1`, reply: () => json(200, { status_code: "FINISHED", id: "C1" }) },
      { url: `${INSTAGRAM_GRAPH}/${IG}/content_publishing_limit`, reply: () => quota(3) },
      { method: "POST", url: `${INSTAGRAM_GRAPH}/${IG}/media_publish`, times: 1, reply: () => json(200, { id: "17895695668004550" }) },
      { url: `${INSTAGRAM_GRAPH}/17895695668004550`, reply: () => json(200, { permalink: "https://www.instagram.com/reel/abc/" }) },
    ]);
    const second = sendContext({ network: "instagram", fetch: g.fetch, stage: "uploading", externalIds: first.ctx.post.externalIds, uploadAttempts: 1 });
    const out2 = await instagramPosting.advance(second.ctx);
    expect(out2).toEqual({ kind: "published", externalPostId: "17895695668004550", permalink: "https://www.instagram.com/reel/abc/" });
    expect(formOf(g.calls.find((c) => c.url.endsWith("/media_publish"))!)).toEqual({ creation_id: "C1", access_token: "ACCESS" });
    expect(second.saves.map((p) => p.stage).filter(Boolean)).toEqual(["media_ready", "publishing"]);
  });

  it("the account's posting limit reached: busy, nothing made", async () => {
    const f = scriptedFetch([{ url: `${INSTAGRAM_GRAPH}/${IG}/content_publishing_limit`, reply: () => quota(50) }]);
    expect(await instagramPosting.advance(sendContext({ network: "instagram", fetch: f.fetch }).ctx)).toEqual({ kind: "busy", error: NETWORK_LIMIT_REACHED });
    expect(f.calls.some((c) => c.url.endsWith("/media"))).toBe(false);
  });

  it("publish's answer lost → unconfirmed; a container that errors is final; one that expires is made again", async () => {
    const lost = scriptedFetch([
      { url: `${INSTAGRAM_GRAPH}/${IG}/content_publishing_limit`, reply: () => quota(1) },
      { method: "POST", url: `${INSTAGRAM_GRAPH}/${IG}/media_publish`, reply: () => "no-answer" },
    ]);
    expect(
      await instagramPosting.advance(sendContext({ network: "instagram", fetch: lost.fetch, stage: "media_ready", externalIds: { containerId: "C1", ready: true }, uploadAttempts: 1 }).ctx),
    ).toEqual({ kind: "unconfirmed" });

    const err = scriptedFetch([{ url: `${INSTAGRAM_GRAPH}/C1`, reply: () => json(200, { status_code: "ERROR" }) }]);
    expect(
      await instagramPosting.advance(sendContext({ network: "instagram", fetch: err.fetch, stage: "uploading", externalIds: { containerId: "C1", containerAt: T0.toISOString() }, uploadAttempts: 1 }).ctx),
    ).toEqual({ kind: "failed", error: MEDIA_REJECTED });

    const expired = scriptedFetch([{ url: `${INSTAGRAM_GRAPH}/C1`, reply: () => json(200, { status_code: "EXPIRED" }) }]);
    expect(
      await instagramPosting.advance(sendContext({ network: "instagram", fetch: expired.fetch, stage: "uploading", externalIds: { containerId: "C1", containerAt: T0.toISOString() }, uploadAttempts: 1 }).ctx),
    ).toEqual({ kind: "retry", error: UPLOAD_FAILED });
  });

  it("still processing: waits a minute, and after 20 minutes makes a new container", async () => {
    const f = scriptedFetch([{ url: `${INSTAGRAM_GRAPH}/C1`, reply: () => json(200, { status_code: "IN_PROGRESS" }) }]);
    const soon = await instagramPosting.advance(
      sendContext({ network: "instagram", fetch: f.fetch, stage: "uploading", externalIds: { containerId: "C1", containerAt: T0.toISOString() }, uploadAttempts: 1 }).ctx,
    );
    expect(soon.kind).toBe("wait");
    const late = await instagramPosting.advance(
      sendContext({
        network: "instagram",
        fetch: f.fetch,
        now: () => new Date(T0.getTime() + 21 * 60_000),
        stage: "uploading",
        externalIds: { containerId: "C1", containerAt: T0.toISOString() },
        uploadAttempts: 1,
      }).ctx,
    );
    expect(late).toEqual({ kind: "retry", error: UPLOAD_FAILED });
  });
});

describe("Threads", () => {
  it("connects with threads_basic and threads_content_publish, trading for a 60-day key", async () => {
    const url = new URL(threadsOAuth.authorizeUrl({ creds, redirectUri: "https://picacho.ai/api/social/threads/callback", state: "S", codeChallenge: null }));
    expect(url.searchParams.get("scope")).toBe("threads_basic,threads_content_publish");
    const f = scriptedFetch([
      { method: "POST", url: THREADS_TOKEN_URL, reply: () => json(200, { access_token: "SHORT", user_id: "th-1" }) },
      { url: THREADS_EXCHANGE_URL, reply: () => json(200, { access_token: "LONG", expires_in: 5184000 }) },
    ]);
    const t = await threadsOAuth.exchangeCode(f.fetch, { creds, code: "C", redirectUri: "https://picacho.ai/api/social/threads/callback", verifier: null, now: T0 });
    expect(t).toMatchObject({ accessToken: "LONG", externalId: "th-1" });
    expect(new URL(f.calls[1].url).searchParams.get("grant_type")).toBe("th_exchange_token");
  });

  it("posts a VIDEO whose text carries the visible Made with AI line, waiting 30 s before publishing", async () => {
    const f = scriptedFetch([{ method: "POST", url: `${THREADS_GRAPH}/1784/threads`, times: 1, reply: () => json(200, { id: "TC1" }) }]);
    const first = sendContext({ network: "threads", fetch: f.fetch });
    const out1 = await threadsPosting.advance(first.ctx);
    expect(out1).toEqual({ kind: "wait", resumeAt: new Date(T0.getTime() + 30_000) });
    const body = formOf(f.calls[0]);
    expect(body.media_type).toBe("VIDEO");
    expect(body.text).toBe(`Morning ritual.\n\n#coffee\n\n${THREADS_AI_TAG}`);

    const later = () => new Date(T0.getTime() + 40_000);
    const g = scriptedFetch([
      { url: `${THREADS_GRAPH}/TC1`, reply: () => json(200, { status: "FINISHED" }) },
      { method: "POST", url: `${THREADS_GRAPH}/1784/threads_publish`, times: 1, reply: () => json(200, { id: "TP1" }) },
      { url: `${THREADS_GRAPH}/TP1`, reply: () => json(200, { permalink: "https://www.threads.net/@brand/post/xyz" }) },
    ]);
    const second = sendContext({ network: "threads", fetch: g.fetch, now: later, stage: "uploading", externalIds: first.ctx.post.externalIds, uploadAttempts: 1 });
    expect(await threadsPosting.advance(second.ctx)).toEqual({ kind: "published", externalPostId: "TP1", permalink: "https://www.threads.net/@brand/post/xyz" });
    expect(formOf(g.calls.find((c) => c.url.endsWith("/threads_publish"))!)).toEqual({ creation_id: "TC1", access_token: "ACCESS" });
  });

  it("publish's answer lost → unconfirmed", async () => {
    const f = scriptedFetch([{ method: "POST", url: `${THREADS_GRAPH}/1784/threads_publish`, reply: () => "no-answer" }]);
    const { ctx } = sendContext({
      network: "threads",
      fetch: f.fetch,
      stage: "media_ready",
      externalIds: { containerId: "TC1", containerAt: new Date(T0.getTime() - 60_000).toISOString(), ready: true },
      uploadAttempts: 1,
    });
    expect(await threadsPosting.advance(ctx)).toEqual({ kind: "unconfirmed" });
  });
});
