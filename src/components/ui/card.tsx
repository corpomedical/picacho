import { HTMLAttributes } from "react";
import { cn } from "@/lib/cn";

export function Card({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        // The Atelier paper sheet — identical to the local sheets the app
        // screens use (see SHEET in app/settings/page.tsx): hairline rule,
        // no shadow. Sheets are flat; only popovers float.
        "rounded-control border border-atelier-rule bg-atelier-surface p-8",
        className,
      )}
      {...props}
    />
  );
}
