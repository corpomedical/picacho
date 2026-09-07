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
    // Sits in the same family as everything around it — the card pattern its
    // neighbours use, not a dark slab. An earlier pass made this charcoal to
    // "bookend the cinema"; on a page of light frost cards it read as an
    // intruder rather than a feature. The premium comes from materials
    // instead: a serif line, an engraved field, real spacing, and one ochre
    // mark on the reward.
    <div className="rounded-card border border-atelier-rule bg-atelier-surface p-5 shadow-[0_0_0_1px_var(--frost-ring),0_16px_40px_-24px_rgba(33,29,22,0.12)] sm:p-6">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="font-numeral text-lg font-semibold leading-snug tracking-tight text-atelier-ink">
            {s.inviteTitle}
          </p>
          <p className="mt-1.5 max-w-md text-xs leading-relaxed text-atelier-muted">
            {s.inviteBody}
          </p>
        </div>
        {/* The reward, in the accent this system reserves for credits and
            scores. It is the reason to care, so it gets the one bit of colour
            on the card. */}
        <div className="flex-none text-right">
          <p className="font-numeral text-2xl font-semibold leading-none tabular-nums text-atelier-accent">
            +1
          </p>
          <p className="mt-1 text-[9px] font-semibold uppercase tracking-[0.17em] text-atelier-muted">
            {s.inviteEach}
          </p>
        </div>
      </div>

      {/* The link on an engraved plate: inset rather than raised, with the
          actions inside the field instead of trailing after it. */}
      <div className="mt-4 flex items-center gap-2 rounded-full bg-atelier-ink/[0.045] py-1.5 pl-4 pr-1.5 ring-1 ring-inset ring-atelier-rule">
        <input
          readOnly
          value={link}
          onFocus={(e) => e.currentTarget.select()}
          aria-label={s.inviteTitle}
          className="min-w-0 flex-1 truncate bg-transparent font-numeral text-xs tracking-wide text-atelier-ink outline-none"
        />
        {canShare && (
          <button
            type="button"
            onClick={share}
            className="flex-none rounded-full px-3 py-1.5 text-xs font-medium text-atelier-muted transition-opacity duration-150 hover:opacity-70"
          >
            {s.inviteShare}
          </button>
        )}
        <button
          type="button"
          onClick={copy}
          className="flex-none rounded-full bg-atelier-ink px-3.5 py-1.5 text-xs font-medium text-atelier-paper transition-opacity duration-150 hover:opacity-90"
        >
          {copied ? s.inviteCopied : s.inviteCopy}
        </button>
      </div>
    </div>
  );
}
