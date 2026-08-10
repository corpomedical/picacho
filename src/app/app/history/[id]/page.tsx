import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { type AttemptLog, type PipelineStepLog } from "@/lib/generations/pipeline";
import { angleSortIndex } from "@/lib/generations/angles";
import { AngleResultViewer } from "@/components/angle-result-viewer";
import { StillRendering } from "@/components/still-rendering";
import { DeleteGenerationButton } from "@/components/delete-generation-button";
import { DownloadButton } from "@/components/download-button";
import { ResultActions } from "@/components/result-actions";
import type { GenerationFeedback } from "@/lib/generations/actions";
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

  // This page doubles as a review view for admins — /admin/moderation,
  // /admin/reports, and /admin/users/[id] all link straight into a specific
  // generation here. So access is "own row OR admin", matching the RLS
  // policy's actual intent, not a blanket owner-only check (that would 404
  // an admin trying to review a flagged generation that isn't theirs).
  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", userData.user.id)
    .single();
  const isAdmin = profile?.role === "admin";

  const generationQuery = supabase.from("generations").select("*").eq("id", id);
  const { data: generation } = await (isAdmin
    ? generationQuery
    : generationQuery.eq("user_id", userData.user.id)
  ).single();

  // Back to the list rather than a 404. Reported 2026-08-10: deleting a
  // generation while viewing it showed a 404 page. deleteGeneration calls
  // revalidatePath("/app", "layout"), which makes Next re-render the route
  // the action was fired from — this one — and by then the row is gone, so
  // notFound() rendered before the button's router.push could land. A
  // deleted item should return you to the list, and that's also the more
  // useful outcome for a stale bookmark or a mistyped id.
  if (!generation) redirect("/app/history");

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
        .select("id, angle, status, result_url, pipeline_log, feedback, created_at")
        .eq("angle_group_id", generation.angle_group_id)
        .order("created_at", { ascending: true })
    : { data: null };

  const sortedAngleRows = (angleSiblings ?? [])
    .slice()
    .sort((a, b) => angleSortIndex(a.angle) - angleSortIndex(b.angle));

  // Which of these generation(s) already have a "report a problem" on file —
  // just enough to show the flag button in its already-reported state, not
  // the report contents themselves (that's admin/reports' job).
  const reportableIds = [generation.id, ...sortedAngleRows.map((r) => r.id)];
  const { data: existingReports } = await supabase
    .from("generation_reports")
    .select("generation_id")
    .in("generation_id", reportableIds);
  const reportedIds = new Set((existingReports ?? []).map((r) => r.generation_id));

  const attempts = (generation.pipeline_log ?? []) as AttemptLog[];
  const finalPrompt = attempts[attempts.length - 1]?.compiledPrompt || generation.prompt_input || "";

  const statusLabel =
    generation.status === "succeeded"
      ? h.statusSucceeded
      : generation.status === "failed"
        ? h.statusFailed
        : h.statusDrafted;
  const typeLabel = generation.content_type === "image" ? t.generate.image : t.generate.video;
  // An admin reviewing someone else's flagged generation shouldn't see
  // actions that only work on your own rows — those writes would just fail
  // against RLS (there's no admin bypass for editing/deleting other users'
  // generations, only for reading them).
  const isOwner = generation.user_id === userData.user.id;

  return (
    <div className="mx-auto max-w-2xl">
      <div className="flex items-center justify-between gap-4">
        <Link href="/app/history" className="text-sm text-neutral-500 hover:text-neutral-900">
          ← {h.backToHistory}
        </Link>
        {isOwner && (
          <div className="flex items-center gap-3">
            {generation.character_profile_id && (
              <Link
                href={`/app/generate?character=${encodeURIComponent(generation.character_profile_id)}&type=${generation.content_type}&resume=${encodeURIComponent(generation.id)}`}
              >
                <Button variant="secondary" size="sm">
                  {h.continueChat}
                </Button>
              </Link>
            )}
            <DeleteGenerationButton id={generation.id} variant="full" redirectAfter="/app/history" />
          </div>
        )}
      </div>

      <Card className="mt-4">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-sm font-medium text-neutral-900">{generation.prompt_input}</p>
            <p className="mt-1 text-xs text-neutral-500">
              {generation.character_profile_id ? (character?.name ?? h.unknownCharacter) : h.noCharacter} ·{" "}
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
        <AngleResultViewer
          rows={sortedAngleRows.map((r) => ({ ...r, reported: reportedIds.has(r.id) }))}
        />
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

          <Card className="group mt-4">
            <h2 className="text-sm font-semibold text-neutral-900">{h.result}</h2>
            {generation.status === "succeeded" ? (
              <>
                {generation.result_url?.startsWith("http") ? (
                  generation.content_type === "image" ? (
                    <div className="relative mt-3">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={generation.result_url}
                        alt={generation.prompt_input || t.generate.resultAlt}
                        className="w-full rounded-[14px] bg-neutral-100 object-cover"
                      />
                      <DownloadButton url={generation.result_url} contentType="image" />
                    </div>
                  ) : (
                    <div className="relative mt-3">
                      <video
                        src={generation.result_url}
                        controls
                        aria-label={generation.prompt_input}
                        className="aspect-video w-full rounded-[14px] bg-neutral-950"
                      />
                      <DownloadButton url={generation.result_url} contentType="video" />
                    </div>
                  )
                ) : (
                  <>
                    <div className="mt-3 flex aspect-video items-center justify-center rounded-[14px] bg-neutral-100 text-center">
                      <p className="max-w-xs px-4 text-xs text-neutral-500">
                        {formatMsg(t.generate.simulatedResult, { type: typeLabel.toLowerCase() })}
                      </p>
                    </div>
                    <div className="mt-4">
                      <Button variant="secondary" disabled>
                        {h.downloadUnavailable}
                      </Button>
                    </div>
                  </>
                )}
                {isOwner && generation.result_url?.startsWith("http") && (
                  <ResultActions
                    generationId={generation.id}
                    copyText={finalPrompt}
                    initialFeedback={(generation.feedback ?? null) as GenerationFeedback}
                    initialReported={reportedIds.has(generation.id)}
                  />
                )}
              </>
            ) : generation.status === "generating" ? (
              // Same rule as the multi-angle viewer: a render still in flight
              // is not a failed one, and must not be described as one.
              <StillRendering startedAt={generation.created_at as string} />
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
