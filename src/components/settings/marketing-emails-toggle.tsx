"use client";

import { useState } from "react";
import { setMarketingEmails } from "@/lib/profile/actions";
import { useLocale } from "@/lib/i18n/provider";
import { cn } from "@/lib/cn";

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
        <p className="text-sm font-medium text-neutral-900">{s.marketingEmailsLabel}</p>
        <p className="mt-0.5 text-xs text-neutral-500">{s.marketingEmailsHelp}</p>
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={enabled}
        aria-label={s.marketingEmailsLabel}
        onClick={toggle}
        disabled={pending}
        className={cn(
          "relative h-6 w-11 flex-shrink-0 rounded-full transition-colors disabled:opacity-50",
          enabled ? "bg-neutral-900" : "bg-neutral-200",
        )}
      >
        <span
          className={cn(
            "absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform",
            enabled ? "translate-x-[22px]" : "translate-x-0.5",
          )}
        />
      </button>
    </div>
  );
}
