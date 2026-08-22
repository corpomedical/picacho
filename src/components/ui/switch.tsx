"use client";

import { cn } from "@/lib/cn";

// The app's one switch — version 2 (2026-08-21, after the operator called
// the first fix out as still unreadable on a phone). Lessons now baked in
// as HARD LITERALS, deliberately outside the theme tokens: v1 built its
// track from ink-alpha over Frost's translucent surfaces, which stacked
// into something too subtle at phone scale, and its 8px labels vanished.
// This one is bigger (58×28), the OFF track is a solid gray with an inset
// shade, ON is the ochre/amber accent, the knob is solid white with a real
// drop shadow, and the state word is 9.5px extrabold — readable on a phone
// without squinting. No theme token is used as paint anywhere in it.
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
        "relative h-7 w-[58px] flex-shrink-0 rounded-full transition-colors disabled:opacity-50",
        checked
          ? "bg-atelier-accent shadow-[inset_0_1px_2px_rgba(0,0,0,0.15)]"
          : "bg-[#d2d4da] shadow-[inset_0_1px_2px_rgba(35,37,45,0.12)] dark:bg-[#3d404b]",
      )}
    >
      <span
        aria-hidden
        className={cn(
          "pointer-events-none absolute inset-y-0 left-[9px] flex items-center text-[9.5px] font-extrabold uppercase tracking-wider transition-opacity",
          // Light theme's ochre track carries white type; dark theme's amber
          // accent is light, so the type flips dark there.
          "text-white dark:text-[#1a1c24]",
          checked ? "opacity-100" : "opacity-0",
        )}
      >
        {labelOn}
      </span>
      <span
        aria-hidden
        className={cn(
          "pointer-events-none absolute inset-y-0 right-[8px] flex items-center text-[9.5px] font-extrabold uppercase tracking-wider text-[#565a66] transition-opacity dark:text-[#b9bcc6]",
          checked ? "opacity-0" : "opacity-100",
        )}
      >
        {labelOff}
      </span>
      <span
        className={cn(
          "absolute top-0.5 h-6 w-6 rounded-full bg-[#ffffff] shadow-[0_1px_4px_rgba(0,0,0,0.35)] transition-transform",
          checked ? "translate-x-[32px]" : "translate-x-0.5",
        )}
      />
    </button>
  );
}
