"use client";

import { useState } from "react";
import Link from "next/link";
import { createApiKey, revokeApiKey } from "@/lib/api/actions";
import { SubmitButton } from "@/components/ui/submit-button";
import { LocalDate } from "@/components/local-date";
import { SettingsSection } from "@/components/settings/settings-section";
import { useLocale } from "@/lib/i18n/provider";
import { localizeServerText } from "@/lib/i18n/server-text";

// Settings → Security's last section (2026-09-19: the same card, header
// rule and hairline rows as its neighbours, the docs link opposite the
// title) + form idiom: caps label over an ink-hairline input at the control
// radius; accent only marks focus and the one-time key callout.
const LABEL = "mb-1.5 block text-[11px] font-medium uppercase tracking-widest text-atelier-muted";
const FIELD =
  "w-full rounded-control border border-atelier-rule bg-transparent px-3.5 py-2.5 text-sm text-atelier-ink placeholder:text-atelier-muted/80 outline-none transition-colors focus:border-atelier-accent";

// Settings → API keys.
//
// The plaintext key exists in exactly one place for exactly one moment: this
// component's state, right after creation. It is never stored, never fetched
// again, and the UI says so before the user has a chance to assume otherwise.

export type ApiKeyRow = {
  id: string;
  name: string;
  prefix: string;
  created_at: string;
  last_used_at: string | null;
};

export function ApiKeysCard({ keys, enabled }: { keys: ApiKeyRow[]; enabled: boolean }) {
  const { t } = useLocale();
  const k = t.apiKeys;
  const [freshKey, setFreshKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  async function handleCreate(formData: FormData) {
    setError(null);
    const result = await createApiKey(formData);
    if (result.error) setError(result.error);
    else if (result.key) {
      setFreshKey(result.key);
      setCopied(false);
    }
  }

  async function handleRevoke(formData: FormData) {
    setError(null);
    const result = await revokeApiKey(formData);
    if (result.error) setError(result.error);
  }

  return (
    <SettingsSection
      title={k.title}
      description={k.blurb}
      action={
        <Link
          href="/docs/api"
          className="text-xs font-medium text-atelier-muted underline underline-offset-2 hover:text-atelier-ink"
        >
          {k.docsLink}
        </Link>
      }
    >
      {!enabled ? (
        <p className="text-xs leading-relaxed text-atelier-muted">{k.notEnabled}</p>
      ) : (
        <>
          {freshKey && (
            <div className="rounded-control border border-atelier-accent/30 bg-atelier-accent/10 p-3.5">
              <p className="text-xs font-semibold text-atelier-accent">
                {k.freshTitle}
              </p>
              <p className="mt-2 break-all rounded-control border border-atelier-accent/20 bg-atelier-paper p-2.5 font-mono text-[11px] text-atelier-ink">
                {freshKey}
              </p>
              <div className="mt-2 flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => {
                    void navigator.clipboard.writeText(freshKey);
                    setCopied(true);
                  }}
                  className="rounded-control bg-atelier-ink px-3 py-1.5 text-[11px] font-semibold text-atelier-paper transition-opacity hover:opacity-90"
                >
                  {copied ? k.copied : k.copy}
                </button>
                <button
                  type="button"
                  onClick={() => setFreshKey(null)}
                  className="text-[11px] text-atelier-muted hover:text-atelier-ink"
                >
                  {k.done}
                </button>
              </div>
              <p className="mt-2 text-[11px] leading-relaxed text-atelier-muted">
                {k.hashNote}
              </p>
            </div>
          )}

          <div>
            {/* One key per row, hairlines between, the new-key form under
                the last one. */}
            {keys.length > 0 && (
              <ul className="-mt-3 mb-4 divide-y divide-atelier-rule/60 border-b border-atelier-rule/60">
                {keys.map((row) => (
                  <li key={row.id} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 py-3">
                    <div className="min-w-0">
                      <p className="break-words text-sm text-atelier-ink">{row.name}</p>
                      <p className="mt-0.5 text-xs text-atelier-muted">
                        <span className="font-mono">{row.prefix}…</span> · {k.created}{" "}
                        <LocalDate date={row.created_at} />
                        {row.last_used_at ? (
                          <>
                            {` · ${k.lastUsed} `}
                            <LocalDate date={row.last_used_at} mode="datetime" />
                          </>
                        ) : (
                          `· ${k.neverUsed}`
                        )}
                      </p>
                    </div>
                    <form action={handleRevoke}>
                      <input type="hidden" name="id" value={row.id} />
                      <SubmitButton variant="destructive" size="sm" pendingLabel={k.revoking}>
                        {k.revoke}
                      </SubmitButton>
                    </form>
                  </li>
                ))}
              </ul>
            )}

            <form action={handleCreate} className="flex flex-wrap items-end gap-3">
              <div className="min-w-[180px] flex-1">
                <label htmlFor="api-key-name" className={LABEL}>{k.nameLabel}</label>
                <input id="api-key-name" className={FIELD} name="name" placeholder={k.namePlaceholder} />
              </div>
              <SubmitButton
                size="sm"
                className="rounded-control! bg-atelier-ink! text-atelier-paper! shadow-none! hover:bg-atelier-ink/90!"
                pendingLabel={k.creating}
              >
                {k.createKey}
              </SubmitButton>
            </form>
          </div>
        </>
      )}

      {error && <p className="text-xs text-red-600 dark:text-red-400">{localizeServerText(error, t)}</p>}
    </SettingsSection>
  );
}
