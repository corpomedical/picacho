"use client";

import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";

// Measures how long a signed-in person is actually using the site.
//
// Mounted in the app layout, so it only ever runs for signed-in users on
// their own account. It is not analytics and carries no visitor identifier:
// it stamps activity on the caller's own profile row, which is what powers
// "last seen", "online now" and time-on-site in the admin area. Page-view
// analytics remain separate and consent-gated (see PageViewTracker).
//
// Who comes back (2026-10-03): each beat also names the page it's on, and
// the server notes which tool that is (Generate, Recast, …) for today —
// one row per person per tool per day, read only in Admin. Changing page
// beats at once, so a tool opened for a few seconds still counts.
//
// Beats only while the tab is actually visible — a forgotten background tab
// must not accrue time, or every number here becomes a lie. Each beat credits
// the gap since the previous one, capped server-side, so a closed laptop
// simply stops contributing rather than counting the hours until it reopens.
const BEAT_MS = 60_000;

export function ActivityHeartbeat() {
  const pathname = usePathname();
  const path = useRef(pathname);
  useEffect(() => {
    path.current = pathname;
  }, [pathname]);

  useEffect(() => {
    let stopped = false;

    function beat() {
      if (stopped || document.visibilityState !== "visible") return;
      // keepalive so the final beat still lands if this fires as the tab is
      // being closed. Fire-and-forget: never surfaces or blocks anything.
      fetch("/api/activity", {
        method: "POST",
        keepalive: true,
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ path: path.current ?? "" }),
      }).catch(() => {});
    }

    beat();
    const id = setInterval(beat, BEAT_MS);

    // Coming back to the tab beats immediately, which both closes out the
    // away period and starts the next visit without waiting a full minute.
    document.addEventListener("visibilitychange", beat);

    return () => {
      stopped = true;
      clearInterval(id);
      document.removeEventListener("visibilitychange", beat);
    };
  }, []);

  // A new page beats straight away (the interval keeps its own rhythm). The
  // server credits time by the gap since the last beat, so an extra beat
  // adds no time — it only names the tool.
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    if (document.visibilityState !== "visible") return;
    fetch("/api/activity", {
      method: "POST",
      keepalive: true,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ path: pathname ?? "" }),
    }).catch(() => {});
  }, [pathname]);

  return null;
}
