// An in-memory SocialStore for the tests (publish-service.test.ts,
// worker.test.ts, vault.test.ts). It keeps the database's rules that the
// code relies on: the unique idempotency key, the one connection per network,
// the lease-conditional writes, the atomic single use of a connect state,
// and the conditional refresh lease. Not used by the app.
//
// Alias-free (vitest has no '@/').

import { randomUUID } from "node:crypto";
import type { Network } from "../press-tour/publish-types";
import type { StoredState } from "./oauth";
import {
  CANCELLABLE_STAGES,
  type CampaignForPost,
  type Claimed,
  type ConnectionRecord,
  type NewPost,
  type PostRecord,
  type PostWrite,
  type ProfileFacts,
  type RevocationRecord,
  type SocialStore,
} from "./store";
import type { Sealed, StoredKeys } from "./vault";

type SecretRow = { access: Sealed; refresh: Sealed | null; keyVersion: number };
type ConnRow = ConnectionRecord & { leaseUntil: string | null };
type StateRow = StoredState & { stateHash: string };

/** A connection row without its lease (what the store answers). */
function publicConn(c: ConnRow): ConnectionRecord {
  return {
    id: c.id,
    userId: c.userId,
    network: c.network,
    externalId: c.externalId,
    handle: c.handle,
    displayName: c.displayName,
    scopes: c.scopes,
    status: c.status,
    accessExpiresAt: c.accessExpiresAt,
    refreshExpiresAt: c.refreshExpiresAt,
    lastRefreshedAt: c.lastRefreshedAt,
    createdAt: c.createdAt,
  };
}

const LIVE = ["queued", "claimed", "uploading", "media_ready", "publishing", "published", "retry", "unconfirmed"];

export class FakeStore implements SocialStore {
  profiles = new Map<string, ProfileFacts>();
  testers = new Map<string, string[]>();
  conns = new Map<string, ConnRow>();
  secrets = new Map<string, SecretRow>();
  states = new Map<string, StateRow>();
  revocations = new Map<string, RevocationRecord & { nextAttemptAt: string; lastError: string | null }>();
  postsById = new Map<string, PostRecord>();
  campaigns = new Map<string, CampaignForPost>();
  files = new Map<string, Buffer>();
  /** Every lease-conditional write, for the tests to read. */
  writes: { id: string; write: PostWrite }[] = [];
  clock: () => Date;
  failSecretsWrites = 0;

  constructor(clock: () => Date = () => new Date()) {
    this.clock = clock;
  }

  // --- helpers for tests ---
  addConnection(c: Omit<ConnectionRecord, "id" | "createdAt"> & { id?: string }): ConnectionRecord {
    const id = c.id ?? randomUUID();
    const row: ConnRow = { ...c, id, createdAt: this.clock().toISOString(), leaseUntil: null };
    this.conns.set(id, row);
    return row;
  }

  async profile(userId: string) {
    return this.profiles.get(userId) ?? null;
  }
  async testerNetworks(userId: string) {
    return this.testers.get(userId) ?? [];
  }

  async connections(userId: string) {
    return [...this.conns.values()].filter((c) => c.userId === userId).map(publicConn);
  }
  async connection(userId: string, network: Network) {
    const c = [...this.conns.values()].find((x) => x.userId === userId && x.network === network);
    return c ? publicConn(c) : null;
  }
  async connectionById(id: string) {
    const c = this.conns.get(id);
    return c ? publicConn(c) : null;
  }
  async upsertConnection(input: Parameters<SocialStore["upsertConnection"]>[0]) {
    const existing = [...this.conns.values()].find((x) => x.userId === input.userId && x.network === input.network);
    const id = existing?.id ?? randomUUID();
    this.conns.set(id, {
      id,
      userId: input.userId,
      network: input.network,
      externalId: input.externalId,
      handle: input.handle,
      displayName: input.displayName,
      scopes: input.scopes,
      status: "connected",
      accessExpiresAt: input.accessExpiresAt,
      refreshExpiresAt: input.refreshExpiresAt,
      lastRefreshedAt: input.refreshedAt,
      createdAt: existing?.createdAt ?? this.clock().toISOString(),
      leaseUntil: null,
    });
    return id;
  }
  async writeSecrets(connectionId: string, pair: { access: Sealed; refresh: Sealed | null }) {
    if (this.failSecretsWrites > 0) {
      this.failSecretsWrites--;
      return false;
    }
    if (!this.conns.has(connectionId)) return false;
    this.secrets.set(connectionId, { access: pair.access, refresh: pair.refresh, keyVersion: pair.access.keyVersion });
    return true;
  }
  async deleteConnection(id: string) {
    this.conns.delete(id);
    this.secrets.delete(id);
    for (const p of this.postsById.values()) if (p.connectionId === id) p.connectionId = null;
    return true;
  }
  async connectionsToRefresh(input: { networks: Network[]; expiresBefore: string; refreshedBefore: string; limit: number }) {
    return [...this.conns.values()]
      .filter(
        (c) =>
          c.status === "connected" &&
          input.networks.includes(c.network) &&
          c.accessExpiresAt !== null &&
          c.accessExpiresAt < input.expiresBefore &&
          (c.lastRefreshedAt === null || c.lastRefreshedAt < input.refreshedBefore),
      )
      .slice(0, input.limit)
      .map(publicConn);
  }
  async secretsOlderThan(keyVersion: number, limit: number) {
    const out: StoredKeys[] = [];
    for (const [id, s] of this.secrets) {
      if (s.keyVersion < keyVersion) {
        const k = await this.readKeys(id);
        if (k) out.push(k);
      }
      if (out.length >= limit) break;
    }
    return out;
  }

  async readKeys(connectionId: string): Promise<StoredKeys | null> {
    const c = this.conns.get(connectionId);
    const s = this.secrets.get(connectionId);
    if (!c || !s) return null;
    return {
      connectionId,
      status: c.status,
      access: s.access,
      refresh: s.refresh,
      accessExpiresAt: c.accessExpiresAt,
      refreshExpiresAt: c.refreshExpiresAt,
      lastRefreshedAt: c.lastRefreshedAt,
    };
  }
  async tryLease(connectionId: string, until: Date, now: Date) {
    const c = this.conns.get(connectionId);
    if (!c) return false;
    if (c.leaseUntil !== null && c.leaseUntil >= now.toISOString()) return false;
    c.leaseUntil = until.toISOString();
    return true;
  }
  async releaseLease(connectionId: string) {
    const c = this.conns.get(connectionId);
    if (c) c.leaseUntil = null;
  }
  async writeKeys(connectionId: string, pair: { access: Sealed; refresh: Sealed | null }, facts: { accessExpiresAt: Date | null; refreshExpiresAt: Date | null; refreshedAt: Date }) {
    const c = this.conns.get(connectionId);
    if (!c || !this.secrets.has(connectionId)) return false;
    if (this.failSecretsWrites > 0) {
      this.failSecretsWrites--;
      return false;
    }
    this.secrets.set(connectionId, { access: pair.access, refresh: pair.refresh, keyVersion: pair.access.keyVersion });
    c.accessExpiresAt = facts.accessExpiresAt?.toISOString() ?? null;
    c.refreshExpiresAt = facts.refreshExpiresAt?.toISOString() ?? null;
    c.lastRefreshedAt = facts.refreshedAt.toISOString();
    c.leaseUntil = null;
    c.status = "connected";
    return true;
  }
  async markNeedsReconnect(connectionId: string) {
    const c = this.conns.get(connectionId);
    if (c) {
      c.status = "needs_reconnect";
      c.leaseUntil = null;
    }
  }

  async insertState(input: Parameters<SocialStore["insertState"]>[0]) {
    if (this.states.has(input.stateHash)) return false;
    this.states.set(input.stateHash, {
      stateHash: input.stateHash,
      userId: input.userId,
      network: input.network,
      pkceVerifier: input.pkceVerifier,
      returnTo: input.returnTo,
      expiresAt: input.expiresAt,
      usedAt: null,
    });
    return true;
  }
  async takeState(stateHash: string, now: string) {
    const s = this.states.get(stateHash);
    if (!s || s.usedAt !== null) return null;
    s.usedAt = now;
    return { userId: s.userId, network: s.network, pkceVerifier: s.pkceVerifier, returnTo: s.returnTo, expiresAt: s.expiresAt, usedAt: s.usedAt };
  }
  async pruneStates(before: string) {
    for (const [k, s] of this.states) if (s.expiresAt < before) this.states.delete(k);
  }

  async addRevocation(input: Parameters<SocialStore["addRevocation"]>[0]) {
    this.revocations.set(input.id, { ...input, attempts: 0, nextAttemptAt: this.clock().toISOString(), lastError: null });
    return true;
  }
  async dueRevocations(now: string, limit: number) {
    return [...this.revocations.values()].filter((r) => r.nextAttemptAt <= now).slice(0, limit);
  }
  async revocationsOlderThan(keyVersion: number, limit: number) {
    return [...this.revocations.values()].filter((r) => r.sealed.keyVersion < keyVersion).slice(0, limit);
  }
  async resealRevocation(id: string, sealed: Sealed, fromVersion: number) {
    const r = this.revocations.get(id);
    if (!r || r.sealed.keyVersion !== fromVersion) return false;
    r.sealed = sealed;
    return true;
  }
  async revocationDone(id: string) {
    this.revocations.delete(id);
  }
  async revocationFailed(id: string, input: { attempts: number; nextAttemptAt: string; error: string }) {
    const r = this.revocations.get(id);
    if (r) Object.assign(r, { attempts: input.attempts, nextAttemptAt: input.nextAttemptAt, lastError: input.error });
  }

  async insertPost(p: NewPost) {
    if ([...this.postsById.values()].some((x) => x.idempotencyKey === p.idempotencyKey)) return { ok: false as const, reason: "duplicate" as const };
    const now = this.clock().toISOString();
    const post: PostRecord = {
      ...p,
      id: randomUUID(),
      resumeAt: null,
      lockedAt: null,
      attempts: 0,
      uploadAttempts: 0,
      externalIds: {},
      externalPostId: null,
      permalink: null,
      lastError: null,
      costUsd: 0,
      publishedAt: null,
      createdAt: now,
      updatedAt: now,
    };
    this.postsById.set(post.id, post);
    return { ok: true as const, post: { ...post } };
  }
  async post(id: string) {
    const p = this.postsById.get(id);
    return p ? structuredClone(p) : null;
  }
  async postByKey(key: string) {
    const p = [...this.postsById.values()].find((x) => x.idempotencyKey === key);
    return p ? structuredClone(p) : null;
  }
  async posts(userId: string, campaignId: string | null, limit: number) {
    return [...this.postsById.values()]
      .filter((p) => p.userId === userId && (!campaignId || p.campaignId === campaignId))
      .slice(0, limit)
      .map((p) => structuredClone(p));
  }
  async cancelPost(userId: string, id: string, message: string) {
    const p = this.postsById.get(id);
    if (!p || p.userId !== userId) return { cancelled: false, post: null };
    if (!CANCELLABLE_STAGES.includes(p.stage) || p.lockedAt !== null) return { cancelled: false, post: structuredClone(p) };
    p.stage = "cancelled";
    p.lastError = message;
    p.resumeAt = null;
    return { cancelled: true, post: structuredClone(p) };
  }
  async cancelPostsForConnection(connectionId: string, message: string) {
    let n = 0;
    for (const p of this.postsById.values()) {
      if (p.connectionId === connectionId && CANCELLABLE_STAGES.includes(p.stage) && p.lockedAt === null) {
        p.stage = "cancelled";
        p.lastError = message;
        n++;
      }
    }
    return n;
  }
  async countPosts(input: { userId: string; network: Network; from: string; to: string }) {
    return [...this.postsById.values()].filter(
      (p) => p.userId === input.userId && p.network === input.network && LIVE.includes(p.stage) && p.scheduledFor !== null && p.scheduledFor >= input.from && p.scheduledFor <= input.to,
    ).length;
  }
  async countLivePosts(userId: string, network: Network) {
    return [...this.postsById.values()].filter((p) => p.userId === userId && p.network === network && LIVE.includes(p.stage)).length;
  }
  async recentOnConnection(connectionId: string, since: string) {
    return [...this.postsById.values()]
      .filter((p) => p.connectionId === connectionId && LIVE.includes(p.stage) && p.createdAt >= since)
      .map((p) => ({ finalText: p.finalText, renditionSha256: p.renditionSha256 }));
  }
  async livePostByPayload(connectionId: string, payloadSha256: string, since: string) {
    const found = [...this.postsById.values()]
      .filter((p) => p.connectionId === connectionId && p.payloadSha256 === payloadSha256 && LIVE.includes(p.stage) && p.createdAt >= since)
      .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
    return found[0] ?? null;
  }
  async tiktokPeopleSince(since: string) {
    return [
      ...new Set(
        [...this.postsById.values()]
          .filter((p) => p.network === "tiktok" && ["publishing", "published", "unconfirmed"].includes(p.stage) && p.updatedAt >= since)
          .map((p) => p.userId),
      ),
    ];
  }
  async claimPosts(limit: number, postId: string | null) {
    const now = this.clock();
    const nowIso = now.toISOString();
    const stale = new Date(now.getTime() - 6 * 60_000).toISOString();
    const out: Claimed[] = [];
    const rows = [...this.postsById.values()]
      .filter((d) => !postId || d.id === postId)
      .filter((d) => {
        const due = d.resumeAt ?? d.scheduledFor ?? nowIso;
        return (
          (["queued", "retry"].includes(d.stage) && due <= nowIso && (d.lockedAt === null || d.lockedAt < stale)) ||
          (["uploading", "media_ready", "publishing"].includes(d.stage) && d.lockedAt === null && d.resumeAt !== null && d.resumeAt <= nowIso) ||
          (["claimed", "uploading", "media_ready", "publishing"].includes(d.stage) && d.lockedAt !== null && d.lockedAt < stale)
        );
      })
      .sort((a, b) => ((a.resumeAt ?? a.scheduledFor ?? "") < (b.resumeAt ?? b.scheduledFor ?? "") ? -1 : 1))
      .slice(0, Math.min(Math.max(limit, 1), 25));
    for (const d of rows) {
      d.lockedAt = new Date(now.getTime() + out.length).toISOString();
      d.attempts++;
      if (d.stage === "queued" || d.stage === "retry") d.stage = "claimed";
      out.push({ id: d.id, userId: d.userId, network: d.network, stage: d.stage, lockedAt: d.lockedAt });
    }
    return out;
  }
  async savePost(id: string, lease: string, write: PostWrite) {
    const p = this.postsById.get(id);
    if (!p || p.lockedAt !== lease) return false;
    if (["published", "failed", "unconfirmed", "cancelled"].includes(p.stage) && write.stage && write.stage !== p.stage) {
      throw new Error("a closed post stays closed");
    }
    this.writes.push({ id, write: structuredClone(write) });
    if (write.stage !== undefined) p.stage = write.stage;
    if (write.resumeAt !== undefined) p.resumeAt = write.resumeAt;
    if (write.lockedAt !== undefined) p.lockedAt = write.lockedAt;
    if (write.externalIds !== undefined) p.externalIds = structuredClone(write.externalIds);
    if (write.externalPostId !== undefined) p.externalPostId = write.externalPostId;
    if (write.permalink !== undefined) p.permalink = write.permalink;
    if (write.lastError !== undefined) p.lastError = write.lastError;
    if (write.costUsd !== undefined) p.costUsd = write.costUsd;
    if (write.publishedAt !== undefined) p.publishedAt = write.publishedAt;
    if (write.uploadAttempts !== undefined) p.uploadAttempts = write.uploadAttempts;
    p.updatedAt = this.clock().toISOString();
    return true;
  }

  async campaignForPost(userId: string, campaignId: string) {
    const c = this.campaigns.get(campaignId);
    return c && c.userId === userId ? structuredClone(c) : null;
  }
  async signedUrl(bucket: string, path: string, seconds: number) {
    return this.files.has(`${bucket}/${path}`) ? `https://files.test/${bucket}/${path}?ttl=${seconds}` : null;
  }
  async download(bucket: string, path: string) {
    return this.files.get(`${bucket}/${path}`) ?? null;
  }
}
