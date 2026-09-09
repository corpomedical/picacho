import path from "node:path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The Android emulator reaches this machine's dev server as 10.0.2.2, and
  // Next 16 answers 403 to /_next/* from any dev origin it was not told
  // about — so the shell's WebView got its HTML and none of its scripts, and
  // nothing hydrated (2026-09-09). Dev-only: production never reads this.
  allowedDevOrigins: ["10.0.2.2"],
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

  // The highlight-reel cron shells out to ffmpeg (2026-09-07), and that needs
  // BOTH of the following. They fix different halves of the same problem and
  // either one alone still fails at runtime.
  //
  // ffmpeg-static ships a ~44MB NATIVE BINARY, not JavaScript. Next's
  // dependency tracing cannot see it, because the module that requires it only
  // ever exports a path string — so without the include the file is simply
  // absent from the deployed function. Scoped to the one route that needs it,
  // since tracing is per-route and every other lambda should stay small.
  //
  // And ffmpeg-static locates its binary with __dirname, which the bundler
  // rewrites to a placeholder when the module is bundled. Caught locally
  // 2026-09-07 by running the real builder against production data: the path
  // came back as `/ROOT/node_modules/ffmpeg-static/ffmpeg` and the spawn
  // failed ENOENT — with the binary sitting correctly in node_modules the
  // whole time. Marking the package external keeps it out of the bundle so
  // __dirname stays a real directory.
  serverExternalPackages: ["ffmpeg-static"],
  outputFileTracingIncludes: {
    "/api/cron/reels": ["./node_modules/ffmpeg-static/ffmpeg"],
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
      // Media in public/ is served with NO Cache-Control today, so it falls
      // back to Next's default and browsers re-validate constantly — the
      // homepage's own hero clips are re-checked on every visit.
      //
      // Deliberately NOT `immutable`, and deliberately not a year: files in
      // public/ are served at a STABLE path with no content hash (unlike
      // /_next/static, which Next fingerprints and may cache forever). An
      // immutable year on a stable path means a replaced hero clip or a
      // re-encoded preset would be invisible to anyone who had already
      // loaded it, with no way to bust it short of renaming the file. A week
      // of freshness plus a month of stale-while-revalidate gives ~all of
      // the benefit: repeat visitors serve from disk instantly, and a
      // changed file propagates on its own within a week.
      {
        // Widened 2026-08-31: the rule matched the subdirectories and mp4s
        // but missed every root-level image — logo.png, the og image, the
        // showcase posters, the Play badge — which were re-validated on
        // every single page view.
        source: "/:path((?:presets|templates|course|models|studio)/.*|.*\\.(?:mp4|png|jpg|jpeg|webp|svg|ico))",
        headers: [
          {
            key: "Cache-Control",
            value: "public, max-age=604800, stale-while-revalidate=2592000",
          },
        ],
      },
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
          // Disables browser features this app does not use. camera and
          // geolocation are genuinely unused — photo pickers are a plain
          // <input type="file">, which needs no camera grant.
          //
          // payment is (self), NOT (). This header applies to /:path*, which
          // includes /app/checkout, and that page mounts Stripe's
          // EmbeddedCheckout in-document (checkout-embed.tsx) rather than
          // redirecting away — so the app's only payment form lives inside a
          // page this header governs. An empty allowlist denies the Payment
          // Request API to the document AND to every nested context, and an
          // iframe's own allow="payment" cannot re-grant what the top
          // document denied, so Google Pay and Apple Pay could not initialise
          // inside the embed. (self) keeps it same-origin rather than open.
          { key: "Permissions-Policy", value: "camera=(), geolocation=(), payment=(self)" },
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
