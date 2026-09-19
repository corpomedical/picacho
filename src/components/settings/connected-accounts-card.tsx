"use client";

import { useCallback, useEffect, useState } from "react";
import { createClient as createBrowserSupabase } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { ValueRow } from "@/components/settings/hub/setting-rows";
import { useLocale } from "@/lib/i18n/provider";
import { localizeServerText } from "@/lib/i18n/server-text";

// Which ways this account can sign in, and the controls to add or remove
// one (2026-09-11). Two real states were unhandled before this existed: a
// password-signup user could never attach Google, and a Google-only user
// couldn't see why the password form asked for a current password they
// don't have. Linking requires "manual linking" to be enabled in the
// Supabase auth settings — when it isn't, the link call fails and the
// error line below says to try again later (the operator step is in the
// deploy notes, not user-facing copy).
//
// Rows since 2026-09-19: they sit in Settings → Security's Sign-in card
// under the email and password rows, one way in per row, and only offer
// what can be done (no greyed "Disconnect" on the only way in).

type Identity = { identity_id?: string; id: string; provider: string };

export function ConnectedAccountRows() {
  const { t } = useLocale();
  const s = t.settings;
  const [identities, setIdentities] = useState<Identity[] | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    const supabase = createBrowserSupabase();
    const { data } = await supabase.auth.getUserIdentities();
    setIdentities((data?.identities as Identity[] | undefined) ?? []);
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function linkGoogle() {
    setBusy(true);
    setError("");
    const supabase = createBrowserSupabase();
    const { error: linkError } = await supabase.auth.linkIdentity({
      provider: "google",
      options: { redirectTo: `${window.location.origin}/app/settings?tab=security` },
    });
    if (linkError) {
      setError(s.connectedError);
      setBusy(false);
    }
    // On success the browser navigates to Google; nothing more to do here.
  }

  async function unlink(identity: Identity) {
    if ((identities?.length ?? 0) < 2) {
      setError(s.connectedNeedTwo);
      return;
    }
    setBusy(true);
    setError("");
    const supabase = createBrowserSupabase();
    // supabase-js wants the full identity object back.
    const { error: unlinkError } = await supabase.auth.unlinkIdentity(
      identity as Parameters<typeof supabase.auth.unlinkIdentity>[0],
    );
    if (unlinkError) setError(s.connectedError);
    setBusy(false);
    await refresh();
  }

  if (identities === null) return null;
  const google = identities.find((i) => i.provider === "google");
  const email = identities.find((i) => i.provider === "email");

  const canRemove = identities.length > 1;
  const row = (label: string, connected: Identity | undefined, onConnect?: () => void) => (
    <ValueRow
      label={label}
      value={connected ? s.connectedOn : <span className="text-atelier-muted">{s.connectedOff}</span>}
      action={
        connected ? (
          canRemove ? (
            <Button type="button" variant="secondary" size="sm" className="min-h-8" onClick={() => unlink(connected)} disabled={busy}>
              {s.disconnect}
            </Button>
          ) : null
        ) : onConnect ? (
          <Button type="button" variant="secondary" size="sm" className="min-h-8" onClick={onConnect} pending={busy} pendingLabel={t.common.saving}>
            {s.connect}
          </Button>
        ) : null
      }
    />
  );

  return (
    <>
      {row(s.connectedGoogle, google, linkGoogle)}
      {/* The email row's "connect" is the password row right above it —
          pointing there beats a second flow that sets a password. */}
      {row(s.connectedEmail, email)}
      {error && (
        <p role="alert" className="py-3 text-sm text-atelier-accent">
          {localizeServerText(error, t)}
        </p>
      )}
    </>
  );
}
