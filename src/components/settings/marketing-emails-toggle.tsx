"use client";

import { useState } from "react";
import { SettingsStatus } from "@/components/settings/settings-status";
import { setMarketingEmails } from "@/lib/profile/actions";
import { useLocale } from "@/lib/i18n/provider";
import { Switch } from "@/components/ui/switch";

// Per-user marketing-email preference — the Settings face of
// profiles.marketing_opt_out, the same flag the emailed unsubscribe link
// sets (2026-08-19). "Enabled" here means marketing email WANTED (opt-out
// false); the action receives the explicit desired state, never an invert.
// Only marketing sends honor the flag — account/service notices always
// deliver (see the service_notice path in lib/admin/email-actions.ts),
// which is exactly what the help copy promises. Same optimistic
// flip-with-rollback shape as SkipRefinementToggle beside it.
export function MarketingEmailsToggle({ initialEnabled }: { initialEnabled: boolean }) {
  const { t } = useLocale();
  const s = t.settings;
  const [enabled, setEnabled] = useState(initialEnabled);
  const [pending, setPending] = useState(false);
  // Both toggles used to roll back in silence: the switch slid back and that
  // was the entire message. SettingsStatus was built for this in the same
  // housekeeping pass and had not been adopted by anything yet.
  const [status, setStatus] = useState<{ state: "idle" | "saved" | "error"; message?: string | null }>({
    state: "idle",
  });

  async function toggle() {
    const next = !enabled;
    setEnabled(next);
    setPending(true);
    setStatus({ state: "idle" });
    const formData = new FormData();
    formData.set("enabled", next ? "on" : "off");
    const result = await setMarketingEmails(formData);
    setPending(false);
    if (result.error) {
      // Roll back AND say so — the flip didn't actually save.
      setEnabled(!next);
      setStatus({ state: "error", message: result.error });
      return;
    }
    setStatus({ state: "saved", message: t.common.saved });
  }

  return (
    <div className="flex items-center justify-between gap-3">
      <div className="min-w-0">
        <p className="text-sm font-medium text-atelier-ink">{s.marketingEmailsLabel}</p>
        <p className="mt-0.5 text-xs text-atelier-muted">{s.marketingEmailsHelp}</p>
        <SettingsStatus state={status.state} message={status.message} className="mt-1" />
      </div>
      <Switch
        checked={enabled}
        onChange={toggle}
        disabled={pending}
        ariaLabel={s.marketingEmailsLabel}
        labelOn={t.common.toggleOn}
        labelOff={t.common.toggleOff}
      />
    </div>
  );
}
