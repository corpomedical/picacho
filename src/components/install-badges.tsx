"use client";

import { useEffect, useState } from "react";
import { useLocale } from "@/lib/i18n/provider";
import { cn } from "@/lib/cn";

// The homepage/footer "download app" badges. Deliberately Picacho-branded
// rather than App Store / Google Play artwork: Picacho isn't in the stores
// (that's the pitch — no 30% cut), and wearing their badges would be both
// false and against both companies' brand rules.
//
// Click behaviour by platform:
//  - Android/Chromium with the install event available: the browser's REAL
//    install dialog, one tap to the home screen.
//  - iPhone/iPad: Safari has no install API (Apple's rule), so a small card
//    teaches the two taps: Share -> Add to Home Screen.
//  - Desktop without an install event, or any browser we can't prompt:
//    a "grab your phone" card with the address, or generic menu
//    instructions on Android browsers that hid the event.
type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

type ModalKind = "ios" | "android" | "desktop" | null;

export function InstallBadges({ variant = "hero" }: { variant?: "hero" | "footer" }) {
  const { t } = useLocale();
  const m = t.marketing.install;
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

  // Already running as the installed app — advertising the install would be
  // noise.
  if (standalone) return null;

  const isIos = typeof navigator !== "undefined" && /iphone|ipad|ipod/i.test(navigator.userAgent);
  const isAndroid = typeof navigator !== "undefined" && /android/i.test(navigator.userAgent);

  async function onApple() {
    if (isIos) {
      setModal("ios");
    } else if (installEvent) {
      // Safari-on-Mac can't prompt, but a Chromium desktop can — if the
      // event exists, the real dialog beats any card.
      await installEvent.prompt();
    } else {
      setModal("desktop");
    }
  }

  async function onAndroid() {
    if (installEvent) {
      await installEvent.prompt();
    } else if (isAndroid) {
      setModal("android");
    } else {
      setModal("desktop");
    }
  }

  const badgeClass = cn(
    "flex items-center gap-2.5 rounded-[12px] border border-neutral-900 bg-neutral-900 text-left text-white transition-transform hover:-translate-y-px",
    variant === "hero" ? "px-4 py-2 pl-3" : "px-3 py-1.5 pl-2.5",
  );

  return (
    <>
      <div className={cn("flex flex-wrap gap-2.5", variant === "hero" && "mt-7")}>
        <button type="button" onClick={onApple} className={badgeClass}>
          <AppleIcon className={variant === "hero" ? "h-[22px] w-[22px]" : "h-4 w-4"} />
          <span className="leading-tight">
            <span className="block text-[9px] uppercase tracking-wider opacity-70">{m.installOn}</span>
            <span className={cn("block font-semibold", variant === "hero" ? "text-sm" : "text-xs")}>
              {m.iphone}
            </span>
          </span>
        </button>
        <button type="button" onClick={onAndroid} className={badgeClass}>
          <AndroidIcon className={variant === "hero" ? "h-[22px] w-[22px]" : "h-4 w-4"} />
          <span className="leading-tight">
            <span className="block text-[9px] uppercase tracking-wider opacity-70">{m.installOn}</span>
            <span className={cn("block font-semibold", variant === "hero" ? "text-sm" : "text-xs")}>
              {m.android}
            </span>
          </span>
        </button>
      </div>
      {variant === "hero" && <p className="mt-2.5 text-[11px] text-slate-400">{m.note}</p>}

      {modal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-6"
          onClick={() => setModal(null)}
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
            {modal === "ios" && (
              <>
                <h3 className="text-[15px] font-bold tracking-[-0.01em] text-neutral-900">{m.iosTitle}</h3>
                {[m.iosStep1, m.iosStep2].map((step, i) => (
                  <div key={i} className="mt-3 flex items-start gap-2.5">
                    <span className="flex h-[22px] w-[22px] flex-shrink-0 items-center justify-center rounded-full bg-ochre text-xs font-bold text-white">
                      {i + 1}
                    </span>
                    <p className="pt-0.5 text-xs leading-relaxed text-neutral-700">{step}</p>
                  </div>
                ))}
                <p className="mt-3 text-xs leading-relaxed text-neutral-500">{m.iosBody}</p>
              </>
            )}
            {modal === "android" && (
              <>
                <h3 className="text-[15px] font-bold tracking-[-0.01em] text-neutral-900">{m.androidTitle}</h3>
                <p className="mt-2 text-xs leading-relaxed text-neutral-500">{m.androidBody}</p>
              </>
            )}
            {modal === "desktop" && (
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
      )}
    </>
  );
}

function AppleIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" {...props}>
      <path d="M17.05 12.54c-.03-2.9 2.37-4.29 2.48-4.36-1.35-1.97-3.45-2.24-4.2-2.27-1.79-.18-3.49 1.05-4.4 1.05-.9 0-2.3-1.02-3.79-1-1.95.03-3.74 1.13-4.74 2.87-2.02 3.5-.52 8.69 1.45 11.53.96 1.39 2.11 2.95 3.62 2.9 1.45-.06 2-.94 3.75-.94s2.25.94 3.79.91c1.56-.03 2.55-1.42 3.51-2.82.73-1.03 1.18-2.04 1.5-2.79-3.29-1.26-3.94-4.32-2.97-5.08zM14.16 3.9c.8-.97 1.34-2.32 1.19-3.66-1.15.05-2.55.77-3.38 1.74-.74.86-1.39 2.24-1.22 3.55 1.29.1 2.6-.65 3.41-1.63z" />
    </svg>
  );
}

function AndroidIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" {...props}>
      <path d="M7.2 8.4h9.6c.66 0 1.2.54 1.2 1.2v7.2a1.8 1.8 0 0 1-1.8 1.8h-.6v2.1a1.05 1.05 0 1 1-2.1 0v-2.1h-3v2.1a1.05 1.05 0 1 1-2.1 0v-2.1h-.6A1.8 1.8 0 0 1 6 16.8V9.6c0-.66.54-1.2 1.2-1.2zM4.05 9.3c.58 0 1.05.47 1.05 1.05v4.5a1.05 1.05 0 1 1-2.1 0v-4.5c0-.58.47-1.05 1.05-1.05zm15.9 0c.58 0 1.05.47 1.05 1.05v4.5a1.05 1.05 0 1 1-2.1 0v-4.5c0-.58.47-1.05 1.05-1.05zM15.7 3.55l.9-1.35a.45.45 0 0 0-.75-.5l-.93 1.4a6.6 6.6 0 0 0-5.84 0l-.93-1.4a.45.45 0 0 0-.75.5l.9 1.35A5.4 5.4 0 0 0 6 7.8h12a5.4 5.4 0 0 0-2.3-4.25zM9.6 6.3a.6.6 0 1 1 0-1.2.6.6 0 0 1 0 1.2zm4.8 0a.6.6 0 1 1 0-1.2.6.6 0 0 1 0 1.2z" />
    </svg>
  );
}
