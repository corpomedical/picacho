"use client";

import { useFormStatus } from "react-dom";
import { Button } from "@/components/ui/button";
import { ButtonHTMLAttributes } from "react";

type Variant = "primary" | "secondary" | "ghost" | "destructive";
type Size = "sm" | "md";

// Drop-in replacement for <Button type="submit"> inside a native
// <form action={serverAction}> — shows a pending/disabled state while the
// action is in flight instead of leaving the button looking inert.
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
  return (
    <Button
      type="submit"
      variant={variant}
      size={size}
      className={className}
      disabled={pending || props.disabled}
      aria-busy={pending}
      {...props}
    >
      {pending ? (pendingLabel ?? children) : children}
    </Button>
  );
}
