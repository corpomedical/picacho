import { createHash, randomUUID } from "node:crypto";

// The posts clock's work (spec §2.1; v2 #14, #23, #24, #36): claim due posts
// through claim_scheduled_posts (oldest first, FOR UPDATE SKIP LOCKED, a
// 6-minute lease), and for each one, BEFORE any byte goes to a network:
//   1. a row that died mid-publish is 'unconfirmed' (the final call is never
//      sent twice), except a TikTok post whose publish id we can ask about;
//   2. the person may still post there (the switches, their access, the
//      network open to them), else it stops and says so;
//   3. the account is still theirs and still the one they consented to;
//   4. the consent object rebuilt from the row hashes to what they approved,
//      the AI label is on, the file kind is the network's (clean = TikTok),
//      and X's text holds no link;
//   5. the cut is still ready, and the very file they approved (its path
//      and sha256; the bytes are hashed again when read). Signing is not
//      waited on (publish-service.ts buildDraft: PT-R3-01);
//   6. the app-wide ceilings (press_x_daily_cap, TikTok's 5 test people a
//      day) have room, once per post;
//   7. the account's key is fresh (vault.ts refreshes it under the account's
//      lock);
// then the network's adapter advances it as far as it can in the step's
// budget, saving every platform id the moment it exists, and the outcome is
// written back under the lease.
//
// Housekeeping, each tick, a few rows at a time: expired connect states are
// deleted, owed revokes are retried, Instagram and Threads 60-day keys with
// under 10 days left are refreshed, and keys sealed under an older vault key
// are re-sealed under the current one: the accounts' keys AND the owed
// revokes' keys, so removing an old vault key after rotation never strands
// a revoke we still owe (fixer 2026-09-26, SEC-3). An owed revoke whose seal
// no longer opens is kept and counted like any failed attempt (and logged),
// never dropped at once as if there were nothing to revoke.
//
// Alias-free (vitest has no '@/').

import { pathOwned } from "../press-tour/owned";
import { isNetwork, RENDITION_FOR, type Network } from "../press-tour/publish-types";
import { retryDelayMs, TIKTOK_TEST_PEOPLE_PER_DAY, xCapOpen, networkOpen, type PostingSwitches } from "./access";
import { LeaseLostError, type MediaSource, type OAuthAdapter, type PostingAdapter, type SendContext, type StepOutcome, type StepPatch } from "./adapter";
import { consentFromRow, consentHash, type ConsentObject } from "./consent";
import type { FetchLike } from "./http";
import {
  CONNECTION_GONE,
  POST_ACCESS_LOST,
  POST_FAILED,
  POST_NO_LONGER_MATCHES,
  POST_UNCONFIRMED,
  POSTING_PAUSED,
  RECONNECT_NEEDED,
  TIKTOK_TEST_FULL,
  X_CLOSED_TODAY,
  X_NO_LINKS,
} from "./messages";
import { OAUTH, POSTING } from "./networks";
import { credentialsFor } from "./oauth";
import type { Claimed, PostRecord, PostWrite, RevocationRecord, SocialStore, StoredRendition } from "./store";
import { hasLink } from "./text";
import { connectionAad, needsReseal, open, revocationAad, seal, usableAccessToken, type Keyring } from "./vault";

/** A post's step never runs longer than this (the lease is 6 minutes; the function 300 s). */
export const STEP_BUDGET_MS = 240_000;
/** When a read we need fails, look again this much later rather than burn the post. */
const TRANSIENT_RETRY_MS = 2 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

/** What the worker needs to know about a person, read fresh for every post. */
export type AccessFacts = {
  /** Press Tour is open to them (enabled.ts pressTourAllowed with today's switches and settings). */
  pressTourOk: boolean;
  isAdmin: boolean;
  testerNetworks: string[];
  switches: PostingSwitches;
};

export interface WorkerDeps {
  store: SocialStore;
  keyring: Keyring | null;
  env: Record<string, string | undefined>;
  fetch: FetchLike;
  now(): Date;
  sleep(ms: number): Promise<void>;
  readAccess(userId: string): Promise<AccessFacts>;
  /** press_x_daily_cap. */
  readXCap(): Promise<number>;
  /** One post's slot under the app-wide X ceiling (atomic; rate-limit.ts on a fixed key). True = room. */
  takeXSlot(cap: number): Promise<boolean>;
  tiktokAudited: boolean;
  /** Tell Admin (a post unconfirmed, a network's credits out). Optional. */
  notifyAdmins?(title: string, body: string): Promise<void>;
  /** The person's account needs connecting again (runtime.ts: the reconnectNeeded push, at most one a day per account). Optional. */
  onNeedsReconnect?(userId: string, network: Network): Promise<void>;
  /**
   * A post reached its end for the person, written down under the lease:
   * out on the network, or failed for good. Never for 'unconfirmed' (Admin is
   * told; the person is asked to check) or a cancel. At most once per post,
   * because a closed post stays closed (scheduled_posts_guard). runtime.ts:
   * the postPublished / postFailed push. Optional.
   */
  onPostSettled?(post: SettledPost, outcome: "published" | "failed"): Promise<void>;
  /** For tests: the adapters. */
  posting?: Readonly<Record<Network, PostingAdapter>>;
  oauth?: Readonly<Record<Network, OAuthAdapter>>;
}

/** What a settled post's notice needs: whose, where, and which ad. */
export type SettledPost = { id: string; userId: string; network: Network; campaignId: string | null };

export type TickReport = {
  claimed: number;
  outcomes: Record<string, number>;
  housekeeping?: { states: boolean; revokes: number; refreshed: number; resealed: number };
};

class MediaMismatchError extends Error {
  constructor() {
    super("the file is not the one consented to");
    this.name = "MediaMismatchError";
  }
}

const sha256 = (buf: Buffer): string => createHash("sha256").update(buf).digest("hex");

/** Pure: does the row still say exactly what the person approved? */
export function consentIntact(post: PostRecord): { ok: true; consent: ConsentObject } | { ok: false } {
  if (!post.aiLabel || !post.payloadSha256) return { ok: false };
  if (post.rendition !== RENDITION_FOR[post.network]) return { ok: false };
  const consent = consentFromRow(post);
  if (consentHash(consent) !== post.payloadSha256) return { ok: false };
  if (consent.text !== post.finalText) return { ok: false };
  return { ok: true, consent };
}

function mediaFor(deps: WorkerDeps, rendition: StoredRendition, expectedSha: string): MediaSource {
  let cached: Buffer | null = null;
  return {
    sizeBytes: rendition.sizeBytes,
    durationSeconds: rendition.durationSeconds,
    async bytes() {
      if (cached) return cached;
      const buf = await deps.store.download(rendition.bucket, rendition.path);
      if (!buf || sha256(buf) !== expectedSha) throw new MediaMismatchError();
      cached = buf;
      return buf;
    },
    async publicUrl(seconds) {
      const url = await deps.store.signedUrl(rendition.bucket, rendition.path, seconds);
      if (!url) throw new Error("no link for the file");
      return url;
    },
  };
}

type Finish = (write: PostWrite) => Promise<boolean>;

/** ONE claimed post: the checks, then as far as the network lets it go. Answers the outcome's name. */
export async function processClaimed(deps: WorkerDeps, claimed: Claimed, tickDeadline: number): Promise<string> {
  const store = deps.store;
  const lease = claimed.lockedAt;
  const posting = deps.posting ?? POSTING;
  const oauth = deps.oauth ?? OAUTH;

  let post: PostRecord | null;
  try {
    post = await store.post(claimed.id);
  } catch {
    return "unreadable";
  }
  if (!post || !isNetwork(post.network)) return "missing";
  const network = post.network;
  const finish: Finish = (write) => store.savePost(post!.id, lease, { ...write, lockedAt: null });
  const later = (ms: number) => finish({ resumeAt: new Date(deps.now().getTime() + ms).toISOString() });
  const settled = async (outcome: "published" | "failed") => {
    await deps.onPostSettled?.({ id: post!.id, userId: post!.userId, network, campaignId: post!.campaignId ?? null }, outcome).catch(() => undefined);
  };
  const stop = async (stage: "failed" | "cancelled" | "platform_busy" | "needs_reconnect" | "unconfirmed", message: string) => {
    const saved = await finish({ stage, lastError: message, resumeAt: null });
    if (saved && stage === "failed") await settled("failed");
    return stage;
  };

  // 1. Died in the middle of making it public: never send it again.
  const tiktokAsking = network === "tiktok" && typeof post.externalIds.publishId === "string";
  if (post.stage === "publishing" && network !== "tiktok") {
    await deps.notifyAdmins?.("A post may or may not have gone out", `${network} post ${post.id}: its worker stopped mid-publish; the person is asked to check.`).catch(() => undefined);
    return stop("unconfirmed", POST_UNCONFIRMED);
  }

  // 2. May they still post there? (A post already out at TikTok is only asked about.)
  let access: AccessFacts;
  try {
    access = await deps.readAccess(post.userId);
  } catch {
    await later(TRANSIENT_RETRY_MS);
    return "later";
  }
  if (!tiktokAsking) {
    if (!access.pressTourOk) return stop("cancelled", POST_ACCESS_LOST);
    if (!networkOpen(network, access.switches, { isAdmin: access.isAdmin, testerNetworks: access.testerNetworks })) {
      return stop("platform_busy", POSTING_PAUSED);
    }
  }

  // 3. The account.
  let conn;
  try {
    conn = post.connectionId ? await store.connectionById(post.connectionId) : null;
  } catch {
    await later(TRANSIENT_RETRY_MS);
    return "later";
  }
  if (!conn || conn.userId !== post.userId || conn.network !== network || conn.externalId !== post.accountExternalId) {
    return stop(tiktokAsking ? "unconfirmed" : "cancelled", tiktokAsking ? POST_UNCONFIRMED : CONNECTION_GONE);
  }
  if (conn.status === "needs_reconnect") {
    await deps.onNeedsReconnect?.(post.userId, network).catch(() => undefined);
    return stop("needs_reconnect", RECONNECT_NEEDED);
  }

  // 4. The consent.
  const intact = consentIntact(post);
  if (!intact.ok) return stop("failed", POST_NO_LONGER_MATCHES);
  const consent = intact.consent;
  if (network === "x" && hasLink(consent.text)) return stop("failed", X_NO_LINKS);

  // 5. The cut.
  if (!post.campaignId) return stop("failed", POST_NO_LONGER_MATCHES);
  const campaign = await store.campaignForPost(post.userId, post.campaignId).catch(() => "unavailable" as const);
  if (campaign === "unavailable") {
    await later(TRANSIENT_RETRY_MS);
    return "later";
  }
  const rendition = campaign?.renditions[post.rendition];
  if (
    !campaign ||
    campaign.stage !== "ready" ||
    !rendition ||
    !pathOwned(post.userId, rendition.path) ||
    rendition.path !== post.renditionPath ||
    rendition.sha256 !== post.renditionSha256
  ) {
    return stop("failed", POST_NO_LONGER_MATCHES);
  }

  // 6. The app-wide ceilings, once per post (before its first upload).
  const firstSend = post.stage === "claimed" && post.uploadAttempts === 0 && Object.keys(post.externalIds).length === 0;
  if (firstSend && network === "x") {
    const cap = await deps.readXCap().catch(() => 0);
    if (!xCapOpen(cap) || !(await deps.takeXSlot(cap).catch(() => false))) return stop("platform_busy", X_CLOSED_TODAY);
  }
  if (firstSend && network === "tiktok" && !deps.tiktokAudited) {
    const people = await store.tiktokPeopleSince(new Date(deps.now().getTime() - DAY_MS).toISOString()).catch(() => null);
    if (people === null) {
      await later(TRANSIENT_RETRY_MS);
      return "later";
    }
    if (!people.includes(post.userId) && people.length >= TIKTOK_TEST_PEOPLE_PER_DAY) return stop("platform_busy", TIKTOK_TEST_FULL);
  }

  // 7. The account's key.
  const adapterOAuth = oauth[network];
  const creds = credentialsFor(adapterOAuth, deps.env);
  if (!creds || !deps.keyring) {
    await later(TRANSIENT_RETRY_MS);
    return "later";
  }
  const key = await usableAccessToken({
    store,
    keyring: deps.keyring,
    connectionId: conn.id,
    now: deps.now,
    sleep: deps.sleep,
    refresh: (current) => adapterOAuth.refresh(deps.fetch, { creds, accessToken: current.accessToken, refreshToken: current.refreshToken, now: deps.now() }),
  });
  if (!key.ok) {
    if (key.reason === "unavailable") {
      await later(TRANSIENT_RETRY_MS);
      return "later";
    }
    await store.markNeedsReconnect(conn.id).catch(() => undefined);
    await deps.onNeedsReconnect?.(post.userId, network).catch(() => undefined);
    return stop("needs_reconnect", RECONNECT_NEEDED);
  }

  // The network.
  const adapter = posting[network];
  const state = {
    id: post.id,
    stage: post.stage,
    externalIds: { ...post.externalIds },
    uploadAttempts: post.uploadAttempts,
    createdAt: post.createdAt,
  };
  let cost = post.costUsd;
  const save = async (patch: StepPatch): Promise<void> => {
    const write: PostWrite = {};
    if (patch.stage) write.stage = patch.stage;
    if (patch.externalIds) write.externalIds = patch.externalIds;
    if (patch.uploadAttempts !== undefined) write.uploadAttempts = patch.uploadAttempts;
    if (patch.costUsd) write.costUsd = cost + patch.costUsd;
    if (Object.keys(write).length === 0) return;
    const ok = await store.savePost(state.id, lease, write).catch(() => false);
    if (!ok) throw new LeaseLostError();
    if (write.stage) state.stage = write.stage;
    if (write.externalIds) state.externalIds = { ...write.externalIds };
    if (write.uploadAttempts !== undefined) state.uploadAttempts = write.uploadAttempts;
    if (write.costUsd !== undefined) cost = write.costUsd;
  };
  const ctx: SendContext = {
    post: state,
    consent,
    account: { externalId: conn.externalId, handle: conn.handle },
    accessToken: key.accessToken,
    creds,
    media: mediaFor(deps, rendition, post.renditionSha256),
    fetch: deps.fetch,
    now: deps.now,
    sleep: deps.sleep,
    deadline: Math.min(tickDeadline, deps.now().getTime() + STEP_BUDGET_MS),
    save,
    tiktokAudited: deps.tiktokAudited,
  };

  let outcome: StepOutcome;
  try {
    outcome = await adapter.advance(ctx);
  } catch (err) {
    if (err instanceof LeaseLostError) return "lease_lost";
    if (err instanceof MediaMismatchError) return stop("failed", POST_NO_LONGER_MATCHES);
    // Something of ours broke. If it broke while making the post public, we
    // can't know whether it went out.
    if (state.stage === "publishing" && !(network === "tiktok" && typeof state.externalIds.publishId !== "string")) {
      return stop("unconfirmed", POST_UNCONFIRMED);
    }
    outcome = { kind: "retry", error: POST_FAILED };
  }

  switch (outcome.kind) {
    case "wait":
      await finish({ resumeAt: outcome.resumeAt.toISOString() });
      return "wait";
    case "published": {
      const saved = await finish({
        stage: "published",
        externalPostId: outcome.externalPostId,
        permalink: outcome.permalink,
        publishedAt: deps.now().toISOString(),
        lastError: null,
        resumeAt: null,
      });
      if (saved) await settled("published");
      return "published";
    }
    case "retry":
      if (state.uploadAttempts >= adapter.maxUploadAttempts || state.stage === "publishing") return stop("failed", outcome.error);
      await finish({
        stage: "retry",
        lastError: outcome.error,
        externalIds: {},
        resumeAt: new Date(deps.now().getTime() + retryDelayMs(Math.max(state.uploadAttempts, 1))).toISOString(),
      });
      return "retry";
    case "failed":
      return stop("failed", outcome.error);
    case "busy":
      return stop("platform_busy", outcome.error);
    case "unconfirmed":
      await deps.notifyAdmins?.("A post may or may not have gone out", `${network} post ${post.id}: the network's answer was lost.`).catch(() => undefined);
      return stop("unconfirmed", POST_UNCONFIRMED);
    case "reconnect":
      await store.markNeedsReconnect(conn.id).catch(() => undefined);
      await deps.onNeedsReconnect?.(post.userId, network).catch(() => undefined);
      return stop("needs_reconnect", RECONNECT_NEEDED);
  }
}

/** Claim and work up to `batch` due posts (or exactly one, by id: a "Post now" kick). */
export async function runPosts(deps: WorkerDeps, input: { batch: number; budgetMs: number; postId?: string | null }): Promise<TickReport> {
  const deadline = deps.now().getTime() + input.budgetMs;
  const claimed = await deps.store.claimPosts(input.batch, input.postId ?? null).catch(() => [] as Claimed[]);
  const outcomes: Record<string, number> = {};
  const results = await Promise.all(
    claimed.map((c) =>
      processClaimed(deps, c, deadline).catch(async () => {
        // Nothing may escape; the lease runs out on its own if this write fails too.
        await deps.store.savePost(c.id, c.lockedAt, { lockedAt: null, resumeAt: new Date(deps.now().getTime() + TRANSIENT_RETRY_MS).toISOString() }).catch(() => false);
        return "error";
      }),
    ),
  );
  for (const r of results) outcomes[r] = (outcomes[r] ?? 0) + 1;
  return { claimed: claimed.length, outcomes };
}

// ---------------------------------------------------------------------
// Housekeeping
// ---------------------------------------------------------------------

/** Instagram and Threads keys are refreshed with this much life left, and not more often than daily. */
export const LONG_KEY_REFRESH_WITHIN_MS = 10 * DAY_MS;
/** An owed revoke is tried daily, at most this many times. */
export const REVOKE_MAX_ATTEMPTS = 7;

export async function housekeeping(deps: WorkerDeps, limits: { revokes: number; refreshes: number; reseals: number } = { revokes: 3, refreshes: 3, reseals: 10 }): Promise<NonNullable<TickReport["housekeeping"]>> {
  const store = deps.store;
  const oauth = deps.oauth ?? OAUTH;
  const now = deps.now();
  const out = { states: false, revokes: 0, refreshed: 0, resealed: 0 };

  try {
    await store.pruneStates(new Date(now.getTime() - DAY_MS).toISOString());
    out.states = true;
  } catch {
    /* next tick */
  }
  if (!deps.keyring) return out;
  const keyring = deps.keyring;

  // Owed revokes sealed under an older vault key: sealed again under the
  // current one FIRST, so the rotation's "remove the old key" step can never
  // strand a revoke we still owe (SEC-3). Same associated data: the seal
  // stays bound to its row and its kind.
  for (const r of await store.revocationsOlderThan(keyring.current, limits.reseals).catch(() => [] as RevocationRecord[])) {
    try {
      const token = open(r.sealed, revocationAad(r.id, r.kind), keyring);
      if (await store.resealRevocation(r.id, seal(token, revocationAad(r.id, r.kind), keyring), r.sealed.keyVersion)) out.resealed++;
    } catch {
      /* its old key is already gone: the revoke loop below keeps it and says so */
    }
  }

  // Owed revokes.
  for (const r of await store.dueRevocations(now.toISOString(), limits.revokes).catch(() => [])) {
    const creds = credentialsFor(oauth[r.network], deps.env);
    let result: "done" | "unsupported" | "failed" = "failed";
    let error = "revoke refused or unanswered";
    let token: string | null = null;
    try {
      token = open(r.sealed, revocationAad(r.id, r.kind), keyring);
    } catch {
      token = null;
    }
    if (token === null) {
      // The seal no longer opens (its vault key was removed, or the row was
      // altered). Kept and retried like any failed attempt: putting the old
      // key back within the week still lets us revoke it.
      error = `the sealed key doesn't open: vault key version ${r.sealed.keyVersion} is not in the environment, or the row was altered`;
      console.error(`[social] owed ${r.network} revoke ${r.id} can't be opened (vault key version ${r.sealed.keyVersion}); attempt ${r.attempts + 1} of ${REVOKE_MAX_ATTEMPTS}`);
    } else if (creds) {
      result = await oauth[r.network].revoke(deps.fetch, { creds, token, kind: r.kind }).catch(() => "failed" as const);
    }
    if (result !== "failed" || r.attempts + 1 >= REVOKE_MAX_ATTEMPTS) {
      await store.revocationDone(r.id).catch(() => undefined);
      out.revokes++;
    } else {
      await store.revocationFailed(r.id, { attempts: r.attempts + 1, nextAttemptAt: new Date(now.getTime() + DAY_MS).toISOString(), error }).catch(() => undefined);
    }
  }

  // Instagram and Threads: 60-day keys, refreshed with 10 days left.
  const due = await store
    .connectionsToRefresh({
      networks: ["instagram", "threads"],
      expiresBefore: new Date(now.getTime() + LONG_KEY_REFRESH_WITHIN_MS).toISOString(),
      refreshedBefore: new Date(now.getTime() - DAY_MS).toISOString(),
      limit: limits.refreshes,
    })
    .catch(() => []);
  for (const c of due) {
    const creds = credentialsFor(oauth[c.network], deps.env);
    if (!creds) continue;
    // Force the refresh: the vault refreshes only inside its 5-minute margin,
    // so this asks the network directly under the same lock.
    const leased = await store.tryLease(c.id, new Date(now.getTime() + 60_000), now).catch(() => false);
    if (!leased) continue;
    let released = false;
    try {
      const keys = await store.readKeys(c.id);
      if (!keys) continue;
      const access = open(keys.access, connectionAad(c.id, "access"), keyring);
      const answer = await oauth[c.network].refresh(deps.fetch, { creds, accessToken: access, refreshToken: null, now });
      if (answer.ok) {
        const pair = { access: seal(answer.keys.accessToken, connectionAad(c.id, "access"), keyring), refresh: null };
        released = await store.writeKeys(c.id, pair, { accessExpiresAt: answer.keys.accessExpiresAt, refreshExpiresAt: null, refreshedAt: now });
        if (released) out.refreshed++;
      } else if (answer.reason === "invalid") {
        await store.markNeedsReconnect(c.id);
        released = true;
        await deps.onNeedsReconnect?.(c.userId, c.network).catch(() => undefined);
      }
    } catch {
      /* next tick */
    } finally {
      if (!released) await store.releaseLease(c.id).catch(() => undefined);
    }
  }

  // Keys sealed under an older vault key: sealed again under the current one.
  for (const k of await store.secretsOlderThan(keyring.current, limits.reseals).catch(() => [])) {
    if (!needsReseal(k.access, keyring)) continue;
    const leased = await store.tryLease(k.connectionId, new Date(now.getTime() + 60_000), now).catch(() => false);
    if (!leased) continue;
    let released = false;
    try {
      const fresh = await store.readKeys(k.connectionId);
      if (!fresh || !needsReseal(fresh.access, keyring)) continue;
      const access = open(fresh.access, connectionAad(k.connectionId, "access"), keyring);
      const refresh = fresh.refresh ? open(fresh.refresh, connectionAad(k.connectionId, "refresh"), keyring) : null;
      const pair = {
        access: seal(access, connectionAad(k.connectionId, "access"), keyring),
        refresh: refresh ? seal(refresh, connectionAad(k.connectionId, "refresh"), keyring) : null,
      };
      const facts = {
        accessExpiresAt: fresh.accessExpiresAt ? new Date(fresh.accessExpiresAt) : null,
        refreshExpiresAt: fresh.refreshExpiresAt ? new Date(fresh.refreshExpiresAt) : null,
        refreshedAt: fresh.lastRefreshedAt ? new Date(fresh.lastRefreshedAt) : now,
      };
      released = await store.writeKeys(k.connectionId, pair, facts);
      if (released) out.resealed++;
    } catch {
      /* a seal that won't open stays as it is; the account reconnects when it is next used */
    } finally {
      if (!released) await store.releaseLease(k.connectionId).catch(() => undefined);
    }
  }

  return out;
}

/** A fresh id for an owed revoke (its seal's associated data names it). */
export const newRevocationId = (): string => randomUUID();
