"use client";

import { useState } from "react";
import Link from "next/link";
import { createApiKey, revokeApiKey } from "@/lib/api/actions";
import { Card } from "@/components/ui/card";
import { Input, Label } from "@/components/ui/field";
import { SubmitButton } from "@/components/ui/submit-button";
import { LocalDate } from "@/components/local-date";

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
    <Card>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-sm font-semibold text-neutral-900">API keys</h2>
        <Link
          href="/docs/api"
          className="text-xs font-medium text-ochre underline underline-offset-2"
        >
          Read the API docs
        </Link>
      </div>
      <p className="mt-1 text-xs leading-relaxed text-neutral-500">
        Generate images from your own software — same characters, same credits. Included with Elite.
      </p>

      {!enabled ? (
        <p className="mt-4 rounded-[12px] border border-neutral-200 bg-neutral-50 p-3 text-xs leading-relaxed text-neutral-500">
          API access is included with the Elite plan. Get in touch and we&apos;ll switch it on for
          this account.
        </p>
      ) : (
        <>
          {freshKey && (
            <div className="mt-4 rounded-[12px] border border-ochre/30 bg-ochre-soft/40 p-3.5">
              <p className="text-xs font-semibold text-ochre">
                Copy this key now — it won&apos;t be shown again.
              </p>
              <p className="mt-2 break-all rounded-[8px] border border-ochre/20 bg-white p-2.5 font-mono text-[11px] text-neutral-800">
                {freshKey}
              </p>
              <div className="mt-2 flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => {
                    void navigator.clipboard.writeText(freshKey);
                    setCopied(true);
                  }}
                  className="rounded-[8px] bg-ochre px-3 py-1.5 text-[11px] font-semibold text-white transition-colors hover:bg-ochre-deep"
                >
                  {copied ? "Copied" : "Copy"}
                </button>
                <button
                  type="button"
                  onClick={() => setFreshKey(null)}
                  className="text-[11px] text-neutral-500 hover:text-neutral-800"
                >
                  Done
                </button>
              </div>
              <p className="mt-2 text-[11px] leading-relaxed text-neutral-500">
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
                  className="flex flex-wrap items-center justify-between gap-2 rounded-[12px] border border-neutral-100 bg-neutral-50/60 p-3"
                >
                  <div className="min-w-0">
                    <p className="truncate text-xs font-semibold text-neutral-900">{k.name}</p>
                    <p className="mt-0.5 text-[11px] text-neutral-500">
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
              <Label htmlFor="api-key-name">Name a new key</Label>
              <Input id="api-key-name" name="name" placeholder="Batch product shots" />
            </div>
            <SubmitButton size="sm" pendingLabel="Creating…">
              Create key
            </SubmitButton>
          </form>
        </>
      )}

      {error && <p className="mt-3 text-xs text-red-600">{error}</p>}
    </Card>
  );
}
