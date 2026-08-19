"use client";

import { useEffect, useRef, useState } from "react";
import { submitFeedback } from "@/lib/feedback/actions";
import { cn } from "@/lib/cn";

// The "Give us your feedback" link under the composer's AI disclaimer —
// opens a small in-app popover (same visual pattern as ResultActions' report
// popover) instead of a mailto: link, so feedback lands in its own reviewable
// queue (the feedback table / /admin/feedback) rather than an inbox.

export function FeedbackLink({
  label,
  title,
  placeholder,
  submitLabel,
  sendingLabel,
  sentLabel,
  className,
}: {
  label: string;
  title: string;
  placeholder: string;
  submitLabel: string;
  sendingLabel: string;
  sentLabel: string;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const [sent, setSent] = useState(false);
  const ref = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (!open) return;
    function onClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [open]);

  async function handleSubmit() {
    setSending(true);
    setError("");
    const { error } = await submitFeedback(message);
    setSending(false);
    if (error) {
      setError(error);
      return;
    }
    setSent(true);
    setMessage("");
    setTimeout(() => {
      setOpen(false);
      setSent(false);
    }, 1400);
  }

  return (
    <span ref={ref} className="relative inline-block">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={cn(
          "underline decoration-atelier-rule underline-offset-2 transition-colors hover:text-atelier-ink",
          className,
        )}
      >
        {label}
      </button>

      {open && (
        <div
          role="dialog"
          aria-label={title}
          // Floating surface, so it carries the popover shadow (the one
          // treatment sheets don't get) — same as the sidebar settings menu.
          className="absolute bottom-full left-0 z-30 mb-2 w-72 rounded-control border border-atelier-rule bg-atelier-surface p-3 text-left shadow-[0_24px_48px_-12px_rgba(33,29,18,0.28)]"
        >
          {sent ? (
            <p className="py-2 text-center text-xs font-medium text-atelier-ink">{sentLabel}</p>
          ) : (
            <>
              <p className="text-[11px] font-medium uppercase tracking-widest text-atelier-muted">{title}</p>
              <textarea
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                placeholder={placeholder}
                rows={3}
                maxLength={2000}
                autoFocus
                className="mt-2 w-full resize-none rounded-control border border-atelier-rule bg-transparent p-2 text-xs text-atelier-ink placeholder:text-atelier-muted/60 outline-none transition-colors focus:border-atelier-accent"
              />
              {error && <p className="mt-1.5 text-[11px] text-red-600 dark:text-red-400">{error}</p>}
              <button
                type="button"
                onClick={handleSubmit}
                disabled={sending || !message.trim()}
                className="mt-2 w-full rounded-control bg-atelier-ink py-1.5 text-xs font-medium text-atelier-paper transition-colors hover:bg-atelier-ink/90 disabled:opacity-50"
              >
                {sending ? sendingLabel : submitLabel}
              </button>
            </>
          )}
        </div>
      )}
    </span>
  );
}
