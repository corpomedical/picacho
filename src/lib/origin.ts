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
  if (process.env.NEXT_PUBLIC_SITE_URL) return process.env.NEXT_PUBLIC_SITE_URL;
  const host = (await headers()).get("host");
  if (!host) return "http://localhost:3000";
  const isLocal = host.startsWith("localhost") || host.startsWith("127.0.0.1");
  if (isLocal) return `http://${host}`;
  // Real incident, 2026-08-09: NEXT_PUBLIC_SITE_URL wasn't taking effect on
  // the live deployment, so this fell through to the Host header — which,
  // on Vercel, can be the project's own auto-generated *.vercel.app domain
  // rather than the custom one. A Stripe Checkout success_url built from
  // that domain sends the customer to a host that doesn't share the
  // picacho.io/.ai auth cookie at all, so right after paying they land on a
  // page where they appear signed out. Never let that domain leak into a
  // redirect URL — fall back to the real one instead.
  if (host.endsWith(".vercel.app")) return CANONICAL_ORIGIN;
  return `https://${host}`;
}
