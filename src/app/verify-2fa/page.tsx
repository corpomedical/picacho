"use client";

import { useEffect, useRef, useState } from "react";
import { createClient as createBrowserSupabase } from "@/lib/supabase/client";
import { Card } from "@/components/ui/card";
import { Logo } from "@/components/logo";
import { Button } from "@/components/ui/button";
import { useLocale } from "@/lib/i18n/provider";

// The user second-factor challenge — the localized twin of /admin-verify,
// and OUTSIDE /app for the same reason that page sits outside /admin: the
// app layout redirects here whenever a session with an enrolled factor
// hasn't presented it, so a page inside that layout would loop.
export default function VerifyTwoFactorPage() {
  const { t } = useLocale();
  const s = t.settings;
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const factorIdRef = useRef<string | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const supabase = createBrowserSupabase();
    (async () => {
      const { data, error: listError } = await supabase.auth.mfa.listFactors();
      const totp = data?.totp?.find((f) => f.status === "verified") ?? data?.totp?.[0];
      if (listError || !totp) {
        // No factor after all (unenrolled in another tab, or signed out) —
        // the layout won't gate, so just go on in.
        window.location.assign("/app");
        return;
      }
      factorIdRef.current = totp.id;
      setReady(true);
    })();
  }, []);

  async function verify() {
    const factorId = factorIdRef.current;
    if (!factorId || code.trim().length < 6) return;
    setBusy(true);
    setError("");
    const supabase = createBrowserSupabase();
    const { data: challenge, error: challengeError } = await supabase.auth.mfa.challenge({ factorId });
    if (challengeError || !challenge) {
      setError(s.mfaErrorStart);
      setBusy(false);
      return;
    }
    const { error: verifyError } = await supabase.auth.mfa.verify({
      factorId,
      challengeId: challenge.id,
      code: code.trim(),
    });
    if (verifyError) {
      setError(s.mfaErrorCode);
      setBusy(false);
      return;
    }
    // Full navigation so the server layout re-checks the stepped-up cookie
    // session and lets the person through.
    window.location.assign("/app");
  }

  return (
    <main className="flex min-h-dvh items-center justify-center bg-atelier-paper p-6">
      <Card className="w-full max-w-sm space-y-4 p-6">
        <Logo className="h-6" />
        <div>
          <h1 className="text-base font-semibold text-atelier-ink">{s.mfaTitle}</h1>
          <p className="mt-1 text-sm text-atelier-muted">{s.verifyDesc}</p>
        </div>
        {ready && (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void verify();
            }}
            className="space-y-3"
          >
            <input
              className="w-full rounded-control border border-atelier-rule bg-transparent px-3.5 py-2.5 text-center font-mono text-lg tracking-[0.4em] text-atelier-ink outline-none transition-colors focus:border-atelier-accent"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              autoFocus
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
              aria-label={s.mfaCodeLabel}
            />
            {error && (
              <p role="alert" className="text-sm text-atelier-accent">
                {error}
              </p>
            )}
            <Button type="submit" className="w-full" pending={busy} pendingLabel={t.common.saving} disabled={code.trim().length < 6}>
              {s.verifyCta}
            </Button>
          </form>
        )}
      </Card>
    </main>
  );
}
