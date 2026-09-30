// Who is signed in, from the session's signed claims, verified locally against Supabase's signing keys
// (2026-09-30, operator: "Pushed, measure it" — live, the /app layout's claims step took ~220 ms).
//
// auth-js caches the signing keys (JWKS) per server instance for 10 minutes (GoTrueClient GLOBAL_JWKS,
// JWKS_TTL), so a warm instance verifies with no network — but every cold instance, and a serverless deploy
// has many, fetched them again inside the page's first await. Here the keys come through Next's data cache
// (`next.revalidate`, shared by every instance of the deployment) and a module-scope copy, and are handed to
// getClaims(jwt, { keys }), which then verifies without fetching. A token signed with a key we don't hold yet
// (a key rotation) fetches the set again, fresh, at most every 30 s; anything else — no keys, a symmetric
// token — is left to getClaims() exactly as before (it asks the auth server then).
//
// The trust model is the proxy's (lib/supabase/middleware.ts): a validly signed, unexpired token is who it
// says it is; revocation is the proxy's profiles.status check on every /app request.

import type { SupabaseClient } from "@supabase/supabase-js";

type Jwk = { kid?: string; kty: string; alg?: string; [k: string]: unknown };
type Claims = { sub?: unknown; email?: unknown; [k: string]: unknown };

export const JWKS_TTL_MS = 10 * 60 * 1000;
const REFETCH_MIN_MS = 30 * 1000;
let held: { keys: Jwk[]; at: number } | null = null;
let lastForced = 0;

async function fetchKeys(fresh: boolean): Promise<Jwk[] | null> {
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!base) return null;
  try {
    const res = await fetch(`${base}/auth/v1/.well-known/jwks.json`, {
      headers: { apikey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "" },
      ...(fresh ? { cache: "no-store" as const } : { next: { revalidate: JWKS_TTL_MS / 1000 } }),
    });
    if (!res.ok) return null;
    const body = (await res.json()) as { keys?: unknown };
    return Array.isArray(body.keys) ? (body.keys as Jwk[]) : null;
  } catch {
    return null;
  }
}

/** The signing keys: this instance's copy while fresh, else the deployment's data cache; `kid` missing from them fetches afresh. */
export async function signingKeys(kid: string | null, now = Date.now()): Promise<Jwk[] | null> {
  if (!held || now - held.at > JWKS_TTL_MS) {
    const keys = await fetchKeys(false);
    if (keys) held = { keys, at: now };
  }
  if (kid && held && !held.keys.some((k) => k.kid === kid) && now - lastForced > REFETCH_MIN_MS) {
    lastForced = now;
    const keys = await fetchKeys(true);
    if (keys) held = { keys, at: now };
  }
  return held?.keys ?? null;
}

function kidOf(token: string): string | null {
  try {
    const header = JSON.parse(Buffer.from(token.split(".")[0] ?? "", "base64url").toString("utf8")) as { kid?: unknown };
    return typeof header.kid === "string" ? header.kid : null;
  } catch {
    return null;
  }
}

/** The signed-in person's claims, verified, or null. */
export async function verifiedClaims(supabase: SupabaseClient): Promise<Claims | null> {
  // The session's own token (from its cookies; the proxy has already refreshed it this request).
  const { data: sessionData } = await supabase.auth.getSession();
  const token = sessionData.session?.access_token;
  if (!token) return null;
  const kid = kidOf(token);
  const keys = kid ? await signingKeys(kid) : null;
  const usable = keys && kid && keys.some((k) => k.kid === kid) ? keys : null;
  const { data, error } = usable ? await supabase.auth.getClaims(token, { keys: usable as never }) : await supabase.auth.getClaims(token);
  if (error || !data?.claims) return null;
  return data.claims as Claims;
}

/** For tests: forget the held keys. */
export function forgetSigningKeys() {
  held = null;
  lastForced = 0;
}
