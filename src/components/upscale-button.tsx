"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { startTakeUpscale } from "@/lib/generations/actions";
import { UPSCALE_TIERS, upscaleCreditCost, type UpscaleTier } from "@/lib/generations/upscale";
import { useLocale } from "@/lib/i18n/provider";
import { formatMsg } from "@/lib/i18n/format";

// The History-detail "Upscale to 1080p" action (design board A, operator-
// approved 2026-09-02): an ochre-armed chip that opens the upscale receipt —
// source, the FIXED precise mode, output, and the serif-ochre total — quoted
// before the button, like every other spend in the product. The server
// re-derives price and eligibility from the row; everything here is preview.
export function UpscaleButton({ generationId, seconds, tiers, trigger = "chip" }: {
  generationId: string;
  seconds: number;
  /** The tiers this take's real source height can reach, cheapest first —
   *  computed by the caller from the same module the action uses. */
  tiers: UpscaleTier[];
  /** "chip" = the light-surface ochre chip (History, the Upscale page);
   *  "stageGhost" = the dark ghost pill for the stage's corner cluster —
   *  stage colors are theme-invariant literals, like every stage control. */
  trigger?: "chip" | "stageGhost";
}) {
  const { t } = useLocale();
  const h = t.history;
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [tier, setTier] = useState<UpscaleTier>(tiers[0]);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const credits = upscaleCreditCost(seconds, tier);

  const start = () => {
    setError(null);
    startTransition(async () => {
      const form = new FormData();
      form.set("generation_id", generationId);
      form.set("tier", tier);
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
        className={
          trigger === "stageGhost"
            ? "flex h-[30px] items-center gap-1.5 rounded-[8px] bg-[#1b1c20]/70 px-3 text-xs font-semibold text-[#e0a468] shadow-[inset_0_0_0_1px_rgba(224,164,104,0.5)] transition-colors hover:bg-[#1b1c20]/90"
            : "inline-flex items-center gap-1.5 rounded-[10px] bg-atelier-accent/10 px-3.5 py-1.5 text-xs font-semibold text-atelier-accent shadow-[inset_0_0_0_1px_rgba(180,90,40,0.45)] transition-colors hover:bg-atelier-accent/15"
        }
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" className="h-3.5 w-3.5" aria-hidden>
          <path d="M14 4h6v6M20 4l-7 7M10 20H4v-6M4 20l7-7" />
        </svg>
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
                <dd className="mt-1.5 flex gap-2">
                  {tiers.map((option) => (
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
                      {UPSCALE_TIERS[option].label}
                      <span className="ml-2 font-numeral text-xs tabular-nums">
                        {formatMsg(t.generate.creditsShortN, { n: upscaleCreditCost(seconds, option) })}
                      </span>
                    </button>
                  ))}
                </dd>
                <dd className="mt-1.5 text-sm text-atelier-ink">
                  {formatMsg(h.upscaleOutputDetail, { res: UPSCALE_TIERS[tier].label })}
                </dd>
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
            {/* Where the money lives — packs need no plan (operator report,
                2026-09-02: the walls that say "you need credits" never
                pointed at the door). */}
            <p className="mt-1 text-xs leading-relaxed text-atelier-muted">
              <Link href="/app/settings?tab=usage" className="underline hover:text-atelier-ink">
                {h.upscaleTopUpLink}
              </Link>
            </p>
          </div>
        </div>
      )}
    </>
  );
}
