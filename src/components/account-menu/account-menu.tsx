"use client";

import "./account-menu.css";
import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/cn";
import { useLocale } from "@/lib/i18n/provider";
import { formatMsg } from "@/lib/i18n/format";
import { PLAN_LABELS } from "@/lib/plans";
import { settingsHref } from "@/lib/settings/tabs";
import { creditSegments, type AccountMenuData } from "@/lib/account-menu/shape";

// The account menu (operator, 2026-10-02: "a dropdown menu that appears when
// clicking on the credits or the name of the user ... like higgsfield"; "Go
// with B, build it. Give an animation to the progress bar"). Draft B, "The
// Ledger": claude.ai/artifact/UojgUj9wjy7Yjk46UBRCGh. One menu for every way
// in — the sidebar's name, the phone bar's credits, the Generate header's
// credits, Light's pill and letter — so its numbers are read once, here.

type Load = "idle" | "loading" | "ready" | "error";

type Ctx = {
  data: AccountMenuData | null;
  open: boolean;
  /** Opens the menu under (or over) this element, or closes it when it is already open from there. */
  toggle: (el: HTMLElement) => void;
};

const AccountMenuContext = createContext<Ctx | null>(null);

/** Null outside a provider (a page rendered on its own): triggers then render as plain text. */
export function useAccountMenu(): Ctx | null {
  return useContext(AccountMenuContext);
}

/** Older than this, the numbers are read again when the page or the tab changes. */
const STALE_MS = 30_000;

export function AccountMenuProvider({ children }: { children: ReactNode }) {
  const [data, setData] = useState<AccountMenuData | null>(null);
  const [load, setLoad] = useState<Load>("idle");
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const readAt = useRef(0);
  const inFlight = useRef<Promise<void> | null>(null);
  const pathname = usePathname();

  const refresh = useCallback((force = false) => {
    if (inFlight.current) return inFlight.current;
    if (!force && Date.now() - readAt.current < STALE_MS) return Promise.resolve();
    setLoad((l) => (l === "ready" ? l : "loading"));
    const p = fetch("/api/account/menu", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((j: { ok: boolean; menu?: AccountMenuData }) => {
        if (!j.ok || !j.menu) throw new Error("no menu");
        setData(j.menu);
        setLoad("ready");
        readAt.current = Date.now();
      })
      .catch(() => setLoad((l) => (l === "ready" ? l : "error")))
      .finally(() => {
        inFlight.current = null;
      });
    inFlight.current = p;
    return p;
  }, []);

  // First read once the page has settled; again on a new page or a returning
  // tab when the last read is old (a render elsewhere may have spent some).
  useEffect(() => {
    const id = window.setTimeout(() => void refresh(), 600);
    return () => window.clearTimeout(id);
  }, [refresh, pathname]);
  useEffect(() => {
    const onVisible = () => document.visibilityState === "visible" && void refresh();
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [refresh]);

  // A new page closes it: the anchor holds only on the page it was opened on.
  const [openedOn, setOpenedOn] = useState(pathname);
  const shown = openedOn === pathname ? anchor : null;

  const toggle = useCallback(
    (el: HTMLElement) => {
      setOpenedOn(pathname);
      setAnchor((cur) => (cur === el && openedOn === pathname ? null : el));
      void refresh(true);
    },
    [refresh, pathname, openedOn],
  );

  return (
    <AccountMenuContext.Provider value={{ data, open: shown !== null, toggle }}>
      {children}
      {shown && (
        <AccountMenuPanel
          anchor={shown}
          data={data}
          load={load}
          onRetry={() => void refresh(true)}
          onClose={(refocus) => {
            setAnchor(null);
            if (refocus) shown.focus();
          }}
        />
      )}
    </AccountMenuContext.Provider>
  );
}

const MENU_W = 312;
const GAP = 8;
const EDGE = 12;

type Pos = { left: number; width: number; top?: number; bottom?: number; maxHeight: number; up: boolean };

function place(el: HTMLElement): Pos {
  const r = el.getBoundingClientRect();
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const width = Math.min(MENU_W, vw - EDGE * 2);
  // Right-hand triggers (the top bars) hang the menu from their right edge.
  const fromRight = r.left + r.width / 2 > vw / 2;
  const left = Math.min(Math.max(EDGE, fromRight ? r.right - width : r.left), vw - width - EDGE);
  const up = r.top > vh / 2;
  return up
    ? { left, width, bottom: vh - r.top + GAP, maxHeight: r.top - GAP - EDGE, up }
    : { left, width, top: r.bottom + GAP, maxHeight: vh - r.bottom - GAP - EDGE, up };
}

function AccountMenuPanel({
  anchor,
  data,
  load,
  onRetry,
  onClose,
}: {
  anchor: HTMLElement;
  data: AccountMenuData | null;
  load: Load;
  onRetry: () => void;
  onClose: (refocus: boolean) => void;
}) {
  const { t, locale } = useLocale();
  const m = t.accountMenu;
  const h = t.settingsHub;
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<Pos | null>(null);
  const light = anchor.closest(".pl") !== null;

  useLayoutEffect(() => {
    const update = () => setPos(place(anchor));
    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, [anchor]);

  useEffect(() => {
    const onDown = (e: PointerEvent) => {
      const target = e.target as Node;
      if (ref.current?.contains(target) || anchor.contains(target)) return;
      onClose(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose(true);
    };
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [anchor, onClose]);

  // Focus the menu so Tab walks its links; Escape hands focus back.
  useEffect(() => {
    ref.current?.focus({ preventScroll: true });
  }, []);

  if (!pos) return null;

  const dateOf = (iso: string | null) =>
    iso ? new Date(iso).toLocaleDateString(locale, { day: "numeric", month: "short", timeZone: "UTC" }) : null;

  return createPortal(
    <div
      ref={ref}
      role="dialog"
      aria-label={m.open}
      tabIndex={-1}
      style={
        {
          left: pos.left,
          width: pos.width,
          top: pos.top,
          bottom: pos.bottom,
          maxHeight: pos.maxHeight,
          "--am-from": pos.up ? "4px" : "-4px",
        } as React.CSSProperties
      }
      className={cn(
        "am fixed z-50 overflow-y-auto overscroll-contain rounded-[10px] text-[13px] outline-none",
        light && "pl",
      )}
    >
      {!data ? (
        <div className="flex flex-col items-start gap-2 px-4 py-5 text-[var(--am-muted)]">
          {load === "error" ? (
            <>
              <span>{m.failed}</span>
              <button type="button" onClick={onRetry} className="text-[var(--am-ink)] underline underline-offset-2">
                {m.retry}
              </button>
            </>
          ) : (
            <span>{m.reading}</span>
          )}
        </div>
      ) : (
        <Ledger data={data} m={m} h={h} locale={locale} dateOf={dateOf} />
      )}
    </div>,
    document.body,
  );
}

type M = ReturnType<typeof useLocale>["t"]["accountMenu"];
type H = ReturnType<typeof useLocale>["t"]["settingsHub"];

const SEC = "border-t border-[var(--am-rule)] px-3.5 py-3 first:border-t-0";
const SLATE = "text-[10px] font-medium uppercase tracking-widest text-[var(--am-muted)]";
const NOTE = "text-[11.5px] text-[var(--am-muted)]";

function Ledger({
  data,
  m,
  h,
  locale,
  dateOf,
}: {
  data: AccountMenuData;
  m: M;
  h: H;
  locale: string;
  dateOf: (iso: string | null) => string | null;
}) {
  const c = data.credits;
  const planName = data.plan === "none" ? "" : PLAN_LABELS[data.plan];
  const resets = c.mode === "plan" ? dateOf(c.resetsOn) : null;
  const subtitle =
    data.status === "none"
      ? m.noPlan
      : data.status === "active" && resets
        ? formatMsg(m.renews, { plan: planName, date: resets })
        : formatMsg(m[data.status === "active" ? "active" : data.status], { plan: planName });
  const n = (v: number) => v.toLocaleString(locale);
  const label: Record<AccountMenuData["allowances"][number]["key"], string> = {
    helios: h.allowHelios,
    photos: h.allowPhotos,
    assists: h.allowAssists,
    assistant: h.allowAssistant,
  };
  const about = data.about;
  const tiles = about
    ? ([
        [about.pictures, m.pictures],
        [about.quick, m.quickVideos],
        [about.hd, m.hdVideos],
      ].filter(([v]) => v !== null) as [number, string][])
    : [];
  const canUpgrade = data.plan !== "elite";

  return (
    <>
      {/* Who */}
      <div className={SEC}>
        <div className="flex items-center gap-2.5">
          <span
            className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full text-base font-semibold"
            style={{ background: "var(--am-avatar)", color: "#fff" }}
          >
            {data.initial}
          </span>
          <span className="flex min-w-0 flex-col leading-tight">
            <span className="truncate text-sm font-semibold">{data.name}</span>
            <span className="truncate text-xs text-[var(--am-muted)]">{subtitle}</span>
          </span>
        </div>
      </div>

      {/* Credits */}
      {c.mode === "plan" ? (
        <div className={cn(SEC, "flex flex-col gap-2")}>
          <div className="flex items-baseline justify-between gap-2">
            <span className={SLATE}>{m.credits}</span>
            {c.extra > 0 && c.limit > 0 && (
              <span className={NOTE}>{formatMsg(m.planPlusExtra, { plan: n(c.left), extra: n(c.extra) })}</span>
            )}
          </div>
          <div className="flex items-baseline gap-2">
            <CountUp
              value={c.spendable}
              locale={locale}
              className="text-[34px] leading-[0.95] tabular-nums text-[var(--am-accent)]"
            />
            <span className="text-[12.5px] text-[var(--am-muted)]">{m.toSpend}</span>
          </div>
          <SegmentBar left={c.left} limit={c.limit} extra={c.extra} />
          <div className="flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-[var(--am-muted)]">
            {(c.limit > 0 || c.paused) && (
              <span className="inline-flex items-center gap-1.5">
                <i className="inline-block h-2 w-2 rounded-[2px]" style={{ background: "var(--am-accent)" }} />
                {c.paused
                  ? m.legendPlanPaused
                  : resets
                    ? formatMsg(m.legendPlan, { limit: n(c.limit), date: resets })
                    : m.legendPlanNoDate}
              </span>
            )}
            {c.extra > 0 && (
              <span className="inline-flex items-center gap-1.5">
                <i className="inline-block h-2 w-2 rounded-[2px]" style={{ background: "var(--am-extra)" }} />
                {m.legendExtra}
              </span>
            )}
          </div>
        </div>
      ) : (
        <div className={cn(SEC, "flex flex-col gap-2")}>
          <span className={SLATE}>{m.freeDaily}</span>
          <div className="flex items-baseline gap-2">
            <CountUp value={c.slotOpen ? 1 : 0} locale={locale} className="text-[34px] leading-[0.95] tabular-nums text-[var(--am-accent)]" />
            <span className="text-[12.5px] text-[var(--am-muted)]">{c.slotOpen ? h.freeDailyOpen : h.freeDailyUsed}</span>
          </div>
          {c.extra > 0 && <span className={NOTE}>{formatMsg(m.extraCredits, { n: n(c.extra) })}</span>}
        </div>
      )}

      {/* That's about */}
      {tiles.length > 0 && (
        <div className={cn(SEC, "flex flex-col gap-2")}>
          <span className={SLATE}>{m.thatsAbout}</span>
          <div className="grid gap-1.5" style={{ gridTemplateColumns: `repeat(${tiles.length}, minmax(0, 1fr))` }}>
            {tiles.map(([v, l]) => (
              <div key={l} className="rounded-md border border-[var(--am-rule)] px-1.5 py-[7px] text-center">
                <b className="block text-[17px] font-medium tabular-nums" style={{ fontFamily: "var(--am-num)" }}>
                  {n(v)}
                </b>
                <span className="text-[10.5px] text-[var(--am-muted)]">{l}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Also this month */}
      {data.allowances.length > 0 && (
        <div className={cn(SEC, "flex flex-col gap-2.5")}>
          <span className={SLATE}>{data.lifetime ? m.freeToTry : m.alsoThisMonth}</span>
          <div className="grid grid-cols-2 gap-x-3.5 gap-y-2.5">
            {data.allowances.map((a, i) => {
              const value =
                a.left === null || a.cap === null
                  ? h.unlimited
                  : a.asPercent
                    ? formatMsg(h.pctLeft, { pct: Math.round((a.left / Math.max(1, a.cap)) * 100) })
                    : formatMsg(h.leftOf, { left: a.left, cap: a.cap });
              return (
                <div key={a.key} className="flex min-w-0 flex-col gap-1">
                  <span className="truncate text-[11px] text-[var(--am-muted)]">{label[a.key]}</span>
                  <span className="text-[14px] tabular-nums" style={{ fontFamily: "var(--am-num)" }}>
                    {value}
                  </span>
                  {a.left !== null && a.cap !== null && (
                    <div className="am-mini" style={{ "--i": i } as React.CSSProperties}>
                      <i style={{ width: `${a.cap > 0 ? Math.min(100, (a.left / a.cap) * 100) : 0}%` }} />
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Upgrade · Buy credits — web only (store rules) */}
      {data.canBuy && (
        <div className={SEC}>
          <div className={cn("grid gap-2", canUpgrade ? "grid-cols-2" : "grid-cols-1")}>
            {canUpgrade && (
              <Link
                href={settingsHref("billing")}
                className="rounded-md border border-[var(--am-solid)] bg-[var(--am-solid)] px-2 py-[7px] text-center text-[12.5px] font-semibold text-[var(--am-solid-ink)] transition-opacity hover:opacity-90"
              >
                {data.plan === "none" ? m.seePlans : m.upgrade}
              </Link>
            )}
            <Link
              href={settingsHref("billing", "buy")}
              className="rounded-md border border-[var(--am-rule)] px-2 py-[7px] text-center text-[12.5px] font-semibold transition-colors hover:bg-[var(--am-hover)]"
            >
              {m.buyCredits}
            </Link>
          </div>
        </div>
      )}

      {/* Links */}
      <div className="border-t border-[var(--am-rule)] p-1.5">
        <MenuLink href={settingsHref("billing")}>{m.plansBilling}</MenuLink>
        <MenuLink href={settingsHref("overview")}>{m.usage}</MenuLink>
        {/* No Log out here (operator, 2026-10-02: "Its already in the settings
            button. Its like we are pushing the user to leave"): the gear's menu has it. */}
      </div>
    </>
  );
}

function MenuLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link href={href} className="flex items-center rounded-md px-2 py-[7px] transition-colors hover:bg-[var(--am-hover)]">
      {children}
      <span aria-hidden className="ml-auto text-[11px] text-[var(--am-muted)]">
        ›
      </span>
    </Link>
  );
}

/** The Ledger's bar: plan left (ochre), plan spent (empty), extra (pale), sweeping in on open. */
function SegmentBar({ left, limit, extra }: { left: number; limit: number; extra: number }) {
  const segs = creditSegments(left, limit, extra);
  const edge = segs.lastIndexOf("plan");
  return (
    <div className="flex gap-[3px]" role="img" aria-label={`${left + extra}`}>
      {segs.map((kind, i) => (
        <span
          key={i}
          className="am-seg"
          data-kind={kind}
          data-edge={i === edge ? "" : undefined}
          style={{ "--i": i } as React.CSSProperties}
        >
          {kind !== "used" && <i />}
        </span>
      ))}
    </div>
  );
}

/** The balance counts up as the bar fills (none with reduced motion). */
function CountUp({ value, locale, className }: { value: number; locale: string; className?: string }) {
  const [still] = useState(() => typeof window === "undefined" || window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  const [counted, setShown] = useState(0);
  const shown = still || value <= 0 ? value : counted;
  useEffect(() => {
    if (still || value <= 0) return;
    const start = performance.now();
    const ms = 700;
    let raf = 0;
    const step = (now: number) => {
      const p = Math.min(1, (now - start - 120) / ms);
      const eased = p <= 0 ? 0 : 1 - Math.pow(1 - p, 3);
      setShown(Math.round(value * eased));
      if (p < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    // A background tab pauses animation frames: the true figure lands anyway.
    const settle = window.setTimeout(() => setShown(value), 120 + ms + 200);
    return () => {
      cancelAnimationFrame(raf);
      window.clearTimeout(settle);
    };
  }, [value, still]);
  return (
    <span className={className} style={{ fontFamily: "var(--am-num)" }}>
      {shown.toLocaleString(locale)}
    </span>
  );
}

/**
 * A way into the menu: wraps whatever the frame draws there (the sidebar's
 * name, a credits figure, the avatar). Outside a provider it renders the
 * children as they are, so a page shown on its own keeps its look.
 */
export function AccountMenuButton({
  children,
  className,
  style,
  label,
  spot,
}: {
  children: ReactNode;
  className?: string;
  style?: React.CSSProperties;
  label?: string;
  /** Where the assistant can point (lib/producer/spots.ts). */
  spot?: string;
}) {
  const menu = useAccountMenu();
  const { t } = useLocale();
  const ref = useRef<HTMLButtonElement>(null);
  if (!menu) {
    return (
      <span className={className} style={style} data-producer-spot={spot}>
        {children}
      </span>
    );
  }
  return (
    <button
      ref={ref}
      type="button"
      aria-haspopup="dialog"
      aria-expanded={menu.open}
      aria-label={label ?? t.accountMenu.open}
      onClick={() => ref.current && menu.toggle(ref.current)}
      className={cn("cursor-pointer", className)}
      style={style}
      data-producer-spot={spot}
    >
      {children}
    </button>
  );
}

/**
 * The balance a trigger shows beside the name: what a send may spend. Nothing
 * until it is read, and nothing for a free account without extra credits (its
 * daily render is not a balance; "0 credits" would say it has none).
 */
export function useMenuCredits(): number | null {
  const d = useAccountMenu()?.data;
  if (!d) return null;
  if (d.credits.mode === "plan") return d.credits.spendable;
  return d.credits.extra > 0 ? d.credits.extra : null;
}
