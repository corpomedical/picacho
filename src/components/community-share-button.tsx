"use client";

import { useEffect, useRef, useState } from "react";
import { useLocale } from "@/lib/i18n/provider";
import { shareToCommunity, unshareFromCommunity } from "@/lib/community/actions";
import { cn } from "@/lib/cn";

// "Share to community" on a finished render — opt-in per render, with an
// explicit confirm (your work never goes public by accident), an optional
// caption, and a one-tap way back out. Sits on the History detail page next
// to the continue actions.

function GlobeIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <circle cx="12" cy="12" r="9" />
      <path d="M3 12h18M12 3a15 15 0 0 1 0 18M12 3a15 15 0 0 0 0 18" />
    </svg>
  );
}

export function CommunityShareButton({
  generationId,
  initialShared,
  className,
}: {
  generationId: string;
  initialShared: boolean;
  className?: string;
}) {
  const { t } = useLocale();
  const c = t.community;
  const [shared, setShared] = useState(initialShared);
  const [open, setOpen] = useState(false);
  const [caption, setCaption] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onClick(e: MouseEvent) {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [open]);

  async function handleShare() {
    setBusy(true);
    setError("");
    const { error: shareError } = await shareToCommunity(generationId, caption);
    setBusy(false);
    if (shareError) {
      setError(shareError);
      return;
    }
    setShared(true);
    setOpen(false);
    setCaption("");
  }

  async function handleUnshare() {
    setBusy(true);
    const { error: unshareError } = await unshareFromCommunity(generationId);
    setBusy(false);
    if (!unshareError) setShared(false);
  }

  if (shared) {
    return (
      <button
        type="button"
        onClick={handleUnshare}
        disabled={busy}
        className={cn(
          "inline-flex items-center gap-1.5 rounded-full border border-atelier-rule bg-atelier-surface px-3.5 py-1.5 text-xs font-medium text-atelier-muted transition-colors hover:border-atelier-muted hover:text-atelier-ink disabled:opacity-50",
          className,
        )}
        title={c.unshare}
      >
        <GlobeIcon className="h-3.5 w-3.5 text-atelier-accent" />
        {c.shared}
      </button>
    );
  }

  return (
    <div ref={boxRef} className={cn("relative inline-block", className)}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="inline-flex items-center gap-1.5 rounded-full border border-atelier-rule bg-atelier-surface px-3.5 py-1.5 text-xs font-medium text-atelier-ink transition-colors hover:border-atelier-muted"
      >
        <GlobeIcon className="h-3.5 w-3.5" />
        {c.share}
      </button>
      {open && (
        <div className="absolute left-0 top-full z-30 mt-2 w-72 rounded-control border border-atelier-rule bg-atelier-surface p-3 shadow-[0_24px_48px_-12px_rgba(33,29,18,0.28)]">
          <p className="text-xs font-semibold text-atelier-ink">{c.confirmTitle}</p>
          <p className="mt-1 text-[11px] leading-relaxed text-atelier-muted">{c.confirmBody}</p>
          <input
            value={caption}
            onChange={(e) => setCaption(e.target.value)}
            placeholder={c.captionPlaceholder}
            maxLength={200}
            className="mt-2 w-full rounded-control border border-atelier-rule bg-transparent p-2 text-xs text-atelier-ink placeholder:text-atelier-muted/70 focus:border-atelier-accent focus:outline-none"
          />
          {error && <p className="mt-1.5 text-[11px] text-red-600 dark:text-red-400">{error}</p>}
          <button
            type="button"
            onClick={handleShare}
            disabled={busy}
            className="mt-2 w-full rounded-control bg-atelier-ink py-1.5 text-xs font-medium text-atelier-paper transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            {busy ? "…" : c.confirmCta}
          </button>
        </div>
      )}
    </div>
  );
}
