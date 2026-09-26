import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { resolvePushText } from "../push/text";
import { PREF_FOR_KEY } from "../push/prefs";
import { POST_NO_LONGER_MATCHES } from "./messages";
import { postNotice, reconnectNotice, reconnectPushScope } from "./notices";
import { consentAndPost, previewPost } from "./publish-service";
import { CAMPAIGN, T0, USER, bench } from "./test-harness";
import { json, type Route } from "./test-fetch";
import { runPosts, type SettledPost, type WorkerDeps } from "./worker";
import { X_MEDIA_INIT_URL, X_TWEETS_URL, xAppendUrl, xFinalizeUrl } from "./x";

// The posts worker's notices to the person (integration, 2026-09-26): the
// push keys the UI agent translated (postPublished, postFailed,
// reconnectNeeded) were never sent. The worker now says when a post settles;
// runtime.ts sends the push.

const admin = { userId: USER, via: "admin" as const };
const draftX = { campaignId: CAMPAIGN, network: "x" as const, caption: "Morning ritual.", hashtags: ["coffee"], x: { paidPartnership: false } };

async function queueX(b: ReturnType<typeof bench>) {
  const p = await previewPost(b.service(), admin, draftX);
  if (!p.ok || !p.draft.consentToken) throw new Error("preview blocked");
  const r = await consentAndPost(b.service(), admin, { ...draftX, sendId: "send-000000001", consentToken: p.draft.consentToken, locale: "en", uiVersion: "1" });
  if (!r.ok) throw new Error(r.error);
  return r.post.id;
}

const xRoutes = (): Route[] => [
  { method: "POST", url: X_MEDIA_INIT_URL, reply: () => json(200, { data: { id: "M1", expires_after_secs: 86400 } }) },
  { method: "POST", url: xAppendUrl("M1"), reply: () => new Response(null, { status: 204 }) },
  { method: "POST", url: xFinalizeUrl("M1"), reply: () => json(200, { data: { id: "M1" } }) },
  { method: "POST", url: X_TWEETS_URL, reply: () => json(201, { data: { id: "1790000000000000009" } }) },
];

function watched(b: ReturnType<typeof bench>): { deps: WorkerDeps; settled: string[] } {
  const settled: string[] = [];
  const deps: WorkerDeps = {
    ...b.worker(),
    onPostSettled: async (post: SettledPost, outcome) => {
      settled.push(`${post.id}:${post.network}:${post.campaignId}:${outcome}`);
    },
  };
  return { deps, settled };
}

describe("the worker says when a post settles, once", () => {
  it("published: told once, after the row says so; a second run tells nothing", async () => {
    const b = bench();
    b.connect("x");
    const id = await queueX(b);
    b.routes = xRoutes();
    const w = watched(b);
    await runPosts(w.deps, { batch: 1, budgetMs: 240_000, postId: id });
    expect(b.store.postsById.get(id)!.stage).toBe("published");
    expect(w.settled).toEqual([`${id}:x:${CAMPAIGN}:published`]);
    await runPosts(w.deps, { batch: 5, budgetMs: 240_000 });
    expect(w.settled).toHaveLength(1);
  });

  it("failed for good: told; unconfirmed and cancelled: not", async () => {
    const b = bench();
    b.connect("x");
    const id = await queueX(b);
    b.store.postsById.get(id)!.caption = "Something else entirely";
    b.routes = [];
    const w = watched(b);
    await runPosts(w.deps, { batch: 1, budgetMs: 240_000 });
    expect(b.store.postsById.get(id)).toMatchObject({ stage: "failed", lastError: POST_NO_LONGER_MATCHES });
    expect(w.settled).toEqual([`${id}:x:${CAMPAIGN}:failed`]);

    const u = bench();
    u.connect("x");
    const id2 = await queueX(u);
    const row = u.store.postsById.get(id2)!;
    row.stage = "publishing";
    row.lockedAt = new Date(T0.getTime() - 7 * 60_000).toISOString();
    u.routes = [];
    const wu = watched(u);
    await runPosts(wu.deps, { batch: 1, budgetMs: 240_000 });
    expect(u.store.postsById.get(id2)!.stage).toBe("unconfirmed");
    expect(wu.settled).toEqual([]);

    const c = bench();
    c.connect("x");
    await queueX(c);
    c.access = { ...c.access, pressTourOk: false };
    c.routes = [];
    const wc = watched(c);
    await runPosts(wc.deps, { batch: 1, budgetMs: 240_000 });
    expect(wc.settled).toEqual([]);
  });
});

describe("the notices", () => {
  const id = "44444444-4444-4444-8444-444444444444";

  it("a post's notice opens its ad's press line and names the network as the network does", () => {
    const post = { id, userId: USER, network: "tiktok" as const, campaignId: CAMPAIGN };
    expect(postNotice(post, "published")).toEqual({ key: "postPublished", params: { network: "TikTok" }, path: `/app/press-tour?campaign=${CAMPAIGN}#press-line` });
    expect(postNotice({ ...post, campaignId: null }, "failed")).toEqual({ key: "postFailed", params: { network: "TikTok" }, path: "/app/press-tour" });
    expect(reconnectNotice("x")).toEqual({ key: "reconnectNeeded", params: { network: "X" }, path: "/app/press-tour" });
    expect(reconnectPushScope("threads")).toBe("social-reconnect-push:threads");
  });

  it("every key has its words in four languages and a notification switch", () => {
    for (const notice of [postNotice({ id, userId: USER, network: "x", campaignId: CAMPAIGN }, "published"), postNotice({ id, userId: USER, network: "x", campaignId: null }, "failed"), reconnectNotice("instagram")]) {
      expect(PREF_FOR_KEY[notice.key], notice.key).toBeDefined();
      for (const locale of ["en", "es", "pt", "it"]) {
        const text = resolvePushText({ key: notice.key, params: notice.params }, locale);
        expect(text.title.length, `${notice.key} ${locale}`).toBeGreaterThan(0);
        expect(text.body, `${notice.key} ${locale}`).toContain(notice.params.network);
      }
    }
  });

  it("runtime.ts sends them: the settled hook and the reconnect hook, the latter once a day per account", () => {
    const runtime = readFileSync(join(__dirname, "runtime.ts"), "utf8");
    expect(runtime).toContain("onPostSettled: (post, outcome) => pushNotice(post.userId, postNotice(post, outcome)),");
    expect(runtime).toContain("onNeedsReconnect: (userId, network) => pushReconnect(userId, network),");
    expect(runtime).toContain("if (await rateLimited(userId, reconnectPushScope(network), 24 * 60 * 60, 1)) return;");
  });
});
