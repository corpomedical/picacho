"use client";

// Client-safe counterpart to getOrigin() (src/lib/origin.ts) — that one is
// server-only (reads next/headers). This is for client components that
// build a redirect URL for Supabase (OAuth sign-in, password reset) instead
// of trusting window.location.origin outright — mirrors the exact same
// guard getOrigin() already has: never let a *.vercel.app deployment URL
// leak into a redirect Supabase will send someone back to (see origin.ts's
// comment for the real incident that guard fixed — a Checkout redirect
// landing on the raw Vercel domain looked like a forced sign-out because
// the session cookie doesn't cross domains). Same risk applies here: if
// anyone reaches /login via an old *.vercel.app link, OAuth's redirectTo
// must not send them back to that dead-end domain either.
import { CANONICAL_ORIGIN } from "@/lib/domains";

export function clientOrigin(): string {
  if (typeof window === "undefined") return CANONICAL_ORIGIN;
  const { hostname, origin } = window.location;
  if (hostname === "localhost" || hostname === "127.0.0.1") return origin;
  if (hostname.endsWith(".vercel.app")) return CANONICAL_ORIGIN;
  return origin;
}
