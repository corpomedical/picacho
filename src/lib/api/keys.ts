import crypto from "crypto";
import { after } from "next/server";
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
        // What happened, and nothing to buy (Press Tour cut 0, 2026-09-25).
        // This text reaches a person through Claude or ChatGPT, whose app
        // rules forbid upgrade prompts; it used to name the Elite plan.
        message: API_ACCESS_OFF,
      },
    };
  }

  // Fire-and-forget: a failed timestamp write must never fail a request that
  // is otherwise authorised, and it must not add latency to the hot path.
  // Scheduled through after() rather than a bare dangling promise — on a
  // serverless platform the function can be frozen the instant the response
  // is sent, and a floating .then() at that moment simply never runs, which
  // is why last_used_at (the "is this key still in use?" signal an admin
  // checks before revoking) was quietly stale. after() runs the callback
  // once the response is done but keeps the invocation alive for it.
  after(async () => {
    try {
      await supabase
        .from("api_keys")
        .update({ last_used_at: new Date().toISOString() })
        .eq("id", row.id);
    } catch {
      // Best-effort by design — see above.
    }
  });

  return { caller: { userId: row.user_id as string, keyId: row.id as string, plan }, error: null };
}

// Requests per minute per account, counted against rows this API actually
// created. Deliberately far above the composer's 3-second human cooldown — a
// script is EXPECTED to be fast here; the point is to bound a runaway loop,
// not to imitate a person. Credits remain the real limit.
export const API_RATE_LIMIT_PER_MINUTE = 30;

/** The no_api_access refusal: a plain statement, never a plan or a price. */
export const API_ACCESS_OFF = "API access isn't turned on for this account.";

export type RevokeOutcome = "revoked" | "already_revoked" | "not_found" | "failed";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Revokes one of a person's own keys, through the SERVICE-ROLE client.
 *
 * It used to run through the person's cookie client and lean on the api_keys
 * "Update own" RLS policy, and it read only `error` (Press Tour critique #3,
 * 2026-09-25). An UPDATE that RLS filters to zero rows is not an error, so
 * the day that policy is dropped (it also lets a person clear revoked_at on a
 * key, or rewrite its hash) every revoke would have answered "done" while the
 * key kept working. So the write goes through the service role, filtered to
 * the person's own key explicitly, and the rows it changed are COUNTED: the
 * answer is "revoked" only when a row actually changed.
 *
 * Zero rows is then told apart by one read: a key already revoked (a double
 * press, a second tab) is done, not an error; a key that is not this
 * person's is "not_found", whoever's it is. A key that exists, is live and
 * still did not change is "failed": the write did not take, and saying
 * otherwise is the bug this replaces.
 */
export async function revokeOwnApiKey(
  admin: SupabaseClient,
  userId: string,
  keyId: string,
  now: Date = new Date(),
): Promise<RevokeOutcome> {
  // Not a uuid is not a key of anyone's; asking Postgres would only turn it
  // into a cast error and a false "try again".
  if (!userId || !UUID_RE.test(keyId)) return "not_found";
  // Revoked, not deleted: a key that made forty thousand calls is part of
  // this account's history, and "which key did that?" has to stay answerable.
  const { data: changed, error } = await admin
    .from("api_keys")
    .update({ revoked_at: now.toISOString() })
    .eq("id", keyId)
    .eq("user_id", userId)
    .is("revoked_at", null)
    .select("id");
  if (error) return "failed";
  if ((changed ?? []).length > 0) return "revoked";

  const { data: row, error: readError } = await admin
    .from("api_keys")
    .select("revoked_at")
    .eq("id", keyId)
    .eq("user_id", userId)
    .maybeSingle();
  if (readError) return "failed";
  if (!row) return "not_found";
  return row.revoked_at ? "already_revoked" : "failed";
}
