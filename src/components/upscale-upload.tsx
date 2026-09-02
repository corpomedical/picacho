"use client";

import { useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { createClient } from "@/lib/supabase/client";
import { reserveUpscaleUploadPath, startUploadUpscale } from "@/lib/generations/actions";
import {
  availableUpscaleTiers,
  uploadUpscaleIneligibility,
  upscaleCreditCost,
  UPSCALE_TIERS,
  ENGINE_SOURCE_HEIGHT_DEFAULT,
  type UpscaleTier,
} from "@/lib/generations/upscale";
import { useLocale } from "@/lib/i18n/provider";
import { formatMsg } from "@/lib/i18n/format";

// "Upscale a video" on the History header (design board C, operator-approved
// 2026-09-02): bring any clip, not just a Picacho render. The browser reads
// the file's metadata for the PREVIEW (duration → the quoted price, height →
// eligibility); the server then re-probes the actual MP4's boxes before any
// money moves, so a doctored preview changes nothing but the preview. Upload
// is the chat-attachment shape: reserve a path, upload straight to storage
// under the caller's own folder (bucket RLS + the bucket's 50MB/MP4 caps),
// then hand the path to the action.
type PickedFile = {
  file: File;
  seconds: number;
  height: number;
  problem: string | null;
};

export function UpscaleUpload() {
  const { t } = useLocale();
  const h = t.history;
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [open, setOpen] = useState(false);
  const [picked, setPicked] = useState<PickedFile | null>(null);
  const [tier, setTier] = useState<UpscaleTier | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [phase, setPhase] = useState<"idle" | "uploading">("idle");
  const [pending, startTransition] = useTransition();
  const busy = pending || phase === "uploading";

  const problemLabel = (code: ReturnType<typeof uploadUpscaleIneligibility>): string | null => {
    if (code === "not-mp4") return h.upscaleErrNotMp4;
    if (code === "too-long") return h.upscaleErrTooLong;
    if (code === "too-big") return h.upscaleErrTooBig;
    if (code === "too-sharp") return h.upscaleErrTooSharp;
    return null;
  };

  const onPick = (file: File) => {
    setError(null);
    const url = URL.createObjectURL(file);
    const probe = document.createElement("video");
    probe.preload = "metadata";
    probe.onloadedmetadata = () => {
      URL.revokeObjectURL(url);
      const seconds = Math.ceil(probe.duration || 0);
      const height = probe.videoHeight || 0;
      const effectiveHeight = height || ENGINE_SOURCE_HEIGHT_DEFAULT;
      const code = uploadUpscaleIneligibility({
        seconds,
        bytes: file.size,
        height: effectiveHeight,
        mimeType: file.type,
      });
      setPicked({ file, seconds, height, problem: problemLabel(code) });
      setTier(code ? null : (availableUpscaleTiers(effectiveHeight)[0] ?? null));
    };
    probe.onerror = () => {
      URL.revokeObjectURL(url);
      setPicked({ file, seconds: 0, height: 0, problem: h.upscaleErrNotMp4 });
    };
    probe.src = url;
  };

  const start = () => {
    if (!picked || picked.problem || !tier) return;
    setError(null);
    setPhase("uploading");
    startTransition(async () => {
      try {
        const reserveForm = new FormData();
        reserveForm.set("name", picked.file.name);
        reserveForm.set("size", String(picked.file.size));
        const reserved = await reserveUpscaleUploadPath(reserveForm);
        if (reserved.error || !reserved.path) {
          setError(reserved.error ?? h.upscaleErrNotMp4);
          return;
        }
        const supabase = createClient();
        const { error: uploadError } = await supabase.storage
          .from("upscale-sources")
          .upload(reserved.path, picked.file, { contentType: "video/mp4" });
        if (uploadError) {
          setError(uploadError.message);
          return;
        }
        const startForm = new FormData();
        startForm.set("path", reserved.path);
        startForm.set("tier", tier);
        const result = await startUploadUpscale(startForm);
        if ("error" in result) {
          setError(result.error);
          return;
        }
        setOpen(false);
        setPicked(null);
        router.refresh();
      } finally {
        setPhase("idle");
      }
    });
  };

  const previewTiers =
    picked && !picked.problem
      ? availableUpscaleTiers(picked.height || ENGINE_SOURCE_HEIGHT_DEFAULT)
      : [];
  const credits = picked && !picked.problem && tier ? upscaleCreditCost(picked.seconds, tier) : null;

  return (
    <>
      <Button variant="secondary" size="sm" onClick={() => setOpen(true)}>
        {h.upscaleUpload}
      </Button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          onClick={() => !busy && setOpen(false)}
        >
          <div
            className="w-full max-w-md rounded-control border border-atelier-rule bg-atelier-paper p-6 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <p className="text-[11px] font-semibold uppercase tracking-widest text-atelier-muted">
              {h.upscaleUpload}
            </p>
            <h2 className="mt-1.5 text-lg font-semibold text-atelier-ink">{h.upscaleUploadTitle}</h2>
            <p className="mt-1 text-sm text-atelier-muted">{h.upscaleUploadSub}</p>

            <input
              ref={inputRef}
              type="file"
              accept="video/mp4"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) onPick(file);
              }}
            />
            <button
              type="button"
              onClick={() => inputRef.current?.click()}
              className="mt-4 flex w-full items-center gap-3 rounded-control border border-atelier-rule bg-atelier-ink/[0.03] px-4 py-3 text-left transition-colors hover:border-atelier-muted"
            >
              {picked ? (
                <span className="min-w-0">
                  <span className="block truncate text-sm font-medium text-atelier-ink">
                    {picked.file.name}
                  </span>
                  <span className="mt-0.5 block font-numeral text-xs tabular-nums text-atelier-muted">
                    {picked.seconds}s · {Math.round(picked.file.size / (1024 * 1024))} MB
                    {picked.height ? ` · ${picked.height}p` : ""}
                  </span>
                </span>
              ) : (
                <span className="text-sm text-atelier-muted">{h.upscalePickFile}</span>
              )}
            </button>
            <p className="mt-2 text-[10px] font-semibold uppercase tracking-widest text-atelier-muted/70">
              {h.upscaleLimits}
            </p>

            {picked?.problem && (
              <p className="mt-3 text-xs text-red-600 dark:text-red-400">{picked.problem}</p>
            )}

            {credits !== null && (
              <>
                <dl className="mt-4 space-y-3 border-t border-atelier-rule pt-3">
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
                      {previewTiers.map((option) => (
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
                            {formatMsg(t.generate.creditsShortN, {
                              n: upscaleCreditCost(picked!.seconds, option),
                            })}
                          </span>
                        </button>
                      ))}
                    </dd>
                    {tier && (
                      <dd className="mt-1.5 text-sm text-atelier-ink">
                        {formatMsg(h.upscaleOutputDetail, { res: UPSCALE_TIERS[tier].label })}
                      </dd>
                    )}
                  </div>
                </dl>
                <div className="mt-3 flex items-end justify-between border-t border-atelier-rule pt-3">
                  <p className="text-[10px] font-semibold uppercase tracking-widest text-atelier-muted/80">
                    {t.generate.totalLabel}
                  </p>
                  <p className="font-numeral text-2xl font-semibold tabular-nums text-atelier-accent">
                    {formatMsg(t.generate.durationCredits, { n: credits })}
                  </p>
                </div>
                <Button
                  className="mt-4 w-full"
                  onClick={start}
                  pending={busy}
                  pendingLabel={phase === "uploading" ? h.upscaleUploading : h.upscaleStarting}
                >
                  {formatMsg(h.upscaleGo, { n: credits })}
                </Button>
              </>
            )}

            {error && <p className="mt-2 text-xs text-red-600 dark:text-red-400">{error}</p>}
            <p className="mt-3 text-xs leading-relaxed text-atelier-muted">{h.upscaleContentNote}</p>
            <p className="mt-1 text-xs leading-relaxed text-atelier-muted">{h.upscaleFootnote}</p>
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
