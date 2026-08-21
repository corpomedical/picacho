import type { MetadataRoute } from "next";

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
  // Guides — the SEO content section (English-only bodies for now).
  "/guides",
  "/guides/ai-character-consistency",
];

export default function sitemap(): MetadataRoute.Sitemap {
  return PUBLIC_ROUTES.map((route) => ({
    url: `${BASE_URL}${route}`,
    lastModified: new Date(),
  }));
}
