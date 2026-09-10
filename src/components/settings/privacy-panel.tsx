"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useLocale } from "@/lib/i18n/provider";
import { formatMsg } from "@/lib/i18n/format";
import { localizeServerText } from "@/lib/i18n/server-text";
import { unblockUser, unshareFromCommunity } from "@/lib/community/actions";
import { COOKIE_CONSENT_KEY, getCookieConsent, type CookieConsent } from "@/lib/cookie-consent";
import { SettingsStatus } from "@/components/settings/settings-status";

// Settings → Privacy (2026-09-11): what of yours is public, who you have
// blocked, and your cookie choice — three answers that used to live nowhere.

export type SharedPostRow = {
  id: string;
  generationId: string;
  thumb: string;
  isVideo: boolean;
  text: string | null;
  hearts: number;
  createdAt: string;
};

export type BlockedRow = { blockedId: string; username: string | null };

function useSay() {
  const { t } = useLocale();
  return (serverText: string, fallback: string) => {
    const localized = localizeServerText(serverText, t);
    return localized === serverText ? fallback : localized;
  };
}

/** Everything this account has shared to the community, with one-tap removal. */
export function SharedPostsList({ initial }: { initial: SharedPostRow[] }) {
  const { t, locale } = useLocale();
  const s = t.settings;
  const say = useSay();
  const [rows, setRows] = useState(initial);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function remove(row: SharedPostRow) {
    setBusy(row.id);
    setError(null);
    const { error: err } = await unshareFromCommunity(row.generationId);
    setBusy(null);
    if (err) {
      setError(say(err, s.privacyActionFailed));
      return;
    }
    setRows((r) => r.filter((x) => x.id !== row.id));
  }

  if (rows.length === 0) return <p className="text-sm text-atelier-muted">{s.sharedPostsEmpty}</p>;

  return (
    <div>
      <ul className="divide-y divide-atelier-rule/60">
        {rows.map((row) => (
          <li key={row.id} className="flex items-center gap-3 py-3 first:pt-0 last:pb-0">
            <Link
              href={`/app/history/${row.generationId}`}
              className="relative h-14 w-14 flex-shrink-0 overflow-hidden rounded-[6px] bg-atelier-ink/10"
            >
              {row.isVideo ? (
                <video src={row.thumb} muted playsInline preload="metadata" className="h-full w-full object-cover" />
              ) : (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={row.thumb} alt="" className="h-full w-full object-cover" />
              )}
            </Link>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm text-atelier-ink">{row.text || "—"}</p>
              <p className="mt-0.5 font-numeral text-xs tabular-nums text-atelier-muted">
                {new Date(row.createdAt).toLocaleDateString(locale)} · {formatMsg(s.sharedPostsHearts, { n: row.hearts })}
              </p>
            </div>
            <button
              type="button"
              onClick={() => remove(row)}
              disabled={busy === row.id}
              className="flex-shrink-0 text-xs font-medium text-atelier-muted underline underline-offset-2 hover:text-atelier-ink disabled:opacity-50"
            >
              {s.sharedPostsRemove}
            </button>
          </li>
        ))}
      </ul>
      {error && <SettingsStatus state="error" message={error} className="mt-2" />}
    </div>
  );
}

/** Accounts this person blocked on the community feed, with Unblock. */
export function BlockedAccountsList({ initial }: { initial: BlockedRow[] }) {
  const { t } = useLocale();
  const s = t.settings;
  const say = useSay();
  const [rows, setRows] = useState(initial);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function unblock(row: BlockedRow) {
    setBusy(row.blockedId);
    setError(null);
    const { error: err } = await unblockUser(row.blockedId);
    setBusy(null);
    if (err) {
      setError(say(err, s.privacyActionFailed));
      return;
    }
    setRows((r) => r.filter((x) => x.blockedId !== row.blockedId));
  }

  if (rows.length === 0) return <p className="text-sm text-atelier-muted">{s.blockedEmpty}</p>;

  return (
    <div>
      <ul className="divide-y divide-atelier-rule/60">
        {rows.map((row) => (
          <li key={row.blockedId} className="flex items-center justify-between gap-3 py-2.5 first:pt-0 last:pb-0">
            <p className="min-w-0 truncate text-sm text-atelier-ink">{row.username ? `@${row.username}` : s.blockedUnknown}</p>
            <button
              type="button"
              onClick={() => unblock(row)}
              disabled={busy === row.blockedId}
              className="flex-shrink-0 rounded-control border border-atelier-rule px-3 py-1 text-xs font-medium text-atelier-ink transition-colors hover:bg-atelier-ink/5 disabled:opacity-50"
            >
              {s.unblock}
            </button>
          </li>
        ))}
      </ul>
      {error && <SettingsStatus state="error" message={error} className="mt-2" />}
    </div>
  );
}

/**
 * The cookie choice, revisitable (2026-09-11). Withdrawing consent must be
 * as easy as giving it; until now the only way back to the banner was
 * clearing the site's data by hand. "Change" forgets the stored answer and
 * reloads, and the banner — which shows whenever no answer is stored — asks
 * again.
 */
export function CookieChoiceControl() {
  const { t } = useLocale();
  const s = t.settings;
  const [choice, setChoice] = useState<CookieConsent | null | "loading">("loading");

  useEffect(() => {
    const id = window.setTimeout(() => setChoice(getCookieConsent()), 0);
    return () => window.clearTimeout(id);
  }, []);

  function change() {
    try {
      window.localStorage.removeItem(COOKIE_CONSENT_KEY);
    } catch {
      // Storage blocked: nothing was stored, so the banner shows anyway.
    }
    window.location.reload();
  }

  return (
    <div className="flex items-center justify-between gap-3">
      <p className="text-sm text-atelier-muted">
        {choice === "accepted" ? s.cookieAccepted : choice === "declined" ? s.cookieDeclined : choice === null ? s.cookieNone : " "}
      </p>
      <button
        type="button"
        onClick={change}
        className="flex-shrink-0 rounded-control border border-atelier-rule px-3 py-1.5 text-sm font-medium text-atelier-ink transition-colors hover:bg-atelier-ink/5"
      >
        {s.cookieChange}
      </button>
    </div>
  );
}
