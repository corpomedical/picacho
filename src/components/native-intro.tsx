"use client";

import { useEffect, useState } from "react";

// Full-screen continuation of the native splash screen — the animated logo
// intro (styles: .native-intro in globals.css). The layout renders this only
// when isNativeApp() says so, server-side, so the website never ships it and
// nothing renders-then-vanishes.
//
// Plays once per WebView session: cold app opens get the intro; full-page
// reloads mid-session (rare — state restores, error recoveries) skip it via
// sessionStorage. Unmounting goes through React state — NEVER node.remove():
// the first version pulled its own node out of the DOM, and the next
// client-side navigation crashed React's reconciler into the global error
// boundary ("Something went wrong" on every sign-in, 2026-08-20). The CSS
// animation already ends at opacity 0 with pointer-events off, so even a
// dead hydration can't leave a blocking sheet over the app.
const PLAYED_KEY = "picacho_intro_played";

export function NativeIntro() {
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    let alreadyPlayed = false;
    try {
      alreadyPlayed = window.sessionStorage.getItem(PLAYED_KEY) === "1";
      if (!alreadyPlayed) window.sessionStorage.setItem(PLAYED_KEY, "1");
    } catch {
      // Storage unavailable — treat as a first play; worst case it replays.
    }
    if (alreadyPlayed) {
      setVisible(false);
      return;
    }
    const timer = window.setTimeout(() => setVisible(false), 1600);
    return () => window.clearTimeout(timer);
  }, []);

  if (!visible) return null;

  return (
    <div aria-hidden className="native-intro">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/logo.png" alt="" className="dark:hidden" />
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/logo-dark.png" alt="" className="hidden dark:block" />
    </div>
  );
}
