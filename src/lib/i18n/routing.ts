// Locale-prefixed marketing URLs (2026-08-30).
//
// THE PROBLEM THIS SOLVES. The site is fully translated into en/es/pt/it —
// three ~1,280-line message files plus a four-locale legal file — but the
// locale lived only in a cookie. Same URL, four possible languages, so Google
// saw ONE version of each page and the Spanish, Portuguese and Italian
// translations were never indexable at all. Roughly thirty pages of finished
// work that no search engine could reach.
//
// Imports are RELATIVE, not "@/" — this module is unit-tested, and vitest runs
// with no config in this repo so it cannot resolve the alias. Same constraint
// that shaped refund-rules.ts and frame-url.ts.

import { LOCALES, DEFAULT_LOCALE, type Locale } from "./locales";

// English is never prefixed. /pricing IS the English URL: it is already
// indexed, it ships in the Google Play listing, and the Capacitor shell loads
// picacho.ai directly. Moving it would break all three at once.
export const PREFIXED_LOCALES: readonly string[] = LOCALES.map((l) => l.code).filter(
  (c) => c !== DEFAULT_LOCALE,
);

// The ONLY paths that get prefixes: the ones whose bodies are genuinely
// translated.
//
// /guides and /guides/* are deliberately absent. Their prose is English-only,
// so prefixing them would publish a dozen pages of English text under Spanish,
// Portuguese and Italian URLs — thin duplicates, which rank worse than not
// ranking at all. Add a guide here only once its body is actually translated.
export const LOCALIZED_PATHS = [
  "/",
  "/pricing",
  "/privacy",
  "/terms",
  "/content-policy",
  "/gallery",
  "/compare/heygen",
  "/compare/hedra",
  "/compare/renoise",
  "/compare/imagineart",
  "/compare/higgsfield",
] as const;

// How middleware tells the Server Component which language this URL is.
//
// The same mechanism the CSP nonce already uses in production (middleware
// sets it on the REQUEST headers, updateSession forwards them via
// NextResponse.next({ request }), the root layout reads it back with
// headers()) — so this is a proven path in this app, not a new one.
export const LOCALE_HEADER = "x-picacho-locale";

const LOCALIZED = new Set<string>(LOCALIZED_PATHS);

/**
 * Is this a locale-prefixed marketing URL? Returns null for EVERYTHING else,
 * which is what keeps /app/**, /api/**, every auth route and /guides on
 * byte-identical code paths to today.
 *
 * Returning null for an unlisted path is deliberate: /es/app and /es/login
 * then fall through to normal routing and 404 rather than existing as
 * shadow copies. That matters more than it looks — the account-suspension
 * check and the signed-out bounce are both startsWith("/app") tests, and a
 * locale segment in front of them would silently defeat both.
 */
export function matchLocalePrefix(
  pathname: string,
): { locale: Locale; basePath: string } | null {
  const m = /^\/([a-z]{2})(\/.*)?$/.exec(pathname);
  if (!m) return null;
  if (!PREFIXED_LOCALES.includes(m[1])) return null;
  let basePath = m[2] ?? "/";
  // /es/ and /es both mean the Spanish homepage.
  if (basePath.length > 1 && basePath.endsWith("/")) basePath = basePath.slice(0, -1);
  if (!LOCALIZED.has(basePath)) return null;
  return { locale: m[1] as Locale, basePath };
}

/**
 * The URL a given English path has in a given locale. English returns the
 * bare path unchanged; so does any path that is not localized, so a caller
 * can pass /guides safely and get /guides back.
 */
export function localizedHref(basePath: string, locale: Locale): string {
  if (locale === DEFAULT_LOCALE || !LOCALIZED.has(basePath)) return basePath;
  return basePath === "/" ? `/${locale}` : `/${locale}${basePath}`;
}
