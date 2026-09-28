"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { cn } from "@/lib/cn";
import { useLocale } from "@/lib/i18n/provider";
import { saveAppChoices } from "@/lib/light/actions";
import type { AppMode } from "@/lib/light/mode";

/**
 * Settings → Preferences: Light (one chat box) or the full studio. The
 * switch back from Light's own rail is "Switch to full studio"; this is the
 * way to Light and back from anywhere (operator, 2026-09-27).
 */
export function AppModePicker({ current }: { current: AppMode }) {
  const { t } = useLocale();
  const l = t.light;
  const router = useRouter();
  const [mode, setMode] = useState<AppMode>(current);
  const [state, setState] = useState<"idle" | "saving" | "saved" | "failed">("idle");

  async function pick(next: AppMode) {
    if (next === mode || state === "saving") return;
    setState("saving");
    const res = await saveAppChoices({ mode: next });
    if (res.error) {
      setState("failed");
      return;
    }
    setMode(next);
    setState("saved");
    // The layout picks the frame (Light's rail or the studio's sidebar).
    router.refresh();
  }

  return (
    <div className="border-t border-atelier-rule/60 pt-5">
      <p className="text-sm font-medium text-atelier-ink">{l.modeTitle}</p>
      <p className="mt-0.5 text-xs text-atelier-muted">{l.modeDesc}</p>
      <div className="mt-3 grid grid-cols-2 gap-2">
        {(["light", "advanced"] as const).map((value) => (
          <button
            key={value}
            type="button"
            aria-pressed={mode === value}
            disabled={state === "saving"}
            onClick={() => void pick(value)}
            className={cn(
              "rounded-control border px-3 py-3 text-sm transition-colors",
              mode === value
                ? "border-atelier-accent bg-atelier-accent/5 text-atelier-ink"
                : "border-atelier-rule text-atelier-muted hover:border-atelier-muted hover:text-atelier-ink",
            )}
          >
            {value === "light" ? l.modeLight : l.modeAdvanced}
          </button>
        ))}
      </div>
      {state !== "idle" && (
        <p role="status" className="mt-2 text-xs text-atelier-muted">
          {state === "saving" ? l.saving : state === "saved" ? l.modeSaved : l.saveFailed}
        </p>
      )}
    </div>
  );
}
