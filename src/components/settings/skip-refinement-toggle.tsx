"use client";

import { useState } from "react";
import { SettingsStatus } from "@/components/settings/settings-status";
import { setSkipAiRefinement } from "@/lib/profile/actions";
import { useLocale } from "@/lib/i18n/provider";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/cn";

// Per-user preference — each account decides for itself whether ITS OWN
// generations skip the paid Claude draft + OpenAI review steps (see
// runRealPipeline's skipRefinement option). Shared between two entry points:
// the sidebar's quick settings popover (variant="compact") and the fuller
// Settings > Account page (variant="full") — same toggle, same server
// action, just different sizing to fit each spot.
export function SkipRefinementToggle({
  initialEnabled,
  variant = "full",
}: {
  initialEnabled: boolean;
  variant?: "full" | "compact";
}) {
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
    const result = await setSkipAiRefinement(next);
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
        <p className={cn("font-medium text-atelier-ink", variant === "full" ? "text-sm" : "text-xs")}>
          {s.skipRefinementLabel}
        </p>
        <p className={cn("text-atelier-muted", variant === "full" ? "mt-0.5 text-xs" : "mt-0.5 text-[11px] leading-snug")}>
          {s.skipRefinementHelp}
        </p>
        <SettingsStatus state={status.state} message={status.message} className="mt-1" />
      </div>
      <Switch
        checked={enabled}
        onChange={toggle}
        disabled={pending}
        ariaLabel={s.skipRefinementLabel}
        labelOn={t.common.toggleOn}
        labelOff={t.common.toggleOff}
      />
    </div>
  );
}
