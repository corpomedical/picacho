import type { MetadataRoute } from "next";
import { LOCALES } from "@/lib/i18n/locales";
import { LOCALIZED_PATHS, localizedHref } from "@/lib/i18n/routing";

// Reads the real production domain from the environment so it can never be
// silently forgotten at deploy time — falls back to the picacho.app
// placeholder only when NEXT_PUBLIC_SITE_URL isn't set (e.g. local dev).
// Set NEXT_PUBLIC_SITE_URL in the production environment once the real
// domain is live.
const BASE_URL = process.env.NEXT_PUBLIC_SITE_URL || "https://picacho.app";

// Marketing + legal pages only. /login, /signup and /forgot-password used to
// be listed here too, but auth screens have no business ranking in search —
// they're destinations you arrive at from inside the product, and indexing
// them just competes with the pages that should rank.
const PUBLIC_ROUTES = [
  "",
  "/pricing",
  "/privacy",
  "/terms",
  "/content-policy",
  // Public showcase gallery + the comparison landing pages — marketing
  // pages that exist precisely to rank, so they belong here.
  "/gallery",
  "/compare/heygen",
  "/compare/hedra",
  "/compare/renoise",
  "/compare/imagineart",
  "/compare/higgsfield",
  // Guides — the SEO content section (English-only bodies for now).
  "/guides",
  "/guides/ai-character-consistency",
  "/guides/ai-camera-movements",
  "/guides/seedance-2",
  // The nine-chapter photographed course — the deepest content page on the
  // site, forgotten here when it shipped (2026-08-25) because this list is
  // maintained by hand. If guides keep growing, generate this from the
  // guides directory instead.
  "/guides/getting-started",
];

export default function sitemap(): MetadataRoute.Sitemap {
  return PUBLIC_ROUTES.map((route) => {
    // Locale alternates (2026-08-30). Next's MetadataRoute.Sitemap emits
    // these as xhtml:link rel="alternate" entries on the one <url>, which is
    // the shape Google documents for a sitemap — one entry per page listing
    // every language, rather than N separate entries.
    //
    // Only the genuinely translated pages get them: localizedHref returns the
    // bare path unchanged for anything outside LOCALIZED_PATHS, so /guides
    // resolves to itself in all four locales. Emitting that would tell Google
    // four URLs are translations of each other when they are the same English
    // page, so those routes get no alternates block at all.
    // PUBLIC_ROUTES spells the homepage "" (so the URL concatenates cleanly)
    // while LOCALIZED_PATHS spells it "/" — normalize before comparing, or
    // the homepage silently gets no alternates.
    const basePath = route || "/";
    const localized = LOCALIZED_PATHS.includes(basePath as (typeof LOCALIZED_PATHS)[number]);
    const languages = localized
      ? Object.fromEntries(
          LOCALES.map(({ code }) => [code, `${BASE_URL}${localizedHref(basePath, code)}`]),
        )
      : undefined;

    return {
      url: `${BASE_URL}${route}`,
      lastModified: new Date(),
      ...(languages ? { alternates: { languages } } : {}),
    };
  });
}
