"use client";

import { useCallback, useEffect, useState } from "react";
import { createClient as createBrowserSupabase } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { useLocale } from "@/lib/i18n/provider";

// TOTP two-step verification for EVERY account (2026-09-11) — the admin
// console has carried this since the 2026-09-05 flaw hunt (admin-mfa-card,
// which stays English-only by admin convention); this is the localized user
// card. Same browser-side supabase-js conversation: enroll returns a QR (an
// SVG data URI) plus the secret for manual entry, one verified code
// activates the factor, and /app/layout.tsx then requires the second step
// whenever a session with an enrolled factor hasn't presented it
// (/verify-2fa, the user twin of /admin-verify).
//
// Unenroll stays available while signed in — a lost phone with no way off
// the gate is a permanent lock-out, so the recovery story is this button.

type Factor = { id: string; status: string };

const FIELD =
  "w-full rounded-control border border-atelier-rule bg-transparent px-3.5 py-2.5 text-sm text-atelier-ink placeholder:text-atelier-muted/80 outline-none transition-colors focus:border-atelier-accent";

export function MfaCard() {
  const { t } = useLocale();
  const s = t.settings;
  const [factors, setFactors] = useState<Factor[] | null>(null);
  const [enrolling, setEnrolling] = useState<{ factorId: string; qr: string; secret: string } | null>(null);
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    const supabase = createBrowserSupabase();
    const { data } = await supabase.auth.mfa.listFactors();
    setFactors((data?.totp as Factor[] | undefined) ?? []);
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function startEnroll() {
    setBusy(true);
    setError("");
    const supabase = createBrowserSupabase();
    const { data, error: enrollError } = await supabase.auth.mfa.enroll({
      factorType: "totp",
      friendlyName: "Authenticator",
    });
    if (enrollError || !data) {
      setError(s.mfaErrorStart);
      setBusy(false);
      return;
    }
    setEnrolling({ factorId: data.id, qr: data.totp.qr_code, secret: data.totp.secret });
    setBusy(false);
  }

  async function confirmEnroll() {
    if (!enrolling || code.trim().length < 6) return;
    setBusy(true);
    setError("");
    const supabase = createBrowserSupabase();
    const { data: challenge, error: challengeError } = await supabase.auth.mfa.challenge({
      factorId: enrolling.factorId,
    });
    if (challengeError || !challenge) {
      setError(s.mfaErrorStart);
      setBusy(false);
      return;
    }
    const { error: verifyError } = await supabase.auth.mfa.verify({
      factorId: enrolling.factorId,
      challengeId: challenge.id,
      code: code.trim(),
    });
    if (verifyError) {
      setError(s.mfaErrorCode);
      setBusy(false);
      return;
    }
    setEnrolling(null);
    setCode("");
    setBusy(false);
    await refresh();
  }

  async function cancelEnroll() {
    if (!enrolling) return;
    const supabase = createBrowserSupabase();
    // Best-effort: an unverified factor left behind does not gate anything.
    await supabase.auth.mfa.unenroll({ factorId: enrolling.factorId }).catch(() => undefined);
    setEnrolling(null);
    setCode("");
    setError("");
  }

  async function disable(factorId: string) {
    setBusy(true);
    setError("");
    const supabase = createBrowserSupabase();
    const { error: unenrollError } = await supabase.auth.mfa.unenroll({ factorId });
    if (unenrollError) setError(s.mfaErrorOff);
    setBusy(false);
    await refresh();
  }

  const active = (factors ?? []).filter((f) => f.status === "verified");

  return (
    <div className="space-y-3">
      <div>
        <p className="text-sm font-medium text-atelier-ink">{s.mfaTitle}</p>
        <p className="mt-0.5 text-xs text-atelier-muted">{s.mfaDesc}</p>
      </div>

      {factors === null ? null : enrolling ? (
        <div className="space-y-3">
          <p className="text-sm text-atelier-ink">{s.mfaScanNote}</p>
          {/* The QR is an SVG data URI from supabase-js, not remote content. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={enrolling.qr} alt={s.mfaTitle} className="h-40 w-40 rounded-[6px] bg-white p-2" />
          <p className="break-all font-mono text-xs text-atelier-muted">{enrolling.secret}</p>
          <div>
            <label htmlFor="mfa_code" className="mb-1.5 block text-[11px] font-medium uppercase tracking-widest text-atelier-muted">
              {s.mfaCodeLabel}
            </label>
            <input
              id="mfa_code"
              className={FIELD}
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
            />
          </div>
          <div className="flex gap-2">
            <Button type="button" onClick={confirmEnroll} pending={busy} pendingLabel={t.common.saving} disabled={code.trim().length < 6}>
              {s.mfaConfirm}
            </Button>
            <Button type="button" variant="secondary" onClick={cancelEnroll} disabled={busy}>
              {s.mfaCancel}
            </Button>
          </div>
        </div>
      ) : active.length > 0 ? (
        <div className="flex items-center justify-between gap-4">
          <p className="text-sm text-atelier-ink">{s.mfaOn}</p>
          <Button type="button" variant="secondary" onClick={() => disable(active[0].id)} pending={busy} pendingLabel={t.common.saving}>
            {s.mfaDisable}
          </Button>
        </div>
      ) : (
        <Button type="button" variant="secondary" onClick={startEnroll} pending={busy} pendingLabel={t.common.saving}>
          {s.mfaEnable}
        </Button>
      )}
      {error && (
        <p role="alert" className="text-sm text-atelier-accent">
          {error}
        </p>
      )}
    </div>
  );
}
