"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useLocale } from "@/lib/i18n/provider";
import { COOKIE_CONSENT_KEY, getCookieConsent } from "@/lib/cookie-consent";

// Shown once, to first-time visitors, until they make an explicit choice.
// Analytics (the page-view tracker) stays off by default and only starts
// once "Accept" is chosen — see page-view-tracker.tsx.
export function CookieConsentBanner() {
  const { t } = useLocale();
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    setVisible(getCookieConsent() === null);
  }, []);

  function choose(value: "accepted" | "declined") {
    window.localStorage.setItem(COOKIE_CONSENT_KEY, value);
    setVisible(false);
  }

  if (!visible) return null;

  return (
    <div className="fixed inset-x-0 bottom-0 z-40 border-t border-neutral-200 bg-white px-4 py-3 shadow-[0_-8px_24px_-12px_rgba(0,0,0,0.12)]">
      <div className="mx-auto flex max-w-5xl flex-col items-center justify-between gap-3 sm:flex-row">
        <p className="text-center text-xs text-neutral-600 sm:text-left">
          {t.cookie.message}{" "}
          <Link href="/privacy" className="underline hover:text-neutral-900">
            {t.cookie.privacyLink}
          </Link>
        </p>
        <div className="flex flex-shrink-0 items-center gap-2">
          <button
            type="button"
            onClick={() => choose("declined")}
            className="rounded-[10px] border border-neutral-200 px-3 py-1.5 text-xs font-medium text-neutral-600 transition-colors hover:bg-neutral-50"
          >
            {t.cookie.declineNonEssential}
          </button>
          <button
            type="button"
            onClick={() => choose("accepted")}
            className="rounded-[10px] bg-neutral-900 px-3.5 py-1.5 text-xs font-medium text-white transition-opacity hover:opacity-90"
          >
            {t.cookie.accept}
          </button>
        </div>
      </div>
    </div>
  );
}
