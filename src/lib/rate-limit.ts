import { createHash } from "node:crypto";
import { createAdminClient } from "@/lib/supabase/server";

// A stable, salted UUID for a pre-auth caller — their network address, or
// for the per-email buckets the address they are trying to sign in AS — so
// endpoints with no user id (login, signup, the username probe) can use the
// same limiter, whose key column is uuid-typed. Hashed and salted, never
// raw: api_rate_hits must not become a table of visitor IPs or attempted
// emails. Same construction the public identity-check tool has used since
// 2026-08-30. An unknown value still limits (one shared bucket) rather than
// passing unlimited traffic.
export function hashedRateKey(value: string | null | undefined, scope: string): string {
  const salt = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "picacho";
  const h = createHash("sha256")
    .update(`${scope}:${salt}:${value || "unknown"}`)
    .digest("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}`;
}

// Shared per-user, per-feature rate limiter over public.api_rate_check —
// the atomic advisory-lock check-and-insert in schema.sql, extended with a
// scope column in supabase/applied/2026-08-19/auth-admin.sql (section 4).
//
// Why scopes exist: api_rate_hits originally had no scope, so the six
// features that reused the limiter — public API (30/min), voice preview
// (20/min), voice transcribe (10/min) + synthesize (20/min), feedback
// (10/min), uploads (30/min), password verify (5/min) — all counted into
// ONE shared bucket per user and throttled each other: five
// transcribe+synthesize exchanges (10 hits) exhaust transcribe's 10/min on
// their own, ten uploads block feedback outright. Passing a distinct scope
// per feature gives each budget its own bucket.
//
// Policy — FAILS CLOSED: any limiter error returns true (limited); better
// to make the user retry than to leave a paid/floodable endpoint unbounded
// when the limiter itself is unavailable (same reasoning every call site
// documented individually before this helper existed). The ONE exception is
// the 4-arg function not existing yet (Postgres 42883 / PostgREST PGRST202
// — the pending SQL above hasn't been applied): then this falls back to the
// legacy 3-arg call, so the app keeps limiting exactly as it did before the
// migration (one shared 'legacy' bucket per user) instead of rejecting
// everything. The fallback logs a warning naming the pending file; once the
// SQL is applied the fallback path never runs again.
//
// api_rate_check's EXECUTE is revoked from `authenticated` (both
// signatures), so both calls go through the service-role client.
export async function rateLimited(
  userId: string,
  scope: string,
  windowSeconds: number,
  max: number,
): Promise<boolean> {
  const admin = createAdminClient();

  const { data: allowed, error } = await admin.rpc("api_rate_check", {
    p_user_id: userId,
    p_window_seconds: windowSeconds,
    p_max: max,
    p_scope: scope,
  });
  if (!error) return allowed !== true;

  if (isMissingFunctionError(error)) {
    console.warn(
      `rate-limit: 4-arg api_rate_check is missing — apply ` +
        `supabase/applied/2026-08-19/auth-admin.sql (section 4). Falling back ` +
        `to the legacy shared bucket for scope "${scope}" until then.`,
    );
    const { data: legacyAllowed, error: legacyError } = await admin.rpc("api_rate_check", {
      p_user_id: userId,
      p_window_seconds: windowSeconds,
      p_max: max,
    });
    // The legacy call fails closed too — if even the 3-arg function errors,
    // the limiter is genuinely unavailable and the caller should retry.
    return Boolean(legacyError) || legacyAllowed !== true;
  }

  // Any other error: fail closed.
  return true;
}

// "Function does not exist" arrives two ways depending on where the call
// dies: 42883 is Postgres's own undefined_function SQLSTATE, PGRST202 is
// PostgREST failing to find the signature in its schema cache (the common
// case through supabase-js). Both codes are checked, plus the message text
// defensively — proxies and older PostgREST versions haven't always
// surfaced the code field intact.
function isMissingFunctionError(error: { code?: string; message?: string }): boolean {
  const code = error.code ?? "";
  const message = error.message ?? "";
  return (
    code === "42883" ||
    code === "PGRST202" ||
    /function .* does not exist/i.test(message) ||
    /could not find the function/i.test(message)
  );
}

const DAY_SECONDS = 24 * 60 * 60;

// A free extra's daily total (2026-09-30, operator: "fix the remaining small
// ones"). The burst brakes (per minute, per ten minutes) bound a script's
// pace but not its day: 40 reads every ten minutes is 5,760 a day. Each free
// extra that calls a paid model now also has a total per rolling 24 hours,
// in its own bucket (`<scope>-day`), sized well above what a person uses.
// Same limiter, same fail-closed policy as rateLimited above.
export function dailyCapReached(userId: string, scope: string, perDay: number): Promise<boolean> {
  return rateLimited(userId, `${scope}-day`, DAY_SECONDS, perDay);
}

// How many hits a bucket holds in its window, WITHOUT adding one: for a
// ceiling that is counted after the fact (dictation's long clips, whose
// length is known only once Whisper has read them). Fails closed like the
// limiter: an unreadable count reads as full.
export async function rateHitCount(userId: string, scope: string, windowSeconds: number): Promise<number> {
  const { count, error } = await createAdminClient()
    .from("api_rate_hits")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .eq("scope", scope)
    .gte("created_at", new Date(Date.now() - windowSeconds * 1000).toISOString());
  if (error) return Number.POSITIVE_INFINITY;
  return count ?? 0;
}
