import { HTMLAttributes } from "react";
import { cn } from "@/lib/cn";

export function Card({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        // The Atelier paper sheet — identical to the local sheets the app
        // screens use (see SHEET in app/settings/page.tsx): hairline rule
        // plus a whisper of lift (2026-08-21 refinement — flat boxes read
        // cheap next to ChatGPT-class chrome; popovers still float harder).
        "rounded-control border border-atelier-rule bg-atelier-surface p-8 shadow-[0_1px_2px_rgba(33,29,22,0.04),0_16px_40px_-24px_rgba(33,29,22,0.12)]",
        className,
      )}
      {...props}
    />
  );
}
