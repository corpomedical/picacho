import type { MetadataRoute } from "next";

// Reads the real production domain from the environment so it can never be
// silently forgotten at deploy time — falls back to the picacho.app
// placeholder only when NEXT_PUBLIC_SITE_URL isn't set (e.g. local dev).
// Set NEXT_PUBLIC_SITE_URL in the production environment once the real
// domain is live.
const BASE_URL = process.env.NEXT_PUBLIC_SITE_URL || "https://picacho.app";

const PUBLIC_ROUTES = [
  "",
  "/pricing",
  "/login",
  "/signup",
  "/forgot-password",
  "/privacy",
  "/terms",
  "/content-policy",
];

export default function sitemap(): MetadataRoute.Sitemap {
  return PUBLIC_ROUTES.map((route) => ({
    url: `${BASE_URL}${route}`,
    lastModified: new Date(),
  }));
}
