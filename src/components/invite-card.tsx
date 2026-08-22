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
    <div>
      <p className="text-sm font-medium text-atelier-ink">{s.inviteTitle}</p>
      <p className="mt-1 text-xs leading-relaxed text-atelier-muted">{s.inviteBody}</p>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <input
          readOnly
          value={link}
          onFocus={(e) => e.currentTarget.select()}
          className="min-w-0 flex-1 rounded-control border border-atelier-rule bg-transparent px-2.5 py-1.5 font-numeral text-xs text-atelier-ink outline-none"
        />
        <button
          type="button"
          onClick={copy}
          className="flex-shrink-0 rounded-control bg-atelier-ink px-3 py-1.5 text-xs font-medium text-atelier-paper transition-opacity hover:opacity-90"
        >
          {copied ? s.inviteCopied : s.inviteCopy}
        </button>
        {canShare && (
          <button
            type="button"
            onClick={share}
            className="flex-shrink-0 rounded-control border border-atelier-rule px-3 py-1.5 text-xs font-medium text-atelier-ink transition-colors hover:bg-atelier-ink/5"
          >
            {s.inviteShare}
          </button>
        )}
      </div>
    </div>
  );
}
