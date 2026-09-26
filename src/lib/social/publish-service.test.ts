import { describe, expect, it } from "vitest";
import { NOT_YOURS } from "../press-tour/owned";
import {
  CAPTION_REFUSED_AD_RULES,
  CONNECT_ON_COMPUTER,
  CONNECT_OTHER_SITE,
  CONNECTION_GONE,
  CUT_CHANGED,
  CUT_NOT_READY,
  CUT_WARNING_MISMATCH,
  DAILY_LIMIT_NETWORK,
  DUPLICATE_POST,
  NOT_CONNECTED,
  POST_NOT_CANCELLABLE,
  POST_RATE_LIMIT,
  POSTING_NOT_OPEN,
  SCHEDULE_TIKTOK,
  SCHEDULE_TOO_SOON,
  THREADS_AI_TAG,
  TIKTOK_PRIVACY_REQUIRED,
  TIKTOK_TEST_ONLY_ME,
  TRIAL_X_ONCE,
  X_CLOSED_TODAY,
  X_NO_LINKS,
} from "./messages";
import { pkceChallenge, stateHash } from "./oauth";
import {
  cancelPost,
  completeConnect,
  consentAndPost,
  consentAndSchedule,
  disconnect,
  idempotencyKey,
  listConnections,
  previewPost,
  startConnect,
} from "./publish-service";
import { CAMPAIGN, OTHER, T0, USER, bench } from "./test-harness";
import { formOf, json } from "./test-fetch";
import { TIKTOK_CREATOR_INFO_URL } from "./tiktok";
import { connectionAad, open } from "./vault";
import { X_ME_URL, X_REVOKE_URL, X_TOKEN_URL } from "./x";

const admin = { userId: USER, via: "admin" as const };
const draftX = { campaignId: CAMPAIGN, network: "x" as const, caption: "Morning ritual.", hashtags: ["coffee"], x: { paidPartnership: false } };
const meta = (token: string, sendId = "send-000000001") => ({ sendId, consentToken: token, locale: "en", uiVersion: "press-line-1" });

async function tokenFor(b: ReturnType<typeof bench>, input: Parameters<typeof previewPost>[2]) {
  const p = await previewPost(b.service(), admin, input);
  if (!p.ok) throw new Error(p.error);
  if (!p.draft.consentToken) throw new Error(`blocked: ${p.draft.blockers.join(" | ")}`);
  return p.draft.consentToken;
}

describe("connections: who sees what", () => {
  it("each network's honest state", async () => {
    const b = bench();
    b.connect("tiktok");
    b.access = { ...b.access, isAdmin: false, testerNetworks: ["tiktok"] };
    const rows = await listConnections(b.service(), admin);
    expect(rows.map((r) => [r.network, r.status])).toEqual([
      ["x", "coming_soon"], // press_post_x off and not a tester
      ["tiktok", "test_mode"], // a listed TikTok tester, connected, before the audit
      ["instagram", "coming_soon"], // Meta: testers only
      ["threads", "coming_soon"],
    ]);
    expect(rows[1]).toMatchObject({ handle: "brand", displayName: "Brand Co", testMode: true, canConnect: true });
  });

  it("the master switch off closes every network", async () => {
    const b = bench();
    b.access = { ...b.access, switches: { ...b.access.switches, press_tour_posting: false } };
    expect((await listConnections(b.service(), admin)).every((r) => r.status === "coming_soon" && !r.canConnect)).toBe(true);
  });

  it("in the phone app: connect on a computer", async () => {
    const b = bench();
    b.native = true;
    const rows = await listConnections(b.service(), admin);
    expect(rows[0]).toMatchObject({ status: "not_connected", canConnect: false, webOnly: true, note: CONNECT_ON_COMPUTER });
    expect(await startConnect(b.service(), admin, { network: "x" })).toEqual({ ok: false, error: CONNECT_ON_COMPUTER });
  });
});

describe("connecting: the state is bound to the person who pressed Connect", () => {
  it("X: the address carries PKCE S256; only the state's hash and the verifier are stored", async () => {
    const b = bench();
    const r = await startConnect(b.service(), admin, { network: "x", returnTo: "https://evil.example/app" });
    expect(r.ok).toBe(true);
    const url = new URL((r as { url: string }).url);
    const state = url.searchParams.get("state")!;
    const stored = b.store.states.get(stateHash(state))!;
    expect(stored.userId).toBe(USER);
    expect(stored.returnTo).toBe("/app/press-tour");
    expect(url.searchParams.get("code_challenge")).toBe(pkceChallenge(stored.pkceVerifier!));
    expect(url.searchParams.get("redirect_uri")).toBe("https://picacho.ai/api/social/x/callback");
    expect([...b.store.states.keys()]).not.toContain(state);
  });

  it("refused on the other domain, and when posting there isn't open", async () => {
    const b = bench();
    b.sameSite = false;
    expect(await startConnect(b.service(), admin, { network: "x" })).toEqual({ ok: false, error: CONNECT_OTHER_SITE });
    const c = bench();
    c.access = { ...c.access, isAdmin: false };
    expect(await startConnect(c.service(), admin, { network: "instagram" })).toEqual({ ok: false, error: POSTING_NOT_OPEN });
  });

  async function started(b: ReturnType<typeof bench>) {
    const r = await startConnect(b.service(), admin, { network: "x", returnTo: "/app/press-tour?campaign=1" });
    return new URL((r as { url: string }).url).searchParams.get("state")!;
  }

  it("the callback keeps the keys sealed, never in the clear", async () => {
    const b = bench();
    const state = await started(b);
    b.routes = [
      { method: "POST", url: X_TOKEN_URL, reply: () => json(200, { access_token: "AT-new", refresh_token: "RT-new", expires_in: 7200, scope: "tweet.read tweet.write users.read media.write offline.access" }) },
      { url: X_ME_URL, reply: () => json(200, { data: { id: "42", username: "brand", name: "Brand Co" } }) },
    ];
    const out = await completeConnect(b.service(), { network: "x", params: new URLSearchParams({ state, code: "CODE" }), sessionUserId: USER });
    expect(out).toEqual({ redirect: "/app/press-tour?campaign=1&connected=x", connected: true });
    const conn = [...b.store.conns.values()][0];
    expect(conn).toMatchObject({ userId: USER, network: "x", externalId: "42", handle: "brand", status: "connected" });
    const secret = b.store.secrets.get(conn.id)!;
    expect(JSON.stringify(secret)).not.toContain("AT-new");
    expect(JSON.stringify(secret)).not.toContain("RT-new");
    expect(open(secret.access, connectionAad(conn.id, "access"), b.keyring)).toBe("AT-new");
    expect(open(secret.refresh!, connectionAad(conn.id, "refresh"), b.keyring)).toBe("RT-new");
    expect(formOf(b.calls[0]).code_verifier).toBe(b.store.states.get(stateHash(state))!.pkceVerifier);
  });

  it("another signed-in person can't finish someone's connect; the state is spent either way", async () => {
    const b = bench();
    const state = await started(b);
    const out = await completeConnect(b.service(), { network: "x", params: new URLSearchParams({ state, code: "CODE" }), sessionUserId: OTHER });
    expect(out.redirect).toContain("connect_error=session");
    expect(b.calls).toHaveLength(0);
    const again = await completeConnect(b.service(), { network: "x", params: new URLSearchParams({ state, code: "CODE" }), sessionUserId: USER });
    expect(again.redirect).toContain("connect_error=expired");
  });

  it("expired, unknown, for another network, or declined", async () => {
    const b = bench();
    const state = await started(b);
    b.now.t = new Date(T0.getTime() + 11 * 60_000);
    expect((await completeConnect(b.service(), { network: "x", params: new URLSearchParams({ state, code: "C" }), sessionUserId: USER })).redirect).toContain("connect_error=expired");
    const c = bench();
    const s2 = await started(c);
    expect((await completeConnect(c.service(), { network: "tiktok", params: new URLSearchParams({ state: s2, code: "C" }), sessionUserId: USER })).redirect).toContain("connect_error=expired");
    const d = bench();
    const s3 = await started(d);
    expect((await completeConnect(d.service(), { network: "x", params: new URLSearchParams({ state: s3, error: "access_denied" }), sessionUserId: USER })).redirect).toContain("connect_error=denied");
    expect((await completeConnect(d.service(), { network: "x", params: new URLSearchParams({ state: "made-up", code: "C" }), sessionUserId: USER })).redirect).toContain("connect_error=expired");
  });

  it("a different account on the same network replaces the old one: its queued posts stop and its keys are revoked", async () => {
    const b = bench();
    const oldId = b.connect("x", { externalId: "41" });
    b.store.postsById.set("p-old", {
      ...(await seedQueuedPost(b, oldId)),
    });
    const state = await started(b);
    const revoked: string[] = [];
    b.routes = [
      { method: "POST", url: X_TOKEN_URL, reply: () => json(200, { access_token: "AT2", refresh_token: "RT2", expires_in: 7200 }) },
      { url: X_ME_URL, reply: () => json(200, { data: { id: "42", username: "brand2" } }) },
      { method: "POST", url: X_REVOKE_URL, reply: (c) => (revoked.push(formOf(c).token), json(200, { revoked: true })) },
    ];
    const out = await completeConnect(b.service(), { network: "x", params: new URLSearchParams({ state, code: "C" }), sessionUserId: USER });
    expect(out.connected).toBe(true);
    expect(revoked.sort()).toEqual(["x-access-1", "x-refresh-1"]);
    expect(b.store.postsById.get("p-old")!.stage).toBe("cancelled");
    expect(b.store.postsById.get("p-old")!.lastError).toBe(CONNECTION_GONE);
    expect([...b.store.conns.values()].map((c) => c.externalId)).toEqual(["42"]);
  });
});

async function seedQueuedPost(b: ReturnType<typeof bench>, connectionId: string) {
  const r = await b.store.insertPost({
    userId: USER,
    campaignId: CAMPAIGN,
    generationId: null,
    connectionId,
    network: "x",
    accountExternalId: "41",
    rendition: "tagged",
    renditionPath: "p",
    renditionSha256: "a".repeat(64),
    caption: "",
    hashtags: [],
    finalText: "",
    options: { when: "scheduled" },
    aiLabel: true,
    consent: null,
    payloadSha256: "b".repeat(64),
    idempotencyKey: "k".repeat(64),
    stage: "queued",
    scheduledFor: new Date(T0.getTime() + 3600_000).toISOString(),
    trendDerived: false,
  });
  if (!r.ok) throw new Error("seed");
  b.store.postsById.delete(r.post.id);
  return { ...r.post, id: "p-old" };
}

describe("the preview: exactly what will publish", () => {
  it("X: the text, the forced label, link in bio, and a consent token", async () => {
    const b = bench();
    b.connect("x");
    const p = await previewPost(b.service(), admin, draftX);
    expect(p.ok).toBe(true);
    if (!p.ok) return;
    expect(p.draft).toMatchObject({
      rendition: "tagged",
      finalText: "Morning ritual.\n\n#coffee",
      aiLabel: true,
      canSchedule: true,
      blockers: [],
      account: { handle: "brand" },
      cutWarning: null,
    });
    expect(p.draft.consentToken).toMatch(/^[0-9a-f]{64}$/);
    expect(p.draft.videoUrl).toContain("tagged.mp4");
  });

  it("Threads shows its Made with AI line before consent; TikTok gets the clean file", async () => {
    const b = bench();
    b.connect("threads");
    b.connect("tiktok");
    const th = await previewPost(b.service(), admin, { ...draftX, network: "threads" });
    expect(th.ok && th.draft.finalText.endsWith(THREADS_AI_TAG)).toBe(true);
    expect(th.ok && th.draft.captionTag).toBe(THREADS_AI_TAG);
    const tt = await previewPost(b.service(), admin, { ...draftX, network: "tiktok", tiktok: null });
    expect(tt.ok && tt.draft.rendition).toBe("clean");
    expect(tt.ok && tt.draft.canSchedule).toBe(false);
  });

  it("every blocker is plain and named", async () => {
    const b = bench();
    const none = await previewPost(b.service(), admin, draftX);
    expect(none.ok && none.draft.blockers).toEqual([NOT_CONNECTED]);
    b.connect("x");
    const link = await previewPost(b.service(), admin, { ...draftX, caption: "Shop at acme.com" });
    expect(link.ok && link.draft.blockers).toEqual([X_NO_LINKS]);
    expect(link.ok && link.draft.consentToken).toBeNull();
    b.connect("tiktok");
    const noPrivacy = await previewPost(b.service(), admin, { ...draftX, network: "tiktok" });
    expect(noPrivacy.ok && noPrivacy.draft.blockers).toEqual([TIKTOK_PRIVACY_REQUIRED]);
    const everyone = await previewPost(b.service(), admin, {
      ...draftX,
      network: "tiktok",
      tiktok: { privacy: "PUBLIC_TO_EVERYONE", allowComment: false, allowDuet: false, allowStitch: false, yourBrand: false, brandedContent: false },
    });
    expect(everyone.ok && everyone.draft.blockers).toEqual([TIKTOK_TEST_ONLY_ME]);
    const later = await previewPost(b.service(), admin, { ...draftX, network: "tiktok", tiktok: null, when: new Date(T0.getTime() + 3600_000).toISOString() });
    expect(later.ok && later.draft.blockers).toContain(SCHEDULE_TIKTOK);
    const soon = await previewPost(b.service(), admin, { ...draftX, when: new Date(T0.getTime() + 60_000).toISOString() });
    expect(soon.ok && soon.draft.blockers).toEqual([SCHEDULE_TOO_SOON]);
  });

  it("a cut that isn't ready can't be posted; an unsigned one can (PT-R3-01: posting doesn't wait on C2PA)", async () => {
    const b = bench();
    b.connect("x");
    // Every delivered file is unsigned while signing is off: that is what production has.
    expect(b.store.campaigns.get(CAMPAIGN)!.renditions.tagged!.signed).toBe(false);
    const unsigned = await previewPost(b.service(), admin, draftX);
    expect(unsigned.ok && unsigned.draft.blockers).toEqual([]);
    expect(unsigned.ok && unsigned.draft.consentToken).toMatch(/^[0-9a-f]{64}$/);
    expect(unsigned.ok && unsigned.draft.videoUrl).toBeTruthy();
    const posted = await consentAndPost(b.service(), admin, { ...draftX, ...meta(unsigned.ok ? unsigned.draft.consentToken! : "", "send-000000071") });
    expect(posted.ok).toBe(true);
    b.store.campaigns.get(CAMPAIGN)!.stage = "signing";
    const notReady = await previewPost(b.service(), admin, draftX);
    expect(notReady.ok && notReady.draft.blockers).toEqual([CUT_NOT_READY]);
  });

  it("a shot that missed the product still in the cut is said: didn't match, or the product missing (PT-R3-05)", async () => {
    for (const verdict of ["didnt_match", "product_missing"] as const) {
      const c = bench();
      c.connect("x");
      c.store.campaigns.get(CAMPAIGN)!.productVerdict = verdict;
      const warned = await previewPost(c.service(), admin, draftX);
      expect(warned.ok && warned.draft.cutWarning, verdict).toBe(CUT_WARNING_MISMATCH);
      expect(warned.ok && warned.draft.blockers).toEqual([]);
    }
    for (const verdict of ["match", "not_readable", "not_checked", null]) {
      const c = bench();
      c.connect("x");
      c.store.campaigns.get(CAMPAIGN)!.productVerdict = verdict;
      const clean = await previewPost(c.service(), admin, draftX);
      expect(clean.ok && clean.draft.cutWarning, String(verdict)).toBeNull();
    }
  });

  it("someone else's campaign is not found", async () => {
    const b = bench();
    expect(await previewPost(b.service(), { userId: OTHER, via: "admin" }, draftX)).toEqual({ ok: false, error: NOT_YOURS });
  });
});

describe("consent: the tap on Post", () => {
  it("records the consent on a queued row, forces the AI label, and kicks the worker", async () => {
    const b = bench();
    b.connect("x");
    const token = await tokenFor(b, draftX);
    const r = await consentAndPost(b.service(), admin, { ...draftX, ...meta(token) });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.post).toMatchObject({ network: "x", stage: "queued", phase: "sending", canCancel: true, handle: "brand" });
    const row = b.store.postsById.get(r.post.id)!;
    expect(row).toMatchObject({ aiLabel: true, payloadSha256: token, rendition: "tagged", finalText: "Morning ritual.\n\n#coffee", accountExternalId: "42" });
    expect(row.consent).toMatchObject({ payload_sha256: token, network: "x", handle: "brand", locale: "en", ui_version: "press-line-1", ip_hash: "ip-hash" });
    expect(row.idempotencyKey).toBe(idempotencyKey(USER, "send-000000001", "x"));
    expect(b.kicks).toEqual([r.post.id]);
    expect(b.gateCalls).toEqual(["Morning ritual.\n#coffee"]);
  });

  it("a resent press (same sendId) is ONE post", async () => {
    const b = bench();
    b.connect("x");
    const token = await tokenFor(b, draftX);
    const a = await consentAndPost(b.service(), admin, { ...draftX, ...meta(token) });
    const again = await consentAndPost(b.service(), admin, { ...draftX, ...meta(token) });
    expect(a.ok && again.ok && a.post.id === again.post.id).toBe(true);
    expect(b.store.postsById.size).toBe(1);
    expect(b.kicks).toHaveLength(1);
  });

  it("MONEY (MONEY-3): the same post pressed again with a NEW send id (the first answer was lost) is still ONE post, on every network", async () => {
    for (const network of ["x", "instagram", "threads"] as const) {
      const b = bench();
      b.connect(network);
      const d = { ...draftX, network };
      const token = await tokenFor(b, d);
      const a = await consentAndPost(b.service(), admin, { ...d, ...meta(token, "send-000000001") });
      const again = await consentAndPost(b.service(), admin, { ...d, ...meta(token, "send-000000002") });
      expect(a.ok && again.ok && a.post.id === again.post.id, network).toBe(true);
      expect(b.store.postsById.size, network).toBe(1);
      expect(b.kicks, network).toHaveLength(1);
    }
    // A post that didn't go out stands in nobody's way: the same post can be sent again.
    const c = bench();
    c.connect("instagram");
    const d = { ...draftX, network: "instagram" as const };
    const token = await tokenFor(c, d);
    const first = await consentAndPost(c.service(), admin, { ...d, ...meta(token, "send-000000003") });
    if (!first.ok) throw new Error(first.error);
    c.store.postsById.get(first.post.id)!.stage = "failed";
    const second = await consentAndPost(c.service(), admin, { ...d, ...meta(token, "send-000000004") });
    expect(second.ok && second.post.id !== first.post.id).toBe(true);
  });

  it("anything changed since the preview is refused: the sheet asks again", async () => {
    const b = bench();
    b.connect("x");
    const token = await tokenFor(b, draftX);
    expect(await consentAndPost(b.service(), admin, { ...draftX, caption: "Evening ritual.", ...meta(token) })).toEqual({ ok: false, error: CUT_CHANGED });
    // The cut was made again in between.
    b.store.campaigns.get(CAMPAIGN)!.renditions.tagged!.sha256 = "c".repeat(64);
    expect(await consentAndPost(b.service(), admin, { ...draftX, ...meta(token, "send-000000002") })).toEqual({ ok: false, error: CUT_CHANGED });
    expect(b.store.postsById.size).toBe(0);
  });

  it("the words pass the ad policy step at consent time", async () => {
    const b = bench();
    b.connect("x");
    const token = await tokenFor(b, { ...draftX, caption: "The best coffee in the world." });
    b.gateAnswer = { ok: false, error: CAPTION_REFUSED_AD_RULES };
    expect(await consentAndPost(b.service(), admin, { ...draftX, caption: "The best coffee in the world.", ...meta(token) })).toEqual({
      ok: false,
      error: CAPTION_REFUSED_AD_RULES,
    });
    expect(b.store.postsById.size).toBe(0);
  });

  it("X: closed while press_x_daily_cap is 0; a URL is refused; the same cut with the same words is a repeat", async () => {
    const b = bench();
    b.connect("x");
    const token = await tokenFor(b, draftX);
    b.xCap = 0;
    expect(await consentAndPost(b.service(), admin, { ...draftX, ...meta(token) })).toEqual({ ok: false, error: X_CLOSED_TODAY });
    b.xCap = 200;
    expect(await consentAndPost(b.service(), admin, { ...draftX, caption: "https://acme.com", ...meta(token) })).toEqual({ ok: false, error: X_NO_LINKS });
    expect((await consentAndPost(b.service(), admin, { ...draftX, ...meta(token) })).ok).toBe(true);
    const again = await tokenFor(b, { ...draftX, caption: "Morning ritual!" });
    expect(await consentAndPost(b.service(), admin, { ...draftX, caption: "Morning ritual!", ...meta(again, "send-000000009") })).toEqual({ ok: false, error: DUPLICATE_POST });
  });

  it("the per-person day cap and the hourly limit", async () => {
    const b = bench();
    b.connect("instagram");
    const d = { ...draftX, network: "instagram" as const };
    for (let i = 0; i < 10; i++) {
      const t = await tokenFor(b, { ...d, caption: `Ad ${i}` });
      expect((await consentAndPost(b.service(), admin, { ...d, caption: `Ad ${i}`, ...meta(t, `send-0000000${i}0`) })).ok).toBe(true);
    }
    const t = await tokenFor(b, { ...d, caption: "Ad 11" });
    expect(await consentAndPost(b.service(), admin, { ...d, caption: "Ad 11", ...meta(t, "send-000000011") })).toEqual({ ok: false, error: DAILY_LIMIT_NETWORK });
    const c = bench();
    c.connect("x");
    c.limited.add("press-post");
    const token = await tokenFor(c, draftX);
    expect(await consentAndPost(c.service(), admin, { ...draftX, ...meta(token) })).toEqual({ ok: false, error: POST_RATE_LIMIT });
  });

  it("TikTok: creator_info is asked again at consent; the free trial ad posts once, to X only", async () => {
    const b = bench();
    b.connect("tiktok");
    const d = {
      ...draftX,
      network: "tiktok" as const,
      tiktok: { privacy: "SELF_ONLY" as const, allowComment: false, allowDuet: false, allowStitch: false, yourBrand: true, brandedContent: false },
    };
    const token = await tokenFor(b, d);
    b.routes = [
      {
        method: "POST",
        url: TIKTOK_CREATOR_INFO_URL,
        reply: () =>
          json(200, {
            data: { creator_nickname: "Brand Co", creator_username: "brandco", privacy_level_options: ["FOLLOWER_OF_CREATOR", "SELF_ONLY"], max_video_post_duration_sec: 600 },
            error: { code: "ok" },
          }),
      },
    ];
    const r = await consentAndPost(b.service(), admin, { ...d, ...meta(token) });
    expect(r.ok).toBe(true);
    expect(b.calls.map((c) => c.url)).toEqual([TIKTOK_CREATOR_INFO_URL]);

    const trial = { userId: USER, via: "trial" as const };
    const t2 = await tokenFor(b, { ...d, caption: "Another" });
    expect(await consentAndPost(b.service(), trial, { ...d, caption: "Another", ...meta(t2, "send-000000077") })).toEqual({ ok: false, error: TRIAL_X_ONCE });
  });

  it("TikTok never schedules", async () => {
    const b = bench();
    b.connect("tiktok");
    const when = new Date(T0.getTime() + 3600_000).toISOString();
    const r = await consentAndSchedule(b.service(), admin, {
      ...draftX,
      network: "tiktok",
      tiktok: { privacy: "SELF_ONLY", allowComment: false, allowDuet: false, allowStitch: false, yourBrand: false, brandedContent: false },
      ...meta("a".repeat(64)),
      when,
    });
    expect(r).toEqual({ ok: false, error: SCHEDULE_TIKTOK });
  });

  it("scheduling X: queued for its minute, not kicked, the time inside the consent", async () => {
    const b = bench();
    b.connect("x");
    const when = "2026-09-30T08:30:00.000Z";
    const token = await tokenFor(b, { ...draftX, when });
    const r = await consentAndSchedule(b.service(), admin, { ...draftX, ...meta(token), when });
    expect(r.ok && r.post).toMatchObject({ stage: "queued", phase: "scheduled", scheduledFor: when });
    expect(b.kicks).toEqual([]);
    // The same words "now" hash differently: a schedule's consent is not a "now" consent.
    expect(await tokenFor(b, draftX)).not.toBe(token);
  });
});

describe("cancel and disconnect", () => {
  it("cancels what hasn't gone out; refuses what is going", async () => {
    const b = bench();
    b.connect("x");
    const when = "2026-09-30T08:30:00.000Z";
    const token = await tokenFor(b, { ...draftX, when });
    const r = await consentAndSchedule(b.service(), admin, { ...draftX, ...meta(token), when });
    if (!r.ok) throw new Error(r.error);
    expect((await cancelPost(b.service(), USER, { postId: r.post.id })).ok).toBe(true);
    expect(b.store.postsById.get(r.post.id)!.stage).toBe("cancelled");

    const token2 = await tokenFor(b, { ...draftX, caption: "Two", when });
    const r2 = await consentAndSchedule(b.service(), admin, { ...draftX, caption: "Two", ...meta(token2, "send-000000002"), when });
    if (!r2.ok) throw new Error(r2.error);
    b.store.postsById.get(r2.post.id)!.stage = "uploading";
    b.store.postsById.get(r2.post.id)!.lockedAt = T0.toISOString();
    expect(await cancelPost(b.service(), USER, { postId: r2.post.id })).toEqual({ ok: false, error: POST_NOT_CANCELLABLE });
    expect(await cancelPost(b.service(), OTHER, { postId: r2.post.id })).toEqual({ ok: false, error: NOT_YOURS });
  });

  it("disconnect revokes at the network; a failed revoke is owed (sealed), and the keys go either way", async () => {
    const b = bench();
    const id = b.connect("x");
    b.routes = [{ method: "POST", url: X_REVOKE_URL, reply: () => json(503, {}) }];
    expect(await disconnect(b.service(), USER, { network: "x" })).toEqual({ ok: true });
    expect(b.store.conns.has(id)).toBe(false);
    expect(b.store.secrets.has(id)).toBe(false);
    const owed = [...b.store.revocations.values()];
    expect(owed.map((r) => r.kind).sort()).toEqual(["access", "refresh"]);
    expect(JSON.stringify(owed)).not.toContain("x-refresh-1");
  });
});
