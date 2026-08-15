"use client";

import { useEffect, useRef, useState } from "react";
import { useFormStatus } from "react-dom";
import { Button } from "@/components/ui/button";
import { useLocale } from "@/lib/i18n/provider";
import { ButtonHTMLAttributes } from "react";

type Variant = "primary" | "secondary" | "ghost" | "destructive";
type Size = "sm" | "md";

// How long the green "Saved" sits before the button returns to normal. Long
// enough to register, short enough that it's gone before the next action.
const CONFIRM_MS = 1100;

/**
 * Drop-in replacement for `<Button type="submit">` inside a native
 * `<form action={serverAction}>`.
 *
 * While the action is in flight: dimmed, locked, spinner. When it lands: a
 * brief green "Saved". Both come free to the caller — useFormStatus reports
 * the pending state of the nearest parent form, so nothing has to be threaded
 * through the server action.
 *
 * Not used on the Generate page, which has its own live progress and stop
 * controls and would be worse for a second, competing progress signal.
 */
export function SubmitButton({
  children,
  pendingLabel,
  confirmedLabel,
  confirmOnSuccess = true,
  variant,
  size,
  className,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: Variant;
  size?: Size;
  pendingLabel?: string;
  confirmedLabel?: string;
  // Off for actions where "Saved" would be the wrong word — a destructive
  // confirm, or anything that navigates somewhere else on success.
  confirmOnSuccess?: boolean;
}) {
  const { pending } = useFormStatus();
  const { t } = useLocale();
  const [confirmed, setConfirmed] = useState(false);
  // Tracks whether THIS button's form was the one that just ran, so the
  // confirmation only fires after a real submission — not on first mount.
  const wasPending = useRef(false);
  const ref = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (pending) {
      wasPending.current = true;
      setConfirmed(false);
      return;
    }
    if (!wasPending.current) return;
    wasPending.current = false;
    if (!confirmOnSuccess) return;

    setConfirmed(true);
  }, [pending, confirmOnSuccess]);

  // Self-re-arming auto-clear: while `confirmed` is true there is always a
  // timer running to turn it off. If a re-render cancels this one, the effect
  // runs again (the flag is still set) and starts another. The button can no
  // longer be left sitting on a confirmation.
  useEffect(() => {
    if (!confirmed) return;
    const id = setTimeout(() => setConfirmed(false), CONFIRM_MS);
    return () => clearTimeout(id);
  }, [confirmed]);

  // Editing the form clears the confirmation immediately, rather than making
  // the user wait out the timer before the button looks ready again. Only
  // relevant to forms that have fields at all — a suspend/reinstate toggle
  // has none, which is why correctness can't depend on this and the auto-
  // clear above has to stand on its own.
  useEffect(() => {
    const form = ref.current?.form;
    if (!form) return;
    function reset() {
      wasPending.current = false;
      setConfirmed(false);
    }
    form.addEventListener("input", reset);
    form.addEventListener("change", reset);
    return () => {
      form.removeEventListener("input", reset);
      form.removeEventListener("change", reset);
    };
  }, []);

  return (
    <Button
      ref={ref}
      type="submit"
      variant={variant}
      size={size}
      className={className}
      pending={pending}
      pendingLabel={pendingLabel ?? t.common.saving}
      confirmed={confirmed}
      confirmedLabel={confirmedLabel ?? t.common.saved}
      {...props}
    >
      {children}
    </Button>
  );
}
