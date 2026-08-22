"use client";

import { useState } from "react";
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

  async function toggle() {
    const next = !enabled;
    setEnabled(next);
    setPending(true);
    const formData = new FormData();
    formData.set("enabled", next ? "on" : "off");
    const result = await setMarketingEmails(formData);
    setPending(false);
    if (result.error) {
      // Roll back — the flip didn't actually save.
      setEnabled(!next);
    }
  }

  return (
    <div className="flex items-center justify-between gap-3">
      <div className="min-w-0">
        <p className="text-sm font-medium text-atelier-ink">{s.marketingEmailsLabel}</p>
        <p className="mt-0.5 text-xs text-atelier-muted">{s.marketingEmailsHelp}</p>
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
