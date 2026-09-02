"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { startTakeUpscale } from "@/lib/generations/actions";
import { useLocale } from "@/lib/i18n/provider";
import { formatMsg } from "@/lib/i18n/format";

// The History-detail "Upscale to 1080p" action (design board A, operator-
// approved 2026-09-02): an ochre-armed chip that opens the upscale receipt —
// source, the FIXED precise mode, output, and the serif-ochre total — quoted
// before the button, like every other spend in the product. The server
// re-derives price and eligibility from the row; everything here is preview.
export function UpscaleButton({ generationId, seconds, credits }: {
  generationId: string;
  seconds: number;
  credits: number;
}) {
  const { t } = useLocale();
  const h = t.history;
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const start = () => {
    setError(null);
    startTransition(async () => {
      const form = new FormData();
      form.set("generation_id", generationId);
      const result = await startTakeUpscale(form);
      if ("error" in result) {
        setError(result.error);
        return;
      }
      // The new take lives in History (board B) — land where it renders.
      router.push("/app/history");
    });
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1.5 rounded-[10px] bg-atelier-accent/10 px-3.5 py-1.5 text-xs font-semibold text-atelier-accent shadow-[inset_0_0_0_1px_rgba(180,90,40,0.45)] transition-colors hover:bg-atelier-accent/15"
      >
        {h.upscaleCta}
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          onClick={() => !pending && setOpen(false)}
        >
          <div
            className="w-full max-w-md rounded-control border border-atelier-rule bg-atelier-paper p-6 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-baseline justify-between">
              <p className="text-[11px] font-semibold uppercase tracking-widest text-atelier-muted">
                {h.upscaleReceipt}
              </p>
              <p className="text-[11px] italic text-atelier-muted/70">{t.generate.receiptQuoted}</p>
            </div>

            <dl className="mt-4 space-y-3 border-t border-atelier-rule pt-4">
              <div>
                <dt className="text-[10px] font-semibold uppercase tracking-widest text-atelier-muted/80">
                  {h.upscaleSource}
                </dt>
                <dd className="mt-0.5 text-sm text-atelier-ink">
                  {h.upscaleThisTake} · <span className="font-numeral tabular-nums">{seconds}s</span>
                </dd>
              </div>
              <div>
                <dt className="text-[10px] font-semibold uppercase tracking-widest text-atelier-muted/80">
                  {h.upscaleMode}
                </dt>
                <dd className="mt-0.5 text-sm text-atelier-ink">{h.upscaleModePrecise}</dd>
              </div>
              <div>
                <dt className="text-[10px] font-semibold uppercase tracking-widest text-atelier-muted/80">
                  {h.upscaleOutput}
                </dt>
                <dd className="mt-0.5 text-sm text-atelier-ink">{h.upscaleOutputDetail}</dd>
                <dd className="mt-1 text-xs text-atelier-muted">{h.upscaleLinkedNote}</dd>
              </div>
            </dl>

            <div className="mt-4 flex items-end justify-between border-t border-atelier-rule pt-3">
              <p className="text-[10px] font-semibold uppercase tracking-widest text-atelier-muted/80">
                {t.generate.totalLabel}
              </p>
              <p className="font-numeral text-2xl font-semibold tabular-nums text-atelier-accent">
                {formatMsg(t.generate.durationCredits, { n: credits })}
              </p>
            </div>

            <Button className="mt-4 w-full" onClick={start} pending={pending} pendingLabel={h.upscaleStarting}>
              {formatMsg(h.upscaleGo, { n: credits })}
            </Button>
            {error && <p className="mt-2 text-xs text-red-600 dark:text-red-400">{error}</p>}
            <p className="mt-3 text-xs leading-relaxed text-atelier-muted">{h.upscaleFootnote}</p>
          </div>
        </div>
      )}
    </>
  );
}
