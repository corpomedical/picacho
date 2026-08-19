"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type SVGProps } from "react";
import Link from "next/link";
import { useRouter, usePathname } from "next/navigation";
import { cn } from "@/lib/cn";
import { getAdminBadgeCounts } from "@/lib/admin/actions";

// Replaces the old always-expanded 12-tab text nav (AdminNav), which had no
// scroll container of its own and used to drag the whole page sideways on a
// phone. This is the "command bar" redesign the user picked from three
// options: an icon-only quick-nav row (compact enough to never need to
// scroll on its own) plus a Cmd+K palette for typing to jump to a page —
// the fastest path once you know the tool, which fits an admin area used by
// exactly one person.
const NAV_ITEMS = [
  { href: "/admin", label: "Dashboard", icon: HomeIcon },
  { href: "/admin/users", label: "Users", icon: UsersIcon },
  { href: "/admin/stats", label: "Stats", icon: ChartIcon },
  { href: "/admin/billing", label: "Billing", icon: CardIcon },
  { href: "/admin/promo", label: "Promo codes", icon: TicketIcon },
  { href: "/admin/emails", label: "Emails", icon: MailIcon },
  { href: "/admin/moderation", label: "Moderation", icon: ShieldIcon },
  { href: "/admin/reports", label: "Reports", icon: FlagIcon },
  { href: "/admin/feedback", label: "Feedback", icon: ChatIcon },
  { href: "/admin/system", label: "System health", icon: PulseIcon },
  { href: "/admin/providers", label: "AI providers", icon: CpuIcon },
  { href: "/admin/voices", label: "Voices", icon: MicIcon },
  { href: "/admin/flags", label: "Feature flags", icon: ToggleIcon },
  { href: "/admin/settings", label: "Settings", icon: GearIcon },
  { href: "/admin/updates", label: "Updates", icon: SparklesIcon },
] as const;

function isActive(pathname: string, href: string): boolean {
  if (href === "/admin") return pathname === "/admin";
  return pathname === href || pathname.startsWith(`${href}/`);
}

// How often the command bar re-checks badge counts. This is what makes the
// red dots "live" -- admin/layout.tsx only computes them once, on the
// request that rendered the current page, so without polling they'd be
// frozen until the next navigation or manual refresh.
const BADGE_POLL_MS = 10_000;

// One human-readable line per pollable badge, used for the drop-down
// notification's text when that badge's count goes up between polls. All
// four counts here only ever grow from a genuinely new item (a real signup,
// a real flag, a real report, real feedback) -- none of them can tick up
// just because the polling window shifted -- so every increase is worth
// surfacing, not just the badge going up silently.
const BADGE_NOTICE: Record<string, (n: number) => string> = {
  "/admin/users": (n) => (n === 1 ? "New signup" : `${n} new signups`),
  "/admin/moderation": (n) => (n === 1 ? "New flagged content" : `${n} new flagged items`),
  "/admin/reports": (n) => (n === 1 ? "New report" : `${n} new reports`),
  "/admin/feedback": (n) => (n === 1 ? "New feedback" : `${n} new feedback messages`),
};

// iOS-style unread dot: iOS system red, a thin white keyline separating it
// from whatever's behind it, and — the actual bug report — pushed further
// out toward the corner (-2.5 instead of -1) so it perches on the icon's
// edge instead of sitting on top of it and blocking the glyph. Stays a
// circle up to 9, then naturally becomes a small pill for "9+" via
// min-width + rounded-full, same as iOS badges do past a single digit.
function NotificationBadge({ count }: { count: number }) {
  if (count <= 0) return null;
  return (
    <span
      aria-label={`${count} notification${count === 1 ? "" : "s"}`}
      className="absolute -right-2.5 -top-2.5 z-10 flex h-[16px] min-w-[16px] items-center justify-center rounded-full bg-[#FF3B30] px-[3px] text-[10px] font-bold leading-none text-white ring-[1.5px] ring-white"
    >
      {count > 9 ? "9+" : count}
    </span>
  );
}

// The live-notification pill for the admin area -- same pill shape, color,
// shadow and enter/exit timing as ComposerToast in generate-form.tsx (the
// "one you did" this is modeled on), just re-pointed to drop down from the
// top center of the whole screen instead of rising up from behind the
// composer, since there's no composer here for it to tuck behind. Keyed by
// its caller on the notice's own id, so back-to-back notices (two reports
// filed a few seconds apart) each get their own full drop-in instead of one
// silently replacing the other's text mid-animation.
function AdminNotificationBanner({ message, onDone }: { message: string; onDone: () => void }) {
  const [entered, setEntered] = useState(false);

  useEffect(() => {
    const enter = requestAnimationFrame(() => setEntered(true));
    const startExit = setTimeout(() => setEntered(false), 4200);
    const remove = setTimeout(onDone, 4500);
    return () => {
      cancelAnimationFrame(enter);
      clearTimeout(startExit);
      clearTimeout(remove);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="pointer-events-none fixed inset-x-0 top-4 z-[70] flex justify-center px-4">
      <div
        role="status"
        aria-live="polite"
        className={cn(
          "pointer-events-auto max-w-[92%] rounded-full bg-neutral-900 px-4 py-2.5 text-center text-sm text-white shadow-[0_12px_28px_-10px_rgba(0,0,0,0.45)] transition-all duration-300 ease-out",
          entered ? "translate-y-0 opacity-100" : "-translate-y-[130%] opacity-0",
        )}
      >
        {message}
      </div>
    </div>
  );
}

export function AdminCommandBar({
  badges: initialBadges = {},
}: {
  // Keyed by href, e.g. "/admin/users" — matches NAV_ITEMS below. This is
  // only the seed value, computed server-side in admin/layout.tsx on
  // whichever request first rendered the page (so there's no flash of zero
  // badges on load, since this component is client-side and can't query
  // Supabase itself). From here the polling effect below takes over and
  // keeps it live.
  badges?: Record<string, number>;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const [badges, setBadges] = useState<Record<string, number>>(initialBadges);
  const badgesRef = useRef(badges);
  useEffect(() => {
    badgesRef.current = badges;
  }, [badges]);
  const [notice, setNotice] = useState<{ id: number; message: string } | null>(null);
  const noticeIdRef = useRef(0);

  // Horizontal scroll affordances for the icon nav (Material/Google-tabs
  // style): chevrons that appear only when there's more to scroll in that
  // direction, fade with the scroll position, and scroll smoothly on click.
  const navRef = useRef<HTMLElement | null>(null);
  const [canLeft, setCanLeft] = useState(false);
  const [canRight, setCanRight] = useState(false);

  const updateArrows = useCallback(() => {
    const el = navRef.current;
    if (!el) return;
    // 1px slack so sub-pixel rounding at the ends doesn't leave an arrow
    // stuck visible when you're already fully scrolled that way.
    setCanLeft(el.scrollLeft > 1);
    setCanRight(el.scrollLeft + el.clientWidth < el.scrollWidth - 1);
  }, []);

  useEffect(() => {
    const el = navRef.current;
    if (!el) return;
    // Center the active tab on load so the current page is always visible
    // even when it lives off the right edge. Adjusts only the nav's own
    // scrollLeft (via rects) — never scrollIntoView, which can nudge the
    // whole page.
    const activeEl = el.querySelector<HTMLElement>('[aria-current="page"]');
    if (activeEl) {
      const elRect = el.getBoundingClientRect();
      const aRect = activeEl.getBoundingClientRect();
      el.scrollLeft += aRect.left + aRect.width / 2 - (elRect.left + elRect.width / 2);
    }
    updateArrows();
    const ro = new ResizeObserver(updateArrows);
    ro.observe(el);
    window.addEventListener("resize", updateArrows);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", updateArrows);
    };
  }, [updateArrows, pathname]);

  const scrollNav = useCallback((direction: 1 | -1) => {
    const el = navRef.current;
    if (!el) return;
    // Scroll by most of a viewport so a click makes real progress, but keep a
    // sliver of overlap so you never lose your place between clicks.
    el.scrollBy({ left: direction * Math.max(180, el.clientWidth * 0.75), behavior: "smooth" });
  }, []);

  // Polls getAdminBadgeCounts on a timer so the red dots (and this drop-down
  // banner) update while the page just sits open, instead of only refreshing
  // on the next navigation. A plain interval rather than Supabase Realtime —
  // consistent with how AutoRefresh already keeps admin/stats numbers live
  // elsewhere, and one query round-trip every 10s per open admin tab is
  // cheap enough not to need a persistent websocket subscription for it.
  useEffect(() => {
    const id = setInterval(async () => {
      let next: Record<string, number>;
      try {
        next = await getAdminBadgeCounts();
      } catch {
        // Transient network/session hiccup -- just wait for the next tick
        // rather than surfacing an error for something this minor.
        return;
      }
      const prev = badgesRef.current;
      for (const [href, describe] of Object.entries(BADGE_NOTICE)) {
        const count = next[href] ?? 0;
        const before = prev[href] ?? 0;
        if (count > before) {
          noticeIdRef.current += 1;
          setNotice({ id: noticeIdRef.current, message: describe(count - before) });
          break; // one banner per tick is plenty -- the badge itself shows the rest
        }
      }
      setBadges(next);
    }, BADGE_POLL_MS);
    return () => clearInterval(id);
  }, []);

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return NAV_ITEMS;
    return NAV_ITEMS.filter((item) => item.label.toLowerCase().includes(q));
  }, [query]);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((prev) => {
          const next = !prev;
          if (next) resetQuery();
          return next;
        });
      } else if (e.key === "Escape" && open) {
        setOpen(false);
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open]);

  // Locking scroll and moving focus are syncs with the DOM/browser, not
  // React state — that's what belongs in an effect. Resetting query/selected
  // happens at the two call sites that actually open the palette instead
  // (openPalette below, and the Cmd+K branch above), not here, since setting
  // state synchronously inside an effect body just to reset it on open would
  // trigger an extra render for no reason.
  useEffect(() => {
    if (open) {
      document.body.style.overflow = "hidden";
      requestAnimationFrame(() => inputRef.current?.focus());
    } else {
      document.body.style.overflow = "";
    }
    return () => {
      document.body.style.overflow = "";
    };
  }, [open]);

  function resetQuery() {
    setQuery("");
    setSelected(0);
  }

  function openPalette() {
    resetQuery();
    setOpen(true);
  }

  function go(href: string) {
    setOpen(false);
    router.push(href);
  }

  function onInputKeyDown(e: React.KeyboardEvent) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setSelected((i) => Math.min(i + 1, results.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSelected((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter" && results[selected]) {
      e.preventDefault();
      go(results[selected].href);
    }
  }

  return (
    <>
      {notice && (
        <AdminNotificationBanner
          key={notice.id}
          message={notice.message}
          onDone={() => setNotice(null)}
        />
      )}

      <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-8 py-2.5">
        {/* Scroll region with fade-edged chevron controls. The wrapper is
            relative so the arrows can overlay the nav's edges; min-w-0 lets
            this flex child actually shrink (default min-width:auto would
            keep it at content width and the nav would never need to scroll). */}
        <div className="relative min-w-0 flex-1">
          <div
            className={cn(
              "pointer-events-none absolute inset-y-0 left-0 z-20 flex items-center bg-gradient-to-r from-white via-white to-transparent pr-8 transition-opacity duration-200",
              canLeft ? "opacity-100" : "opacity-0",
            )}
          >
            <button
              type="button"
              aria-label="Scroll left"
              tabIndex={canLeft ? 0 : -1}
              onClick={() => scrollNav(-1)}
              className="pointer-events-auto flex h-7 w-7 items-center justify-center rounded-full border border-neutral-200 bg-white text-neutral-500 shadow-[0_1px_3px_rgba(0,0,0,0.08)] transition-colors hover:border-neutral-300 hover:text-neutral-900"
            >
              <ChevronLeftIcon className="h-4 w-4" />
            </button>
          </div>

          {/* py-2 here isn't decorative — nav has overflow-x-auto for the
              mobile scroll fix, which per the CSS overflow spec forces
              overflow-y to auto too, clipping anything that pokes outside the
              nav's own box. The badge sits partly above each icon's edge, so
              without this padding the top of every badge would get cut off.
              The scrollbar-hiding utilities keep the raw bar out of sight —
              the chevrons are the scroll affordance now. */}
          <nav
            ref={navRef}
            onScroll={updateArrows}
            className="flex items-center gap-1 overflow-x-auto overscroll-x-contain py-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
          >
          {NAV_ITEMS.map((item) => {
            const active = isActive(pathname, item.href);
            const Icon = item.icon;
            const count = badges[item.href] ?? 0;
            return (
              <Link
                key={item.href}
                href={item.href}
                title={item.label}
                aria-label={item.label}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "flex h-8 flex-shrink-0 items-center justify-center gap-2 rounded-[10px] px-2 text-sm transition-colors sm:justify-start sm:px-3",
                  active
                    ? "bg-neutral-900 text-white"
                    : "text-neutral-400 hover:bg-neutral-100 hover:text-neutral-900",
                )}
              >
                <span className="relative flex-shrink-0">
                  <Icon className="h-[18px] w-[18px]" />
                  <NotificationBadge count={count} />
                </span>
                {/* Icon-only on phone width, label appears from sm: up — the
                    nav has its own overflow-x-auto scroll container above so
                    even if labels push the total width past the header on a
                    mid-size tablet, it scrolls within the bar instead of
                    dragging the whole page, which was the original bug. */}
                <span className="hidden sm:inline">{item.label}</span>
              </Link>
            );
          })}
          </nav>

          <div
            className={cn(
              "pointer-events-none absolute inset-y-0 right-0 z-20 flex items-center justify-end bg-gradient-to-l from-white via-white to-transparent pl-8 transition-opacity duration-200",
              canRight ? "opacity-100" : "opacity-0",
            )}
          >
            <button
              type="button"
              aria-label="Scroll right"
              tabIndex={canRight ? 0 : -1}
              onClick={() => scrollNav(1)}
              className="pointer-events-auto flex h-7 w-7 items-center justify-center rounded-full border border-neutral-200 bg-white text-neutral-500 shadow-[0_1px_3px_rgba(0,0,0,0.08)] transition-colors hover:border-neutral-300 hover:text-neutral-900"
            >
              <ChevronRightIcon className="h-4 w-4" />
            </button>
          </div>
        </div>

        <button
          type="button"
          onClick={openPalette}
          className="flex flex-shrink-0 items-center gap-2 rounded-[10px] border border-neutral-200 px-3 py-1.5 text-sm text-neutral-400 transition-colors hover:border-neutral-300 hover:text-neutral-600"
        >
          <SearchIcon className="h-4 w-4" />
          <span className="hidden sm:inline">Jump to&hellip;</span>
          <kbd className="hidden rounded-[6px] border border-neutral-200 bg-neutral-50 px-1.5 py-0.5 font-sans text-[11px] text-neutral-400 sm:inline">
            &#8984;K
          </kbd>
        </button>
      </div>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-start justify-center bg-neutral-900/30 px-4 pt-[15vh]"
          onClick={() => setOpen(false)}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Jump to admin page"
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-md overflow-hidden rounded-2xl bg-white shadow-[0_20px_60px_-15px_rgba(0,0,0,0.35)]"
          >
            <div className="flex items-center gap-2.5 border-b border-neutral-100 px-4 py-3">
              <SearchIcon className="h-4 w-4 flex-shrink-0 text-neutral-400" />
              <input
                ref={inputRef}
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value);
                  setSelected(0);
                }}
                onKeyDown={onInputKeyDown}
                placeholder="Jump to a page&hellip;"
                className="w-full text-sm text-neutral-900 placeholder:text-neutral-400 focus:outline-none"
              />
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="Close"
                className="flex-shrink-0 text-neutral-300 hover:text-neutral-500"
              >
                <XIcon className="h-4 w-4" />
              </button>
            </div>
            <ul className="max-h-80 overflow-y-auto p-1.5">
              {results.length === 0 && (
                <li className="px-3 py-6 text-center text-sm text-neutral-400">No matches.</li>
              )}
              {results.map((item, i) => {
                const Icon = item.icon;
                const active = i === selected;
                const count = badges[item.href] ?? 0;
                return (
                  <li key={item.href}>
                    <button
                      type="button"
                      onMouseEnter={() => setSelected(i)}
                      onClick={() => go(item.href)}
                      className={cn(
                        "flex w-full items-center gap-3 rounded-[10px] px-3 py-2 text-left text-sm transition-colors",
                        active ? "bg-neutral-900 text-white" : "text-neutral-700",
                      )}
                    >
                      <span className="relative flex-shrink-0">
                        <Icon className="h-4 w-4" />
                        {count > 0 && (
                          <span
                            className={cn(
                              "absolute -right-2 -top-2 flex h-3.5 min-w-3.5 items-center justify-center rounded-full px-1 text-[9px] font-bold leading-none ring-[1.5px]",
                              active
                                ? "bg-white text-neutral-900 ring-neutral-900"
                                : "bg-[#FF3B30] text-white ring-white",
                            )}
                          >
                            {count > 9 ? "9+" : count}
                          </span>
                        )}
                      </span>
                      <span className="flex-1">{item.label}</span>
                      {count > 0 && (
                        <span
                          className={cn(
                            "flex-shrink-0 text-xs",
                            active ? "text-white/70" : "text-neutral-400",
                          )}
                        >
                          {count}
                        </span>
                      )}
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        </div>
      )}
    </>
  );
}

function HomeIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <path d="M4 11 12 4l8 7" />
      <path d="M6 10v9a1 1 0 0 0 1 1h4v-5h2v5h4a1 1 0 0 0 1-1v-9" />
    </svg>
  );
}

function UsersIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <circle cx="8" cy="8" r="3.2" />
      <path d="M2.5 20c0-3.6 2.5-6.5 5.5-6.5s5.5 2.9 5.5 6.5" />
      <circle cx="17" cy="8.5" r="2.6" />
      <path d="M14.8 13.6c2.7.3 4.7 2.9 4.7 6.4" />
    </svg>
  );
}

function ChartIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <path d="M4 20V10M10 20V4M16 20v-7M4 20h16" />
    </svg>
  );
}

function CardIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <rect x="2.5" y="5" width="19" height="14" rx="2" />
      <path d="M2.5 9.5h19" />
      <path d="M6 15h4" />
    </svg>
  );
}

function ShieldIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <path d="M12 2 4 5v6c0 5 3.4 8.5 8 11 4.6-2.5 8-6 8-11V5l-8-3Z" />
    </svg>
  );
}

function FlagIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <path d="M5 3v18" />
      <path d="M5 4h11l-2 4 2 4H5" />
    </svg>
  );
}

function ChatIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <path d="M4 5h16a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H9l-4 4v-4H4a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1Z" />
    </svg>
  );
}

function PulseIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <path d="M3 12h4l2-7 4 14 2-7h6" />
    </svg>
  );
}

function CpuIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <rect x="7" y="7" width="10" height="10" rx="1.5" />
      <path d="M9 3v3M15 3v3M9 18v3M15 18v3M3 9h3M3 15h3M18 9h3M18 15h3" />
    </svg>
  );
}

function MicIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <rect x="9" y="2.5" width="6" height="11" rx="3" />
      <path d="M5.5 11.5a6.5 6.5 0 0 0 13 0" />
      <path d="M12 18v3" />
      <path d="M9 21h6" />
    </svg>
  );
}

function ToggleIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <rect x="2" y="7" width="20" height="10" rx="5" />
      <circle cx="8" cy="12" r="3.2" />
    </svg>
  );
}

function GearIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 13a8 8 0 0 0 0-2l2-1.5-2-3.4-2.4.6a8 8 0 0 0-1.7-1L14.8 3h-4l-.5 2.7a8 8 0 0 0-1.7 1l-2.4-.6-2 3.4L6 11a8 8 0 0 0 0 2l-2 1.5 2 3.4 2.4-.6a8 8 0 0 0 1.7 1l.5 2.7h4l.5-2.7a8 8 0 0 0 1.7-1l2.4.6 2-3.4Z" />
    </svg>
  );
}

function TicketIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <path d="M2 9a3 3 0 0 1 0 6v2a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-2a3 3 0 0 1 0-6V7a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2Z" />
      <path d="M13 5v2" />
      <path d="M13 17v2" />
      <path d="M13 11v2" />
    </svg>
  );
}

function MailIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <path d="m3.5 7.5 8.5 6 8.5-6" />
    </svg>
  );
}

function SparklesIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <path d="M12 3l1.8 4.7L18.5 9.5 13.8 11.3 12 16l-1.8-4.7L5.5 9.5l4.7-1.8L12 3Z" />
      <path d="M19 14l.7 1.8 1.8.7-1.8.7L19 19l-.7-1.8-1.8-.7 1.8-.7L19 14Z" />
    </svg>
  );
}

function ChevronLeftIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <path d="m15 5-7 7 7 7" />
    </svg>
  );
}

function ChevronRightIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <path d="m9 5 7 7-7 7" />
    </svg>
  );
}

function SearchIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <circle cx="11" cy="11" r="7" />
      <path d="m21 21-4.3-4.3" />
    </svg>
  );
}

function XIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <path d="M18 6 6 18M6 6l12 12" />
    </svg>
  );
}
