"use client";

import { useCallback, useEffect, useState } from "react";
import { createClient as createBrowserSupabase } from "@/lib/supabase/client";
import { Card } from "@/components/ui/card";

// TOTP enrollment for admin accounts (2026-09-05 flaw hunt). Everything here
// is the browser-side supabase-js MFA conversation — enroll returns a QR code
// (an SVG data URI) plus the secret for manual entry; verifying one code
// activates the factor, and from then on the /admin layout requires the
// second step on every new sign-in. Admin surfaces are English-only by
// existing convention.
//
// The unenroll path deliberately stays available while signed in at aal2:
// a lost phone with no way off the gate would lock the operator out of their
// own console permanently — the recovery story IS this button.

type Factor = { id: string; status: string; friendly_name?: string | null };

export function AdminMfaCard() {
  const [factors, setFactors] = useState<Factor[] | null>(null);
  const [enrolling, setEnrolling] = useState<{
    factorId: string;
    qr: string;
    secret: string;
  } | null>(null);
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
      friendlyName: "Admin authenticator",
    });
    if (enrollError || !data) {
      setError(enrollError?.message ?? "Couldn't start enrollment — try again.");
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
      setError("Couldn't verify — try again.");
      setBusy(false);
      return;
    }
    const { error: verifyError } = await supabase.auth.mfa.verify({
      factorId: enrolling.factorId,
      challengeId: challenge.id,
      code: code.trim(),
    });
    if (verifyError) {
      setError("That code didn't match — scan again or retype it.");
      setBusy(false);
      return;
    }
    setEnrolling(null);
    setCode("");
    setBusy(false);
    await refresh();
  }

  async function unenroll(factorId: string) {
    if (
      !window.confirm(
        "Remove this authenticator? Admin sign-in goes back to password-only until a new one is enrolled.",
      )
    ) {
      return;
    }
    setBusy(true);
    setError("");
    const { error: unenrollError } = await createBrowserSupabase().auth.mfa.unenroll({ factorId });
    if (unenrollError) setError(unenrollError.message);
    setBusy(false);
    await refresh();
  }

  const verified = (factors ?? []).filter((f) => f.status === "verified");

  return (
    <Card>
      {factors === null ? (
        <p className="text-sm text-atelier-muted">Loading…</p>
      ) : enrolling ? (
        <div className="space-y-4">
          <p className="text-sm text-atelier-ink">
            Scan this with your authenticator app (Google Authenticator, 1Password, Authy…), then
            enter the six-digit code it shows.
          </p>
          {/* The QR arrives as a data URI straight from the auth server. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={enrolling.qr} alt="Authenticator QR code" className="h-44 w-44 rounded-lg bg-white p-2" />
          <p className="break-all font-mono text-[11px] text-atelier-muted">
            Manual entry key: {enrolling.secret}
          </p>
          <div className="flex items-center gap-2">
            <input
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/[^0-9]/g, "").slice(0, 6))}
              inputMode="numeric"
              autoComplete="one-time-code"
              placeholder="123456"
              aria-label="Six-digit code"
              className="w-32 rounded-control border border-atelier-rule bg-transparent px-3 py-2 text-center font-numeral tracking-[0.3em] text-atelier-ink outline-none focus:border-atelier-ink/40"
            />
            <button
              type="button"
              onClick={() => void confirmEnroll()}
              disabled={busy || code.length < 6}
              className="cursor-pointer rounded-control bg-atelier-ink px-4 py-2 text-sm font-medium text-atelier-paper transition-opacity hover:opacity-90 disabled:opacity-40"
            >
              {busy ? "Checking…" : "Activate"}
            </button>
            <button
              type="button"
              onClick={() => {
                setEnrolling(null);
                setCode("");
              }}
              className="cursor-pointer px-2 py-2 text-sm text-atelier-muted hover:text-atelier-ink"
            >
              Cancel
            </button>
          </div>
          {error && <p className="text-sm text-red-600">{error}</p>}
        </div>
      ) : verified.length > 0 ? (
        <div className="space-y-3">
          <p className="text-sm text-atelier-ink">
            Two-step verification is <span className="font-semibold">on</span>. Every new admin
            sign-in asks for a code from your authenticator app.
          </p>
          {verified.map((f) => (
            <div key={f.id} className="flex items-center justify-between gap-3 text-sm">
              <span className="text-atelier-muted">{f.friendly_name || "Authenticator app"}</span>
              <button
                type="button"
                onClick={() => void unenroll(f.id)}
                disabled={busy}
                className="cursor-pointer text-xs text-red-600 underline underline-offset-2 hover:text-red-700 disabled:opacity-40"
              >
                Remove
              </button>
            </div>
          ))}
          {error && <p className="text-sm text-red-600">{error}</p>}
        </div>
      ) : (
        <div className="space-y-3">
          <p className="text-sm text-atelier-ink">
            Two-step verification is <span className="font-semibold">off</span>. Until it&apos;s on,
            this account is one guessed or leaked password away from the whole console.
          </p>
          <button
            type="button"
            onClick={() => void startEnroll()}
            disabled={busy}
            className="cursor-pointer rounded-control bg-atelier-ink px-4 py-2 text-sm font-medium text-atelier-paper transition-opacity hover:opacity-90 disabled:opacity-40"
          >
            {busy ? "Starting…" : "Turn on two-step verification"}
          </button>
          {error && <p className="text-sm text-red-600">{error}</p>}
        </div>
      )}
    </Card>
  );
}
