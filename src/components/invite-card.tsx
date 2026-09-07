"use client";

import { useEffect, useState } from "react";
import { useLocale } from "@/lib/i18n/provider";
import { isNativeAppClient } from "@/lib/native/platform";
import { capPlugin } from "@/lib/native/bridge";

// The referral card (give 5, get 5 — trigger and cap live in the database,
// see supabase referrals.sql). The link is the user's username, which is
// already unique and already theirs — no codes to mint or remember.
export function InviteCard({ username }: { username: string }) {
  const { t } = useLocale();
  const s = t.settings;
  const [copied, setCopied] = useState(false);
  const link = `https://picacho.ai/r/${username}`;

  async function copy() {
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard denied — the visible input below is selectable by hand.
    }
  }

  function share() {
    // Native shell: the system share sheet via the Share plugin. Mobile
    // web: the Web Share API where it exists. The button only renders when
    // one of the two is available (see below).
    const native = capPlugin("Share");
    if (isNativeAppClient() && native?.share) {
      void native.share({ url: link });
      return;
    }
    if (navigator.share) {
      void navigator.share({ url: link }).catch(() => undefined);
    }
  }

  // Decided AFTER mount, never during render: navigator only exists in the
  // browser, so a render-time check made the server and client disagree
  // about whether the Share button exists — React #418 hydration errors on
  // every page this card appears on (found via the auto-filed client-error
  // reports, 2026-08-22). First paint matches the server (no button); the
  // button pops in a frame later where supported.
  const [canShare, setCanShare] = useState(false);
  useEffect(() => {
    setCanShare(isNativeAppClient() || Boolean(navigator.share));
  }, []);

  return (
    // A dark invitation rather than a paragraph with an input under it. The
    // ground is atelier-stage, the one token defined to stay charcoal in both
    // themes, so this card bookends the cinema at the top of the dashboard
    // instead of dissolving into the frost around it. Everything on it takes
    // `onmedia`, per the note on that token: --color-white is redeclared to a
    // near-black in dark mode and would erase this text.
    <div className="relative overflow-hidden rounded-card bg-atelier-stage p-5 ring-1 ring-onmedia/10 shadow-[0_18px_44px_-28px_rgba(20,18,16,0.55)] sm:p-6">
      {/* One ochre bloom, the accent this system reserves for proof. Behind
          the content, never over it. */}
      <div
        aria-hidden
        className="pointer-events-none absolute -right-16 -top-20 h-52 w-52 rounded-full bg-atelier-accent/20 blur-3xl"
      />

      <div className="relative">
        <p className="font-numeral text-lg font-semibold leading-snug tracking-tight text-onmedia sm:text-xl">
          {s.inviteTitle}
        </p>
        <p className="mt-1.5 max-w-md text-xs leading-relaxed text-onmedia/60">{s.inviteBody}</p>

        {/* The link on an engraved plate — the same pill the prompt bar uses,
            inverted for the dark ground, with the actions inside the field
            rather than trailing after it. */}
        <div className="mt-4 flex items-center gap-2 rounded-full bg-black/30 py-1.5 pl-4 pr-1.5 ring-1 ring-onmedia/10">
          <input
            readOnly
            value={link}
            onFocus={(e) => e.currentTarget.select()}
            aria-label={s.inviteTitle}
            className="min-w-0 flex-1 truncate bg-transparent font-numeral text-xs tracking-wide text-onmedia/85 outline-none"
          />
          {canShare && (
            <button
              type="button"
              onClick={share}
              className="flex-none rounded-full px-3 py-1.5 text-xs font-medium text-onmedia/75 transition-opacity duration-150 hover:opacity-80"
            >
              {s.inviteShare}
            </button>
          )}
          <button
            type="button"
            onClick={copy}
            className="flex-none rounded-full bg-onmedia px-3.5 py-1.5 text-xs font-medium text-atelier-stage transition-opacity duration-150 hover:opacity-90"
          >
            {copied ? s.inviteCopied : s.inviteCopy}
          </button>
        </div>
      </div>
    </div>
  );
}
