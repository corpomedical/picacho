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
    // Atelier sheet, not a stark white strip (2026-08-19: this banner was
    // the last bg-white floating over the warm app theme — the operator
    // spotted it as "the white that doesn't fit"). Tokens flip it for dark
    // mode automatically, and it reads equally at home over the marketing
    // pages' cream.
    <div className="fixed inset-x-0 bottom-0 z-40 border-t border-atelier-rule bg-atelier-surface px-4 py-3 shadow-[0_-8px_24px_-12px_rgba(33,29,22,0.15)]">
      <div className="mx-auto flex max-w-5xl flex-col items-center justify-between gap-3 sm:flex-row">
        <p className="text-center text-xs text-atelier-muted sm:text-left">
          {t.cookie.message}{" "}
          <Link href="/privacy" className="underline decoration-atelier-rule hover:text-atelier-ink">
            {t.cookie.privacyLink}
          </Link>
        </p>
        <div className="flex flex-shrink-0 items-center gap-2">
          <button
            type="button"
            onClick={() => choose("declined")}
            className="rounded-control border border-atelier-rule px-3 py-1.5 text-xs font-medium text-atelier-muted transition-colors hover:bg-atelier-ink/5 hover:text-atelier-ink"
          >
            {t.cookie.declineNonEssential}
          </button>
          <button
            type="button"
            onClick={() => choose("accepted")}
            className="rounded-control bg-atelier-ink px-3.5 py-1.5 text-xs font-medium text-atelier-paper transition-opacity hover:opacity-90"
          >
            {t.cookie.accept}
          </button>
        </div>
      </div>
    </div>
  );
}
