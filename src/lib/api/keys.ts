import crypto from "crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { PlanId } from "@/lib/plans";

// API key handling, shared by the settings UI (which creates keys) and the
// /api/v1 routes (which verify them). A plain module, not "use server" — the
// verification path runs inside route handlers, and nothing here should ever
// be reachable as an endpoint.

// pic_live_ + 43 url-safe characters of real entropy (32 random bytes).
// Prefixed so a leaked key is recognisable on sight in a log or a paste, and
// so a future pic_test_ can exist without ambiguity.
const KEY_PREFIX = "pic_live_";

// What we show in the UI to identify a key. Long enough to distinguish keys
// at a glance, far too short to brute-force the rest from.
const DISPLAY_PREFIX_LENGTH = KEY_PREFIX.length + 4;

export function generateApiKey(): { key: string; hash: string; prefix: string } {
  const key = KEY_PREFIX + crypto.randomBytes(32).toString("base64url");
  return {
    key,
    hash: hashApiKey(key),
    prefix: key.slice(0, DISPLAY_PREFIX_LENGTH),
  };
}

// SHA-256, not bcrypt/argon2, and deliberately so: this is a 256-bit random
// secret, not a human-chosen password. There is no dictionary to attack and
// no rainbow table to build, so the slow-hash tradeoff buys nothing while
// costing latency on every single API request.
export function hashApiKey(key: string): string {
  return crypto.createHash("sha256").update(key).digest("hex");
}

export type ApiCaller = {
  userId: string;
  keyId: string;
  plan: PlanId;
};

export type ApiAuthFailure = {
  status: 401 | 403;
  code: "missing_key" | "invalid_key" | "revoked_key" | "no_api_access" | "suspended";
  message: string;
};

/**
 * Resolves an Authorization header to an account, or explains why not.
 *
 * Takes a service-role client: there is no session here, and the key itself
 * is the credential. Every query in the API layer must therefore filter by
 * the returned userId explicitly — RLS is not doing it for us.
 */
export async function authenticateApiRequest(
  supabase: SupabaseClient,
  authorizationHeader: string | null,
): Promise<{ caller: ApiCaller; error: null } | { caller: null; error: ApiAuthFailure }> {
  const raw = (authorizationHeader ?? "").trim();
  const key = raw.toLowerCase().startsWith("bearer ") ? raw.slice(7).trim() : raw;

  if (!key) {
    return {
      caller: null,
      error: {
        status: 401,
        code: "missing_key",
        message: "Missing API key. Send it as: Authorization: Bearer pic_live_...",
      },
    };
  }

  // Looked up BY HASH, so the lookup itself is the constant-work comparison —
  // there's no stored secret to compare against and therefore no timing
  // channel to leak one.
  const { data: row } = await supabase
    .from("api_keys")
    .select("id, user_id, revoked_at")
    .eq("key_hash", hashApiKey(key))
    .maybeSingle();

  if (!row) {
    return {
      caller: null,
      error: { status: 401, code: "invalid_key", message: "That API key isn't valid." },
    };
  }
  if (row.revoked_at) {
    return {
      caller: null,
      error: { status: 401, code: "revoked_key", message: "That API key has been revoked." },
    };
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("plan, role, status, api_access")
    .eq("id", row.user_id)
    .single();

  if (profile?.status === "suspended") {
    return {
      caller: null,
      error: { status: 403, code: "suspended", message: "This account is suspended." },
    };
  }

  // Elite includes it; anyone else needs the per-account grant. Admins always
  // have it, for support and testing.
  const plan = (profile?.plan ?? "none") as PlanId;
  const allowed = plan === "elite" || profile?.api_access === true || profile?.role === "admin";
  if (!allowed) {
    return {
      caller: null,
      error: {
        status: 403,
        code: "no_api_access",
        message: "API access is included with the Elite plan. Contact us to enable it on this account.",
      },
    };
  }

  // Fire-and-forget: a failed timestamp write must never fail a request that
  // is otherwise perfectly authorised.
  void supabase
    .from("api_keys")
    .update({ last_used_at: new Date().toISOString() })
    .eq("id", row.id)
    .then(() => undefined);

  return { caller: { userId: row.user_id as string, keyId: row.id as string, plan }, error: null };
}

// Requests per minute per account, counted against rows this API actually
// created. Deliberately far above the composer's 3-second human cooldown — a
// script is EXPECTED to be fast here; the point is to bound a runaway loop,
// not to imitate a person. Credits remain the real limit.
export const API_RATE_LIMIT_PER_MINUTE = 30;
