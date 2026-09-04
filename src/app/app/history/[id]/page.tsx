import Link from "next/link";
import { LineageChain, lineageThumb, type LineageNode } from "@/components/lineage-chain";
import { LAYERS_MODEL_ID, takeLayersIneligibility, LAYER_EDIT_MODEL_ID } from "@/lib/generations/layers";
import { QuietVideo } from "@/components/quiet-video";
import { toMediaUrl, isRenderableUrl, thumbUrl, mediaUrl } from "@/lib/media/url";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { type AttemptLog, type PipelineStepLog } from "@/lib/generations/pipeline";
import { isRawProviderError, isBudgetExhaustedDetail } from "@/lib/generations/user-facing-error";
import { angleSortIndex } from "@/lib/generations/angles";
import { AngleResultViewer } from "@/components/angle-result-viewer";
import { StillRendering } from "@/components/still-rendering";
import { DeleteGenerationButton } from "@/components/delete-generation-button";
import { DownloadButton } from "@/components/download-button";
import { ZoomableImage } from "@/components/zoomable-image";
import { CommunityShareButton } from "@/components/community-share-button";
import { ResultActions } from "@/components/result-actions";
import { LocalDate } from "@/components/local-date";
import type { GenerationFeedback } from "@/lib/generations/actions";
import { getServerMessages } from "@/lib/i18n/server";
import { UpscaleButton } from "@/components/upscale-button";
import { LayersButton } from "@/components/layers-button";
import {
  availableUpscaleTiers,
  takeSourceHeight,
  takeUpscaleIneligibility,
  UPSCALE_MODEL_ID,
} from "@/lib/generations/upscale";
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
        .select("name, reference_image_urls")
        .eq("id", generation.character_profile_id)
        .single()
    : { data: null };

  // LINEAGE (direction C, operator pick 2026-09-04). What this render came
  // from, and what came out of it. Every competitor's detail page is a dead
  // end; this studio actually records the chain — source_generation_id is
  // written by the upscale lane, the layers split and the layer edit — so
  // the page can show it.
  //
  // Both queries are the caller's OWN rows even for an admin viewing someone
  // else's generation: a lineage panel is a convenience, not a reason to
  // widen what an admin can enumerate.
  const [{ data: parentRow }, { data: childRows }] = await Promise.all([
    generation.source_generation_id
      ? supabase
          .from("generations")
          .select("id, prompt_input, result_url, content_type, model_id, created_at")
          .eq("id", generation.source_generation_id as string)
          .eq("user_id", userData.user.id)
          .is("deleted_at", null)
          .maybeSingle()
      : Promise.resolve({ data: null }),
    supabase
      .from("generations")
      .select("id, prompt_input, result_url, content_type, model_id, credits_used, created_at")
      .eq("source_generation_id", id)
      .eq("user_id", userData.user.id)
      .is("deleted_at", null)
      .order("created_at", { ascending: true })
      .limit(8),
  ]);

  const { data: angleSiblings } = generation.angle_group_id
    ? await supabase
        .from("generations")
        .select("id, angle, status, result_url, pipeline_log, feedback, created_at")
        .eq("angle_group_id", generation.angle_group_id)
        // Siblings can be individually deleted; their files are gone even
        // though the soft-deleted rows still carry this group id.
        .is("deleted_at", null)
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
          : isBudgetExhaustedDetail(step.detail)
            ? { ...step, detail: t.generate.stepAllAttemptsUsed }
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

  // Whether the Upscale action shows — the same pure rule the server action
  // re-runs before taking any money, so the button can never promise what
  // the action refuses.
  const upscaleTiers =
    isOwner &&
    isRenderableUrl(generation.result_url) &&
    takeUpscaleIneligibility(generation) === null
      ? availableUpscaleTiers(takeSourceHeight(generation.video_model_id))
      : [];

  // Whether this render is already in the community feed (drives the share
  // button's state). Soft-fails to "not shared" if the community SQL hasn't
  // been applied yet — supabase-js returns an error, not a throw.
  const canShareToCommunity =
    isOwner && generation.status === "succeeded" && isRenderableUrl(generation.result_url);
  let sharedToCommunity = false;
  if (canShareToCommunity) {
    const { data: post } = await supabase
      .from("community_posts")
      .select("id")
      .eq("generation_id", generation.id)
      .maybeSingle();
    sharedToCommunity = Boolean(post);
  }

  // The chain, left to right: the character's identity photo, the take this
  // was made from, this one, then everything made FROM it. Each node is only
  // added when it genuinely exists — LineageChain renders nothing at all for
  // a chain of one, which is most renders.
  const identityPath = (character?.reference_image_urls as string[] | null)?.[0];
  const derivativeLabel = (modelId: string | null): string =>
    modelId === LAYERS_MODEL_ID
      ? t.layers.stackTitle
      : modelId === UPSCALE_MODEL_ID
        ? h.upscaledBadge
        : modelId === LAYER_EDIT_MODEL_ID
          ? t.layers.change
          : typeLabel;
  const lineageNodes: LineageNode[] = [
    ...(identityPath
      ? [
          {
            id: `identity-${generation.character_profile_id}`,
            href: `/app/character/${generation.character_profile_id}`,
            thumb: thumbUrl(mediaUrl("character-references", identityPath), 320),
            label: h.lineageIdentityPhoto,
            detail: character?.name ?? null,
          },
        ]
      : []),
    ...(parentRow
      ? [
          {
            id: parentRow.id as string,
            href: `/app/history/${parentRow.id}`,
            thumb: lineageThumb(parentRow.result_url as string | null, parentRow.content_type as string | null),
            label: h.lineageSource,
            detail: (parentRow.prompt_input as string | null)?.slice(0, 28) ?? null,
          },
        ]
      : []),
    {
      id: generation.id as string,
      href: null,
      thumb: lineageThumb(generation.result_url as string | null, generation.content_type as string | null),
      label: h.lineageThisTake,
      detail: typeof generation.match_score === "number" ? String(generation.match_score) : null,
      current: true,
    },
    ...(childRows ?? []).map((c) => ({
      id: c.id as string,
      // A split's own page is the layer stack, not another render page.
      href: c.model_id === LAYERS_MODEL_ID ? `/app/layers/${c.id}` : `/app/history/${c.id}`,
      thumb: lineageThumb(c.result_url as string | null, c.content_type as string | null),
      label: derivativeLabel(c.model_id as string | null),
      detail:
        typeof c.credits_used === "number" && c.credits_used > 0
          ? formatMsg(t.generate.creditsShortN, { n: c.credits_used })
          : null,
    })),
  ];

  return (
    <div className="mx-auto max-w-2xl">
      {/* This page had NO h1 and nothing larger than text-sm on it — the page
          for a render someone spent credits to make had no title at all
          (found in the 2026-09-04 design review). The eyebrow + serif title
          is the Ledger's masthead, the same one History's grid now wears.
          The prompt itself is the title: it is what the render IS. */}
      <Link
        href="/app/history"
        className="text-sm text-atelier-muted transition-colors hover:text-atelier-ink"
      >
        ← {h.backToHistory}
      </Link>

      {/* THE RENDER FIRST (direction C, operator pick 2026-09-04). It was
          the third thing on this page — under the facts sheet and the
          attempt log — on a page whose entire subject is this one image. */}
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
          {/* THE RENDER IS THE PAGE (direction C, 2026-09-04). It used to
              be the third sheet down — under the facts and the attempt log —
              on a page whose entire subject is this one image. No sheet, no
              "Result" heading: the picture needs no label. */}
          <div className="group">
            {generation.status === "succeeded" ? (
              <>
                {isRenderableUrl(generation.result_url) ? (
                  generation.content_type === "image" ? (
                    // Darkroom easel: the render sits inset on a warm-charcoal
                    // mat — the same charcoal in both themes — so it glows on
                    // the paper chrome instead of butting against it.
                    <div className="relative overflow-hidden rounded-[18px] bg-atelier-stage p-2">
                      <ZoomableImage
                        src={generation.result_url}
                        alt={generation.prompt_input || t.generate.resultAlt}
                        className="w-full rounded-[6px] object-cover"
                        downloadUrl={generation.result_url}
                        generationId={generation.id}
                        ownerActions
                        redirectAfterDelete="/app/history"
                      />
                      <DownloadButton url={generation.result_url} contentType="image" />
                    </div>
                  ) : (
                    <div className="relative overflow-hidden rounded-[18px] bg-atelier-stage p-2">
                      <QuietVideo
                        pending="spinner"
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
                    <div className="flex aspect-video items-center justify-center rounded-[18px] bg-atelier-stage text-center">
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
          {/* Printed-proof-sheet voice: engraved serif attempt stamps, caps
              step labels, a hairline left rule. A failed attempt's stamp goes
              calm semantic red — the styling varies by state, the text bytes
              never do. */}

      {/* Title, facts and score as one masthead UNDER the render, the way
          a caption sits under a plate. The score is the page's one large
          number: proof, in the accent's one sanctioned job. */}
      <div className="mt-5 flex flex-wrap items-start justify-between gap-x-8 gap-y-3">
        <div className="min-w-0 flex-1">
      <p className="mt-4 text-[10.5px] font-semibold uppercase tracking-[0.14em] text-atelier-muted">
        {typeLabel}
      </p>
      <h1 className="mt-1 font-numeral text-2xl font-semibold leading-tight tracking-tight text-atelier-ink [text-wrap:pretty]">
        {generation.prompt_input}
      </h1>
        </div>
        {typeof generation.match_score === "number" && (
          <div className="flex-shrink-0 text-right">
            <p className="text-[10.5px] font-semibold uppercase tracking-[0.14em] text-atelier-muted">
              {h.identityLabel}
            </p>
            <p
              title={formatMsg(t.generate.identityMatch, { n: generation.match_score })}
              className="mt-1 font-numeral text-[34px] font-semibold leading-none tabular-nums text-atelier-accent"
            >
              {generation.match_score}
            </p>
          </div>
        )}
      </div>

      {/* The facts as a CAPTION, not a sheet. They used to sit in their own
          p-8 card between the title and the actions, which put a box around
          four short lines and pushed everything below it further down. The
          lineage links this block used to carry — "Upscaled · view source",
          "Layer stack →" — are gone: the chain below says all of that, with
          pictures, and saying it twice was how the prompt ended up rendered
          twice in the first place.

          The type and status badges now appear ONLY when the render did not
          succeed. A finished render says so by being a picture, exactly as
          the History grid decided. */}
      <p className="mt-2.5 text-[10.5px] font-semibold uppercase tracking-[0.14em] text-atelier-muted">
        {[
          generation.character_profile_id
            ? (character?.name ?? h.unknownCharacter)
            : h.noCharacter,
          typeLabel,
          sortedAngleRows.length > 1
            ? formatMsg(h.angleCountOther, { n: sortedAngleRows.length })
            : null,
        ]
          .filter(Boolean)
          .join(" · ")}
      </p>
      <p className="mt-1 text-xs text-atelier-muted">
        <LocalDate date={generation.created_at} mode="datetime" />
      </p>
      {generation.status === "succeeded" && attempts.length > 0 && (
        /* The validation pipeline is the product's whole pitch and used to be
           invisible unless someone expanded the log. One line of proof on
           every successful result, in the accent's serif. */
        <p className="mt-2 font-numeral text-xs font-medium tabular-nums text-atelier-accent">
          {attempts.length === 1
            ? h.validatedFirstTry
            : formatMsg(h.validatedAfterRetries, { n: attempts.length })}
        </p>
      )}
      {generation.status !== "succeeded" && (
        <div className="mt-2.5 flex items-center gap-2">
          <Badge tone={generation.status === "failed" ? "danger" : "neutral"}>{statusLabel}</Badge>
        </div>
      )}

      {/* flex-wrap, and min-w-0 on the row: five controls in a nowrap flex
          overflowed a 328px phone column and pushed the app's one scroller
          sideways, so Upscale, Share and Delete sat off-screen with nothing
          saying so. */}
      <div className="mt-4 flex items-center justify-between gap-4">
        {isOwner && (
          <div className="flex min-w-0 flex-wrap items-center gap-2">
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
                <Link
                  // continue_s carries the source clip's length so the
                  // composer can show continuation's real price BEFORE the
                  // send — the server re-reads it from the row regardless,
                  // so a tampered value changes only the preview.
                  href={`/app/generate?continue=${encodeURIComponent(generation.id)}&continue_s=${generation.video_duration_seconds ?? ""}`}
                >
                  <Button variant="secondary" size="sm">
                    {h.continueClipCta}
                  </Button>
                </Link>
              )}
            {/* Split into layers, on the image itself. The tool page shows a
                recent handful; this is what makes EVERY finished image a
                source (operator, 2026-09-04: "It only gives me 8 images to
                choose from"). Same eligibility rule the action re-runs. */}
            {isOwner && takeLayersIneligibility(generation) === null && (
              <LayersButton generationId={generation.id} />
            )}
            {upscaleTiers.length > 0 && (
              <UpscaleButton
                generationId={generation.id}
                seconds={generation.video_duration_seconds as number}
                tiers={upscaleTiers}
              />
            )}
            {canShareToCommunity && (
              <CommunityShareButton generationId={generation.id} initialShared={sharedToCommunity} />
            )}
            <DeleteGenerationButton id={generation.id} variant="full" redirectAfter="/app/history" />
          </div>
        )}
      </div>

      <LineageChain nodes={lineageNodes} title={h.lineage} />

          {/* Folded, not stacked. The pipeline is the product's pitch and
              worth keeping, but it is proof you consult — not the second
              thing you should meet on the way to your own render. */}
          <details className="group/log mt-6 border-t border-atelier-rule pt-5">
            <summary className="flex cursor-pointer list-none items-center justify-between">
              <h2 className="text-[10.5px] font-semibold uppercase tracking-[0.14em] text-atelier-muted">
                {h.pipelineLog}
              </h2>
              <span className="text-xs text-atelier-muted">
                {formatMsg(h.attemptCountOther, { n: attempts.length })}
              </span>
            </summary>
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
          </details>
        </>
      )}
    </div>
  );
}
