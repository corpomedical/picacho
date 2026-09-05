"use client";

import { useEffect, useRef, useState } from "react";
import { createClient as createBrowserSupabase } from "@/lib/supabase/client";
import { Card } from "@/components/ui/card";
import { Logo } from "@/components/logo";

// The admin second-factor challenge (2026-09-05 flaw hunt). Lives OUTSIDE
// /admin on purpose: the admin layout redirects here whenever a session with
// an enrolled factor hasn't presented it, so a page inside that layout would
// loop. Admin surfaces are English-only by existing convention.
//
// Client component because the whole exchange is a browser-side supabase-js
// conversation: challenge the TOTP factor, verify the six digits, and the
// SSR cookie session steps up to aal2 — then a full navigation lets the
// server layout re-check and let the admin through.
export default function AdminVerifyPage() {
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
        // No factor after all (unenrolled in another tab, or not signed in)
        // — the admin layout won't gate, so just go back.
        window.location.assign("/admin");
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
      setError("Couldn't start the check — try again.");
      setBusy(false);
      return;
    }
    const { error: verifyError } = await supabase.auth.mfa.verify({
      factorId,
      challengeId: challenge.id,
      code: code.trim(),
    });
    if (verifyError) {
      setError("That code didn't match — check the app and try again.");
      setBusy(false);
      return;
    }
    // Full navigation so the server-side admin layout re-reads the stepped-up
    // session from cookies rather than a cached render.
    window.location.assign("/admin");
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-neutral-50 p-8">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex justify-center">
          <Logo className="h-8" />
        </div>
        <Card>
          <h1 className="font-display text-xl font-bold tracking-[-0.02em] text-neutral-900">
            Two-step check
          </h1>
          <p className="mt-1 text-sm text-neutral-500">
            Enter the six-digit code from your authenticator app to open the admin console.
          </p>
          <form
            className="mt-6 space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              void verify();
            }}
          >
            <input
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/[^0-9]/g, "").slice(0, 6))}
              inputMode="numeric"
              autoComplete="one-time-code"
              autoFocus
              placeholder="123456"
              aria-label="Six-digit code"
              className="w-full rounded-lg border border-neutral-200 px-3 py-2 text-center font-numeral text-lg tracking-[0.4em] outline-none focus:border-neutral-400"
            />
            {error && <p className="text-sm text-red-600">{error}</p>}
            <button
              type="submit"
              disabled={!ready || busy || code.length < 6}
              className="w-full cursor-pointer rounded-lg bg-neutral-900 px-4 py-2 text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-40"
            >
              {busy ? "Checking…" : "Verify"}
            </button>
          </form>
          <button
            type="button"
            onClick={async () => {
              await createBrowserSupabase().auth.signOut();
              window.location.assign("/login");
            }}
            className="mt-6 w-full cursor-pointer text-center text-xs text-neutral-500 hover:text-neutral-900"
          >
            Sign out instead
          </button>
        </Card>
      </div>
    </main>
  );
}
