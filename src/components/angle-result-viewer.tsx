"use client";

import { useState } from "react";
import { Card } from "@/components/ui/card";
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
                "rounded-[10px] border px-3 py-1.5 text-sm font-medium transition-colors",
                isActive
                  ? "border-neutral-900 bg-neutral-900 text-white"
                  : "border-neutral-200 text-neutral-600 hover:border-neutral-300 hover:bg-neutral-50",
              )}
            >
              {label}
              {row.status !== "succeeded" && <span className="ml-1.5 text-red-400">•</span>}
            </button>
          );
        })}
      </div>

      <Card className="mt-4">
        <h2 className="text-sm font-semibold text-neutral-900">{h.pipelineLog}</h2>
        <ol className="mt-4 space-y-5">
          {attempts.map((attempt) => (
            <li key={attempt.attempt}>
              <p className="text-xs font-medium uppercase tracking-wide text-neutral-400">
                {formatMsg(h.attemptLabel, { n: attempt.attempt })}
                {!attempt.passed && ` ${h.didntPassSuffix}`}
              </p>
              <ul className="mt-2 space-y-2 border-l border-neutral-100 pl-4">
                {attempt.steps.map((step, idx) => (
                  <li key={idx}>
                    <p className="text-sm font-medium text-neutral-900">{stepLabels[step.step]}</p>
                    <p className="text-xs text-neutral-500">{step.detail}</p>
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ol>
      </Card>

      <Card className="group mt-4">
        <h2 className="text-sm font-semibold text-neutral-900">{h.result}</h2>
        {active?.status === "succeeded" ? (
          <>
            {active.result_url?.startsWith("http") ? (
              <div className="relative mt-3">
                <video
                  src={active.result_url}
                  controls
                  aria-label={getAnglePreset(active.angle ?? "")?.label ?? h.angleFallback}
                  className="aspect-video w-full rounded-[14px] bg-neutral-950"
                />
                <DownloadButton url={active.result_url} contentType="video" />
              </div>
            ) : (
              <>
                <div className="mt-3 flex aspect-video items-center justify-center rounded-[14px] bg-neutral-100 text-center">
                  <p className="max-w-xs px-4 text-xs text-neutral-500">
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
            {active.result_url?.startsWith("http") && (
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
          <p className="mt-2 text-sm text-neutral-500">
            {h.noResultAngle}
          </p>
        )}
      </Card>
    </>
  );
}
