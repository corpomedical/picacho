"use client";

import { useState } from "react";
import { setSkipAiRefinement } from "@/lib/profile/actions";
import { useLocale } from "@/lib/i18n/provider";
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

  async function toggle() {
    const next = !enabled;
    setEnabled(next);
    setPending(true);
    const result = await setSkipAiRefinement(next);
    setPending(false);
    if (result.error) {
      // Roll back — the flip didn't actually save.
      setEnabled(!next);
    }
  }

  return (
    <div className="flex items-center justify-between gap-3">
      <div className="min-w-0">
        <p className={cn("font-medium text-neutral-900", variant === "full" ? "text-sm" : "text-xs")}>
          {s.skipRefinementLabel}
        </p>
        <p className={cn("text-neutral-500", variant === "full" ? "mt-0.5 text-xs" : "mt-0.5 text-[11px] leading-snug")}>
          {s.skipRefinementHelp}
        </p>
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={enabled}
        aria-label={s.skipRefinementLabel}
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
