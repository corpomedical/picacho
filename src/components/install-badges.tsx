"use client";

import { useEffect, useState } from "react";
import { useLocale } from "@/lib/i18n/provider";
import { cn } from "@/lib/cn";

// Everything that offers the PWA install: the marketing-footer badge row and
// the header's "Get the app" button both drive the same flow, so the
// platform logic and the explainer cards live here once.
//
// Click behaviour by platform:
//  - Android/Chromium with the install event available: the browser's REAL
//    install dialog, one tap to the home screen.
//  - iPhone/iPad: Safari has no install API (Apple's rule), so a small card
//    teaches the two taps: Share -> Add to Home Screen.
//  - Desktop without an install event, or any browser we can't prompt:
//    a "grab your phone" card with the address, or generic menu
//    instructions on Android browsers that hid the event.
//
// 2026-08-28, launch day: the Android app went LIVE on Google Play, so the
// Android path now links straight to the store listing and wears the
// official "Get it on Google Play" badge (self-hosted, unmodified, per
// Google's badge guidelines — the artwork may only be used when linking to
// the listing, which is exactly what it does). The Apple side stays the
// Picacho-branded PWA flow until an App Store build exists.
type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

type ModalKind = "ios" | "android" | "desktop" | null;

const PLAY_STORE_URL = "https://play.google.com/store/apps/details?id=ai.picacho.app";

function useInstallFlow() {
  const [installEvent, setInstallEvent] = useState<BeforeInstallPromptEvent | null>(null);
  const [modal, setModal] = useState<ModalKind>(null);
  const [standalone, setStandalone] = useState(false);

  useEffect(() => {
    setStandalone(
      window.matchMedia("(display-mode: standalone)").matches ||
        (navigator as { standalone?: boolean }).standalone === true,
    );
    function onPrompt(e: Event) {
      e.preventDefault();
      setInstallEvent(e as BeforeInstallPromptEvent);
    }
    window.addEventListener("beforeinstallprompt", onPrompt);
    return () => window.removeEventListener("beforeinstallprompt", onPrompt);
  }, []);

  const isIos = typeof navigator !== "undefined" && /iphone|ipad|ipod/i.test(navigator.userAgent);
  const isAndroid = typeof navigator !== "undefined" && /android/i.test(navigator.userAgent);

  return {
    modal,
    setModal,
    standalone,
    // Apple badge: iPhone gets the taught two taps; a Chromium desktop can
    // still show the real dialog if the event exists.
    async openApple() {
      if (isIos) setModal("ios");
      else if (installEvent) await installEvent.prompt();
      else setModal("desktop");
    },
    openAndroid() {
      // Straight to the Play listing — on Android the store app intercepts,
      // elsewhere the web listing opens in a new tab.
      window.open(PLAY_STORE_URL, "_blank", "noopener");
    },
    // Platform-agnostic entry point (the header button, which isn't
    // per-platform): real dialog if we have one, otherwise the card that
    // matches the device.
    async openAny() {
      if (isAndroid) window.open(PLAY_STORE_URL, "_blank", "noopener");
      else if (installEvent) await installEvent.prompt();
      else if (isIos) setModal("ios");
      else setModal("desktop");
    },
  };
}

export function InstallBadges({
  variant = "hero",
  dark = false,
}: {
  variant?: "hero" | "footer";
  // Pinned-dark surfaces (the homepage footer): the near-black badge fill
  // vanishes on #101014, and the neutral-900 tokens would flip under the
  // .dark theme anyway — literals with a visible hairline instead.
  dark?: boolean;
}) {
  const { t } = useLocale();
  const m = t.marketing.install;
  const flow = useInstallFlow();

  // Already running as the installed app — advertising the install would be
  // noise.
  if (flow.standalone) return null;

  const badgeClass = cn(
    dark
      ? "flex items-center gap-2.5 rounded-[12px] border border-[#f7f6f4]/[0.16] bg-[#17171c] text-left text-[#f7f6f4] transition-transform hover:-translate-y-px"
      : "flex items-center gap-2.5 rounded-[12px] border border-neutral-900 bg-neutral-900 text-left text-white transition-transform hover:-translate-y-px",
    variant === "hero" ? "px-4 py-2 pl-3" : "px-3 py-1.5 pl-2.5",
  );

  return (
    <>
      <div className={cn("flex flex-wrap gap-2.5", variant === "hero" && "mt-7")}>
        <button type="button" onClick={flow.openApple} className={badgeClass}>
          <AppleIcon className={variant === "hero" ? "h-[22px] w-[22px]" : "h-4 w-4"} />
          <span className="leading-tight">
            <span className="block text-[9px] uppercase tracking-wider opacity-70">{m.installOn}</span>
            <span className={cn("block font-semibold", variant === "hero" ? "text-sm" : "text-xs")}>
              {m.iphone}
            </span>
          </span>
        </button>
        <a
          href={PLAY_STORE_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex transition-transform hover:-translate-y-px"
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/google-play-badge.png"
            alt="Get it on Google Play"
            className={variant === "hero" ? "h-[42px] w-auto" : "h-[34px] w-auto"}
          />
        </a>
      </div>
      {variant === "hero" && <p className="mt-2.5 text-[11px] text-slate-400">{m.note}</p>}

      <InstallModal kind={flow.modal} onClose={() => flow.setModal(null)} />
    </>
  );
}

// The header entry point. One quiet control, on every marketing page,
// costing no vertical space — which is why the homepage hero doesn't carry
// the badges any more (they pushed the headline out of line with the photo
// grid beside it).
// `variant="darkText"` (the dark front page, 2026-09-02): on the near-black
// header the board draws this as a plain text link, so the nav carries
// exactly ONE white pill (the auth CTA). Literals, not theme tokens — the
// dark page pins its palette regardless of the site theme.
export function GetAppButton({ variant = "solid" }: { variant?: "solid" | "darkText" } = {}) {
  const { t } = useLocale();
  const m = t.marketing.install;
  const flow = useInstallFlow();

  if (flow.standalone) return null;

  return (
    <>
      <button
        type="button"
        onClick={flow.openAny}
        className={
          variant === "darkText"
            ? "inline-flex items-center gap-1.5 text-[13.5px] text-[#f7f6f4]/65 transition-colors hover:text-[#f7f6f4]"
            : "inline-flex items-center gap-1.5 rounded-[8px] border border-neutral-200 bg-white px-2.5 py-1.5 text-sm font-semibold text-neutral-900 transition-colors hover:border-neutral-300 hover:text-ochre sm:px-3"
        }
      >
        <DownloadIcon className="h-3.5 w-3.5" />
        {/* Label hides on the narrowest screens so the nav never wraps. */}
        <span className="hidden sm:inline">{m.getApp}</span>
        <span className="sr-only sm:hidden">{m.getApp}</span>
      </button>

      <InstallModal kind={flow.modal} onClose={() => flow.setModal(null)} />
    </>
  );
}

function InstallModal({ kind, onClose }: { kind: ModalKind; onClose: () => void }) {
  const { t } = useLocale();
  const m = t.marketing.install;

  if (!kind) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-6"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
    >
      <div
        className="w-full max-w-xs rounded-[20px] border border-neutral-100 bg-white p-6 shadow-[0_24px_60px_-18px_rgba(0,0,0,0.35)]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex h-11 w-11 items-center justify-center rounded-[11px] border border-neutral-200 bg-paper text-xl font-extrabold text-neutral-900">
          P<span className="text-ochre">.</span>
        </div>
        {kind === "ios" && (
          <>
            <h3 className="text-[15px] font-bold tracking-[-0.01em] text-neutral-900">{m.iosTitle}</h3>
            {[m.iosStep1, m.iosStep2].map((step, i) => (
              <div key={i} className="mt-3 flex items-start gap-2.5">
                <span className="flex h-[22px] w-[22px] flex-shrink-0 items-center justify-center rounded-full bg-ochre text-xs font-bold text-onmedia">
                  {i + 1}
                </span>
                <p className="pt-0.5 text-xs leading-relaxed text-neutral-700">{step}</p>
              </div>
            ))}
            <p className="mt-3 text-xs leading-relaxed text-neutral-500">{m.iosBody}</p>
          </>
        )}
        {kind === "android" && (
          <>
            <h3 className="text-[15px] font-bold tracking-[-0.01em] text-neutral-900">{m.androidTitle}</h3>
            <p className="mt-2 text-xs leading-relaxed text-neutral-500">{m.androidBody}</p>
          </>
        )}
        {kind === "desktop" && (
          <>
            <h3 className="text-[15px] font-bold tracking-[-0.01em] text-neutral-900">{m.desktopTitle}</h3>
            <p className="mt-2 text-xs leading-relaxed text-neutral-500">{m.desktopBody}</p>
            <p className="mt-3 rounded-[10px] border border-neutral-200 bg-paper p-3 text-center text-base font-bold tracking-[-0.01em] text-neutral-900">
              picacho<span className="text-ochre">.ai</span>
            </p>
          </>
        )}
        <p className="mt-4 text-center text-xs text-neutral-400">{m.close}</p>
      </div>
    </div>
  );
}

function DownloadIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2.2}
      strokeLinecap="round"
      strokeLinejoin="round"
      {...props}
    >
      <path d="M12 3v12" />
      <path d="m7 10 5 5 5-5" />
      <path d="M5 21h14" />
    </svg>
  );
}

function AppleIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" {...props}>
      <path d="M17.05 12.54c-.03-2.9 2.37-4.29 2.48-4.36-1.35-1.97-3.45-2.24-4.2-2.27-1.79-.18-3.49 1.05-4.4 1.05-.9 0-2.3-1.02-3.79-1-1.95.03-3.74 1.13-4.74 2.87-2.02 3.5-.52 8.69 1.45 11.53.96 1.39 2.11 2.95 3.62 2.9 1.45-.06 2-.94 3.75-.94s2.25.94 3.79.91c1.56-.03 2.55-1.42 3.51-2.82.73-1.03 1.18-2.04 1.5-2.79-3.29-1.26-3.94-4.32-2.97-5.08zM14.16 3.9c.8-.97 1.34-2.32 1.19-3.66-1.15.05-2.55.77-3.38 1.74-.74.86-1.39 2.24-1.22 3.55 1.29.1 2.6-.65 3.41-1.63z" />
    </svg>
  );
}

