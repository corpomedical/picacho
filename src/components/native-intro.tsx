"use client";

import { useEffect, useState } from "react";

// Full-screen brand hold between the native splash and the app — rebuilt
// 2026-08-29 on the HBO Max pattern after the operator filmed their launch
// ("The intro is not the problem. Look at the video and see how it works"):
// their brand screen holds for 5+ seconds and still feels premium because
// it takes over instantly and it MOVES — a wordmark with pulsing dots reads
// as "working" where a motionless icon reads as crashed. The previous intro
// was a fixed 1.4s wordmark animation with no progress signal — pure
// theater, cut earlier the same day; this one is an honest loading hold:
// it is the server-rendered first paint (the splash dismisses onto it), the
// dots animate from that first frame, and it dissolves as soon as the app
// has actually hydrated — often sooner than the old fixed timer, never
// pretending to be done before it is.
//
// Plays once per WebView session: cold app opens get the hold; full-page
// reloads mid-session skip it via sessionStorage. Unmounting goes through
// React state — NEVER node.remove(): the first-generation intro pulled its
// own node out of the DOM and crashed React's reconciler on the next
// navigation ("Something went wrong" on every sign-in, 2026-08-20). The
// stylesheet keeps a failsafe: the sheet fades itself out at 8s with
// `forwards` fill and never intercepts input (pointer-events: none), so
// even a dead hydration can't leave a blocking sheet over the app.
const PLAYED_KEY = "picacho_intro_played";

export function NativeIntro() {
  // "hold" -> "leaving" (dissolve animation) -> unmounted.
  const [phase, setPhase] = useState<"hold" | "leaving" | "done">("hold");

  useEffect(() => {
    let alreadyPlayed = false;
    try {
      alreadyPlayed = window.sessionStorage.getItem(PLAYED_KEY) === "1";
      if (!alreadyPlayed) window.sessionStorage.setItem(PLAYED_KEY, "1");
    } catch {
      // Storage unavailable — treat as a first play; worst case it replays.
    }
    if (alreadyPlayed) {
      setPhase("done");
      return;
    }
    // Ready means BOTH: this effect has run (React hydrated, app
    // interactive) AND the streamed route content has actually landed —
    // signaled by the root layout's Suspense boundary tail (an inline
    // script sets the global as its chunk parses; the marker span backs it
    // up), so on a slow connection the hold keeps pulsing over the stream
    // instead of dissolving onto the empty fallback. Polling by frame is
    // fine: the 8s CSS failsafe bounds the worst case.
    let raf = 0;
    const landed = () =>
      (window as { __picachoStreamLanded?: boolean }).__picachoStreamLanded === true ||
      Boolean(document.querySelector("[data-stream-landed]"));
    const check = () => {
      if (landed()) {
        // One extra frame so the landed content paints under the sheet
        // before the dissolve exposes it.
        raf = requestAnimationFrame(() => setPhase("leaving"));
      } else {
        raf = requestAnimationFrame(check);
      }
    };
    raf = requestAnimationFrame(check);
    return () => cancelAnimationFrame(raf);
  }, []);

  if (phase === "done") return null;

  return (
    <div
      aria-hidden
      className={phase === "leaving" ? "native-intro native-intro-leave" : "native-intro"}
      onAnimationEnd={(e) => {
        if (e.animationName === "native-intro-dissolve") setPhase("done");
      }}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/logo.png" alt="" className="dark:hidden" />
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/logo-dark.png" alt="" className="hidden dark:block" />
      <div className="native-intro-dots">
        <span />
        <span />
        <span />
      </div>
    </div>
  );
}
