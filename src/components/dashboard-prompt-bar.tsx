"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { cn } from "@/lib/cn";
import { promptBarShown } from "@/lib/dashboard/prompt-bar";

// The dashboard's prompt bar, as the mockup has it: at the foot of the screen,
// not a button inside the band.
//
// STICKY, not fixed. Fixed broke the sidebar's settings button: the sidebar is
// `md:static md:z-auto`, so it forms no stacking context, and a fixed z-20 bar
// painted straight over it — while `inset-x-0` spread an invisible full-width
// container across the bottom of the viewport, including the sidebar's own
// footer where that button lives. No pl- offset could have fixed it either,
// since the rail is w-64 expanded and w-14 collapsed. Sticky keeps the bar
// inside the content column, where it belongs and where it covers nothing.
// --native-tab-bar (published by NativeTabBar; 0 on the web) docks it above
// the app's bottom bar.
//
// It slides in once you scroll (operator, 2026-09-21: "make it appear when you
// scroll down"). When is decided by promptBarShown; this component only
// measures. A client component because that follows the app's scroller, and
// the page is a server component.

type DashboardPromptBarProps = {
  href: string;
  /** The face of the character the bar is for, when they have a photo. */
  avatarUrl: string | null;
  label: string;
};

export function DashboardPromptBar({ href, avatarUrl, label }: DashboardPromptBarProps) {
  // Starts hidden, so the server's HTML matches a page opened at its top,
  // which is where the bar is hidden: no flash of the bar on first paint.
  const [shown, setShown] = useState(false);
  const barRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const scroller = document.querySelector<HTMLElement>("[data-app-scroll]");
    const reel = document.querySelector<HTMLElement>("[data-reel-band]");
    const update = () => {
      const bar = barRef.current;
      // Outside the app's shell there is no scroller to follow: just show it.
      if (!scroller || !bar) return setShown(true);
      const box = scroller.getBoundingClientRect();
      setShown(
        promptBarShown({
          // No reel on the page counts as already scrolled past it.
          reelBottom: reel ? reel.getBoundingClientRect().bottom : -Infinity,
          scrollerTop: box.top,
          scrollTop: scroller.scrollTop,
          clientHeight: scroller.clientHeight,
          scrollHeight: scroller.scrollHeight,
          // The bar is the page's last child, so the page's foot is where it
          // rests; neither sticky's shift nor the slide moves its parent.
          restBottom: bar.parentElement?.getBoundingClientRect().bottom ?? Infinity,
          // Sticky's resolved bottom, in px, --native-tab-bar included.
          dockLine: box.bottom - (parseFloat(getComputedStyle(bar).bottom) || 0),
        }),
      );
    };
    update();
    if (!scroller) return;
    scroller.addEventListener("scroll", update, { passive: true });
    window.addEventListener("resize", update);
    // The page can grow after it opens (the install hint mounts late), which
    // moves its end.
    const observer = new ResizeObserver(update);
    observer.observe(scroller.firstElementChild ?? scroller);
    return () => {
      scroller.removeEventListener("scroll", update);
      window.removeEventListener("resize", update);
      observer.disconnect();
    };
  }, []);

  return (
    // inert while hidden: an invisible link must not take a tap or a Tab.
    // A slide, never a fade: any opacity below 1 here makes this div the
    // Link's backdrop root, and its frosted glass went clear for the whole
    // 300 ms. Visibility flips at the far end of the slide instead (a
    // transition keeps it visible until then), which also hides the parked
    // bar where it would show through the app's translucent tab bar.
    <div
      ref={barRef}
      inert={!shown}
      className={cn(
        "sticky bottom-[calc(1rem+var(--native-tab-bar,0px))] z-20 transition-[translate,visibility] duration-300 ease-out motion-reduce:transition-none",
        shown
          ? "visible translate-y-0"
          : "pointer-events-none invisible translate-y-[calc(100%+1rem)]",
      )}
    >
      <Link
        href={href}
        className="flex items-center gap-2.5 rounded-full border border-atelier-rule bg-atelier-surface/90 py-2 pl-3 pr-2 shadow-[0_3px_8px_rgba(33,29,22,.10),0_18px_34px_-20px_rgba(33,29,22,.40)] backdrop-blur-xl"
      >
        {avatarUrl && (
          /* eslint-disable-next-line @next/next/no-img-element */
          <img src={avatarUrl} alt="" className="h-7 w-7 flex-none rounded-full object-cover" />
        )}
        <span className="flex-1 truncate text-[13px] text-atelier-muted">{label}</span>
        <span className="flex h-8 w-8 flex-none items-center justify-center rounded-full bg-atelier-ink text-sm text-atelier-paper">
          ↑
        </span>
      </Link>
    </div>
  );
}
