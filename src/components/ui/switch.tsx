"use client";

import { cn } from "@/lib/cn";

// The app's one switch, born from a Frost regression (2026-08-21, operator
// screenshots): the old inline toggles painted their knob with
// bg-atelier-surface, which Frost made TRANSLUCENT — the OFF state rendered
// as a white ghost melting into the glass. Lessons baked in here:
//   * the knob is fixed white with a real shadow (never a theme surface),
//   * the track is unmistakable in both states and both themes,
//   * the state is written INSIDE the control (operator-requested), on the
//     empty side of the knob, so on/off never needs guessing.
export function Switch({
  checked,
  onChange,
  disabled = false,
  ariaLabel,
  labelOn,
  labelOff,
}: {
  checked: boolean;
  onChange: () => void;
  disabled?: boolean;
  ariaLabel: string;
  labelOn: string;
  labelOff: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={ariaLabel}
      onClick={onChange}
      disabled={disabled}
      className={cn(
        "relative h-6 w-12 flex-shrink-0 rounded-full transition-colors disabled:opacity-50",
        checked ? "bg-atelier-accent" : "bg-atelier-ink/[0.18]",
      )}
    >
      <span
        aria-hidden
        className={cn(
          "pointer-events-none absolute inset-y-0 left-[7px] flex items-center text-[8px] font-bold uppercase tracking-wider transition-opacity",
          // Light theme's ochre track carries white type; dark theme's amber
          // track is light, so the type flips dark.
          "text-white dark:text-[#1a1c24]",
          checked ? "opacity-100" : "opacity-0",
        )}
      >
        {labelOn}
      </span>
      <span
        aria-hidden
        className={cn(
          "pointer-events-none absolute inset-y-0 right-[6px] flex items-center text-[8px] font-bold uppercase tracking-wider text-atelier-ink/55 transition-opacity",
          checked ? "opacity-0" : "opacity-100",
        )}
      >
        {labelOff}
      </span>
      <span
        className={cn(
          "absolute top-0.5 h-5 w-5 rounded-full bg-[#ffffff] shadow-[0_1px_3px_rgba(0,0,0,0.3)] transition-transform",
          checked ? "translate-x-[26px]" : "translate-x-0.5",
        )}
      />
    </button>
  );
}
