"use client";

import { useState } from "react";
import { submitFeedback } from "@/lib/feedback/actions";
import { Button } from "@/components/ui/button";
import { useLocale } from "@/lib/i18n/provider";

// Atelier form idiom (settings-popover, extended): caps label over an
// ink-hairline field at the control radius; accent only marks focus.
const LABEL = "mb-1.5 block text-[11px] font-medium uppercase tracking-widest text-atelier-muted";
const FIELD =
  "w-full resize-none rounded-control border border-atelier-rule bg-transparent px-3.5 py-2.5 text-sm text-atelier-ink placeholder:text-atelier-muted/60 outline-none transition-colors focus:border-atelier-accent";

// Replaces the mailto: link that used to sit here. A mailto is a dead end:
// it depends on the person having a mail client configured, it drops them
// out of the product, and whatever they write lands in an inbox instead of
// the /admin/feedback queue that already exists to review this.
export function FeedbackForm() {
  const { t } = useLocale();
  const c = t.common;
  const [message, setMessage] = useState("");
  const [pending, setPending] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!message.trim()) return;
    setPending(true);
    setError(null);
    const result = await submitFeedback(message);
    setPending(false);
    if (result.error) {
      setError(result.error);
      return;
    }
    setMessage("");
    setSent(true);
  }

  if (sent) {
    return (
      <div className="rounded-control border border-emerald-600/25 bg-emerald-500/10 px-3.5 py-2.5 text-sm text-emerald-700 dark:text-emerald-400">
        {c.feedbackSent}
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      <div>
        <label htmlFor="feedback" className={LABEL}>{c.feedbackTitle}</label>
        <textarea
          id="feedback"
          className={FIELD}
          rows={4}
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          placeholder={c.feedbackPlaceholder}
          maxLength={2000}
          disabled={pending}
        />
      </div>
      {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
      <div className="flex justify-end">
        <Button
          type="submit"
          className="rounded-control! bg-atelier-ink! text-atelier-paper! shadow-none! hover:bg-atelier-ink/90!"
          disabled={!message.trim()}
          pending={pending}
          pendingLabel={c.feedbackSending}
        >
          {c.feedbackSubmit}
        </Button>
      </div>
    </form>
  );
}
