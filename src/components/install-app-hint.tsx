"use client";

import { useEffect, useState } from "react";
import { useLocale } from "@/lib/i18n/provider";
import { isNativeAppClient } from "@/lib/native/platform";
import { Button } from "@/components/ui/button";

// "Install the app" card — the point of the PWA setup (app/manifest.ts):
// Picacho on the home screen, full-screen, no app store and no 30% cut.
//
// Three situations, three behaviours:
//  - already running standalone (installed): render nothing.
//  - Chrome/Edge/Android: the browser fires beforeinstallprompt; we stash
//    the event and the button triggers the real install dialog.
//  - iOS Safari: no install API exists, so show the two-tap instructions.
// Dismissal is remembered per browser — an install nudge that reappears on
// every visit trains people to ignore it.
const DISMISS_KEY = "picacho.installHint.dismissed";

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

export function InstallAppHint() {
  const { t } = useLocale();
  const d = t.dashboard;
  const [visible, setVisible] = useState(false);
  const [installEvent, setInstallEvent] = useState<BeforeInstallPromptEvent | null>(null);
  const [isIos, setIsIos] = useState(false);

  useEffect(() => {
    try {
      if (window.localStorage.getItem(DISMISS_KEY) === "1") return;
    } catch {
      // Storage blocked — fine, just evaluate the rest.
    }
    // Already inside the Capacitor shell (the real iOS/Android app): there is
    // nothing left to install. The standalone check below doesn't catch this
    // — the shell is a WKWebView/WebView, not a standalone-display-mode PWA —
    // so the native iOS app was showing "Install the app" with Safari
    // share-sheet instructions that can't work inside it.
    if (isNativeAppClient()) return;
    const standalone =
      window.matchMedia("(display-mode: standalone)").matches ||
      (navigator as { standalone?: boolean }).standalone === true;
    if (standalone) return;

    const ios = /iphone|ipad|ipod/i.test(navigator.userAgent);
    setIsIos(ios);
    // iOS can always show instructions; everyone else waits for the event
    // so the button is only shown when it can actually do something.
    if (ios) setVisible(true);

    function onPrompt(e: Event) {
      e.preventDefault();
      setInstallEvent(e as BeforeInstallPromptEvent);
      setVisible(true);
    }
    window.addEventListener("beforeinstallprompt", onPrompt);
    return () => window.removeEventListener("beforeinstallprompt", onPrompt);
  }, []);

  if (!visible) return null;

  function dismiss() {
    setVisible(false);
    try {
      window.localStorage.setItem(DISMISS_KEY, "1");
    } catch {
      // Best effort.
    }
  }

  async function install() {
    if (!installEvent) return;
    await installEvent.prompt();
    const choice = await installEvent.userChoice;
    if (choice.outcome === "accepted") setVisible(false);
  }

  return (
    <div className="flex flex-col gap-3 rounded-[18px] border border-neutral-100 bg-white p-5 shadow-[0_1px_2px_rgba(0,0,0,0.03)] sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0">
        <p className="text-sm font-semibold text-neutral-900">{d.installTitle}</p>
        <p className="mt-0.5 text-xs leading-relaxed text-neutral-500">
          {isIos ? d.installIosHint : d.installBody}
        </p>
      </div>
      <div className="flex flex-shrink-0 items-center gap-2">
        {!isIos && installEvent && (
          <Button size="sm" onClick={install}>
            {d.installCta}
          </Button>
        )}
        <button
          type="button"
          onClick={dismiss}
          className="rounded-full px-3 py-1.5 text-xs text-neutral-400 transition-colors hover:bg-neutral-100 hover:text-neutral-700"
        >
          {d.installDismiss}
        </button>
      </div>
    </div>
  );
}
