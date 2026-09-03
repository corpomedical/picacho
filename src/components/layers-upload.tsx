"use client";

import { useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { createClient } from "@/lib/supabase/client";
import { reserveLayersUploadPath, startUploadLayers } from "@/lib/generations/actions";
import {
  LAYERS_TIERS,
  LAYERS_TIER_ORDER,
  layersCreditCost,
  uploadLayersIneligibility,
  type LayersTier,
} from "@/lib/generations/layers";
import { SerifNumerals } from "@/components/marketing/serif-numerals";
import { useLocale } from "@/lib/i18n/provider";
import { formatMsg } from "@/lib/i18n/format";

// "Bring any image" (shape B, 2026-09-03), the Upscale upload lane's shape
// exactly: the browser reads the image for the PREVIEW (size → eligibility);
// the server re-reads the actual bytes before any money moves. Reserve a
// path, upload straight to storage under the caller's own folder (bucket
// RLS + the bucket's 20 MB / image-type caps), then hand the path to the
// action, which opens the stack page.
function StackGlyph(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <path d="M12 3.5 3.5 8 12 12.5 20.5 8z" />
      <path d="M3.5 12 12 16.5 20.5 12" />
      <path d="M3.5 16 12 20.5 20.5 16" />
    </svg>
  );
}

type PickedFile = { file: File; width: number; height: number; problem: string | null };

export function LayersUpload() {
  const { t } = useLocale();
  const L = t.layers;
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [open, setOpen] = useState(false);
  const [picked, setPicked] = useState<PickedFile | null>(null);
  const [tier, setTier] = useState<LayersTier>("1k");
  const [error, setError] = useState<string | null>(null);
  const [phase, setPhase] = useState<"idle" | "uploading">("idle");
  const [pending, startTransition] = useTransition();
  const busy = pending || phase === "uploading";

  const problemLabel = (code: ReturnType<typeof uploadLayersIneligibility>): string | null => {
    if (code === "not-image") return L.errNotImage;
    if (code === "too-big") return L.errTooBig;
    if (code === "too-small") return L.errTooSmall;
    return null;
  };

  const onPick = (file: File) => {
    setError(null);
    setOpen(true);
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      const code = uploadLayersIneligibility({
        bytes: file.size,
        mimeType: file.type,
        width: img.naturalWidth,
        height: img.naturalHeight,
      });
      setPicked({ file, width: img.naturalWidth, height: img.naturalHeight, problem: problemLabel(code) });
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      setPicked({ file, width: 0, height: 0, problem: L.errNotImage });
    };
    img.src = url;
  };

  const start = () => {
    if (!picked || picked.problem) return;
    setError(null);
    setPhase("uploading");
    startTransition(async () => {
      try {
        const reserveForm = new FormData();
        reserveForm.set("name", picked.file.name);
        reserveForm.set("size", String(picked.file.size));
        const reserved = await reserveLayersUploadPath(reserveForm);
        if (reserved.error || !reserved.path) {
          setError(reserved.error ?? L.errNotImage);
          return;
        }
        const supabase = createClient();
        const { error: uploadError } = await supabase.storage
          .from("layer-sources")
          .upload(reserved.path, picked.file, { contentType: picked.file.type });
        if (uploadError) {
          setError(uploadError.message);
          return;
        }
        const startForm = new FormData();
        startForm.set("path", reserved.path);
        startForm.set("tier", tier);
        const result = await startUploadLayers(startForm);
        if ("error" in result) {
          setError(result.error);
          return;
        }
        setOpen(false);
        setPicked(null);
        router.push(`/app/layers/${result.generationId}`);
      } finally {
        setPhase("idle");
      }
    });
  };

  const credits = picked && !picked.problem ? layersCreditCost(tier) : null;

  return (
    <>
      <input
        ref={inputRef}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) onPick(file);
        }}
      />
      <div className="rounded-control border border-atelier-rule bg-atelier-surface p-3 shadow-[0_1px_2px_rgba(33,29,22,0.04)]">
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              const file = e.dataTransfer.files?.[0];
              if (file) onPick(file);
            }}
            className="flex w-full flex-col items-center gap-2.5 rounded-control border-[1.5px] border-dashed border-atelier-rule px-6 py-9 text-center transition-colors hover:border-atelier-muted"
          >
            <StackGlyph className="h-7 w-7 text-atelier-muted/70" />
            <span className="text-sm font-semibold text-atelier-ink">{L.dropFile}</span>
            <span className="text-[10px] font-semibold uppercase tracking-widest text-atelier-muted/70">
              <SerifNumerals text={L.limits} />
            </span>
          </button>
        </div>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => !busy && setOpen(false)}>
          <div className="w-full max-w-md rounded-control border border-atelier-rule bg-atelier-paper p-6 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <p className="text-[11px] font-semibold uppercase tracking-widest text-atelier-muted">{L.receipt}</p>
            <h2 className="mt-1.5 text-lg font-semibold text-atelier-ink">{L.uploadTitle}</h2>
            <p className="mt-1 text-sm text-atelier-muted">{L.uploadSub}</p>

            <button
              type="button"
              onClick={() => inputRef.current?.click()}
              className="mt-4 flex w-full items-center gap-3 rounded-control border border-atelier-rule bg-atelier-ink/[0.03] px-4 py-3 text-left transition-colors hover:border-atelier-muted"
            >
              {picked ? (
                <span className="min-w-0">
                  <span className="block truncate text-sm font-medium text-atelier-ink">{picked.file.name}</span>
                  <span className="mt-0.5 block font-numeral text-xs tabular-nums text-atelier-muted">
                    {picked.width && picked.height ? `${picked.width}×${picked.height} · ` : ""}
                    {(picked.file.size / (1024 * 1024)).toFixed(1)} MB
                  </span>
                </span>
              ) : (
                <span className="text-sm text-atelier-muted">{L.pickFile}</span>
              )}
            </button>
            <p className="mt-2 text-[10px] font-semibold uppercase tracking-widest text-atelier-muted/70">{L.limits}</p>

            {picked?.problem && <p className="mt-3 text-xs text-red-600 dark:text-red-400">{picked.problem}</p>}

            {credits !== null && (
              <>
                <dl className="mt-4 space-y-3 border-t border-atelier-rule pt-3">
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
                    <dd className="mt-1.5 text-sm text-atelier-ink">{formatMsg(L.outputDetail, { res: LAYERS_TIERS[tier].label })}</dd>
                    <dd className="mt-1 text-xs text-atelier-muted">{L.countNote}</dd>
                  </div>
                </dl>
                <div className="mt-3 flex items-end justify-between border-t border-atelier-rule pt-3">
                  <p className="text-[10px] font-semibold uppercase tracking-widest text-atelier-muted/80">{t.generate.totalLabel}</p>
                  <p className="font-numeral text-2xl font-semibold tabular-nums text-atelier-accent">
                    {formatMsg(t.generate.durationCredits, { n: credits })}
                  </p>
                </div>
                <Button className="mt-4 w-full" onClick={start} pending={busy} pendingLabel={phase === "uploading" ? L.uploading : L.starting}>
                  {formatMsg(L.go, { n: credits })}
                </Button>
              </>
            )}

            {error && <p className="mt-2 text-xs text-red-600 dark:text-red-400">{error}</p>}
            <p className="mt-3 text-xs leading-relaxed text-atelier-muted">{L.contentNote}</p>
            <p className="mt-1 text-xs leading-relaxed text-atelier-muted">{L.footnote}</p>
            <p className="mt-1 text-xs leading-relaxed text-atelier-muted">
              <Link href="/app/settings?tab=usage" className="underline hover:text-atelier-ink">{L.topUpLink}</Link>
            </p>
          </div>
        </div>
      )}
    </>
  );
}
