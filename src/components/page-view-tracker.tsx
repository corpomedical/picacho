"use client";

import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";
import { getCookieConsent } from "@/lib/cookie-consent";

const VISITOR_ID_KEY = "picacho_visitor_id";

function getVisitorId(): string {
  let id = window.localStorage.getItem(VISITOR_ID_KEY);
  if (!id) {
    id = crypto.randomUUID();
    window.localStorage.setItem(VISITOR_ID_KEY, id);
  }
  return id;
}

// Mounted once in the root layout so it sees every route change across the
// whole site — marketing pages, auth, and the app — not just logged-in
// usage. Fire-and-forget: never blocks or affects rendering.
export function PageViewTracker() {
  const pathname = usePathname();
  const lastPath = useRef<string | null>(null);

  useEffect(() => {
    if (!pathname || pathname === lastPath.current) return;
    lastPath.current = pathname;

    // Non-essential analytics — off by default, and permanently off if
    // declined. Only runs once the cookie banner has been accepted.
    if (getCookieConsent() !== "accepted") return;

    try {
      const visitorId = getVisitorId();
      fetch("/api/track", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: pathname, visitorId, referrer: document.referrer }),
        keepalive: true,
      }).catch(() => {});
    } catch {
      // localStorage can throw in some locked-down browser contexts —
      // tracking just silently no-ops rather than breaking navigation.
    }
  }, [pathname]);

  return null;
}
