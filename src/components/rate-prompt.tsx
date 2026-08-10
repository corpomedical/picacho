"use client";

import { useState } from "react";
import { submitFeedback, dismissRatingPrompt } from "@/lib/feedback/actions";
import { useLocale } from "@/lib/i18n/provider";
import { formatMsg } from "@/lib/i18n/format";
import { cn } from "@/lib/cn";

// Deliberately a corner card, not a modal. A modal that blocks the screen to
// ask for a favour, right after someone finally got a result they wanted, is
// the most reliable way to make them resent being asked. This sits out of
// the way and can be ignored entirely.
//
// Shown once: answering or dismissing both stamp profiles.rating_prompted_at
// (see lib/feedback/actions.ts), and the server only renders this when that
// column is null AND the account has enough successful generations to have
// an opinion worth collecting.
export function RatePrompt() {
  const { t } = useLocale();
  const r = t.rating;
  const [hovered, setHovered] = useState(0);
  const [chosen, setChosen] = useState(0);
  const [comment, setComment] = useState("");
  const [pending, setPending] = useState(false);
  const [closed, setClosed] = useState(false);
  const [thanks, setThanks] = useState(false);

  if (closed) return null;

  async function handleDismiss() {
    setClosed(true);
    await dismissRatingPrompt();
  }

  async function handleSubmit() {
    if (!chosen) return;
    setPending(true);
    await submitFeedback(comment, chosen);
    setPending(false);
    setThanks(true);
    // Left up briefly so the thank-you is actually read, rather than the
    // card vanishing the instant they click.
    setTimeout(() => setClosed(true), 2200);
  }

  return (
    <div className="fixed bottom-5 right-5 z-50 w-[min(21rem,calc(100vw-2.5rem))] rounded-[16px] border border-neutral-200 bg-white p-4 shadow-[0_16px_40px_-12px_rgba(0,0,0,0.18)] dark:border-neutral-700 dark:bg-neutral-900">
      {thanks ? (
        <p className="py-2 text-center text-sm text-neutral-700 dark:text-neutral-200">{r.thanks}</p>
      ) : (
        <>
          <div className="flex items-start justify-between gap-3">
            <p className="text-sm font-medium text-neutral-900 dark:text-neutral-100">{r.title}</p>
            <button
              type="button"
              onClick={handleDismiss}
              aria-label={r.notNow}
              className="-mr-1 -mt-1 flex-shrink-0 rounded-full p-1 text-neutral-400 transition-colors hover:bg-neutral-100 hover:text-neutral-600 dark:hover:bg-neutral-800"
            >
              <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <path d="M18 6 6 18M6 6l12 12" />
              </svg>
            </button>
          </div>

          <div className="mt-3 flex justify-center gap-1" onMouseLeave={() => setHovered(0)}>
            {[1, 2, 3, 4, 5].map((star) => (
              <button
                key={star}
                type="button"
                onClick={() => setChosen(star)}
                onMouseEnter={() => setHovered(star)}
                aria-label={formatMsg(r.starLabel, { n: star })}
                className="p-0.5 transition-transform hover:scale-110"
              >
                <svg
                  viewBox="0 0 24 24"
                  className={cn(
                    "h-7 w-7 transition-colors",
                    star <= (hovered || chosen)
                      ? "fill-amber-400 text-amber-400"
                      : "fill-transparent text-neutral-300 dark:text-neutral-600",
                  )}
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinejoin="round"
                >
                  <path d="m12 3.5 2.6 5.3 5.9.9-4.2 4.1 1 5.8-5.3-2.8-5.3 2.8 1-5.8L3.5 9.7l5.9-.9L12 3.5Z" />
                </svg>
              </button>
            ))}
          </div>

          {/* The comment box only appears once they've picked a rating —
              asking for a written note up front is what makes people close
              these without answering at all. */}
          {chosen > 0 && (
            <div className="mt-3 space-y-2.5">
              <textarea
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                rows={3}
                maxLength={2000}
                placeholder={chosen >= 4 ? r.placeholderPositive : r.placeholderCritical}
                className="w-full rounded-[10px] border border-neutral-200 px-3 py-2 text-sm text-neutral-700 outline-none transition-colors focus:border-neutral-400 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-200"
              />
              <button
                type="button"
                onClick={handleSubmit}
                disabled={pending}
                className="w-full rounded-full bg-neutral-900 py-2 text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-50 dark:bg-white dark:text-neutral-900"
              >
                {pending ? r.sending : r.send}
              </button>
            </div>
          )}

          {chosen === 0 && (
            <button
              type="button"
              onClick={handleDismiss}
              className="mt-3 w-full text-center text-xs text-neutral-400 transition-colors hover:text-neutral-600"
            >
              {r.notNow}
            </button>
          )}
        </>
      )}
    </div>
  );
}
