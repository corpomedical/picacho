import { describe, expect, it } from "vitest";
import { MEDIA_REJECTED, NETWORK_BUSY, UPLOAD_FAILED, X_REPEAT_REJECTED } from "./messages";
import { pkceChallenge } from "./oauth";
import { T0, consentFor, sendContext } from "./test-context";
import { formOf, json, jsonOf, scriptedFetch } from "./test-fetch";
import {
  X_AUTHORIZE_URL,
  X_MEDIA_INIT_URL,
  X_MEDIA_STATUS_URL,
  X_ME_URL,
  X_REVOKE_URL,
  X_TOKEN_URL,
  X_TWEETS_URL,
  xAppendUrl,
  xFinalizeUrl,
  xOAuth,
  xPosting,
} from "./x";

const creds = { clientId: "cid", clientSecret: "csecret" };
const basic = `Basic ${Buffer.from("cid:csecret").toString("base64")}`;

describe("X: connecting (OAuth 2.0 + PKCE, confidential client)", () => {
  it("asks for exactly the five scopes, with an S256 challenge and the exact redirect address", () => {
    const verifier = "v".repeat(64);
    const url = new URL(
      xOAuth.authorizeUrl({ creds, redirectUri: "https://picacho.ai/api/social/x/callback", state: "STATE", codeChallenge: pkceChallenge(verifier) }),
    );
    expect(`${url.origin}${url.pathname}`).toBe(X_AUTHORIZE_URL);
    expect(Object.fromEntries(url.searchParams)).toEqual({
      response_type: "code",
      client_id: "cid",
      redirect_uri: "https://picacho.ai/api/social/x/callback",
      scope: "tweet.read tweet.write users.read media.write offline.access",
      state: "STATE",
      code_challenge: pkceChallenge(verifier),
      code_challenge_method: "S256",
    });
  });

  it("exchanges the code with Basic auth and the verifier", async () => {
    const f = scriptedFetch([
      { method: "POST", url: X_TOKEN_URL, reply: () => json(200, { token_type: "bearer", expires_in: 7200, access_token: "AT", refresh_token: "RT", scope: "tweet.read tweet.write" }) },
    ]);
    const t = await xOAuth.exchangeCode(f.fetch, { creds, code: "CODE", redirectUri: "https://picacho.ai/api/social/x/callback", verifier: "VER", now: T0 });
    expect(t.accessToken).toBe("AT");
    expect(t.refreshToken).toBe("RT");
    expect(t.accessExpiresAt?.toISOString()).toBe(new Date(T0.getTime() + 7_200_000).toISOString());
    expect(f.calls[0].headers.authorization).toBe(basic);
    expect(formOf(f.calls[0])).toEqual({
      grant_type: "authorization_code",
      code: "CODE",
      redirect_uri: "https://picacho.ai/api/social/x/callback",
      code_verifier: "VER",
    });
  });

  it("reads the account from /2/users/me", async () => {
    const f = scriptedFetch([{ url: X_ME_URL, reply: () => json(200, { data: { id: "42", username: "brand", name: "Brand Co" } }) }]);
    const p = await xOAuth.profile(f.fetch, { accessToken: "AT", token: {} as never });
    expect(p).toEqual({ externalId: "42", handle: "brand", displayName: "Brand Co" });
    expect(f.calls[0].headers.authorization).toBe("Bearer AT");
  });

  it("refresh: hands back the ROTATED refresh key; a spent one reads as invalid; an outage as unavailable", async () => {
    const ok = scriptedFetch([{ method: "POST", url: X_TOKEN_URL, reply: () => json(200, { access_token: "AT2", refresh_token: "RT2", expires_in: 7200 }) }]);
    expect(await xOAuth.refresh(ok.fetch, { creds, accessToken: "AT", refreshToken: "RT", now: T0 })).toEqual({
      ok: true,
      keys: { accessToken: "AT2", refreshToken: "RT2", accessExpiresAt: new Date(T0.getTime() + 7_200_000), refreshExpiresAt: null },
    });
    expect(formOf(ok.calls[0])).toEqual({ grant_type: "refresh_token", refresh_token: "RT" });
    expect(ok.calls[0].headers.authorization).toBe(basic);

    const spent = scriptedFetch([
      { method: "POST", url: X_TOKEN_URL, reply: () => json(400, { error: "invalid_request", error_description: "Value passed for the token was invalid." }) },
    ]);
    expect(await xOAuth.refresh(spent.fetch, { creds, accessToken: "AT", refreshToken: "RT", now: T0 })).toEqual({ ok: false, reason: "invalid" });

    const down = scriptedFetch([{ method: "POST", url: X_TOKEN_URL, reply: () => json(503, {}) }]);
    expect(await xOAuth.refresh(down.fetch, { creds, accessToken: "AT", refreshToken: "RT", now: T0 })).toEqual({ ok: false, reason: "unavailable" });
  });

  it("revokes with Basic auth", async () => {
    const f = scriptedFetch([{ method: "POST", url: X_REVOKE_URL, reply: () => json(200, { revoked: true }) }]);
    expect(await xOAuth.revoke(f.fetch, { creds, token: "RT", kind: "refresh" })).toBe("done");
    expect(formOf(f.calls[0])).toEqual({ token: "RT", token_type_hint: "refresh_token" });
  });
});

describe("X: posting", () => {
  const nineMb = Buffer.alloc(9 * 1024 * 1024, 1);

  function happyRoutes(log: string[], saves: () => unknown[]) {
    return [
      {
        method: "POST",
        url: X_MEDIA_INIT_URL,
        times: 1,
        reply: () => {
          log.push("init");
          return json(200, { data: { id: "M1", media_key: "13_M1", expires_after_secs: 86400 } });
        },
      },
      {
        method: "POST",
        url: xAppendUrl("M1"),
        reply: (c: { body: unknown }) => {
          // The media id is saved before the first byte goes.
          expect(JSON.stringify(saves())).toContain('"mediaId":"M1"');
          log.push(`append:${(c.body as FormData).get("segment_index")}`);
          return new Response(null, { status: 204 });
        },
      },
      {
        method: "POST",
        url: xFinalizeUrl("M1"),
        reply: () => {
          log.push("finalize");
          return json(200, { data: { id: "M1", processing_info: { state: "pending", check_after_secs: 1 } } });
        },
      },
      {
        url: X_MEDIA_STATUS_URL,
        reply: () => {
          log.push("status");
          return json(200, { data: { id: "M1", processing_info: { state: "succeeded" } } });
        },
      },
    ];
  }

  it("uploads at send time in ≤ 5 MB segments, waits for processing, and posts ONCE with made_with_ai", async () => {
    const log: string[] = [];
    let saves: unknown[] = [];
    const f = scriptedFetch([
      ...happyRoutes(log, () => saves),
      {
        method: "POST",
        url: X_TWEETS_URL,
        times: 1,
        reply: () => {
          log.push("tweet");
          return json(201, { data: { id: "1790000000000000001", text: "…" } });
        },
      },
    ]);
    const { ctx, saves: s, cost } = sendContext({ network: "x", fetch: f.fetch, bytes: nineMb });
    saves = s;
    const out = await xPosting.advance(ctx);
    expect(out).toEqual({ kind: "published", externalPostId: "1790000000000000001", permalink: "https://x.com/brand/status/1790000000000000001" });
    expect(log).toEqual(["init", "append:0", "append:1", "append:2", "finalize", "status", "tweet"]);
    const init = jsonOf(f.calls[0]);
    expect(init).toEqual({ media_type: "video/mp4", total_bytes: nineMb.length, media_category: "tweet_video" });
    const tweet = jsonOf(f.calls.find((c) => c.url === X_TWEETS_URL)!);
    expect(tweet).toEqual({ text: "Morning ritual.\n\n#coffee", media: { media_ids: ["M1"] }, made_with_ai: true });
    // 'publishing' is written BEFORE the call that makes it public.
    const stages = s.map((p) => p.stage).filter(Boolean);
    expect(stages).toEqual(["uploading", "media_ready", "publishing"]);
    // $0.015 for the video + $0.015 for the post.
    expect(cost()).toBe(0.03);
    for (const c of f.calls) expect(c.headers.authorization).toBe("Bearer ACCESS");
  });

  it("a paid partnership the person ticked goes with the post", async () => {
    const f = scriptedFetch([{ method: "POST", url: X_TWEETS_URL, reply: () => json(201, { data: { id: "9" } }) }]);
    const consent = consentFor("x", { x: { paidPartnership: true } });
    const { ctx } = sendContext({
      network: "x",
      fetch: f.fetch,
      consent,
      stage: "media_ready",
      externalIds: { mediaId: "M1", mediaExpiresAt: new Date(T0.getTime() + 20 * 3600_000).toISOString(), finalized: true, mediaReady: true },
      uploadAttempts: 1,
    });
    await xPosting.advance(ctx);
    expect(jsonOf(f.calls[0])).toMatchObject({ made_with_ai: true, paid_partnership: true });
  });

  it("idempotent retry: a resumed post uses the media it saved and never uploads it again", async () => {
    const f = scriptedFetch([{ method: "POST", url: X_TWEETS_URL, times: 1, reply: () => json(201, { data: { id: "7" } }) }]);
    const { ctx } = sendContext({
      network: "x",
      fetch: f.fetch,
      stage: "uploading",
      externalIds: { mediaId: "M9", mediaExpiresAt: new Date(T0.getTime() + 20 * 3600_000).toISOString(), finalized: true, mediaReady: true },
      uploadAttempts: 1,
    });
    const out = await xPosting.advance(ctx);
    expect(out.kind).toBe("published");
    expect(f.calls.map((c) => c.url)).toEqual([X_TWEETS_URL]);
    expect(jsonOf(f.calls[0]).media).toEqual({ media_ids: ["M9"] });
  });

  it("media that expired (86,400 s) is uploaded again at send time", async () => {
    const log: string[] = [];
    let saves: unknown[] = [];
    const f = scriptedFetch([...happyRoutes(log, () => saves), { method: "POST", url: X_TWEETS_URL, reply: () => json(201, { data: { id: "8" } }) }]);
    const { ctx, saves: s } = sendContext({
      network: "x",
      fetch: f.fetch,
      stage: "retry",
      externalIds: { mediaId: "OLD", mediaExpiresAt: new Date(T0.getTime() + 10 * 60_000).toISOString(), finalized: true, mediaReady: true },
      uploadAttempts: 1,
    });
    saves = s;
    expect((await xPosting.advance(ctx)).kind).toBe("published");
    expect(log[0]).toBe("init");
  });

  it("the post call's answer lost → unconfirmed (never sent twice); its cost is still recorded", async () => {
    const f = scriptedFetch([{ method: "POST", url: X_TWEETS_URL, times: 1, reply: () => "no-answer" }]);
    const { ctx, saves, cost } = sendContext({
      network: "x",
      fetch: f.fetch,
      stage: "media_ready",
      externalIds: { mediaId: "M1", mediaExpiresAt: new Date(T0.getTime() + 20 * 3600_000).toISOString(), finalized: true, mediaReady: true },
      uploadAttempts: 1,
    });
    expect(await xPosting.advance(ctx)).toEqual({ kind: "unconfirmed" });
    expect(saves.some((p) => p.stage === "publishing")).toBe(true);
    expect(cost()).toBe(0.015);
    expect(f.calls.filter((c) => c.url === X_TWEETS_URL)).toHaveLength(1);
  });

  it.each([
    [500, { kind: "unconfirmed" }],
    [429, { kind: "busy", error: NETWORK_BUSY }],
    [401, { kind: "reconnect" }],
    [403, { kind: "failed", error: X_REPEAT_REJECTED }],
  ])("the post answered %i", async (status, expected) => {
    const body = status === 403 ? { title: "Forbidden", detail: "You are not allowed to create a Tweet with duplicate content.", status: 403 } : {};
    const f = scriptedFetch([{ method: "POST", url: X_TWEETS_URL, reply: () => json(status, body) }]);
    const { ctx } = sendContext({
      network: "x",
      fetch: f.fetch,
      stage: "media_ready",
      externalIds: { mediaId: "M1", mediaExpiresAt: new Date(T0.getTime() + 20 * 3600_000).toISOString(), finalized: true, mediaReady: true },
      uploadAttempts: 1,
    });
    expect(await xPosting.advance(ctx)).toEqual(expected);
  });

  it("an upload step that fails is a retry; X gets at most one retry (v2 #23)", async () => {
    const down = scriptedFetch([{ method: "POST", url: X_MEDIA_INIT_URL, reply: () => json(503, {}) }]);
    const first = sendContext({ network: "x", fetch: down.fetch });
    expect(await xPosting.advance(first.ctx)).toEqual({ kind: "retry", error: UPLOAD_FAILED });
    expect(first.ctx.post.uploadAttempts).toBe(1);

    const silent = scriptedFetch([{ method: "POST", url: X_MEDIA_INIT_URL, reply: () => "no-answer" }]);
    expect(await xPosting.advance(sendContext({ network: "x", fetch: silent.fetch, uploadAttempts: 1 }).ctx)).toEqual({ kind: "retry", error: UPLOAD_FAILED });

    const none = scriptedFetch([]);
    expect(await xPosting.advance(sendContext({ network: "x", fetch: none.fetch, uploadAttempts: 2 }).ctx)).toEqual({ kind: "failed", error: UPLOAD_FAILED });
    expect(none.calls).toHaveLength(0);
  });

  it("X turning the video down is final; a rate limit is busy", async () => {
    const bad = scriptedFetch([{ method: "POST", url: X_MEDIA_INIT_URL, reply: () => json(400, { detail: "bad media" }) }]);
    expect(await xPosting.advance(sendContext({ network: "x", fetch: bad.fetch }).ctx)).toEqual({ kind: "failed", error: MEDIA_REJECTED });
    const busy = scriptedFetch([{ method: "POST", url: X_MEDIA_INIT_URL, reply: () => json(429, {}) }]);
    expect(await xPosting.advance(sendContext({ network: "x", fetch: busy.fetch }).ctx)).toEqual({ kind: "busy", error: NETWORK_BUSY });
  });

  it("long processing: waits with the lease released instead of holding the step", async () => {
    const f = scriptedFetch([
      { method: "POST", url: X_MEDIA_INIT_URL, reply: () => json(200, { data: { id: "M1", expires_after_secs: 86400 } }) },
      { method: "POST", url: xAppendUrl("M1"), reply: () => new Response(null, { status: 204 }) },
      { method: "POST", url: xFinalizeUrl("M1"), reply: () => json(200, { data: { id: "M1", processing_info: { state: "in_progress", check_after_secs: 5 } } }) },
    ]);
    const { ctx, saves } = sendContext({ network: "x", fetch: f.fetch, deadlineMs: 10_000 });
    const out = await xPosting.advance(ctx);
    expect(out.kind).toBe("wait");
    expect(saves.at(-1)?.externalIds).toMatchObject({ mediaId: "M1", finalized: true });
    expect(f.calls.some((c) => c.url === X_TWEETS_URL)).toBe(false);
  });
});
