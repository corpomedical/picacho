"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { createPortal } from "react-dom";
import { writeToPerson } from "@/lib/admin/email-actions";
import { signatureHtml } from "@/lib/email/signature";
import { NOTE_MESSAGE_MAX, NOTE_SUBJECT_MAX } from "@/lib/admin/note-limits";
import { cn } from "@/lib/cn";

// "Write to them" (2026-10-03, operator: "The Write to them option takes me
// to apples Mail app. I dont want that. Make a pop up window that has
// hello@picacho.ai to write to them from the website. Add the signature we
// did."). A pop-up over the page: from Picacho <hello@picacho.ai>, to the
// person, a subject and a first draft to edit, the signature as it will
// arrive, and Send — through the site (lib/admin/ops.ts opWritePerson), so
// no mail app opens and replies come back to hello@picacho.ai.

const FROM = "Picacho <hello@picacho.ai>";

export function WriteToThemButton({
  userId,
  name,
  to,
  subject,
  message,
  label = "Write to them",
  className,
}: {
  userId: string;
  name: string;
  to: string;
  subject: string;
  message: string;
  label?: string;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className={className} onClick={() => setOpen(true)}>
        {label}
      </button>
      {open && <WriteDialog userId={userId} name={name} to={to} subject={subject} message={message} onClose={() => setOpen(false)} />}
    </>
  );
}

function WriteDialog({
  userId,
  name,
  to,
  subject: initialSubject,
  message: initialMessage,
  onClose,
}: {
  userId: string;
  name: string;
  to: string;
  subject: string;
  message: string;
  onClose: () => void;
}) {
  const [subject, setSubject] = useState(initialSubject);
  const [message, setMessage] = useState(initialMessage);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const textRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const el = textRef.current;
    if (el) {
      el.focus();
      el.setSelectionRange(el.value.length, el.value.length);
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  function send() {
    setError(null);
    start(async () => {
      const result = await writeToPerson({ userId, subject, message });
      if (result.ok) setSent(result.message);
      else setError(result.message);
    });
  }

  const field =
    "w-full rounded-[10px] border border-atelier-rule bg-atelier-surface px-3 py-2 text-[14px] text-atelier-ink outline-none focus:border-[var(--apple-blue)]";

  return createPortal(
    <div
      className="admin-apple fixed inset-0 z-[100] flex items-center justify-center p-4"
      // Inline, so it beats .admin-apple's own paper background (the class is
      // here for its colour tokens: a portal sits outside the admin layout).
      style={{ background: "rgba(0,0,0,0.35)", minHeight: 0 }}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !pending) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="write-title"
        className="flex max-h-[92vh] w-full max-w-[600px] flex-col overflow-hidden rounded-[14px] bg-atelier-surface text-left shadow-[0_20px_60px_rgba(0,0,0,0.25)]"
      >
        <div className="flex items-center justify-between border-b border-atelier-rule px-5 py-3.5">
          <h2 id="write-title" className="text-[16px] font-semibold text-atelier-ink">
            Write to {name}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="flex h-7 w-7 items-center justify-center rounded-full bg-[var(--apple-fill)] text-atelier-muted hover:text-atelier-ink"
          >
            <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden>
              <path d="M6 6l12 12M18 6 6 18" />
            </svg>
          </button>
        </div>

        {sent ? (
          <div className="flex flex-col items-center gap-2 px-6 py-10 text-center">
            <span className="flex h-11 w-11 items-center justify-center rounded-full bg-[var(--apple-green)]">
              <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="#fff" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <path d="M5 12l5 5 9-10" />
              </svg>
            </span>
            <p className="text-[15px] font-semibold text-atelier-ink">{sent}</p>
            <p className="text-[13px] text-atelier-muted">Replies come to hello@picacho.ai. It&apos;s in the activity log.</p>
            <button
              type="button"
              onClick={onClose}
              className="mt-3 inline-flex h-9 items-center rounded-full bg-[var(--apple-blue)] px-5 text-[13.5px] font-medium text-white"
            >
              Done
            </button>
          </div>
        ) : (
          <>
            <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
              <dl className="grid grid-cols-[52px_minmax(0,1fr)] gap-x-3 gap-y-1.5 text-[13.5px]">
                <dt className="text-atelier-muted">From</dt>
                <dd className="truncate text-atelier-ink">{FROM}</dd>
                <dt className="text-atelier-muted">To</dt>
                <dd className="truncate text-atelier-ink">{to}</dd>
              </dl>
              <label className="mt-3.5 block">
                <span className="mb-1 block text-xs font-semibold text-atelier-muted">Subject</span>
                <input
                  value={subject}
                  maxLength={NOTE_SUBJECT_MAX}
                  onChange={(e) => setSubject(e.target.value)}
                  className={field}
                />
              </label>
              <label className="mt-3 block">
                <span className="mb-1 block text-xs font-semibold text-atelier-muted">Message</span>
                <textarea
                  ref={textRef}
                  value={message}
                  maxLength={NOTE_MESSAGE_MAX}
                  rows={9}
                  onChange={(e) => setMessage(e.target.value)}
                  className={cn(field, "resize-y leading-[1.55]")}
                />
              </label>
              <p className="mb-1.5 mt-3 text-xs font-semibold text-atelier-muted">Signature</p>
              {/* As it arrives: the hello@ signature on white, like the email itself. */}
              <div
                className="overflow-x-auto rounded-[10px] border border-atelier-rule bg-white px-4 py-3.5"
                dangerouslySetInnerHTML={{ __html: signatureHtml() }}
              />
              {error && (
                <p role="alert" className="mt-3 text-[13px] text-[var(--apple-red-ink)]">
                  {error}
                </p>
              )}
            </div>
            <div className="flex items-center gap-2 border-t border-atelier-rule px-5 py-3">
              <p className="mr-auto text-xs text-atelier-muted">Replies come to hello@picacho.ai</p>
              <button
                type="button"
                onClick={onClose}
                disabled={pending}
                className="inline-flex h-9 items-center rounded-full bg-[var(--apple-fill)] px-4 text-[13.5px] font-medium text-[var(--apple-blue)] disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={send}
                disabled={pending || !subject.trim() || !message.trim()}
                className="inline-flex h-9 items-center rounded-full bg-[var(--apple-blue)] px-5 text-[13.5px] font-medium text-white disabled:opacity-50"
              >
                {pending ? "Sending…" : "Send"}
              </button>
            </div>
          </>
        )}
      </div>
    </div>,
    document.body,
  );
}
