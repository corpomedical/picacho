import type { MetadataRoute } from "next";

// Reads the real production domain from the environment so it can never be
// silently forgotten at deploy time — falls back to the picacho.app
// placeholder only when NEXT_PUBLIC_SITE_URL isn't set (e.g. local dev).
// Set NEXT_PUBLIC_SITE_URL in the production environment once the real
// domain is live.
const BASE_URL = process.env.NEXT_PUBLIC_SITE_URL || "https://picacho.app";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        // Logged-in app screens, admin, and internal auth routes have
        // nothing useful to index and shouldn't show up in search results.
        disallow: ["/app/", "/admin/", "/api/", "/auth/", "/reset-password"],
      },
    ],
    sitemap: `${BASE_URL}/sitemap.xml`,
  };
}
