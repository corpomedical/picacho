"use client";

import { useEffect, useRef, useState } from "react";
import { useLocale } from "@/lib/i18n/provider";
import {
  promoteGenerationToReference,
  setGenerationFeedback,
  type GenerationFeedback,
} from "@/lib/generations/actions";
import { reportGenerationProblem } from "@/lib/generations/reports";
import { REPORT_REASONS, type ReportReason } from "@/lib/generations/report-constants";
import { cn } from "@/lib/cn";

// Hover action row under a finished result — Copy prompt / Like / Dislike /
// Report a problem, the same idea as the icon row Claude.ai shows under a
// chat response. Sits below the media (not overlaid on it, unlike
// DownloadButton) so it reads as "actions on this result" rather than a
// media control. Shown by a parent `group` wrapper's hover/focus state — see
// SingleTurnBubble, MultiAngleResult, and the History detail page's Result
// card, all of which now carry `group`.

function CopyIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <rect x="9" y="9" width="12" height="12" rx="2" />
      <path d="M5 15H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1" />
    </svg>
  );
}

function CheckIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <path d="M20 6 9 17l-5-5" />
    </svg>
  );
}

function ThumbsUpIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <path d="M7 10v11" />
      <path d="M7 10 11 3a2 2 0 0 1 2 2v4h5.5a2 2 0 0 1 1.94 2.49l-1.6 6.5A2 2 0 0 1 16.9 20H10a3 3 0 0 1-3-3v-7Z" />
    </svg>
  );
}

function ThumbsDownIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <path d="M17 14V3" />
      <path d="M17 14 13 21a2 2 0 0 1-2-2v-4H5.5a2 2 0 0 1-1.94-2.49l1.6-6.5A2 2 0 0 1 7.1 4H14a3 3 0 0 1 3 3v7Z" />
    </svg>
  );
}

function ImagePlusIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h7" />
      <path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21" />
      <circle cx="9" cy="9" r="2" />
      <path d="M16 5h6" />
      <path d="M19 2v6" />
    </svg>
  );
}

function FlagIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V4s-1 1-4 1-5-2-8-2-4 1-4 1Z" />
      <path d="M4 22V4" />
    </svg>
  );
}

export function ResultActions({
  generationId,
  copyText,
  initialFeedback = null,
  initialReported = false,
  promotable = false,
  className,
}: {
  generationId: string;
  // What Copy puts on the clipboard — the final compiled prompt behind this
  // result, falling back to the raw prompt if a compiled one isn't available.
  copyText: string;
  initialFeedback?: GenerationFeedback;
  // Only ever passed true from the History detail page, which knows (from a
  // server-side query) whether this generation already has a report on file.
  // The live Generate composer never passes this — a result that was just
  // generated this session can't have an existing report yet.
  initialReported?: boolean;
  // Characters v2: shows the "use as reference photo" action. Passed true
  // only for image results — the server action re-validates ownership,
  // content type, and the 5-photo gallery cap regardless.
  promotable?: boolean;
  className?: string;
}) {
  const { t } = useLocale();
  const g = t.generate;
  const [copied, setCopied] = useState(false);
  const [feedback, setFeedback] = useState<GenerationFeedback>(initialFeedback);
  const [saving, setSaving] = useState(false);

  const [reportOpen, setReportOpen] = useState(false);
  const [reportReason, setReportReason] = useState<ReportReason>("wrong_result");
  const [reportDetails, setReportDetails] = useState("");
  const [reportSending, setReportSending] = useState(false);
  const [reportError, setReportError] = useState("");
  const [reported, setReported] = useState(initialReported);
  const [promoted, setPromoted] = useState(false);
  const [promoting, setPromoting] = useState(false);
  const [promoteError, setPromoteError] = useState("");
  const reportRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!reportOpen) return;
    function onClick(e: MouseEvent) {
      if (reportRef.current && !reportRef.current.contains(e.target as Node)) {
        setReportOpen(false);
      }
    }
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [reportOpen]);

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(copyText);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard permission denied or unavailable — nothing useful to do
      // beyond just not showing the "copied" confirmation.
    }
  }

  // Optimistic toggle: like/dislike are mutually exclusive, and clicking an
  // already-active one clears it back to no opinion. The UI updates
  // immediately; on failure it rolls back and surfaces the shared error copy
  // rather than silently pretending the click worked.
  async function handleFeedback(next: "like" | "dislike") {
    const previous = feedback;
    const value: GenerationFeedback = previous === next ? null : next;
    setFeedback(value);
    setSaving(true);
    const { error } = await setGenerationFeedback(generationId, value);
    setSaving(false);
    if (error) setFeedback(previous);
  }

  async function handleReportSubmit() {
    setReportSending(true);
    setReportError("");
    const { error } = await reportGenerationProblem(generationId, reportReason, reportDetails);
    setReportSending(false);
    if (error) {
      setReportError(error);
      return;
    }
    setReported(true);
    setReportOpen(false);
    setReportDetails("");
  }

  async function handlePromote() {
    setPromoting(true);
    setPromoteError("");
    const { error } = await promoteGenerationToReference(generationId);
    setPromoting(false);
    if (error) {
      setPromoteError(error);
      return;
    }
    setPromoted(true);
  }

  const reasonLabels: Record<ReportReason, string> = {
    wrong_result: g.reportReasonWrongResult,
    inappropriate: g.reportReasonInappropriate,
    technical_error: g.reportReasonTechnicalError,
    other: g.reportReasonOther,
  };

  return (
    <div
      className={cn(
        "relative mt-2 flex items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100 focus-within:opacity-100",
        reportOpen && "!opacity-100",
        className,
      )}
    >
      <button
        type="button"
        onClick={handleCopy}
        aria-label={copied ? g.copied : g.copyPrompt}
        title={copied ? g.copied : g.copyPrompt}
        className="flex h-7 w-7 items-center justify-center rounded-full text-neutral-400 transition-colors hover:bg-neutral-100 hover:text-neutral-700"
      >
        {copied ? <CheckIcon className="h-3.5 w-3.5" /> : <CopyIcon className="h-3.5 w-3.5" />}
      </button>
      <button
        type="button"
        onClick={() => handleFeedback("like")}
        disabled={saving}
        aria-label={g.likeResult}
        aria-pressed={feedback === "like"}
        title={g.likeResult}
        className={cn(
          "flex h-7 w-7 items-center justify-center rounded-full transition-colors hover:bg-neutral-100",
          feedback === "like" ? "text-neutral-900" : "text-neutral-400 hover:text-neutral-700",
        )}
      >
        <ThumbsUpIcon className="h-3.5 w-3.5" fill={feedback === "like" ? "currentColor" : "none"} />
      </button>
      <button
        type="button"
        onClick={() => handleFeedback("dislike")}
        disabled={saving}
        aria-label={g.dislikeResult}
        aria-pressed={feedback === "dislike"}
        title={g.dislikeResult}
        className={cn(
          "flex h-7 w-7 items-center justify-center rounded-full transition-colors hover:bg-neutral-100",
          feedback === "dislike" ? "text-neutral-900" : "text-neutral-400 hover:text-neutral-700",
        )}
      >
        <ThumbsDownIcon className="h-3.5 w-3.5" fill={feedback === "dislike" ? "currentColor" : "none"} />
      </button>

      {promotable && (
        <button
          type="button"
          onClick={handlePromote}
          disabled={promoting || promoted}
          aria-label={promoted ? g.referenceAdded : g.useAsReference}
          aria-pressed={promoted}
          title={promoted ? g.referenceAdded : g.useAsReference}
          className={cn(
            "flex h-7 w-7 items-center justify-center rounded-full transition-colors hover:bg-neutral-100",
            promoted ? "text-emerald-600" : "text-neutral-400 hover:text-neutral-700",
          )}
        >
          {promoted ? <CheckIcon className="h-3.5 w-3.5" /> : <ImagePlusIcon className="h-3.5 w-3.5" />}
        </button>
      )}

      <div ref={reportRef} className="relative">
        <button
          type="button"
          onClick={() => setReportOpen((v) => !v)}
          aria-label={reported ? g.reportSent : g.reportProblem}
          aria-pressed={reported}
          title={reported ? g.reportSent : g.reportProblem}
          className={cn(
            "flex h-7 w-7 items-center justify-center rounded-full transition-colors hover:bg-neutral-100",
            reported ? "text-amber-600" : "text-neutral-400 hover:text-neutral-700",
          )}
        >
          <FlagIcon className="h-3.5 w-3.5" fill={reported ? "currentColor" : "none"} />
        </button>

        {reportOpen && (
          <div
            role="dialog"
            aria-label={g.reportProblem}
            className="absolute bottom-full left-0 z-30 mb-2 w-64 rounded-[16px] border border-neutral-200 bg-white p-3 shadow-[0_16px_40px_-12px_rgba(0,0,0,0.18)]"
          >
            <p className="text-xs font-medium text-neutral-900">{g.reportTitle}</p>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {REPORT_REASONS.map((reason) => (
                <button
                  key={reason}
                  type="button"
                  onClick={() => setReportReason(reason)}
                  className={cn(
                    "rounded-full border px-2.5 py-1 text-[11px] font-medium transition-colors",
                    reportReason === reason
                      ? "border-neutral-900 bg-neutral-900 text-white"
                      : "border-neutral-200 text-neutral-600 hover:border-neutral-300",
                  )}
                >
                  {reasonLabels[reason]}
                </button>
              ))}
            </div>
            <textarea
              value={reportDetails}
              onChange={(e) => setReportDetails(e.target.value)}
              placeholder={g.reportDetailsPlaceholder}
              rows={2}
              maxLength={1000}
              className="mt-2 w-full resize-none rounded-[10px] border border-neutral-200 p-2 text-xs text-neutral-900 placeholder:text-neutral-400 focus:border-neutral-400 focus:outline-none"
            />
            {reportError && <p className="mt-1.5 text-[11px] text-red-600">{reportError}</p>}
            <button
              type="button"
              onClick={handleReportSubmit}
              disabled={reportSending}
              className="mt-2 w-full rounded-full bg-neutral-900 py-1.5 text-xs font-medium text-white transition-colors hover:bg-neutral-800 disabled:opacity-50"
            >
              {reportSending ? g.reportSending : g.reportSubmit}
            </button>
          </div>
        )}
      </div>

      {promoteError && <span className="text-[11px] text-red-600">{promoteError}</span>}
    </div>
  );
}
