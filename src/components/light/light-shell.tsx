"use client";

import "./light.css";
import Link from "next/link";
import { createContext, Fragment, useContext, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useLocale } from "@/lib/i18n/provider";
import { ACCOUNT_LOOK_SEEN_KEY, LIGHT_HOME, lightChatHref, lookToApply, shellRedirect, type AppLook, type AppMode } from "@/lib/light/mode";
import { useTheme } from "@/lib/theme/theme-provider";
import { THEME_STORAGE_KEY } from "@/lib/theme/screening";
import { saveAppChoices, searchLightTakes } from "@/lib/light/actions";
import { logout } from "@/lib/auth/actions";
import { listMyChats, searchMyChats } from "@/lib/aly-chat/actions";
import { AccountMenuButton } from "@/components/account-menu/account-menu";

export type LightRecent = { id: string; prompt: string };

const ShellContext = createContext<{ openMenu: () => void; newChat: () => void }>({
  openMenu: () => {},
  newChat: () => {},
});
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
  // The query is read in the effect (useSearchParams here would need a
  // Suspense boundary around the whole layout): Aly's card and a take's
  // link carry what the Light chat needs in it.
  useEffect(() => {
    const target = shellRedirect(pathname ?? "", mode, needsChoice, window.location.search);
    if (target) router.replace(target);
  }, [pathname, mode, needsChoice, router]);
  return null;
}

const glyph = { width: 18, height: 18, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round" as const, strokeLinejoin: "round" as const, "aria-hidden": true };

function SearchIcon() {
  return (
    <svg {...glyph}>
      <circle cx="11" cy="11" r="6.5" />
      <path d="M20 20l-4.2-4.2" />
    </svg>
  );
}
function ImagesIcon() {
  return (
    <svg {...glyph}>
      <rect x="3" y="3" width="18" height="18" rx="3" />
      <circle cx="9" cy="9" r="2" />
      <path d="M21 15l-5-5L5 21" />
    </svg>
  );
}
function LibraryIcon() {
  return (
    <svg {...glyph}>
      <rect x="3" y="3" width="7" height="7" rx="1.5" />
      <rect x="14" y="3" width="7" height="7" rx="1.5" />
      <rect x="3" y="14" width="7" height="7" rx="1.5" />
      <rect x="14" y="14" width="7" height="7" rx="1.5" />
    </svg>
  );
}
function FoldIcon() {
  return (
    <svg {...glyph} width={20} height={20}>
      <rect x="3" y="4" width="18" height="16" rx="3" />
      <path d="M9 4v16" />
    </svg>
  );
}

// Folded or open, per browser (a desk preference, like the studio's
// collapsed sidebar). Read through a store so the server render and the
// first client render agree (open) and the saved choice applies after.
const RAIL_KEY = "picacho_light_rail";
const RAIL_EVENT = "picacho-light-rail";
function subscribeRail(cb: () => void) {
  window.addEventListener(RAIL_EVENT, cb);
  return () => window.removeEventListener(RAIL_EVENT, cb);
}
function readRailFolded(): boolean {
  try {
    return window.localStorage.getItem(RAIL_KEY) === "folded";
  } catch {
    return false;
  }
}
function setRailFolded(folded: boolean) {
  try {
    window.localStorage.setItem(RAIL_KEY, folded ? "folded" : "open");
  } catch {
    // Storage blocked: the fold still holds until the next load.
  }
  window.dispatchEvent(new Event(RAIL_EVENT));
}

function RailRow({
  icon,
  label,
  folded,
  href,
  onClick,
  current,
}: {
  icon: React.ReactNode;
  label: string;
  folded: boolean;
  href?: string;
  onClick?: () => void;
  current?: boolean;
}) {
  const cls = `pl-rail-link ${folded ? "!justify-center !px-0" : ""}`;
  const inner = (
    <>
      <span className="flex h-[18px] w-[18px] flex-shrink-0 items-center justify-center">{icon}</span>
      {!folded && <span className="truncate">{label}</span>}
    </>
  );
  return href ? (
    <Link href={href} onClick={onClick} className={cls} title={folded ? label : undefined} aria-label={folded ? label : undefined} aria-current={current ? "page" : undefined}>
      {inner}
    </Link>
  ) : (
    <button type="button" onClick={onClick} className={`${cls} w-full border-0 bg-transparent text-left`} style={{ cursor: "pointer" }} title={folded ? label : undefined} aria-label={folded ? label : undefined}>
      {inner}
    </button>
  );
}

/**
 * Search chats: this person's takes by their words (each take is a chat in
 * Light's own box) and, with Aly, her chats by their names first.
 */
function SearchDialog({ onClose, alyChat }: { onClose: () => void; alyChat: boolean }) {
  const { t } = useLocale();
  const l = t.light;
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<LightRecent[] | null>(null);
  const [chats, setChats] = useState<{ id: string; title: string | null }[]>([]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  useEffect(() => {
    if (!query.trim()) return;
    let live = true;
    const timer = window.setTimeout(() => {
      Promise.all([searchLightTakes(query).catch(() => []), alyChat ? searchMyChats(query).catch(() => []) : Promise.resolve([])])
        .then(([takes, found]) => {
          if (!live) return;
          setChats(found);
          setResults(takes);
        })
        .catch(() => live && setResults([]));
    }, 250);
    return () => {
      live = false;
      window.clearTimeout(timer);
    };
  }, [query, alyChat]);

  const shown = query.trim() ? results : null;
  const heading = "px-3 pb-1 pt-2 text-xs font-semibold";
  return (
    <div className="pl fixed inset-0 z-[60] flex items-start justify-center px-4 pt-[12vh]" role="dialog" aria-modal="true" aria-label={l.searchChats}>
      <button type="button" aria-label={l.closeMenu} className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="pl-surface relative w-full max-w-[560px] overflow-hidden rounded-[22px] shadow-2xl" style={{ border: "1px solid var(--pl-line)" }}>
        <div className="flex items-center gap-3 px-5 py-4" style={{ borderBottom: "1px solid var(--pl-line)" }}>
          <SearchIcon />
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={alyChat ? l.searchBoth : l.searchPlaceholder}
            aria-label={l.searchChats}
            className="min-w-0 flex-grow border-0 bg-transparent text-[16px] outline-none"
            style={{ color: "var(--pl-ink)" }}
          />
        </div>
        <div className="max-h-[50vh] overflow-y-auto p-2">
          {shown === null ? null : shown.length === 0 && chats.length === 0 ? (
            <p className="px-3 py-3 text-sm" style={{ color: "var(--pl-muted)" }}>
              {l.searchNone}
            </p>
          ) : (
            <>
              {chats.length > 0 && (
                <>
                  <p className={heading} style={{ color: "var(--pl-muted)" }}>
                    {l.chatsHeading}
                  </p>
                  {chats.map((c) => (
                    <Link key={c.id} href={lightChatHref(c.id)} onClick={onClose} className="pl-rail-link">
                      <span className="truncate">{c.title || "…"}</span>
                    </Link>
                  ))}
                </>
              )}
              {alyChat && shown.length > 0 && (
                <p className={heading} style={{ color: "var(--pl-muted)" }}>
                  {l.takesHeading}
                </p>
              )}
              {shown.map((r) => (
                <Link key={r.id} href={`${LIGHT_HOME}?take=${r.id}`} onClick={onClose} className="pl-rail-link">
                  <span className="truncate">{r.prompt || "…"}</span>
                </Link>
              ))}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * The Settings row's menu (operator, 2026-09-28: "Settings icon should have a
 * drop down menu"): the look, the account pages, help, the way to the full
 * studio, and log out.
 */
function SettingsMenu({ isAdmin, onClose, onNavigate }: { isAdmin: boolean; onClose: () => void; onNavigate?: () => void }) {
  const { t } = useLocale();
  const l = t.light;
  const { theme, setTheme } = useTheme();
  const ref = useRef<HTMLDivElement>(null);
  const [switching, setSwitching] = useState(false);
  const [error, setError] = useState("");
  const router = useRouter();

  useEffect(() => {
    const onDown = (e: PointerEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("pointerdown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("pointerdown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  function pickLook(look: AppLook) {
    setTheme(look);
    void saveAppChoices({ look }).catch(() => {});
  }

  async function switchToStudio() {
    setSwitching(true);
    setError("");
    const res = await saveAppChoices({ mode: "advanced" });
    if (res.error) {
      setError(l.saveFailed);
      setSwitching(false);
      return;
    }
    onClose();
    onNavigate?.();
    router.replace("/app");
    router.refresh();
  }

  const row = "pl-rail-link !py-2.5";
  const go = () => {
    onClose();
    onNavigate?.();
  };
  const looks: { value: AppLook; label: string }[] = [
    { value: "light", label: l.lookLight },
    { value: "dark", label: l.lookDark },
    { value: "system", label: l.lookSystem },
  ];

  return (
    <div
      ref={ref}
      role="menu"
      className="pl-surface absolute bottom-full left-0 z-50 mb-2 w-[260px] rounded-[20px] p-2 shadow-2xl"
      style={{ border: "1px solid var(--pl-line)", background: "var(--pl-card)" }}
    >
      <p className="px-3 pb-1.5 pt-1 text-xs font-semibold" style={{ color: "var(--pl-muted)" }}>
        {l.look}
      </p>
      <div className="pl-seg mx-1 mb-1">
        {looks.map((o) => (
          <button key={o.value} type="button" aria-pressed={theme === o.value} onClick={() => pickLook(o.value)} className="!h-8 flex-1 !px-2 !text-[12px]">
            {o.label}
          </button>
        ))}
      </div>
      <div className="my-1.5 h-px" style={{ background: "var(--pl-line)" }} />
      <Link href="/app/settings" onClick={go} className={row} role="menuitem">
        <GearIcon />
        {t.nav.settings}
      </Link>
      <Link href="/app/settings?tab=billing" onClick={go} className={row} role="menuitem">
        <svg {...glyph}>
          <rect x="3" y="6" width="18" height="13" rx="2" />
          <path d="M3 10h18M7 15h3" />
        </svg>
        {t.settingsHub.tabBilling}
      </Link>
      <Link href="/app/settings?tab=help" onClick={go} className={row} role="menuitem">
        <svg {...glyph}>
          <circle cx="12" cy="12" r="9" />
          <path d="M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .9-1 1.6M12 17h.01" />
        </svg>
        {t.settings.help}
      </Link>
      {isAdmin && (
        <Link href="/admin" onClick={go} className={row} role="menuitem">
          <StudioIcon />
          {t.nav.admin}
        </Link>
      )}
      <button type="button" role="menuitem" onClick={() => void switchToStudio()} disabled={switching} className={`${row} w-full border-0 bg-transparent text-left`} style={{ cursor: "pointer" }}>
        <StudioIcon />
        {switching ? l.saving : l.switchToStudio}
      </button>
      {error && (
        <p role="alert" className="px-3 text-xs" style={{ color: "var(--pl-accent)" }}>
          {error}
        </p>
      )}
      <div className="my-1.5 h-px" style={{ background: "var(--pl-line)" }} />
      <form action={logout}>
        <button type="submit" role="menuitem" className={`${row} w-full border-0 bg-transparent text-left`} style={{ cursor: "pointer", color: "#d9534f" }}>
          <svg {...glyph}>
            <path d="M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3M10 17l5-5-5-5M15 12H4" />
          </svg>
          {t.settings.logOut}
        </button>
      </form>
    </div>
  );
}

/**
 * Aly's chats for the rail, newest first (the same list as her own page's
 * sidebar), refreshed when a chat is started, named, renamed or deleted.
 */
function useAlyChats(on: boolean): { id: string; title: string | null }[] | null {
  const [chats, setChats] = useState<{ id: string; title: string | null }[] | null>(null);
  useEffect(() => {
    if (!on) return;
    let live = true;
    const load = () =>
      listMyChats()
        .then((rows) => live && setChats(rows))
        .catch(() => {});
    load();
    window.addEventListener("aly-chats-changed", load);
    return () => {
      live = false;
      window.removeEventListener("aly-chats-changed", load);
    };
  }, [on]);
  return chats;
}

function Rail({
  recent,
  alyChat,
  isAdmin,
  folded,
  inDrawer,
  onNavigate,
}: {
  recent: LightRecent[];
  alyChat: boolean;
  isAdmin: boolean;
  folded: boolean;
  inDrawer?: boolean;
  onNavigate?: () => void;
}) {
  const { t } = useLocale();
  const l = t.light;
  const { newChat } = useLightShell();
  const pathname = usePathname();
  const params = useSearchParams();
  const activeTake = pathname === LIGHT_HOME ? params.get("take") : null;
  const activeChat = pathname === LIGHT_HOME ? params.get("chat") : null;
  const chats = useAlyChats(alyChat);
  const [searching, setSearching] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <nav aria-label={l.recent} className="pl-surface flex h-full min-h-0 flex-col gap-1 px-3 py-4" style={{ background: "var(--pl-rail)" }}>
      <div className={`mb-2 flex ${folded ? "justify-center" : "justify-start"}`}>
        <button
          type="button"
          className="pl-iconbtn"
          aria-label={inDrawer ? l.closeMenu : folded ? l.unfoldMenu : l.foldMenu}
          title={inDrawer ? l.closeMenu : folded ? l.unfoldMenu : l.foldMenu}
          onClick={() => (inDrawer ? onNavigate?.() : setRailFolded(!folded))}
        >
          {inDrawer ? <MenuIcon /> : <FoldIcon />}
        </button>
      </div>
      <RailRow
        folded={folded}
        icon={<PlusIcon size={18} />}
        label={l.newChat}
        onClick={() => {
          newChat();
          onNavigate?.();
        }}
      />
      <RailRow folded={folded} icon={<SearchIcon />} label={l.searchChats} onClick={() => setSearching(true)} />
      <RailRow folded={folded} icon={<ImagesIcon />} label={l.images} href="/app/images" onClick={onNavigate} current={pathname === "/app/images"} />
      <RailRow folded={folded} icon={<LibraryIcon />} label={l.library} href="/app/media" onClick={onNavigate} current={pathname === "/app/media"} />
      {!folded && (
        <>
          <div className="mt-5 px-4 pb-1 text-[13px] font-semibold" style={{ color: "var(--pl-muted)" }}>
            {l.recent}
          </div>
          {alyChat ? (
            <div className="flex min-h-0 flex-col gap-0.5 overflow-y-auto">
              {chats !== null && chats.length === 0 && (
                <p className="px-4 py-2 text-[13px]" style={{ color: "var(--pl-muted)" }}>
                  {l.noChats}
                </p>
              )}
              {(chats ?? []).map((c) => (
                <Link key={c.id} href={lightChatHref(c.id)} onClick={onNavigate} aria-current={activeChat === c.id ? "page" : undefined} className="pl-rail-link">
                  <span className="truncate">{c.title || "…"}</span>
                </Link>
              ))}
            </div>
          ) : (
          <div className="flex min-h-0 flex-col gap-0.5 overflow-y-auto">
            {recent.length === 0 && (
              <p className="px-4 py-2 text-[13px]" style={{ color: "var(--pl-muted)" }}>
                {l.noRecent}
              </p>
            )}
            {recent.map((r) => (
              <Link key={r.id} href={`${LIGHT_HOME}?take=${r.id}`} onClick={onNavigate} aria-current={activeTake === r.id ? "page" : undefined} className="pl-rail-link">
                <span className="truncate">{r.prompt || "…"}</span>
              </Link>
            ))}
          </div>
          )}
        </>
      )}
      <div className="flex-grow" />
      <div className="relative">
        {menuOpen && <SettingsMenu isAdmin={isAdmin} onClose={() => setMenuOpen(false)} onNavigate={onNavigate} />}
        <RailRow folded={folded} icon={<GearIcon />} label={l.settings} onClick={() => setMenuOpen((v) => !v)} />
      </div>
      {searching && <SearchDialog alyChat={alyChat} onClose={() => setSearching(false)} />}
    </nav>
  );
}

/**
 * Picacho Light's frame: the left rail (fold, New chat, Search chats, Images,
 * Library, Recent, Settings with its menu) on a desktop, a drawer behind the
 * menu button on a phone. The chat page draws its own header; any other
 * page gets a slim top bar with the menu button and the studio's padding.
 */
export function LightShell({
  recent,
  alyChat = false,
  isAdmin = false,
  initial = "?",
  children,
  page,
}: {
  recent: LightRecent[];
  /** Aly's chat is open: she is Light's chat, and the rail lists her chats. */
  alyChat?: boolean;
  isAdmin?: boolean;
  /** The account button's letter, as the chat's top bar draws it. */
  initial?: string;
  children: React.ReactNode;
  /** Which frame to draw; read from the path unless given. */
  page?: "chat" | "other";
}) {
  const { t } = useLocale();
  const l = t.light;
  const pathname = usePathname();
  const params = useSearchParams();
  const router = useRouter();
  const [menuOpen, setMenuOpen] = useState(false);
  // New chat remounts the chat even when the address is already /app/light.
  const [chatNonce, setChatNonce] = useState(0);
  const folded = useSyncExternalStore(subscribeRail, readRailFolded, () => false);
  const onChat = page ? page === "chat" : pathname === LIGHT_HOME;

  function newChat() {
    setChatNonce((n) => n + 1);
    if (pathname !== LIGHT_HOME || window.location.search) router.push(LIGHT_HOME);
  }

  useEffect(() => {
    if (!menuOpen) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setMenuOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [menuOpen]);

  return (
    <ShellContext.Provider value={{ openMenu: () => setMenuOpen(true), newChat }}>
      <div className="pl frost-ground relative flex h-full w-full overflow-hidden">
        <aside className={`hidden flex-shrink-0 transition-[width] duration-200 md:block ${folded ? "w-[72px]" : "w-[272px]"}`}>
          <Rail recent={recent} alyChat={alyChat} isAdmin={isAdmin} folded={folded} />
        </aside>
        {menuOpen && (
          // Sized to the Light frame, not the screen (operator, 2026-09-28,
          // iOS app: "When I open the menu I cant access the settings icon.
          // Its buried below the bottom edge screen"). The iOS shell insets
          // the page (contentInset "always"), so a screen-fixed drawer ran
          // past the visible bottom while the frame, like the chat box,
          // stays on screen. light.css keeps it clear of the notch and the
          // home indicator on a phone's browser.
          <div className="absolute inset-0 z-[80] md:hidden" role="dialog" aria-modal="true" aria-label={l.recent}>
            <button type="button" aria-label={l.closeMenu} className="absolute inset-0 bg-black/40" onClick={() => setMenuOpen(false)} />
            <div className="pl-drawer absolute inset-y-0 left-0 flex w-[86%] max-w-[320px] flex-col shadow-xl" style={{ background: "var(--pl-rail)" }}>
              <Rail recent={recent} alyChat={alyChat} isAdmin={isAdmin} folded={false} inDrawer onNavigate={() => setMenuOpen(false)} />
            </div>
          </div>
        )}
        <div className="relative flex min-w-0 flex-1 flex-col">
          {onChat ? (
            <Fragment key={chatNonce}>{children}</Fragment>
          ) : shellRedirect(pathname ?? "", "light", false, params.toString()) ? (
            // The chat opens here in a moment (ModeGate); never flash the
            // studio's dashboard, composer or take page on the way.
            <div className="flex-1" />
          ) : (
            <>
              {/* The chat's own top bar on every Light page (2026-09-29 check:
                  Images, Library, History and Settings had no logo on a
                  computer, and on a phone no Light badge or account). */}
              <LightPageBar initial={initial} onMenu={() => setMenuOpen(true)} onHome={newChat} />
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
 * The top bar of a Light page that isn't the chat (Images, Library, History,
 * Settings): the chat's own logo, badge and account button, with the menu
 * button on a phone. The logo starts a new chat, as the chat's does.
 */
function LightPageBar({ initial, onMenu, onHome }: { initial: string; onMenu: () => void; onHome: () => void }) {
  const { t } = useLocale();
  const l = t.light;
  return (
    <header className="relative flex h-14 flex-shrink-0 items-center justify-between px-2 md:h-[68px] md:px-6" style={{ color: "var(--pl-ink)" }}>
      <button type="button" className="pl-iconbtn md:hidden" aria-label={l.openMenu} onClick={onMenu}>
        <MenuIcon />
      </button>
      <Link
        href={LIGHT_HOME}
        onClick={(e) => {
          e.preventDefault();
          onHome();
        }}
        className="flex items-center gap-2 md:gap-2.5"
        style={{ color: "var(--pl-ink)", textDecoration: "none" }}
      >
        <span className="pl-display text-[20px] font-semibold md:text-[22px]">Picacho</span>
        <span className="rounded-[10px] px-2 py-0.5 text-[11px] font-semibold md:px-[9px] md:py-[3px] md:text-xs" style={{ color: "var(--pl-muted)", background: "var(--pl-rail)" }}>
          {l.badge}
        </span>
      </Link>
      <AccountMenuButton label={l.account} className="flex h-11 w-11 items-center justify-center md:h-10 md:w-10">
        <span className="flex h-[34px] w-[34px] items-center justify-center rounded-full text-sm font-semibold text-white md:h-10 md:w-10 md:text-[15px]" style={{ background: "#a84e24" }}>
          {initial}
        </span>
      </AccountMenuButton>
    </header>
  );
}

/**
 * Keeps this device's look in step with the one saved on the account
 * (lookToApply in lib/light/mode.ts has the rule): a device that never
 * picked takes it, and a CHANGE to it (an admin set it, or the person saved
 * a new one elsewhere) applies once over the device's own pick.
 */
export function LookSync({ look }: { look: AppLook | null }) {
  const { setTheme } = useTheme();
  useEffect(() => {
    if (!look) return;
    try {
      const next = lookToApply(
        look,
        window.localStorage.getItem(THEME_STORAGE_KEY),
        window.localStorage.getItem(ACCOUNT_LOOK_SEEN_KEY),
      );
      window.localStorage.setItem(ACCOUNT_LOOK_SEEN_KEY, look);
      if (next) setTheme(next);
    } catch {
      // Storage blocked: leave the look alone.
    }
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
