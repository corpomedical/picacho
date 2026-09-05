// THE domain facts, declared once (2026-09-05 audit: "which domain is
// Picacho on" had eight-plus copies with mutually contradicting comments —
// origin.ts claimed NEXT_PUBLIC_SITE_URL is documented as picacho.io while
// its own incident note four lines down records the var is set to
// picacho.ai; robots.ts and sitemap.ts fell back to picacho.app, a domain
// we never shipped on).
//
// Ground truth, verified against production 2026-09-05: NEXT_PUBLIC_SITE_URL
// is https://picacho.ai (the live robots.txt advertises the picacho.ai
// sitemap), the Android shell pins picacho.ai, and picacho.io is the
// sibling domain that serves the site too and is where the native app's
// external purchase handoff deliberately lands (outside the shell's
// allowNavigation, so it opens the system browser).
//
// Import from here; never re-declare a domain literal. The contract test in
// domains.test.ts fails the commit that reintroduces a copy.

// Fallback origin for redirects when the real host can't be trusted (an
// unknown Host header, a *.vercel.app deployment URL) AND the env var is
// unusable. Matches what production's env var actually holds.
export const CANONICAL_ORIGIN = "https://picacho.ai";

// Every hostname the app is actually served on. A redirect built for a
// visitor already on one of these must stay on that exact host — the
// session cookie doesn't cross domains (see getOrigin()'s incident note).
export const KNOWN_APP_HOSTS = [
  "picacho.io",
  "www.picacho.io",
  "picacho.ai",
  "www.picacho.ai",
];

// Where the native app's US-only external checkout handoff lands —
// DELIBERATELY the sibling domain, kept outside the shell's allowNavigation
// so the link opens the system browser (see lib/native/external-purchase.ts).
export const PURCHASE_ORIGIN = "https://picacho.io";
