"use client";

import { useEffect, useState } from "react";
import { usePathname, useSearchParams } from "next/navigation";

// The "order taken" signal (2026-08-27, operator: on a slow connection every
// tap feels frozen). App Router navigations render nothing until the server
// answers — on a slow phone network that's seconds of a dead screen. This
// paints a thin ochre bar sweeping along the top edge from the INSTANT any
// in-app link is tapped until the route actually changes, so a tap is always
// visibly acknowledged even before the destination's skeleton streams in.
//
// Detection is a capture-phase click listener rather than a router API:
// App Router exposes no global navigation events, and per-link pending state
// (useLinkStatus) would mean touching every Link in the codebase. A capture
// listener sees the tap before Next's own handler, covers the sidebar, the
// tab bar, cards, and every future link for free, and costs nothing when idle.
export function RouteProgress() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [pending, setPending] = useState(false);

  // Route (or query) changed — the destination is painting; stand down.
  useEffect(() => {
    setPending(false);
  }, [pathname, searchParams]);

  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const anchor = (e.target as Element | null)?.closest?.("a");
      if (!anchor) return;
      const href = anchor.getAttribute("href");
      // Internal navigations only: same-tab, same-origin path links. Hash
      // jumps, downloads, and external/system-browser links change no route.
      if (!href || !href.startsWith("/") || href.startsWith("//")) return;
      if (anchor.target && anchor.target !== "_self") return;
      if (anchor.hasAttribute("download")) return;
      const [destPath] = href.split(/[?#]/);
      if (destPath === window.location.pathname && href.includes("#")) return;
      // Deferred a tick: a later capture listener may still cancel this
      // navigation (the character form's unsaved-changes guard does) — the
      // flag is only trustworthy after every handler has run.
      setTimeout(() => {
        if (!e.defaultPrevented) setPending(true);
      }, 0);
    }
    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
  }, []);

  // Never strand the bar: if nothing changed (prefetched instant paint on the
  // same route, a cancelled load), clear it after a beat.
  useEffect(() => {
    if (!pending) return;
    const timer = setTimeout(() => setPending(false), 12_000);
    return () => clearTimeout(timer);
  }, [pending]);

  if (!pending) return null;

  return (
    <div
      aria-hidden
      className="pointer-events-none fixed inset-x-0 top-0 z-[120] h-[2.5px] overflow-hidden"
      style={{ top: "env(safe-area-inset-top, 0px)" }}
    >
      <div
        className="h-full w-1/3 rounded-full bg-atelier-accent"
        style={{ animation: "route-progress-sweep 1.1s ease-in-out infinite" }}
      />
    </div>
  );
}
