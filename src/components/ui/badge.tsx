import { HTMLAttributes } from "react";
import { cn } from "@/lib/cn";

type Tone = "neutral" | "success" | "warning" | "danger";

// Neutral is an Atelier hairline paper chip; the semantic tones keep their
// calm tinted fills (with explicit dark: twins — reds/greens/ambers are not
// atelier tokens, so they don't flip on their own). Every tone declares a
// border color so chips sitting side by side stay the same height.
const tones: Record<Tone, string> = {
  neutral: "border-atelier-rule bg-atelier-paper text-atelier-muted",
  success: "border-transparent bg-emerald-50 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-400",
  warning: "border-transparent bg-amber-50 text-amber-700 dark:bg-amber-500/15 dark:text-amber-400",
  danger: "border-transparent bg-red-50 text-red-700 dark:bg-red-500/15 dark:text-red-400",
};

export function Badge({
  tone = "neutral",
  className,
  ...props
}: HTMLAttributes<HTMLSpanElement> & { tone?: Tone }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-medium",
        tones[tone],
        className,
      )}
      {...props}
    />
  );
}
