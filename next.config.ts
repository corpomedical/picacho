import type { NextConfig } from "next";

const nextConfig: NextConfig = {
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
        ],
      },
    ];
  },
};

export default nextConfig;
