import path from "node:path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Pins Turbopack's project root to this folder explicitly. Without this,
  // Turbopack tries to infer the root by walking up looking for a lockfile
  // and found a stray package-lock.json in the home directory (outside this
  // git repo), which triggered a startup warning every time — harmless, but
  // noisy, and in theory could make it watch/resolve files from the wrong
  // directory. This just tells it definitively: this folder is the root.
  turbopack: {
    root: path.join(__dirname),
  },

  // Next.js caps the body of any Server Action request at 1MB by default —
  // a limit meant to prevent DDoS/resource abuse, but it applies to file
  // uploads sent through a "use server" function too (e.g. chat attachment
  // uploads in src/lib/attachments/actions.ts). That function has its own
  // 25MB size check, but the request never reached it: Next's framework-level
  // 1MB cap rejected the upload first, with a generic "Body exceeded 1 MB
  // limit" error and no chance for our friendlier message to run. Raised to
  // 30mb — comfortably above the app's 25MB check, with headroom for the
  // multipart/form-data boundary and field overhead Next adds on top of the
  // raw file bytes.
  experimental: {
    serverActions: {
      bodySizeLimit: "30mb",
    },
  },

  // Canonical host: www.picacho.ai permanently redirects to picacho.ai.
  // Both hosts were serving the full site (both appear in production error
  // stack traces), which splits SEO authority between two URLs for every
  // page and can cause cookie/session weirdness across the two origins.
  // One 308 here makes the apex the single canonical origin.
  async redirects() {
    return [
      {
        source: "/:path*",
        has: [{ type: "host", value: "www.picacho.ai" }],
        destination: "https://picacho.ai/:path*",
        permanent: true,
      },
    ];
  },

  // Baseline security headers — none were set before. These are standard,
  // low-risk practice for any app handling logins and user data; they don't
  // change behavior, just tell browsers to be stricter about what this site
  // is allowed to do.
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          // Stops the site from being embedded in an <iframe> on another
          // domain (clickjacking protection).
          { key: "X-Frame-Options", value: "DENY" },
          // Stops browsers from guessing content types in a way that can be
          // abused to run scripts from a file that isn't actually script.
          { key: "X-Content-Type-Options", value: "nosniff" },
          // Only sends the origin (not the full URL, which can contain
          // sensitive paths) as a referrer when navigating to another site.
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          // Disables a handful of browser features this app never uses.
          { key: "Permissions-Policy", value: "camera=(), geolocation=(), payment=()" },
          // Forces HTTPS for two years, including subdomains, and opts into
          // browser preload lists.
          { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
          // Content-Security-Policy is NOT set here any more. It moved to
          // middleware.ts, because a meaningful script-src needs a
          // per-request nonce and a static config header can't carry one
          // (the old policy here allowed 'unsafe-inline' scripts with
          // connect-src https: — practically no XSS containment). Keeping a
          // second copy here would also be wrong: two CSP headers combine as
          // an intersection, so a stale one silently re-breaks the page.
        ],
      },
    ];
  },
};

export default nextConfig;
