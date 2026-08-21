"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type SVGProps } from "react";
import { usePathname, useRouter } from "next/navigation";
import { isNativeAppClient } from "@/lib/native/platform";
import { capPlugin } from "@/lib/native/bridge";
import { useLocale } from "@/lib/i18n/provider";

// The floating quick-actions pill, app-shell only — the Gemini pattern the
// operator asked for by name (2026-08-21): scrolled to the bottom of a long
// conversation, "new chat" and the overflow menu must still be one thumb
// away instead of a full scroll up. Fixed under the status bar, so it never
// leaves the screen.
//
// Two controls, deliberately: the pencil (new chat — the single most common
// escape hatch), and ⋯ with the destinations that DIDN'T earn a tab:
// dashboard, help/tutorial, and the system share sheet for the app itself.

export const NEW_CHAT_EVENT = "picacho:new-chat";

function PencilIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" />
    </svg>
  );
}

function DotsIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" {...props}>
      <circle cx="5" cy="12" r="1.6" />
      <circle cx="12" cy="12" r="1.6" />
      <circle cx="19" cy="12" r="1.6" />
    </svg>
  );
}

export function NativeQuickPill() {
  const pathname = usePathname();
  const router = useRouter();
  const { t } = useLocale();
  const [isNative, setIsNative] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  // Hidden while the page is at (or near) the top: up there the page's own
  // chrome — "New chat", headers — already offers these actions, and the
  // pill floated right on top of them (operator-reported, 2026-08-21). It
  // slides in from the right once you're genuinely down-page, which is the
  // only place it earns its keep.
  const [scrolled, setScrolled] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => setIsNative(isNativeAppClient()), []);

  useEffect(() => {
    if (!isNative) return;
    const scroller = document.querySelector("[data-app-scroll]");
    if (!scroller) return;
    const onScroll = () => setScrolled(scroller.scrollTop > 120);
    onScroll();
    scroller.addEventListener("scroll", onScroll, { passive: true });
    return () => scroller.removeEventListener("scroll", onScroll);
    // Re-find the scroller per navigation: the layout persists but pages
    // reset scroll, and a fresh check keeps the state honest.
  }, [isNative, pathname]);

  // The slide-out also closes the menu — an open menu attached to an
  // off-screen pill would strand keyboard focus in the void.
  useEffect(() => {
    if (!scrolled) setMenuOpen(false);
  }, [scrolled]);

  // Outside tap closes the menu — same contract as every popover in the app.
  useEffect(() => {
    if (!menuOpen) return;
    const onDown = (e: PointerEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setMenuOpen(false);
    };
    window.addEventListener("pointerdown", onDown);
    return () => window.removeEventListener("pointerdown", onDown);
  }, [menuOpen]);

  if (!isNative || !pathname.startsWith("/app")) return null;

  const p = t.nativePill;

  function newChat() {
    setMenuOpen(false);
    if (pathname.startsWith("/app/generate")) {
      window.dispatchEvent(new CustomEvent(NEW_CHAT_EVENT));
    } else {
      router.push("/app/generate");
    }
  }

  function shareApp() {
    setMenuOpen(false);
    const share = capPlugin("Share");
    void share?.share?.({ title: "Picacho", url: "https://picacho.ai" });
  }

  return (
    <div
      ref={rootRef}
      className={
        "fixed right-3 z-40 transition-transform duration-300 ease-out " +
        (scrolled ? "translate-x-0" : "pointer-events-none translate-x-[130%]")
      }
      style={{ top: "calc(env(safe-area-inset-top) + 8px)" }}
    >
      <div className="flex items-center rounded-full border border-atelier-rule bg-atelier-surface/95 shadow-[0_6px_18px_-8px_rgba(33,29,22,0.35)] backdrop-blur-xl">
        <button
          type="button"
          onClick={newChat}
          title={t.generate.newChat}
          aria-label={t.generate.newChat}
          className="flex h-10 w-10 items-center justify-center rounded-full text-atelier-ink transition-colors active:bg-atelier-ink/10"
        >
          <PencilIcon className="h-[18px] w-[18px]" />
        </button>
        <button
          type="button"
          onClick={() => setMenuOpen((v) => !v)}
          title={p.menu}
          aria-label={p.menu}
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          className="flex h-10 w-10 items-center justify-center rounded-full text-atelier-ink transition-colors active:bg-atelier-ink/10"
        >
          <DotsIcon className="h-[18px] w-[18px]" />
        </button>
      </div>

      {menuOpen && (
        <div
          role="menu"
          className="absolute right-0 mt-2 w-52 overflow-hidden rounded-control border border-atelier-rule bg-atelier-surface p-1 shadow-[0_16px_40px_-16px_rgba(33,29,22,0.4)]"
        >
          <Link
            href="/app"
            role="menuitem"
            onClick={() => setMenuOpen(false)}
            className="block rounded-control px-3 py-2.5 text-sm text-atelier-ink transition-colors active:bg-atelier-ink/5"
          >
            {p.home}
          </Link>
          <Link
            href="/app/tutorial"
            role="menuitem"
            onClick={() => setMenuOpen(false)}
            className="block rounded-control px-3 py-2.5 text-sm text-atelier-ink transition-colors active:bg-atelier-ink/5"
          >
            {p.help}
          </Link>
          <button
            type="button"
            role="menuitem"
            onClick={shareApp}
            className="block w-full rounded-control px-3 py-2.5 text-left text-sm text-atelier-ink transition-colors active:bg-atelier-ink/5"
          >
            {p.share}
          </button>
        </div>
      )}
    </div>
  );
}
