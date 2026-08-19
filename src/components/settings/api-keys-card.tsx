"use client";

import { useState } from "react";
import Link from "next/link";
import { createApiKey, revokeApiKey } from "@/lib/api/actions";
import { SubmitButton } from "@/components/ui/submit-button";
import { LocalDate } from "@/components/local-date";

// Atelier paper sheet + form idiom (settings-popover, extended): raised warm
// surface with hairline rules, caps label over an ink-hairline input at the
// control radius; accent only marks focus and the one-time key callout.
const SHEET = "rounded-control border border-atelier-rule bg-atelier-surface p-8";
const LABEL = "mb-1.5 block text-[11px] font-medium uppercase tracking-widest text-atelier-muted";
const FIELD =
  "w-full rounded-control border border-atelier-rule bg-transparent px-3.5 py-2.5 text-sm text-atelier-ink placeholder:text-atelier-muted/60 outline-none transition-colors focus:border-atelier-accent";

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
    <div className={SHEET}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-[11px] font-medium uppercase tracking-widest text-atelier-muted">API keys</h2>
        <Link
          href="/docs/api"
          className="text-xs font-medium text-atelier-muted underline underline-offset-2 hover:text-atelier-ink"
        >
          Read the API docs
        </Link>
      </div>
      <p className="mt-1 text-xs leading-relaxed text-atelier-muted">
        Generate images from your own software — same characters, same credits. Included with Elite.
      </p>

      {!enabled ? (
        <p className="mt-4 rounded-control border border-atelier-rule bg-atelier-paper p-3 text-xs leading-relaxed text-atelier-muted">
          API access is included with the Elite plan. Get in touch and we&apos;ll switch it on for
          this account.
        </p>
      ) : (
        <>
          {freshKey && (
            <div className="mt-4 rounded-control border border-atelier-accent/30 bg-atelier-accent/10 p-3.5">
              <p className="text-xs font-semibold text-atelier-accent">
                Copy this key now — it won&apos;t be shown again.
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
                  {copied ? "Copied" : "Copy"}
                </button>
                <button
                  type="button"
                  onClick={() => setFreshKey(null)}
                  className="text-[11px] text-atelier-muted hover:text-atelier-ink"
                >
                  Done
                </button>
              </div>
              <p className="mt-2 text-[11px] leading-relaxed text-atelier-muted">
                We only store a hash of it, so we genuinely can&apos;t show it to you again — if
                it&apos;s lost, revoke it and make another.
              </p>
            </div>
          )}

          {keys.length > 0 && (
            <ul className="mt-4 space-y-2">
              {keys.map((k) => (
                <li
                  key={k.id}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-control border border-atelier-rule/60 bg-atelier-paper p-3"
                >
                  <div className="min-w-0">
                    <p className="truncate text-xs font-semibold text-atelier-ink">{k.name}</p>
                    <p className="mt-0.5 text-[11px] text-atelier-muted">
                      <span className="font-mono">{k.prefix}…</span> · created{" "}
                      <LocalDate date={k.created_at} />
                      {k.last_used_at ? (
                        <>
                          {" · last used "}
                          <LocalDate date={k.last_used_at} mode="datetime" />
                        </>
                      ) : (
                        " · never used"
                      )}
                    </p>
                  </div>
                  <form action={handleRevoke}>
                    <input type="hidden" name="id" value={k.id} />
                    <SubmitButton variant="destructive" size="sm" pendingLabel="Revoking…">
                      Revoke
                    </SubmitButton>
                  </form>
                </li>
              ))}
            </ul>
          )}

          <form action={handleCreate} className="mt-4 flex flex-wrap items-end gap-3">
            <div className="min-w-[180px] flex-1">
              <label htmlFor="api-key-name" className={LABEL}>Name a new key</label>
              <input id="api-key-name" className={FIELD} name="name" placeholder="Batch product shots" />
            </div>
            <SubmitButton
              size="sm"
              className="rounded-control! bg-atelier-ink! text-atelier-paper! shadow-none! hover:bg-atelier-ink/90!"
              pendingLabel="Creating…"
            >
              Create key
            </SubmitButton>
          </form>
        </>
      )}

      {error && <p className="mt-3 text-xs text-red-600 dark:text-red-400">{error}</p>}
    </div>
  );
}
