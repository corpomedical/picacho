import { headers } from "next/headers";

// The one domain we ever want a Stripe redirect (or anything else built from
// getOrigin) to land on when the real host can't be trusted — see the guard
// below. Both picacho.io and picacho.ai are live/canonical, but picacho.io
// is the one NEXT_PUBLIC_SITE_URL is documented to be set to.
const CANONICAL_ORIGIN = "https://picacho.io";

// Best-effort current origin for building absolute redirect URLs (e.g. for
// Stripe Checkout success/cancel URLs). Prefers NEXT_PUBLIC_SITE_URL when
// it's set (production), otherwise reads the incoming request's Host header
// so this also works correctly during local dev, before that env var exists.
export async function getOrigin() {
  // Real incident, 2026-08-09: this returned NEXT_PUBLIC_SITE_URL as-is,
  // trusting it was actually set to https://picacho.io. It turned out to be
  // set to the raw *.vercel.app deployment URL instead — so every Stripe
  // Checkout success_url sent the customer to a domain that doesn't share
  // the picacho.io/.ai auth cookie, making them look signed out right after
  // paying. Checking the env var's own value (not just the Host-header
  // fallback below) closes that gap regardless of what it's misconfigured to.
  if (process.env.NEXT_PUBLIC_SITE_URL && !process.env.NEXT_PUBLIC_SITE_URL.includes(".vercel.app")) {
    return process.env.NEXT_PUBLIC_SITE_URL;
  }
  const host = (await headers()).get("host");
  if (!host) return CANONICAL_ORIGIN;
  const isLocal = host.startsWith("localhost") || host.startsWith("127.0.0.1");
  if (isLocal) return `http://${host}`;
  // Same reasoning as above, for the Host-header fallback path (used when
  // NEXT_PUBLIC_SITE_URL isn't set at all, e.g. local dev before it exists).
  if (host.endsWith(".vercel.app")) return CANONICAL_ORIGIN;
  return `https://${host}`;
}
