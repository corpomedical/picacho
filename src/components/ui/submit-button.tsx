"use client";

import { useFormStatus } from "react-dom";
import { Button } from "@/components/ui/button";
import { useLocale } from "@/lib/i18n/provider";
import { ButtonHTMLAttributes } from "react";

type Variant = "primary" | "secondary" | "ghost" | "destructive";
type Size = "sm" | "md";

/**
 * Drop-in replacement for `<Button type="submit">` inside a native
 * `<form action={serverAction}>`: dimmed, locked and spinning while the
 * action is in flight.
 *
 * useFormStatus reports the pending state of the nearest parent form, so
 * nothing has to be threaded through the server action — and because the
 * state is derived rather than stored, it cannot get stuck. An earlier
 * version added a green "Saved" afterwards; that needed its own timers to
 * clear, and any missed timer left the button stranded mid-celebration. The
 * page updating IS the confirmation.
 *
 * Not used on the Generate page, which has its own live progress and stop
 * controls and would be worse for a second, competing progress signal.
 */
export function SubmitButton({
  children,
  pendingLabel,
  variant,
  size,
  className,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: Variant;
  size?: Size;
  pendingLabel?: string;
}) {
  const { pending } = useFormStatus();
  const { t } = useLocale();

  return (
    <Button
      type="submit"
      variant={variant}
      size={size}
      className={className}
      pending={pending}
      pendingLabel={pendingLabel ?? t.common.saving}
      {...props}
    >
      {children}
    </Button>
  );
}
