// The authorization server's housekeeping (fixer 2026-09-26, SEC-1): nothing
// in its tables is kept for good. /api/oauth/register and /api/oauth/authorize
// need no sign-in, so every row they write (an app, a pending authorization)
// must leave on its own, and so must every code, token and card code once it
// can no longer be used. Run daily by /api/cron/prune.
//
//   pending authorizations, codes, tokens, card codes (mcp_ui_nonces):
//     a day after they expire. A spent or revoked token past its expiry is
//     refused as "not valid" either way, so nothing is lost by forgetting it.
//   revoked-family marks: REVOKED_FAMILY_KEEP_MS after the revoke, longer
//     than any token written into the family could live (a refresh token's
//     30 days, plus margin).
//   apps (DCR and CIMD): only through prune_oauth_clients (press-tour-07-
//     mcp-oauth.sql), which deletes in ONE statement an app that was
//     registered or last used more than UNUSED_CLIENT_KEEP_MS ago, has never
//     had a connection (no grant, live or revoked), has no authorization
//     waiting, and was not disabled by hand (a disabled app must stay: its
//     row is what keeps it out). Deleting an app with a connection would
//     take the connection with it (ON DELETE CASCADE), so that test lives in
//     the database, where it can't be cut short by a row limit.
//
// Every step runs whatever the switches say (a row owed its deletion is
// owed either way), stops at its own error and lets the others run.
// Alias-free: oauth.test.ts drives it against the in-memory database.

import type { SupabaseClient } from "@supabase/supabase-js";
import { REFRESH_TOKEN_TTL_S } from "./config";
import { OAUTH_TABLES } from "./store";

const DAY_MS = 24 * 60 * 60 * 1000;

/** How long a pending authorization, code, token or card code is kept after it expires. */
export const EXPIRED_KEEP_MS = DAY_MS;
/** How long a revoked family's mark is kept: longer than any token in it could live. */
export const REVOKED_FAMILY_KEEP_MS = REFRESH_TOKEN_TTL_S * 1000 + 2 * DAY_MS;
/** An app nobody has used for this long, and that never connected, is removed. */
export const UNUSED_CLIENT_KEEP_MS = 30 * DAY_MS;
/** Apps removed per run at most (what a run leaves, the next one takes). */
export const CLIENT_PRUNE_LIMIT = 2_000;
/** The card codes' table (lib/mcp/press/nonce.ts NONCE_TABLE; named here so this module stays a leaf). */
export const UI_NONCES_TABLE = "mcp_ui_nonces";

export type OAuthPruneReport = {
  pending: number;
  codes: number;
  tokens: number;
  nonces: number;
  families: number;
  clients: number;
  errors: string[];
};

async function deleteBefore(db: SupabaseClient, table: string, column: string, before: string): Promise<{ removed: number; error: string | null }> {
  try {
    const { error, count } = await db.from(table).delete({ count: "exact" }).lt(column, before);
    if (error) return { removed: 0, error: `${table}: ${error.message}` };
    return { removed: count ?? 0, error: null };
  } catch (err) {
    return { removed: 0, error: `${table}: ${err instanceof Error ? err.message : String(err)}` };
  }
}

/** Everything the authorization server no longer needs. Never throws; each table's error is reported and the rest still run. */
export async function pruneOAuthRecords(db: SupabaseClient, deps: { now?: () => Date } = {}): Promise<OAuthPruneReport> {
  const now = deps.now ? deps.now() : new Date();
  const expired = new Date(now.getTime() - EXPIRED_KEEP_MS).toISOString();
  const report: OAuthPruneReport = { pending: 0, codes: 0, tokens: 0, nonces: 0, families: 0, clients: 0, errors: [] };

  const steps: [keyof Omit<OAuthPruneReport, "errors" | "clients">, string, string, string][] = [
    ["pending", OAUTH_TABLES.pending, "expires_at", expired],
    ["codes", OAUTH_TABLES.codes, "expires_at", expired],
    ["tokens", OAUTH_TABLES.tokens, "expires_at", expired],
    ["nonces", UI_NONCES_TABLE, "expires_at", expired],
    ["families", OAUTH_TABLES.revokedFamilies, "revoked_at", new Date(now.getTime() - REVOKED_FAMILY_KEEP_MS).toISOString()],
  ];
  for (const [key, table, column, before] of steps) {
    const r = await deleteBefore(db, table, column, before);
    report[key] = r.removed;
    if (r.error) report.errors.push(r.error);
  }

  try {
    const { data, error } = await db.rpc("prune_oauth_clients", {
      p_before: new Date(now.getTime() - UNUSED_CLIENT_KEEP_MS).toISOString(),
      p_limit: CLIENT_PRUNE_LIMIT,
    });
    if (error) report.errors.push(`oauth_clients: ${error.message}`);
    else report.clients = typeof data === "number" && Number.isFinite(data) ? data : 0;
  } catch (err) {
    report.errors.push(`oauth_clients: ${err instanceof Error ? err.message : String(err)}`);
  }
  return report;
}
