"use client";

import "./light.css";
import Link from "next/link";
import { createContext, useContext, useEffect, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useLocale } from "@/lib/i18n/provider";
import { LIGHT_HOME, shellRedirect, type AppLook, type AppMode } from "@/lib/light/mode";
import { useTheme } from "@/lib/theme/theme-provider";
import { THEME_STORAGE_KEY } from "@/lib/theme/screening";
import { saveAppChoices } from "@/lib/light/actions";

export type LightRecent = { id: string; prompt: string };

const ShellContext = createContext<{ openMenu: () => void }>({ openMenu: () => {} });
export const useLightShell = () => useContext(ShellContext);

export function PlusIcon({ size = 22 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
}

export function MenuIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
      <path d="M4 7h16M4 12h16M4 17h16" />
    </svg>
  );
}

function StudioIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="3" y="4" width="18" height="16" rx="3" />
      <path d="M3 9h18M8 4v5" />
    </svg>
  );
}

function GearIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" />
    </svg>
  );
}

/**
 * Sends a new account to the welcome step, and a Light account's /app to the
 * chat (lib/light/mode.ts shellRedirect). Client-side because the layout
 * cannot see the path.
 */
export function ModeGate({ mode, needsChoice }: { mode: AppMode; needsChoice: boolean }) {
  const pathname = usePathname();
  const router = useRouter();
  const target = shellRedirect(pathname ?? "", mode, needsChoice);
  useEffect(() => {
    if (target) router.replace(target);
  }, [target, router]);
  return null;
}

function Rail({ recent, onNavigate }: { recent: LightRecent[]; onNavigate?: () => void }) {
  const { t } = useLocale();
  const l = t.light;
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const activeTake = pathname === LIGHT_HOME ? params.get("take") : null;
  const [switching, setSwitching] = useState(false);
  const [error, setError] = useState("");

  async function switchToStudio() {
    setSwitching(true);
    setError("");
    const res = await saveAppChoices({ mode: "advanced" });
    if (res.error) {
      setError(l.saveFailed);
      setSwitching(false);
      return;
    }
    onNavigate?.();
    router.replace("/app");
    router.refresh();
  }

  return (
    <nav aria-label={l.recent} className="pl-surface flex h-full flex-col gap-2 px-3 py-4" style={{ background: "var(--pl-rail)" }}>
      <Link
        href={LIGHT_HOME}
        onClick={onNavigate}
        className="flex h-11 items-center gap-2.5 self-start rounded-full px-4 text-[15px]"
        style={{ background: "var(--pl-chip)", color: "var(--pl-ink)", textDecoration: "none" }}
      >
        <PlusIcon size={18} />
        {l.newChat}
      </Link>
      <div className="mt-5 px-4 text-[13px] font-semibold" style={{ color: "var(--pl-muted)" }}>
        {l.recent}
      </div>
      <div className="flex min-h-0 flex-col gap-0.5 overflow-y-auto">
        {recent.length === 0 && (
          <p className="px-4 py-2 text-[13px]" style={{ color: "var(--pl-muted)" }}>
            {l.noRecent}
          </p>
        )}
        {recent.map((r) => (
          <Link
            key={r.id}
            href={`${LIGHT_HOME}?take=${r.id}`}
            onClick={onNavigate}
            aria-current={activeTake === r.id ? "page" : undefined}
            className="pl-rail-link"
          >
            <span className="truncate">{r.prompt || "…"}</span>
          </Link>
        ))}
      </div>
      <div className="flex-grow" />
      <button
        type="button"
        onClick={() => void switchToStudio()}
        disabled={switching}
        className="flex items-center gap-3 rounded-[22px] px-4 py-3 text-left text-sm"
        style={{ border: "1px solid var(--pl-line)", background: "var(--pl-card)", color: "var(--pl-ink)", cursor: "pointer" }}
      >
        <StudioIcon />
        <span className="flex flex-col gap-0.5">
          <span className="font-semibold">{switching ? l.saving : l.switchToStudio}</span>
          <span className="text-xs" style={{ color: "var(--pl-muted)" }}>
            {l.switchToStudioHint}
          </span>
        </span>
      </button>
      {error && (
        <p role="alert" className="px-4 text-xs" style={{ color: "var(--pl-accent)" }}>
          {error}
        </p>
      )}
      <Link
        href="/app/settings"
        onClick={onNavigate}
        aria-current={pathname?.startsWith("/app/settings") ? "page" : undefined}
        className="pl-rail-link"
      >
        <GearIcon />
        {l.settings}
      </Link>
    </nav>
  );
}

/**
 * Picacho Light's frame: the left rail (New chat, Recent, Switch to full
 * studio, Settings) on a desktop, a drawer behind the menu button on a
 * phone. The chat page draws its own header; any other page (Settings)
 * gets a slim top bar with the menu button and the studio's content padding.
 */
export function LightShell({
  recent,
  children,
  page,
}: {
  recent: LightRecent[];
  children: React.ReactNode;
  /** Which frame to draw; read from the path unless given. */
  page?: "chat" | "other";
}) {
  const { t } = useLocale();
  const l = t.light;
  const pathname = usePathname();
  const [menuOpen, setMenuOpen] = useState(false);
  const onChat = page ? page === "chat" : pathname === LIGHT_HOME;

  // A drawer left open behind a navigation would cover the next page.
  useEffect(() => {
    if (!menuOpen) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setMenuOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [menuOpen]);

  return (
    <ShellContext.Provider value={{ openMenu: () => setMenuOpen(true) }}>
      <div className="pl frost-ground flex h-full w-full overflow-hidden">
        <aside className="hidden w-[272px] flex-shrink-0 md:block">
          <Rail recent={recent} />
        </aside>
        {menuOpen && (
          <div className="fixed inset-0 z-50 md:hidden" role="dialog" aria-modal="true" aria-label={l.recent}>
            <button type="button" aria-label={l.closeMenu} className="absolute inset-0 bg-black/40" onClick={() => setMenuOpen(false)} />
            <div className="absolute inset-y-0 left-0 w-[86%] max-w-[320px] pt-[env(safe-area-inset-top)] shadow-xl" style={{ background: "var(--pl-rail)" }}>
              <Rail recent={recent} onNavigate={() => setMenuOpen(false)} />
            </div>
          </div>
        )}
        <div className="relative flex min-w-0 flex-1 flex-col">
          {onChat ? (
            children
          ) : pathname === "/app" ? (
            // The chat opens here in a moment (ModeGate); never flash the studio's dashboard.
            <div className="flex-1" />
          ) : (
            <>
              <header className="pl-surface flex h-14 flex-shrink-0 items-center gap-2 px-2 md:hidden">
                <button type="button" className="pl-iconbtn" aria-label={l.openMenu} onClick={() => setMenuOpen(true)}>
                  <MenuIcon />
                </button>
                <span className="pl-display text-[20px] font-semibold">Picacho</span>
              </header>
              <div data-app-scroll className="min-w-0 flex-1 overflow-y-auto">
                <div data-app-content className="mx-auto max-w-5xl px-4 py-6 pb-24 sm:px-8 sm:py-12">
                  {children}
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </ShellContext.Provider>
  );
}

/**
 * A device that never picked a look takes the one saved on the account (the
 * welcome step or Settings on another device). A device's own pick wins.
 */
export function LookSync({ look }: { look: AppLook | null }) {
  const { setTheme } = useTheme();
  useEffect(() => {
    if (!look) return;
    let stored: string | null = "unknown";
    try {
      stored = window.localStorage.getItem(THEME_STORAGE_KEY);
    } catch {
      // Storage blocked: leave the look alone.
    }
    if (stored === null) setTheme(look);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [look]);
  return null;
}

/**
 * A new account's frame until it has chosen: the page shows only where it
 * may stay (the welcome step, Settings), so the studio never flashes up
 * before ModeGate's redirect lands.
 */
export function ChoiceFrame({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  if (shellRedirect(pathname ?? "", "advanced", true)) return null;
  return <>{children}</>;
}
