import { describe, expect, it, vi } from "vitest";
import {
  CONNECTION_GONE,
  POST_ACCESS_LOST,
  POST_NO_LONGER_MATCHES,
  POST_UNCONFIRMED,
  POSTING_PAUSED,
  RECONNECT_NEEDED,
  TIKTOK_TEST_FULL,
  UPLOAD_FAILED,
  X_CLOSED_TODAY,
} from "./messages";
import { consentAndPost, previewPost } from "./publish-service";
import { CAMPAIGN, CUT, KEY_V1, KEY_V2, T0, USER, bench, sha } from "./test-harness";
import { formOf, json, jsonOf, type Route } from "./test-fetch";
import { INSTAGRAM_REFRESH_URL } from "./instagram";
import { connectionAad, keyringFromEnv, open, revocationAad, seal } from "./vault";
import { housekeeping, runPosts } from "./worker";
import { X_MEDIA_INIT_URL, X_REVOKE_URL, X_TOKEN_URL, X_TWEETS_URL, xAppendUrl, xFinalizeUrl } from "./x";

const admin = { userId: USER, via: "admin" as const };
const draftX = { campaignId: CAMPAIGN, network: "x" as const, caption: "Morning ritual.", hashtags: ["coffee"], x: { paidPartnership: false } };

async function queueX(b: ReturnType<typeof bench>, sendId = "send-000000001") {
  const p = await previewPost(b.service(), admin, draftX);
  if (!p.ok || !p.draft.consentToken) throw new Error("preview blocked");
  const r = await consentAndPost(b.service(), admin, { ...draftX, sendId, consentToken: p.draft.consentToken, locale: "en", uiVersion: "1" });
  if (!r.ok) throw new Error(r.error);
  return r.post.id;
}

function xRoutes(tweets: { n: number }, token = "x-access-1"): Route[] {
  const auth = (c: { headers: Record<string, string> }) => expect(c.headers.authorization).toBe(`Bearer ${token}`);
  return [
    { method: "POST", url: X_MEDIA_INIT_URL, reply: (c) => (auth(c), json(200, { data: { id: "M1", expires_after_secs: 86400 } })) },
    { method: "POST", url: xAppendUrl("M1"), reply: () => new Response(null, { status: 204 }) },
    { method: "POST", url: xFinalizeUrl("M1"), reply: () => json(200, { data: { id: "M1" } }) },
    { method: "POST", url: X_TWEETS_URL, reply: (c) => (auth(c), tweets.n++, json(201, { data: { id: "1790000000000000009" } })) },
  ];
}

describe("the worker: consent → sent, exactly once", () => {
  it("a 'Post now' goes out: uploaded at send time, the exact consented file, the label on, the cost kept", async () => {
    const b = bench();
    b.connect("x");
    const id = await queueX(b);
    const tweets = { n: 0 };
    b.routes = xRoutes(tweets);
    const report = await runPosts(b.worker(), { batch: 1, budgetMs: 240_000, postId: id });
    expect(report).toMatchObject({ claimed: 1, outcomes: { published: 1 } });
    const row = b.store.postsById.get(id)!;
    expect(row).toMatchObject({ stage: "published", externalPostId: "1790000000000000009", permalink: "https://x.com/brand/status/1790000000000000009", lockedAt: null, costUsd: 0.03 });
    expect(row.publishedAt).toBe(T0.toISOString());
    // The bytes uploaded are the tagged cut, all of them.
    expect(jsonOf(b.calls[0])).toMatchObject({ total_bytes: CUT.tagged.length });
    expect(jsonOf(b.calls.find((c) => c.url === X_TWEETS_URL)!)).toMatchObject({ made_with_ai: true, text: "Morning ritual.\n\n#coffee" });
    expect(b.xSlots).toBe(1);

    // Run again: a published post is never claimed again.
    const again = await runPosts(b.worker(), { batch: 5, budgetMs: 240_000 });
    expect(again.claimed).toBe(0);
    expect(tweets.n).toBe(1);
  });

  it("a worker that died mid-publish: the post becomes 'unconfirmed' and is NEVER sent again", async () => {
    const b = bench();
    b.connect("x");
    const id = await queueX(b);
    const row = b.store.postsById.get(id)!;
    row.stage = "publishing";
    row.lockedAt = new Date(T0.getTime() - 7 * 60_000).toISOString();
    row.externalIds = { mediaId: "M1", mediaExpiresAt: new Date(T0.getTime() + 20 * 3600_000).toISOString(), finalized: true, mediaReady: true };
    b.routes = [];
    const report = await runPosts(b.worker(), { batch: 1, budgetMs: 240_000 });
    expect(report.outcomes).toEqual({ unconfirmed: 1 });
    expect(b.store.postsById.get(id)).toMatchObject({ stage: "unconfirmed", lastError: POST_UNCONFIRMED });
    expect(b.calls).toHaveLength(0);
  });

  it("a worker that died mid-upload resumes from the media it saved (no second upload)", async () => {
    const b = bench();
    b.connect("x");
    const id = await queueX(b);
    const row = b.store.postsById.get(id)!;
    row.stage = "uploading";
    row.uploadAttempts = 1;
    row.lockedAt = new Date(T0.getTime() - 7 * 60_000).toISOString();
    row.externalIds = { mediaId: "M1", mediaExpiresAt: new Date(T0.getTime() + 20 * 3600_000).toISOString(), finalized: true, mediaReady: true };
    const tweets = { n: 0 };
    b.routes = xRoutes(tweets);
    await runPosts(b.worker(), { batch: 1, budgetMs: 240_000 });
    expect(b.calls.map((c) => c.url)).toEqual([X_TWEETS_URL]);
    expect(b.store.postsById.get(id)!.stage).toBe("published");
  });

  it("the row altered after consent (the words, the file) is refused before any call", async () => {
    const b = bench();
    b.connect("x");
    const id = await queueX(b);
    b.store.postsById.get(id)!.caption = "Something else entirely";
    b.routes = [];
    await runPosts(b.worker(), { batch: 1, budgetMs: 240_000 });
    expect(b.store.postsById.get(id)).toMatchObject({ stage: "failed", lastError: POST_NO_LONGER_MATCHES });
    expect(b.calls).toHaveLength(0);

    // A choice outside the words (a paid-partnership flag set after consent)
    // is caught by the consent hash alone.
    const e = bench();
    e.connect("x");
    const id4 = await queueX(e);
    e.store.postsById.get(id4)!.options = { ...e.store.postsById.get(id4)!.options, paid_partnership: true };
    e.routes = [];
    await runPosts(e.worker(), { batch: 1, budgetMs: 240_000 });
    expect(e.store.postsById.get(id4)).toMatchObject({ stage: "failed", lastError: POST_NO_LONGER_MATCHES });
    expect(e.calls).toHaveLength(0);

    const c = bench();
    c.connect("x");
    const id2 = await queueX(c);
    // The cut was made again after consent: not the file the person approved.
    c.store.campaigns.get(CAMPAIGN)!.renditions.tagged!.sha256 = sha(Buffer.from("other"));
    c.routes = [];
    await runPosts(c.worker(), { batch: 1, budgetMs: 240_000 });
    expect(c.store.postsById.get(id2)).toMatchObject({ stage: "failed", lastError: POST_NO_LONGER_MATCHES });

    const d = bench();
    d.connect("x");
    const id3 = await queueX(d);
    // The stored bytes changed under the same record: caught when read.
    d.store.files.set(`press-kit/${USER}/cuts/${CAMPAIGN}/tagged.mp4`, Buffer.from("tampered"));
    d.routes = [];
    await runPosts(d.worker(), { batch: 1, budgetMs: 240_000 });
    expect(d.store.postsById.get(id3)).toMatchObject({ stage: "failed", lastError: POST_NO_LONGER_MATCHES });
    expect(d.calls).toHaveLength(0);
  });

  it("the app-wide X ceiling: 0 or full = platform_busy, nothing sent", async () => {
    const b = bench();
    b.connect("x");
    const id = await queueX(b);
    b.xCap = 1;
    b.xSlots = 1;
    b.routes = [];
    await runPosts(b.worker(), { batch: 1, budgetMs: 240_000, postId: id });
    expect(b.store.postsById.get(id)).toMatchObject({ stage: "platform_busy", lastError: X_CLOSED_TODAY });
    expect(b.calls).toHaveLength(0);
  });

  it("access or switches changed since consent: stops before sending, and says why", async () => {
    const b = bench();
    b.connect("x");
    const id = await queueX(b);
    b.access = { ...b.access, pressTourOk: false };
    b.routes = [];
    await runPosts(b.worker(), { batch: 1, budgetMs: 240_000 });
    expect(b.store.postsById.get(id)).toMatchObject({ stage: "cancelled", lastError: POST_ACCESS_LOST });

    const c = bench();
    c.connect("x");
    const id2 = await queueX(c);
    c.access = { ...c.access, switches: { ...c.access.switches, press_tour_posting: false } };
    c.routes = [];
    await runPosts(c.worker(), { batch: 1, budgetMs: 240_000 });
    expect(c.store.postsById.get(id2)).toMatchObject({ stage: "platform_busy", lastError: POSTING_PAUSED });
  });

  it("the account was disconnected, or another one connected in its place: nothing posts", async () => {
    const b = bench();
    const conn = b.connect("x");
    const id = await queueX(b);
    b.store.conns.get(conn)!.externalId = "999";
    b.routes = [];
    await runPosts(b.worker(), { batch: 1, budgetMs: 240_000 });
    expect(b.store.postsById.get(id)).toMatchObject({ stage: "cancelled", lastError: CONNECTION_GONE });
  });

  it("token refresh rotation inside the worker: the new pair is sealed, the post uses the new key", async () => {
    const b = bench();
    const conn = b.connect("x", { accessExpiresAt: new Date(T0.getTime() + 60_000).toISOString() });
    const id = await queueX(b);
    const tweets = { n: 0 };
    b.routes = [
      { method: "POST", url: X_TOKEN_URL, times: 1, reply: (c) => (expect(formOf(c).refresh_token).toBe("x-refresh-1"), json(200, { access_token: "x-access-2", refresh_token: "x-refresh-2", expires_in: 7200 })) },
      ...xRoutes(tweets, "x-access-2"),
    ];
    await runPosts(b.worker(), { batch: 1, budgetMs: 240_000 });
    expect(b.store.postsById.get(id)!.stage).toBe("published");
    const keys = await b.store.readKeys(conn);
    expect(open(keys!.refresh!, connectionAad(conn, "refresh"), b.keyring)).toBe("x-refresh-2");
    expect(open(keys!.access, connectionAad(conn, "access"), b.keyring)).toBe("x-access-2");
  });

  it("a refused refresh: needs_reconnect, the account marked, the reconnect hook told", async () => {
    const b = bench();
    const conn = b.connect("x", { accessExpiresAt: new Date(T0.getTime() - 60_000).toISOString() });
    const id = await queueX(b);
    b.routes = [{ method: "POST", url: X_TOKEN_URL, reply: () => json(400, { error: "invalid_request", error_description: "Value passed for the token was invalid." }) }];
    await runPosts(b.worker(), { batch: 1, budgetMs: 240_000 });
    expect(b.store.postsById.get(id)).toMatchObject({ stage: "needs_reconnect", lastError: RECONNECT_NEEDED });
    expect(b.store.conns.get(conn)!.status).toBe("needs_reconnect");
    expect(b.reconnectHooks).toEqual([`${USER}:x`]);
  });

  it("an upload that fails is tried again after a backoff; X's second failure is final (one retry)", async () => {
    const b = bench();
    b.connect("x");
    const id = await queueX(b);
    b.routes = [{ method: "POST", url: X_MEDIA_INIT_URL, reply: () => json(503, {}) }];
    await runPosts(b.worker(), { batch: 1, budgetMs: 240_000, postId: id });
    const row = b.store.postsById.get(id)!;
    expect(row).toMatchObject({ stage: "retry", uploadAttempts: 1, lockedAt: null });
    expect(Date.parse(row.resumeAt!)).toBe(T0.getTime() + 60_000);
    // Not before its time...
    expect((await runPosts(b.worker(), { batch: 1, budgetMs: 240_000 })).claimed).toBe(0);
    // ...then once more, and that's the last.
    b.now.t = new Date(T0.getTime() + 61_000);
    await runPosts(b.worker(), { batch: 1, budgetMs: 240_000 });
    expect(b.store.postsById.get(id)).toMatchObject({ stage: "failed", lastError: UPLOAD_FAILED, uploadAttempts: 2 });
    // The app-wide slot was taken once, for the post, not per attempt.
    expect(b.xSlots).toBe(1);
  });

  it("TikTok in test mode: at most 5 people a day post through us", async () => {
    const b = bench();
    b.connect("tiktok");
    const d = {
      campaignId: CAMPAIGN,
      network: "tiktok" as const,
      caption: "Hi",
      hashtags: [],
      tiktok: { privacy: "SELF_ONLY" as const, allowComment: false, allowDuet: false, allowStitch: false, yourBrand: false, brandedContent: false },
    };
    const p = await previewPost(b.service(), admin, d);
    if (!p.ok || !p.draft.consentToken) throw new Error("blocked");
    b.routes = [
      {
        method: "POST",
        url: "https://open.tiktokapis.com/v2/post/publish/creator_info/query/",
        reply: () => json(200, { data: { creator_nickname: "B", creator_username: "b", privacy_level_options: ["SELF_ONLY"], max_video_post_duration_sec: 600 }, error: { code: "ok" } }),
      },
    ];
    const r = await consentAndPost(b.service(), admin, { ...d, sendId: "send-tt-00001", consentToken: p.draft.consentToken, locale: "en", uiVersion: "1" });
    if (!r.ok) throw new Error(r.error);
    // Five other people already posted to TikTok through us today.
    for (let i = 0; i < 5; i++) {
      b.store.postsById.set(`other-${i}`, { ...b.store.postsById.get(r.post.id)!, id: `other-${i}`, userId: `user-${i}`, stage: "published", idempotencyKey: `k${i}`.padEnd(64, "0") });
    }
    b.routes = [];
    await runPosts(b.worker(), { batch: 1, budgetMs: 240_000, postId: r.post.id });
    expect(b.store.postsById.get(r.post.id)).toMatchObject({ stage: "platform_busy", lastError: TIKTOK_TEST_FULL });
  });
});

describe("housekeeping", () => {
  it("retries an owed revoke and clears it once done", async () => {
    const b = bench();
    const id = "44444444-4444-4444-8444-444444444444";
    await b.store.addRevocation({ id, userId: USER, network: "x", externalId: "42", kind: "refresh", sealed: seal("owed-refresh", revocationAad(id, "refresh"), b.keyring) });
    b.routes = [{ method: "POST", url: X_REVOKE_URL, reply: (c) => (expect(formOf(c).token).toBe("owed-refresh"), json(200, {})) }];
    const out = await housekeeping(b.worker());
    expect(out.revokes).toBe(1);
    expect(b.store.revocations.size).toBe(0);
  });

  it("refreshes an Instagram 60-day key with under 10 days left", async () => {
    const b = bench();
    const conn = b.connect("instagram", { accessExpiresAt: new Date(T0.getTime() + 5 * 86_400_000).toISOString(), refresh: null, access: "ig-long-1" });
    b.store.conns.get(conn)!.lastRefreshedAt = new Date(T0.getTime() - 3 * 86_400_000).toISOString();
    b.routes = [{ url: INSTAGRAM_REFRESH_URL, reply: () => json(200, { access_token: "ig-long-2", expires_in: 5184000 }) }];
    const out = await housekeeping(b.worker());
    expect(out.refreshed).toBe(1);
    const keys = await b.store.readKeys(conn);
    expect(open(keys!.access, connectionAad(conn, "access"), b.keyring)).toBe("ig-long-2");
    expect(b.store.conns.get(conn)!.accessExpiresAt).toBe(new Date(T0.getTime() + 5_184_000_000).toISOString());
  });

  it("re-seals keys under the newest vault key (rotation)", async () => {
    const b = bench();
    const conn = b.connect("x");
    const w = b.worker();
    w.keyring = keyringFromEnv({ SOCIAL_TOKEN_KEY_V1: KEY_V1, SOCIAL_TOKEN_KEY_V2: KEY_V2 });
    const out = await housekeeping(w);
    expect(out.resealed).toBe(1);
    const keys = await b.store.readKeys(conn);
    expect(keys!.access.keyVersion).toBe(2);
    const onlyV2 = keyringFromEnv({ SOCIAL_TOKEN_KEY_V2: KEY_V2 })!;
    expect(open(keys!.access, connectionAad(conn, "access"), onlyV2)).toBe("x-access-1");
    expect(open(keys!.refresh!, connectionAad(conn, "refresh"), onlyV2)).toBe("x-refresh-1");
  });

  it("SECURITY (SEC-3): a revoke still owed is re-sealed on rotation, so removing the old key after a day still revokes it at the network", async () => {
    const b = bench();
    const id = "55555555-5555-4555-8555-555555555555";
    // Owed under V1 (the X revoke failed when the person disconnected).
    await b.store.addRevocation({ id, userId: USER, network: "x", externalId: "42", kind: "refresh", sealed: seal("owed-refresh", revocationAad(id, "refresh"), b.keyring) });
    b.store.revocations.get(id)!.nextAttemptAt = new Date(T0.getTime() + 86_400_000).toISOString(); // tried today already
    // Day 1: V2 added. The clock re-seals the owed revoke too.
    const rotating = b.worker();
    rotating.keyring = keyringFromEnv({ SOCIAL_TOKEN_KEY_V1: KEY_V1, SOCIAL_TOKEN_KEY_V2: KEY_V2 });
    const out = await housekeeping(rotating);
    expect(out.resealed).toBe(1);
    const sealed = b.store.revocations.get(id)!.sealed;
    expect(sealed.keyVersion).toBe(2);
    // Day 2: V1 removed, as the procedure says. The revoke still reaches X.
    const onlyV2 = b.worker();
    onlyV2.keyring = keyringFromEnv({ SOCIAL_TOKEN_KEY_V2: KEY_V2 });
    onlyV2.now = () => new Date(T0.getTime() + 2 * 86_400_000);
    let revoked: string | null = null;
    b.routes = [{ method: "POST", url: X_REVOKE_URL, reply: (c) => ((revoked = formOf(c).token), json(200, {})) }];
    const day2 = await housekeeping(onlyV2);
    expect(revoked).toBe("owed-refresh");
    expect(day2.revokes).toBe(1);
    expect(b.store.revocations.size).toBe(0);
  });

  it("an owed revoke whose seal no longer opens is kept and retried, never dropped as if there were nothing to revoke", async () => {
    const b = bench();
    const id = "66666666-6666-4666-8666-666666666666";
    await b.store.addRevocation({ id, userId: USER, network: "x", externalId: "42", kind: "refresh", sealed: seal("owed-refresh", revocationAad(id, "refresh"), b.keyring) });
    const w = b.worker();
    w.keyring = keyringFromEnv({ SOCIAL_TOKEN_KEY_V2: KEY_V2 }); // V1 gone before the clock re-sealed it
    const errors: unknown[] = [];
    const spy = vi.spyOn(console, "error").mockImplementation((m) => void errors.push(m));
    const out = await housekeeping(w);
    spy.mockRestore();
    expect(out.revokes).toBe(0);
    const kept = b.store.revocations.get(id)!;
    expect(kept).toMatchObject({ attempts: 1 });
    expect(kept.lastError).toMatch(/vault key version 1 is not in the environment/);
    expect(String(errors[0])).not.toContain("owed-refresh");
  });
});
