"use client";

import { useState } from "react";
import { signOutOtherDevices } from "@/lib/auth/actions";
import { Button } from "@/components/ui/button";
import { useLocale } from "@/lib/i18n/provider";
import { SettingsStatus } from "@/components/settings/settings-status";

// "Sign out other devices" (2026-09-11). Supabase can't enumerate sessions
// with device names for a client, so this is deliberately one honest button
// rather than a made-up device list: every session except this one is
// revoked, and any device the person still uses signs back in.
export function SessionsCard() {
  const { t } = useLocale();
  const s = t.settings;
  const [status, setStatus] = useState<"idle" | "saving" | "saved">("idle");
  const [error, setError] = useState("");

  async function run() {
    setStatus("saving");
    setError("");
    const result = await signOutOtherDevices();
    if (result.error !== null) {
      setError(result.error);
      setStatus("idle");
      return;
    }
    setStatus("saved");
  }

  return (
    <div className="space-y-3">
      <div>
        <p className="text-sm font-medium text-atelier-ink">{s.sessionsTitle}</p>
        <p className="mt-0.5 text-xs text-atelier-muted">{s.sessionsDesc}</p>
      </div>
      <SettingsStatus
        state={error ? "error" : status === "saved" ? "saved" : "idle"}
        message={error || (status === "saved" ? s.signedOutOthers : null)}
      />
      <Button type="button" variant="secondary" onClick={run} pending={status === "saving"} pendingLabel={t.common.saving}>
        {s.signOutOthers}
      </Button>
    </div>
  );
}
