"use client";

import { useState } from "react";
import { submitFeedback } from "@/lib/feedback/actions";
import { Label, Textarea } from "@/components/ui/field";
import { Button } from "@/components/ui/button";
import { useLocale } from "@/lib/i18n/provider";

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
      <div className="rounded-[10px] bg-emerald-50 px-3.5 py-2.5 text-sm text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-400">
        {c.feedbackSent}
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      <div>
        <Label htmlFor="feedback">{c.feedbackTitle}</Label>
        <Textarea
          id="feedback"
          rows={4}
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          placeholder={c.feedbackPlaceholder}
          maxLength={2000}
          disabled={pending}
        />
      </div>
      {error && <p className="text-sm text-red-600">{error}</p>}
      <div className="flex justify-end">
        <Button type="submit" disabled={pending || !message.trim()}>
          {pending ? c.feedbackSending : c.feedbackSubmit}
        </Button>
      </div>
    </form>
  );
}
