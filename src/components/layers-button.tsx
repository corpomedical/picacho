"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { startTakeLayers } from "@/lib/generations/actions";
import { LAYERS_TIERS, LAYERS_TIER_ORDER, layersCreditCost, type LayersTier } from "@/lib/generations/layers";
import { useLocale } from "@/lib/i18n/provider";
import { formatMsg } from "@/lib/i18n/format";

// "Split into layers" on a finished image (shape B, 2026-09-03): the same
// receipt discipline as Upscale — source, resolution, the serif-ochre total
// — quoted before the button. The server re-derives price and eligibility
// from the row; everything here is preview.
export function LayersButton({ generationId, trigger = "chip" }: {
  generationId: string;
  trigger?: "chip" | "stageGhost";
}) {
  const { t } = useLocale();
  const L = t.layers;
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [tier, setTier] = useState<LayersTier>("1k");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const credits = layersCreditCost(tier);

  const start = () => {
    setError(null);
    startTransition(async () => {
      const form = new FormData();
      form.set("generation_id", generationId);
      form.set("tier", tier);
      const result = await startTakeLayers(form);
      if ("error" in result) {
        setError(result.error);
        return;
      }
      router.push(`/app/layers/${result.generationId}`);
    });
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={
          trigger === "stageGhost"
            ? "flex h-[30px] items-center gap-1.5 rounded-[8px] bg-[#1b1c20]/70 px-3 text-xs font-semibold text-[#e0a468] shadow-[inset_0_0_0_1px_rgba(224,164,104,0.5)] transition-colors hover:bg-[#1b1c20]/90"
            : "inline-flex items-center gap-1.5 rounded-[10px] bg-atelier-accent/10 px-3.5 py-1.5 text-xs font-semibold text-atelier-accent shadow-[inset_0_0_0_1px_rgba(180,90,40,0.45)] transition-colors hover:bg-atelier-accent/15"
        }
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" className="h-3.5 w-3.5" aria-hidden>
          <path d="M12 3.5 3.5 8 12 12.5 20.5 8z" />
          <path d="M3.5 12 12 16.5 20.5 12" />
          <path d="M3.5 16 12 20.5 20.5 16" />
        </svg>
        {L.cta}
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
                {L.receipt}
              </p>
              <p className="text-[11px] italic text-atelier-muted/70">{t.generate.receiptQuoted}</p>
            </div>

            <dl className="mt-4 space-y-3 border-t border-atelier-rule pt-4">
              <div>
                <dt className="text-[10px] font-semibold uppercase tracking-widest text-atelier-muted/80">{L.source}</dt>
                <dd className="mt-0.5 text-sm text-atelier-ink">{L.thisImage}</dd>
              </div>
              <div>
                <dt className="text-[10px] font-semibold uppercase tracking-widest text-atelier-muted/80">{L.output}</dt>
                <dd className="mt-1.5 flex gap-2">
                  {LAYERS_TIER_ORDER.map((option) => (
                    <button
                      key={option}
                      type="button"
                      onClick={() => setTier(option)}
                      aria-pressed={tier === option}
                      className={
                        tier === option
                          ? "rounded-[10px] bg-atelier-accent/10 px-3.5 py-2 text-sm font-semibold text-atelier-accent shadow-[inset_0_0_0_1px_rgba(180,90,40,0.45)]"
                          : "rounded-[10px] border border-atelier-rule px-3.5 py-2 text-sm text-atelier-muted transition-colors hover:text-atelier-ink"
                      }
                    >
                      {LAYERS_TIERS[option].label}
                      <span className="ml-2 font-numeral text-xs tabular-nums">
                        {formatMsg(t.generate.creditsShortN, { n: layersCreditCost(option) })}
                      </span>
                    </button>
                  ))}
                </dd>
                <dd className="mt-1.5 text-sm text-atelier-ink">
                  {formatMsg(L.outputDetail, { res: LAYERS_TIERS[tier].label })}
                </dd>
                <dd className="mt-1 text-xs text-atelier-muted">{L.countNote}</dd>
                <dd className="mt-1 text-xs text-atelier-muted">{L.linkedNote}</dd>
              </div>
            </dl>

            <div className="mt-4 flex items-end justify-between border-t border-atelier-rule pt-3">
              <p className="text-[10px] font-semibold uppercase tracking-widest text-atelier-muted/80">{t.generate.totalLabel}</p>
              <p className="font-numeral text-2xl font-semibold tabular-nums text-atelier-accent">
                {formatMsg(t.generate.durationCredits, { n: credits })}
              </p>
            </div>

            <Button className="mt-4 w-full" onClick={start} pending={pending} pendingLabel={L.starting}>
              {formatMsg(L.go, { n: credits })}
            </Button>
            {error && <p className="mt-2 text-xs text-red-600 dark:text-red-400">{error}</p>}
            <p className="mt-3 text-xs leading-relaxed text-atelier-muted">{L.footnote}</p>
            <p className="mt-1 text-xs leading-relaxed text-atelier-muted">
              <Link href="/app/settings?tab=usage" className="underline hover:text-atelier-ink">{L.topUpLink}</Link>
            </p>
          </div>
        </div>
      )}
    </>
  );
}
