"use client";

import { useEffect } from "react";

// Measures how long a signed-in person is actually using the site.
//
// Mounted in the app layout, so it only ever runs for signed-in users on
// their own account. It is not analytics and carries no visitor identifier:
// it stamps activity on the caller's own profile row, which is what powers
// "last seen", "online now" and time-on-site in the admin area. Page-view
// analytics remain separate and consent-gated (see PageViewTracker).
//
// Beats only while the tab is actually visible — a forgotten background tab
// must not accrue time, or every number here becomes a lie. Each beat credits
// the gap since the previous one, capped server-side, so a closed laptop
// simply stops contributing rather than counting the hours until it reopens.
const BEAT_MS = 60_000;

export function ActivityHeartbeat() {
  useEffect(() => {
    let stopped = false;

    function beat() {
      if (stopped || document.visibilityState !== "visible") return;
      // keepalive so the final beat still lands if this fires as the tab is
      // being closed. Fire-and-forget: never surfaces or blocks anything.
      fetch("/api/activity", { method: "POST", keepalive: true }).catch(() => {});
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

  return null;
}
