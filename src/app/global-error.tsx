"use client";

import { useEffect } from "react";

// The last-resort boundary. error.tsx only catches errors thrown *inside*
// the root layout's children — if the root layout itself fails (a bad
// provider, a broken font load, a throwing server component in the shell),
// React never mounts it and error.tsx is never reached. Next falls back to
// its own unstyled default page in that case, which reads as a broken site
// rather than a handled problem.
//
// Deliberately self-contained: this renders its own <html> and <body>
// because it REPLACES the root layout, and it uses no providers, no i18n,
// and no shared components. Anything imported here is something that could
// itself be the reason the layout failed — including the locale provider,
// which is exactly why the copy below is plain English rather than
// translated.
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("Root layout error:", error);
  }, [error]);

  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          textAlign: "center",
          padding: "2rem",
          background: "#fafafa",
          fontFamily:
            "system-ui, -apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
          color: "#171717",
        }}
      >
        <h1 style={{ fontSize: "1.25rem", fontWeight: 600, margin: 0 }}>
          Something went wrong
        </h1>
        <p
          style={{
            marginTop: "0.5rem",
            maxWidth: "24rem",
            fontSize: "0.875rem",
            color: "#737373",
          }}
        >
          Picacho hit an unexpected problem loading this page. Trying again usually
          clears it.
        </p>
        <div style={{ marginTop: "1.5rem", display: "flex", gap: "0.75rem" }}>
          <button
            type="button"
            onClick={() => reset()}
            style={{
              borderRadius: "999px",
              border: "1px solid #e5e5e5",
              background: "#fff",
              padding: "0.5rem 1rem",
              fontSize: "0.875rem",
              cursor: "pointer",
            }}
          >
            Try again
          </button>
          {/* Intentionally a plain anchor, not next/link. The root layout is
              what failed, so a client-side transition would re-enter the
              same broken shell — a full document load is the point. */}
          {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
          <a
            href="/"
            style={{
              borderRadius: "999px",
              background: "#171717",
              color: "#fff",
              padding: "0.5rem 1rem",
              fontSize: "0.875rem",
              textDecoration: "none",
            }}
          >
            Go home
          </a>
        </div>
      </body>
    </html>
  );
}
