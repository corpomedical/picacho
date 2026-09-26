// The authorization server's records (supabase/pending/
// press-tour-07-mcp-oauth.sql): clients, pending authorizations, grants,
// codes and tokens. Every table has RLS on and ZERO policies; only the
// service role reads or writes them, and every read that a person asked
// for names its owner explicitly.
//
// NOTHING SECRET IS STORED. Codes, access tokens and refresh tokens are kept
// as SHA-256 hashes (tokens.ts); the plaintext exists in exactly one
// response. A database dump can revoke tokens; it cannot use one.
//
// EVERY "ONCE" IS ONE STATEMENT. A code is spent, a refresh token rotated
// and a pending authorization answered by a single conditional UPDATE
// (`where used_at is null …`) whose returned rows say whether THIS call won.
// The loser of a race learns it from the same statement, never from a read
// made a moment earlier.
//
// REUSE IS AN ALARM (OAuth 2.1 §4.3.1, RFC 6749 §4.1.2). A code presented a
// second time, or a refresh token presented after it was rotated, revokes
// every token of its family: a stolen copy and the real one can no longer
// both be live, and the person reconnects once.
//
// A REVOKED FAMILY STAYS REVOKED (fixer 2026-09-26, SEC-2). Spending a
// refresh token (or a code) and writing the new pair are two statements, so
// the loser of a race could revoke the family between them and the
// winner's pair would land live. So revocation marks the FAMILY first
// (oauth_revoked_families), then its rows; the database refuses a new
// token in a marked family (oauth_tokens_guard); the winner looks again
// after writing its pair and revokes it if the family was marked; and every
// use of a token (verifyAccessToken, refreshTokens) checks the mark too.
//
// Alias-free: tests run it against an in-memory database.

import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { errorRedirect, successRedirect, type PendingInput } from "./authorize";
import { clientTrust, fetchClientDocument, isCimdClientId, type ClientKind, type ClientTrust, type DcrMetadata, type DocumentFetcher, type OAuthClient } from "./clients";
import {
  ACCESS_TOKEN_TTL_S,
  AUTH_CODE_TTL_S,
  CIMD_CACHE_S,
  PENDING_TTL_S,
  REFRESH_TOKEN_TTL_S,
  normaliseScopes,
  parseScopeParam,
  scopeString,
  verifiedHostOf,
  type McpScope,
} from "./config";
import { hashSecret, newAccessToken, newAuthCode, newClientId, newRefreshToken, verifyPkce } from "./tokens";

export const OAUTH_TABLES = {
  clients: "oauth_clients",
  pending: "oauth_pending_authorizations",
  grants: "oauth_grants",
  codes: "oauth_codes",
  tokens: "oauth_tokens",
  revokedFamilies: "oauth_revoked_families",
} as const;

/** A registered app's last use is stamped at most this often (the daily prune keeps apps used within 30 days). */
const CLIENT_TOUCH_S = 24 * 60 * 60;

export type StoreDeps = { now?: () => Date; newId?: () => string };
const nowOf = (deps: StoreDeps | undefined) => (deps?.now ? deps.now() : new Date());
const newIdOf = (deps: StoreDeps | undefined) => (deps?.newId ? deps.newId() : randomUUID());
const plus = (d: Date, seconds: number) => new Date(d.getTime() + seconds * 1000).toISOString();
const str = (v: unknown): string | null => (typeof v === "string" ? v : null);
const rows = (data: unknown): Record<string, unknown>[] => (Array.isArray(data) ? (data as Record<string, unknown>[]) : []);

// ---------------------------------------------------------------------------
// Clients
// ---------------------------------------------------------------------------

const CLIENT_COLUMNS = "client_id, kind, client_name, redirect_uris, trust, disabled_at, fetched_at";

function clientFrom(raw: unknown): OAuthClient | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const clientId = str(r.client_id);
  const kind = r.kind === "cimd" || r.kind === "dcr" ? (r.kind as ClientKind) : null;
  const uris = Array.isArray(r.redirect_uris) ? r.redirect_uris.filter((u): u is string => typeof u === "string") : [];
  if (!clientId || !kind || uris.length === 0) return null;
  const trust: ClientTrust = r.trust === "verified" || r.trust === "loopback" ? r.trust : "unverified";
  return {
    clientId,
    kind,
    name: str(r.client_name) ?? "An app",
    redirectUris: uris,
    // Trust is re-derived from the addresses, never taken from the column
    // alone: a row edited by hand cannot make a client more trusted than its
    // redirects are.
    trust: clientTrust(uris) === trust ? trust : clientTrust(uris),
    disabled: r.disabled_at !== null && r.disabled_at !== undefined,
    fetchedAt: str(r.fetched_at),
  };
}

export async function readClient(db: SupabaseClient, clientId: string): Promise<OAuthClient | null | "unavailable"> {
  try {
    const { data, error } = await db.from(OAUTH_TABLES.clients).select(CLIENT_COLUMNS).eq("client_id", clientId).maybeSingle();
    if (error) return "unavailable";
    return clientFrom(data);
  } catch {
    return "unavailable";
  }
}

/**
 * A client_id as an authorization request names it: a registered client, or
 * a client metadata document read (again, once a day) through the fetcher.
 * A document that cannot be read now leaves the copy read before, if any.
 */
export async function resolveClient(
  db: SupabaseClient,
  clientId: unknown,
  deps: StoreDeps & { fetchDocument: DocumentFetcher },
): Promise<OAuthClient | null | "unavailable"> {
  if (typeof clientId !== "string" || clientId.length === 0 || clientId.length > 512) return null;
  const known = await readClient(db, clientId);
  if (known === "unavailable") return known;
  if (!isCimdClientId(clientId)) {
    if (!known || known.kind !== "dcr") return null;
    await touchClient(db, clientId, nowOf(deps));
    return known;
  }

  const now = nowOf(deps);
  const fresh = known && known.fetchedAt && now.getTime() - Date.parse(known.fetchedAt) < CIMD_CACHE_S * 1000;
  if (known && fresh) return known;
  const doc = await fetchClientDocument(clientId, deps.fetchDocument);
  if (!doc) return known;
  const row = {
    client_id: clientId,
    kind: "cimd",
    client_name: doc.name,
    redirect_uris: doc.redirectUris,
    trust: clientTrust(doc.redirectUris),
    metadata: {},
    fetched_at: now.toISOString(),
    updated_at: now.toISOString(),
  };
  try {
    const { data, error } = await db.from(OAUTH_TABLES.clients).upsert(row, { onConflict: "client_id" }).select(CLIENT_COLUMNS).maybeSingle();
    if (error) return known ?? "unavailable";
    return clientFrom(data) ?? known;
  } catch {
    return known ?? "unavailable";
  }
}

/**
 * Stamps a registered app's last use (at most daily, one conditional
 * UPDATE, best effort): the daily prune removes apps nobody has used for
 * 30 days and that never connected (prune.ts). A CIMD app's re-read does
 * the same through its upsert.
 */
async function touchClient(db: SupabaseClient, clientId: string, now: Date): Promise<void> {
  try {
    await db
      .from(OAUTH_TABLES.clients)
      .update({ updated_at: now.toISOString() })
      .eq("client_id", clientId)
      .lt("updated_at", new Date(now.getTime() - CLIENT_TOUCH_S * 1000).toISOString());
  } catch {
    /* a stale stamp only makes the app look older to the prune, which still keeps any app with a connection */
  }
}

/** A dynamically registered client (RFC 7591). Its trust comes from its redirects alone. */
export async function registerClient(
  db: SupabaseClient,
  meta: DcrMetadata,
  input: { ipHash: string | null },
  deps?: StoreDeps & { newClientId?: () => string },
): Promise<OAuthClient | null> {
  const clientId = deps?.newClientId ? deps.newClientId() : newClientId();
  const now = nowOf(deps).toISOString();
  try {
    const { data, error } = await db
      .from(OAUTH_TABLES.clients)
      .insert({
        client_id: clientId,
        kind: "dcr",
        client_name: meta.name,
        client_uri: meta.clientUri,
        redirect_uris: meta.redirectUris,
        trust: clientTrust(meta.redirectUris),
        metadata: { scope: scopeString(meta.scopes), software_id: meta.softwareId },
        registration_ip_hash: input.ipHash,
        created_at: now,
        updated_at: now,
      })
      .select(CLIENT_COLUMNS)
      .single();
    if (error) return null;
    return clientFrom(data);
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Pending authorizations
// ---------------------------------------------------------------------------

export type PendingRow = PendingInput & {
  id: string;
  userId: string | null;
  expiresAt: string;
  usedAt: string | null;
};

const PENDING_COLUMNS = "id, client_id, redirect_uri, state, code_challenge, resource, scopes, user_id, expires_at, used_at";

function pendingFrom(raw: unknown): PendingRow | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const id = str(r.id);
  const clientId = str(r.client_id);
  const redirectUri = str(r.redirect_uri);
  const codeChallenge = str(r.code_challenge);
  const resource = str(r.resource);
  const expiresAt = str(r.expires_at);
  if (!id || !clientId || !redirectUri || !codeChallenge || !resource || !expiresAt) return null;
  return {
    id,
    clientId,
    redirectUri,
    state: str(r.state),
    codeChallenge,
    resource,
    scopes: normaliseScopes(r.scopes),
    userId: str(r.user_id),
    expiresAt,
    usedAt: str(r.used_at),
  };
}

export async function createPending(db: SupabaseClient, input: PendingInput, deps?: StoreDeps): Promise<string | null> {
  const id = newIdOf(deps);
  const now = nowOf(deps);
  try {
    const { error } = await db.from(OAUTH_TABLES.pending).insert({
      id,
      client_id: input.clientId,
      redirect_uri: input.redirectUri,
      state: input.state,
      code_challenge: input.codeChallenge,
      code_challenge_method: "S256",
      resource: input.resource,
      scopes: input.scopes,
      created_at: now.toISOString(),
      expires_at: plus(now, PENDING_TTL_S),
    });
    return error ? null : id;
  } catch {
    return null;
  }
}

export async function readPending(db: SupabaseClient, id: string): Promise<PendingRow | null | "unavailable"> {
  try {
    const { data, error } = await db.from(OAUTH_TABLES.pending).select(PENDING_COLUMNS).eq("id", id).maybeSingle();
    if (error) return "unavailable";
    return pendingFrom(data);
  } catch {
    return "unavailable";
  }
}

/** Whether a pending authorization can still be answered (not answered, not expired). */
export function pendingOpen(p: PendingRow, now: Date): boolean {
  return p.usedAt === null && Date.parse(p.expiresAt) > now.getTime();
}

/**
 * Ties a pending authorization to the first signed-in account that opens it
 * (v2 #29: its user must equal the session from then on). "other_user" when
 * another account already holds it.
 */
export async function bindPending(
  db: SupabaseClient,
  id: string,
  userId: string,
  deps?: StoreDeps,
): Promise<"bound" | "other_user" | "gone" | "unavailable"> {
  const now = nowOf(deps);
  try {
    const { data, error } = await db
      .from(OAUTH_TABLES.pending)
      .update({ user_id: userId })
      .eq("id", id)
      .is("user_id", null)
      .is("used_at", null)
      .gt("expires_at", now.toISOString())
      .select("id");
    if (error) return "unavailable";
    if (rows(data).length > 0) return "bound";
  } catch {
    return "unavailable";
  }
  const again = await readPending(db, id);
  if (again === "unavailable") return again;
  if (!again || !pendingOpen(again, now)) return "gone";
  return again.userId === userId ? "bound" : "other_user";
}

// ---------------------------------------------------------------------------
// The person's answer
// ---------------------------------------------------------------------------

export type Decision = { ok: true; redirect: string } | { ok: false; reason: "gone" | "other_user" | "unavailable" };

/**
 * Answers a pending authorization, once. Approval records (or renews) the
 * grant and issues a code: 5 minutes, single use, bound to the client, the
 * redirect, the PKCE challenge, the resource and the scopes. Either way the
 * answer is a redirect back to the app carrying `state` and `iss`.
 */
export async function decidePending(
  db: SupabaseClient,
  input: { pendingId: string; userId: string; approve: boolean; issuer: string },
  deps?: StoreDeps & { newCode?: () => string },
): Promise<Decision> {
  const now = nowOf(deps);
  let pending: PendingRow | null = null;
  try {
    const { data, error } = await db
      .from(OAUTH_TABLES.pending)
      .update({ used_at: now.toISOString(), decision: input.approve ? "approved" : "denied" })
      .eq("id", input.pendingId)
      .eq("user_id", input.userId)
      .is("used_at", null)
      .gt("expires_at", now.toISOString())
      .select(PENDING_COLUMNS);
    if (error) return { ok: false, reason: "unavailable" };
    pending = pendingFrom(rows(data)[0]);
  } catch {
    return { ok: false, reason: "unavailable" };
  }
  if (!pending) {
    const again = await readPending(db, input.pendingId);
    if (again === "unavailable") return { ok: false, reason: "unavailable" };
    if (again && pendingOpen(again, now) && again.userId !== input.userId) return { ok: false, reason: "other_user" };
    return { ok: false, reason: "gone" };
  }

  if (!input.approve) {
    return {
      ok: true,
      redirect: errorRedirect(pending.redirectUri, {
        error: "access_denied",
        description: "The person declined to connect.",
        state: pending.state,
        issuer: input.issuer,
      }),
    };
  }

  const grantId = await upsertGrant(db, { userId: input.userId, clientId: pending.clientId, resource: pending.resource, scopes: pending.scopes }, now);
  if (!grantId) return { ok: false, reason: "unavailable" };
  const code = deps?.newCode ? deps.newCode() : newAuthCode();
  try {
    const { error } = await db.from(OAUTH_TABLES.codes).insert({
      code_hash: hashSecret(code),
      grant_id: grantId,
      user_id: input.userId,
      client_id: pending.clientId,
      redirect_uri: pending.redirectUri,
      code_challenge: pending.codeChallenge,
      resource: pending.resource,
      scopes: pending.scopes,
      created_at: now.toISOString(),
      expires_at: plus(now, AUTH_CODE_TTL_S),
    });
    if (error) return { ok: false, reason: "unavailable" };
  } catch {
    return { ok: false, reason: "unavailable" };
  }
  return { ok: true, redirect: successRedirect(pending.redirectUri, { code, state: pending.state, issuer: input.issuer }) };
}

/**
 * One live grant per account, app and resource. Approving again replaces its
 * scopes with what the person approved now (narrowing a grant narrows every
 * token under it: verifyAccessToken intersects the two).
 */
async function upsertGrant(
  db: SupabaseClient,
  input: { userId: string; clientId: string; resource: string; scopes: McpScope[] },
  now: Date,
): Promise<string | null> {
  try {
    const { data: live } = await db
      .from(OAUTH_TABLES.grants)
      .select("id")
      .eq("user_id", input.userId)
      .eq("client_id", input.clientId)
      .eq("resource", input.resource)
      .is("revoked_at", null)
      .maybeSingle();
    const liveId = str((live as { id?: unknown } | null)?.id);
    if (liveId) {
      const { error } = await db
        .from(OAUTH_TABLES.grants)
        .update({ scopes: input.scopes, updated_at: now.toISOString() })
        .eq("id", liveId)
        .eq("user_id", input.userId);
      return error ? null : liveId;
    }
    const { data, error } = await db
      .from(OAUTH_TABLES.grants)
      .insert({
        user_id: input.userId,
        client_id: input.clientId,
        resource: input.resource,
        scopes: input.scopes,
        created_at: now.toISOString(),
        updated_at: now.toISOString(),
      })
      .select("id")
      .single();
    if (error) {
      // Another approval made the live grant first (the partial unique index): use it.
      const { data: again } = await db
        .from(OAUTH_TABLES.grants)
        .select("id")
        .eq("user_id", input.userId)
        .eq("client_id", input.clientId)
        .eq("resource", input.resource)
        .is("revoked_at", null)
        .maybeSingle();
      return str((again as { id?: unknown } | null)?.id);
    }
    return str((data as { id?: unknown } | null)?.id);
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// The token endpoint
// ---------------------------------------------------------------------------

export type TokenSuccess = {
  access_token: string;
  token_type: "Bearer";
  expires_in: number;
  refresh_token: string;
  scope: string;
};
export type TokenError = { status: 400 | 401 | 503; error: string; error_description: string };
export type TokenAnswer = { ok: true; body: TokenSuccess } | ({ ok: false } & TokenError);

const tokenError = (status: TokenError["status"], error: string, description: string): TokenAnswer => ({
  ok: false,
  status,
  error,
  error_description: description,
});
const UNAVAILABLE = () => tokenError(503, "temporarily_unavailable", "Try again in a moment.");

type GrantRow = { id: string; userId: string; clientId: string; scopes: McpScope[]; resource: string; revoked: boolean };

async function readGrant(db: SupabaseClient, id: string): Promise<GrantRow | null | "unavailable"> {
  try {
    const { data, error } = await db
      .from(OAUTH_TABLES.grants)
      .select("id, user_id, client_id, scopes, resource, revoked_at")
      .eq("id", id)
      .maybeSingle();
    if (error) return "unavailable";
    const r = data as Record<string, unknown> | null;
    if (!r || !str(r.id) || !str(r.user_id) || !str(r.client_id) || !str(r.resource)) return null;
    return {
      id: r.id as string,
      userId: r.user_id as string,
      clientId: r.client_id as string,
      scopes: normaliseScopes(r.scopes),
      resource: r.resource as string,
      revoked: r.revoked_at !== null && r.revoked_at !== undefined,
    };
  } catch {
    return "unavailable";
  }
}

/**
 * Revokes a family: the family is MARKED first (so a pair being written
 * into it right now is refused or taken back: SEC-2), then every live token
 * in it. True when both writes went through. A failure is logged (the
 * family's id only, never a token) and leaves the tokens to expire.
 */
export async function revokeFamily(db: SupabaseClient, familyId: string, deps?: StoreDeps): Promise<boolean> {
  const at = nowOf(deps).toISOString();
  let ok = true;
  try {
    const { error } = await db
      .from(OAUTH_TABLES.revokedFamilies)
      .upsert({ family_id: familyId, revoked_at: at }, { onConflict: "family_id", ignoreDuplicates: true });
    if (error) ok = false;
  } catch {
    ok = false;
  }
  try {
    const { error } = await db.from(OAUTH_TABLES.tokens).update({ revoked_at: at }).eq("family_id", familyId).is("revoked_at", null);
    if (error) ok = false;
  } catch {
    ok = false;
  }
  if (!ok) console.warn(`[oauth] token family ${familyId} could not be fully revoked; its tokens still expire on their own`);
  return ok;
}

/** Whether a family was revoked (its mark). "unavailable" when it can't be read. */
async function familyRevoked(db: SupabaseClient, familyId: string): Promise<boolean | "unavailable"> {
  try {
    const { data, error } = await db.from(OAUTH_TABLES.revokedFamilies).select("family_id").eq("family_id", familyId).maybeSingle();
    if (error) return "unavailable";
    return data !== null && data !== undefined;
  } catch {
    return "unavailable";
  }
}

/**
 * A new access + refresh pair in a family. `reused` is the answer when the
 * family turns out to have been revoked while the pair was written (the
 * loser of a race marked it): the new pair is revoked with it, never
 * handed out.
 */
async function issuePair(
  db: SupabaseClient,
  input: { grantId: string; familyId: string; userId: string; clientId: string; scopes: McpScope[]; resource: string },
  now: Date,
  deps: { newAccessToken?: () => string; newRefreshToken?: () => string } | undefined,
  reused: string,
): Promise<TokenAnswer> {
  const access = deps?.newAccessToken ? deps.newAccessToken() : newAccessToken();
  const refresh = deps?.newRefreshToken ? deps.newRefreshToken() : newRefreshToken();
  const base = {
    grant_id: input.grantId,
    family_id: input.familyId,
    user_id: input.userId,
    client_id: input.clientId,
    scopes: input.scopes,
    resource: input.resource,
    created_at: now.toISOString(),
  };
  let written = false;
  try {
    const { error } = await db.from(OAUTH_TABLES.tokens).insert([
      { ...base, token_hash: hashSecret(access), kind: "access", expires_at: plus(now, ACCESS_TOKEN_TTL_S) },
      { ...base, token_hash: hashSecret(refresh), kind: "refresh", expires_at: plus(now, REFRESH_TOKEN_TTL_S) },
    ]);
    written = !error;
  } catch {
    written = false;
  }
  // Marked while we wrote (or refused by the database's guard for it): the
  // pair goes with the family. A mark we can't read now leaves the pair to
  // the check every use of it makes.
  const revoked = await familyRevoked(db, input.familyId);
  if (revoked === true) {
    if (written) await revokeFamily(db, input.familyId, { now: () => now });
    return tokenError(400, "invalid_grant", reused);
  }
  if (!written) return UNAVAILABLE();
  return {
    ok: true,
    body: {
      access_token: access,
      token_type: "Bearer",
      expires_in: ACCESS_TOKEN_TTL_S,
      refresh_token: refresh,
      scope: scopeString(input.scopes),
    },
  };
}

type TokenDeps = StoreDeps & {
  newAccessToken?: () => string;
  newRefreshToken?: () => string;
  /** The client, as the token endpoint must re-check it (disabled clients get invalid_client). */
  readClient?: (clientId: string) => Promise<OAuthClient | null | "unavailable">;
};

async function clientStillGood(db: SupabaseClient, clientId: string, deps?: TokenDeps): Promise<"ok" | "disabled" | "unavailable"> {
  const client = deps?.readClient ? await deps.readClient(clientId) : await readClient(db, clientId);
  if (client === "unavailable") return "unavailable";
  // A CIMD client whose row is gone was never registered here as such; its
  // codes could not exist. A missing row is treated as disabled.
  if (!client || client.disabled) return "disabled";
  return "ok";
}

/**
 * grant_type=authorization_code: PKCE S256, the same client and redirect,
 * the same resource if one is named. The code is spent by one conditional
 * UPDATE; a code seen a second time revokes what it minted.
 */
export async function exchangeCode(
  db: SupabaseClient,
  input: { code: unknown; clientId: unknown; redirectUri: unknown; codeVerifier: unknown; resource: string | null | "invalid" },
  deps?: TokenDeps,
): Promise<TokenAnswer> {
  if (typeof input.code !== "string" || !input.code) return tokenError(400, "invalid_request", "code is required.");
  if (typeof input.clientId !== "string" || !input.clientId) return tokenError(401, "invalid_client", "client_id is required.");
  if (typeof input.redirectUri !== "string" || !input.redirectUri) return tokenError(400, "invalid_request", "redirect_uri is required.");
  if (input.codeVerifier === undefined || input.codeVerifier === null || input.codeVerifier === "") {
    return tokenError(400, "invalid_request", "code_verifier is required.");
  }
  if (input.resource === "invalid") return tokenError(400, "invalid_target", "resource must name this server's MCP endpoint.");
  const now = nowOf(deps);
  const codeHash = hashSecret(input.code);

  let row: Record<string, unknown> | null;
  try {
    const { data, error } = await db
      .from(OAUTH_TABLES.codes)
      .select("code_hash, grant_id, user_id, client_id, redirect_uri, code_challenge, resource, scopes, family_id, expires_at, used_at")
      .eq("code_hash", codeHash)
      .maybeSingle();
    if (error) return UNAVAILABLE();
    row = (data as Record<string, unknown> | null) ?? null;
  } catch {
    return UNAVAILABLE();
  }
  if (!row) return tokenError(400, "invalid_grant", "That code isn't valid.");
  if (row.used_at) {
    // REUSE: whatever this code minted is revoked (RFC 6749 §4.1.2).
    if (typeof row.family_id === "string") await revokeFamily(db, row.family_id, deps);
    return tokenError(400, "invalid_grant", "That code was already used.");
  }
  if (Date.parse(String(row.expires_at)) <= now.getTime()) return tokenError(400, "invalid_grant", "That code has expired.");
  if (row.client_id !== input.clientId) return tokenError(400, "invalid_grant", "That code was issued to another app.");
  if (row.redirect_uri !== input.redirectUri) return tokenError(400, "invalid_grant", "redirect_uri does not match the authorization request.");
  if (!verifyPkce(input.codeVerifier, String(row.code_challenge))) return tokenError(400, "invalid_grant", "code_verifier does not match.");
  if (input.resource !== null && input.resource !== row.resource) {
    return tokenError(400, "invalid_target", "resource does not match the authorization request.");
  }

  const grantId = String(row.grant_id);
  const grant = await readGrant(db, grantId);
  if (grant === "unavailable") return UNAVAILABLE();
  if (!grant || grant.revoked) return tokenError(400, "invalid_grant", "This connection was removed.");
  const client = await clientStillGood(db, grant.clientId, deps);
  if (client === "unavailable") return UNAVAILABLE();
  if (client === "disabled") return tokenError(401, "invalid_client", "This app can no longer connect.");

  // Spend the code: exactly one caller gets a row back.
  const familyId = newIdOf(deps);
  let won = false;
  try {
    const { data, error } = await db
      .from(OAUTH_TABLES.codes)
      .update({ used_at: now.toISOString(), family_id: familyId })
      .eq("code_hash", codeHash)
      .is("used_at", null)
      .select("code_hash");
    if (error) return UNAVAILABLE();
    won = rows(data).length > 0;
  } catch {
    return UNAVAILABLE();
  }
  if (!won) {
    // Another exchange of this same code won the race a moment ago: that is
    // a second use, and its tokens go (the alarm above, from the other side).
    try {
      const { data } = await db.from(OAUTH_TABLES.codes).select("family_id").eq("code_hash", codeHash).maybeSingle();
      const other = str((data as { family_id?: unknown } | null)?.family_id);
      if (other) await revokeFamily(db, other, deps);
    } catch {
      /* the other family still expires */
    }
    return tokenError(400, "invalid_grant", "That code was already used.");
  }

  const scopes = normaliseScopes(row.scopes).filter((s) => grant.scopes.includes(s));
  return issuePair(
    db,
    { grantId, familyId, userId: grant.userId, clientId: grant.clientId, scopes, resource: grant.resource },
    now,
    deps,
    "That code was already used.",
  );
}

/**
 * grant_type=refresh_token: rotation on every use. The old refresh token is
 * spent by one conditional UPDATE; presenting a spent one (reuse) revokes
 * the whole family. Scopes can only narrow.
 */
export async function refreshTokens(
  db: SupabaseClient,
  input: { refreshToken: unknown; clientId: unknown; scope: unknown; resource: string | null | "invalid" },
  deps?: TokenDeps,
): Promise<TokenAnswer> {
  if (typeof input.refreshToken !== "string" || !input.refreshToken) return tokenError(400, "invalid_request", "refresh_token is required.");
  if (typeof input.clientId !== "string" || !input.clientId) return tokenError(401, "invalid_client", "client_id is required.");
  if (input.resource === "invalid") return tokenError(400, "invalid_target", "resource must name this server's MCP endpoint.");
  const now = nowOf(deps);
  const hash = hashSecret(input.refreshToken);

  let row: Record<string, unknown> | null;
  try {
    const { data, error } = await db
      .from(OAUTH_TABLES.tokens)
      .select("token_hash, kind, grant_id, family_id, user_id, client_id, scopes, resource, expires_at, used_at, revoked_at")
      .eq("token_hash", hash)
      .maybeSingle();
    if (error) return UNAVAILABLE();
    row = (data as Record<string, unknown> | null) ?? null;
  } catch {
    return UNAVAILABLE();
  }
  if (!row || row.kind !== "refresh") return tokenError(400, "invalid_grant", "That refresh token isn't valid.");
  if (row.client_id !== input.clientId) return tokenError(400, "invalid_grant", "That refresh token was issued to another app.");
  const familyId = String(row.family_id);
  if (row.revoked_at) return tokenError(400, "invalid_grant", "That refresh token was revoked.");
  if (row.used_at) {
    // REUSE: the family goes, the one presenting it and the one that rotated it.
    await revokeFamily(db, familyId, deps);
    return tokenError(400, "invalid_grant", "That refresh token was already used.");
  }
  if (Date.parse(String(row.expires_at)) <= now.getTime()) return tokenError(400, "invalid_grant", "That refresh token has expired.");
  if (input.resource !== null && input.resource !== row.resource) {
    return tokenError(400, "invalid_target", "resource does not match this connection.");
  }

  const grantId = String(row.grant_id);
  const grant = await readGrant(db, grantId);
  if (grant === "unavailable") return UNAVAILABLE();
  if (!grant || grant.revoked) return tokenError(400, "invalid_grant", "This connection was removed.");
  const client = await clientStillGood(db, grant.clientId, deps);
  if (client === "unavailable") return UNAVAILABLE();
  if (client === "disabled") return tokenError(401, "invalid_client", "This app can no longer connect.");
  // A family revoked for reuse takes this token with it, even one written after the revoke (SEC-2).
  const marked = await familyRevoked(db, familyId);
  if (marked === "unavailable") return UNAVAILABLE();
  if (marked) {
    await revokeFamily(db, familyId, deps);
    return tokenError(400, "invalid_grant", "That refresh token was revoked.");
  }

  const held = normaliseScopes(row.scopes).filter((s) => grant.scopes.includes(s));
  const asked = parseScopeParam(input.scope);
  if (asked.unknown || asked.scopes.some((s) => !held.includes(s))) {
    return tokenError(400, "invalid_scope", "A refresh can only keep or narrow the scopes already granted.");
  }
  const scopes = asked.scopes.length > 0 ? asked.scopes : held;
  if (scopes.length === 0) return tokenError(400, "invalid_grant", "This connection has no scopes left.");

  // Rotate: exactly one caller spends this refresh token.
  const nextRefresh = deps?.newRefreshToken ? deps.newRefreshToken() : newRefreshToken();
  let won = false;
  try {
    const { data, error } = await db
      .from(OAUTH_TABLES.tokens)
      .update({ used_at: now.toISOString(), replaced_by: hashSecret(nextRefresh) })
      .eq("token_hash", hash)
      .is("used_at", null)
      .is("revoked_at", null)
      .select("token_hash");
    if (error) return UNAVAILABLE();
    won = rows(data).length > 0;
  } catch {
    return UNAVAILABLE();
  }
  if (!won) {
    await revokeFamily(db, familyId, deps);
    return tokenError(400, "invalid_grant", "That refresh token was already used.");
  }
  return issuePair(
    db,
    { grantId, familyId, userId: grant.userId, clientId: grant.clientId, scopes, resource: grant.resource },
    now,
    { newAccessToken: deps?.newAccessToken, newRefreshToken: () => nextRefresh },
    "That refresh token was already used.",
  );
}

/**
 * RFC 7009: revokes the token and its whole family. Always "done" to the
 * caller (an unknown token is not an error), but a token is only revoked
 * for the client it was issued to.
 */
export async function revokeToken(db: SupabaseClient, input: { token: unknown; clientId: unknown }, deps?: StoreDeps): Promise<void> {
  if (typeof input.token !== "string" || !input.token) return;
  try {
    const { data } = await db
      .from(OAUTH_TABLES.tokens)
      .select("family_id, client_id")
      .eq("token_hash", hashSecret(input.token))
      .maybeSingle();
    const r = data as { family_id?: unknown; client_id?: unknown } | null;
    if (!r || typeof r.family_id !== "string") return;
    if (typeof input.clientId === "string" && input.clientId && r.client_id !== input.clientId) return;
    await revokeFamily(db, r.family_id, deps);
  } catch {
    /* RFC 7009: the answer is the same either way */
  }
}

// ---------------------------------------------------------------------------
// The resource server's check (/api/mcp)
// ---------------------------------------------------------------------------

export type VerifiedToken = { userId: string; grantId: string; clientId: string; scopes: McpScope[] };
export type TokenCheck =
  | { ok: true; token: VerifiedToken }
  | { ok: false; reason: "invalid" | "expired" | "revoked" | "wrong_resource" | "unavailable" };

/**
 * An access token as /api/mcp receives it: known, an access token, not
 * expired or revoked, its grant live, its app not disabled, and minted FOR
 * THIS RESOURCE (RFC 8707: a picacho.io token used at picacho.ai is refused).
 * The scopes are the token's, narrowed by the grant's.
 */
export async function verifyAccessToken(
  db: SupabaseClient,
  token: string,
  input: { resource: string },
  deps?: StoreDeps,
): Promise<TokenCheck> {
  const now = nowOf(deps);
  let row: Record<string, unknown> | null;
  try {
    const { data, error } = await db
      .from(OAUTH_TABLES.tokens)
      .select("kind, grant_id, family_id, user_id, client_id, scopes, resource, expires_at, revoked_at")
      .eq("token_hash", hashSecret(token))
      .maybeSingle();
    if (error) return { ok: false, reason: "unavailable" };
    row = (data as Record<string, unknown> | null) ?? null;
  } catch {
    return { ok: false, reason: "unavailable" };
  }
  if (!row || row.kind !== "access") return { ok: false, reason: "invalid" };
  if (row.revoked_at) return { ok: false, reason: "revoked" };
  if (Date.parse(String(row.expires_at)) <= now.getTime()) return { ok: false, reason: "expired" };
  if (row.resource !== input.resource) return { ok: false, reason: "wrong_resource" };
  // A token written into a family after it was revoked is revoked too (SEC-2).
  const familyId = str(row.family_id);
  if (familyId) {
    const marked = await familyRevoked(db, familyId);
    if (marked === "unavailable") return { ok: false, reason: "unavailable" };
    if (marked) {
      await revokeFamily(db, familyId, deps);
      return { ok: false, reason: "revoked" };
    }
  }
  const grant = await readGrant(db, String(row.grant_id));
  if (grant === "unavailable") return { ok: false, reason: "unavailable" };
  if (!grant || grant.revoked || grant.userId !== row.user_id) return { ok: false, reason: "revoked" };
  const client = await readClient(db, grant.clientId);
  if (client === "unavailable") return { ok: false, reason: "unavailable" };
  if (!client || client.disabled) return { ok: false, reason: "revoked" };
  return {
    ok: true,
    token: {
      userId: grant.userId,
      grantId: grant.id,
      clientId: grant.clientId,
      scopes: normaliseScopes(row.scopes).filter((s) => grant.scopes.includes(s)),
    },
  };
}

/** Stamps a grant's last use (best effort; Connected apps shows it). */
export async function touchGrant(db: SupabaseClient, grantId: string, deps?: StoreDeps): Promise<void> {
  try {
    await db.from(OAUTH_TABLES.grants).update({ last_used_at: nowOf(deps).toISOString() }).eq("id", grantId);
  } catch {
    /* a stale "last used" never fails a request */
  }
}

// ---------------------------------------------------------------------------
// Connected apps (Settings › Security)
// ---------------------------------------------------------------------------

export type GrantView = {
  id: string;
  appName: string;
  /** The host it returns to: claude.ai, chatgpt.com, "this computer", or a site's host. */
  host: string;
  /** True only for the hosts' own callbacks. */
  verified: boolean;
  /** True for a desktop tool on the person's own computer. */
  onThisComputer: boolean;
  scopes: McpScope[];
  connectedAt: string;
  lastUsedAt: string | null;
};

/** The person's live connections, newest first. Their own rows only. */
export async function listGrants(db: SupabaseClient, userId: string): Promise<GrantView[] | "unavailable"> {
  try {
    const { data, error } = await db
      .from(OAUTH_TABLES.grants)
      .select("id, client_id, scopes, created_at, last_used_at")
      .eq("user_id", userId)
      .is("revoked_at", null)
      .order("created_at", { ascending: false })
      .limit(50);
    if (error) return "unavailable";
    const grants = rows(data);
    const ids = [...new Set(grants.map((g) => str(g.client_id)).filter((x): x is string => x !== null))];
    const clients = new Map<string, OAuthClient>();
    if (ids.length > 0) {
      const { data: cs } = await db.from(OAUTH_TABLES.clients).select(CLIENT_COLUMNS).in("client_id", ids);
      for (const c of rows(cs)) {
        const client = clientFrom(c);
        if (client) clients.set(client.clientId, client);
      }
    }
    return grants.flatMap((g) => {
      const id = str(g.id);
      const client = clients.get(String(g.client_id));
      if (!id || !client) return [];
      const first = client.redirectUris[0];
      const verifiedHost = client.trust === "verified" ? verifiedHostOf(first) : null;
      let host = verifiedHost ?? "";
      if (!host) {
        try {
          host = new URL(first).hostname;
        } catch {
          host = "";
        }
      }
      return [
        {
          id,
          appName: client.name,
          host,
          verified: verifiedHost !== null,
          onThisComputer: client.trust === "loopback",
          scopes: normaliseScopes(g.scopes),
          connectedAt: str(g.created_at) ?? "",
          lastUsedAt: str(g.last_used_at),
        },
      ];
    });
  } catch {
    return "unavailable";
  }
}

/**
 * Disconnects one app: the grant is revoked and every token under it with
 * it, counted like revokeOwnApiKey (an update that matched nothing is not
 * "done"). Another account's grant is "not_found", whoever's it is.
 */
export async function revokeGrant(
  db: SupabaseClient,
  userId: string,
  grantId: string,
  deps?: StoreDeps,
): Promise<"revoked" | "already_revoked" | "not_found" | "failed"> {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(grantId)) return "not_found";
  const now = nowOf(deps).toISOString();
  try {
    const { data, error } = await db
      .from(OAUTH_TABLES.grants)
      .update({ revoked_at: now, updated_at: now })
      .eq("id", grantId)
      .eq("user_id", userId)
      .is("revoked_at", null)
      .select("id");
    if (error) return "failed";
    if (rows(data).length === 0) {
      const { data: row, error: readError } = await db
        .from(OAUTH_TABLES.grants)
        .select("revoked_at")
        .eq("id", grantId)
        .eq("user_id", userId)
        .maybeSingle();
      if (readError) return "failed";
      if (!row) return "not_found";
      return (row as { revoked_at?: unknown }).revoked_at ? "already_revoked" : "failed";
    }
    // Every token under the grant, now (verifyAccessToken also checks the
    // grant, so a failure here cannot leave one working).
    await db.from(OAUTH_TABLES.tokens).update({ revoked_at: now }).eq("grant_id", grantId).is("revoked_at", null);
    return "revoked";
  } catch {
    return "failed";
  }
}
