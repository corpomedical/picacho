"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { DownloadButton } from "@/components/download-button";
import { ResultActions } from "@/components/result-actions";
import type { GenerationFeedback } from "@/lib/generations/actions";
import { type AttemptLog, type PipelineStepLog } from "@/lib/generations/pipeline";
import { getAnglePreset } from "@/lib/generations/angles";
import { useLocale } from "@/lib/i18n/provider";
import { formatMsg } from "@/lib/i18n/format";
import { StillRendering } from "@/components/still-rendering";
import { cn } from "@/lib/cn";

export type AngleRow = {
  id: string;
  angle: string | null;
  status: string;
  result_url: string | null;
  pipeline_log: unknown;
  feedback: string | null;
  reported: boolean;
  created_at: string;
};

// Replaces the single "Pipeline log" + "Result" cards on the history detail
// page when a generation is part of a multi-angle group — one tab strip
// switches which angle's log and result are shown below.
export function AngleResultViewer({ rows }: { rows: AngleRow[] }) {
  const { t } = useLocale();
  const h = t.history;
  const stepLabels: Record<PipelineStepLog["step"], string> = {
    draft: h.stepDrafted,
    review: h.stepReviewed,
    generate: h.stepGenerating,
    validate: h.stepValidated,
    speech: h.stepSpeechGenerated,
    lipsync: h.stepLipsynced,
  };
  const [activeId, setActiveId] = useState(rows[0]?.id ?? "");
  const active = rows.find((r) => r.id === activeId) ?? rows[0];
  const attempts = (active?.pipeline_log ?? []) as AttemptLog[];
  const finalPrompt = attempts[attempts.length - 1]?.compiledPrompt || "";

  return (
    <>
      <div className="flex flex-wrap gap-1.5">
        {rows.map((row) => {
          const label = getAnglePreset(row.angle ?? "")?.label ?? row.angle ?? h.angleFallback;
          const isActive = row.id === active?.id;
          return (
            <button
              key={row.id}
              type="button"
              onClick={() => setActiveId(row.id)}
              className={cn(
                "rounded-control border px-3 py-1.5 text-sm font-medium transition-colors",
                isActive
                  ? "border-atelier-ink bg-atelier-ink text-atelier-paper"
                  : "border-atelier-rule text-atelier-muted hover:border-atelier-muted hover:bg-atelier-ink/5",
              )}
            >
              {label}
              {row.status !== "succeeded" && <span className="ml-1.5 text-red-400">•</span>}
            </button>
          );
        })}
      </div>

      {/* Same printed-proof-sheet voice as the single-generation log on the
          history detail page: serif attempt stamps (calm red when the attempt
          didn't pass), caps step labels, hairline left rule. */}
      <div className="mt-4 rounded-control border border-atelier-rule bg-atelier-surface p-8 shadow-[0_1px_2px_rgba(33,29,22,0.04)]">
        <h2 className="text-[11px] font-semibold uppercase tracking-widest text-atelier-muted">{h.pipelineLog}</h2>
        <ol className="mt-4 space-y-5">
          {attempts.map((attempt) => (
            <li key={attempt.attempt}>
              <p
                className={cn(
                  "font-numeral text-xs font-medium uppercase tracking-widest tabular-nums",
                  attempt.passed ? "text-atelier-muted" : "text-red-600 dark:text-red-400",
                )}
              >
                {formatMsg(h.attemptLabel, { n: attempt.attempt })}
                {!attempt.passed && ` ${h.didntPassSuffix}`}
              </p>
              <ul className="mt-2 space-y-2 border-l border-atelier-rule pl-4">
                {attempt.steps.map((step, idx) => (
                  <li key={idx}>
                    <p className="text-xs font-medium uppercase tracking-wider text-atelier-ink">{stepLabels[step.step]}</p>
                    <p className="text-xs text-atelier-muted">{step.detail}</p>
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ol>
      </div>

      <div className="group mt-4 rounded-control border border-atelier-rule bg-atelier-surface p-8 shadow-[0_1px_2px_rgba(33,29,22,0.04)]">
        <h2 className="text-[11px] font-semibold uppercase tracking-widest text-atelier-muted">{h.result}</h2>
        {active?.status === "succeeded" ? (
          <>
            {(active.result_url?.startsWith("http") || active.result_url?.startsWith("/api/media/")) ? (
              // Darkroom easel — warm-charcoal mat, constant across themes,
              // so the render glows on paper and blends in the dark theme.
              <div className="relative mt-3 overflow-hidden rounded-media bg-atelier-stage p-2">
                <video
                  src={active.result_url}
                  controls
                  aria-label={getAnglePreset(active.angle ?? "")?.label ?? h.angleFallback}
                  className="aspect-video w-full rounded-[6px] bg-neutral-950"
                />
                <DownloadButton url={active.result_url} contentType="video" />
              </div>
            ) : (
              <>
                <div className="mt-3 flex aspect-video items-center justify-center rounded-media bg-atelier-stage text-center">
                  {/* Fixed Darkroom muted — the stage never flips themes. */}
                  <p className="max-w-xs px-4 text-xs text-[#a39a88]">
                    {formatMsg(t.generate.simulatedResult, { type: t.generate.video.toLowerCase() })}
                  </p>
                </div>
                <div className="mt-4">
                  <Button variant="secondary" disabled>
                    {h.downloadUnavailable}
                  </Button>
                </div>
              </>
            )}
            {(active.result_url?.startsWith("http") || active.result_url?.startsWith("/api/media/")) && (
              <ResultActions
                key={active.id}
                generationId={active.id}
                copyText={finalPrompt}
                initialFeedback={(active.feedback ?? null) as GenerationFeedback}
                initialReported={active.reported}
              />
            )}
          </>
        ) : active.status === "generating" ? (
          // Still in flight, NOT failed. Telling someone their generation
          // produced nothing while it's actively rendering is the difference
          // between "be patient" and "this product is broken".
          <StillRendering startedAt={active.created_at} />
        ) : (
          <p className="mt-2 text-sm text-atelier-muted">
            {h.noResultAngle}
          </p>
        )}
      </div>
    </>
  );
}
