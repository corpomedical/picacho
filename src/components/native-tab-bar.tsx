"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState, type SVGProps } from "react";
import { isNativeAppClient } from "@/lib/native/platform";
import { useLocale } from "@/lib/i18n/provider";
import { cn } from "@/lib/cn";

// Bottom tab bar, shown only inside the iOS/Android apps.
//
// This is the single change that stops the app reading as a website. A left
// sidebar is a desktop-web pattern; nothing on a phone navigates that way, and
// a reviewer opening the app sees "this is a web page" before reading a word.
// Tabs fixed to the bottom edge, thumb-reachable, with the current section
// lit — that's what every app the person already uses looks like.
//
// Four tabs, deliberately. The sidebar carries a dozen destinations, which is
// right on a wide screen and wrong on a narrow one: five is the practical
// ceiling before targets get too small to hit. Everything else stays reachable
// from inside those sections.
//
// Rendered from the web app rather than built natively, so it stays in step
// with the rest of the UI automatically. It is genuinely local chrome in the
// sense that matters — it paints with the shell, doesn't scroll away, and
// doesn't depend on any page's own layout.

function BoltIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <path d="M13 2 3 14h7l-1 8 10-12h-7l1-8Z" />
    </svg>
  );
}

function UserIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <circle cx="12" cy="8" r="4" />
      <path d="M4 21c0-4.418 3.582-8 8-8s8 3.582 8 8" />
    </svg>
  );
}

function PhotosIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <circle cx="8.5" cy="8.5" r="1.5" />
      <path d="m21 15-5-5L5 21" />
    </svg>
  );
}

function ClockIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 3" />
    </svg>
  );
}

function GearIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.6 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.6a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1Z" />
    </svg>
  );
}

export function NativeTabBar() {
  const pathname = usePathname();
  const { t } = useLocale();
  // Rendered only after mount, because the check depends on the Capacitor
  // runtime. Server-rendering it would put a tab bar on the website for a
  // frame before hydration removed it.
  const [isNative, setIsNative] = useState(false);
  useEffect(() => setIsNative(isNativeAppClient()), []);

  if (!isNative) return null;

  // Five tabs — the stated ceiling above. Media earned the fifth slot the
  // hard way: with the sidebar hidden there was NO route to media from
  // inside the shell at all (operator-reported, 2026-08-21). It lands on
  // /app/media, the unified grid; extraMatch keeps the tab lit on the
  // standalone Images/Videos pages too.
  const tabs = [
    { href: "/app/generate", label: t.nav.generate, icon: BoltIcon },
    { href: "/app/character", label: t.nav.characters, icon: UserIcon },
    { href: "/app/media", label: t.nav.media, icon: PhotosIcon, extraMatch: ["/app/images", "/app/videos"] },
    { href: "/app/history", label: t.nav.history, icon: ClockIcon },
    { href: "/app/settings", label: t.nav.settings, icon: GearIcon },
  ] as { href: string; label: string; icon: typeof BoltIcon; extraMatch?: string[] }[];

  return (
    <nav
      // pb keeps the row clear of the home indicator on gesture-navigation
      // phones; without it the last few pixels of the tabs are unreachable.
      className="fixed inset-x-0 bottom-0 z-40 flex border-t border-atelier-rule bg-atelier-paper/95 backdrop-blur-xl"
      style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
    >
      {tabs.map((tab) => {
        // startsWith, not equality: /app/character/new should still light the
        // Characters tab. /app/generate is matched exactly as well as by
        // prefix so the composer counts from either entry point.
        const active =
          pathname === tab.href ||
          pathname.startsWith(`${tab.href}/`) ||
          (tab.extraMatch ?? []).some(
            (m) => pathname === m || pathname.startsWith(`${m}/`),
          );
        const Icon = tab.icon;
        return (
          <Link
            key={tab.href}
            href={tab.href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "flex flex-1 flex-col items-center gap-1 py-2.5 text-[10px] font-medium transition-colors",
              active
                ? "text-atelier-accent"
                : "text-atelier-muted",
            )}
          >
            <Icon className="h-5 w-5" />
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}
