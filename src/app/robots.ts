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
        //
        // No trailing slashes. robots.txt matches on prefix, so the old
        // "/app/" did NOT cover the bare "/app" — and /app is exactly the
        // URL that hurt: manifest.ts advertises it as the PWA start_url on
        // a public file, app/layout.tsx redirect()s a signed-out visitor to
        // /login, and Googlebot is always signed out. So Google crawled the
        // one app URL we thought was blocked and filed it under "Page with
        // redirect". "/app" covers /app and everything beneath it; same
        // correction for /admin, /api and /auth. Nothing else at the top
        // level shares those prefixes (checked against src/app/), so the
        // wider match costs nothing.
        //
        // /login, /signup and /forgot-password are new here, for a second
        // reason beyond "auth screens don't rank" (the argument sitemap.ts
        // already makes for leaving them out of the sitemap): all three
        // call redirect() when a session exists, and /login and /signup are
        // linked from the marketing nav on every page.
        disallow: [
          "/app",
          "/admin",
          "/api",
          "/auth",
          "/login",
          "/signup",
          "/forgot-password",
          "/reset-password",
        ],
      },
    ],
    sitemap: `${BASE_URL}/sitemap.xml`,
  };
}
