"use client";

import { useCallback, useEffect, useState } from "react";
import { createClient as createBrowserSupabase } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { useLocale } from "@/lib/i18n/provider";

// Which ways this account can sign in, and the controls to add or remove
// one (2026-09-11). Two real states were unhandled before this existed: a
// password-signup user could never attach Google, and a Google-only user
// couldn't see why the password form asked for a current password they
// don't have. Linking requires "manual linking" to be enabled in the
// Supabase auth settings — when it isn't, the link call fails and the
// error line below says to try again later (the operator step is in the
// deploy notes, not user-facing copy).

type Identity = { identity_id?: string; id: string; provider: string };

export function ConnectedAccountsCard() {
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

  const row = (label: string, connected: Identity | undefined, onConnect?: () => void) => (
    <div className="flex items-center justify-between gap-4">
      <div>
        <p className="text-sm text-atelier-ink">{label}</p>
        {connected && <p className="mt-0.5 text-xs text-atelier-muted">{s.connectedOn}</p>}
      </div>
      {connected ? (
        <Button type="button" variant="secondary" onClick={() => unlink(connected)} disabled={busy || identities.length < 2}>
          {s.disconnect}
        </Button>
      ) : onConnect ? (
        <Button type="button" variant="secondary" onClick={onConnect} pending={busy} pendingLabel={t.common.saving}>
          {s.connect}
        </Button>
      ) : null}
    </div>
  );

  return (
    <div className="space-y-3">
      <div>
        <p className="text-sm font-medium text-atelier-ink">{s.connectedTitle}</p>
        <p className="mt-0.5 text-xs text-atelier-muted">{s.connectedDesc}</p>
      </div>
      {row(s.connectedGoogle, google, linkGoogle)}
      {/* The email row's "connect" is the password form right above this
          card — pointing there beats a second flow that sets a password. */}
      {row(s.connectedEmail, email)}
      {error && (
        <p role="alert" className="text-sm text-atelier-accent">
          {error}
        </p>
      )}
    </div>
  );
}
