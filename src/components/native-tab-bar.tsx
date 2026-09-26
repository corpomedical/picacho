"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useId, useRef, useState, type SVGProps } from "react";
import { isNativeAppClient } from "@/lib/native/platform";
import { useBackCloser } from "@/lib/native/back-stack";
import { useLocale } from "@/lib/i18n/provider";
import { cn } from "@/lib/cn";
import { NAV_TOOLS, SEEN_STORAGE_KEY, isToolNew, localDay, parseToolKeys } from "@/lib/nav/tools";
import {
  CONTENT_TYPE_EVENT,
  DIRECTORS_CUT_HREF,
  GENERATE_HREF,
  GENERATE_VIDEO_HREF,
  LIVE_HREF,
  NATIVE_TAB_HREF,
  PRESS_TOUR_HREF,
  RECAST_HREF,
  nativeTabFor,
  type NativeTab,
} from "@/lib/native/tab-routes";

// Bottom tab bar, shown only inside the iOS/Android apps.
//
// This is the single change that stops the app reading as a website. A left
// sidebar is a desktop-web pattern; nothing on a phone navigates that way, and
// a reviewer opening the app sees "this is a web page" before reading a word.
// Tabs fixed to the bottom edge, thumb-reachable, with the current section
// lit — that's what every app the person already uses looks like.
//
// THE PROJECTOR (2026-09-21, operator: "put generate in the middle on a 3d
// glowing circle. When clicking the generate button two options appear with a
// cool effect", then "Projector" from eight judged directions). Seven places,
// three either side of the lamp: Home · Characters · Media · the Generate
// lamp · Community · History · More (Home and History added the same day:
// "Add another button on the left as home that will take you to dashboard.
// Add history beside community"). Settings and the tools live inside More;
// lib/native/tab-routes.ts says which tab owns which page.
//
// The lamp is a small graphite lens set into the bar with a tungsten bolt
// behind its glass. For accounts that can open Recast it opens two choices:
// the page behind dims, a soft beam rises from the lamp, and both choices are
// projected onto one small screen that lands slightly keystoned, flickers
// like a film leader for a beat and squares up. Transform and opacity only,
// nothing animates at rest, and the text is rasterised once. Everyone else
// has one choice, so the lamp goes straight to Generate. Recast stays behind
// the same admin gate as its sidebar entry until the operator opens it.
// LIVE (2026-09-24) is the third exposure, for every paid plan: the screen
// opens whenever either door beyond Generate Video is open to the account.
// PRESS TOUR (2026-09-26) sits beside Generate Video and Recast, admins
// first, and wears the sidebar's New dot while its window is open.
//
// Rendered from the web app rather than built natively, so it stays in step
// with the rest of the UI automatically. The look lives in globals.css under
// "The app bar — the projector".

function HomeIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <path d="M3 10.5 12 3l9 7.5" />
      <path d="M5 9.5V21h14V9.5" />
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

function CommunityIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <circle cx="9" cy="8" r="3.2" />
      <path d="M3 20a6 6 0 0 1 12 0" />
      <path d="M16 6.5a3 3 0 0 1 0 6" />
      <path d="M21 20a5.5 5.5 0 0 0-4-5.3" />
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

function MoreIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <rect x="3.5" y="3.5" width="7" height="7" rx="1.75" />
      <rect x="13.5" y="3.5" width="7" height="7" rx="1.75" />
      <rect x="3.5" y="13.5" width="7" height="7" rx="1.75" />
      <rect x="13.5" y="13.5" width="7" height="7" rx="1.75" />
    </svg>
  );
}

function FilmIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <rect x="3" y="5" width="18" height="14" rx="2.5" />
      <path d="M3 9h2.5M3 15h2.5M18.5 9H21M18.5 15H21" />
      <path d="m10.2 9.4 4.4 2.6-4.4 2.6Z" />
    </svg>
  );
}

// The sidebar's Recast glyph: a person, and their recast double in dashes.
function RecastIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <circle cx="8.5" cy="8" r="3.2" />
      <path d="M2.5 19.5c.6-3.4 3-5.5 6-5.5 1.2 0 2.3.3 3.2.9" />
      <circle cx="16.5" cy="10" r="2.7" strokeDasharray="2.2 2.2" />
      <path d="M11.5 20c.5-2.9 2.5-4.7 5-4.7s4.5 1.8 5 4.7" strokeDasharray="2.2 2.2" />
    </svg>
  );
}

// Live's glyph: a lens with its on-air light.
function LiveIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <circle cx="12" cy="12" r="3" />
      <path d="M7.1 16.9a7 7 0 0 1 0-9.8M16.9 7.1a7 7 0 0 1 0 9.8" />
      <path d="M4.2 19.8a11 11 0 0 1 0-15.6M19.8 4.2a11 11 0 0 1 0 15.6" />
    </svg>
  );
}

// Press Tour's glyph: a press camera with its flash glint (the sidebar's).
function PressTourIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <rect x="3" y="8" width="15" height="11.5" rx="2.5" />
      <circle cx="10.5" cy="13.75" r="3" />
      <path d="M7 8l1.2-2h4.6L14 8" />
      <path d="M20.5 3v4M18.5 5h4" />
    </svg>
  );
}

// Director's Cut's glyph: the editor's scissors.
function CutIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <circle cx="6" cy="6" r="3" />
      <circle cx="6" cy="18" r="3" />
      <path d="M8.1 8.1 20 20M14.5 9.5 20 4M8.1 15.9l3.4-3.4" />
    </svg>
  );
}

// The lamp's filament: the Generate bolt, filled, behind the glass.
function Lamp() {
  return (
    <span className="pj-lens" aria-hidden="true">
      <span className="pj-glass">
        <svg viewBox="0 0 24 24">
          <path d="M13 2 3 14h7l-1 8 10-12h-7l1-8Z" />
        </svg>
      </span>
    </span>
  );
}

// How far the lamp rises above the bar's top edge. It is published as part of
// the bar's height, so the docked composer keeps its usual 1rem of air above
// the lamp instead of sitting on it.
const LAMP_RISE = 18;
// The screen's cut when it closes (globals.css pj-cut is 170 ms).
const CLOSE_MS = 200;
// How long a picked choice is held lit before the lamp goes out.
const PICK_MS = 300;

type Choice = "video" | "recast" | "pressTour" | "live" | "cut";

const CHOICE_HREF: Record<Choice, string> = {
  video: GENERATE_VIDEO_HREF,
  recast: RECAST_HREF,
  pressTour: PRESS_TOUR_HREF,
  live: LIVE_HREF,
  cut: DIRECTORS_CUT_HREF,
};

const PRESS_TOUR_TOOL = NAV_TOOLS.find((tool) => tool.key === "pressTour");

/** Whether Press Tour still wears New for this person: the sidebar's own rule and storage. */
function pressTourIsNew(): boolean {
  if (!PRESS_TOUR_TOOL) return false;
  try {
    const seen = new Set<string>(parseToolKeys(window.localStorage.getItem(SEEN_STORAGE_KEY)));
    return isToolNew(PRESS_TOUR_TOOL, localDay(new Date()), seen);
  } catch {
    return false;
  }
}

export function NativeTabBar({
  recastOn = false,
  pressTourOn = false,
  liveOn = false,
  cutOn = false,
}: {
  recastOn?: boolean;
  pressTourOn?: boolean;
  liveOn?: boolean;
  cutOn?: boolean;
}) {
  const hasChoices = recastOn || pressTourOn || liveOn || cutOn;
  const pathname = usePathname();
  const router = useRouter();
  const { t } = useLocale();
  const menuId = useId();
  // Rendered only after mount, because the check depends on the Capacitor
  // runtime. Server-rendering it would put a tab bar on the website for a
  // frame before hydration removed it.
  const [isNative, setIsNative] = useState(false);
  useEffect(() => setIsNative(isNativeAppClient()), []);

  // Optimistic active state (2026-08-27, operator: on slow network a tap
  // feels frozen): the tapped tab lights up the INSTANT it's touched, not
  // when the route finishes loading. Cleared as soon as the pathname really
  // changes — until then the highlight itself is the "order taken" signal,
  // alongside the top progress bar.
  const [pendingTab, setPendingTab] = useState<NativeTab | null>(null);
  useEffect(() => setPendingTab(null), [pathname]);

  // The lamp's two choices: open, closing (the screen's cut is playing), and
  // the choice being held lit after a tap.
  const [open, setOpen] = useState(false);
  const [closing, setClosing] = useState(false);
  const [picked, setPicked] = useState<Choice | null>(null);
  // Press Tour's New dot, read from storage each time the choices open (the
  // sidebar retires it when the page is opened).
  const [pressTourNew, setPressTourNew] = useState(false);
  // `open` mirrored in a ref, so close() can decide whether there is anything
  // to close without a state updater that has side effects.
  const openRef = useRef(false);
  // Focus follows the menu: into its first choice when it opens, back to the
  // lamp when it closes with focus inside (keyboard and TalkBack users).
  const lampRef = useRef<HTMLButtonElement>(null);
  const screenRef = useRef<HTMLDivElement>(null);
  const timers = useRef<number[]>([]);
  const clearTimers = useCallback(() => {
    timers.current.forEach((id) => window.clearTimeout(id));
    timers.current = [];
  }, []);
  const later = useCallback((fn: () => void, ms: number) => {
    timers.current.push(window.setTimeout(fn, ms));
  }, []);

  const close = useCallback(() => {
    // Nothing open: leave a running close alone. Clearing timers here used to
    // cancel the cut's own reset when close() ran twice (Escape twice, or a
    // pick's close followed by the route change), leaving `closing` stuck.
    if (!openRef.current) return;
    clearTimers();
    setPicked(null);
    if (screenRef.current?.contains(document.activeElement)) lampRef.current?.focus();
    openRef.current = false;
    setOpen(false);
    setClosing(true);
    later(() => setClosing(false), CLOSE_MS);
  }, [clearTimers, later]);

  const openChoices = useCallback(() => {
    clearTimers();
    setPressTourNew(pressTourOn && pressTourIsNew());
    openRef.current = true;
    setClosing(false);
    setOpen(true);
  }, [clearTimers, pressTourOn]);

  // A new page closes the choices: the tap that navigated has been answered.
  useEffect(() => {
    close();
  }, [pathname, close]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, close]);

  // Android's back button closes the choices before it navigates anywhere
  // (native-chrome.tsx pops this before history).
  useBackCloser(open, close);

  // Runs after the commit that lifts `inert`, so the focus call lands.
  useEffect(() => {
    if (!open) return;
    screenRef.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus({ preventScroll: true });
  }, [open]);

  useEffect(() => clearTimers, [clearTimers]);

  // Publish the bar's REAL height (the safe-area inset included), plus the
  // lamp's rise, so sticky elements can stay above it. The docked composer
  // is `sticky bottom-*` inside the app scroller, and this bar is `fixed`
  // OVER the same scroller — without the offset the bar covered the
  // composer's whole bottom control row (the send button included) whenever
  // the composer was pinned, and taps landed on the tab Links instead.
  // Measured, not hardcoded: the bar is 64px plus the inset, and the inset
  // changes with the phone's navigation mode. The BORDER box is observed
  // because the height and its padding move together, so the content box
  // never changes.
  const barRef = useRef<HTMLElement>(null);
  useEffect(() => {
    if (!isNative) return;
    const el = barRef.current;
    if (!el) return;
    const publish = () =>
      document.documentElement.style.setProperty("--native-tab-bar", `${el.offsetHeight + LAMP_RISE}px`);
    publish();
    const observer = new ResizeObserver(publish);
    observer.observe(el, { box: "border-box" });
    return () => {
      observer.disconnect();
      document.documentElement.style.removeProperty("--native-tab-bar");
    };
  }, [isNative]);

  if (!isNative) return null;

  const active = pendingTab ?? nativeTabFor(pathname);
  const lampLit = open || active === "generate";

  function choose(choice: Choice) {
    if (!open) return;
    clearTimers();
    setPicked(choice);
    // The navigation starts at once, so nothing that closes the choices can
    // cancel a pick; the chosen exposure stays lit while the page loads.
    if (choice === "video" && nativeTabFor(pathname) === "generate" && pathname.startsWith(GENERATE_HREF)) {
      window.dispatchEvent(new CustomEvent(CONTENT_TYPE_EVENT, { detail: "video" }));
    } else {
      setPendingTab("generate");
      router.push(CHOICE_HREF[choice]);
    }
    later(() => close(), PICK_MS);
  }

  // Three either side of the lamp. Characters, Community and History wear the
  // bar's shorter names (nav.bar*): seven full names do not fit a phone.
  const tabs: { tab: Exclude<NativeTab, "generate">; label: string; Icon: typeof UserIcon; tour?: string }[] = [
    { tab: "home", label: t.nav.home, Icon: HomeIcon },
    { tab: "characters", label: t.nav.barCharacters, Icon: UserIcon, tour: "tour-characters" },
    { tab: "media", label: t.nav.media, Icon: PhotosIcon },
    { tab: "community", label: t.nav.barCommunity, Icon: CommunityIcon, tour: "tour-community" },
    { tab: "history", label: t.nav.barHistory, Icon: ClockIcon },
    { tab: "more", label: t.nav.more, Icon: MoreIcon },
  ];

  const tabLink = ({ tab, label, Icon, tour }: (typeof tabs)[number]) => {
    const lit = active === tab;
    return (
      <Link
        key={tab}
        href={NATIVE_TAB_HREF[tab]}
        aria-current={nativeTabFor(pathname) === tab ? "page" : undefined}
        onClick={() => setPendingTab(tab)}
        // The "where things are" stops of the onboarding tour. The same ids
        // as the sidebar's links: whichever of the two is laid out on this
        // device is the one the tour points at (findTourAnchor).
        data-tour-id={tour}
        className={cn("pj-tab", lit && "pj-tab-lit")}
      >
        <Icon className="pj-tab-icon" />
        <span>{label}</span>
      </Link>
    );
  };

  return (
    <div className={cn("pj", open && "pj-open", closing && "pj-closing")}>
      {hasChoices && (
        <>
          {/* House lights: the page behind goes down. A tap anywhere closes. */}
          <div className="pj-house" onClick={close} aria-hidden="true" />
          {/* The throw: a soft cone of light from the lamp up to the screen. */}
          <div className="pj-throw" aria-hidden="true">
            <div className="pj-cone" />
          </div>
          {/* The projected screen: one lit frame, two exposures. */}
          <div ref={screenRef} className="pj-screen" id={menuId} role="menu" aria-label={t.nav.generate} inert={!open}>
            <div className="pj-sheet">
              <button
                type="button"
                role="menuitem"
                className={cn("pj-opt", picked === "video" && "pj-picked")}
                onClick={() => choose("video")}
              >
                <span className="pj-ic">
                  <FilmIcon />
                </span>
                <span className="pj-txt">
                  <b>{t.nav.generateVideo}</b>
                  <span>{t.nav.generateVideoSub}</span>
                </span>
              </button>
              {recastOn && (
                <button
                  type="button"
                  role="menuitem"
                  className={cn("pj-opt", picked === "recast" && "pj-picked")}
                  onClick={() => choose("recast")}
                >
                  <span className="pj-ic">
                    <RecastIcon />
                  </span>
                  <span className="pj-txt">
                    <b>{t.nav.mystique}</b>
                    <span>{t.nav.recastSub}</span>
                  </span>
                </button>
              )}
              {pressTourOn && (
                <button
                  type="button"
                  role="menuitem"
                  className={cn("pj-opt", picked === "pressTour" && "pj-picked")}
                  onClick={() => choose("pressTour")}
                >
                  <span className="pj-ic">
                    <PressTourIcon />
                  </span>
                  <span className="pj-txt">
                    <b>
                      {t.nav.pressTour}
                      {pressTourNew && (
                        <span
                          role="img"
                          aria-label={t.nav.newBadge}
                          className="ml-2 inline-block h-1.5 w-1.5 rounded-full bg-[#e0a468] align-middle shadow-[0_0_8px_#e0a468]"
                        />
                      )}
                    </b>
                    <span>{t.nav.pressTourSub}</span>
                  </span>
                </button>
              )}
              {liveOn && (
                <button
                  type="button"
                  role="menuitem"
                  className={cn("pj-opt", picked === "live" && "pj-picked")}
                  onClick={() => choose("live")}
                >
                  <span className="pj-ic">
                    <LiveIcon />
                  </span>
                  <span className="pj-txt">
                    <b>{t.nav.live}</b>
                    <span>{t.nav.liveSub}</span>
                  </span>
                </button>
              )}
              {cutOn && (
                <button
                  type="button"
                  role="menuitem"
                  className={cn("pj-opt", picked === "cut" && "pj-picked")}
                  onClick={() => choose("cut")}
                >
                  <span className="pj-ic">
                    <CutIcon />
                  </span>
                  <span className="pj-txt">
                    <b>{t.nav.directorsCut}</b>
                    <span>{t.nav.directorsCutSub}</span>
                  </span>
                </button>
              )}
            </div>
          </div>
        </>
      )}

      <nav ref={barRef} className="pj-bar">
        {tabs.slice(0, 3).map(tabLink)}
        <div className="pj-mid">
          {hasChoices ? (
            <button
              ref={lampRef}
              type="button"
              className="pj-lamp"
              aria-label={t.nav.generate}
              aria-haspopup="menu"
              aria-expanded={open}
              aria-controls={menuId}
              onClick={() => (open ? close() : openChoices())}
            >
              <Lamp />
            </button>
          ) : (
            <Link
              href={GENERATE_HREF}
              className="pj-lamp"
              aria-label={t.nav.generate}
              aria-current={nativeTabFor(pathname) === "generate" ? "page" : undefined}
              onClick={() => setPendingTab("generate")}
            >
              <Lamp />
            </Link>
          )}
          <span className={cn("pj-mid-label", lampLit && "pj-mid-label-lit")} aria-hidden="true">
            {t.nav.generate}
          </span>
        </div>
        {tabs.slice(3).map(tabLink)}
      </nav>
    </div>
  );
}
