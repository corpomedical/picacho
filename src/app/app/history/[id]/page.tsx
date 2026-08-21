import Link from "next/link";
import { toMediaUrl, isRenderableUrl } from "@/lib/media/url";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { type AttemptLog, type PipelineStepLog } from "@/lib/generations/pipeline";
import { isRawProviderError } from "@/lib/generations/user-facing-error";
import { angleSortIndex } from "@/lib/generations/angles";
import { AngleResultViewer } from "@/components/angle-result-viewer";
import { StillRendering } from "@/components/still-rendering";
import { DeleteGenerationButton } from "@/components/delete-generation-button";
import { DownloadButton } from "@/components/download-button";
import { ZoomableImage } from "@/components/zoomable-image";
import { ResultActions } from "@/components/result-actions";
import { LocalDate } from "@/components/local-date";
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

  const generationQuery = supabase
    .from("generations")
    .select("*")
    .eq("id", id)
    .is("deleted_at", null);
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
  // Old rows store signed URLs whose tokens expired after 7 days — the
  // files are all still in storage. Normalizing to the stable media form at
  // read time rescues every one of them.
  generation.result_url = toMediaUrl(generation.result_url as string | null);

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
    .sort((a, b) => angleSortIndex(a.angle) - angleSortIndex(b.angle))
    .map((row) => ({ ...row, result_url: toMediaUrl(row.result_url) }));

  // Which of these generation(s) already have a "report a problem" on file —
  // just enough to show the flag button in its already-reported state, not
  // the report contents themselves (that's admin/reports' job).
  const reportableIds = [generation.id, ...sortedAngleRows.map((r) => r.id)];
  const { data: existingReports } = await supabase
    .from("generation_reports")
    .select("generation_id")
    .in("generation_id", reportableIds);
  const reportedIds = new Set((existingReports ?? []).map((r) => r.generation_id));

  // Raw provider dumps in pipeline_log never render here — for ANYONE,
  // admin included (operator decision, 2026-08-19: History is a product
  // surface, not a debug console). Everyone gets the friendly localized
  // line; the raw text auto-files into /admin/reports when a render fails
  // (finish() in job-runner.ts) and the full pipeline_log stays in the DB.
  const sanitizeAttempts = (list: AttemptLog[]): AttemptLog[] =>
    list.map((attempt) => ({
      ...attempt,
      steps: attempt.steps.map((step) =>
        isRawProviderError(step.detail)
          ? { ...step, detail: t.generate.stepFailedGeneric }
          : step,
      ),
    }));

  const attempts = sanitizeAttempts((generation.pipeline_log ?? []) as AttemptLog[]);
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
        <Link href="/app/history" className="text-sm text-atelier-muted hover:text-atelier-ink">
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
            {/* Clip continuation (2026-08-21): hands the composer this clip
                as a Seedance @Video1 reference — the next shot picks up the
                same world instead of reinventing it. Finished videos only. */}
            {isOwner &&
              generation.content_type === "video" &&
              generation.status === "succeeded" &&
              isRenderableUrl(generation.result_url) && (
                <Link href={`/app/generate?continue=${encodeURIComponent(generation.id)}`}>
                  <Button variant="secondary" size="sm">
                    {h.continueClipCta}
                  </Button>
                </Link>
              )}
            <DeleteGenerationButton id={generation.id} variant="full" redirectAfter="/app/history" />
          </div>
        )}
      </div>

      <div className="mt-4 rounded-control border border-atelier-rule bg-atelier-surface p-8 shadow-[0_1px_2px_rgba(33,29,22,0.04)]">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-sm font-medium text-atelier-ink">{generation.prompt_input}</p>
            <p className="mt-1 text-xs text-atelier-muted">
              {generation.character_profile_id ? (character?.name ?? h.unknownCharacter) : h.noCharacter} ·{" "}
              <LocalDate date={generation.created_at} mode="datetime" />
              {sortedAngleRows.length > 1 && ` · ${formatMsg(h.angleCountOther, { n: sortedAngleRows.length })}`}
            </p>
            {/* The validation pipeline is the product's whole pitch, but it
                used to be invisible unless someone expanded the attempt log.
                One line of proof on every successful result — and proof is
                the accent's job, in the numeral serif. */}
            {generation.status === "succeeded" && attempts.length > 0 && (
              <p className="mt-1.5 font-numeral text-xs font-medium tabular-nums text-atelier-accent">
                {attempts.length === 1
                  ? h.validatedFirstTry
                  : formatMsg(h.validatedAfterRetries, { n: attempts.length })}
              </p>
            )}
          </div>
          <div className="flex flex-shrink-0 items-center gap-2">
            <Badge tone="neutral">{typeLabel}</Badge>
            <Badge tone={generation.status === "succeeded" ? "success" : "danger"}>
              {statusLabel}
            </Badge>
          </div>
        </div>
      </div>

      {sortedAngleRows.length > 1 ? (
        <AngleResultViewer
          rows={sortedAngleRows.map((r) => ({
            ...r,
            // Same admin-only gating as the single-generation log above.
            pipeline_log: sanitizeAttempts((r.pipeline_log ?? []) as AttemptLog[]),
            reported: reportedIds.has(r.id),
          }))}
        />
      ) : (
        <>
          {/* Printed-proof-sheet voice: engraved serif attempt stamps, caps
              step labels, a hairline left rule. A failed attempt's stamp goes
              calm semantic red — the styling varies by state, the text bytes
              never do. */}
          <div className="mt-4 rounded-control border border-atelier-rule bg-atelier-surface p-8 shadow-[0_1px_2px_rgba(33,29,22,0.04)]">
            <h2 className="text-[11px] font-semibold uppercase tracking-widest text-atelier-muted">{h.pipelineLog}</h2>
            <ol className="mt-4 space-y-5">
              {attempts.map((attempt) => (
                <li key={attempt.attempt}>
                  <p
                    className={`font-numeral text-xs font-medium uppercase tracking-widest tabular-nums ${attempt.passed ? "text-atelier-muted" : "text-red-600 dark:text-red-400"}`}
                  >
                    {formatMsg(h.attemptLabel, { n: attempt.attempt })}
                    {!attempt.passed && ` ${h.didntPassSuffix}`}
                  </p>
                  <ul className="mt-2 space-y-2 border-l border-atelier-rule pl-4">
                    {attempt.steps.map((step, idx) => (
                      <li key={idx}>
                        <p className="text-xs font-medium uppercase tracking-wider text-atelier-ink">
                          {stepLabels[step.step]}
                        </p>
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
            {generation.status === "succeeded" ? (
              <>
                {isRenderableUrl(generation.result_url) ? (
                  generation.content_type === "image" ? (
                    // Darkroom easel: the render sits inset on a warm-charcoal
                    // mat — the same charcoal in both themes — so it glows on
                    // the paper chrome instead of butting against it.
                    <div className="relative mt-3 overflow-hidden rounded-media bg-atelier-stage p-2">
                      <ZoomableImage
                        src={generation.result_url}
                        alt={generation.prompt_input || t.generate.resultAlt}
                        className="w-full rounded-[6px] object-cover"
                        downloadUrl={generation.result_url}
                      />
                      <DownloadButton url={generation.result_url} contentType="image" />
                    </div>
                  ) : (
                    <div className="relative mt-3 overflow-hidden rounded-media bg-atelier-stage p-2">
                      <video
                        src={generation.result_url}
                        controls
                        aria-label={generation.prompt_input}
                        className="aspect-video w-full rounded-[6px] bg-neutral-950"
                      />
                      <DownloadButton url={generation.result_url} contentType="video" />
                    </div>
                  )
                ) : (
                  <>
                    <div className="mt-3 flex aspect-video items-center justify-center rounded-media bg-atelier-stage text-center">
                      {/* Fixed Darkroom muted — the stage never flips themes. */}
                      <p className="max-w-xs px-4 text-xs text-[#a39a88]">
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
                {typeof generation.match_score === "number" && (
                  <p className="mt-2 font-numeral text-xs tabular-nums text-atelier-accent">
                    {formatMsg(t.generate.identityMatch, { n: generation.match_score })}
                  </p>
                )}
                {isOwner && isRenderableUrl(generation.result_url) && (
                  <ResultActions
                    generationId={generation.id}
                    copyText={finalPrompt}
                    promotable={generation.content_type === "image"}
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
              <p className="mt-2 text-sm text-atelier-muted">
                {h.noResult}
              </p>
            )}
          </div>
        </>
      )}
    </div>
  );
}
