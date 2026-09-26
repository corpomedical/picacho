"use client";

import { useState } from "react";
import { SubmitButton } from "@/components/ui/submit-button";
import { LocalDate } from "@/components/local-date";
import { SettingsSection } from "@/components/settings/settings-section";
import { disconnectApp } from "@/lib/mcp/oauth/grant-actions";
import { CONNECTED_APPS_FAILED } from "@/lib/mcp/oauth/messages";
import type { McpScope } from "@/lib/mcp/oauth/config";
import { useLocale } from "@/lib/i18n/provider";
import { localizeServerText } from "@/lib/i18n/server-text";

// Settings › Security › Connected apps (Press Tour Cut 8): the apps a
// person allowed to use their account — Claude, ChatGPT, a desktop tool —
// each with where it returns to, what it may do in plain words, when it was
// connected and last used, and a Disconnect key. The same card, header rule
// and hairline rows as the API keys section beside it.
//
// Words from i18n's connectApps, in the person's language; the action's
// English answers (lib/mcp/oauth/messages.ts) go through server-text.

export type ConnectedAppRow = {
  id: string;
  appName: string;
  host: string;
  verified: boolean;
  onThisComputer: boolean;
  scopes: McpScope[];
  connectedAt: string;
  lastUsedAt: string | null;
};

function split(template: string): [string, string] {
  const i = template.indexOf("{date}");
  return i < 0 ? [template, ""] : [template.slice(0, i), template.slice(i + "{date}".length)];
}

export function ConnectedAppsCard({ apps, unavailable = false }: { apps: ConnectedAppRow[]; unavailable?: boolean }) {
  const { t } = useLocale();
  const c = t.connectApps;
  const [error, setError] = useState<string | null>(unavailable ? CONNECTED_APPS_FAILED : null);
  const [done, setDone] = useState(false);

  async function handleDisconnect(formData: FormData) {
    setError(null);
    setDone(false);
    const result = await disconnectApp(formData);
    if (result.error) setError(result.error);
    else setDone(true);
  }

  const scopeWords = (s: McpScope) => (s === "read" ? c.scopeRead : s === "brand" ? c.scopeBrand : c.scopeGenerate);
  const [connectedBefore, connectedAfter] = split(c.cardConnected);
  const [usedBefore, usedAfter] = split(c.cardLastUsed);

  return (
    <SettingsSection title={c.cardTitle} description={c.cardDesc}>
      {apps.length === 0 ? (
        <p className="text-xs leading-relaxed text-atelier-muted">{c.cardEmpty}</p>
      ) : (
        <ul className="-mt-3 divide-y divide-atelier-rule/60">
          {apps.map((app) => (
            <li key={app.id} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 py-3">
              <div className="min-w-0">
                <p className="break-words text-sm text-atelier-ink">
                  {app.appName}
                  <span className="ml-2 inline-flex items-center gap-1 text-xs text-atelier-muted">
                    {app.verified && (
                      <svg aria-hidden="true" viewBox="0 0 16 16" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M3 8.5l3 3 7-7" />
                      </svg>
                    )}
                    {app.onThisComputer ? c.cardThisComputer : app.host}
                  </span>
                </p>
                <p className="mt-0.5 text-xs text-atelier-muted">{app.scopes.map(scopeWords).join(" · ")}</p>
                <p className="mt-0.5 text-xs text-atelier-muted">
                  {connectedBefore}
                  <LocalDate date={app.connectedAt} />
                  {connectedAfter}
                  {" · "}
                  {app.lastUsedAt ? (
                    <>
                      {usedBefore}
                      <LocalDate date={app.lastUsedAt} mode="datetime" />
                      {usedAfter}
                    </>
                  ) : (
                    c.cardNeverUsed
                  )}
                </p>
              </div>
              <form action={handleDisconnect}>
                <input type="hidden" name="id" value={app.id} />
                <SubmitButton variant="destructive" size="sm" pendingLabel={c.cardRevoking}>
                  {c.cardRevoke}
                </SubmitButton>
              </form>
            </li>
          ))}
        </ul>
      )}
      {done && (
        <p role="status" className="mt-2 text-xs text-atelier-muted">
          {c.cardRevoked}
        </p>
      )}
      {error && <p className="mt-2 text-xs text-red-600 dark:text-red-400">{localizeServerText(error, t)}</p>}
    </SettingsSection>
  );
}
