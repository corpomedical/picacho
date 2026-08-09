"use client";

import { useEffect, useMemo, useRef, useState, type SVGProps } from "react";
import Link from "next/link";
import { useRouter, usePathname } from "next/navigation";
import { cn } from "@/lib/cn";

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
  { href: "/admin/moderation", label: "Moderation", icon: ShieldIcon },
  { href: "/admin/reports", label: "Reports", icon: FlagIcon },
  { href: "/admin/feedback", label: "Feedback", icon: ChatIcon },
  { href: "/admin/system", label: "System health", icon: PulseIcon },
  { href: "/admin/providers", label: "AI providers", icon: CpuIcon },
  { href: "/admin/voices", label: "Voices", icon: MicIcon },
  { href: "/admin/flags", label: "Feature flags", icon: ToggleIcon },
  { href: "/admin/settings", label: "Settings", icon: GearIcon },
] as const;

function isActive(pathname: string, href: string): boolean {
  if (href === "/admin") return pathname === "/admin";
  return pathname === href || pathname.startsWith(`${href}/`);
}

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

export function AdminCommandBar({
  badges = {},
}: {
  // Keyed by href, e.g. "/admin/users" — matches NAV_ITEMS below, computed
  // server-side in admin/layout.tsx since this component is client-side and
  // can't query Supabase itself.
  badges?: Record<string, number>;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

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
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-8 py-2.5">
        {/* py-2 here isn't decorative — nav has overflow-x-auto for the
            mobile scroll fix, which per the CSS overflow spec forces
            overflow-y to auto too, clipping anything that pokes outside the
            nav's own box. The badge sits partly above each icon's edge, so
            without this padding the top of every badge would get cut off. */}
        <nav className="flex items-center gap-1 overflow-x-auto overscroll-x-contain py-2">
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
