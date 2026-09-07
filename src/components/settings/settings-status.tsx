"use client";

import { cn } from "@/lib/cn";

// One way for a settings form to say what happened (2026-09-07).
//
// The survey found SIX idioms in use, two of them inside the same card: a
// button relabelled "Saved", a grey note paragraph, a green line, a banner
// after a full page reload, whole-form replacement, and a notice plus
// router.refresh(). UsernameForm reported inline while ProfileForm directly
// below it reloaded the page.
//
// So: one component, three states, and a rule — success is stated in words,
// never by colour alone, because a green line is invisible to anyone who
// cannot see green and to anyone who was not looking at that moment.
//
// role="status" with aria-live="polite" so a screen reader hears the result
// without the focus being stolen mid-form.

export function SettingsStatus({
  state,
  message,
  className,
}: {
  state: "idle" | "saved" | "error";
  message?: string | null;
  className?: string;
}) {
  if (state === "idle" || !message) {
    // Still rendered, still announced when it fills — a live region that is
    // mounted only on success announces nothing in several screen readers.
    return <p role="status" aria-live="polite" className="sr-only" />;
  }
  return (
    <p
      role="status"
      aria-live="polite"
      className={cn(
        "flex items-center gap-1.5 text-xs leading-relaxed",
        state === "error" ? "text-atelier-accent" : "text-atelier-muted",
        className,
      )}
    >
      <span
        aria-hidden
        className={cn(
          "h-1.5 w-1.5 flex-none rounded-full",
          state === "error" ? "bg-atelier-accent" : "bg-atelier-ink/35",
        )}
      />
      {message}
    </p>
  );
}
