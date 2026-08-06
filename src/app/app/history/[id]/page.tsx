import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { type AttemptLog, type PipelineStepLog } from "@/lib/generations/pipeline";
import { angleSortIndex } from "@/lib/generations/angles";
import { AngleResultViewer } from "@/components/angle-result-viewer";
import { getServerMessages } from "@/lib/i18n/server";
import { formatMsg } from "@/lib/i18n/format";

export default async function HistoryDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { t } = await getServerMessages();
  const h = t.history;
  const stepLabels: Record<PipelineStepLog["step"], string> = {
    draft: h.stepDrafted,
    review: h.stepReviewed,
    generate: h.stepGenerating,
    validate: h.stepValidated,
    speech: h.stepSpeechGenerated,
    lipsync: h.stepLipsynced,
  };
  const { id } = await params;
  const supabase = await createClient();
  const { data: userData } = await supabase.auth.getUser();
  if (!userData.user) redirect("/login");

  const { data: generation } = await supabase
    .from("generations")
    .select("*")
    .eq("id", id)
    .single();

  if (!generation) notFound();

  const { data: character } = generation.character_profile_id
    ? await supabase
        .from("character_profiles")
        .select("name")
        .eq("id", generation.character_profile_id)
        .single()
    : { data: null };

  const { data: angleSiblings } = generation.angle_group_id
    ? await supabase
        .from("generations")
        .select("id, angle, status, result_url, pipeline_log")
        .eq("angle_group_id", generation.angle_group_id)
        .order("created_at", { ascending: true })
    : { data: null };

  const sortedAngleRows = (angleSiblings ?? [])
    .slice()
    .sort((a, b) => angleSortIndex(a.angle) - angleSortIndex(b.angle));

  const attempts = (generation.pipeline_log ?? []) as AttemptLog[];

  const statusLabel =
    generation.status === "succeeded"
      ? h.statusSucceeded
      : generation.status === "failed"
        ? h.statusFailed
        : h.statusDrafted;
  const typeLabel = generation.content_type === "image" ? t.generate.image : t.generate.video;

  return (
    <div className="mx-auto max-w-2xl">
      <Link href="/app/history" className="text-sm text-neutral-500 hover:text-neutral-900">
        ← {h.backToHistory}
      </Link>

      <Card className="mt-4">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-sm font-medium text-neutral-900">{generation.prompt_input}</p>
            <p className="mt-1 text-xs text-neutral-500">
              {character?.name ?? h.unknownCharacter} ·{" "}
              {new Date(generation.created_at).toLocaleString()}
              {sortedAngleRows.length > 1 && ` · ${formatMsg(h.angleCountOther, { n: sortedAngleRows.length })}`}
            </p>
          </div>
          <div className="flex flex-shrink-0 items-center gap-2">
            <Badge tone="neutral">{typeLabel}</Badge>
            <Badge tone={generation.status === "succeeded" ? "success" : "danger"}>
              {statusLabel}
            </Badge>
          </div>
        </div>
      </Card>

      {sortedAngleRows.length > 1 ? (
        <AngleResultViewer rows={sortedAngleRows} />
      ) : (
        <>
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
                        <p className="text-sm font-medium text-neutral-900">
                          {stepLabels[step.step]}
                        </p>
                        <p className="text-xs text-neutral-500">{step.detail}</p>
                      </li>
                    ))}
                  </ul>
                </li>
              ))}
            </ol>
          </Card>

          <Card className="mt-4">
            <h2 className="text-sm font-semibold text-neutral-900">{h.result}</h2>
            {generation.status === "succeeded" ? (
              <>
                {generation.result_url?.startsWith("http") ? (
                  generation.content_type === "image" ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={generation.result_url}
                      alt={generation.prompt_input || t.generate.resultAlt}
                      className="mt-3 w-full rounded-[14px] bg-neutral-100 object-cover"
                    />
                  ) : (
                    <video
                      src={generation.result_url}
                      controls
                      aria-label={generation.prompt_input}
                      className="mt-3 aspect-video w-full rounded-[14px] bg-neutral-950"
                    />
                  )
                ) : (
                  <div className="mt-3 flex aspect-video items-center justify-center rounded-[14px] bg-neutral-100 text-center">
                    <p className="max-w-xs px-4 text-xs text-neutral-500">
                      {formatMsg(t.generate.simulatedResult, { type: typeLabel.toLowerCase() })}
                    </p>
                  </div>
                )}
                <div className="mt-4">
                  {generation.result_url?.startsWith("http") ? (
                    <a href={generation.result_url} download>
                      <Button variant="secondary">{h.download}</Button>
                    </a>
                  ) : (
                    <Button variant="secondary" disabled>
                      {h.downloadUnavailable}
                    </Button>
                  )}
                </div>
              </>
            ) : (
              <p className="mt-2 text-sm text-neutral-500">
                {h.noResult}
              </p>
            )}
          </Card>
        </>
      )}
    </div>
  );
}
