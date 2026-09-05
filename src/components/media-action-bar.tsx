"use client";

import { useEffect, useRef, useState } from "react";
import { useLocale } from "@/lib/i18n/provider";
import { isNativeAppClient } from "@/lib/native/platform";
import { capPlugin } from "@/lib/native/bridge";
import { downloadResult, downloadResultNative } from "@/components/download-button";
import { deleteGeneration } from "@/lib/generations/actions";
import { reportGenerationProblem } from "@/lib/generations/reports";
import { REPORT_REASONS, type ReportReason } from "@/lib/generations/report-constants";
import { cn } from "@/lib/cn";

// The control pill for the expanded media viewer — share / copy / download /
// report / delete, the row every phone gallery puts under an opened photo
// (operator-requested 2026-08-21, straight from an Android screenshot).
// Chrome rides the onmedia family: this floats on the shared black viewer
// backdrop in both themes, so theme-mapped colors would be wrong here.
//
// Report and delete only render when a generationId is provided AND the
// caller says the viewer's user owns it — the server actions re-check
// ownership regardless; the props just decide what's worth showing.

function ShareIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <path d="M12 3v12" />
      <path d="m8 7 4-4 4 4" />
      <path d="M5 12v7a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-7" />
    </svg>
  );
}
function CopyIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <rect x="9" y="9" width="12" height="12" rx="2.5" />
      <path d="M5 15H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1" />
    </svg>
  );
}
function DownloadIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <path d="M12 3v12m0 0-4-4m4 4 4-4M4 21h16" />
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
function TrashIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <path d="M3 6h18" />
      <path d="M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2" />
      <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
      <path d="M10 11v6M14 11v6" />
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

function absoluteUrl(url: string): string {
  try {
    return new URL(url, window.location.origin).toString();
  } catch {
    return url;
  }
}

// Copy the actual pixels when the platform allows it (Chrome's clipboard
// only takes PNG, so anything else is re-encoded through a canvas first);
// fall back to copying a link. Returns which one happened, for the toast.
async function copyImageToClipboard(url: string): Promise<"image" | "link"> {
  try {
    if (typeof ClipboardItem !== "undefined" && navigator.clipboard?.write) {
      const blob = await (await fetch(url)).blob();
      let png = blob;
      if (blob.type !== "image/png") {
        png = await new Promise<Blob>((resolve, reject) => {
          const img = new Image();
          const objectUrl = URL.createObjectURL(blob);
          img.onload = () => {
            const c = document.createElement("canvas");
            c.width = img.naturalWidth;
            c.height = img.naturalHeight;
            const ctx = c.getContext("2d");
            if (!ctx) return reject(new Error("no canvas"));
            ctx.drawImage(img, 0, 0);
            c.toBlob((b) => (b ? resolve(b) : reject(new Error("encode failed"))), "image/png");
            URL.revokeObjectURL(objectUrl);
          };
          img.onerror = () => {
            URL.revokeObjectURL(objectUrl);
            reject(new Error("decode failed"));
          };
          img.src = objectUrl;
        });
      }
      await navigator.clipboard.write([new ClipboardItem({ "image/png": png })]);
      return "image";
    }
  } catch {
    // fall through to the link path
  }
  await navigator.clipboard.writeText(absoluteUrl(url));
  return "link";
}

export function MediaActionBar({
  url,
  contentType,
  generationId,
  ownerActions = false,
  // Server pages can't hand a client component a callback, so the redirect
  // is a plain string; client callers may pass onDeleted instead (or too).
  redirectAfterDelete,
  onDeleted,
  className,
}: {
  url: string;
  contentType: "image" | "video";
  generationId?: string;
  ownerActions?: boolean;
  redirectAfterDelete?: string;
  onDeleted?: () => void;
  className?: string;
}) {
  const { t } = useLocale();
  const g = t.generate;
  const [toast, setToast] = useState("");
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);
  const [reportReason, setReportReason] = useState<ReportReason>("wrong_result");
  const [reportDetails, setReportDetails] = useState("");
  const [reportSending, setReportSending] = useState(false);
  const [reported, setReported] = useState(false);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const confirmTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (toastTimer.current) clearTimeout(toastTimer.current);
      if (confirmTimer.current) clearTimeout(confirmTimer.current);
    },
    [],
  );

  function flash(message: string) {
    setToast(message);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(""), 1800);
  }

  function filename() {
    return `picacho-${contentType}-${Date.now()}.${contentType === "video" ? "mp4" : "png"}`;
  }

  async function handleShare() {
    // Native: the system share sheet with the real file — same plumbing as
    // download, which is exactly what sharing means on Android.
    if (isNativeAppClient()) {
      try {
        if (await downloadResultNative(url, filename())) return;
      } catch {
        // fall through to web paths
      }
    }
    const link = absoluteUrl(url);
    if (navigator.share) {
      try {
        await navigator.share({ url: link });
        return;
      } catch {
        // cancelled or unsupported payload — fall through
      }
    }
    try {
      await navigator.clipboard.writeText(link);
      flash(g.linkCopied);
    } catch {
      // nothing left to try
    }
  }

  async function handleCopy() {
    if (contentType === "video") {
      try {
        await navigator.clipboard.writeText(absoluteUrl(url));
        flash(g.linkCopied);
      } catch {
        // ignore
      }
      return;
    }
    const what = await copyImageToClipboard(url);
    flash(what === "image" ? g.copied : g.linkCopied);
  }

  const downloadBusyRef = useRef(false);
  async function handleDownload() {
    // Same one-at-a-time guard as DownloadButton — the toast stack shows
    // progress; this stops the five-copies stampede.
    if (downloadBusyRef.current) return;
    downloadBusyRef.current = true;
    const name = filename();
    try {
      if (isNativeAppClient()) {
        const handled = await downloadResultNative(url, name).catch(() => false);
        if (!handled) await downloadResult(url, name);
      } else {
        await downloadResult(url, name);
      }
    } finally {
      downloadBusyRef.current = false;
    }
  }

  async function handleDelete() {
    if (!generationId) return;
    if (!confirmingDelete) {
      setConfirmingDelete(true);
      flash(g.deleteConfirm);
      if (confirmTimer.current) clearTimeout(confirmTimer.current);
      confirmTimer.current = setTimeout(() => setConfirmingDelete(false), 3000);
      return;
    }
    setDeleting(true);
    const formData = new FormData();
    formData.set("id", generationId);
    const { error } = await deleteGeneration(formData);
    setDeleting(false);
    setConfirmingDelete(false);
    if (error) {
      flash(error);
      return;
    }
    onDeleted?.();
    if (redirectAfterDelete) window.location.href = redirectAfterDelete;
  }

  async function handleReportSubmit() {
    if (!generationId) return;
    setReportSending(true);
    const { error } = await reportGenerationProblem(generationId, reportReason, reportDetails);
    setReportSending(false);
    if (error) {
      flash(error);
      return;
    }
    setReported(true);
    setReportOpen(false);
    setReportDetails("");
    flash(g.reportSent);
  }

  const reasonLabels: Record<ReportReason, string> = {
    wrong_result: g.reportReasonWrongResult,
    inappropriate: g.reportReasonInappropriate,
    technical_error: g.reportReasonTechnicalError,
    other: g.reportReasonOther,
  };

  const btn =
    "flex h-10 w-10 items-center justify-center rounded-full text-onmedia/90 transition-colors hover:bg-onmedia/10 hover:text-onmedia";

  return (
    <div className={cn("relative flex flex-col items-center", className)}>
      {toast && (
        <div className="pointer-events-none absolute -top-9 whitespace-nowrap rounded-full bg-black/90 px-3 py-1 text-xs text-onmedia backdrop-blur-sm">
          {toast}
        </div>
      )}
      {reportOpen && generationId && (
        <div
          role="dialog"
          aria-label={g.reportProblem}
          onClick={(e) => e.stopPropagation()}
          className="absolute bottom-full mb-3 w-64 rounded-control border border-atelier-rule bg-atelier-surface p-3 shadow-[0_24px_48px_-12px_rgba(33,29,18,0.4)]"
        >
          <p className="text-xs font-medium text-atelier-ink">{g.reportTitle}</p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {REPORT_REASONS.map((reason) => (
              <button
                key={reason}
                type="button"
                onClick={() => setReportReason(reason)}
                className={cn(
                  "rounded-full border px-2.5 py-1 text-[11px] font-medium transition-colors",
                  reportReason === reason
                    ? "border-atelier-ink bg-atelier-ink text-atelier-paper"
                    : "border-atelier-rule text-atelier-muted hover:border-atelier-muted",
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
            className="mt-2 w-full resize-none rounded-control border border-atelier-rule bg-transparent p-2 text-xs text-atelier-ink placeholder:text-atelier-muted/80 focus:border-atelier-accent focus:outline-none"
          />
          <button
            type="button"
            onClick={handleReportSubmit}
            disabled={reportSending}
            className="mt-2 w-full rounded-control bg-atelier-ink py-1.5 text-xs font-medium text-atelier-paper transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            {reportSending ? g.reportSending : g.reportSubmit}
          </button>
        </div>
      )}
      <div
        onClick={(e) => e.stopPropagation()}
        className="flex items-center gap-1 rounded-full bg-black/85 px-2 py-1.5 shadow-[0_12px_32px_-8px_rgba(0,0,0,0.55)] backdrop-blur-md"
      >
        <button type="button" onClick={handleShare} aria-label={g.shareResult} title={g.shareResult} className={btn}>
          <ShareIcon className="h-[18px] w-[18px]" />
        </button>
        <button type="button" onClick={handleCopy} aria-label={g.copyImage} title={g.copyImage} className={btn}>
          <CopyIcon className="h-[18px] w-[18px]" />
        </button>
        <button type="button" onClick={handleDownload} aria-label={g.download} title={g.download} className={btn}>
          <DownloadIcon className="h-[18px] w-[18px]" />
        </button>
        {generationId && ownerActions && (
          <>
            <button
              type="button"
              onClick={() => setReportOpen((v) => !v)}
              aria-label={reported ? g.reportSent : g.reportProblem}
              aria-pressed={reported}
              title={reported ? g.reportSent : g.reportProblem}
              className={cn(btn, reported && "text-amber-400 hover:text-amber-400")}
            >
              {reported ? <CheckIcon className="h-[18px] w-[18px]" /> : <FlagIcon className="h-[18px] w-[18px]" />}
            </button>
            <button
              type="button"
              onClick={handleDelete}
              disabled={deleting}
              aria-label={confirmingDelete ? g.deleteConfirm : g.deleteResult}
              title={confirmingDelete ? g.deleteConfirm : g.deleteResult}
              className={cn(btn, confirmingDelete && "bg-red-500/20 text-red-400 hover:bg-red-500/30 hover:text-red-300")}
            >
              <TrashIcon className={cn("h-[18px] w-[18px]", deleting && "animate-pulse")} />
            </button>
          </>
        )}
      </div>
    </div>
  );
}
