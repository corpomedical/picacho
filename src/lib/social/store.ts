import type { SupabaseClient } from "@supabase/supabase-js";

// Every read and write publishing makes, behind one interface (SocialStore),
// so the service and the worker are tested against an in-memory store
// (fake-store.ts) and run against Supabase here. Every table is written with
// the SERVICE ROLE: press-tour-04-social.sql gives people no write privilege
// anywhere and no read privilege on the secrets, the states, the revokes or
// the queue; the owner filter is explicit in every query, and the table
// guards re-check ownership inside the database.
//
// Relative imports only (vitest has no '@/').

import type { Network, PostStage, RenditionKind } from "../press-tour/publish-types";
import { isNetwork, POST_STAGES } from "../press-tour/publish-types";
import { RENDITION_KINDS, parseRenditions } from "../press-tour/cut-state";
import type { ConsentRecord, PostOptions } from "./consent";
import type { StoredState } from "./oauth";
import type { Sealed, StoredKeys, VaultStore } from "./vault";

export type ConnectionRecord = {
  id: string;
  userId: string;
  network: Network;
  externalId: string;
  handle: string | null;
  displayName: string | null;
  scopes: string[];
  status: "connected" | "needs_reconnect";
  accessExpiresAt: string | null;
  refreshExpiresAt: string | null;
  lastRefreshedAt: string | null;
  createdAt: string;
};

export type PostRecord = {
  id: string;
  userId: string;
  campaignId: string | null;
  generationId: string | null;
  connectionId: string | null;
  network: Network;
  accountExternalId: string;
  rendition: RenditionKind;
  renditionPath: string;
  renditionSha256: string;
  caption: string;
  hashtags: string[];
  finalText: string;
  options: PostOptions;
  aiLabel: boolean;
  consent: ConsentRecord | null;
  payloadSha256: string | null;
  idempotencyKey: string;
  stage: PostStage;
  scheduledFor: string | null;
  resumeAt: string | null;
  lockedAt: string | null;
  attempts: number;
  uploadAttempts: number;
  externalIds: Record<string, unknown>;
  externalPostId: string | null;
  permalink: string | null;
  lastError: string | null;
  costUsd: number;
  publishedAt: string | null;
  trendDerived: boolean;
  createdAt: string;
  updatedAt: string;
};

export type NewPost = Omit<
  PostRecord,
  "id" | "resumeAt" | "lockedAt" | "attempts" | "uploadAttempts" | "externalIds" | "externalPostId" | "permalink" | "lastError" | "costUsd" | "publishedAt" | "createdAt" | "updatedAt"
>;

/** What the worker writes back under its lease. */
export type PostWrite = Partial<{
  stage: PostStage;
  resumeAt: string | null;
  lockedAt: string | null;
  externalIds: Record<string, unknown>;
  externalPostId: string | null;
  permalink: string | null;
  lastError: string | null;
  costUsd: number;
  publishedAt: string | null;
  uploadAttempts: number;
}>;

export type Claimed = { id: string; userId: string; network: Network; stage: PostStage; lockedAt: string };

/** A finished file of a campaign's cut, as press_campaigns.renditions holds it (written by Cut 4). */
export type StoredRendition = {
  kind: RenditionKind;
  bucket: string;
  path: string;
  sha256: string;
  sizeBytes: number | null;
  durationSeconds: number | null;
  posterPath: string | null;
  /** A C2PA manifest was written AND read back from this very file. Posting doesn't wait on it (PT-R3-01). */
  signed: boolean;
};

export type CampaignForPost = {
  id: string;
  userId: string;
  stage: string;
  masterGenerationId: string | null;
  productVerdict: string | null;
  renditions: Partial<Record<RenditionKind, StoredRendition>>;
};

export type RevocationRecord = {
  id: string;
  userId: string | null;
  network: Network;
  externalId: string;
  kind: "access" | "refresh";
  sealed: Sealed;
  attempts: number;
};

export type ProfileFacts = { role: unknown; plan: unknown; plan_status: unknown; status: unknown };

export interface SocialStore extends VaultStore {
  profile(userId: string): Promise<ProfileFacts | null>;
  testerNetworks(userId: string): Promise<string[]>;

  connections(userId: string): Promise<ConnectionRecord[]>;
  connection(userId: string, network: Network): Promise<ConnectionRecord | null>;
  connectionById(id: string): Promise<ConnectionRecord | null>;
  /** Insert or update the person's one connection on this network; answers its id. */
  upsertConnection(input: {
    userId: string;
    network: Network;
    externalId: string;
    handle: string | null;
    displayName: string | null;
    scopes: string[];
    accessExpiresAt: string | null;
    refreshExpiresAt: string | null;
    refreshedAt: string;
  }): Promise<string | null>;
  writeSecrets(connectionId: string, pair: { access: Sealed; refresh: Sealed | null }): Promise<boolean>;
  deleteConnection(id: string): Promise<boolean>;
  connectionsToRefresh(input: { networks: Network[]; expiresBefore: string; refreshedBefore: string; limit: number }): Promise<ConnectionRecord[]>;
  secretsOlderThan(keyVersion: number, limit: number): Promise<StoredKeys[]>;

  insertState(input: { stateHash: string; userId: string; network: Network; pkceVerifier: string | null; returnTo: string; expiresAt: string }): Promise<boolean>;
  /** Mark the state used and answer it, only if it was unused (atomic). */
  takeState(stateHash: string, now: string): Promise<StoredState | null>;
  pruneStates(before: string): Promise<void>;

  addRevocation(input: { id: string; userId: string | null; network: Network; externalId: string; kind: "access" | "refresh"; sealed: Sealed }): Promise<boolean>;
  dueRevocations(now: string, limit: number): Promise<RevocationRecord[]>;
  /** Owed revokes sealed under an older vault key than `keyVersion` (housekeeping re-seals them before the old key is removed). */
  revocationsOlderThan(keyVersion: number, limit: number): Promise<RevocationRecord[]>;
  /** The owed revoke's key sealed again; only if it is still under `fromVersion` (conditional). */
  resealRevocation(id: string, sealed: Sealed, fromVersion: number): Promise<boolean>;
  revocationDone(id: string): Promise<void>;
  revocationFailed(id: string, input: { attempts: number; nextAttemptAt: string; error: string }): Promise<void>;

  insertPost(post: NewPost): Promise<{ ok: true; post: PostRecord } | { ok: false; reason: "duplicate" | "unavailable" }>;
  post(id: string): Promise<PostRecord | null>;
  postByKey(key: string): Promise<PostRecord | null>;
  posts(userId: string, campaignId: string | null, limit: number): Promise<PostRecord[]>;
  /** Cancel while nothing has gone to the network (conditional); answers the row as it is after. */
  cancelPost(userId: string, id: string, message: string): Promise<{ cancelled: boolean; post: PostRecord | null }>;
  cancelPostsForConnection(connectionId: string, message: string): Promise<number>;
  /** Posts on this network that went, are going or will go out, scheduled within [from, to]. Null when unreadable. */
  countPosts(input: { userId: string; network: Network; from: string; to: string }): Promise<number | null>;
  /** Every post of this person on this network that went or is going out (for the trial's "once"). */
  countLivePosts(userId: string, network: Network): Promise<number | null>;
  recentOnConnection(connectionId: string, since: string): Promise<{ finalText: string; renditionSha256: string }[] | null>;
  /** The newest post on this account with exactly this consent hash, created since, that went, is going or will go out. */
  livePostByPayload(connectionId: string, payloadSha256: string, since: string): Promise<PostRecord | null | "unavailable">;
  /** Distinct people with a TikTok post sent (or being sent) since. Null when unreadable. */
  tiktokPeopleSince(since: string): Promise<string[] | null>;
  claimPosts(limit: number, postId: string | null): Promise<Claimed[]>;
  /** Write under the lease (locked_at = lease). False when the lease is gone. */
  savePost(id: string, lease: string, write: PostWrite): Promise<boolean>;

  campaignForPost(userId: string, campaignId: string): Promise<CampaignForPost | null | "unavailable">;
  signedUrl(bucket: string, path: string, seconds: number): Promise<string | null>;
  download(bucket: string, path: string): Promise<Buffer | null>;
}

// ---------------------------------------------------------------------
// Parsing (shared with the fake store and the tests)
// ---------------------------------------------------------------------

const s = (v: unknown): string | null => (typeof v === "string" && v.length > 0 ? v : null);
const n = (v: unknown): number | null => {
  const x = typeof v === "string" && v.trim() !== "" ? Number(v) : v;
  return typeof x === "number" && Number.isFinite(x) ? x : null;
};
const o = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);

export function connectionFrom(row: unknown): ConnectionRecord | null {
  const r = o(row);
  const id = s(r.id);
  const userId = s(r.user_id);
  const externalId = s(r.external_id);
  if (!id || !userId || !externalId || !isNetwork(r.network)) return null;
  return {
    id,
    userId,
    network: r.network,
    externalId,
    handle: s(r.handle),
    displayName: s(r.display_name),
    scopes: strings(r.scopes),
    status: r.status === "needs_reconnect" ? "needs_reconnect" : "connected",
    accessExpiresAt: s(r.access_expires_at),
    refreshExpiresAt: s(r.refresh_expires_at),
    lastRefreshedAt: s(r.last_refreshed_at),
    createdAt: s(r.created_at) ?? new Date(0).toISOString(),
  };
}

function isStage(v: unknown): v is PostStage {
  return typeof v === "string" && (POST_STAGES as readonly string[]).includes(v);
}

export function postFrom(row: unknown): PostRecord | null {
  const r = o(row);
  const id = s(r.id);
  const userId = s(r.user_id);
  if (!id || !userId || !isNetwork(r.network) || !isStage(r.stage)) return null;
  if (r.rendition !== "clean" && r.rendition !== "tagged") return null;
  const options = o(r.options) as PostOptions;
  return {
    id,
    userId,
    campaignId: s(r.campaign_id),
    generationId: s(r.generation_id),
    connectionId: s(r.connection_id),
    network: r.network,
    accountExternalId: s(r.account_external_id) ?? "",
    rendition: r.rendition,
    renditionPath: s(r.rendition_path) ?? "",
    renditionSha256: s(r.rendition_sha256) ?? "",
    caption: typeof r.caption === "string" ? r.caption : "",
    hashtags: strings(r.hashtags),
    finalText: typeof r.final_text === "string" ? r.final_text : "",
    options: { ...options, when: options.when === "scheduled" ? "scheduled" : "now" },
    aiLabel: r.ai_label === true,
    consent: r.consent && typeof r.consent === "object" ? (r.consent as ConsentRecord) : null,
    payloadSha256: s(r.payload_sha256),
    idempotencyKey: s(r.idempotency_key) ?? "",
    stage: r.stage,
    scheduledFor: s(r.scheduled_for),
    resumeAt: s(r.resume_at),
    lockedAt: s(r.locked_at),
    attempts: n(r.attempts) ?? 0,
    uploadAttempts: n(r.upload_attempts) ?? 0,
    externalIds: o(r.external_ids),
    externalPostId: s(r.external_post_id),
    permalink: s(r.permalink),
    lastError: s(r.last_error),
    costUsd: n(r.cost_usd) ?? 0,
    publishedAt: s(r.published_at),
    trendDerived: r.trend_derived === true,
    createdAt: s(r.created_at) ?? new Date(0).toISOString(),
    updatedAt: s(r.updated_at) ?? new Date(0).toISOString(),
  };
}

/**
 * press_campaigns.renditions as the cut writes it (press-tour/cut-state.ts,
 * Cut 4: {clean|tagged: {path, sha256, seconds, bytes, signed, signedAt,
 * ...}}), read through the cut's own parser so there is one shape. After
 * signing, path and sha256 name the SIGNED file; `signed` is true only when
 * the manifest was read back from that very file (and recorded when). Every
 * file is in press-kit.
 */
export function renditionsFrom(raw: unknown, bucket: string): Partial<Record<RenditionKind, StoredRendition>> {
  const recs = parseRenditions(raw);
  const out: Partial<Record<RenditionKind, StoredRendition>> = {};
  for (const kind of RENDITION_KINDS) {
    const r = recs[kind];
    if (!r) continue;
    out[kind] = {
      kind,
      bucket,
      path: r.path,
      sha256: r.sha256,
      sizeBytes: r.bytes > 0 ? r.bytes : null,
      durationSeconds: r.seconds > 0 ? r.seconds : null,
      posterPath: null,
      signed: r.signed,
    };
  }
  return out;
}

// ---------------------------------------------------------------------
// Supabase
// ---------------------------------------------------------------------

const CONNECTION_COLUMNS =
  "id, user_id, network, external_id, handle, display_name, scopes, status, access_expires_at, refresh_expires_at, last_refreshed_at, created_at";
export const POST_COLUMNS =
  "id, user_id, campaign_id, generation_id, connection_id, network, account_external_id, rendition, rendition_path, rendition_sha256, caption, hashtags, final_text, options, ai_label, consent, payload_sha256, idempotency_key, stage, scheduled_for, resume_at, locked_at, attempts, upload_attempts, external_ids, external_post_id, permalink, last_error, cost_usd, published_at, trend_derived, created_at, updated_at";
/** Stages whose post has gone, is going, or will go out (for the caps). */
const LIVE_STAGES = ["queued", "claimed", "uploading", "media_ready", "publishing", "published", "retry", "unconfirmed"];

const REVOCATION_COLUMNS = "id, user_id, network, external_id, token_kind, token_ciphertext, token_iv, token_tag, key_version, attempts";

function revocationsFrom(data: unknown[]): RevocationRecord[] {
  const out: RevocationRecord[] = [];
  for (const row of data as Record<string, unknown>[]) {
    const id = s(row.id);
    const sealed = sealedFrom(row.token_ciphertext, row.token_iv, row.token_tag, n(row.key_version) ?? 0);
    if (!id || !sealed || !isNetwork(row.network)) continue;
    out.push({
      id,
      userId: s(row.user_id),
      network: row.network,
      externalId: s(row.external_id) ?? "",
      kind: row.token_kind === "refresh" ? "refresh" : "access",
      sealed,
      attempts: n(row.attempts) ?? 0,
    });
  }
  return out;
}
/** Stages a person may still cancel (nothing has gone to the network). */
export const CANCELLABLE_STAGES: PostStage[] = ["draft", "queued", "retry", "platform_busy", "needs_reconnect"];

function sealedFrom(ct: unknown, iv: unknown, tag: unknown, version: number): Sealed | null {
  const c = s(ct);
  const i = s(iv);
  const t = s(tag);
  return c && i && t ? { ciphertext: c, iv: i, tag: t, keyVersion: version } : null;
}

function writeRow(w: PostWrite): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (w.stage !== undefined) out.stage = w.stage;
  if (w.resumeAt !== undefined) out.resume_at = w.resumeAt;
  if (w.lockedAt !== undefined) out.locked_at = w.lockedAt;
  if (w.externalIds !== undefined) out.external_ids = w.externalIds;
  if (w.externalPostId !== undefined) out.external_post_id = w.externalPostId;
  if (w.permalink !== undefined) out.permalink = w.permalink;
  if (w.lastError !== undefined) out.last_error = w.lastError;
  if (w.costUsd !== undefined) out.cost_usd = Math.round(w.costUsd * 10_000) / 10_000;
  if (w.publishedAt !== undefined) out.published_at = w.publishedAt;
  if (w.uploadAttempts !== undefined) out.upload_attempts = w.uploadAttempts;
  return out;
}

export function supabaseSocialStore(db: SupabaseClient): SocialStore {
  const store: SocialStore = {
    async profile(userId) {
      const { data, error } = await db.from("profiles").select("role, plan, plan_status, status").eq("id", userId).maybeSingle();
      if (error || !data) return null;
      return data as ProfileFacts;
    },

    async testerNetworks(userId) {
      try {
        const { data, error } = await db.from("press_social_testers").select("networks").eq("user_id", userId).maybeSingle();
        if (error || !data) return [];
        return strings((data as Record<string, unknown>).networks);
      } catch {
        return [];
      }
    },

    async connections(userId) {
      const { data, error } = await db.from("social_connections").select(CONNECTION_COLUMNS).eq("user_id", userId);
      if (error || !Array.isArray(data)) throw new Error("connections unavailable");
      return data.map(connectionFrom).filter((c): c is ConnectionRecord => c !== null);
    },

    async connection(userId, network) {
      const { data, error } = await db.from("social_connections").select(CONNECTION_COLUMNS).eq("user_id", userId).eq("network", network).maybeSingle();
      if (error) throw new Error("connection unavailable");
      return connectionFrom(data);
    },

    async connectionById(id) {
      const { data, error } = await db.from("social_connections").select(CONNECTION_COLUMNS).eq("id", id).maybeSingle();
      if (error) throw new Error("connection unavailable");
      return connectionFrom(data);
    },

    async upsertConnection(input) {
      const { data, error } = await db
        .from("social_connections")
        .upsert(
          {
            user_id: input.userId,
            network: input.network,
            external_id: input.externalId,
            handle: input.handle,
            display_name: input.displayName,
            scopes: input.scopes.slice(0, 16),
            status: "connected",
            access_expires_at: input.accessExpiresAt,
            refresh_expires_at: input.refreshExpiresAt,
            last_refreshed_at: input.refreshedAt,
            refresh_lease_until: null,
          },
          { onConflict: "user_id,network" },
        )
        .select("id")
        .single();
      if (error || !data) return null;
      return s((data as Record<string, unknown>).id);
    },

    async writeSecrets(connectionId, pair) {
      const { error } = await db.from("social_connection_secrets").upsert(
        {
          connection_id: connectionId,
          access_ciphertext: pair.access.ciphertext,
          access_iv: pair.access.iv,
          access_tag: pair.access.tag,
          refresh_ciphertext: pair.refresh?.ciphertext ?? null,
          refresh_iv: pair.refresh?.iv ?? null,
          refresh_tag: pair.refresh?.tag ?? null,
          key_version: pair.access.keyVersion,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "connection_id" },
      );
      return !error;
    },

    async deleteConnection(id) {
      const { error } = await db.from("social_connections").delete().eq("id", id);
      return !error;
    },

    async connectionsToRefresh({ networks, expiresBefore, refreshedBefore, limit }) {
      const { data, error } = await db
        .from("social_connections")
        .select(CONNECTION_COLUMNS)
        .eq("status", "connected")
        .in("network", networks)
        .lt("access_expires_at", expiresBefore)
        .or(`last_refreshed_at.is.null,last_refreshed_at.lt."${refreshedBefore}"`)
        .order("access_expires_at", { ascending: true })
        .limit(limit);
      if (error || !Array.isArray(data)) return [];
      return data.map(connectionFrom).filter((c): c is ConnectionRecord => c !== null);
    },

    async secretsOlderThan(keyVersion, limit) {
      const { data, error } = await db
        .from("social_connection_secrets")
        .select("connection_id")
        .lt("key_version", keyVersion)
        .limit(limit);
      if (error || !Array.isArray(data)) return [];
      const out: StoredKeys[] = [];
      for (const row of data as Record<string, unknown>[]) {
        const id = s(row.connection_id);
        if (!id) continue;
        const keys = await store.readKeys(id);
        if (keys) out.push(keys);
      }
      return out;
    },

    // --- the vault's lock (vault.ts VaultStore) ---

    async readKeys(connectionId) {
      const [conn, sec] = await Promise.all([
        db.from("social_connections").select("id, status, access_expires_at, refresh_expires_at, last_refreshed_at").eq("id", connectionId).maybeSingle(),
        db
          .from("social_connection_secrets")
          .select("access_ciphertext, access_iv, access_tag, refresh_ciphertext, refresh_iv, refresh_tag, key_version")
          .eq("connection_id", connectionId)
          .maybeSingle(),
      ]);
      if (conn.error || sec.error) throw new Error("keys unavailable");
      if (!conn.data || !sec.data) return null;
      const c = conn.data as Record<string, unknown>;
      const k = sec.data as Record<string, unknown>;
      const version = n(k.key_version) ?? 0;
      const access = sealedFrom(k.access_ciphertext, k.access_iv, k.access_tag, version);
      if (!access) return null;
      return {
        connectionId,
        status: c.status === "needs_reconnect" ? "needs_reconnect" : "connected",
        access,
        refresh: sealedFrom(k.refresh_ciphertext, k.refresh_iv, k.refresh_tag, version),
        accessExpiresAt: s(c.access_expires_at),
        refreshExpiresAt: s(c.refresh_expires_at),
        lastRefreshedAt: s(c.last_refreshed_at),
      };
    },

    async tryLease(connectionId, until, now) {
      const { data, error } = await db
        .from("social_connections")
        .update({ refresh_lease_until: until.toISOString() })
        .eq("id", connectionId)
        .or(`refresh_lease_until.is.null,refresh_lease_until.lt."${now.toISOString()}"`)
        .select("id");
      return !error && Array.isArray(data) && data.length === 1;
    },

    async releaseLease(connectionId) {
      await db.from("social_connections").update({ refresh_lease_until: null }).eq("id", connectionId);
    },

    async writeKeys(connectionId, pair, facts) {
      // The pair in ONE update of the secrets row.
      const { data, error } = await db
        .from("social_connection_secrets")
        .update({
          access_ciphertext: pair.access.ciphertext,
          access_iv: pair.access.iv,
          access_tag: pair.access.tag,
          refresh_ciphertext: pair.refresh?.ciphertext ?? null,
          refresh_iv: pair.refresh?.iv ?? null,
          refresh_tag: pair.refresh?.tag ?? null,
          key_version: pair.access.keyVersion,
          updated_at: facts.refreshedAt.toISOString(),
        })
        .eq("connection_id", connectionId)
        .select("connection_id");
      if (error || !Array.isArray(data) || data.length !== 1) return false;
      await db
        .from("social_connections")
        .update({
          access_expires_at: facts.accessExpiresAt?.toISOString() ?? null,
          refresh_expires_at: facts.refreshExpiresAt?.toISOString() ?? null,
          last_refreshed_at: facts.refreshedAt.toISOString(),
          refresh_lease_until: null,
          status: "connected",
        })
        .eq("id", connectionId);
      return true;
    },

    async markNeedsReconnect(connectionId) {
      await db.from("social_connections").update({ status: "needs_reconnect", refresh_lease_until: null }).eq("id", connectionId);
    },

    // --- connect states ---

    async insertState(input) {
      const { error } = await db.from("oauth_states").insert({
        state_hash: input.stateHash,
        user_id: input.userId,
        network: input.network,
        pkce_verifier: input.pkceVerifier,
        return_to: input.returnTo,
        expires_at: input.expiresAt,
      });
      return !error;
    },

    async takeState(stateHash, now) {
      const { data, error } = await db
        .from("oauth_states")
        .update({ used_at: now })
        .eq("state_hash", stateHash)
        .is("used_at", null)
        .select("user_id, network, pkce_verifier, return_to, expires_at, used_at");
      if (error || !Array.isArray(data) || data.length !== 1) return null;
      const r = data[0] as Record<string, unknown>;
      return {
        userId: s(r.user_id) ?? "",
        network: s(r.network) ?? "",
        pkceVerifier: s(r.pkce_verifier),
        returnTo: s(r.return_to) ?? "/app/press-tour",
        expiresAt: s(r.expires_at) ?? new Date(0).toISOString(),
        usedAt: s(r.used_at),
      };
    },

    async pruneStates(before) {
      await db.from("oauth_states").delete().lt("expires_at", before);
    },

    // --- owed revokes ---

    async addRevocation(input) {
      const { error } = await db.from("social_revocations").insert({
        id: input.id,
        user_id: input.userId,
        network: input.network,
        external_id: input.externalId,
        token_kind: input.kind,
        token_ciphertext: input.sealed.ciphertext,
        token_iv: input.sealed.iv,
        token_tag: input.sealed.tag,
        key_version: input.sealed.keyVersion,
      });
      return !error;
    },

    async dueRevocations(now, limit) {
      const { data, error } = await db
        .from("social_revocations")
        .select(REVOCATION_COLUMNS)
        .lte("next_attempt_at", now)
        .order("next_attempt_at", { ascending: true })
        .limit(limit);
      if (error || !Array.isArray(data)) return [];
      return revocationsFrom(data);
    },

    async revocationsOlderThan(keyVersion, limit) {
      const { data, error } = await db.from("social_revocations").select(REVOCATION_COLUMNS).lt("key_version", keyVersion).limit(limit);
      if (error || !Array.isArray(data)) return [];
      return revocationsFrom(data);
    },

    async resealRevocation(id, sealed, fromVersion) {
      const { data, error } = await db
        .from("social_revocations")
        .update({ token_ciphertext: sealed.ciphertext, token_iv: sealed.iv, token_tag: sealed.tag, key_version: sealed.keyVersion })
        .eq("id", id)
        .eq("key_version", fromVersion)
        .select("id");
      return !error && Array.isArray(data) && data.length > 0;
    },

    async revocationDone(id) {
      await db.from("social_revocations").delete().eq("id", id);
    },

    async revocationFailed(id, input) {
      await db
        .from("social_revocations")
        .update({ attempts: input.attempts, next_attempt_at: input.nextAttemptAt, last_error: input.error.slice(0, 500) })
        .eq("id", id);
    },

    // --- posts ---

    async insertPost(p) {
      const { data, error } = await db
        .from("scheduled_posts")
        .insert({
          user_id: p.userId,
          campaign_id: p.campaignId,
          generation_id: p.generationId,
          connection_id: p.connectionId,
          network: p.network,
          account_external_id: p.accountExternalId,
          rendition: p.rendition,
          rendition_path: p.renditionPath,
          rendition_sha256: p.renditionSha256,
          caption: p.caption,
          hashtags: p.hashtags,
          final_text: p.finalText,
          options: p.options,
          ai_label: true,
          consent: p.consent,
          payload_sha256: p.payloadSha256,
          idempotency_key: p.idempotencyKey,
          stage: p.stage,
          scheduled_for: p.scheduledFor,
          trend_derived: p.trendDerived,
        })
        .select(POST_COLUMNS)
        .single();
      if (error) return { ok: false, reason: error.code === "23505" ? "duplicate" : "unavailable" };
      const post = postFrom(data);
      return post ? { ok: true, post } : { ok: false, reason: "unavailable" };
    },

    async post(id) {
      const { data, error } = await db.from("scheduled_posts").select(POST_COLUMNS).eq("id", id).is("deleted_at", null).maybeSingle();
      if (error) throw new Error("post unavailable");
      return postFrom(data);
    },

    async postByKey(key) {
      const { data, error } = await db.from("scheduled_posts").select(POST_COLUMNS).eq("idempotency_key", key).maybeSingle();
      if (error) throw new Error("post unavailable");
      return postFrom(data);
    },

    async posts(userId, campaignId, limit) {
      let q = db.from("scheduled_posts").select(POST_COLUMNS).eq("user_id", userId).is("deleted_at", null);
      if (campaignId) q = q.eq("campaign_id", campaignId);
      const { data, error } = await q.order("created_at", { ascending: false }).limit(limit);
      if (error || !Array.isArray(data)) throw new Error("posts unavailable");
      return data.map(postFrom).filter((p): p is PostRecord => p !== null);
    },

    async cancelPost(userId, id, message) {
      const { data, error } = await db
        .from("scheduled_posts")
        .update({ stage: "cancelled", last_error: message, resume_at: null })
        .eq("id", id)
        .eq("user_id", userId)
        .in("stage", CANCELLABLE_STAGES)
        .is("locked_at", null)
        .select(POST_COLUMNS);
      if (error) throw new Error("cancel unavailable");
      if (Array.isArray(data) && data.length === 1) return { cancelled: true, post: postFrom(data[0]) };
      const { data: now } = await db.from("scheduled_posts").select(POST_COLUMNS).eq("id", id).eq("user_id", userId).maybeSingle();
      return { cancelled: false, post: postFrom(now) };
    },

    async cancelPostsForConnection(connectionId, message) {
      const { data, error } = await db
        .from("scheduled_posts")
        .update({ stage: "cancelled", last_error: message, resume_at: null })
        .eq("connection_id", connectionId)
        .in("stage", CANCELLABLE_STAGES)
        .is("locked_at", null)
        .select("id");
      return error || !Array.isArray(data) ? 0 : data.length;
    },

    async countPosts({ userId, network, from, to }) {
      const { count, error } = await db
        .from("scheduled_posts")
        .select("id", { count: "exact", head: true })
        .eq("user_id", userId)
        .eq("network", network)
        .in("stage", LIVE_STAGES)
        .gte("scheduled_for", from)
        .lte("scheduled_for", to);
      return error || typeof count !== "number" ? null : count;
    },

    async countLivePosts(userId, network) {
      const { count, error } = await db
        .from("scheduled_posts")
        .select("id", { count: "exact", head: true })
        .eq("user_id", userId)
        .eq("network", network)
        .in("stage", LIVE_STAGES);
      return error || typeof count !== "number" ? null : count;
    },

    async recentOnConnection(connectionId, since) {
      const { data, error } = await db
        .from("scheduled_posts")
        .select("final_text, rendition_sha256")
        .eq("connection_id", connectionId)
        .in("stage", LIVE_STAGES)
        .gte("created_at", since)
        .limit(200);
      if (error || !Array.isArray(data)) return null;
      return (data as Record<string, unknown>[]).map((r) => ({ finalText: String(r.final_text ?? ""), renditionSha256: String(r.rendition_sha256 ?? "") }));
    },

    async livePostByPayload(connectionId, payloadSha256, since) {
      const { data, error } = await db
        .from("scheduled_posts")
        .select(POST_COLUMNS)
        .eq("connection_id", connectionId)
        .eq("payload_sha256", payloadSha256)
        .in("stage", LIVE_STAGES)
        .gte("created_at", since)
        .order("created_at", { ascending: false })
        .limit(1);
      if (error || !Array.isArray(data)) return "unavailable";
      return data.length > 0 ? postFrom(data[0]) : null;
    },

    async tiktokPeopleSince(since) {
      const { data, error } = await db
        .from("scheduled_posts")
        .select("user_id")
        .eq("network", "tiktok")
        .in("stage", ["publishing", "published", "unconfirmed"])
        .gte("updated_at", since)
        .limit(1000);
      if (error || !Array.isArray(data)) return null;
      return [...new Set((data as Record<string, unknown>[]).map((r) => String(r.user_id)))];
    },

    async claimPosts(limit, postId) {
      const { data, error } = await db.rpc("claim_scheduled_posts", { p_limit: limit, p_post: postId });
      if (error || !Array.isArray(data)) return [];
      const out: Claimed[] = [];
      for (const r of data as Record<string, unknown>[]) {
        const id = s(r.id);
        const userId = s(r.user_id);
        const lockedAt = s(r.locked_at);
        if (id && userId && lockedAt && isNetwork(r.network) && isStage(r.stage)) out.push({ id, userId, network: r.network, stage: r.stage, lockedAt });
      }
      return out;
    },

    async savePost(id, lease, write) {
      const { data, error } = await db.from("scheduled_posts").update(writeRow(write)).eq("id", id).eq("locked_at", lease).select("id");
      return !error && Array.isArray(data) && data.length === 1;
    },

    // --- the campaign's cut ---

    async campaignForPost(userId, campaignId) {
      try {
        const { data, error } = await db
          .from("press_campaigns")
          .select("id, user_id, stage, master_generation_id, product_verdict, renditions")
          .eq("id", campaignId)
          .eq("user_id", userId)
          .is("deleted_at", null)
          .maybeSingle();
        if (error) return "unavailable";
        if (!data) return null;
        const r = data as Record<string, unknown>;
        return {
          id: String(r.id),
          userId: String(r.user_id),
          stage: String(r.stage ?? ""),
          masterGenerationId: s(r.master_generation_id),
          productVerdict: s(r.product_verdict),
          renditions: renditionsFrom(r.renditions, "press-kit"),
        };
      } catch {
        return "unavailable";
      }
    },

    async signedUrl(bucket, path, seconds) {
      try {
        const { data, error } = await db.storage.from(bucket).createSignedUrl(path, seconds);
        return error || !data?.signedUrl ? null : data.signedUrl;
      } catch {
        return null;
      }
    },

    async download(bucket, path) {
      try {
        const { data, error } = await db.storage.from(bucket).download(path);
        if (error || !data) return null;
        return Buffer.from(await data.arrayBuffer());
      } catch {
        return null;
      }
    },
  };
  return store;
}
