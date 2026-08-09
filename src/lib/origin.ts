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
// Every hostname we actually serve the app on. A redirect built for a
// visitor already on one of these must stay on that exact host — see the
// incident note in getOrigin().
const KNOWN_HOSTS = [
  "picacho.io",
  "www.picacho.io",
  "picacho.ai",
  "www.picacho.ai",
];

export async function getOrigin() {
  const host = (await headers()).get("host");

  if (host) {
    const isLocal = host.startsWith("localhost") || host.startsWith("127.0.0.1");
    if (isLocal) return `http://${host}`;
    // Real incident #2, 2026-08-09 (found in a full-site scan): this used to
    // return NEXT_PUBLIC_SITE_URL first whenever it was set. That env var is
    // set to https://picacho.ai — so a customer signed in on picacho.io who
    // started Checkout got sent back to picacho.ai afterwards. Different
    // domain, so the Supabase auth cookie doesn't come along, and they land
    // "signed out" right after paying. Exactly the same failure the earlier
    // *.vercel.app guard was added for, just between the two real domains
    // instead. Staying on whichever known host the request actually came in
    // on fixes it for every combination, and needs no env-var change.
    if (KNOWN_HOSTS.includes(host.toLowerCase())) return `https://${host}`;
  }

  // Unrecognized host (a raw *.vercel.app deployment URL, a preview alias, a
  // missing Host header). Never build a redirect back to one of those — the
  // session cookie doesn't exist there either. Prefer the configured site
  // URL, ignoring it if it's itself pointed at a Vercel deployment domain.
  const configured = process.env.NEXT_PUBLIC_SITE_URL;
  if (configured && !configured.includes(".vercel.app")) return configured;
  return CANONICAL_ORIGIN;
}
