import { createAdminClient } from "@/lib/supabase/server";

// Shared per-user, per-feature rate limiter over public.api_rate_check —
// the atomic advisory-lock check-and-insert in schema.sql, extended with a
// scope column in supabase/pending-2026-08-19/auth-admin.sql (section 4).
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
        `supabase/pending-2026-08-19/auth-admin.sql (section 4). Falling back ` +
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
