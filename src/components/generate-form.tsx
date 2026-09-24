"use client";

import { Suspense, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/field";
import {
  runGeneration,
  runMultiAngleGeneration,
  pollGeneration,
  listInFlightGenerations,
  requestGenerationCancel,
  requestMultiAngleGenerationCancel,
  discardStoppedGeneration,
  getGenerationThread,
  type HistoryTurn,
  type ChatHistoryItem,
} from "@/lib/generations/actions";
import { planScene } from "@/lib/prompts/actions";
import { synthesizeVoice } from "@/lib/voice/actions";
import { parseVoiceCommand } from "@/lib/voice/commands";
import { recommendCreditPack } from "@/lib/stripe/credit-packs";
import { createCreditCheckoutSession } from "@/lib/stripe/actions";
import { isNativeAppClient } from "@/lib/native/platform";
import { playBillingAvailable } from "@/lib/native/purchases";
import {
  pickPhrasing,
  isTrivialUtterance,
  parseYesNo,
  parseContentType,
  matchCharacterName,
  isSkipAnswer,
  type AgentStep,
} from "@/lib/voice/agent";
import { startListening } from "@/lib/voice/speech-recognition";
import {
  toUserFacingError,
  isRawProviderError,
  classifyFailureDetails,
  isBudgetExhaustedDetail,
  SESSION_EXPIRED_MESSAGE,
} from "@/lib/generations/user-facing-error";
import { isStaleDeployError, reloadForNewDeploy } from "@/lib/stale-deploy";
import { createPortal } from "react-dom";
import {
  storyboardCreditCost,
  getDialogueCreditWeight,
} from "@/lib/generations/providers/video-models";
// The send's price comes from the same function the server charges with —
// see quote.ts for the misquote incidents that made this one function.
import { quoteSend } from "@/lib/generations/quote";
import {
  reserveChatAttachmentPath,
  finalizeChatAttachment,
  deleteChatAttachment,
  type ChatAttachment,
  type UploadErrorCode,
} from "@/lib/attachments/actions";
import { createClient as createBrowserSupabase } from "@/lib/supabase/client";
import type { AgentMode } from "@/lib/agent/prices";
import { parseSseFrames } from "@/lib/agent/sse";
import { playableAudioUrl } from "@/lib/audio/playable-url";
import { classifyMessage } from "@/lib/agent/intent";
import { CHARACTERLESS_MODEL_IDS, MODEL_CAPABILITIES, resolveSendPlan, type PlanIssue, likenessRetryTarget } from "@/lib/generations/send-plan";
import { CINEMA_PRESETS, isProvenPreset, type CinemaPresetCategory } from "@/lib/generations/cinema-presets";
import { UpscaleButton } from "@/components/upscale-button";
import {
  availableUpscaleTiers,
  takeSourceHeight,
  UPSCALE_MAX_SECONDS,
} from "@/lib/generations/upscale";
import {
  PlanIssueRows,
  issueMessage,
  planHasAttachmentRiding,
  planReceiptParts,
} from "@/components/receipt-strip";
import {
  compilePrompt,
  deleteSavedPrompt,
  listSavedPrompts,
  promptFromImage,
  savePrompt,
  touchSavedPrompt,
  type SavedPrompt,
} from "@/lib/prompts/actions";
import { setHasCompletedOnboarding } from "@/lib/profile/actions";
import { DownloadButton } from "@/components/download-button";
import { ZoomableImage } from "@/components/zoomable-image";
import { NEW_CHAT_EVENT } from "@/components/native-quick-pill";
import { CONTENT_TYPE_EVENT } from "@/lib/native/tab-routes";
import { FeedbackLink } from "@/components/feedback-link";
import { ResultActions } from "@/components/result-actions";
import { OnboardingTour, findTourAnchor, type TourStep } from "@/components/onboarding-tour";
import { COOKIE_CONSENT_EVENT, getCookieConsent } from "@/lib/cookie-consent";
import {
  type AttemptLog,
  type PipelineStepLog,
  type ContentType,
} from "@/lib/generations/pipeline";
import { ANGLE_PRESETS, DEFAULT_ANGLE_IDS, getAnglePreset, type AngleId } from "@/lib/generations/angles";
import { type ScenePlan } from "@/lib/generations/scene-plan";
import { FREE_TIER_VIDEO_MODEL_ID, spendableCredits } from "@/lib/plans";
import type { VideoDurationOption } from "@/lib/generations/providers/video-models";
import { FEATURED_VIDEO_MODEL_IDS, getVideoModel } from "@/lib/generations/providers/video-models";
import { getImageModel, selectableImageModels } from "@/lib/generations/providers/image-models";
import {
  DEFAULT_IMAGE_ASPECT,
  DEFAULT_IMAGE_QUALITY,
  defaultImageResolution,
  imageAspectOffers,
  imageQualityOffers,
  imageResolutionOffers,
  offersImageAspect,
  offersImageQuality,
  type ImageAspect,
  type ImageQuality,
  type ImageResolution,
} from "@/lib/generations/providers/image-resolution";
import {
  resolutionCreditWeight,
  videoResolutionOffers,
  type VideoResolution,
} from "@/lib/generations/providers/video-resolution";
import { useLocale } from "@/lib/i18n/provider";
import { isPolicyRefusal, localizeServerText } from "@/lib/i18n/server-text";
import { formatMsg } from "@/lib/i18n/format";
import type { Messages } from "@/lib/i18n/messages";
import { cn } from "@/lib/cn";
import { EXTERNAL_PURCHASE_URL } from "@/lib/domains";
import { useIsNativeApp } from "@/lib/native/use-native";
import { useBackCloser } from "@/lib/native/back-stack";

type VisibleItem =
  | { kind: "step"; attempt: number; step: PipelineStepLog }
  | { kind: "retry"; attempt: number };

function buildTimeline(attempts: AttemptLog[]): VisibleItem[] {
  const items: VisibleItem[] = [];
  attempts.forEach((attempt, idx) => {
    attempt.steps.forEach((step) => items.push({ kind: "step", attempt: attempt.attempt, step }));
    if (!attempt.passed && idx < attempts.length - 1) {
      items.push({ kind: "retry", attempt: attempt.attempt });
    }
  });
  return items;
}

// Mock generations always leave this exact sentence on the "generate" step —
// real ones say which provider/model ran, or surface a real error. Cheap,
// reliable way to tell a turn apart without a dedicated DB column.
function isLiveTurn(attempts: AttemptLog[]): boolean {
  const last = attempts[attempts.length - 1];
  const generateStep = last?.steps.find((s) => s.step === "generate");
  return Boolean(generateStep && !generateStep.detail.startsWith("Mock "));
}

// Turns the pipeline's raw attempt log into one human-readable line the user
// can actually act on, instead of a generic "didn't pass" — either the exact
// provider rejection message (e.g. a content-safety violation, or a bad
// request from a provider), or which specific rulebook items (outfit,
// distinguishing features, ...) never made it into the compiled prompt.
// Takes the whole `generate` message table rather than individual label
// params — it needs several localized strings (stopped, missing-traits) and
// every caller already has `g` in hand from useLocale.
// A failure caused by the user's OWN brand rules — the validate step logs
// the rule, the exact trigger words, and the checker's suggested fix (see
// pipeline.ts). Returns that full explanation, or null for any other
// failure class. Also the gate for the "Generate anyway" override button.
function rulesBlockOf(attempts: AttemptLog[]): string | null {
  const last = attempts[attempts.length - 1];
  if (!last) return null;
  const step = [...(last.steps ?? [])]
    .reverse()
    .find((s) => typeof s.detail === "string" && s.detail.startsWith("Blocked by brand rules:"));
  return step ? step.detail : null;
}

// What every surface shows (the turn plate, the multi-angle plate, the
// hidden-tab notification): the line pickFailureLine chooses, with the
// server's own words in it — a provider's refusal, a step detail — put into
// the reader's language at display (lib/i18n/server-text.ts). The catalog's
// lines pass through untouched, and so does anything not mapped yet.
function summarizeFailure(attempts: AttemptLog[], t: Messages): string | null {
  const line = pickFailureLine(attempts, t.generate);
  return line === null ? null : localizeServerText(line, t);
}

function pickFailureLine(attempts: AttemptLog[], g: Messages["generate"]): string | null {
  // The user's own rules blocking is its own story — the rule, the words
  // that triggered it, and the suggested rewording, verbatim from the log.
  const blocked = rulesBlockOf(attempts);
  if (blocked) return blocked;

  // The platform content policy blocking the COMPILED prompt at the
  // pipeline's last gate, or the OUTPUT gate declining to show the picture
  // that came back (2026-09-10). Either step detail is already the sentence
  // written for the person (pipeline.ts / job-runner.ts), so it is shown
  // verbatim. Checked here, ahead of the provider-error regex below, which
  // keys on "error (4xx)" and would never see it — a refusal that fell
  // through to the generic line would tell someone nothing about the one
  // thing they can change.
  const policyAttempt = attempts.find(
    (a) => a.issues?.includes("content_policy") || a.issues?.includes("output_blocked"),
  );
  if (policyAttempt) {
    const step = [...(policyAttempt.steps ?? [])].reverse().find((st) => st.step === "validate");
    if (step?.detail) return step.detail;
  }

  // Queued (async) renders log provider errors as a step detail with an
  // EMPTY issues array — the old issues-only checks below never saw them,
  // so the UI fell back to a generic line while the provider's own words
  // sat unread in the log (2026-08-24, operator: "Just says couldn't
  // validate"). Pull the human sentence out of the error payload.
  // Classify across EVERY attempt, not just the last one. The real cause of
  // a failure often lives in attempt 1 while the last attempt holds only the
  // budget-exhausted stub (2026-08-29: a user's photo was rejected twice,
  // and the summary showed her the developer sentence about "generation
  // attempts" instead of the one thing she could fix — the photo).
  // Checked after the rules-block story (more specific) and skipped for
  // user-initiated stops below (a cancelled run isn't a failure).
  const failureKind = classifyFailureDetails(
    attempts.flatMap((a) => (a.steps ?? []).map((s) => s.detail)),
  );

  const lastAttempt = attempts[attempts.length - 1];
  if (lastAttempt && (lastAttempt.issues?.length ?? 0) === 0) {
    if (failureKind === "attachment") return g.failAttachmentUnreadable;
    const errStep = [...(lastAttempt.steps ?? [])]
      .reverse()
      .find((s) => typeof s.detail === "string" && /\berror \(\d{3}\)/.test(s.detail));
    if (errStep) {
      const m =
        errStep.detail.match(/"msg"\s*:\s*"([^"]+)"/) ??
        errStep.detail.match(/"message"\s*:\s*"([^"]+)"/);
      // Extracted provider sentences pass through toUserFacingError too —
      // the no-match branch used to return a raw dump slice verbatim.
      if (m) return toUserFacingError(m[1]).slice(0, 220);
      return toUserFacingError(errStep.detail).slice(0, 220);
    }
  }

  const last = attempts[attempts.length - 1];
  if (!last) return null;

  // A user-initiated stop, not a real failure — say so plainly instead of
  // running it through the provider-error/missing-traits messaging below,
  // which would either show nothing useful (no error step exists) or, worse,
  // surface a stale reason left over from an earlier attempt.
  if (last.issues.includes("cancelled")) return g.stoppedByUser;

  // The one cause the user can fix themselves wins over everything generic.
  if (failureKind === "attachment") return g.failAttachmentUnreadable;

  if (last.issues.includes("provider_error")) {
    const errorStep = [...last.steps]
      .reverse()
      .find(
        (s) =>
          (s.step === "generate" || s.step === "review" || s.step === "draft") &&
          !s.detail.startsWith("Generated") &&
          !s.detail.startsWith("Mock ") &&
          // The budget stub isn't a cause, it's a stop sign — skipping it
          // here lets the friendly all-attempts line below take over.
          !isBudgetExhaustedDetail(s.detail),
      );
    if (errorStep) {
      // Provider errors usually come back as raw JSON — pull out just the
      // "message" field if there is one, instead of showing the whole blob.
      // toUserFacingError is a second, catch-all pass for whatever's left
      // over (no "message" field, an unfamiliar shape, etc.) so nothing
      // resembling raw JSON ever reaches the UI.
      const jsonMatch = errorStep.detail.match(/"message"\s*:\s*"([^"]+)"/);
      const short = (jsonMatch?.[1] ?? errorStep.detail.split("\n")[0]).trim();
      return toUserFacingError(short).slice(0, 280);
    }
    // No informative error step in the last attempt (it held only the
    // budget stub, or nothing) — say what happened in human words.
    if (failureKind === "attempts") return g.failAllAttempts;
  }

  const traitIssues = last.issues.filter((i) => i !== "provider_error");
  if (traitIssues.length > 0) {
    return formatMsg(g.resultMissing, { issues: traitIssues.join(", ") });
  }

  return null;
}

type QueuedOutcome =
  | { state: "succeeded"; resultUrl: string | null }
  | { state: "failed"; error: string }
  | { state: "cancelled" }
  | { state: "abandoned" };

// Waits for a queued video render by asking the server how it's going, rather
// than by holding a request open for the whole render.
//
// Video generation used to run inside a single server action that stayed open
// until the render finished. Kling takes six to ten minutes and dialogue adds
// two or three more, but Vercel kills any function at 300 seconds on the
// Hobby plan, so the longest jobs — multi-angle above all — were being paid
// for on fal.ai's side and then killed on ours before the result could be
// saved. Multi-angle had never once completed.
//
// Now the server queues the job and returns straight away, and this drives it
// to completion from the browser. Because the job's state lives in the
// database, closing the tab or locking the phone no longer loses it: the work
// carries on and the result is in History either way. That property is what
// makes the mobile apps viable at all.
async function awaitQueuedGeneration(
  generationId: string,
  onProgress: (label: string) => void,
  shouldAbandon: () => boolean,
  // Localized "lost track of this render" copy — passed in because this
  // module-level helper has no access to useLocale, and the message is
  // user-facing (it lands in the failure card verbatim).
  lostTrackMessage: string,
): Promise<QueuedOutcome> {
  // Starts responsive, then eases off. Short renders feel immediate, while a
  // ten-minute one settles to a poll every eight seconds — roughly 80 requests
  // rather than the 300 a flat 2s interval would make, for no perceptible
  // difference to the person waiting.
  let delayMs = 2_000;
  const MAX_DELAY_MS = 8_000;
  // Transient network blips must not fail a render that's going fine, but an
  // endlessly unreachable server shouldn't spin forever either.
  let consecutiveErrors = 0;

  while (true) {
    if (shouldAbandon()) return { state: "abandoned" };

    await new Promise((resolve) => setTimeout(resolve, delayMs));
    delayMs = Math.min(Math.round(delayMs * 1.35), MAX_DELAY_MS);

    if (shouldAbandon()) return { state: "abandoned" };

    let poll;
    try {
      poll = await pollGeneration(generationId);
      consecutiveErrors = 0;
    } catch {
      consecutiveErrors += 1;
      // Give up on WATCHING only after a long while, and never conclude the
      // render itself failed — it's still queued at fal and still recorded
      // server-side, so it lands in History regardless.
      //
      // The old threshold was 15, roughly two minutes, and multi-angle blew
      // straight through it: a sibling angle finishing used to trigger a route
      // revalidation that aborted the other in-flight polls, and those aborts
      // counted as failures. Two healthy renders got reported as failed.
      // The revalidation is gone (see pollGeneration), but this stays
      // generous — a transient network blip must never be mistaken for a
      // failed generation.
      if (consecutiveErrors >= 60) {
        return { state: "failed", error: lostTrackMessage };
      }
      continue;
    }

    if (poll.error !== null) {
      // Same rule the shared poll-client carries (see its comment): the auth
      // check's transient blip must never end the wait as a failure while
      // the paid render keeps going at fal. Retried under the same budget
      // as thrown transport errors; every other action error is a verdict.
      if (poll.error === SESSION_EXPIRED_MESSAGE) {
        consecutiveErrors += 1;
        if (consecutiveErrors >= 60) {
          return { state: "failed", error: lostTrackMessage };
        }
        continue;
      }
      return { state: "failed", error: poll.error };
    }

    switch (poll.state) {
      case "pending":
        onProgress(poll.progress);
        break;
      case "succeeded":
        return { state: "succeeded", resultUrl: poll.resultUrl };
      case "failed":
        return { state: "failed", error: poll.message };
      case "cancelled":
        return { state: "cancelled" };
      case "gone":
        // The job row is already gone, so it finished on some other poll —
        // another tab, or a duplicate in-flight request. Not an error; the
        // caller re-reads the generation to find out how it went.
        return { state: "succeeded", resultUrl: null };
    }
  }
}

// Real incident, 2026-08-09: both runGeneration and runMultiAngleGeneration
// were called with no try/catch around them. That's fine when the action
// itself returns a normal { error } — but when the *call* throws instead
// (Next.js can't parse the Server Action's response at all), the await
// rejects, nothing after it ever runs, and the composer is left stuck in
// submitting=true forever with zero visible feedback — confirmed via a real
// auto-filed report (generation_reports id abd93549), which only exists
// because the global unhandled-rejection listener in app-error-reporter.tsx
// caught what this component didn't. The single most common cause of the
// call itself throwing (vs. returning an error) is a deploy landing while
// the tab was already open — the browser is still running the previous
// build's JS, which references a Server Action id the now-live server no
// longer recognizes. No amount of retrying fixes that from the stale tab;
// only a real page reload fetches the new build. Detecting that specific
// signature and reloading automatically turns a dead end into a one-second
// hiccup instead of a silent hang. The detector is the shared one in
// stale-deploy.ts: this file used to keep its own copy, which knew only the
// older "unexpected response" wording, so Next 16's UnrecognizedActionError
// showed submitFailed and never reloaded (2026-09-11).

// Real generations can take anywhere from a few seconds to a few minutes —
// long enough that switching tabs or apps while waiting is completely
// reasonable. A system notification catches the person when they do, so
// they're not stuck periodically checking back. Permission is requested from
// inside the submit handler (a real click), since browsers require a user
// gesture for the prompt to work at all; the notification itself only fires
// if the tab isn't focused, since the in-page UI already updates live if it is.
function requestNotificationPermission() {
  if (typeof window === "undefined" || !("Notification" in window)) return;
  if (Notification.permission === "default") {
    void Notification.requestPermission();
  }
}

// Best-effort only, and guaranteed never to throw. Android Chrome forbids the
// page-context `new Notification(...)` constructor outright (it throws a
// TypeError; notifications there must go through a service worker) — and this
// used to run in the middle of the completion handlers, so on Android a
// backgrounded render's success bookkeeping died on this line: the finished
// result never reached the chat, submitting stayed true, and the composer was
// stuck on Stop forever. The callers now run their bookkeeping FIRST (see
// submitPrompt/confirmMultiAngle), and this wraps everything regardless, so a
// notification can only ever fail silently — never take the composer with it.
function notifyIfHidden(title: string, body: string) {
  try {
    if (typeof window === "undefined" || !("Notification" in window)) return;
    if (Notification.permission !== "granted") return;
    if (document.visibilityState !== "hidden") return;

    const sw = navigator.serviceWorker;
    if (sw?.getRegistration) {
      // Prefer the service-worker route — the only one Android Chrome
      // supports, and it works everywhere else too when a worker is
      // registered. Fall back to the page-context constructor when there's
      // no registration; if THAT throws (Android with no worker), the
      // rejection is swallowed and the notification is simply skipped.
      void sw
        .getRegistration()
        .then((registration) => {
          if (registration) return registration.showNotification(title, { body });
          new Notification(title, { body });
        })
        .catch(() => {
          // No way left to notify — skip silently.
        });
      return;
    }

    new Notification(title, { body });
  } catch {
    // Notifications are a nice-to-have; the in-page UI already shows the
    // result. Never let this break anything.
  }
}

function stepLabel(step: PipelineStepLog["step"], isLive: boolean, g: Messages["generate"]): string {
  switch (step) {
    case "draft":
      return isLive ? g.stepDraftLive : g.stepDraft;
    case "review":
      return isLive ? g.stepReviewLive : g.stepReview;
    case "generate":
      return g.stepGenerate;
    case "validate":
      return g.stepValidate;
    case "speech":
      return g.stepSpeech;
    case "lipsync":
      return g.stepLipsync;
    // A Recast take's face report (face-lock.ts) — its sentence carries the
    // whole of it, so the trace shows no heading of its own.
    case "take-report":
      return "";
  }
}

function PipelineTrace({
  timeline,
  revealedCount,
  isAnimating,
  isLive,
}: {
  timeline: VisibleItem[];
  revealedCount: number;
  isAnimating: boolean;
  isLive: boolean;
}) {
  const { t } = useLocale();
  const g = t.generate;
  return (
    <ol className="space-y-3">
      {timeline.slice(0, revealedCount).map((item, idx) => {
        const isCurrent = idx === revealedCount - 1 && isAnimating;
        if (item.kind === "retry") {
          return (
            <li key={idx} className="pl-1">
              <Badge tone="warning">{formatMsg(g.retryBadge, { n: item.attempt })}</Badge>
            </li>
          );
        }
        return (
          <li key={idx} className="flex items-start gap-3">
            <span
              className={cn(
                "mt-2 h-1.5 w-1.5 flex-shrink-0 rounded-full",
                isCurrent ? "animate-pulse bg-atelier-ink" : "bg-atelier-rule",
              )}
            />
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <span className="inline-flex items-center text-[10px] font-medium uppercase tracking-widest text-atelier-muted">
                  {stepLabel(item.step.step, isLive, g)}
                </span>
                {timeline.some((entry) => entry.kind === "step" && entry.attempt > 1) && (
                  <span className="text-[11px] text-atelier-muted/70">
                    {formatMsg(g.attemptSuffix, { n: item.attempt })}
                  </span>
                )}
              </div>
              <p className="mt-1 whitespace-pre-wrap text-sm text-atelier-ink/80">
                {/* Raw provider dumps (fal/OpenAI JSON, status codes, docs
                    URLs) are admin diagnostics — in the composer everyone
                    gets the friendly line; the full text is preserved in
                    pipeline_log for the history page (admin view) and
                    /admin/reports. Our own sentences (a provider's
                    refusal) go through the display-time translator. */}
                {isRawProviderError(item.step.detail)
                  ? g.stepFailedGeneric
                  : isBudgetExhaustedDetail(item.step.detail)
                    ? g.stepAllAttemptsUsed
                    : localizeServerText(item.step.detail, t)}
              </p>
            </div>
          </li>
        );
      })}
    </ol>
  );
}

function ResultMedia({
  succeeded,
  resultUrl,
  contentType,
  prompt,
  generationId,
}: {
  succeeded: boolean;
  resultUrl: string | null;
  contentType: ContentType;
  // Which render this is. Threaded purely so a download here records a
  // "downloaded" signal — this is the render someone JUST made, the most
  // telling download on the site, and it was the one surface recording
  // nothing. Every caller already had the id for ResultActions beside it.
  generationId?: string;
  // The prompt that produced this result — used as the image's alt text so
  // it actually describes what's in the picture (each generation is unique
  // to its prompt) instead of the same generic "Generated result" string on
  // every single image.
  prompt?: string;
}) {
  const { t } = useLocale();
  if (!succeeded) return null;

  if (resultUrl && (resultUrl.startsWith("http") || resultUrl.startsWith("/api/media/"))) {
    return contentType === "video" ? (
      <div className="relative mt-4">
        <video
          src={resultUrl}
          controls
          aria-label={prompt}
          className="aspect-video w-full rounded-media bg-neutral-950"
        />
        <DownloadButton url={resultUrl} contentType={contentType} generationId={generationId} />
      </div>
    ) : (
      <div className="relative mt-4">
        <ZoomableImage
          src={resultUrl}
          alt={prompt || t.generate.resultAlt}
          className="w-full rounded-media bg-atelier-ink/5 object-cover"
          downloadUrl={resultUrl}
        />
        <DownloadButton url={resultUrl} contentType={contentType} generationId={generationId} />
      </div>
    );
  }

  const typeLabel = (contentType === "video" ? t.generate.video : t.generate.image).toLowerCase();

  return (
    <div className="mt-4 flex aspect-video items-center justify-center rounded-media bg-atelier-ink/5 text-center">
      <p className="max-w-xs px-4 text-xs text-atelier-muted">
        {formatMsg(t.generate.simulatedResult, { type: typeLabel })}
      </p>
    </div>
  );
}

function AttachmentThumb({ attachment, className }: { attachment: ChatAttachment; className?: string }) {
  if (attachment.type.startsWith("image/")) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img src={attachment.url} alt={attachment.name} className={cn("object-cover", className)} />
    );
  }
  if (attachment.type.startsWith("video/")) {
    return <video src={attachment.url} className={cn("object-cover", className)} muted />;
  }
  return (
    <div className={cn("flex items-center justify-center bg-atelier-ink/5 text-atelier-muted", className)}>
      <FileIcon className="h-5 w-5" />
    </div>
  );
}

// Relative timestamp under a sent prompt — "5 minutes ago", Claude-style.
// Intl.RelativeTimeFormat gives us "hace 5 minutos" / "5 minuti fa" / "há 5
// minutos" for free in the viewer's own language, so no i18n keys needed.
// Beyond a week the relative form stops being useful ("3 months ago" hides
// more than it tells in a work thread), so older prompts fall back to the
// short absolute date.
function promptTimestamp(iso: string, locale: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  // Clamped to the past: a message can't have been sent in the future, so a
  // positive delta only ever means clock skew between the server timestamp
  // and this device — treat it as "just now" rather than letting the buckets
  // below round it into "in 1 minute".
  const seconds = Math.min(0, Math.round((d.getTime() - Date.now()) / 1000));
  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: "auto" });
  const abs = Math.abs(seconds);
  // Under ~45s reads as "just now" — the old cutoff labelled a 2-second-old
  // message "1 minute ago", which looked stale the moment it was sent.
  // numeric:"auto" turns format(0, "second") into the localized idiom
  // ("now" / "ahora" / "ora" / "agora"), so no i18n keys needed here either.
  if (abs < 45) return rtf.format(0, "second");
  if (abs < 3600) return rtf.format(Math.min(-1, Math.round(seconds / 60)), "minute");
  if (abs < 86400) return rtf.format(Math.round(seconds / 3600), "hour");
  if (abs < 604800) return rtf.format(Math.round(seconds / 86400), "day");
  return d.toLocaleDateString(locale, { month: "short", day: "numeric", year: "numeric" });
}

function UserBubble({
  prompt,
  attachments,
  createdAt,
}: {
  prompt: string;
  attachments?: ChatAttachment[];
  createdAt?: string;
}) {
  const { t, locale } = useLocale();
  const g = t.generate;
  const [copied, setCopied] = useState(false);
  // Ticks once a minute purely to refresh the relative timestamp — without
  // it, "1 minute ago" stays frozen for as long as the tab is open.
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!createdAt) return;
    const id = setInterval(() => setTick((n) => n + 1), 60_000);
    return () => clearInterval(id);
  }, [createdAt]);

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(prompt);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard unavailable — nothing useful to do beyond not confirming.
    }
  }

  return (
    <div className="flex justify-end">
      <div className="group/prompt max-w-[85%] space-y-2">
        {attachments && attachments.length > 0 && (
          <div className="flex flex-wrap justify-end gap-1.5">
            {attachments.map((att) => (
              <a
                key={att.path}
                href={att.url}
                target="_blank"
                rel="noreferrer"
                title={att.name}
                className="block h-16 w-16 flex-shrink-0 overflow-hidden rounded-media border border-atelier-rule"
              >
                <AttachmentThumb attachment={att} className="h-full w-full" />
              </a>
            ))}
          </div>
        )}
        {prompt && (
          <div className="rounded-[18px] rounded-br-[6px] bg-atelier-surface px-4.5 py-3 text-sm leading-relaxed text-atelier-ink shadow-[0_1px_2px_rgba(33,29,22,0.05),0_8px_20px_-14px_rgba(33,29,22,0.12)]">
            {prompt}
          </div>
        )}
        {prompt && (
          <div className="flex items-center justify-end gap-1 pr-1 transition-opacity duration-150 sm:opacity-0 sm:focus-within:opacity-100 sm:group-hover/prompt:opacity-100">
            {createdAt && (
              <time dateTime={createdAt} className="text-[11px] text-atelier-muted/70">
                {promptTimestamp(createdAt, locale)}
              </time>
            )}
            <button
              type="button"
              onClick={handleCopy}
              aria-label={copied ? g.copied : g.copyPrompt}
              title={copied ? g.copied : g.copyPrompt}
              className="flex h-6 w-6 items-center justify-center rounded-full text-atelier-muted transition-colors hover:bg-atelier-ink/5 hover:text-atelier-ink"
            >
              {copied ? (
                <svg viewBox="0 0 24 24" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6 9 17l-5-5" /></svg>
              ) : (
                <svg viewBox="0 0 24 24" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="9" width="12" height="12" rx="2" /><path d="M5 15H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1" /></svg>
              )}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function VoiceIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <path d="M11 5 6 9H2v6h4l5 4V5Z" />
      <path d="M16.5 8.5a5 5 0 0 1 0 7" />
      <path d="M19 6a9 9 0 0 1 0 12" />
    </svg>
  );
}

function BookmarkIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      {...props}
    >
      <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z" />
    </svg>
  );
}

function SparkIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" {...props}>
      <path d="M12 2l1.9 5.6L19.5 9l-4.4 3.4 1.5 5.7L12 15l-4.6 3.1 1.5-5.7L4.5 9l5.6-1.4L12 2z" />
    </svg>
  );
}

function PlusIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
}

function SendIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <path d="M12 19V5" />
      <path d="M6 11l6-6 6 6" />
    </svg>
  );
}

// A filled square in a circle — same shape Claude/ChatGPT use in place of
// the send button while a response is still generating.
function StopIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" {...props}>
      <rect x="6" y="6" width="12" height="12" rx="2" />
    </svg>
  );
}

function FileIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z" />
      <path d="M14 2v6h6" />
    </svg>
  );
}

function XIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <path d="M18 6 6 18M6 6l12 12" />
    </svg>
  );
}

function LoaderIcon({ className, ...props }: React.SVGProps<SVGSVGElement>) {
  // Every caller passes its own size via `className` (h-4 w-4, etc.) — since
  // that's spread onto the element, it was silently replacing "animate-spin"
  // outright instead of combining with it, so every loading spinner in the
  // app (including this one) was quietly rendering as a static, non-spinning
  // icon. Found while adding a real "is it still working?" indicator.
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      className={cn("animate-spin", className)}
      {...props}
    >
      <path d="M12 2a10 10 0 0 1 10 10" />
    </svg>
  );
}

// Aspect glyphs: a wide frame and a tall frame — restored 2026-09-02
// (operator: "the aspect ratio must have its icons").
function LandscapeIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <rect x="3" y="6.5" width="18" height="11" rx="2" />
    </svg>
  );
}

function PortraitIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <rect x="6.5" y="3" width="11" height="18" rx="2" />
    </svg>
  );
}

function AnglesIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <path d="M12 3 3 8.5 12 14l9-5.5L12 3Z" />
      <path d="m3 15.5 9 5.5 9-5.5" />
      <path d="m3 12 9 5.5 9-5.5" />
    </svg>
  );
}

function ChevronDownIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <path d="m6 9 6 6 6-6" />
    </svg>
  );
}

function ImageIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <circle cx="8.5" cy="8.5" r="1.5" />
      <path d="m21 15-5-5L5 21" />
    </svg>
  );
}

function VideoIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <rect x="2" y="6" width="14" height="12" rx="2" />
      <path d="m22 8-6 4 6 4V8Z" />
    </svg>
  );
}

function CameraIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <path d="M9 3 7.17 5H4a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-3.17L15 3H9Z" />
      <circle cx="12" cy="13" r="3.5" />
    </svg>
  );
}

function CheckIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.25" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <path d="M20 6 9 17l-5-5" />
    </svg>
  );
}

// Multi-image reference + storyboard toggle — a small stack-of-photos glyph,
// Filmstrip — the Storyboard button (a start frame and an end frame).
// Distinct from ClapperIcon below, which is Cinema Studio: this one is a
// plain barred rectangle, that one has an angled hinged top.
function FilmIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <path d="M9 5v14M15 5v14" />
    </svg>
  );
}

function StackIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <rect x="7" y="7" width="14" height="14" rx="2" />
      <path d="M3 15V5a2 2 0 0 1 2-2h10" />
    </svg>
  );
}

// Clapperboard — Cinema Studio (a director planning a shot list).
//
// Deliberately NOT FilmIcon, which is the Storyboard button two positions
// along in the same row. Shipping both with the same glyph put two different
// features behind one symbol, which is the kind of thing nobody misreads as a
// bug — they just assume they clicked the wrong one. Distinct from its three
// neighbours by silhouette, not only by detail: AnglesIcon is a stack of
// chevrons, StackIcon two offset squares, FilmIcon a plain barred rectangle,
// and this one is the only shape with a hinged, angled top.
function ClapperIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <path d="M3 11h18v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-8Z" />
      <path d="M3.7 6.6 20.4 4.4l.9 4.4L4.6 11 3.7 6.6Z" />
      <path d="m9.2 5.9.7 4.4M14.6 5.2l.7 4.4" />
    </svg>
  );
}

type PendingAttachment = {
  id: string;
  name: string;
  type: string;
  size: number;
  status: "uploading" | "ready" | "error";
  url?: string;
  path?: string;
  error?: string;
  // Measured server-side at upload (Send Receipt P1) — feeds the resolver's
  // provider aspect-bound checks. Absent = unmeasured = never blocks.
  width?: number;
  height?: number;
  // Judged server-side at upload — whether this reads as a real human.
  // Only ever silences a warning; absent = unknown = behaves as before.
  style?: "photoreal" | "illustrated" | null;
};

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

// A small status message that rises up from behind the composer box —
// used for anything transient the person needs to notice but that shouldn't
// interrupt them (upload failures, hitting a limit, validation nudges).
// Keyed by its own message text in the parent, so a new message re-triggers
// the rise-in animation; auto-dismisses itself after a few seconds via
// onDone, same as it would if the person had just read it and moved on.
function ComposerToast({ message, onDone }: { message: string; onDone: () => void }) {
  const [entered, setEntered] = useState(false);

  useEffect(() => {
    const enter = requestAnimationFrame(() => setEntered(true));
    const startExit = setTimeout(() => setEntered(false), 4200);
    const remove = setTimeout(onDone, 4500);
    return () => {
      cancelAnimationFrame(enter);
      clearTimeout(startExit);
      clearTimeout(remove);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="pointer-events-none absolute inset-x-6 top-3 z-0 flex justify-center">
      <div
        role="status"
        aria-live="polite"
        className={cn(
          "pointer-events-auto max-w-[92%] rounded-full bg-atelier-ink px-4 py-2.5 text-center text-sm text-atelier-paper shadow-[0_12px_28px_-10px_rgba(33,29,18,0.45)] transition-all duration-300 ease-out",
          entered ? "-translate-y-[130%] opacity-100" : "translate-y-0 opacity-0",
        )}
      >
        {message}
      </div>
    </div>
  );
}

// The helpline directory the self-harm refusal names in every language
// (content-policy.test.ts holds each catalog to carrying it).
const HELPLINE_DIRECTORY = "findahelpline.com";

// The prompt gate's answer, fused to the composer's top edge — the same flat
// strip as the credits and usage banners below it (operator's pick,
// 2026-09-10). These used to go to ComposerToast, which leaves after 4.2 s
// whatever it says: rendered at phone width, the self-harm refusal and its
// helplines wrapped to 7 lines in English and 9 in Portuguese, inside a pill
// that had risen into the Stage and was gone before it could be read. This
// stays until it is dismissed, the refused prompt is edited, or the next send
// clears it. Ink text rather than the strips' muted grey: it answers what the
// person just did, and it may carry a number they need.
function PolicyRefusalBanner({
  message,
  hero,
  dismissLabel,
  onDismiss,
}: {
  message: string;
  // The hero layout's composer has a larger corner radius to match.
  hero: boolean;
  dismissLabel: string;
  onDismiss: () => void;
}) {
  // Opens on the next frame and stays mounted through the dismiss, so it
  // animates both ways — InsufficientCreditsBanner's pattern.
  const [open, setOpen] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  useEffect(() => {
    const id = requestAnimationFrame(() => setOpen(true));
    return () => cancelAnimationFrame(id);
  }, []);
  // Hands the dismissal to the parent once the strip has folded away. In an
  // effect rather than the click handler so an unmount (a newer message
  // replacing this one) cancels it instead of clearing that newer message.
  useEffect(() => {
    if (!dismissed) return;
    const id = setTimeout(onDismiss, 300);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dismissed]);

  const visible = open && !dismissed;
  const at = message.indexOf(HELPLINE_DIRECTORY);

  return (
    <div
      className={cn(
        "grid transition-all duration-300 ease-out",
        visible ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0",
      )}
    >
      <div className="overflow-hidden">
        <div
          role="status"
          className={cn(
            "flex items-start gap-2.5 bg-atelier-surface/90 px-4 py-2.5 text-xs text-atelier-muted shadow-[0_0_0_1px_var(--frost-ring)] backdrop-blur-xl transition-transform duration-300 ease-out",
            hero ? "rounded-t-[28px]" : "rounded-t-[26px]",
            visible ? "translate-y-0" : "-translate-y-2",
          )}
        >
          <p className="flex-1 leading-relaxed text-atelier-ink">
            {at < 0 ? (
              message
            ) : (
              <>
                {message.slice(0, at)}
                <a
                  href={`https://${HELPLINE_DIRECTORY}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="font-medium text-atelier-accent underline underline-offset-2 hover:text-atelier-accent/80"
                >
                  {HELPLINE_DIRECTORY}
                </a>
                {message.slice(at + HELPLINE_DIRECTORY.length)}
              </>
            )}
          </p>
          <button
            type="button"
            onClick={() => setDismissed(true)}
            aria-label={dismissLabel}
            className="flex-shrink-0 cursor-pointer rounded-full p-1 text-atelier-muted transition-colors hover:bg-atelier-ink/5 hover:text-atelier-ink"
          >
            <XIcon className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
    </div>
  );
}


// Shown when the selected model and duration cost more credits than the
// account has left.
//
// Styled to match UsageBanner exactly, and for the same reasons its own
// comment gives: one flat, light strip attached to the composer with no gap,
// sharing the outer card's top radius, no shadow of its own. Two earlier
// passes at that banner were rejected for looking like a floating alert, and
// this one was written as an amber warning box with a black pill button —
// which reintroduced precisely the look that was rejected.
//
// Nothing here shouts. The numbers do the work: the strip says what the
// selection costs, what's left, and offers the smallest pack that covers the
// gap. Same neutral palette, same 12px text, same inline underlined action as
// the usage strip's "buy credits" link.
function InsufficientCreditsBanner({
  needed,
  available,
  modelName,
  seconds,
  kind,
  allowExternalPurchase,
  freeReturnsTomorrow,
}: {
  needed: number;
  available: number;
  modelName: string;
  seconds: number;
  // Free-plan account whose daily slot is already spent (2026-09-05 flaw
  // hunt): the homepage sells "a free generation every day", but once
  // today's was used this banner was a bare buy-credits wall — the one
  // sentence saying the slot returns tomorrow lived in a server rejection
  // reached only by pressing Render anyway. Now the promise leads.
  freeReturnsTomorrow: boolean;
  // Which message template to use. Image mode has no user-facing model name
  // or duration — "{model} at {seconds}s" printed the VIDEO picker's
  // selection over an image send (caught 2026-08-26 during the Another-shot
  // E2E: composer in Image mode, strip claiming "Kling O3 Pro at 5s").
  kind: "image" | "video";
  // US-only, server-decided (lib/native/external-purchase): the app may
  // show a link OUT to website checkout at the exact moment someone is
  // short on credits. False everywhere else — the banner stays a plain
  // message there.
  allowExternalPurchase: boolean;
}) {
  const { t } = useLocale();
  const g = t.generate;
  const pack = recommendCreditPack(Math.max(0, needed - available));

  // Native (iOS/Android app) must show no purchase entry point — Apple 3.1.1 /
  // Google Play. Keep the shortfall MESSAGE (the numbers below), but drop the
  // "Add credits" checkout button and its form when in the app. Defaults to
  // false so a browser renders the button on the first frame; only flips true
  // once the client detector confirms native.
  const [native, setNative] = useState(false);
  const [canPlayBilling, setCanPlayBilling] = useState(false);
  useEffect(() => {
    setNative(isNativeAppClient());
    setCanPlayBilling(playBillingAvailable());
  }, []);

  // Dismissed for THIS selection only. The call site keys this component on
  // the model and duration, so picking a different combination mounts a fresh
  // one and the strip returns — "suspend" rather than "never show again",
  // since the next selection is a different piece of information.
  const [dismissed, setDismissed] = useState(false);

  // Starts collapsed and opens on the next frame, so the strip animates in
  // rather than appearing fully formed. Kept mounted while dismissed instead
  // of unmounting, which is what lets it animate OUT — an unmounted element
  // can't transition.
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const id = requestAnimationFrame(() => setOpen(true));
    return () => cancelAnimationFrame(id);
  }, []);

  const visible = open && !dismissed;

  return (
    // The grid 0fr/1fr pair is what makes the height animate without anyone
    // having to know how tall the content is. A max-height guess would either
    // clip long copy (the translated strings run longer) or ease against a
    // number far larger than the real height, which reads as a stall before
    // anything moves. The inner overflow-hidden is what actually clips during
    // the transition.
    <div
      className={cn(
        "grid transition-all duration-300 ease-out",
        visible ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0",
      )}
    >
      <div className="overflow-hidden">
        <div
          role="status"
          className={cn(
            "flex items-center gap-2.5 rounded-t-[26px] bg-atelier-surface/90 px-4 py-2.5 text-xs text-atelier-muted shadow-[0_0_0_1px_var(--frost-ring)] backdrop-blur-xl transition-transform duration-300 ease-out",
            // Slides up behind the composer on the way out, down into place on
            // the way in.
            visible ? "translate-y-0" : "-translate-y-2",
          )}
        >
          <p className="flex-1">
        {kind === "image"
          ? formatMsg(g.insufficientCreditsImage, { needed, available })
          : formatMsg(needed === 1 ? g.insufficientCreditsOne : g.insufficientCredits, { model: modelName, seconds, needed, available })}{" "}
        {freeReturnsTomorrow && <>{g.freeReturnsTomorrow}{" "}</>}
        {/* An inline underlined action, matching the usage strip's link. A
            filled button here reads as an interruption; this reads as the
            next thing you might do. */}
        {/* cursor-pointer is required, not decorative: browsers give <button>
            the default arrow, and only <a> gets the hand automatically. This
            is styled as a link, so without it the one thing that looks
            clickable doesn't feel clickable. */}
        {/* No purchase entry point in the native app (Apple 3.1.1 / Google
            Play): the message above still tells the person they're short, but
            the "Add credits" button and its checkout form are omitted. */}
        {!native && (
          <button
            type="submit"
            form="buy-credits-shortfall"
            className="cursor-pointer font-medium text-atelier-accent underline underline-offset-2 hover:text-atelier-accent/80"
          >
            {formatMsg(g.addCreditsCta, { n: pack.credits })}
          </button>
        )}
        {/* The binary-can-bill counterpart (Play Billing resumed,
            2026-09-02): when this install carries the Purchases plugin,
            the same inline-link voice walks to the in-app store on the
            usage tab. Takes precedence over the US external link — native
            billing beats steering out. Old reader-mode binaries fail the
            plugin check and keep their approved zero-purchase surface. */}
        {native && canPlayBilling && (
          <Link
            href="/app/settings?tab=usage"
            className="cursor-pointer font-medium text-atelier-accent underline underline-offset-2 hover:text-atelier-accent/80"
          >
            {formatMsg(g.addCreditsCta, { n: pack.credits })}
          </Link>
        )}
        {native && !canPlayBilling && allowExternalPurchase && (
          <button
            type="button"
            onClick={() => window.open(EXTERNAL_PURCHASE_URL, "_blank")}
            className="cursor-pointer font-medium text-atelier-accent underline underline-offset-2 hover:text-atelier-accent/80"
          >
            {t.common.webPurchaseCta}
          </button>
        )}
      </p>
      {/* Same dismiss affordance as the usage strip — same size, same
          placement on the far right, same hover. */}
      <button
        type="button"
        onClick={() => setDismissed(true)}
        aria-label={g.dismissBanner}
        className="flex-shrink-0 cursor-pointer rounded-full p-1 text-atelier-muted transition-colors hover:bg-atelier-ink/5 hover:text-atelier-ink"
      >
        <XIcon className="h-3.5 w-3.5" />
      </button>
      {/* The form lives outside the paragraph so the composer's own form
          isn't nested inside it — nested forms are invalid HTML and the
          inner one silently stops submitting. Omitted entirely in native. */}
      {!native && (
        <form id="buy-credits-shortfall" action={createCreditCheckoutSession} className="hidden">
          <input type="hidden" name="pack" value={pack.id} />
          <input type="hidden" name="return_to" value="/app/generate" />
        </form>
      )}
        </div>
      </div>
    </div>
  );
}

// Usage-status strip shown once an account is close to its monthly limit.
// Matches Claude's own "Now using credits" banner: a plain, light, flat
// card attached with zero gap directly on top of the composer — not a
// floating toast or pill. It's a normal-flow sibling rendered right before
// <form> (see the call site), so it and the form below read as one
// continuous rounded shape: this piece gets the outer card's own top
// radius + a matching border, the form keeps its existing rounded-b-[22px]
// + border-t as the seam between the two, so there's no double border and
// no independent shadow on the banner itself. currentPeriodEnd comes from
// the account's actual Stripe billing cycle when known
// (profiles.current_period_end); for a "none"-plan/bonus-only account, or
// an existing subscriber not yet backfilled with real Stripe dates, it's
// null and the fallback copy ("resets on the 1st") is shown instead — see
// LAUNCH_CHECKLIST.md. Dismissal is local component state, not persisted
// anywhere: reappears on the next fresh page load if the account is still
// in the approaching-limit band, since this is a live readout, not a
// one-time announcement.
function UsageBanner({
  used,
  limit,
  currentPeriodEnd,
  g,
}: {
  used: number;
  limit: number;
  currentPeriodEnd: string | null;
  g: Messages["generate"];
}) {
  // Reader-mode gate: the shell may see its usage, never a way to buy more.
  const native = useIsNativeApp();
  const [dismissed, setDismissed] = useState(false);

  if (dismissed) return null;

  const resetLabel = currentPeriodEnd
    ? formatMsg(g.usageResetsOn, {
        date: new Date(currentPeriodEnd).toLocaleString(undefined, {
          month: "short",
          day: "numeric",
          hour: "numeric",
          minute: "2-digit",
        }),
      })
    : g.usageResetsFallback;

  return (
    <div
      role="status"
      className="flex items-center gap-2.5 rounded-t-[26px] bg-atelier-surface/90 px-4 py-2.5 text-xs text-atelier-muted shadow-[0_0_0_1px_var(--frost-ring)] backdrop-blur-xl"
    >
      {/* suppressHydrationWarning: resetLabel formats a date with the
          browser's locale/timezone, which legitimately differs from the SSR
          output — let React patch the text instead of throwing #418. */}
      <p className="flex-1" suppressHydrationWarning>
        {formatMsg(g.approachingLimitUsage, { used, limit })} · {resetLabel}
        {!native && (
          <>
            {" "}·{" "}
            <Link href="/app/settings?tab=usage" className="font-medium text-atelier-accent underline underline-offset-2">
              {g.getMoreUsage}
            </Link>
          </>
        )}
      </p>
      <button
        type="button"
        onClick={() => setDismissed(true)}
        aria-label={g.dismissUsageBanner}
        className="flex-shrink-0 rounded-full p-1 text-atelier-muted transition-colors hover:bg-atelier-ink/5 hover:text-atelier-ink"
      >
        <XIcon className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

// Bar heights (in Tailwind h- steps) for the waveform's resting/peak shape —
// short-tall-short reads as a center-weighted wave at a glance, same visual
// idea as ChatGPT's voice-mode indicator. Real mic amplitude would need a
// second, separate getUserMedia + AnalyserNode stream running alongside
// SpeechRecognition (which manages its own mic access internally and
// exposes no volume data) — deliberately not done here to avoid a second
// permission prompt and a second live audio stream just for decoration; a
// staggered CSS pulse reads as "listening" just as clearly and can't ever
// glitch if the analyser and the recognizer's internal capture drift out of
// sync with each other.
const WAVEFORM_BARS = [
  { height: "h-3", delay: 0 },
  { height: "h-5", delay: 90 },
  { height: "h-8", delay: 180 },
  { height: "h-10", delay: 270 },
  { height: "h-8", delay: 180 },
  { height: "h-5", delay: 90 },
  { height: "h-3", delay: 0 },
];

// The "as if in generating mode" card voice sessions render in the message
// list (see the call site, right next to the livePrompt pipeline-trace
// bubble) — same rounded-card visual language as that bubble, so starting a
// voice session reads as an equally weighted, equally "live" state, not a
// smaller/lesser affordance tucked into the composer. Shows live interim
// captions while the person is still mid-sentence (voiceInterimCaption in
// generate-form.tsx, fed by the Web Speech API's interim results — see
// lib/voice/speech-recognition.ts) and a brief command confirmation
// (voiceStatusMessage) after a recognized command like "switch to Mia" or
// "new chat", which then clears itself and returns to listening rather than
// closing the session — only an actual generation prompt or the stop button
// ends it.
function VoiceSessionCard({
  agentMessage,
  interimText,
  statusMessage,
  onStop,
  g,
}: {
  agentMessage: string | null;
  interimText: string;
  statusMessage: string | null;
  onStop: () => void;
  g: Messages["generate"];
}) {
  return (
    <div className="flex justify-center">
      {/* No card/border/background on purpose — the waves sit directly on
          whatever's behind them. An earlier pass had this in the same
          bordered bubble the pipeline trace uses, which read as a white box
          stuck in the middle of the chat rather than as the app listening. */}
      <div className="w-full max-w-[90%] px-4.5 py-6">
        <div className="flex h-10 items-end justify-center gap-1.5" aria-hidden="true">
          {WAVEFORM_BARS.map((bar, i) => (
            <span
              key={i}
              className={cn("animate-voice-waveform w-1 origin-bottom rounded-full bg-atelier-ink", bar.height)}
              style={{ animationDelay: `${bar.delay}ms` }}
            />
          ))}
        </div>
        {/* What the agent just asked, above what it's currently hearing —
            the question stays put while the answer is being spoken, so
            there's always something on screen explaining what's expected. */}
        {agentMessage && (
          <p className="mt-4 text-center text-sm font-medium text-atelier-ink">{agentMessage}</p>
        )}
        <p className="mt-2 min-h-[20px] text-center text-sm text-atelier-muted">
          {statusMessage || interimText || (agentMessage ? "" : g.voiceListeningLabel)}
        </p>
        <p className="mt-1 min-h-[16px] text-center text-xs text-atelier-muted/80">
          {statusMessage || interimText ? "" : g.voiceListeningHint}
        </p>
        <div className="mt-4 flex justify-center">
          <button
            type="button"
            onClick={onStop}
            aria-label={g.voiceStopSession}
            title={g.voiceStopSession}
            className="flex h-9 w-9 items-center justify-center rounded-full bg-atelier-ink text-atelier-paper transition-colors hover:bg-atelier-ink/90"
          >
            <StopIcon className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
    </div>
  );
}

function PendingAttachmentChip({
  attachment,
  onRemove,
}: {
  attachment: PendingAttachment;
  onRemove: () => void;
}) {
  const { t } = useLocale();
  const isImage = attachment.type.startsWith("image/");
  const isVideo = attachment.type.startsWith("video/");

  return (
    <div className="group relative h-16 w-16 flex-shrink-0 overflow-hidden rounded-media border border-atelier-rule bg-atelier-paper">
      {isImage && attachment.url ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={attachment.url} alt={attachment.name} className="h-full w-full object-cover" />
      ) : isVideo && attachment.url ? (
        <video src={attachment.url} className="h-full w-full object-cover" muted />
      ) : (
        <div className="flex h-full w-full flex-col items-center justify-center gap-1 px-1 text-atelier-muted">
          <FileIcon className="h-4 w-4" />
          <span className="w-full truncate text-center text-[9px] leading-tight">{attachment.name}</span>
          <span className="text-[8px] text-atelier-muted/60">{formatBytes(attachment.size)}</span>
        </div>
      )}

      {attachment.status === "uploading" && (
        <div className="absolute inset-0 flex items-center justify-center bg-atelier-surface/70">
          <LoaderIcon className="h-4 w-4 text-atelier-muted" />
        </div>
      )}
      {attachment.status === "error" && (
        <div
          title={attachment.error || t.generate.failed}
          className="absolute inset-0 flex items-center justify-center bg-red-50/90 p-1 text-center text-[9px] text-red-600 dark:bg-red-500/20 dark:text-red-400"
        >
          {t.generate.failed}
        </div>
      )}

      <button
        type="button"
        onClick={onRemove}
        title={t.generate.removeAttachment}
        aria-label={t.generate.removeAttachment}
        className="absolute right-0.5 top-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-black/70 text-onmedia opacity-0 transition-opacity group-hover:opacity-100 [@media(hover:none)]:opacity-100"
      >
        <XIcon className="h-2.5 w-2.5" />
      </button>
    </div>
  );
}

// GenerateForm reads the ?voice= query param (set when a request is
// forwarded here from the sidebar's global voice command), which requires
// useSearchParams — that hook needs a Suspense boundary around it, so the
// actual logic lives in GenerateFormInner and this just wraps it.
type CharacterOption = {
  id: string;
  name: string;
  referencePhotos: { path: string; url: string }[];
  voiceId: string | null;
  // Saved outfit photos exist — shows the composer's Outfit chip. Optional so
  // call sites that build this shape by hand (tests, older pages) stay valid.
  hasOutfit?: boolean;
  // true = photoreal, false = illustrated, null/undefined = unknown.
  photoreal?: boolean | null;
  // The person's own face, verified on BytePlus (lib/faces/): Seedance takes it.
  faceVerified?: boolean;
};

export type VideoModelOption = {
  id: string;
  name: string;
  description: string;
  durations: VideoDurationOption[];
  defaultDurationSeconds: number;
};

export function GenerateForm(props: {
  characters: CharacterOption[];
  videoModels: VideoModelOption[];
  defaultVideoModelId: string;
  // The admin's global picture lane (Admin > AI Providers), which the
  // ENGINE cell opens on for an image. Optional so other call sites keep
  // working; the server pins the real default either way.
  defaultImageModelId?: string;
  // The account's own starting point (Settings → Generation, 2026-09-11),
  // already resolved server-side. Optional: every other call site keeps the
  // composer's own defaults.
  defaultAspectRatio?: "16:9" | "9:16" | null;
  defaultVideoDurationSeconds?: number | null;
  notifyRenderReady?: boolean;
  notifyRenderFailed?: boolean;
  advancedPlanActive: boolean;
  multiAngleAvailable: boolean;
  approachingLimit: boolean;
  voiceModeEnabled: boolean;
  // Whether the composer may offer Ask (the project-aware assistant).
  // Optional and defaulting to false on purpose: every other call site of
  // this component keeps compiling, and it keeps compiling with the feature
  // OFF, which is the direction a feature that spends tokens should fail in.
  chatAgentEnabled?: boolean;
  chatSmarterAvailable?: boolean;
  // Raw numbers behind approachingLimit, plus the real reset timestamp when
  // the account has one (see currentPeriodEnd below) — passed straight
  // through from getGenerateWorkspaceData so the usage banner can show
  // specifics ("12 of 15 used") instead of just a plain warning.
  creditsUsed: number;
  creditsLimit: number;
  // The grant balance (admin/promo). Spent before purchased credits and
  // part of what the account can afford — see spendableCredits (plans.ts).
  bonusCredits: number;
  purchasedCredits: number;
  // ISO string, or null for a "none"-plan/bonus-only account, or an
  // existing subscriber whose profile hasn't been backfilled with real
  // Stripe billing dates yet (see LAUNCH_CHECKLIST.md) — the banner falls
  // back to "resets on the 1st" in that case rather than showing nothing.
  currentPeriodEnd: string | null;
  // US-native external checkout permission, decided server-side per request
  // (lib/native/external-purchase). Optional so older call sites fail safe.
  allowExternalPurchase?: boolean;
  // Set when this instance is embedded on the dashboard home page instead
  // of /app/generate — see the isHero logic inside GenerateFormInner for
  // what this actually changes.
  heroMode?: boolean;
  greeting?: string;
  // True when this account hasn't finished the first-login walkthrough yet
  // (profiles.has_completed_onboarding is false) — auto-starts OnboardingTour
  // below. Only ever passed true from /app/page.tsx (the one place a brand
  // new user actually lands); /app/generate never passes it, since arriving
  // there directly shouldn't interrupt an existing session with a tour aimed
  // at first-time orientation. The tour can always be brought back later via
  // ?tour=1 regardless of this prop — see the sidebar's "Replay walkthrough".
  startOnboarding?: boolean;
  dailyFreeAvailable?: boolean;
  hasGeneratedBefore?: boolean;
  /** The page's own header (title, transcript toggle, stats, upgrade), drawn
      over the screen from md up — see the Screening Room block below. */
  screenHeader?: React.ReactNode;
  /** The reliability pair for the phone's takes caption (below md the
      header is one line, so the stats ride the TAKES line instead). */
  phoneStats?: PhoneStats;
  /** Director's Cut is open to this account (admins, video_editor on): the "+" menu offers it. */
  directorsCutOn?: boolean;
}) {
  return (
    <Suspense fallback={null}>
      <GenerateFormInner {...props} />
    </Suspense>
  );
}

/** The page's first-try rate and average attempts (null until measured). */
export type PhoneStats = { firstTryRate: number | null; avgAttempts: number | null; total: number };

type ChatTurn = HistoryTurn & {
  attachments: ChatAttachment[];
  // Which model/length produced this turn — captured client-side at submit
  // time purely for the Takes rail's microlabel. HistoryTurn doesn't record
  // it, so turns resumed from History won't have it; the rail falls back to
  // the plain content-type label there.
  takeMeta?: {
    modelName: string;
    /** the engine's catalogue id — drives the stage Upscale pill's
        eligibility/tier math (takeSourceHeight keys on ids, not names) */
    modelId?: string;
    durationSeconds: number;
    /** the aspect the request rode with (null = prompt decided) */
    aspectRatio?: string | null;
    /** the character's lead reference photo at submit time — the identity
        plate's thumbnail; absent on history-resumed takes */
    characterPhotoUrl?: string | null;
  } | null;
  /** who was cast, captured at submit time for the screen's slate line;
      absent on history-resumed takes, which simply show the take number */
  characterName?: string | null;
};

type MultiAngleClip = {
  angleId: string;
  id: string;
  succeeded: boolean;
  attempts: AttemptLog[];
  finalPrompt: string;
  resultUrl: string | null;
};

type MultiAngleChatItem = {
  kind: "multi";
  groupId: string;
  prompt: string;
  attachments: ChatAttachment[];
  createdAt: string;
  angles: MultiAngleClip[];
};

// The effort control's burst, precomputed particle by particle — Math.random
// in render would replay differently on every re-render. Eight particles on
// uneven vectors (a slight upward bias so it reads as a spark, not a
// splash), alternating four-point stars and dots, two sizes, two distances,
// staggered starts. The unevenness is the craft: a perfectly radial burst of
// identical dots reads as a diagram of an explosion rather than one.
const SPARK_PARTICLES = [
  { x: "18px", y: "-6px", size: "h-[5px] w-[5px]", star: true, delay: 0, scale: "1.1" },
  { x: "10px", y: "-16px", size: "h-1 w-1", star: false, delay: 40, scale: "0.9" },
  { x: "-2px", y: "-19px", size: "h-[5px] w-[5px]", star: true, delay: 90, scale: "1.2" },
  { x: "-13px", y: "-12px", size: "h-[3px] w-[3px]", star: false, delay: 20, scale: "0.8" },
  { x: "-19px", y: "-1px", size: "h-1 w-1", star: true, delay: 70, scale: "1" },
  { x: "-11px", y: "11px", size: "h-[3px] w-[3px]", star: false, delay: 110, scale: "0.85" },
  { x: "6px", y: "14px", size: "h-1 w-1", star: true, delay: 55, scale: "0.95" },
  { x: "16px", y: "8px", size: "h-[3px] w-[3px]", star: false, delay: 130, scale: "0.8" },
] as const;

// What a person can type into the composer in one message. Raised from 2,000
// on 2026-08-31 (operator: "a limit on characters on the chatbox. If a user
// decides to write a long paragraph its impossible"). Measured first: across
// every prompt this account has ever sent, the median is 209 characters and
// the longest is 1,834 — so nothing had hit the old wall yet, but it was
// close enough to be reachable in one detailed shot description.
//
// Deliberately NOT the same number as the server's MAX_PROMPT_LENGTH, which
// is a backstop sized to the largest machine-built payload (a six-shot
// storyboard) rather than to human typing.
const COMPOSER_MAX_CHARS = 5000;

// Where the assistant on/off choice is remembered. Versioned in the name so
// a future change of meaning cannot silently inherit an old value.
const ASSISTANT_PREF_KEY = "picacho.assistant.v1";

// An Ask turn: a question and the assistant's answer, living in the SAME
// transcript as the renders rather than in a side panel.
//
// One thread is the whole point. The thing being discussed — the take that
// scored 61, the clip the model refused — is a few centimetres above the
// question about it, and neither the person nor the assistant has to carry
// it across a boundary. A separate chat panel would have meant re-describing
// by hand what the transcript already shows.
//
// Ask turns are session-local: nothing writes them to `generations`, so
// reloading the thread from History brings back the renders and not the
// conversation about them. That is a deliberate v1 line — persisting them
// means a new table, a retention decision, and a second place where a
// person's words are stored.
type AskChatItem = {
  kind: "ask";
  id: string;
  question: string;
  answer: string;
  createdAt: string;
  failed?: boolean;
  /**
   * Set when the question had a shot inside it ("can you make Eva walk
   * through a market"). Becomes a "Render this" chip under the answer, which
   * puts those words back in the composer — it never sends. The Send Receipt
   * still gets to speak before any credit moves, which is the entire reason
   * the chip fills the box instead of pressing the button.
   */
  renderablePrompt?: string | null;
};

type ChatItem = ({ kind: "single" } & ChatTurn) | MultiAngleChatItem | AskChatItem;

// Maps a loaded-from-the-database history row (see getGenerationThread) to
// the same shape a freshly-generated turn already gets in `items` — past
// attachments aren't tracked anywhere to reload, so those are always empty;
// everything else lines up 1:1.
// Whether two thread items are the SAME conversation entry — used by the
// resume path to graduate a settled job into the thread exactly once. A
// multi-angle group's members all resolve to the same group thread, so
// without this each resumed angle appended its own copy of the whole group.
function sameThreadItem(a: ChatItem, b: ChatItem): boolean {
  if (a.kind === "multi" && b.kind === "multi") return a.groupId === b.groupId;
  if (a.kind === "single" && b.kind === "single") return a.id === b.id;
  return false;
}

function historyItemToChatItem(item: ChatHistoryItem): ChatItem {
  if (item.kind === "multi") {
    return { ...item, attachments: [] };
  }
  // Rebuild the attachment chips from the storage paths the row records
  // (2026-08-31 — before that the paths weren't stored and a reloaded
  // thread silently lost its attachments). Only what the thumbnail needs is
  // reconstructable: the stable media URL and a display name. Size is
  // unknowable and unused for display; the type is guessed from the
  // extension so video attachments still render as video.
  const attachments: ChatAttachment[] = (item.attachmentPaths ?? []).map((path, i) => {
    const name = path.split("/").pop() ?? path;
    const ext = name.split(".").pop()?.toLowerCase() ?? "";
    return {
      path,
      // The SIGNED url from the server. Rebuilding the path here produced an
      // unsigned /api/media URL, which that route answers with 404 — every
      // attachment on a reloaded thread was a broken chip. The signature
      // cannot be computed on the client: it needs MEDIA_SIGNING_SECRET.
      url: item.attachmentUrls?.[i] ?? `/api/media/chat-attachments/${path}`,
      name,
      type: ["mp4", "webm", "mov"].includes(ext) ? `video/${ext}` : `image/${ext || "png"}`,
      size: 0,
    };
  });
  return { ...item, attachments };
}

// `domId` (optional) is the anchor the Takes rail scrolls to — a plain DOM
// id, set only at the session-thread call site, plus scroll-mt so the jumped-
// to turn lands with breathing room instead of glued to the container's top.
function SingleTurnBubble({
  turn,
  domId,
  onGenerateAnyway,
  onRetryPhotoreal,
}: {
  turn: ChatTurn;
  domId?: string;
  // Offered only on rules-block failures: resubmits this turn's prompt with
  // the caller's own brand prohibitions suspended for that one send.
  onGenerateAnyway?: (turnPrompt: string) => void;
  // Offered only on a provider's likeness refusal (send-plan's
  // likenessRetryTarget), never a content refusal: same prompt, same
  // reference, on a model that accepts photoreal people.
  onRetryPhotoreal?: (turnPrompt: string, targetModelId: string) => void;
}) {
  const { t } = useLocale();
  const g = t.generate;
  const live = isLiveTurn(turn.attempts);
  const timeline = buildTimeline(turn.attempts);
  return (
    <div id={domId} className="scroll-mt-6 space-y-3">
      <UserBubble prompt={turn.prompt} attachments={turn.attachments} createdAt={turn.createdAt} />
      <div className="flex justify-start">
        <div className="group max-w-[90%] rounded-[18px] rounded-bl-[6px] bg-atelier-surface px-4.5 py-4 shadow-[0_1px_2px_rgba(33,29,22,0.05),0_8px_20px_-14px_rgba(33,29,22,0.12)]">
          <PipelineTrace timeline={timeline} revealedCount={timeline.length} isAnimating={false} isLive={live} />
          {turn.succeeded ? (
            <>
              <ResultMedia succeeded={turn.succeeded} resultUrl={turn.resultUrl} contentType={turn.contentType} prompt={turn.prompt} generationId={turn.id} />
              <div className="mt-3 flex items-center gap-2">
                <Badge tone={live ? "success" : "neutral"}>{live ? g.live : g.simulated}</Badge>
                {/* Only when the gate actually retried — "passed on attempt 1
                    of 3" on a take that never went through a gate implied a
                    guarantee the identity gate (switched off today, and
                    image-only by design) never made. Audit 2026-09-05. */}
                {turn.attempts.length > 1 && (
                  <p className="font-numeral text-xs tabular-nums text-atelier-accent">{formatMsg(g.passedOnAttempt, { n: turn.attempts.length })}</p>
                )}
                {typeof turn.matchScore === "number" && (
                  <p className="font-numeral text-xs tabular-nums text-atelier-accent">{formatMsg(g.identityMatch, { n: turn.matchScore })}</p>
                )}
                {/* WHOSE VOICE WAS IN IT (2026-09-23) — the voice's answer to
                    the identity line above it, and the first place in the
                    product that says anything at all about a delivered clip's
                    voice. Only our own voice earns the accent: the other three
                    are honest reports of a voice we did not make, so they sit
                    in muted text beside the win rather than dressed as one.
                    Nothing renders for a take finished before the column
                    existed, or for an image — voiceSource is null on both. */}
                {turn.voiceSource === "character" ? (
                  <p className="text-xs text-atelier-accent">
                    {turn.voiceName ? formatMsg(g.voiceLocked, { name: turn.voiceName }) : g.voiceLockedUnnamed}
                  </p>
                ) : turn.voiceSource ? (
                  <p className="text-xs text-atelier-muted">
                    {turn.voiceSource === "silent"
                      ? g.voiceSilent
                      : turn.voiceSource === "source"
                        ? g.voiceFromSource
                        : g.voiceEngine}
                  </p>
                ) : null}
              </div>
              <ResultActions generationId={turn.id} copyText={turn.finalPrompt || turn.prompt} promotable={turn.contentType === "image"} />
            </>
          ) : (
            <div className="mt-3 space-y-2">
              <div className="flex items-center gap-2">
                <Badge tone="danger">{g.couldntValidate}</Badge>
                <p className="text-xs text-atelier-muted">
                  {summarizeFailure(turn.attempts, t) ??
                    (turn.attempts.length === 1 ? g.noPassingResultOne : formatMsg(g.noPassingResultOther, { n: turn.attempts.length }))}
                </p>
              </div>
              {onGenerateAnyway && turn.prompt && rulesBlockOf(turn.attempts) && (
                <button
                  type="button"
                  onClick={() => onGenerateAnyway(turn.prompt)}
                  className="rounded-full border border-atelier-rule px-3 py-1.5 text-xs font-medium text-atelier-ink transition-colors hover:border-atelier-muted hover:bg-atelier-ink/5"
                >
                  {g.generateAnyway}
                </button>
              )}
              {(() => {
                const target = onRetryPhotoreal && turn.prompt ? likenessRetryTarget(turn.attempts) : null;
                if (!target) return null;
                return (
                  <button
                    type="button"
                    onClick={() => onRetryPhotoreal!(turn.prompt, target)}
                    className="rounded-full bg-atelier-ink px-3 py-1.5 text-xs font-medium text-atelier-paper transition-opacity hover:opacity-90"
                  >
                    {formatMsg(g.retryOnModel, { model: getVideoModel(target).name })}
                  </button>
                );
              })()}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function MultiAngleResult({ angles, prompt }: { angles: MultiAngleClip[]; prompt?: string }) {
  const { t } = useLocale();
  const g = t.generate;
  const [activeAngle, setActiveAngle] = useState(angles[0]?.angleId ?? "");
  const active = angles.find((a) => a.angleId === activeAngle) ?? angles[0];
  const isLive = active ? isLiveTurn(active.attempts) : false;

  return (
    <div>
      <div className="flex flex-wrap gap-1.5">
        {angles.map((a) => {
          const label = getAnglePreset(a.angleId)?.label ?? a.angleId;
          const isActive = active?.angleId === a.angleId;
          return (
            <button
              key={a.angleId}
              type="button"
              onClick={() => setActiveAngle(a.angleId)}
              className={cn(
                "rounded-full border px-3 py-1 text-[11px] font-medium uppercase tracking-widest transition-colors",
                isActive
                  ? "border-atelier-ink bg-atelier-ink text-atelier-paper"
                  : "border-atelier-rule text-atelier-muted hover:border-atelier-muted hover:text-atelier-ink",
              )}
            >
              {label}
              {!a.succeeded && <span className="ml-1 text-red-400">•</span>}
            </button>
          );
        })}
      </div>

      {active && (
        <>
          <ResultMedia succeeded={active.succeeded} resultUrl={active.resultUrl} contentType="video" prompt={prompt} generationId={active.id} />
          {active.succeeded ? (
            <>
              <div className="mt-3 flex items-center gap-2">
                <Badge tone={isLive ? "success" : "neutral"}>{isLive ? g.live : g.simulated}</Badge>
                {/* Same rule as the turn plate above: attempt copy only when
                    a retry actually happened. */}
                {active.attempts.length > 1 && (
                  <p className="font-numeral text-xs tabular-nums text-atelier-accent">{formatMsg(g.passedOnAttempt, { n: active.attempts.length })}</p>
                )}
              </div>
              <ResultActions key={active.id} generationId={active.id} copyText={active.finalPrompt || prompt || ""} />
            </>
          ) : (
            <div className="mt-3 flex items-center gap-2">
              <Badge tone="danger">{g.couldntValidate}</Badge>
              <p className="text-xs text-atelier-muted">
                {summarizeFailure(active.attempts, t) ??
                  (active.attempts.length === 1 ? g.noPassingResultOne : formatMsg(g.noPassingResultOther, { n: active.attempts.length }))}
              </p>
            </div>
          )}
        </>
      )}
    </div>
  );
}

// Same optional `domId` anchor as SingleTurnBubble — see the comment there.
function MultiAngleTurnBubble({ item, domId }: { item: MultiAngleChatItem; domId?: string }) {
  return (
    <div id={domId} className="scroll-mt-6 space-y-3">
      <UserBubble prompt={item.prompt} attachments={item.attachments} createdAt={item.createdAt} />
      <div className="flex justify-start">
        <div className="group max-w-[90%] rounded-[18px] rounded-bl-[6px] bg-atelier-surface px-4.5 py-4 shadow-[0_1px_2px_rgba(33,29,22,0.05),0_8px_20px_-14px_rgba(33,29,22,0.12)]">
          <MultiAngleResult angles={item.angles} prompt={item.prompt} />
        </div>
      </div>
    </div>
  );
}

// An Ask turn. Same bubble geometry as every other answer in the thread, with
// one visual difference — a hairline ochre rail down the left edge — because
// the two things in this transcript are NOT interchangeable: everything else
// here cost credits and produced a file, and this cost neither and produced
// an opinion. Someone scrolling back a week later has to be able to tell at a
// glance which is which.
//
// Rendered as pre-wrapped plain text, deliberately. There is no markdown
// renderer in this app, and adding one for this would mean shipping a parser
// that runs on model output. The house rules ask for plain prose instead, so
// what arrives is what shows.
function AskTurnBubble({
  item,
  onRenderThis,
}: {
  item: AskChatItem;
  // Puts the recovered shot back in the composer. It deliberately does NOT
  // send: the Send Receipt is what stands between a person and a credit, and
  // a chip that skipped it would be spending money on a sentence a
  // classifier reconstructed.
  onRenderThis?: (prompt: string) => void;
}) {
  const { t } = useLocale();
  const g = t.generate;
  return (
    <div className="scroll-mt-6 space-y-3">
      <UserBubble prompt={item.question} createdAt={item.createdAt} />
      <div className="flex justify-start">
        <div
          className={cn(
            "max-w-[90%] rounded-[18px] rounded-bl-[6px] border-l-2 bg-atelier-surface px-4.5 py-4 shadow-[0_1px_2px_rgba(33,29,22,0.05),0_8px_20px_-14px_rgba(33,29,22,0.12)]",
            item.failed ? "border-l-atelier-rule" : "border-l-atelier-accent/50",
          )}
        >
          <p className="flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-widest text-atelier-muted">
            <SparkIcon className="h-3 w-3 text-atelier-accent" />
            {g.askAnswerLabel}
          </p>
          <p
            className={cn(
              "mt-2 whitespace-pre-wrap text-sm leading-relaxed",
              item.failed ? "text-atelier-muted" : "text-atelier-ink",
            )}
          >
            {item.answer}
          </p>
          {!item.failed && item.renderablePrompt && onRenderThis && (
            <button
              type="button"
              onClick={() => onRenderThis(item.renderablePrompt!)}
              className="mt-3 flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[12px] font-semibold text-atelier-accent shadow-[inset_0_0_0_1px_var(--color-atelier-rule)] transition-colors hover:bg-atelier-accent/10"
            >
              <SendIcon className="h-3 w-3 flex-shrink-0" />
              {g.renderThis}
            </button>
          )}
          {!item.failed && (
            <p className="mt-3 text-[11px] leading-snug text-atelier-muted/80">{g.askDisclaimer}</p>
          )}
        </div>
      </div>
    </div>
  );
}

// The live Ask bubble: the same frame, streaming. Kept separate from
// AskTurnBubble rather than given an `isLive` prop because the two differ in
// what they are allowed to show — a half-written answer gets no disclaimer
// and no failure styling, and a caret that blinks under a finished answer
// reads as a hang.
function AskLiveBubble({ question, answer }: { question: string; answer: string }) {
  const { t } = useLocale();
  const g = t.generate;
  return (
    <div className="space-y-3">
      <UserBubble prompt={question} />
      {/* role="status" + aria-live="polite" so a screen reader is actually
          told the answer arrived. Without it the send was silent: focus never
          moves, the text streams into a plain <p>, and nothing announces —
          a blind user pressed Ask and heard nothing at all. On the LIVE
          bubble only; on archived turns it would re-announce the whole
          thread every re-render. aria-atomic="false" so it reads the text as
          it arrives rather than restarting the sentence on every token. */}
      <div className="flex justify-start" role="status" aria-live="polite" aria-atomic="false">
        <div className="max-w-[90%] rounded-[18px] rounded-bl-[6px] border-l-2 border-l-atelier-accent/50 bg-atelier-surface px-4.5 py-4 shadow-[0_1px_2px_rgba(33,29,22,0.05),0_8px_20px_-14px_rgba(33,29,22,0.12)]">
          <p className="flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-widest text-atelier-muted">
            <SparkIcon className="h-3 w-3 text-atelier-accent" />
            {g.askAnswerLabel}
          </p>
          {answer ? (
            <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-atelier-ink">
              {answer}
              <span className="ml-0.5 inline-block h-3.5 w-[2px] translate-y-0.5 animate-pulse bg-atelier-accent align-baseline" />
            </p>
          ) : (
            <div className="mt-2 flex items-center gap-2 text-sm text-atelier-muted">
              <LoaderIcon className="h-4 w-4" />
              {g.askThinking}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}


function GenerateFormInner({
  characters,
  videoModels,
  defaultVideoModelId,
  defaultImageModelId = "gpt-image",
  defaultAspectRatio = null,
  defaultVideoDurationSeconds = null,
  notifyRenderReady = true,
  notifyRenderFailed = true,
  advancedPlanActive,
  multiAngleAvailable,
  approachingLimit,
  voiceModeEnabled,
  chatAgentEnabled = false,
  chatSmarterAvailable = false,
  creditsUsed,
  creditsLimit,
  bonusCredits,
  purchasedCredits,
  currentPeriodEnd,
  allowExternalPurchase = false,
  heroMode = false,
  greeting,
  startOnboarding = false,
  dailyFreeAvailable = false,
  hasGeneratedBefore = true,
  screenHeader,
  phoneStats,
  directorsCutOn = false,
}: {
  characters: CharacterOption[];
  videoModels: VideoModelOption[];
  defaultVideoModelId: string;
  defaultImageModelId?: string;
  defaultAspectRatio?: "16:9" | "9:16" | null;
  defaultVideoDurationSeconds?: number | null;
  notifyRenderReady?: boolean;
  notifyRenderFailed?: boolean;
  advancedPlanActive: boolean;
  multiAngleAvailable: boolean;
  approachingLimit: boolean;
  voiceModeEnabled: boolean;
  chatAgentEnabled?: boolean;
  chatSmarterAvailable?: boolean;
  creditsUsed: number;
  creditsLimit: number;
  bonusCredits: number;
  purchasedCredits: number;
  currentPeriodEnd: string | null;
  allowExternalPurchase?: boolean;
  heroMode?: boolean;
  greeting?: string;
  startOnboarding?: boolean;
  // Guardrails after the 2026-08-21 confused-new-user incident (a 3-minute-
  // old account pasted text and burned its daily free shot on an accidental
  // 5s video): the composer says what a send will spend, and first-time
  // accounts start on Image. Defaults chosen so older call sites (the
  // dashboard hero) behave exactly as before until they pass the props.
  dailyFreeAvailable?: boolean;
  hasGeneratedBefore?: boolean;
  screenHeader?: React.ReactNode;
  phoneStats?: PhoneStats;
  directorsCutOn?: boolean;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { t } = useLocale();
  const g = t.generate;
  const v = t.voice;

  // Arriving with ?prompt= means the Home composer just handed off to us —
  // settle the whole card in with a short fade/slide so that handoff reads
  // as one continuous motion instead of an abrupt page swap. Direct visits
  // to Generate (sidebar link, etc.) skip this entirely.
  const [justArrived] = useState(() => searchParams.get("prompt") !== null);
  const [settled, setSettled] = useState(!justArrived);
  useEffect(() => {
    if (!justArrived) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setSettled(true);
      return;
    }
    const id = requestAnimationFrame(() => setSettled(true));
    return () => cancelAnimationFrame(id);
  }, [justArrived]);

  // Never auto-pick a character, even when there's only one — auto-picking
  // (whether "most recent" or "the only one") made it easy to generate
  // against the wrong character without noticing and burn a credit on it.
  // Always start empty and require an explicit pick from the dropdown.
  //
  // The one deliberate exception: arriving from History's "Continue chat"
  // button (?character=<id>&type=<video|image>&resume=<generationId>) IS an
  // explicit pick — the person already chose that character by clicking into that
  // exact generation. Reading it into the initial state (rather than a
  // setCharacterId call after mount) matters: the resetChat effect further
  // down clears `items` any time characterId/contentType change, and doing
  // it this way means they're already correct on the very first render, so
  // that effect's normal mount-time run doesn't have anything to un-clear
  // and the history load below survives it. Ignored (falls back to "") if
  // the id isn't actually one of this account's characters.
  const [characterId, setCharacterId] = useState(() => {
    const fromUrl = searchParams.get("character");
    if (fromUrl && characters.some((c) => c.id === fromUrl)) return fromUrl;
    // No explicit pick: the most recently created character. That is what
    // character-form.tsx has promised since the redirect after a save was
    // written ("Generate defaults its character picker to the most recently
    // created one") and what the composer never did — a person who had just
    // made their first character landed here on "Select character ?" while
    // the tour explained the picker (2026-09-09). `characters` arrives newest
    // first from workspace-data.
    return characters[0]?.id ?? "";
  });
  const [characterMenuOpen, setCharacterMenuOpen] = useState(false);
  // Direction B (2026-09-18): the character's photo menu — which saved photo
  // this take matches — opened from the character's pill (or the receipt's
  // FACE column) instead of a row inside the composer. It shares the pill's
  // wrapper, so the same outside-click and Escape rules close it.
  const [photoMenuOpen, setPhotoMenuOpen] = useState(false);
  const characterMenuRef = useRef<HTMLDivElement>(null);
  const [contentType, setContentType] = useState<ContentType>(() => {
    const fromUrl = searchParams.get("type");
    if (fromUrl === "image") return "image";
    if (fromUrl === "video") return "video";
    // First-ever generation defaults to Image (guardrail, 2026-08-21): it's
    // the fastest, cheapest way to meet your character — a confused first
    // tap should not produce a surprise video. Explicit links (templates,
    // continue/resume flows) always carry ?type= and win above.
    return hasGeneratedBefore ? "video" : "image";
  });
  const [prompt, setPrompt] = useState("");
  // Prompt Studio (Enhance). `approvedPrompt` holds the exact text the user
  // accepted from the panel: at submit time, a prompt still identical to it
  // is sent with refinement skipped, so the pipeline doesn't redraft the
  // thing the user just approved. Edit it and it goes back through drafting
  // like any other typed prompt — which is the safe direction to fail, since
  // a hand-edited prompt is the one case where the draft step still adds
  // something.
  const [enhancing, setEnhancing] = useState(false);
  const [enhanced, setEnhanced] = useState<string | null>(null);
  const [enhanceError, setEnhanceError] = useState<string | null>(null);
  const [assistsLeft, setAssistsLeft] = useState<number | null | undefined>(undefined);
  const [approvedPrompt, setApprovedPrompt] = useState<string | null>(null);
  // Which kind of assist produced what's in the panel — the image result
  // gets an extra control (describe the person too / scene only) that makes
  // no sense for text.
  const [enhanceKind, setEnhanceKind] = useState<"text" | "image">("text");
  const [describedMode, setDescribedMode] = useState<"scene" | "standalone">("scene");
  // The attachment an image-mode prompt was read from. Dropped from the
  // composer when that prompt is accepted: it was source material for the
  // WRITING, and leaving it attached makes it the generator's reference
  // anchor instead — which reproduces the uploaded picture almost exactly
  // and overrides the character's own face. Real report, 2026-08-16.
  const [describedAttachmentId, setDescribedAttachmentId] = useState<string | null>(null);
  // The saved-prompt library.
  const [savedOpen, setSavedOpen] = useState(false);
  const [savedLoading, setSavedLoading] = useState(false);
  const [savedItems, setSavedItems] = useState<SavedPrompt[]>([]);
  const [savedJustSaved, setSavedJustSaved] = useState(false);
  // Set when a saved prompt was compiled for a DIFFERENT character than the
  // one selected now — see openSavedPrompt for why that matters.
  const [savedRecompiledFrom, setSavedRecompiledFrom] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [stopping, setStopping] = useState(false);
  // Set by handleStop, read by submitPrompt/confirmMultiAngle once their
  // server call returns — see handleStop for why this can't be state.
  const userStoppedRef = useRef(false);
  // Which request is currently live and what to cancel it by — a client-
  // generated id/groupId, set the instant a request goes out (see
  // submitPrompt/confirmMultiAngle), not whatever the server eventually
  // returns, since by then it's too late for Stop to do anything useful. A
  // ref because it's only ever read inside an event handler, never rendered.
  const activeGenerationRef = useRef<
    { kind: "single"; id: string } | { kind: "multi"; groupId: string } | null
  >(null);
  const [error, setError] = useState("");
  // Voice mode — a full hands-free session, not the old silent
  // "auto-send-and-speak" preference toggle this replaced (see
  // LAUNCH_CHECKLIST.md). While active: the browser's own live speech
  // recognition (lib/voice/speech-recognition.ts, no server round-trip)
  // captions what's being said in real time; a finished utterance is either
  // a recognized command (switch character, new chat, navigate — see
  // handleVoiceFinal below) or, if nothing matches, an ordinary generation
  // prompt that closes the session and hands off to submitPrompt exactly
  // like a typed-and-sent message would.
  const [voiceSessionActive, setVoiceSessionActive] = useState(false);
  const [voiceInterimCaption, setVoiceInterimCaption] = useState("");
  // A brief confirmation ("Switched to Mia.") shown in place of the
  // interim caption after a recognized command — clears itself on a timer
  // (see clearVoiceStatusSoon) rather than staying up forever, since the
  // session keeps listening right through it.
  const [voiceStatusMessage, setVoiceStatusMessage] = useState<string | null>(null);
  const voiceSessionRef = useRef<{ stop: () => void } | null>(null);
  const voiceStatusTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Whether we still WANT to be listening, independent of whether the
  // browser's recognizer happens to be running right now. Browsers end a
  // recognition pass on their own after a few seconds of silence even with
  // continuous=true, so onEnd restarts it — but onEnd also fires right
  // after a fatal onError (denied mic, unsupported), and restarting there
  // just re-triggers the same error forever. This flag is what tells those
  // two cases apart.
  const voiceWantsListeningRef = useRef(false);
  // Always points at the current render's handleVoiceFinal — see the
  // onFinal comment in beginListening for why the recognizer can't just
  // close over it directly.
  const handleVoiceFinalRef = useRef<(text: string) => void>(() => {});
  // The agent's current question, shown in the session card and spoken.
  const [voiceAgentMessage, setVoiceAgentMessage] = useState<string | null>(null);
  // Conversation position and the details gathered so far. Refs, not state:
  // handleVoiceFinal runs straight off the recognizer and can fire again
  // before React has re-rendered, so reading these from state would act on
  // a stale copy of the conversation partway through it.
  const voiceStepRef = useRef<AgentStep>("await-prompt");
  const voiceDraftRef = useRef<{ prompt: string; type: ContentType | null; characterId: string | null }>({
    prompt: "",
    type: null,
    characterId: null,
  });
  // Last thing the agent said, so pickPhrasing can avoid repeating it.
  const lastAgentPhrasingRef = useRef<string | null>(null);
  // True while the agent's own TTS is playing. Reported 2026-08-10 as "the
  // agent speaks and repeats itself over and over": the microphone was
  // picking up the agent's replies out of the speakers, transcribing them,
  // and treating them as the user's answer — "What can I help you create?"
  // came back as a prompt, its own follow-up came back as the answer to
  // itself, and round it went. Recognition is now stopped for the duration
  // of every spoken line and restarted only once the audio has finished.
  const agentSpeakingRef = useRef(false);
  // The playing audio element and a resolver for whatever is awaiting it,
  // so stopVoiceSession can cut a reply off mid-sentence — without these,
  // pressing the button left the agent talking to the end of its queue,
  // which is what "it doesn't cancel, it keeps going" was.
  const currentAudioRef = useRef<HTMLAudioElement | null>(null);
  const speakResolveRef = useRef<(() => void) | null>(null);
  const restartListeningTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [pendingAttachments, setPendingAttachments] = useState<PendingAttachment[]>([]);

  const [items, setItems] = useState<ChatItem[]>([]);

  // Renders re-attached to on mount — the lock-phone-mid-render, reopen-the-
  // app case the wrapper exists for. Each gets a VISIBLE turn (prompt
  // bubble, live progress, its own Stop) instead of the old "deliberately
  // quiet" resume, which showed a blank hero composer over a render the
  // person was still waiting on: no bubble, no Stop, and the finished
  // result landed nowhere on this page (2026-09-05 audit). A settled job
  // graduates into a real thread turn via getGenerationThread — the same
  // loader the ?resume= path uses.
  const [resumedJobs, setResumedJobs] = useState<
    { id: string; prompt: string; progress: string | null; stopping: boolean }[]
  >([]);
  // The foreground send's generation id ONCE THE JOB IS QUEUED at the
  // provider — null before that and after it settles. This is what makes
  // "Render in background" safe to offer: pre-queue there is no server-side
  // job for the background watcher to poll, so the affordance only exists
  // in the window where detaching is real.
  const [liveQueuedId, setLiveQueuedId] = useState<string | null>(null);
  // Generations sent to the background mid-flight. The running submitPrompt
  // loop checks this and stands down (its poll returns "abandoned", its
  // foreground path writes nothing more); the resumed-turn watcher owns the
  // job from then on.
  const detachedIdsRef = useRef<Set<string>>(new Set());
  const unmountedRef = useRef(false);
  useEffect(
    () => () => {
      unmountedRef.current = true;
    },
    [],
  );

  // The assistant (2026-08-31). ONE switch, not a mode.
  //
  // The first version of this shipped a Render | Ask segmented control and
  // the operator was right to reject it: it made you declare which thing you
  // were doing before you did it, which is the opposite of a conversation.
  // Now there is a single on/off, and while it is on the composer reads each
  // message and decides for itself — see lib/agent/intent.ts for the rule and
  // for why it is deliberately biased towards answering.
  //
  // OFF IS EXACTLY WHAT THIS APP WAS BEFORE. No classifier runs, no token is
  // spent, every send renders. Someone who turns it off has said they do not
  // want to be second-guessed, and that has to be honoured literally.
  //
  // Defaults off — it costs money — but the choice is remembered, so nobody
  // has to switch it on twice. resetChat deliberately does NOT reset it: a
  // new thread is not a reason to change a preference.
  const [assistantOn, setAssistantOn] = useState(false);
  // Holds a send that looked like a message to the assistant while the person
  // decides what they meant. Null = nothing pending. See plainRenderIntended.
  const [modeQuery, setModeQuery] = useState<string | null>(null);
  // "Render it anyway", bound to the EXACT text it was granted for. A bare
  // boolean would arm whatever send happened to come next — the latent bug
  // skipRulesForPromptRef was rewritten to close.
  const renderAnywayRef = useRef<string | null>(null);
  const [agentEffort, setAgentEffort] = useState<AgentMode>("faster");
  // Increments on every deliberate pick of Smarter; keys the particle burst
  // so it replays each time rather than only on the first.
  const [sparkBurstKey, setSparkBurstKey] = useState(0);
  // Read after mount, never during render: localStorage does not exist on the
  // server, and seeding state from it directly is the classic hydration
  // mismatch. Wrapped because a browser set to block site data throws on
  // access rather than returning null.
  useEffect(() => {
    try {
      // Guarded on the flag: a preference saved while the feature was live
      // must not outlive it being switched off.
      if (chatAgentEnabled && window.localStorage.getItem(ASSISTANT_PREF_KEY) === "1") {
        setAssistantOn(true);
      }
    } catch {
      // Storage unavailable — the assistant simply stays off, which is the
      // safe default anyway.
    }
  }, [chatAgentEnabled]);

  // What pressing Send would do RIGHT NOW, given what is in the box. Drives
  // the button's label so the person can see which of the two things is
  // about to happen before they commit to it — the classifier is a guess,
  // and a guess about someone's money should be visible while it is still
  // free to change.
  //
  // A function rather than a derived const because it reads `prompt`, which
  // is declared further down: hoisting keeps this readable without a
  // temporal-dead-zone trap.
  // Is this text plainly a render instruction, judged even when the assistant
  // is switched off? The composer modes that OWN the box (storyboard, angles,
  // Cinema Studio) are excluded for the same reason sendIntent excludes them:
  // `prompt` is stale text kept alive underneath, and classifying it would
  // block an explicit, correct send.
  // A pending question describes ONE piece of text; the moment that text
  // changes it is answering about something that no longer exists.
  useEffect(() => {
    setModeQuery((q) => (q !== null && q !== prompt ? null : q));
  }, [prompt]);

  function plainRenderIntended(): boolean {
    if (storyboardActive || multiAngleMode || sceneMode || pendingScene !== null) return true;
    if (!prompt.trim()) return true;
    if (renderAnywayRef.current === prompt) return true;
    return classifyMessage(prompt).intent === "render";
  }

  function sendIntent(): "render" | "ask" {
    // chatAgentEnabled FIRST, and it is the reason this is the only place
    // allowed to answer this question. Review found handleSubmit asking
    // `assistantOn` on its own, which meant the AGENT_CHAT_DISABLED kill
    // switch stopped the UI without stopping the BEHAVIOUR: a person who had
    // switched the assistant on before the flag went off kept getting their
    // sends diverted to a route that now 403s, losing the typed prompt every
    // time, with no control left on screen to turn it back off.
    if (!chatAgentEnabled || !assistantOn) return "render";
    // Storyboard and multi-angle own the composer while they are armed: the
    // shot list or the angle picker has replaced the box, and `prompt` is
    // deliberately kept alive underneath it. Classifying that stale text
    // would let a question mark left in it divert an explicit Generate into
    // a chat turn — and skip the storyboardReady / character guards on the
    // way past.
    // sceneMode joins them for the same reason: Cinema Studio owns the
    // composer once armed, and with the assistant on, an armed scene send was
    // being classified as a question and diverted to the chat agent — so the
    // feature simply did not fire.
    if (storyboardActive || multiAngleMode || sceneMode || pendingScene !== null) return "render";
    return classifyMessage(prompt).intent;
  }

  // Drops text into the composer and puts the cursor in it. Used by the
  // "Render this" chip: one tap gets you to a staged send with the receipt
  // in front of you, which is one tap fewer than retyping and one gate more
  // than sending on your behalf.
  function fillComposer(text: string) {
    setPrompt(text);
    setError("");
    requestAnimationFrame(() => {
      const box = promptTextareaRef.current;
      if (!box) return;
      box.focus();
      box.setSelectionRange(text.length, text.length);
    });
  }

  function toggleAssistant() {
    setAssistantOn((was) => {
      const next = !was;
      try {
        window.localStorage.setItem(ASSISTANT_PREF_KEY, next ? "1" : "0");
      } catch {
        // Not being able to remember the choice is not a reason to refuse it.
      }
      return next;
    });
    setError("");
  }
  const [liveAsk, setLiveAsk] = useState<{ question: string; answer: string } | null>(null);
  const [asking, setAsking] = useState(false);
  // Aborts the in-flight stream when the person hits Stop or starts a new
  // chat. Without it a long answer keeps arriving into a thread that has
  // already been cleared.
  const askAbortRef = useRef<AbortController | null>(null);

  const [livePrompt, setLivePrompt] = useState<string | null>(null);
  const [liveAttachments, setLiveAttachments] = useState<ChatAttachment[]>([]);
  // The content type the live request was actually SUBMITTED with. The
  // archived item (see setItems in submitPrompt) already records
  // effectiveContentType; the live result bubble used to read the current
  // `contentType` toggle instead — so a voice-agent override, or flipping
  // the video/image chip while a render was still in flight, made the live
  // result render as the wrong media element (a video in an <img>, or vice
  // versa) until it was archived.
  const [liveContentType, setLiveContentType] = useState<ContentType>("video");
  const [liveTimeline, setLiveTimeline] = useState<VisibleItem[]>([]);
  const [liveIsLive, setLiveIsLive] = useState(false);
  const [liveResult, setLiveResult] = useState<{
    id: string;
    succeeded: boolean;
    resultUrl: string | null;
    attempts: number;
    reason: string | null;
    finalPrompt: string;
    // The full attempt log behind a failure (fetched from the saved row for
    // queued renders, whose poll outcome is only a one-liner) — drives the
    // evidence text and the Generate-anyway / Retry-on-2.0 offers on the
    // LIVE surface, not just in the reloaded thread.
    attemptsLog: AttemptLog[] | null;
    prompt: string;
  } | null>(null);
  const [revealedCount, setRevealedCount] = useState(0);
  // What the queued render is currently doing ("Rendering your video",
  // "Generating the voice", ...). Null when nothing is queued. A video can
  // take ten minutes, and a single unlabelled spinner for that long reads as
  // a hang — this is the difference between "it's working" and "it's broken".
  const [liveProgress, setLiveProgress] = useState<string | null>(null);

  // Multi-angle: turning the toggle on doesn't generate immediately — hitting
  // send stashes the prompt in pendingMultiAngle and shows a confirm panel
  // (default angles pre-checked, editable) in place of the composer. Only
  // confirming there kicks off liveMultiAngle (a loading bubble) and then
  // the real request.
  const [multiAngleMode, setMultiAngleMode] = useState(false);
  const [pendingMultiAngle, setPendingMultiAngle] = useState<{ prompt: string; attachments: ChatAttachment[] } | null>(null);
  const [selectedAngles, setSelectedAngles] = useState<AngleId[]>(DEFAULT_ANGLE_IDS);
  // string[], not AngleId[]: a Cinema Studio scene's rows are keyed "shot-1"
  // .. "shot-6" rather than by angle name. Only .length is ever read.
  const [liveMultiAngle, setLiveMultiAngle] = useState<{ prompt: string; attachments: ChatAttachment[]; angleIds: string[] } | null>(null);

  // ---- Cinema Studio -------------------------------------------------
  // Armed like multi-angle, but with a planning step in between: the idea is
  // sent to a director, the shot list comes back with its full price, and
  // only then can it be rendered. A scene is N paid renders, so nothing about
  // the spend should be learned after pressing the button.
  const [sceneMode, setSceneMode] = useState(false);
  const [pendingScene, setPendingScene] = useState<{ prompt: string; attachments: ChatAttachment[] } | null>(null);
  const [scenePlan, setScenePlan] = useState<ScenePlan | null>(null);
  const [scenePlanning, setScenePlanning] = useState(false);
  const [sceneShotCount, setSceneShotCount] = useState(3);


  // New composer toolbar state (the + menu / creation-mode chip) — see the
  // render return below. The old slide-out advanced group (advancedOpen, the
  // unlabeled chevron that width-clipped four identical icon toggles) is gone
  // with the Stage redesign: every mode is a labeled pill, always rendered,
  // so there is no reveal state left to track.
  const [plusMenuOpen, setPlusMenuOpen] = useState(false);
  const [creationModeActive, setCreationModeActive] = useState(false);
  const plusMenuRef = useRef<HTMLDivElement>(null);

  // "Take photo" only makes sense on a phone/tablet — that's the only place
  // the file input's capture attribute actually opens a live camera. On a
  // desktop browser it silently falls back to the same file picker as
  // "Upload files" (real incident, 2026-08-08: a user on a Mac clicked it
  // and just got Finder), so it's hidden there instead of showing an option
  // that doesn't do anything a desktop user can't already do via Upload.
  // Starts false (matches SSR, where navigator doesn't exist) and is only
  // ever flipped on after mount, once the real device can be checked — never
  // flips true→false, so there's no flash-of-wrong-state on phones either.
  const [showCameraOption, setShowCameraOption] = useState(false);
  useEffect(() => {
    const nav = navigator as Navigator & { userAgentData?: { mobile?: boolean } };
    // iPadOS reports a desktop-style user agent by default, so it needs its
    // own check (touch support + the "MacIntel" platform string Safari uses
    // for iPad) rather than relying on the UA string alone.
    const isIPad = navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1;
    const uaMatch = /Android|iPhone|iPad|iPod|Mobile|Tablet|Silk|Kindle/i.test(navigator.userAgent);
    setShowCameraOption(Boolean(nav.userAgentData?.mobile) || isIPad || uaMatch);
  }, []);

  // Which "you can leave" reassurance the in-flight note under the composer
  // can honestly make. The render itself survives leaving either way — it's
  // queued at fal.ai and the webhook collects it server-side even with every
  // tab closed (see app/api/webhooks/fal) — but only the native app can
  // promise a notification: notifyUser delivers FCM pushes to push_tokens,
  // which only the iOS/Android shell ever registers (NativePush no-ops on
  // the web), and the browser Notification permission requested above dies
  // with the tab. So native gets "we'll notify you"; the web gets "it lands
  // in History". Starts false so SSR and the first client frame agree —
  // same pattern as InsufficientCreditsBanner's native check.
  const [nativeClient, setNativeClient] = useState(false);
  useEffect(() => {
    setNativeClient(isNativeAppClient());
  }, []);

  // Hero mode (dashboard home only — see the heroMode prop): starts as just
  // a greeting and a plain composer, no toolbar/character-picker/card
  // chrome. Typing and hitting send does NOT dock it — that would expand
  // the composer before the person actually asked for anything, which felt
  // premature. It docks for one of two real reasons instead: a message
  // actually gets sent (hasAnyMessages), or the person explicitly picks
  // Create image/video from the + menu (creationModeActive).
  const hasAnyMessages =
    items.length > 0 ||
    resumedJobs.length > 0 ||
    livePrompt !== null ||
    liveMultiAngle !== null ||
    liveAsk !== null;
  const isHero = heroMode && !creationModeActive && !hasAnyMessages;

  // Kling advanced video options — storyboard (start/end frame) and
  // multi-image reference both draw from the selected character's existing
  // reference photos rather than a new upload flow. Mutually exclusive with
  // each other and with multi-angle mode (see the effects below) to keep the
  // pipeline's branching in fal.ts unambiguous — only one "which endpoint"
  // decision per request.
  // Per-generation video model choice — defaults to the admin's global
  // default (Admin > AI Providers) but the user can override it here for
  // just this generation. Pricier models cost more of the monthly plan
  // allowance (see creditWeight, shown in the picker) — checked server-side
  // in runGeneration, not just hidden/disabled here.
  //
  // A link may name the model (?model=, the Producer's prepared sends,
  // 2026-09-24) — honoured only when it is one this account's picker offers,
  // so a link can never select a model the composer itself wouldn't.
  const [videoModelId, setVideoModelId] = useState(() => {
    const fromUrl = searchParams.get("model");
    return fromUrl && videoModels.some((m) => m.id === fromUrl) ? fromUrl : defaultVideoModelId;
  });
  // The picture lane for THIS send (2026-09-23). Opens on the admin's global
  // default so the cell never names a model the render would not use, and is
  // only ever sent for an image — actions.ts ignores it otherwise and pins
  // free accounts to the default whatever this holds.
  const [imageModelId, setImageModelId] = useState(defaultImageModelId);
  const [imageModelMenuOpen, setImageModelMenuOpen] = useState(false);
  // The picture's size and shape for THIS send (2026-09-23). Both are
  // per-lane: 4K exists only on Nano Banana Pro, and GPT Image renders three
  // shapes where that lane renders ten — so both reset when the lane changes
  // (the effect below), or a person who picked 4K and switched engines would
  // be sending a band the new lane never sells.
  const [imageResolution, setImageResolution] = useState<ImageResolution>(() => defaultImageResolution(defaultImageModelId));
  const [imageAspect, setImageAspect] = useState<ImageAspect>(DEFAULT_IMAGE_ASPECT);
  const [imageQuality, setImageQuality] = useState<ImageQuality>(DEFAULT_IMAGE_QUALITY);
  const [imageQualityMenuOpen, setImageQualityMenuOpen] = useState(false);
  const [imageSizeMenuOpen, setImageSizeMenuOpen] = useState(false);
  const [imageFrameMenuOpen, setImageFrameMenuOpen] = useState(false);
  // Clip continuation, arriving via ?continue=<generationId> from a video's
  // History page. The chip above the composer shows it; the id rides the
  // submit as continue_from_generation_id and the server re-validates
  // ownership. Seedance-only: the mount effect below steers the model there
  // once, and a LATER manual switch away quietly drops the chip instead of
  // fighting the user for the picker.
  const [continueFromId, setContinueFromId] = useState<string | null>(() =>
    searchParams.get("continue"),
  );
  // The source clip's length, riding the same link (?continue_s=) so
  // continuation's price can be shown before the send. Display only — the
  // server re-reads the real duration off the row it validates.
  const [continueSourceSeconds] = useState<number>(() =>
    Math.max(0, Number(searchParams.get("continue_s") ?? 0) || 0),
  );
  // ?continue is consumed into state once and then STRIPPED from the URL —
  // exactly like ?resume further down. It used to stay in the address bar
  // forever, so any later remount of the composer (hard reload, PWA
  // re-open, navigating back to /app/generate) silently re-armed the
  // continuation chip and re-steered the model. Operator repro, 2026-08-25:
  // mid-image-generation the composer "turned to continue previous video".
  useEffect(() => {
    if (!searchParams.get("continue")) return;
    router.replace("/app/generate", { scroll: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // Storyboard (Kling O3 Pro multi_prompt): the shot list replaces the
  // textarea while on. State lives here so switching the toggle off and on
  // again keeps the drafted shots. Auto-off when the model leaves O3 Pro —
  // the effect below — mirroring how the continuation chip yields to a
  // manual model switch instead of fighting the picker.
  const [storyboardMode, setStoryboardMode] = useState(false);
  const storyboardIdRef = useRef(2);
  const [storyboardShots, setStoryboardShots] = useState<
    { id: number; prompt: string; seconds: number }[]
  >([
    { id: 0, prompt: "", seconds: 5 },
    { id: 1, prompt: "", seconds: 5 },
  ]);
  const storyboardActive = storyboardMode && contentType === "video" && videoModelId === "kling-o3-pro";
  const storyboardTotalSeconds = storyboardShots.reduce((n, s) => n + s.seconds, 0);
  const storyboardCredits = storyboardCreditCost(videoModelId, storyboardTotalSeconds); // same helper the server charges with
  const storyboardReady =
    storyboardShots.length >= 2 && storyboardShots.every((s) => s.prompt.trim().length > 0);
  useEffect(() => {
    if (storyboardMode && (contentType !== "video" || videoModelId !== "kling-o3-pro")) {
      setStoryboardMode(false);
    }
  }, [storyboardMode, contentType, videoModelId]);

  // Outfit chip (2026-08-24): on by default whenever the selected character
  // has saved outfit photos; tapping it off is a one-generation choice that
  // resets when the character changes. The server treats an absent field as
  // on too, so older cached composers behave the same.
  const [useOutfit, setUseOutfit] = useState(true);
  useEffect(() => {
    setUseOutfit(true);
  }, [characterId]);

  // Cinema preset (2026-08-26): one tap adds a proven camera move or film
  // look — a fixed prompt block from cinema-presets.ts, applied server-side
  // after drafting so the tested text rides verbatim. Only offered on the
  // lane the validation matrix proved (Seedance video, plain sends), and
  // leaving that lane clears the pick — same no-ghost-state rule as the
  // continuation chip. Sticky across sends on purpose, like the outfit
  // chip: a person shooting a preset series shouldn't re-pick every time.
  // One armed preset PER CATEGORY (2026-08-27, operator: "You cant select
  // Camera, lighting and looks at the same time") — a camera move and a
  // light/look stack; two of the same category replace each other.
  const [cinemaPresetIds, setCinemaPresetIds] = useState<Partial<Record<CinemaPresetCategory, string>>>({});
  const armedPresetIds = (["move", "look", "fx"] as const)
    .map((c) => cinemaPresetIds[c])
    .filter((id): id is string => Boolean(id));
  // Collapsed by default (operator, 2026-08-26: presets must not appear
  // uninvited) — a "Presets" button reveals the row. One honesty rule: an
  // ARMED preset is never invisible — with the row closed, the button
  // itself carries the selected preset's name in the accent state.
  const [presetRowOpen, setPresetRowOpen] = useState(false);
  // Category tab inside the presets row (2026-08-27: lighting joined "look",
  // FX arrived as its own category). Tabs render only for categories that
  // hold at least one PROVEN preset — FX stays entirely invisible until its
  // validation matrix runs and flips blocks proven.
  const [presetTab, setPresetTab] = useState<CinemaPresetCategory>("move");
  // Hover preview (operator, 2026-08-26: the inline player was clutter —
  // "pops you the video, same as when you hover over any button"). Pointer
  // devices get a tooltip-style popover playing the proof clip; touch
  // devices keep tap-to-arm with thumbnails. Rendered position: fixed so it
  // escapes the row's overflow-x clipping; anchored to the hovered chip's
  // rect, flipped below when the chip sits near the viewport top.
  const [presetPreview, setPresetPreview] = useState<{
    id: string;
    left: number;
    topY: number;
    bottomY: number;
  } | null>(null);

  const continueModelAppliedRef = useRef(false);
  useEffect(() => {
    if (!continueFromId) return;
    // Continuation is a video concept: switching the composer to images
    // clears it outright rather than leaving a ghost chip armed to
    // resurface on a later flip back to video (same operator repro as the
    // URL strip above — no state may outlive the mode it belongs to).
    if (contentType !== "video") {
      setContinueFromId(null);
      return;
    }
    if (videoModelId === "seedance" || videoModelId === "seedance-2") {
      continueModelAppliedRef.current = true;
      return;
    }
    if (!continueModelAppliedRef.current) {
      selectVideoModel("seedance-2");
    } else {
      setContinueFromId(null);
    }
  }, [continueFromId, videoModelId, contentType]);
  const [videoModelMenuOpen, setVideoModelMenuOpen] = useState(false);
  // The duration chip's own dropdown (operator, 2026-09-02: durations get a
  // separate menu, not a ride on the engine sheet).
  const [durationMenuOpen, setDurationMenuOpen] = useState(false);
  const durationMenuRef = useRef<HTMLDivElement>(null);
  // "More models" expander inside the picker (composer cleanup case 1).
  const [modelMenuShowAll, setModelMenuShowAll] = useState(false);
  const videoModelMenuRef = useRef<HTMLDivElement>(null);
  const imageModelMenuRef = useRef<HTMLDivElement>(null);
  const imageSizeMenuRef = useRef<HTMLDivElement>(null);
  const imageFrameMenuRef = useRef<HTMLDivElement>(null);
  const imageQualityMenuRef = useRef<HTMLDivElement>(null);

  // Clip length — each model has its own real set of valid durations (see
  // video-models.ts), so this always has to be one of the CURRENT model's
  // options, not an arbitrary number. Starts at the default model's default
  // duration; the effect below re-snaps it any time the model changes to one
  // where the current value isn't valid (e.g. switching from Kling O3's 15s
  // down to Kling 1.6, which tops out at 10s).
  const [videoDurationSeconds, setVideoDurationSeconds] = useState(() => {
    // A linked model (?model=) opens at the linked length (?seconds=) when
    // that model offers it, else at the model's own default — never at the
    // account default, which was resolved against a different model.
    const linked = videoModels.find((m) => m.id === searchParams.get("model"));
    if (linked) {
      const s = Number(searchParams.get("seconds"));
      return linked.durations.some((d) => d.seconds === s) ? s : linked.defaultDurationSeconds;
    }
    return (
      // The account's own default length when it set one (resolved
      // server-side against this very model), else the model's.
      defaultVideoDurationSeconds ??
      videoModels.find((m) => m.id === defaultVideoModelId)?.defaultDurationSeconds ??
      5
    );
  });

  // Placed here, AFTER videoModelId and videoDurationSeconds exist.
  //
  // It was originally hoisted to the top of the component, which threw on
  // every render — reading a useState binding before its declaration is a
  // temporal dead zone error, and it took out /app entirely. TypeScript
  // doesn't flag it because these are destructured from useState rather
  // than declared directly.
  // What the current selection actually costs, and whether it's affordable.
  //
  // Worked out here rather than left for the server to reject after the fact:
  // finding out you can't afford something AFTER pressing generate is the
  // worst moment to learn it, and it's the moment people give up rather than
  // top up.
  const [videoResolutionWanted, setVideoResolutionWanted] = useState<VideoResolution | null>(null);
  const resolutionOffers = contentType === "video" ? videoResolutionOffers(videoModelId) : [];
  // DERIVED, not synced. An earlier pass cleared the pick from an effect when
  // the composer left a model that offers it; deriving instead means a stale
  // pick can never ride along to an endpoint with no resolution parameter,
  // costs no cascading render, and has the nicer behaviour — switch to Kling
  // and back to Veo and the choice is still there.
  const videoResolution =
    videoResolutionWanted && resolutionOffers.some((o) => o.value === videoResolutionWanted)
      ? videoResolutionWanted
      : null;

  const selectedVideoModel = videoModels.find((m) => m.id === videoModelId);
  // Base duration weight, then the resolution override when one applies.
  // The person must see 4K's real price BEFORE sending — a paid resolution
  // whose cost only appears on the receipt is exactly the kind of claim this
  // codebase has spent the week removing.
  const baseDurationCredits =
    contentType === "video" && selectedVideoModel
      ? (selectedVideoModel.durations.find((d) => d.seconds === videoDurationSeconds)?.creditWeight ?? 1)
      : 1;
  useEffect(() => {
    const model = videoModels.find((m) => m.id === videoModelId);
    if (!model) return;
    if (!model.durations.some((d) => d.seconds === videoDurationSeconds)) {
      setVideoDurationSeconds(model.defaultDurationSeconds);
    }
    // Only re-checking when the model changes — re-running this every time
    // videoDurationSeconds itself changes would fight the user's own picks.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [videoModelId, videoModels]);

  // Aspect ratio — null means "no explicit pick," which lets the resolution
  // in actions.ts fall through to whatever the prompt text itself says, then
  // to the 16:9 default. Real incident, 2026-08-07: a user asked for 16:9
  // directly in their prompt and still got a pillarboxed video because the
  // model in use (Kling O3) had no parameter anywhere that could have
  // honored it — fixed server-side (see fal.ts's reframe step), this picker
  // is just the explicit-intent half of that fix. An explicit prompt mention
  // always wins over whichever icon is selected here, even if one is.
  // Starts on the account's own default when it set one (Settings →
  // Generation); an explicit mention in the prompt still wins server-side.
  const [videoAspectRatio, setVideoAspectRatio] = useState<"16:9" | "9:16" | null>(defaultAspectRatio);

  // Optional free resolution upgrade (2026-08-30). Veo 3.1 bills 720p and
  // 1080p identically ("$0.40 with audio for 720p or 1080p", fal's own
  // pricing line) but both its endpoints default to 720p, so every Veo
  // render was taking the lower resolution at the higher-resolution price.
  // Offered ONLY where it is genuinely free — freeHighResolution() in
  // video-models.ts is the single source of truth and the server re-checks
  // it, so this control can never make a generation cost more. 4K is
  // deliberately absent: it bills 1.5x and would need a real credit weight.

  const [videoAdvancedMode, setVideoAdvancedMode] = useState<"none" | "storyboard" | "multiref">("none");
  // Placed after videoAdvancedMode/videoModelId exist (declaration order —
  // the same TDZ trap sendPlanModelName hit). Availability mirrors the
  // server gate in actions.ts exactly; the effect clears a pick the moment
  // the composer leaves the proven lane.
  const cinemaPresetsAvailable =
    contentType === "video" &&
    videoAdvancedMode === "none" &&
    (videoModelId === "seedance" || videoModelId === "seedance-2");
  useEffect(() => {
    if (armedPresetIds.length > 0 && !cinemaPresetsAvailable) setCinemaPresetIds({});
  }, [armedPresetIds.length, cinemaPresetsAvailable]);
  const [advancedPanelOpen, setAdvancedPanelOpen] = useState(false);
  const [storyboardStartPath, setStoryboardStartPath] = useState<string | null>(null);
  const [storyboardEndPath, setStoryboardEndPath] = useState<string | null>(null);
  const [multiRefPaths, setMultiRefPaths] = useState<string[]>([]);

  // Photos uploaded specifically for the storyboard/multi-reference panel —
  // a person can now anchor these to an uploaded photo instead of, or
  // alongside, a saved character reference photo (see the upload tile
  // rendered first in each grid below), whether or not a character is even
  // selected. Kept separate from pendingAttachments (the general chat-
  // message attachments) since these are slotted straight into storyboard/
  // multi-ref rather than shown as a chat bubble attachment. Identified by
  // their signed url (always starts with "http") rather than a storage
  // path — that's how the server (actions.ts) tells an upload apart from a
  // character's own saved photo with no extra form field needed.
  const [panelUploads, setPanelUploads] = useState<{ path: string; url: string }[]>([]);

  // The server's own balance (spendableCredits, the same call
  // checkGenerationAllowance refuses with). Bonus was missing here after it
  // left the ceiling on 2026-09-23: a Starter account holding 30 bonus
  // credits read "you have 5 — Add 20 credits" under a header saying 35,
  // with the scene Render button locked, while the server took the send.
  const creditsAvailable = spendableCredits({
    monthlyLimit: creditsLimit,
    used: creditsUsed,
    bonus: bonusCredits,
    purchased: purchasedCredits,
  });
  // What THIS SEND actually costs now comes from quoteSend, just below the
  // dialogue state it reads — one pure function shared with the server's
  // charge paths, so the surcharge conditions the misquote incidents each
  // desynced (the 9-quoted-45-charged multi-angle batch, the frame surcharge
  // quoted off lingering multiref picks, the scene priced as one render, the
  // dialogue surcharge the TOTAL omitted) exist exactly once.
  const [panelUploadBusy, setPanelUploadBusy] = useState(false);
  const panelUploadInputRef = useRef<HTMLInputElement>(null);

  // Which of the selected character's OWN saved reference photos anchors
  // this generation — only meaningful once a character has more than one
  // (see the picker below). null means "use the character's first/default
  // photo," the existing behavior. Real report, 2026-08-08: a character with
  // both a normal photo and a close-up photo saved kept generating from the
  // normal one even when the prompt asked for a close-up, because the
  // pipeline only ever looked at reference_image_urls[0] — it had no way to
  // know the person meant "use the OTHER one." This lets them say so.
  const [anchorPhotoPath, setAnchorPhotoPath] = useState<string | null>(null);

  // Other DIFFERENT characters composited into this generation alongside the
  // primary (characterId) — e.g. two saved characters appearing together in
  // one video or image. A separate feature from multiRefPaths above (several
  // PHOTOS of the SAME character) — deliberately mutually exclusive with it
  // (see clearAdvancedVideo/toggleCompanionCharacter below), since there'd be
  // no way to say which reference photo belongs to which character if both
  // were active at once. Also mutually exclusive with multi-angle mode for
  // this first pass — see toggleMultiAngleMode.
  const [companionCharacterIds, setCompanionCharacterIds] = useState<string[]>([]);

  // Dialogue — a spoken line the character says, lip-synced onto the
  // finished video. Available on every plan (unlike the Kling-only advanced
  // options above); only shown once the selected character has a voice
  // assigned in Character settings.
  const [dialogueText, setDialogueText] = useState("");
  // The quote (see the note below creditsAvailable). Inputs are what will
  // actually be SENT, never lingering picker state: multiref picks ride only
  // in multiref mode, frames only in storyboard mode (the 2026-08-31
  // misquote), and a staged scene is the larger fan-out — up to six renders
  // — with multi-angle the smaller.
  const sendQuote = quoteSend({
    contentType,
    imageModelId,
    imageResolution,
    imageQuality,
    videoModelId,
    videoDurationSeconds,
    videoResolution,
    storyboardTotalSeconds: storyboardActive ? storyboardTotalSeconds : null,
    referencePhotoCount: videoAdvancedMode === "multiref" ? multiRefPaths.length : 0,
    framePicked:
      videoAdvancedMode === "storyboard" && Boolean(storyboardStartPath || storyboardEndPath),
    continuationSourceSeconds: continueFromId ? continueSourceSeconds : null,
    dialoguePresent: dialogueText.trim().length > 0,
    renderCount:
      contentType !== "video"
        ? 1
        : scenePlan
          ? scenePlan.shots.length
          : multiAngleMode
            ? selectedAngles.length
            : 1,
  });
  const sendRenderCount = sendQuote.renderCount;
  const sendCreditCost = sendQuote.totalCredits;
  const cannotAfford = sendCreditCost > creditsAvailable;
  // "Uses today's free generation" is a promise about THIS send: the server
  // spends the daily slot only on a send within the trial's own pinned cost
  // (core.ts), and anything above that ceiling draws on purchased credits.
  // Gated on the pill, the promise used to sit beside the red shortfall
  // banner — free and can't-afford at once — or, for a topped-up account,
  // promised free while purchased credits were silently debited.
  const sendRidesFreeSlot = dailyFreeAvailable && sendQuote.freeSlotEligible;

  const bottomRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  // Separate from fileInputRef above so the "Upload files" and "Take photo"
  // menu items can each open the right native picker — the capture
  // attribute is what tells a mobile browser to open the camera directly
  // instead of the general photo/file library. Shares handleFilesSelected
  // with the regular file input, so a captured photo lands in the chat
  // bubble through the exact same attachment pipeline as an uploaded one.
  const cameraInputRef = useRef<HTMLInputElement>(null);
  // The composer's prompt textarea — held so the auto-grow effect below can
  // measure its content height.
  const promptTextareaRef = useRef<HTMLTextAreaElement>(null);
  const isAnimating = revealedCount > 0 && revealedCount < liveTimeline.length;
  const isUploading = pendingAttachments.some((a) => a.status === "uploading");
  // Prompt Studio's image mode needs a finished upload to read.
  const hasReadyImageAttachment = pendingAttachments.some(
    (a) => a.status === "ready" && a.type.startsWith("image/") && Boolean(a.url),
  );
  const locked = submitting || pendingMultiAngle !== null;
  // Whether the foreground send can be sent to the background right now:
  // queued at the provider, not already stopping, and no background render
  // running (one background + one foreground = the two-concurrent cap).
  const canDetach = submitting && !stopping && liveQueuedId !== null && resumedJobs.length === 0;

  const currentCharacter = characters.find((c) => c.id === characterId);
  const referencePhotos = currentCharacter?.referencePhotos ?? [];

  // The combined pool the storyboard/multi-reference pickers draw from —
  // freshly uploaded photos first (most recent intent), then whatever the
  // selected character already has saved. `value` is what actually gets
  // sent on submit (a raw url for uploads, a storage path for a character's
  // own photo — see resolveMaybeSignedUrl in actions.ts); `thumbUrl` is
  // always a displayable url either way.
  const advancedPhotoOptions = [
    ...panelUploads.map((p) => ({ key: p.url, thumbUrl: p.url, value: p.url })),
    ...referencePhotos.map((p) => ({ key: p.path, thumbUrl: p.url, value: p.path })),
  ];

  // Multi-character cast — the primary plus every companion, resolved back
  // to full CharacterOption objects so their reference-photo counts and
  // names are available for the inline validation/warning copy below.
  const companionCharacters = companionCharacterIds
    .map((id) => characters.find((c) => c.id === id))
    .filter((c): c is CharacterOption => Boolean(c));
  const isMultiCharacter = companionCharacterIds.length > 0;
  const castMemberMissingPhoto = isMultiCharacter
    ? (currentCharacter ? [currentCharacter, ...companionCharacters] : companionCharacters).find(
        (c) => c.referencePhotos.length === 0,
      )
    : undefined;

  // Whether storyboard/multi-reference is a plan+model fit at all — doesn't
  // depend on a character being picked, or having any saved photos, since
  // the panel now also accepts freshly uploaded photos (see panelUploads
  // above and the upload tile in each grid below).
  const advancedVideoEligible = contentType === "video" && videoModelId === "kling" && advancedPlanActive;
  // Both advanced icons are now always rendered, just switched off when they
  // aren't usable. Hiding them left the disclosure arrow opening onto an
  // empty tray — which reads as a broken control rather than a locked
  // feature, and tells nobody the capability exists. Locked buttons stay
  // clickable on purpose: the click is what explains why they're off.
  const multiAngleLocked = !multiAngleAvailable;
  const advancedVideoLockedReason: "plan" | "model" | null = !advancedPlanActive
    ? "plan"
    : videoModelId !== "kling"
      ? "model"
      : null;

  // Voice sessions don't survive a navigation/unmount (the browser's
  // recognizer instance goes with the component) — stop it cleanly rather
  // than leaving the mic listening after the person's left the page.
  useEffect(() => {
    return () => {
      voiceWantsListeningRef.current = false;
      voiceSessionRef.current?.stop();
      // Navigating away mid-sentence shouldn't leave the agent talking to
      // an empty room, or a queued restart reopening the mic afterwards.
      currentAudioRef.current?.pause();
      speakResolveRef.current?.();
      if (voiceStatusTimeoutRef.current) clearTimeout(voiceStatusTimeoutRef.current);
      if (restartListeningTimeoutRef.current) clearTimeout(restartListeningTimeoutRef.current);
    };
  }, []);

  // Outside click closes the character switcher — it's a plain absolutely-
  // positioned dropdown (no portal needed) since the composer's outer
  // wrapper no longer clips overflow.
  useEffect(() => {
    if (!characterMenuOpen && !photoMenuOpen) return;
    function onClick(e: MouseEvent) {
      if (characterMenuRef.current && !characterMenuRef.current.contains(e.target as Node)) {
        setCharacterMenuOpen(false);
        setPhotoMenuOpen(false);
      }
    }
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [characterMenuOpen, photoMenuOpen]);

  // Same outside-click-closes pattern for the composer's + menu.
  useEffect(() => {
    if (!plusMenuOpen) return;
    function onClick(e: MouseEvent) {
      if (plusMenuRef.current && !plusMenuRef.current.contains(e.target as Node)) {
        setPlusMenuOpen(false);
      }
    }
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [plusMenuOpen]);

  // Same outside-click-closes pattern for the video model switcher.
  useEffect(() => {
    if (!videoModelMenuOpen) return;
    function onClick(e: MouseEvent) {
      if (videoModelMenuRef.current && !videoModelMenuRef.current.contains(e.target as Node)) {
        setVideoModelMenuOpen(false);
      }
    }
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [videoModelMenuOpen]);

  // A lane change resets the size and the shape to what THAT lane offers.
  // Server-side the same thing happens regardless (actions.ts validates both
  // against the final lane), so this is about the cell telling the truth —
  // not about safety.
  useEffect(() => {
    // SIZE goes to the new lane's DEFAULT, not to whatever the old lane was
    // on even when the new one offers it. Measured in the harness: switching
    // from GPT Image to Nano Banana Pro left the cell on 1K, which that lane
    // sells for exactly the same $0.15 as 2K — the same money for a quarter
    // of the pixels, silently, because the value carried over.
    setImageResolution(defaultImageResolution(imageModelId));
    // SHAPE carries over when the new lane can render it: the default is the
    // square on every lane, so keeping a deliberate choice is never wrong,
    // and only a shape the new lane cannot do has to be given up.
    setImageAspect((prev) => (offersImageAspect(imageModelId, prev) ? prev : DEFAULT_IMAGE_ASPECT));
    // QUALITY is GPT Image's own enum — a lane without one has nothing to
    // carry, and a lane with one opens at the tier every take has used.
    setImageQuality((prev) => (offersImageQuality(imageModelId, prev) ? prev : DEFAULT_IMAGE_QUALITY));
  }, [imageModelId]);

  // Same again for the picture model switcher.
  useEffect(() => {
    if (!imageModelMenuOpen) return;
    function onClick(e: MouseEvent) {
      if (imageModelMenuRef.current && !imageModelMenuRef.current.contains(e.target as Node)) {
        setImageModelMenuOpen(false);
      }
    }
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [imageModelMenuOpen]);

  // And for the picture's size and shape sheets.
  useEffect(() => {
    if (!imageSizeMenuOpen && !imageFrameMenuOpen && !imageQualityMenuOpen) return;
    function onClick(e: MouseEvent) {
      if (imageSizeMenuRef.current && !imageSizeMenuRef.current.contains(e.target as Node)) setImageSizeMenuOpen(false);
      if (imageFrameMenuRef.current && !imageFrameMenuRef.current.contains(e.target as Node)) setImageFrameMenuOpen(false);
      if (imageQualityMenuRef.current && !imageQualityMenuRef.current.contains(e.target as Node)) setImageQualityMenuOpen(false);
    }
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [imageSizeMenuOpen, imageFrameMenuOpen, imageQualityMenuOpen]);

  // And for the duration dropdown.
  useEffect(() => {
    if (!durationMenuOpen) return;
    function onClick(e: MouseEvent) {
      if (durationMenuRef.current && !durationMenuRef.current.contains(e.target as Node)) {
        setDurationMenuOpen(false);
      }
    }
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [durationMenuOpen]);

  // Escape closes whichever popup is open (2026-09-05 audit): the triggers
  // advertise aria-haspopup, promising standard popup behavior, but the four
  // menus above closed ONLY on an outside mousedown — a keyboard user who
  // opened the model picker with Enter had no way to dismiss it. These are
  // lightweight popovers, not modals, so no focus trap: for a keyboard user
  // the trigger is usually still the focused element, which is exactly
  // where Escape should leave them.
  useEffect(() => {
    if (!characterMenuOpen && !photoMenuOpen && !plusMenuOpen && !videoModelMenuOpen && !imageModelMenuOpen && !durationMenuOpen)
      return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key !== "Escape") return;
      setCharacterMenuOpen(false);
      setPhotoMenuOpen(false);
      setPlusMenuOpen(false);
      setVideoModelMenuOpen(false);
      setImageModelMenuOpen(false);
      setImageSizeMenuOpen(false);
      setImageFrameMenuOpen(false);
      setImageQualityMenuOpen(false);
      setDurationMenuOpen(false);
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [characterMenuOpen, photoMenuOpen, plusMenuOpen, videoModelMenuOpen, imageModelMenuOpen, durationMenuOpen]);

  // Composer + menu — "Create image"/"Create video" set the content type
  // directly (Picacho has no separate style-template gallery like Gemini's,
  // it generates from the character + prompt) and flip on the small mode
  // chip beside the button; clicking that chip's own x clears back to the
  // plain composer.
  function chooseCreationMode(type: ContentType) {
    setContentType(type);
    setCreationModeActive(true);
    setPlusMenuOpen(false);
  }

  function clearCreationMode() {
    setCreationModeActive(false);
    setContentType("video");
  }

  // Clears the brief post-command confirmation (e.g. "Switched to Mia.")
  // after a few seconds so the card returns to showing live captions —
  // doesn't touch voiceSessionActive itself, the session keeps listening
  // right through this.
  function clearVoiceStatusSoon() {
    if (voiceStatusTimeoutRef.current) clearTimeout(voiceStatusTimeoutRef.current);
    voiceStatusTimeoutRef.current = setTimeout(() => setVoiceStatusMessage(null), 2600);
  }

  // Starts (or restarts, after the browser's own silence timeout — see
  // onEnd) one listening pass. Kept separate from startVoiceSession so
  // onEnd can call back into just this part without re-resetting the
  // caption/status state on every natural pause.
  function beginListening() {
    const session = startListening({
      onInterim: (text) => setVoiceInterimCaption(text),
      // Always goes through the ref, never the closed-over function: the
      // recognizer instance keeps whichever callbacks it was built with,
      // so a session that's been running across a few restarts would
      // otherwise still be calling the very first render's handler — and
      // submitting with, say, the character that was selected back then
      // rather than the one just switched to by voice.
      onFinal: (text) => {
        // Belt-and-braces against the self-hearing loop: recognition is
        // already stopped while the agent talks, but a result captured just
        // before that stop can still land here a moment later.
        if (agentSpeakingRef.current) return;
        handleVoiceFinalRef.current(text);
      },
      onError: (kind) => {
        voiceWantsListeningRef.current = false;
        voiceSessionRef.current = null;
        setVoiceSessionActive(false);
        setVoiceInterimCaption("");
        setError(kind === "not-supported" ? v.notSupported : kind === "not-allowed" ? v.micBlocked : v.lostMic);
      },
      onEnd: () => {
        // Only a browser-side silence timeout should restart us — not an
        // intentional stop, and not the pause taken while the agent is
        // speaking (agentSay restarts it itself once the audio finishes).
        if (!voiceWantsListeningRef.current || agentSpeakingRef.current) return;
        // Small delay rather than restarting inline: some browsers end and
        // re-end immediately if the mic isn't ready yet, and a tight
        // start/end loop pegs the CPU and throws from start().
        if (restartListeningTimeoutRef.current) clearTimeout(restartListeningTimeoutRef.current);
        restartListeningTimeoutRef.current = setTimeout(() => {
          if (voiceWantsListeningRef.current && !agentSpeakingRef.current) beginListening();
        }, 250);
      },
    });
    voiceSessionRef.current = session;
  }

  function startVoiceSession() {
    if (submitting || voiceSessionActive) return;
    setError("");
    setVoiceInterimCaption("");
    setVoiceStatusMessage(null);
    setVoiceSessionActive(true);
    // Docks the composer out of hero mode so the full chat card is on
    // screen for the session — the same expand that picking "Create image"
    // from the + menu triggers (isHero is false whenever creationModeActive
    // is), rather than a second, different-looking expanded state.
    setCreationModeActive(true);
    voiceWantsListeningRef.current = true;
    // Fresh conversation every session — no leftover half-answered
    // questions from a session that was stopped partway through.
    voiceStepRef.current = "await-prompt";
    voiceDraftRef.current = { prompt: "", type: null, characterId: null };
    lastAgentPhrasingRef.current = null;
    // The agent speaks first, before the person has said anything, so the
    // session opens as a conversation rather than a silent open mic.
    // agentSay opens the microphone itself once it's finished talking —
    // starting to listen here as well would just capture the opening line.
    void agentSay(pickPhrasing(g.voiceAskOpening, null));
  }

  function stopVoiceSession() {
    voiceWantsListeningRef.current = false;
    stopSpeaking();
    voiceSessionRef.current?.stop();
    voiceSessionRef.current = null;
    if (voiceStatusTimeoutRef.current) clearTimeout(voiceStatusTimeoutRef.current);
    if (restartListeningTimeoutRef.current) clearTimeout(restartListeningTimeoutRef.current);
    setVoiceSessionActive(false);
    setVoiceInterimCaption("");
    setVoiceStatusMessage(null);
    setVoiceAgentMessage(null);
  }

  // Resolves when the line has finished playing (not merely when playback
  // started) — the voice agent needs that to know when it's safe to listen
  // again. Resolves rather than rejects on every failure path, since a
  // caller waiting to reopen the microphone must never be left hanging by
  // a missing key, a blocked autoplay, or a decode error.
  async function speak(text: string): Promise<void> {
    try {
      const result = await synthesizeVoice(text);
      if (result.error !== null) {
        // Unlike the autoplay case below, this means voice replies are
        // actually misconfigured (missing OPENAI_API_KEY, feature flag off,
        // etc.) — worth a real error instead of silently doing nothing,
        // which used to look indistinguishable from the AI just not
        // responding at all.
        setError(result.error);
        return;
      }
      // A blob: URL, not data: — the site's CSP refuses data: media, so the
      // old form never played a sample (lib/audio/playable-url.ts).
      const source = playableAudioUrl(result.audioBase64);
      const audio = new Audio(source.url);
      currentAudioRef.current = audio;
      await new Promise<void>((resolve) => {
        let settled = false;
        const finish = () => {
          if (settled) return;
          settled = true;
          source.release();
          resolve();
        };
        speakResolveRef.current = finish;
        audio.addEventListener("ended", finish);
        audio.addEventListener("error", finish);
        // A rejected play() (autoplay policy, no audio device) means "ended"
        // will never fire, so resolve off the rejection instead.
        audio.play().catch(finish);
      });
    } catch {
      // Network/synthesis blew up — the text is still on screen, so the
      // conversation can continue without the audio.
    } finally {
      currentAudioRef.current = null;
      speakResolveRef.current = null;
    }
  }

  function stopSpeaking() {
    const audio = currentAudioRef.current;
    if (audio) {
      audio.pause();
      currentAudioRef.current = null;
    }
    // Pausing doesn't fire "ended", so anything awaiting the line has to be
    // released explicitly or it would wait forever.
    speakResolveRef.current?.();
    speakResolveRef.current = null;
    agentSpeakingRef.current = false;
  }

  // `keepComposerInput` is for the character/type switch below. Starting a
  // fresh THREAD per character is deliberate; throwing away what the person
  // has staged in the composer but not sent yet is not — real report,
  // 2026-08-16: uploading a photo and then picking a character silently
  // deleted the upload, so the only order that worked was character first,
  // photo second, and nothing on screen said so. Attachments are unsent
  // input and survive; anything tied to the OLD character (a photo picked
  // from its gallery, its advanced video frames) still has to go.
  function resetChat(options?: { keepComposerInput?: boolean }) {
    setComposerFolded(false);
    setItems([]);
    setLivePrompt(null);
    setLiveAttachments([]);
    setLiveTimeline([]);
    setLiveResult(null);
    setRevealedCount(0);
    setError("");
    if (!options?.keepComposerInput) setPendingAttachments([]);
    // The engineered prompt was compiled against the character that was
    // selected when it was made, so it's stale either way.
    setEnhanced(null);
    setEnhanceError(null);
    setApprovedPrompt(null);
    setPendingMultiAngle(null);
    setLiveMultiAngle(null);
    // Cinema Studio's panel is staged state exactly like the multi-angle
    // confirm above. Left behind, "New chat" or a character switch kept a
    // stale shot list on screen with a live Render button — planned against
    // a character that is no longer selected.
    setPendingScene(null);
    setScenePlan(null);
    setScenePlanning(false);
    askAbortRef.current?.abort();
    askAbortRef.current = null;
    setLiveAsk(null);
    setAsking(false);
    setSelectedAngles(DEFAULT_ANGLE_IDS);
    clearAdvancedVideo();
    setAnchorPhotoPath(null);
  }

  // The native quick pill's pencil fires this event from OUTSIDE the
  // composer (it's fixed chrome in the app layout, not a child here). Ref
  // indirection so the listener binds once but always calls the latest
  // resetChat; ignored mid-request for the same reason the New chat button
  // is disabled then — clearing the live bubble would orphan the render.
  // The focused flow (operator-approved from a mock, 2026-08-24): on
  // Generate the composer folds to a slim pull-up bar — the freed space goes
  // to the render, which the Stage above now shows at full width anyway.
  const [composerFolded, setComposerFolded] = useState(false);
  // The Stage redesign (operator-chosen A×B merge, 2026-09-01): the docked
  // layout leads with a full-width Darkroom stage showing the newest (or a
  // filmstrip-picked) take, and the chat thread becomes a collapsible
  // "Session transcript" card. stageTakeId pins the stage to one take; null
  // means follow the newest. transcriptOpen starts closed — the stage
  // carries the session — and is forced open by the three moments where the
  // thread is the only place the answer lives: a streaming Ask reply, a
  // failed render (its recovery pills live in the bubble), and arriving
  // from History via ?resume=.
  const [stageTakeId, setStageTakeId] = useState<string | null>(null);
  const [transcriptOpen, setTranscriptOpen] = useState(false);
  // The shape of each take's media, once its pixels have loaded, keyed by
  // URL — the screen's frame is cut to it (Screening Room, below).
  const [stageRatios, setStageRatios] = useState<Record<string, number>>({});
  // How tall the docked composer is right now (it grows with the receipt
  // band and shrinks to a pull-up bar after a send). The screen's media box
  // and filmstrip sit above it, so they follow it: published as --dock-h and
  // measured, since only the composer knows its own height.
  const [dockHeight, setDockHeight] = useState(184);
  // The stage's own size, and which breakpoints the viewport sits past — the
  // Takes strip goes wherever the take comes out bigger (direction B,
  // stripBeside below), and that answer needs the pane, not the viewport:
  // the sidebar and the transcript drawer both take width from it.
  const stagePanelRef = useRef<HTMLDivElement | null>(null);
  const [stagePane, setStagePane] = useState({ w: 0, h: 0, md: false, lg: false });
  useEffect(() => {
    const el = stagePanelRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const read = () => {
      const r = el.getBoundingClientRect();
      const md = window.matchMedia("(min-width: 768px)").matches;
      const lg = window.matchMedia("(min-width: 1024px)").matches;
      setStagePane((prev) =>
        Math.abs(prev.w - r.width) < 1 && Math.abs(prev.h - r.height) < 1 && prev.md === md && prev.lg === lg
          ? prev
          : { w: r.width, h: r.height, md, lg },
      );
    };
    read();
    const ro = new ResizeObserver(read);
    ro.observe(el);
    return () => ro.disconnect();
  }, [isHero]);
  const dockRef = useRef<HTMLDivElement | null>(null);
  // THE SHEET (phones, below md — operator, 2026-09-22: "Its your call, the
  // point of this is to have less clutter and keep it neat and clean"). At
  // rest the composer is a dock above the tab bar: the values line (each
  // value its own one-tap key), the receipt line, the prompt, then + ·
  // DIALOGUE · RENDER. The pull key raises the whole slate as a bottom
  // sheet — the modes, Assistant and the outfit footnote live there.
  // Transient UI state: never persisted, closed by a send, the scrim, the
  // pull key/grabber and Android back. md and up never read it.
  const [sheetOpen, setSheetOpen] = useState(false);
  // The FRAME value's own small sheet (the two real toggles, in words).
  const [frameSheetOpen, setFrameSheetOpen] = useState(false);
  // A folded composer (after a send) is only its pull-up bar — no sheet.
  const sheetShown = sheetOpen && !composerFolded;
  // The lowering slide (180 ms): the sheet keeps its raised layout while it
  // sinks, then settles into the resting dock — so closing moves as
  // visibly as opening instead of snapping (craft audit, 2026-09-22).
  const [sheetClosing, setSheetClosing] = useState(false);
  const sheetCloseTimer = useRef<number | null>(null);
  // The resting dock's height when the sheet rose: the slide covers the
  // whole distance between the two tops, not a token 28 px.
  const sheetRestH = useRef(0);
  const dockForm = () => dockRef.current?.querySelector<HTMLElement>(":scope > form") ?? null;
  const setSheetRise = () => {
    const el = dockRef.current;
    const f = dockForm();
    if (!el || !f) return;
    el.style.setProperty("--sheet-rise", `${Math.max(0, Math.round(f.getBoundingClientRect().height - sheetRestH.current))}px`);
  };
  const openSheet = () => {
    if (sheetCloseTimer.current !== null) window.clearTimeout(sheetCloseTimer.current);
    sheetCloseTimer.current = null;
    if (!sheetClosing) sheetRestH.current = dockForm()?.getBoundingClientRect().height ?? 0;
    setSheetClosing(false);
    setSheetOpen(true);
  };
  const closeSheet = () => {
    if (!sheetOpen) return;
    setFrameSheetOpen(false);
    setSheetOpen(false);
    const still =
      window.matchMedia("(prefers-reduced-motion: reduce)").matches ||
      window.matchMedia("(min-width: 768px)").matches;
    if (still || composerFolded) return;
    setSheetRise();
    setSheetClosing(true);
    if (sheetCloseTimer.current !== null) window.clearTimeout(sheetCloseTimer.current);
    sheetCloseTimer.current = window.setTimeout(() => {
      sheetCloseTimer.current = null;
      setSheetClosing(false);
    }, 180);
  };
  const toggleSheet = () => (sheetOpen ? closeSheet() : openSheet());
  // The raised layout is on screen while open AND while it sinks.
  const sheetRaised = (sheetShown || sheetClosing) && !composerFolded;
  useLayoutEffect(() => {
    if (sheetShown) setSheetRise();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sheetShown]);
  // The grabber answers a swipe as well as a tap: up raises, down lowers.
  const grabStartY = useRef<number | null>(null);
  const grabSwiped = useRef(false);
  useBackCloser(sheetShown, closeSheet);
  useBackCloser(frameSheetOpen, () => setFrameSheetOpen(false));
  // The FRAME sheet closes on any tap outside it, like the other menus.
  useEffect(() => {
    if (!frameSheetOpen) return;
    const onDown = (e: PointerEvent) => {
      if (!(e.target as Element | null)?.closest?.("[data-dock-frame]")) setFrameSheetOpen(false);
    };
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, [frameSheetOpen]);
  // Read by the size observer: the page's bottom room is the RESTING dock's
  // height — a raised sheet covers the stage behind a scrim instead of
  // pushing the page around under it.
  const sheetOpenRef = useRef(false);
  useEffect(() => {
    sheetOpenRef.current = sheetOpen || sheetClosing;
  });
  useEffect(() => {
    const el = dockRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => {
      if (sheetOpenRef.current && !window.matchMedia("(min-width: 768px)").matches) return;
      const h = el.getBoundingClientRect().height;
      if (h > 0) setDockHeight((prev) => (Math.abs(prev - h) < 1 ? prev : h));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  // The keyboard (phones): the app's WebView resizes under the keyboard, so
  // the fixed dock rides it for free. A phone BROWSER overlays it instead
  // (Chrome's default resizes-visual), which would bury the prompt; there
  // the visual viewport says how much of the bottom is covered, and the
  // dock lifts by exactly that (--kb-inset, 0 whenever nothing covers).
  useEffect(() => {
    const vv = window.visualViewport;
    const el = dockRef.current;
    if (!vv || !el) return;
    // The written value, so an unchanged one is not written again: the read
    // side is a forced layout (window.innerHeight) and the write side
    // invalidates style for the whole fixed dock — and in a browser this
    // fires on every swipe that collapses the URL bar, for a value that is
    // almost always the same 0px.
    let written: string | null = null;
    const read = () => {
      const covered = Math.max(0, Math.round(window.innerHeight - vv.height - vv.offsetTop));
      const next = `${covered > 60 ? covered : 0}px`;
      if (next === written) return;
      written = next;
      el.style.setProperty("--kb-inset", next);
    };
    read();
    vv.addEventListener("resize", read);
    vv.addEventListener("scroll", read);
    return () => {
      vv.removeEventListener("resize", read);
      vv.removeEventListener("scroll", read);
    };
  }, []);
  // The transcript's own scroller (a drawer over the screen from md up).
  const transcriptScrollRef = useRef<HTMLDivElement | null>(null);
  // The stage's <video>, so the fullscreen ghost can drive it.
  const stageVideoRef = useRef<HTMLVideoElement>(null);
  // Keyed on the booleans, not the objects, so a streaming answer's token
  // updates don't re-run the effect on every chunk.
  const liveAskActive = liveAsk !== null;
  const liveRenderFailed = liveResult !== null && !liveResult.succeeded;
  useEffect(() => {
    if (liveAskActive) setTranscriptOpen(true);
  }, [liveAskActive]);
  // The page header's "Session transcript" affordance (a server component
  // can't hold this state) — same window-event pattern NEW_CHAT_EVENT uses.
  useEffect(() => {
    const onToggle = () => setTranscriptOpen((v) => !v);
    window.addEventListener("picacho:toggle-transcript", onToggle);
    return () => window.removeEventListener("picacho:toggle-transcript", onToggle);
  }, []);
  useEffect(() => {
    if (liveRenderFailed) setTranscriptOpen(true);
  }, [liveRenderFailed]);
  // The drawer opens on the newest turn, not on the session's first one.
  useEffect(() => {
    if (!transcriptOpen) return;
    const drawer = transcriptScrollRef.current;
    if (drawer) drawer.scrollTop = drawer.scrollHeight;
  }, [transcriptOpen]);

  // "Generate anyway" on a rules-block failure: a one-shot flag consumed by
  // the next submit (adds skip_brand_rules=1 — the server logs the send as
  // rules-suspended), plus a ref to the composer form so the button can
  // resubmit programmatically after restoring the blocked prompt.
  // Bound rules override (Send Receipt P3): holds the EXACT prompt the
  // "Generate anyway" click granted an override for — consumed only by a
  // byte-identical send and cleared either way, so the old boolean one-shot
  // flag's drift (arming whatever send happened to come next) is
  // structurally impossible.
  const skipRulesForPromptRef = useRef<string | null>(null);
  const composerFormRef = useRef<HTMLFormElement | null>(null);
  const resetChatRef = useRef(resetChat);
  const submittingRef = useRef(submitting);
  useEffect(() => {
    resetChatRef.current = resetChat;
    submittingRef.current = submitting;
  });
  useEffect(() => {
    const onNewChat = () => {
      if (!submittingRef.current) resetChatRef.current();
    };
    window.addEventListener(NEW_CHAT_EVENT, onNewChat);
    return () => window.removeEventListener(NEW_CHAT_EVENT, onNewChat);
  }, []);
  // The app bar's Generate lamp → "Generate Video" (2026-09-21): ?type= is
  // read only on mount, so with the composer already on screen the lamp
  // says it directly — same window-event pattern NEW_CHAT_EVENT uses.
  useEffect(() => {
    const onType = (e: Event) => {
      const type = (e as CustomEvent<unknown>).detail;
      if (type === "video" || type === "image") setContentType(type);
    };
    window.addEventListener(CONTENT_TYPE_EVENT, onType);
    return () => window.removeEventListener(CONTENT_TYPE_EVENT, onType);
  }, []);

  function toggleAngle(id: AngleId) {
    setSelectedAngles((prev) => (prev.includes(id) ? prev.filter((a) => a !== id) : [...prev, id]));
  }

  function toggleMultiAngleMode() {
    setMultiAngleMode((prev) => {
      const next = !prev;
      if (next) {
        clearAdvancedVideo();
        setCompanionCharacterIds([]);
        exitSceneMode();
      }
      return next;
    });
  }

  // Cancel puts the person back where they were. Multi-angle's cancel
  // restores the prompt and the attachments it took; the scene panel used to
  // simply drop both, so backing out of Cinema Studio silently ate what you
  // had typed and everything you had uploaded.
  function exitSceneMode() {
    if (pendingScene) {
      setPrompt(pendingScene.prompt);
      setPendingAttachments(
        pendingScene.attachments.map((a) => ({
          id: crypto.randomUUID(),
          name: a.name,
          type: a.type,
          size: a.size,
          status: "ready" as const,
          url: a.url,
          path: a.path,
        })),
      );
    }
    setSceneMode(false);
    setPendingScene(null);
    setScenePlan(null);
    setScenePlanning(false);
  }

  function toggleSceneMode() {
    setSceneMode((prev) => {
      const next = !prev;
      if (next) {
        // clearAdvancedVideo() drops storyboard and multi-reference, so the
        // four advanced modes stay mutually exclusive in BOTH directions —
        // arming a scene over a filled storyboard used to leave the shot list
        // populated while the scene branch won the submit, dead-ending it.
        clearAdvancedVideo();
        setCompanionCharacterIds([]);
        setMultiAngleMode(false);
      } else {
        setPendingScene(null);
        setScenePlan(null);
      }
      return next;
    });
  }

  // Plans the scene. Costs a prompt assist, never a credit — see planScene.
  async function planCurrentScene() {
    if (!pendingScene || !characterId || scenePlanning) return;
    setScenePlanning(true);
    setError("");
    try {
      const fd = new FormData();
      fd.set("prompt", pendingScene.prompt);
      fd.set("character_id", characterId);
      fd.set("video_model_id", videoModelId);
      fd.set("shot_count", String(sceneShotCount));
      // The duration the scene will ACTUALLY render at. Without it the
      // director was briefed at the model's default length while the fan-out
      // rendered at the picked one, so the panel's "Ns total" and its price
      // both described a scene nobody was going to get.
      fd.set("video_duration_seconds", String(videoDurationSeconds));
      const res = await planScene(fd);
      if (res.error) {
        setError(res.error);
        return;
      }
      setScenePlan(res.plan ?? null);
    } finally {
      setScenePlanning(false);
    }
  }

  // Renders the planned scene. Delegates to the multi-angle path rather than
  // duplicating it: the queue-and-poll machinery, the stop handling and the
  // failure recovery are identical, and the only difference is the payload.
  async function confirmScene() {
    if (submitting) return;
    if (!pendingScene || !scenePlan) return;
    if (!characterId) {
      // Guarded here rather than only inside confirmMultiAngle, whose own
      // guard is a bare `return` — deselecting the character while a scene
      // was staged made both panel buttons silent no-ops with nothing on
      // screen explaining why.
      setError(g.pickCharacter);
      return;
    }
    const scene = { plan: scenePlan, pending: pendingScene };
    // State is torn down only AFTER the send is accepted. Clearing first meant
    // a send rejected by the pre-flight fences (aspect bounds, missing
    // reference photo, multi-person on a model that cannot do it) left the
    // panel gone, the plan gone and the typed scene gone — an error message
    // pointing at something the person could no longer see or retry.
    const accepted = await confirmMultiAngle(scene);
    if (accepted) {
      setPendingScene(null);
      setScenePlan(null);
      setSceneMode(false);
    }
  }

  function clearAdvancedVideo() {
    setVideoAdvancedMode("none");
    setAdvancedPanelOpen(false);
    setStoryboardStartPath(null);
    setStoryboardEndPath(null);
    setMultiRefPaths([]);
    setPanelUploads([]);
  }

  // Every model switch funnels through here. The advanced storyboard/
  // multiref staging is Kling 1.6-only (server gate: "Multi-image reference
  // and storyboard need Kling 1.6"), but nothing used to clear it on a model
  // change — the staged frames rode silently in the payload, the receipt
  // claimed they were native, and the server rejected the send.
  function selectVideoModel(id: string) {
    if (id !== "kling" && videoAdvancedMode !== "none") clearAdvancedVideo();
    setVideoModelId(id);
  }

  function openAdvancedVideo(mode: "storyboard" | "multiref") {
    setMultiAngleMode(false);
    exitSceneMode();
    setVideoAdvancedMode(mode);
    setAdvancedPanelOpen(true);
    setCompanionCharacterIds([]);
  }

  // Multi-select for "several DIFFERENT characters in one generation" — the
  // character picker dropdown calls this for every row instead of directly
  // setting characterId once 2+ characters are in play. The first character
  // picked becomes the primary (characterId); anything picked after that
  // becomes a companion. Clicking an already-selected row removes it —
  // removing the primary promotes the next companion (if any) up to primary
  // instead of just clearing everything.
  function toggleCompanionCharacter(id: string) {
    if (!characterId) {
      setCharacterId(id);
      return;
    }
    if (id === characterId) {
      setCharacterId(companionCharacterIds[0] ?? "");
      setCompanionCharacterIds((prev) => prev.slice(1));
      return;
    }
    if (companionCharacterIds.includes(id)) {
      setCompanionCharacterIds((prev) => prev.filter((c) => c !== id));
      return;
    }
    if (companionCharacterIds.length >= 3) return; // up to 4 characters total
    clearAdvancedVideo();
    setMultiAngleMode(false);
    setCompanionCharacterIds((prev) => [...prev, id]);
  }

  function toggleStoryboardPhoto(path: string, slot: "start" | "end") {
    if (slot === "start") {
      setStoryboardStartPath((prev) => (prev === path ? null : path));
    } else {
      setStoryboardEndPath((prev) => (prev === path ? null : path));
    }
  }

  function toggleMultiRefPhoto(path: string) {
    setMultiRefPaths((prev) => {
      if (prev.includes(path)) return prev.filter((p) => p !== path);
      if (prev.length >= 4) return prev;
      return [...prev, path];
    });
  }

  // Uploads a photo straight into the storyboard/multi-reference pool (see
  // advancedPhotoOptions above) — reuses the same chat-attachments upload
  // used for regular message attachments, since a signed url from either one
  // works identically as a fal.ai-fetchable reference. Single-file (not the
  // multi-select handleFilesSelected above) since each click here is "add
  // one more option to pick from," not "attach these to send."
  /**
   * Puts a file in storage and returns the finished attachment record.
   *
   * The BYTES GO STRAIGHT FROM THE BROWSER to Supabase Storage, never through
   * a server action. Vercel rejects any request body over 4.5MB before the
   * function is even invoked, with a raw 413 nothing in the app can catch —
   * so the old path advertised 25MB and silently died a bit over four, which
   * is what the operator hit. Character reference photos have always uploaded
   * this way (character-form.tsx); this brings attachments in line.
   *
   * The server still bookends it: it hands out a path inside the caller's own
   * folder, and afterwards reads the file back out of storage to measure it
   * and judge whether it shows a real person.
   */
  // Server upload errors arrive as machine codes and are spoken here in the
  // person's own language — the raw English prose is only the fallback for
  // a code this build doesn't know (2026-08-31 inspection: "video.mp4 is
  // larger than 25MB." was landing verbatim between Portuguese strings).
  function localizeUploadError(code: UploadErrorCode | undefined, prose: string | null, name: string): string {
    switch (code) {
      case "SESSION_EXPIRED":
        return g.uploadErrSession;
      case "TOO_LARGE":
        return formatMsg(g.uploadErrTooLarge, { name });
      case "RATE_LIMITED":
        return g.uploadErrRate;
      case "UPLOAD_INCOMPLETE":
        return g.uploadErrIncomplete;
      default:
        return prose ?? g.uploadPhotoFailed;
    }
  }

  async function uploadAttachmentFile(
    file: File,
  ): Promise<{ error: string | null; attachment?: ChatAttachment }> {
    const reserve = new FormData();
    reserve.set("name", file.name);
    reserve.set("size", String(file.size));
    const reserved = await reserveChatAttachmentPath(reserve);
    if (reserved.error !== null || !reserved.path) {
      return { error: localizeUploadError(reserved.errorCode, reserved.error, file.name) };
    }

    const { error: uploadError } = await createBrowserSupabase()
      .storage.from("chat-attachments")
      .upload(reserved.path, file, {
        contentType: file.type || "application/octet-stream",
        upsert: false,
      });
    if (uploadError) {
      // The bucket's own file_size_limit surfaces here as a real, catchable
      // error — unlike the platform 413 this replaces.
      return { error: uploadError.message };
    }

    const done = new FormData();
    done.set("path", reserved.path);
    done.set("name", file.name);
    done.set("type", file.type);
    done.set("size", String(file.size));
    const finalized = await finalizeChatAttachment(done);
    if (finalized.error !== null) {
      return { error: localizeUploadError(finalized.errorCode, finalized.error, file.name) };
    }
    return finalized;
  }

  function handlePanelFileSelected(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setPanelUploadBusy(true);
    uploadAttachmentFile(file)
      .then((result) => {
        if (result.error !== null || !result.attachment) {
          setError(result.error ?? g.uploadPhotoFailed);
          return;
        }
        setPanelUploads((prev) => [...prev, { path: result.attachment!.path, url: result.attachment!.url }]);
      })
      .catch(() => {
        setError(formatMsg(g.uploadFailedFile, { name: file.name }));
      })
      .finally(() => setPanelUploadBusy(false));
  }

  function cancelMultiAngle() {
    if (!pendingMultiAngle) return;
    setPrompt(pendingMultiAngle.prompt);
    setPendingAttachments(
      pendingMultiAngle.attachments.map((a) => ({
        id: crypto.randomUUID(),
        name: a.name,
        type: a.type,
        size: a.size,
        status: "ready",
        url: a.url,
        path: a.path,
      })),
    );
    setPendingMultiAngle(null);
    setError("");
  }

  async function confirmMultiAngle(scene?: {
    plan: ScenePlan;
    pending: { prompt: string; attachments: ChatAttachment[] };
  }): Promise<boolean> {
    // A second click while a batch is in flight would mint a fresh group id,
    // which is precisely the thing the server's replayed-group guard keys on
    // — so it would queue and charge a whole second fan-out. The scene panel
    // used to sit on screen with a live Render button for the entire render.
    if (submitting) return false;
    const source = scene ? scene.pending : pendingMultiAngle;
    if (!source || !characterId) return false;
    // A scene's rows are keyed "shot-1".."shot-6"; an angle batch's by angle
    // name. Everything downstream only counts them.
    const sendKeys: string[] = scene
      ? scene.plan.shots.map((_shot, i: number) => `shot-${i + 1}`)
      : selectedAngles;
    if (sendKeys.length === 0) {
      setError(g.pickAngle);
      return false;
    }

    // Multi-angle carries neither dialogue nor continuation, so only the
    // verdicts that actually apply to its payload may block it (a
    // false-positive from an inapplicable rule must never stop a send).
    const planBlock = planBlockError(
      new Set(["REF_ASPECT_OUT_OF_RANGE", "NEEDS_REFERENCE_PHOTO", "MODEL_CANNOT_MULTI_PERSON"]),
    );
    if (planBlock) {
      setError(planBlock);
      return false;
    }

    const { prompt: mPrompt, attachments } = source;
    requestNotificationPermission();
    setSubmitting(true);
    setStopping(false);
    setError("");
    setLiveMultiAngle({ prompt: mPrompt, attachments, angleIds: sendKeys });
    setPendingMultiAngle(null);

    const groupId = crypto.randomUUID();
    activeGenerationRef.current = { kind: "multi", groupId };
    userStoppedRef.current = false;

    const formData = new FormData();
    formData.set("prompt", mPrompt);
    formData.set("character_id", characterId);
    formData.set("angle_group_id", groupId);
    formData.set("video_model_id", videoModelId);
    formData.set("video_duration_seconds", String(videoDurationSeconds));
    if (videoAspectRatio) formData.set("video_aspect_ratio", videoAspectRatio);
    if (videoResolution) formData.set("video_resolution", videoResolution);
    if (scene) {
      // The plan itself. Re-normalised server-side against the resolved
      // model — it travelled through the browser, so the shot count, the
      // preset ids and the durations are all untrusted until then.
      formData.set("scene_plan", JSON.stringify(scene.plan));
    } else {
      selectedAngles.forEach((id) => formData.append("angle", id));
    }
    // Same attachment/anchor-photo priority as the single-generation path
    // above — see the comments there.
    const multiAngleRoles = attachments
      .filter((a) => a.type.startsWith("image/"))
      .map((a) => ({ url: a.url, role: "reference" }));
    if (multiAngleRoles.length > 0) {
      formData.set("attachment_roles", JSON.stringify(multiAngleRoles));
    }
    formData.set("payload_version", "2");
    if (anchorPhotoPath) {
      formData.set("anchor_photo_path", anchorPhotoPath);
    }

    let result;
    try {
      result = await runMultiAngleGeneration(formData);
    } catch (err) {
      const stale = isStaleDeployError(err);
      setError(stale ? g.refreshNeeded : g.submitFailed);
      setPrompt(mPrompt);
      setPendingAttachments(
        attachments.map((a) => ({
          id: crypto.randomUUID(),
          name: a.name,
          type: a.type,
          size: a.size,
          status: "ready",
          url: a.url,
          path: a.path,
        })),
      );
      setLiveMultiAngle(null);
      setSubmitting(false);
      if (stale) reloadForNewDeploy({ delayMs: 1800 });
      return false;
    }

    if (result.error !== null) {
      setError(result.error);
      setPrompt(mPrompt);
      setPendingAttachments(
        attachments.map((a) => ({
          id: crypto.randomUUID(),
          name: a.name,
          type: a.type,
          size: a.size,
          status: "ready",
          url: a.url,
          path: a.path,
        })),
      );
      setLiveMultiAngle(null);
      setSubmitting(false);
      return false;
    }

    // Every angle was queued with fal.ai in parallel and is still rendering.
    // Wait on all of them at once, so total wall time is about one render
    // rather than four in sequence.
    //
    // This is the case that forced the rewrite. Four angles at six to ten
    // minutes each could never fit inside a 300s function, which is why
    // multi-angle had never produced a single finished result.
    let angles = result.angles;
    const hadPending = angles.some((a) => a.pending);
    if (hadPending) {
      setLiveProgress(g.renderingAngles);
      let finishedCount = 0;
      const pendingCount = angles.filter((a) => a.pending).length;

      angles = await Promise.all(
        angles.map(async (angle) => {
          if (!angle.pending) return angle;

          const outcome = await awaitQueuedGeneration(
            angle.id,
            // One shared label, since four angles finish at different times and
            // four competing progress strings would just flicker.
            () =>
              setLiveProgress(
                formatMsg(g.renderingAnglesProgress, { done: finishedCount, total: pendingCount }),
              ),
            () => userStoppedRef.current,
            g.lostTrackOfRender,
          );
          finishedCount += 1;

          if (outcome.state === "cancelled") {
            // The server saw the stop request and cancelled this angle on
            // fal.ai — record it so the shared stop handling below takes
            // over, exactly like the single path does in submitPrompt.
            userStoppedRef.current = true;
          }

          if (outcome.state === "succeeded") {
            let url = outcome.resultUrl;
            if (!url) {
              // "gone" means a webhook/reaper collected it before this poll —
              // re-read the row. An angle ALWAYS has an angle_group_id, so its
              // thread comes back kind:"multi", not "single"; reading only the
              // "single" case here dropped the URL and marked every
              // webhook-collected angle as failed. Pull this angle out of the
              // group by id.
              const saved = await getGenerationThread(angle.id);
              if (saved?.kind === "single") {
                url = saved.resultUrl;
              } else if (saved?.kind === "multi") {
                url = saved.angles.find((a) => a.id === angle.id)?.resultUrl ?? null;
              }
            }
            return { ...angle, pending: false, succeeded: Boolean(url), resultUrl: url };
          }
          return { ...angle, pending: false, succeeded: false, resultUrl: null };
        }),
      );
      setLiveProgress(null);
    }

    // Stopped while the angles were in flight — the same handling the single
    // path has in submitPrompt, which this path was missing entirely: without
    // it, every abandoned angle rendered as a red "couldn't validate" failure
    // card (a stop is not a failure), and the results the provider had
    // already produced were never discarded, so Stop quietly kept — and
    // showed — work the person had thrown away.
    if (userStoppedRef.current) {
      angles.forEach((angle) => void discardStoppedGeneration(angle.id));
      activeGenerationRef.current = null;
      setLiveMultiAngle(null);
      setSubmitting(false);
      setStopping(false);
      setError(g.stoppedByUser);
      return false;
    }

    if (hadPending) {
      // One refresh, now that every angle has settled. Doing this per angle
      // from inside the server action is what aborted the sibling polls.
      // Deliberately after the stop check above — refreshing on the stop
      // path would just resurrect cards for a request the person discarded.
      router.refresh();
    }

    setItems((prev) => [
      ...prev,
      {
        kind: "multi",
        groupId: result.groupId,
        prompt: mPrompt,
        attachments,
        createdAt: new Date().toISOString(),
        angles,
      },
    ]);
    setLiveMultiAngle(null);
    setSubmitting(false);

    // After the bookkeeping above, never before it — notifyIfHidden used to
    // sit ahead of setItems/setSubmitting, and on Android Chrome (where the
    // page-context Notification constructor throws) that killed the rest of
    // this handler: the finished angles never reached the chat and the
    // composer stayed locked on Stop. The notify itself is also try/caught
    // now, but ordering it last means even an unforeseen failure there can
    // no longer cost the person their result.
    const anyAngleSucceeded = angles.some((a) => a.succeeded);
    // The account's own switches (Settings → Notifications) govern this
    // in-tab notification as much as the server's pushes.
    if (anyAngleSucceeded ? notifyRenderReady : notifyRenderFailed) notifyIfHidden(
      anyAngleSucceeded ? g.notifyReadyTitle : g.notifyFailedTitle,
      anyAngleSucceeded
        ? // Attempt copy only when a retry actually happened — see the
          // result-plate rule.
          ((angles[0]?.attempts.length ?? 1) > 1
            ? formatMsg(g.passedOnAttempt, { n: angles[0]?.attempts.length ?? 1 })
            : "")
        : (summarizeFailure(angles[0]?.attempts ?? [], t) ?? g.noPassingResultOne),
    );
    // The send was accepted and has run to completion. confirmScene reads
    // this to decide whether to tear its panel down — a rejected send must
    // leave the shot list on screen so it can be corrected and retried.
    return true;
  }

  function handleFilesSelected(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    e.target.value = "";

    files.forEach((file) => {
      const id = crypto.randomUUID();
      setPendingAttachments((prev) => [
        ...prev,
        { id, name: file.name, type: file.type, size: file.size, status: "uploading" },
      ]);

      uploadAttachmentFile(file)
        .then((result) => {
          setPendingAttachments((prev) =>
            prev.map((a) => {
              if (a.id !== id) return a;
              if (result.error !== null) return { ...a, status: "error", error: result.error };
              return {
                ...a,
                status: "ready",
                url: result.attachment!.url,
                path: result.attachment!.path,
                width: result.attachment!.width,
                height: result.attachment!.height,
                style: result.attachment!.style,
              };
            }),
          );
          if (result.error !== null) setError(result.error);
        })
        .catch(() => {
          // A rejected promise here, rather than the { error } return above,
          // now means something unexpected: a network drop, or storage
          // refusing outright. The case this catch was originally written for
          // — an oversized body killed by the platform before any of our code
          // ran — cannot happen any more, because the bytes no longer travel
          // through a server action at all. Kept regardless: without it the
          // chip sat on its spinner forever with nothing on screen.
          const message = formatMsg(g.uploadFailedFile, { name: file.name });
          setPendingAttachments((prev) =>
            prev.map((a) => (a.id === id ? { ...a, status: "error", error: message } : a)),
          );
          setError(message);
        });
    });
  }

  function removeAttachment(id: string) {
    setPendingAttachments((prev) => {
      const target = prev.find((a) => a.id === id);
      if (target?.status === "ready" && target.path) {
        const formData = new FormData();
        formData.set("path", target.path);
        deleteChatAttachment(formData);
      }
      return prev.filter((a) => a.id !== id);
    });
  }

  // Each character (and each video/image toggle) gets its own fresh chat —
  // unrelated requests shouldn't get glued together into one endless
  // thread. Past generations stay fully reachable via Recent/History/
  // Projects, which is the whole point of having them.
  useEffect(() => {
    resetChat({ keepComposerInput: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [characterId, contentType]);

  // "Continue chat" from History (?character=&type=&resume=<generationId>) —
  // characterId/contentType above are already seeded from these same params
  // via their lazy initial state, so this only has to load the one thread
  // being resumed. Runs once on mount, after the resetChat effect above's
  // own mount-time run (harmless — items is already [] at that point); this
  // itself is async, so its setItems call always lands after every
  // synchronous mount effect, and characterId/contentType never change again
  // on their own afterward to trigger resetChat a second time and wipe it
  // back out.
  //
  // resume carries the SPECIFIC generation id the person clicked "Continue
  // chat" from, not just a "1" flag — each History card is its own separate
  // chat (real incident, 2026-08-07: an earlier version of this instead
  // loaded that character's entire history, silently merging every past
  // chat with that character into one giant thread). getGenerationThread
  // only ever returns that one entry (or, if it was a multi-angle request,
  // that one group), never anything else the character has generated.
  useEffect(() => {
    const resumeId = searchParams.get("resume");
    if (!resumeId) return;
    router.replace("/app/generate", { scroll: false });
    let cancelled = false;
    (async () => {
      const thread = await getGenerationThread(resumeId);
      if (!cancelled && thread) {
        setItems([historyItemToChatItem(thread)]);
        // Arriving from History means "show me that conversation" — the
        // transcript is the point, so it must not sit behind its toggle.
        setTranscriptOpen(true);
      }
    })();
    return () => {
      cancelled = true;
    };
    // Deliberately empty deps — a one-time "arrived from History" action,
    // not something that should re-run if characterId/contentType change
    // later from the user's own in-app picks.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);


  // First-login walkthrough — auto-starts from the startOnboarding prop
  // (only ever true from /app/page.tsx, see its comment) or replayed later
  // via ?tour=1 from the sidebar's "Replay walkthrough" link. TOUR_STEPS
  // itself, and the effect that reveals each step's target, live further
  // down near the render (see the comment there) since they need
  // clearCreationMode/chooseCreationMode's setters, defined above.
  // Not while the cookie banner is up. On a phone the banner, the tab bar and
  // the first balloon all met at the bottom edge at once (2026-09-09). Every
  // way of asking for the tour — the first-login prop, ?tour=1 at mount, and
  // ?tour=1 arriving later from the sidebar's "Replay walkthrough" — goes
  // through requestTour(): it starts at once when consent has been answered,
  // and otherwise parks the request until the banner is, whichever button.
  // Client only: the server has no localStorage and renders the tour as
  // nothing until mounted anyway.
  const consentAnswered = () => typeof window !== "undefined" && getCookieConsent() !== null;
  const [tourActive, setTourActive] = useState(
    () => (startOnboarding === true || searchParams.get("tour") === "1") && consentAnswered(),
  );
  const [tourStepIndex, setTourStepIndex] = useState(0);
  const tourPendingConsentRef = useRef(
    (startOnboarding === true || searchParams.get("tour") === "1") && !consentAnswered(),
  );
  const requestTour = useCallback(() => {
    setTourStepIndex(0);
    if (consentAnswered()) setTourActive(true);
    else tourPendingConsentRef.current = true;
  }, []);
  useEffect(() => {
    const onConsent = () => {
      if (!tourPendingConsentRef.current) return;
      tourPendingConsentRef.current = false;
      setTourActive(true);
    };
    window.addEventListener(COOKIE_CONSENT_EVENT, onConsent);
    return () => window.removeEventListener(COOKIE_CONSENT_EVENT, onConsent);
  }, []);

  // The video tools get their own two-stop tour, shown the first time the
  // composer is in Video mode with a character on hand — where the model
  // picker and the multi-angle toggle actually exist — instead of the main
  // tour flipping the composer into Video behind the person's back to point
  // at them and leaving it there. Seen once per browser; ?tour=video replays.
  const VIDEO_TOUR_KEY = "picacho.videoTour.v1";
  const [videoTourActive, setVideoTourActive] = useState(false);
  const [videoTourStep, setVideoTourStep] = useState(0);
  const videoTourWantedRef = useRef(searchParams.get("tour") === "video");

  // Re-attach to any render that's still queued at the provider.
  //
  // Real incident, 2026-08-10: a multi-angle request queued three Kling jobs
  // successfully and then the browser call that was meant to drive them to
  // completion threw. The renders kept going — and kept being billed — with
  // nothing left watching them, and would have been binned by the stale-job
  // reaper half an hour later despite having finished.
  //
  // The generation itself never depended on this page staying open; only the
  // COLLECTING of it did. This closes that: on load, ask what's still in
  // flight and start polling it again. Also covers the ordinary cases — a
  // reload mid-render, or coming back to a tab that was closed.
  //
  // VISIBLY, since 2026-09-05. The old version was "deliberately quiet" —
  // it polled with the progress thrown away and only router.refresh()ed at
  // the end, which predates the mobile shell: lock the phone mid-render,
  // reopen the app, and the screen was a blank hero composer with no bubble,
  // no Stop and no evidence of the render the person was waiting on — and
  // the finished result landed nowhere on this page. Each in-flight job now
  // gets a resumed turn (see resumedJobs), and a settled one graduates into
  // the real thread through the same loader the ?resume= path uses.
  useEffect(() => {
    (async () => {
      let inFlight: Awaited<ReturnType<typeof listInFlightGenerations>> = [];
      try {
        inFlight = await listInFlightGenerations();
      } catch {
        // Never block the composer over this — it's recovery, not the
        // main path.
        return;
      }
      if (unmountedRef.current || inFlight.length === 0) return;

      await Promise.all(inFlight.map((gen) => watchResumedJob(gen)));

      if (unmountedRef.current) return;
      router.refresh();
    })();
    // Once per mount. Re-running on every render would start duplicate
    // pollers for the same jobs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Watches ONE background render as a visible resumed turn — used both by
  // the mount-time re-attach above and by "Render in background" (a
  // detached foreground send). Adds the card, polls, and on settle
  // graduates the job into the real thread exactly once (a multi-angle
  // group's members all resolve to the same group thread, so dedupe is by
  // thread identity, not job id).
  async function watchResumedJob(gen: { id: string; prompt: string }): Promise<void> {
    setResumedJobs((prev) =>
      prev.some((j) => j.id === gen.id)
        ? prev
        : [...prev, { id: gen.id, prompt: gen.prompt, progress: null, stopping: false }],
    );

    const outcome = await awaitQueuedGeneration(
      gen.id,
      (progress) => {
        if (unmountedRef.current) return;
        setResumedJobs((prev) => prev.map((j) => (j.id === gen.id ? { ...j, progress } : j)));
      },
      () => unmountedRef.current,
      g.lostTrackOfRender,
    );
    if (unmountedRef.current) return;

    if (outcome.state === "cancelled") {
      // The person pressed this card's Stop — the same discard the
      // composer's own stop path runs, so the card just goes away.
      void discardStoppedGeneration(gen.id);
    } else if (outcome.state !== "abandoned") {
      try {
        const thread = await getGenerationThread(gen.id);
        if (!unmountedRef.current && thread) {
          const item = historyItemToChatItem(thread);
          setItems((prev) =>
            prev.some((p) => sameThreadItem(p, item)) ? prev : [...prev, item],
          );
          setTranscriptOpen(true);
        }
      } catch {
        // History still has it — the caller's refresh repaints stats.
      }
    }
    if (!unmountedRef.current) setResumedJobs((prev) => prev.filter((j) => j.id !== gen.id));
  }

  // Watches for ?tour=1 arriving, rather than only reading it once at mount.
  //
  // "Replay walkthrough" in the sidebar is a <Link href="/app/generate?tour=1">,
  // and Next.js can handle it as a client-side navigation: when this component
  // is already mounted it never remounts, so the useState initialiser above
  // never runs again and tourActive stayed false. The only way to replay the
  // tour was a hard refresh, which forces a fresh mount. Reacting to
  // searchParams here makes the link work on the first click.
  //
  // Resetting the step index matters too — without it, replaying after
  // finishing would reopen the tour on its last step.
  useEffect(() => {
    const tour = searchParams.get("tour");
    if (tour !== "1" && tour !== "video") return;
    if (tour === "1") requestTour();
    else videoTourWantedRef.current = true;
    // Strip the param so a later refresh doesn't silently restart the tour —
    // on the SAME page this form is mounted on. This used to replace to a
    // hardcoded "/app", which (now that /app is a dashboard with no
    // GenerateForm) navigated away from the very page the tour runs on and
    // unmounted the tour a frame after it started. Other params (?type=,
    // ?character=) are kept; only tour is consumed.
    const rest = new URLSearchParams(searchParams);
    rest.delete("tour");
    const qs = rest.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  }, [searchParams, router, pathname, requestTour]);

  // The tour's stops, in first-session order. Three things a person needs
  // for a first take (who, what, send), then where the rest lives — pointing
  // only at controls laid out on THIS device: the sidebar links on desktop,
  // the tab bar and the menu button on phones, resolved by findTourAnchor.
  // No stop flips the composer's mode any more; the video controls have
  // their own tour below, shown where they exist.
  const ob = t.onboarding;
  const characterSelectBody = currentCharacter
    ? formatMsg(ob.characterSelectNamedBody, { name: currentCharacter.name })
    : ob.characterSelectBody;
  const allTourSteps: TourStep[] = [
    { targetId: null, title: ob.welcomeTitle, body: ob.welcomeBody },
    { targetId: "tour-character-select", title: ob.characterSelectTitle, body: characterSelectBody },
    { targetId: "tour-prompt", title: ob.promptTitle, body: ob.promptBody },
    { targetId: "tour-send", title: ob.sendTitle, body: ob.sendBody },
    { targetId: "tour-characters", title: ob.charactersTitle, body: ob.charactersBody },
    { targetId: "tour-templates", title: ob.templatesTitle, body: ob.templatesBody },
    { targetId: "tour-community", title: ob.communityTitle, body: ob.communityBody },
    { targetId: "tour-menu", title: ob.menuTitle, body: ob.menuBody },
    { targetId: null, title: ob.doneTitle, body: ob.doneBody },
  ];
  // Filtered once per tour open — a step list that mutated mid-tour would
  // yank the current index out from under the person.
  //
  // THE FIRST-DAY CRASH (React #419, five reports 2026-08-23 → 09-07, root
  // cause found 2026-09-09): this memo runs during render, and for exactly one
  // visitor it ran on the SERVER with tourActive already true — the first
  // composer render after a first character — where `document` does not
  // exist. findTourAnchor answers null without a document, so the server
  // keeps the full list; the tour renders nothing until mounted, so that list
  // never reaches markup, and the client filters at hydration against the
  // server's HTML, which is already in the document.
  const tourSteps = useMemo(
    () =>
      tourActive
        ? allTourSteps.filter((s) => s.targetId === null || findTourAnchor(s.targetId) !== null)
        : allTourSteps,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [tourActive],
  );

  const videoTourSteps: TourStep[] = useMemo(
    () => [
      { targetId: "tour-video-model", title: ob.providersTitle, body: ob.providersBody },
      { targetId: "tour-advanced-toggle", title: ob.multiAngleTitle, body: ob.multiAngleBody },
      { targetId: null, title: ob.videoDoneTitle, body: ob.videoDoneBody },
    ],
    [ob],
  );
  // Start the video tour the first time its two targets are on screen: Video
  // mode, a character on hand, the main tour not running, nothing in flight,
  // not seen before (or ?tour=video). A short delay lets the mode switch
  // finish laying out before the anchors are looked for.
  useEffect(() => {
    if (contentType !== "video" || tourActive || videoTourActive || submitting || characters.length === 0) return;
    let seen = false;
    try {
      seen = window.localStorage.getItem(VIDEO_TOUR_KEY) === "1";
    } catch {
      seen = true;
    }
    if (seen && !videoTourWantedRef.current) return;
    const timer = window.setTimeout(() => {
      if (findTourAnchor("tour-video-model") && findTourAnchor("tour-advanced-toggle")) {
        videoTourWantedRef.current = false;
        setVideoTourActive(true);
      }
    }, 450);
    return () => window.clearTimeout(timer);
  }, [contentType, tourActive, videoTourActive, submitting, characters.length]);

  // Stick-to-bottom (operator, 2026-08-24: the pane jumped on Generate and
  // then fought the reader): the chat follows new content ONLY while the
  // person is already at the bottom. Scrolling up disengages the follow —
  // they stay exactly where they scrolled; returning to (near) the bottom
  // re-engages it. Sending always re-engages: it's their own message.
  const stickToBottomRef = useRef(true);
  useEffect(() => {
    const scroller = document.querySelector<HTMLElement>("[data-app-scroll]");
    if (!scroller) return;
    // Phones (the sheet, 2026-09-22): the page opens on the stage, and the
    // takes revealing on arrival are not "new content" to chase — the
    // follow starts disengaged there and a send (or a real scroll to the
    // end) engages it. md and up keep the old default.
    if (!window.matchMedia("(min-width: 768px)").matches) stickToBottomRef.current = false;
    const onScroll = () => {
      const room = scroller.scrollHeight - scroller.clientHeight;
      const gap = room - scroller.scrollTop;
      // Re-based on the page's own scroll room: on a short page a flat
      // 90 px counted almost any position as "at the bottom".
      stickToBottomRef.current = gap < Math.min(90, Math.max(24, room / 3));
    };
    scroller.addEventListener("scroll", onScroll, { passive: true });
    return () => scroller.removeEventListener("scroll", onScroll);
  }, []);

  // Never on the initial render: a page that loads pre-scrolled hides the
  // stats header (operator, 2026-08-24: "I can't see First try success and
  // Avg. attempts"). The follow starts acting only once content CHANGES —
  // a send, a reveal, a result.
  const followArmedRef = useRef(false);
  useEffect(() => {
    if (!followArmedRef.current) {
      followArmedRef.current = true;
      return;
    }
    if (!stickToBottomRef.current) return;
    // Drive the app's one real scroller directly rather than
    // scrollIntoView, which can also move ANCESTOR scrollables and is what
    // made the pane lurch around the hero→docked layout switch.
    const scroller = document.querySelector<HTMLElement>("[data-app-scroll]");
    if (scroller) scroller.scrollTo({ top: scroller.scrollHeight, behavior: "smooth" });
    else bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
    // From md up the transcript is a drawer with its own scroller, and the
    // page has none to move — follow the newest turn there as well.
    const drawer = transcriptScrollRef.current;
    if (drawer) drawer.scrollTo({ top: drawer.scrollHeight, behavior: "smooth" });
  }, [items.length, revealedCount, livePrompt, liveMultiAngle, liveResult, liveProgress]);

  // Auto-grow the prompt field with its content: two visible lines at rest,
  // up to six lines tall, internal scroll beyond (the 144px cap is exactly
  // six 20px lines of text-sm plus the field's 24px of vertical padding —
  // matched by max-h-36 on the element as the CSS backstop). One visible
  // line was too cramped to read a real prompt back before sending.
  // Measured in JS rather than CSS field-sizing:content because the
  // iOS/Android shell runs in WKWebView, which hasn't shipped field-sizing.
  // Keyed on `prompt` (not onInput) so programmatic fills — dictation,
  // ?prompt= handoffs, saved/enhanced prompts — resize too, and on
  // pendingMultiAngle because the textarea unmounts behind the multi-angle
  // confirm panel and needs re-measuring on the way back.
  useEffect(() => {
    const el = promptTextareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 144)}px`;
  }, [prompt, pendingMultiAngle]);

  // Multi-angle is video-only — switching to Image quietly turns it off
  // (resetChat, triggered by the effect above on contentType change, clears
  // any in-progress confirm panel too).
  useEffect(() => {
    if (contentType !== "video") {
      setMultiAngleMode(false);
      // Cinema Studio is video-only too. Left armed, its button vanished with
      // the video toolbar while the staged panel stayed on screen — and its
      // Render button would still fire a VIDEO fan-out from Image mode.
      setSceneMode(false);
      setPendingScene(null);
      setScenePlan(null);
    }
  }, [contentType]);

  // Typing on the dashboard's landing composer and hitting send arrives here
  // as ?prompt=<text> — unlike ?voice=, this only fills the textarea so the
  // person can review or edit before actually sending it.
  //
  // A Producer card can be opened while the composer is ALREADY on screen
  // (2026-09-25): the lazy initial state that reads ?type/?character/?model/
  // ?seconds only runs on the first mount, so the same link is applied here
  // too — each value only when this account's composer offers it, exactly
  // like the initialisers. The duration is set with its model, so the
  // re-snap effect finds it valid and keeps it.
  useEffect(() => {
    const prefill = searchParams.get("prompt");
    if (!prefill) return;
    const type = searchParams.get("type");
    if (type === "image" || type === "video") setContentType(type);
    const character = searchParams.get("character");
    if (character && characters.some((c) => c.id === character)) setCharacterId(character);
    const linked = videoModels.find((m) => m.id === searchParams.get("model"));
    if (linked) {
      const s = Number(searchParams.get("seconds"));
      setVideoModelId(linked.id);
      setVideoDurationSeconds(linked.durations.some((d) => d.seconds === s) ? s : linked.defaultDurationSeconds);
    }
    router.replace("/app/generate", { scroll: false });
    setPrompt(prefill);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  // Flips cancel_requested on whichever request is currently live — the
  // still-running runGeneration/runMultiAngleGeneration call is what
  // actually notices and stops (see checkCancelled in pipeline.ts), the
  // next time it checks. That means this can't cut off a provider call
  // that's already in flight — there's no cheap way to hard-abort a request
  // already sent to Claude/OpenAI/fal.ai from here — but it does stop the
  // next attempt (or the generate step of the current one, if it hasn't
  // started yet) from ever beginning, which is where almost all the time
  // and cost of a multi-attempt run actually goes.
  // "Render in background" (operator, 2026-09-05: two concurrent renders is
  // enough). Frees the composer for a second send once the current one is
  // QUEUED — liveQueuedId exists only in that window, because pre-queue
  // there is no server-side job for the background watcher to poll. The
  // running submitPrompt loop is told to stand down via detachedIdsRef (its
  // poll returns "abandoned" and its foreground path writes nothing more),
  // and the render continues as a resumed turn with its own Stop, exactly
  // like a reopened-app render. The affordance hides while a background
  // render exists, which is the whole concurrency cap. Fan-outs (scenes,
  // multi-angle) stay exclusive — they are already parallelism.
  function detachLiveRender() {
    if (!liveQueuedId || !submitting || resumedJobs.length > 0) return;
    const id = liveQueuedId;
    const backgroundPrompt = livePrompt ?? "";
    detachedIdsRef.current.add(id);
    activeGenerationRef.current = null;
    setLiveQueuedId(null);
    setLivePrompt(null);
    setLiveAttachments([]);
    setLiveTimeline([]);
    setLiveResult(null);
    setRevealedCount(0);
    setLiveProgress(null);
    setSubmitting(false);
    setStopping(false);
    void watchResumedJob({ id, prompt: backgroundPrompt }).then(() => {
      if (!unmountedRef.current) router.refresh();
    });
  }

  // Stop for a RESUMED render — per job, since several can be re-attached at
  // once, and none of them own activeGenerationRef (that belongs to a send
  // this mount made). The server-side cancel propagates back through the
  // job's own poll loop as a "cancelled" outcome, which removes the card.
  async function stopResumedJob(id: string) {
    setResumedJobs((prev) => prev.map((j) => (j.id === id ? { ...j, stopping: true } : j)));
    try {
      await requestGenerationCancel(id);
    } catch {
      // The poll keeps watching either way; let the button be pressed again.
      setResumedJobs((prev) => prev.map((j) => (j.id === id ? { ...j, stopping: false } : j)));
    }
  }

  async function handleStop() {
    const active = activeGenerationRef.current;
    if (!active || stopping) return;
    setStopping(true);
    // A ref, not the `stopping` state: submitPrompt's own async body
    // captured `stopping` as false when it started and would never see the
    // updated value, so it had no way to know the person had asked to stop
    // by the time its result came back.
    userStoppedRef.current = true;
    if (active.kind === "single") {
      await requestGenerationCancel(active.id);
    } else {
      await requestMultiAngleGenerationCancel(active.groupId);
    }
  }

  async function openSavedPrompts() {
    setSavedOpen(true);
    setPlusMenuOpen(false);
    setSavedLoading(true);
    try {
      const result = await listSavedPrompts();
      setSavedItems(result.prompts);
      if (result.error) setEnhanceError(result.error);
    } catch {
      setEnhanceError(g.submitFailed);
    } finally {
      setSavedLoading(false);
    }
  }

  async function saveCurrentPrompt() {
    if (!enhanced) return;
    try {
      const formData = new FormData();
      formData.set("prompt", enhanced);
      // The sentence this was compiled FROM, so the library can offer it back
      // when the prompt is reused under a different character (see below).
      // Image-written prompts have no source sentence.
      if (enhanceKind === "text") formData.set("source_input", prompt);
      formData.set("character_id", characterId);
      formData.set("content_type", contentType);
      formData.set("source", enhanceKind === "image" ? "from_image" : "enhance");
      const result = await savePrompt(formData);
      if (result.error) {
        setEnhanceError(result.error);
      } else {
        setSavedJustSaved(true);
        if (result.saved) setSavedItems((prev) => [result.saved!, ...prev]);
      }
    } catch {
      setEnhanceError(g.submitFailed);
    }
  }

  // Reusing a saved prompt.
  //
  // A compiled prompt has its character's identity written into it — "long red
  // curls, freckles". Dropping Eva's saved prompt into the composer while
  // Marco is selected would put Eva's hair in Marco's picture, and because the
  // prompt is pre-approved it would run exactly as written, with nothing to
  // catch it. So when the character doesn't match, the ORIGINAL sentence goes
  // in instead (unapproved, so the pipeline compiles it fresh for whoever is
  // selected now) and the panel says why. With no original sentence to fall
  // back on, the compiled text goes in but stays unapproved, so drafting still
  // gets a chance to reconcile it.
  function openSavedPrompt(item: SavedPrompt) {
    const sameCharacter = (item.characterId ?? "") === characterId;
    if (sameCharacter) {
      setPrompt(item.prompt);
      setApprovedPrompt(item.prompt);
      setSavedRecompiledFrom(null);
    } else {
      setPrompt(item.sourceInput || item.prompt);
      setApprovedPrompt(null);
      setSavedRecompiledFrom(
        characters.find((c) => c.id === item.characterId)?.name ?? g.savedNoCharacter,
      );
    }
    setSavedOpen(false);
    setEnhanced(null);
    setEnhanceError(null);
    const formData = new FormData();
    formData.set("id", item.id);
    void touchSavedPrompt(formData);
  }

  async function removeSavedPrompt(id: string) {
    setSavedItems((prev) => prev.filter((p) => p.id !== id));
    const formData = new FormData();
    formData.set("id", id);
    try {
      await deleteSavedPrompt(formData);
    } catch {
      // The row stays; the list refreshes correctly next time it opens.
    }
  }

  async function runEnhance() {
    const text = prompt.trim();
    if (!text || enhancing) return;
    setEnhancing(true);
    setEnhanceError(null);
    setSavedJustSaved(false);
    try {
      const formData = new FormData();
      formData.set("prompt", text);
      formData.set("character_id", characterId);
      formData.set("content_type", contentType);
      const result = await compilePrompt(formData);
      // `=== null` rather than a truthiness check: the failure member's
      // `error` is typed `string`, which includes "", so TS can't narrow the
      // success member out of an `if (result.error)` else-branch.
      if (result.error === null) {
        setEnhanced(result.prompt);
        setEnhanceKind("text");
        setAssistsLeft(result.assistsLeft);
      } else {
        setEnhanceError(result.error);
        setEnhanced(null);
      }
    } catch {
      // A rejected promise means the request never reached the action at
      // all — same handling as the composer's own submit path.
      setEnhanceError(g.submitFailed);
    } finally {
      setEnhancing(false);
    }
  }

  async function runDescribe(mode: "scene" | "standalone") {
    const image = pendingAttachments.find(
      (a) => a.status === "ready" && a.type.startsWith("image/") && a.url,
    );
    if (!image?.url || enhancing) return;
    setEnhancing(true);
    setEnhanceError(null);
    setSavedJustSaved(false);
    try {
      const formData = new FormData();
      formData.set("image_url", image.url);
      formData.set("mode", mode);
      const result = await promptFromImage(formData);
      if (result.error === null) {
        setEnhanced(result.prompt);
        setEnhanceKind("image");
        setDescribedMode(mode);
        setDescribedAttachmentId(image.id);
        setAssistsLeft(result.assistsLeft);
      } else {
        setEnhanceError(result.error);
        setEnhanced(null);
      }
    } catch {
      setEnhanceError(g.submitFailed);
    } finally {
      setEnhancing(false);
    }
  }

  function useEnhancedPrompt() {
    if (!enhanced) return;
    setPrompt(enhanced);
    setApprovedPrompt(enhanced);
    setEnhanced(null);
    setEnhanceError(null);
    // See describedAttachmentId: the photo has done its job at this point,
    // and keeping it would quietly turn it into the generation's reference
    // image.
    if (enhanceKind === "image" && describedAttachmentId) {
      removeAttachment(describedAttachmentId);
      setDescribedAttachmentId(null);
    }
  }

  // ---- Send Receipt plumbing (P0 read-only strip, P1 issues) ------------
  // One snapshot builder feeds the strip, the submit-time soft-block, and
  // (through the same pure module) the server's parity check — the single
  // source of truth the redesign exists to establish.
  function buildSendPlanInput() {
    return {
      contentType,
      modelId: contentType === "video" ? videoModelId : imageModelId,
      character: currentCharacter
        ? {
            name: currentCharacter.name,
            referencePhotoCount: referencePhotos.length,
            hasOutfit: Boolean(currentCharacter.hasOutfit),
            outfitOn: useOutfit,
            photoreal: currentCharacter.photoreal ?? null,
            faceVerified: currentCharacter.faceVerified ?? false,
          }
        : null,
      companionsCount: companionCharacterIds.length,
      attachments: pendingAttachments
        .filter((a) => a.status === "ready")
        .map((a) => ({
          id: a.id,
          isImage: a.type.startsWith("image/"),
          width: a.width,
          height: a.height,
          style: a.style,
          // Attachments stay NEUTRAL references (operator, 2026-08-25) — the
          // prompt says what they are for. Since 2026-08-31 the resolver may
          // promote one to the identity slot when nothing else can supply a
          // face; that is its decision to make, not a role the client asserts.
          role: "reference" as const,
        })),
      anchorPhotoPicked: Boolean(anchorPhotoPath),
      advancedMode: contentType === "video" ? videoAdvancedMode : ("none" as const),
      multiRefCount: multiRefPaths.length,
      storyboardStart: Boolean(storyboardStartPath),
      storyboardEnd: Boolean(storyboardEndPath),
      storyboardShotsActive: storyboardActive,
      continueFromId,
      dialogueText,
      dialogueVoiceAssigned: Boolean(currentCharacter?.voiceId),
      durationSeconds: videoDurationSeconds,
      aspect: videoAspectRatio,
      rulesSkipArmed: skipRulesForPromptRef.current !== null && skipRulesForPromptRef.current === prompt.trim(),
    };
  }

  // A function, not a const: currentVideoModel is declared further down the
  // component, and every caller here runs at event/render time when it's
  // long initialized.
  function sendPlanModelName(): string {
    return contentType === "video" ? (currentVideoModel?.name ?? videoModelId) : g.image;
  }

  // Submit-time soft-block: a blocking issue turns the send click into the
  // same message the strip's red row shows — no fold, no server call, no
  // credits. Deliberately NOT a disabled button (a resolver false-positive
  // must never brick the composer; the server stays the backstop).
  function planBlockError(onlyCodes?: ReadonlySet<string>): string | null {
    const plan = resolveSendPlan(buildSendPlanInput());
    const block = plan.issues.find(
      (i) => i.severity === "block" && (!onlyCodes || onlyCodes.has(i.code)),
    );
    // Images only, and it has to agree with the strip's own predicate
    // (receipt-strip.tsx's hasAttachmentRiding, a slot test over the plan).
    // Counting every attachment meant a PDF or a video could trigger a
    // sentence that talks about "your photo".
    const photoRiding = pendingAttachments.some(
      (a) => a.status === "ready" && a.type.startsWith("image/"),
    );
    return block ? issueMessage(block, g, sendPlanModelName(), photoRiding) : null;
  }

  // One-tap remedies for the strip's issue rows.
  function handlePlanAction(issue: PlanIssue) {
    switch (issue.action) {
      case "switch-photoreal-model": {
        // send-plan only attaches this action when it resolved a target.
        const target = issue.params?.target;
        if (target) selectVideoModel(target);
        return false;
      }
      case "clear-continuation":
        setContinueFromId(null);
        return false;
      case "clear-dialogue":
        setDialogueText("");
        return false;
      case "remove-attachment": {
        const img = pendingAttachments.find(
          (a) => a.status === "ready" && a.type.startsWith("image/"),
        );
        if (img) removeAttachment(img.id);
        return false;
      }
      case "pick-character":
        setComposerFolded(false);
        setCharacterMenuOpen(true);
        return false;
    }
  }

  async function submitPrompt(
    rawPrompt: string,
    opts?: {
      speak?: boolean;
      attachments?: ChatAttachment[];
      // The voice agent decides both of these during its conversation and
      // calls straight through — but setContentType/setCharacterId don't
      // apply until the next render, so this function's own closure would
      // otherwise still be holding whatever was selected beforehand.
      contentTypeOverride?: ContentType;
      characterIdOverride?: string;
    },
  ) {
    const submittedPrompt = rawPrompt.trim();
    const submittedAttachments = opts?.attachments ?? [];
    const effectiveContentType = opts?.contentTypeOverride ?? contentType;
    const effectiveCharacterId = opts?.characterIdOverride ?? characterId;
    if (!submittedPrompt) {
      setError(g.describeFirst);
      return;
    }
    // A character is no longer required here — someone may just want to
    // generate from an uploaded photo, or from the prompt alone, with
    // nothing saved to a character (see runGeneration in actions.ts, which
    // now accepts an empty character_id). Multi-angle mode (handleSubmit)
    // and multi-character mode below still require one, since both are
    // inherently about a saved character's consistency across several shots.
    if (videoAdvancedMode === "storyboard" && !storyboardStartPath) {
      setError(g.storyboardNeedsStart);
      return;
    }
    if (videoAdvancedMode === "multiref" && multiRefPaths.length < 2) {
      setError(g.multiRefNeedsTwo);
      return;
    }
    if (isMultiCharacter && castMemberMissingPhoto) {
      setError(formatMsg(g.multiCharacterNeedsPhoto, { name: castMemberMissingPhoto.name }));
      return;
    }

    // Send Receipt soft-block (P1): the resolver's blocking verdicts stop
    // the send here — before the fold, before the server, before credits —
    // with exactly the message the strip's red row shows.
    const planBlock = planBlockError();
    if (planBlock) {
      setError(planBlock);
      return;
    }

    const shouldSpeak = Boolean(opts?.speak);

    requestNotificationPermission();

    setError("");
    setSubmitting(true);
    setStopping(false);
    // Their own send always re-engages the follow, wherever they'd scrolled.
    stickToBottomRef.current = true;
    // The focused flow: sending folds the composer down to its pull-up bar
    // (and lowers a raised phone sheet with it).
    setComposerFolded(true);
    setSheetOpen(false);
    setFrameSheetOpen(false);
    setLivePrompt(submittedPrompt);
    setLiveAttachments(submittedAttachments);
    setLiveContentType(effectiveContentType);
    setPrompt("");
    setPendingAttachments([]);
    setLiveTimeline([]);
    setLiveResult(null);
    setRevealedCount(0);

    if (shouldSpeak) speak(g.speakWorkingOnIt);

    const generationId = crypto.randomUUID();
    activeGenerationRef.current = { kind: "single", id: generationId };
    userStoppedRef.current = false;

    const formData = new FormData();
    formData.set("generation_id", generationId);
    formData.set("prompt", submittedPrompt);
    if (continueFromId && contentType === "video") {
      formData.set("continue_from_generation_id", continueFromId);
    }
    formData.set("use_outfit", useOutfit ? "1" : "0");
    if (armedPresetIds.length > 0 && cinemaPresetsAvailable) {
      formData.set("cinema_preset_id", armedPresetIds.join(","));
    }
    // Send Receipt P2: the full role list for every ready image attachment.
    // New servers route by this; old servers ignore it and use the legacy
    // anchor field above — role capture and role routing shipped together,
    // so the UI can never promise a role the server won't honor.
    // Every image attachment is a neutral reference (operator decision,
    // 2026-08-25: no classifier, no role badges — the prompt says what the
    // image is for). The exhaustive roles list still guarantees an
    // attachment can never fall through to the legacy face-override field.
    const roleList = submittedAttachments
      .filter((a) => a.type.startsWith("image/"))
      .map((a) => ({ url: a.url, role: "reference" }));
    if (roleList.length > 0) {
      formData.set("attachment_roles", JSON.stringify(roleList));
    }
    // Send Receipt P4: this payload speaks the versioned contract. Old
    // native shells never send this and keep the legacy semantics forever.
    formData.set("payload_version", "2");
    if (storyboardActive) {
      formData.set(
        "storyboard_shots",
        JSON.stringify(storyboardShots.map((s) => ({ prompt: s.prompt.trim(), seconds: s.seconds }))),
      );
    }
    // Approved in Prompt Studio and unedited since: skip the draft step so
    // what the user saw is byte-for-byte what generates.
    if (approvedPrompt && submittedPrompt.trim() === approvedPrompt.trim()) {
      formData.set("prompt_is_final", "1");
    }
    if (videoAdvancedMode === "multiref" && multiRefPaths.length >= 2) {
      formData.set("reference_photo_paths", JSON.stringify(multiRefPaths));
    } else if (videoAdvancedMode === "storyboard" && storyboardStartPath) {
      formData.set("storyboard_start_path", storyboardStartPath);
      if (storyboardEndPath) formData.set("storyboard_end_path", storyboardEndPath);
    } else if (videoAdvancedMode === "none" && companionCharacterIds.length === 0) {
      // An image attached right to this message (via the "+" upload button)
      // is a strong signal the person wants THIS photo used, not the
      // character's saved default — real report, 2026-08-08: a video kept
      // anchoring to the character's default reference photo and ignoring a
      // close-up shot attached alongside the prompt in the same message.
      // The face-override field is no longer sent by this client — identity
      // comes from the character (or the gallery pick below); attachments
      // ride as neutral references in attachment_roles. Old native shells
      // still send the legacy field and keep the old contract server-side.
      if (anchorPhotoPath) {
        // A photo picked from the character's OWN gallery (see the picker
        // above the composer) — a step down from an attachment in priority
        // (that's a fresh, one-off photo for this message), but still ahead
        // of just silently defaulting to the character's first saved photo.
        formData.set("anchor_photo_path", anchorPhotoPath);
      }
    }
    const submittedDialogue = effectiveContentType === "video" ? dialogueText.trim() : "";
    if (submittedDialogue) {
      formData.set("dialogue", submittedDialogue);
    }
    formData.set("character_id", effectiveCharacterId);
    if (companionCharacterIds.length > 0) {
      formData.set("companion_character_ids", JSON.stringify(companionCharacterIds));
    }
    formData.set("content_type", effectiveContentType);
    if (effectiveContentType === "image") {
      // The picked picture lane (2026-09-23). Sent only for an image, and
      // only ever advisory: actions.ts accepts it solely for the lanes the
      // composer offers and pins free accounts to the admin default.
      formData.set("image_model_id", imageModelId);
      formData.set("image_resolution", imageResolution);
      formData.set("image_aspect", imageAspect);
      formData.set("image_quality", imageQuality);
    }
    if (effectiveContentType === "video") {
      formData.set("video_model_id", videoModelId);
      formData.set("video_duration_seconds", String(videoDurationSeconds));
      if (videoAspectRatio) formData.set("video_aspect_ratio", videoAspectRatio);
      if (videoResolution) formData.set("video_resolution", videoResolution);
      // Sent with the provider-policy warning showing: recorded so support can
      // see the person was warned. It no longer affects the refund — that
      // exception was dropped 2026-09-06, since a refusal is turned away at
      // submit and bills nothing (see acknowledgedPolicyWarning in
      // refund-rules.ts, now an audit record only).
      //
      // Resolved HERE from the same pure resolver the strip renders from,
      // rather than read from a value declared further down the component —
      // this file has been bitten by declaration order before, and a flag
      // that decides whether someone is charged is the last place to rely on
      // a closure capturing a binding in time.
      if (
        resolveSendPlan(buildSendPlanInput()).issues.some(
          (i) => i.code === "SEEDANCE25_PHOTOREAL",
        )
      ) {
        formData.set("acknowledge_policy_warning", "1");
      }
    }
    if (skipRulesForPromptRef.current !== null) {
      const boundPrompt = skipRulesForPromptRef.current;
      // One shot, bound: cleared no matter what, applied only when the send
      // is byte-identical to the prompt the override was granted for (the
      // server logs the suspension in the pipeline trace).
      skipRulesForPromptRef.current = null;
      if (boundPrompt === submittedPrompt) {
        formData.set("skip_brand_rules", "1");
      }
    }
    setDialogueText("");

    let result;
    try {
      result = await runGeneration(formData);
    } catch (err) {
      const stale = isStaleDeployError(err);
      const message = stale ? g.refreshNeeded : g.submitFailed;
      setError(message);
      setPrompt(submittedPrompt);
      setDialogueText(submittedDialogue);
      setPendingAttachments(
        submittedAttachments.map((a) => ({
          id: crypto.randomUUID(),
          name: a.name,
          type: a.type,
          size: a.size,
          status: "ready",
          url: a.url,
          path: a.path,
        })),
      );
      setLivePrompt(null);
      setLiveAttachments([]);
      setSubmitting(false);
      // The submit folded the composer; a rejected send must unfold it, or
      // the error AND the restored prompt render inside the hidden area and
      // the whole thing reads as a dead click (operator repro, 2026-08-25:
      // continuation send without a character — "it seemed it glitched and
      // nothing registered" until Pull up to edit).
      setComposerFolded(false);
      if (shouldSpeak) speak(formatMsg(g.speakError, { error: localizeServerText(message, t) }));
      if (stale) reloadForNewDeploy({ delayMs: 1800 });
      return;
    }

    if (result.error !== null) {
      setError(result.error);
      setPrompt(submittedPrompt);
      setDialogueText(submittedDialogue);
      // Give the attachments back to the composer instead of losing them —
      // they already finished uploading, so this just re-shows the chips.
      setPendingAttachments(
        submittedAttachments.map((a) => ({
          id: crypto.randomUUID(),
          name: a.name,
          type: a.type,
          size: a.size,
          status: "ready",
          url: a.url,
          path: a.path,
        })),
      );
      setLivePrompt(null);
      setLiveAttachments([]);
      setSubmitting(false);
      // Same unfold-on-rejection as the network-failure path above.
      setComposerFolded(false);
      // Through the same display-time translator the toast uses — the spoken
      // sentence was localized while the server's words inside it stayed
      // English (the last untranslated voice in the product, 2026-09-05).
      if (shouldSpeak) speak(formatMsg(g.speakError, { error: localizeServerText(result.error, t) }));
      return;
    }

    // Queued rather than finished: the render is sitting with fal.ai and this
    // drives it to completion in short polls instead of one long request.
    // See awaitQueuedGeneration for why that matters.
    let succeeded = result.succeeded;
    let resultUrl = result.resultUrl;
    let queuedFailure: string | null = null;
    let failedAttemptsLog: AttemptLog[] | null = null;

    if (result.pending) {
      setLiveProgress(result.progress ?? null);
      // Queued at the provider — from here on the send can be sent to the
      // background (see detachLiveRender).
      setLiveQueuedId(result.id);
      const outcome = await awaitQueuedGeneration(
        result.id,
        (progress) => {
          if (!detachedIdsRef.current.has(result.id)) setLiveProgress(progress);
        },
        () => userStoppedRef.current || detachedIdsRef.current.has(result.id),
        g.lostTrackOfRender,
      );
      setLiveQueuedId(null);
      // Sent to the background mid-flight: the resumed-turn watcher owns it
      // now — this foreground path must write nothing more (detachLiveRender
      // already cleared every live state and freed the composer).
      if (detachedIdsRef.current.has(result.id)) return;
      setLiveProgress(null);

      if (outcome.state === "succeeded") {
        succeeded = true;
        resultUrl = outcome.resultUrl;
        if (!resultUrl) {
          // It finished on a poll that wasn't this one (another tab, or an
          // overlapping request), so no URL came back here. Read the saved row
          // rather than rendering an empty result.
          const saved = await getGenerationThread(result.id);
          resultUrl = saved?.kind === "single" ? saved.resultUrl : null;
          succeeded = Boolean(resultUrl);
        }
      } else if (outcome.state === "failed") {
        succeeded = false;
        queuedFailure = outcome.error;
        // The poll outcome is a one-liner; the saved row carries the full
        // attempt log — the provider's own words, and the evidence that
        // gates the Generate-anyway / Retry-on-2.0 offers. Display-only
        // enrichment: a fetch failure here must never change the outcome.
        try {
          const saved = await getGenerationThread(result.id);
          if (saved && saved.kind === "single" && Array.isArray(saved.attempts)) {
            failedAttemptsLog = saved.attempts;
          }
        } catch {
          // keep the one-liner
        }
      } else if (outcome.state === "cancelled") {
        // The server saw the stop request and cancelled the job on fal.ai.
        // Fall through to the shared stop handling immediately below.
        userStoppedRef.current = true;
      }
    }

    // Stopped while this was in flight. The provider call couldn't be
    // aborted (see discardStoppedGeneration for why), so a real result may
    // well have come back — throw it away rather than rendering it, which
    // is what made Stop look like it did nothing at all.
    if (userStoppedRef.current) {
      void discardStoppedGeneration(result.id);
      activeGenerationRef.current = null;
      setLivePrompt(null);
      setLiveAttachments([]);
      setLiveTimeline([]);
      setLiveResult(null);
      setRevealedCount(0);
      setSubmitting(false);
      setStopping(false);
      setError(g.stoppedByUser);
      return;
    }

    const items = buildTimeline(result.attempts);
    setLiveTimeline(items);
    setLiveIsLive(isLiveTurn(result.attempts));

    for (let i = 1; i <= items.length; i++) {
      await new Promise((resolve) => setTimeout(resolve, 420));
      setRevealedCount(i);
    }

    // queuedFailure carries the real reason a queued render failed (fal.ai's
    // own error), which summarizeFailure can't know about — the attempt log
    // was written before the job was even submitted.
    const bestAttempts = failedAttemptsLog ?? result.attempts;
    const failureReason = succeeded
      ? null
      : ((failedAttemptsLog ? summarizeFailure(failedAttemptsLog, t) : null) ??
        queuedFailure ??
        summarizeFailure(result.attempts, t));
    setLiveResult({
      id: result.id,
      succeeded,
      resultUrl,
      attempts: bestAttempts.length,
      reason: failureReason,
      finalPrompt: result.finalPrompt,
      attemptsLog: succeeded ? null : bestAttempts,
      prompt: submittedPrompt,
    });

    if (shouldSpeak) {
      speak(
        succeeded
          ? formatMsg(g.speakDone, { n: result.attempts.length })
          : result.attempts.length === 1
            ? g.speakFailedOne
            : formatMsg(g.speakFailedOther, { n: result.attempts.length }),
      );
    }

    setItems((prev) => [
      ...prev,
      {
        kind: "single",
        id: result.id,
        prompt: submittedPrompt,
        contentType: effectiveContentType,
        attempts: result.attempts,
        succeeded,
        finalPrompt: result.finalPrompt,
        resultUrl,
        createdAt: new Date().toISOString(),
        // The identity score the server just computed. Without this, a fresh
        // image showed "unscored" until the thread was reloaded from History
        // — the one moment the number matters most is right after the render
        // (2026-08-31).
        matchScore: result.matchScore ?? null,
        attachments: submittedAttachments,
        characterName: currentCharacter?.name ?? null,
        // Submit-time snapshot for the Takes rail's microlabel — the model/
        // duration the request actually ran with, not wherever the pickers
        // sit by the time this resolves.
        takeMeta:
          effectiveContentType === "video" && selectedVideoModel
            ? {
                modelName: selectedVideoModel.name,
                modelId: selectedVideoModel.id,
                durationSeconds: videoDurationSeconds,
                aspectRatio: videoAspectRatio,
                characterPhotoUrl: currentCharacter?.referencePhotos[0]?.url ?? null,
              }
            : null,
      },
    ]);
    setLivePrompt(null);
    setLiveAttachments([]);
    setLiveTimeline([]);
    setLiveResult(null);
    setRevealedCount(0);
    setSubmitting(false);

    // After ALL the success bookkeeping above, never before it — this used to
    // run ahead of setItems/setSubmitting, and on Android Chrome (where the
    // page-context Notification constructor throws) it killed the rest of the
    // handler: a backgrounded render finished but never reached the chat, and
    // the composer stayed locked on Stop. notifyIfHidden itself is try/caught
    // now too; ordering it last is the second layer of the same fix.
    if (succeeded ? notifyRenderReady : notifyRenderFailed) notifyIfHidden(
      succeeded ? g.notifyReadyTitle : g.notifyFailedTitle,
      succeeded
        ? // Attempt copy only when a retry actually happened — see the
          // result-plate rule.
          (result.attempts.length > 1 ? formatMsg(g.passedOnAttempt, { n: result.attempts.length }) : "")
        : (failureReason ??
            (result.attempts.length === 1 ? g.noPassingResultOne : formatMsg(g.noPassingResultOther, { n: result.attempts.length }))),
    );
  }

  // Says something and shows it in the session card at the same time. TTS
  // is best-effort: if voice replies aren't configured the text is still on
  // screen, so the conversation never silently stalls.
  async function agentSay(message: string) {
    lastAgentPhrasingRef.current = message;
    setVoiceAgentMessage(message);
    setVoiceInterimCaption("");

    // Close the microphone for the whole spoken line. Without this the
    // agent hears itself and answers its own questions — see
    // agentSpeakingRef. stop() also clears the recognizer's onEnd, so this
    // pause can't be mistaken for a silence timeout and auto-restarted.
    agentSpeakingRef.current = true;
    if (restartListeningTimeoutRef.current) clearTimeout(restartListeningTimeoutRef.current);
    voiceSessionRef.current?.stop();
    voiceSessionRef.current = null;

    await speak(message);

    agentSpeakingRef.current = false;
    // The session may have been stopped (or handed off to a generation)
    // while this line was playing — only reopen the mic if it's still
    // wanted. Short delay first: on laptop speakers the tail of the line
    // (and the room's reverb of it) is still audible for a moment after
    // "ended" fires, and reopening instantly can catch it and start the
    // self-answering loop all over again.
    if (restartListeningTimeoutRef.current) clearTimeout(restartListeningTimeoutRef.current);
    restartListeningTimeoutRef.current = setTimeout(() => {
      if (voiceWantsListeningRef.current && !agentSpeakingRef.current) beginListening();
    }, 350);
  }

  // Asks whichever detail is still missing, then confirms. Called with the
  // draft explicitly rather than reading the ref, so the value just
  // captured in this same turn is definitely the one being acted on.
  function askNextVoiceStep(draft: { prompt: string; type: ContentType | null; characterId: string | null }) {
    if (!draft.type) {
      voiceStepRef.current = "await-type";
      void agentSay(pickPhrasing(g.voiceAskType, lastAgentPhrasingRef.current));
      return;
    }
    // Only worth asking when they actually have characters to choose from
    // and haven't already got one selected — otherwise it's a dead question.
    if (!draft.characterId && characters.length > 0) {
      voiceStepRef.current = "await-character";
      void agentSay(pickPhrasing(g.voiceAskCharacter, lastAgentPhrasingRef.current));
      return;
    }

    voiceStepRef.current = "await-confirm";
    const characterName = characters.find((c) => c.id === draft.characterId)?.name ?? null;
    const typeLabel = draft.type === "video" ? g.video.toLowerCase() : g.image.toLowerCase();
    const summary = characterName
      ? formatMsg(g.voiceConfirmWithCharacter, { type: typeLabel, prompt: draft.prompt, name: characterName })
      : formatMsg(g.voiceConfirmPlain, { type: typeLabel, prompt: draft.prompt });
    void agentSay(`${summary} ${pickPhrasing(g.voiceAskConfirm, null)}`);
  }

  // Runs every time the recognizer finishes a sentence. Which question is
  // outstanding decides how the sentence is read — the whole point of the
  // flow is that nothing reaches submitPrompt until the person has heard
  // the request read back and said yes (real incident, 2026-08-10: "Hey"
  // generated a room, because a single utterance went straight to the
  // generator with no confirmation step in between).
  function handleVoiceFinal(text: string) {
    if (!text) return;
    setVoiceInterimCaption("");
    const step = voiceStepRef.current;

    // Navigation / new chat / character switching stay available at any
    // point in the conversation, not just at the start.
    const command = parseVoiceCommand(
      text,
      characters.map((c) => c.name),
    );

    if (command.type === "new-chat") {
      resetChat();
      voiceDraftRef.current = { prompt: "", type: null, characterId: null };
      voiceStepRef.current = "await-prompt";
      setVoiceStatusMessage(g.voiceNewChatStarted);
      clearVoiceStatusSoon();
      void agentSay(pickPhrasing(g.voiceAskOpening, lastAgentPhrasingRef.current));
      return;
    }

    if (command.type === "navigate") {
      stopVoiceSession();
      router.push(command.href);
      return;
    }

    if (command.type === "switch-character") {
      const match = characters.find((c) => c.name.toLowerCase() === command.name.toLowerCase());
      if (match) {
        setCharacterId(match.id);
        setCompanionCharacterIds([]);
        clearAdvancedVideo();
        setMultiAngleMode(false);
        voiceDraftRef.current = { ...voiceDraftRef.current, characterId: match.id };
        setVoiceStatusMessage(formatMsg(g.voiceSwitchedCharacter, { name: match.name }));
        clearVoiceStatusSoon();
        // Mid-conversation this answers the outstanding question, so carry
        // on rather than leaving them waiting on a question already met.
        if (step !== "await-prompt") askNextVoiceStep(voiceDraftRef.current);
        return;
      }
    }

    if (step === "await-prompt") {
      if (isTrivialUtterance(text)) {
        // "Hey" / "hello" / "testing" — no content to build from. Ask
        // again instead of handing it to the generator.
        void agentSay(pickPhrasing(g.voiceAskOpening, lastAgentPhrasingRef.current));
        return;
      }
      const draft = { ...voiceDraftRef.current, prompt: text, characterId: characterId || null };
      voiceDraftRef.current = draft;
      askNextVoiceStep(draft);
      return;
    }

    if (step === "await-type") {
      const type = parseContentType(text);
      if (!type) {
        void agentSay(pickPhrasing(g.voiceAskType, lastAgentPhrasingRef.current));
        return;
      }
      setContentType(type);
      const draft = { ...voiceDraftRef.current, type };
      voiceDraftRef.current = draft;
      askNextVoiceStep(draft);
      return;
    }

    if (step === "await-character") {
      if (isSkipAnswer(text)) {
        const draft = { ...voiceDraftRef.current, characterId: null };
        voiceDraftRef.current = draft;
        voiceStepRef.current = "await-confirm";
        askNextVoiceStep({ ...draft, characterId: null });
        return;
      }
      const name = matchCharacterName(
        text,
        characters.map((c) => c.name),
      );
      const match = name ? characters.find((c) => c.name === name) : undefined;
      if (!match) {
        void agentSay(pickPhrasing(g.voiceAskCharacter, lastAgentPhrasingRef.current));
        return;
      }
      setCharacterId(match.id);
      setCompanionCharacterIds([]);
      const draft = { ...voiceDraftRef.current, characterId: match.id };
      voiceDraftRef.current = draft;
      askNextVoiceStep(draft);
      return;
    }

    // await-confirm
    const answer = parseYesNo(text);
    if (answer === "yes") {
      const draft = voiceDraftRef.current;
      stopVoiceSession();
      // Both passed explicitly: setContentType/setCharacterId above only
      // take effect on the next render, so submitPrompt's own closure would
      // still be holding the values from before this conversation.
      submitPrompt(draft.prompt, {
        speak: true,
        contentTypeOverride: draft.type ?? undefined,
        characterIdOverride: draft.characterId ?? "",
      });
      return;
    }
    if (answer === "no") {
      voiceDraftRef.current = { prompt: "", type: null, characterId: null };
      voiceStepRef.current = "await-prompt";
      void agentSay(pickPhrasing(g.voiceAskOpening, lastAgentPhrasingRef.current));
      return;
    }
    // Neither a clear yes nor no — re-read the request rather than guess.
    askNextVoiceStep(voiceDraftRef.current);
  }

  // No dep array on purpose — this has to re-point at the newest closure on
  // every single render, not just when some listed value changes.
  useEffect(() => {
    handleVoiceFinalRef.current = handleVoiceFinal;
  });

  // A request forwarded here from the sidebar's global voice command arrives
  // as ?voice=<text> (or the special "new chat" marker) — pick it up once,
  // then strip it from the URL so refreshing doesn't replay it. Placed after
  // submitPrompt's declaration (rather than up with the other URL-param
  // effects above) purely so this reference doesn't precede it in source
  // order — submitPrompt is a hoisted function declaration so this was
  // always safe at runtime, but keeping the textual order matching runtime
  // order avoids relying on hoisting to read correctly.
  useEffect(() => {
    const voice = searchParams.get("voice");
    if (!voice) return;
    router.replace("/app/generate", { scroll: false });
    if (voice === "__new_chat__") {
      resetChat();
    } else {
      submitPrompt(voice, { speak: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  // The rules-block override: restore the blocked prompt, arm the one-shot
  // skip flag, and resubmit through the real form path (the timeout lets
  // React flush the prompt state before requestSubmit reads it).
  function generateAnyway(turnPrompt: string) {
    if (submitting) return;
    // Bound intent (Send Receipt P3): the override is granted for THIS
    // exact prompt, not for whatever the composer happens to send next —
    // submitPrompt honors it only on a byte-identical prompt and clears it
    // either way, so the old one-shot flag can never drift to an unrelated
    // send (latent catalog entry: rules-skip drift).
    skipRulesForPromptRef.current = turnPrompt.trim();
    setPrompt(turnPrompt);
    // Unfold first: while collapsed, the <form> is UNMOUNTED (the fold
    // ternary), so requestSubmit on a null ref was a silent dead click —
    // latent catalog entry generate-anyway-dead-while-folded, closed in P1.
    setComposerFolded(false);
    setTimeout(() => composerFormRef.current?.requestSubmit(), 80);
  }

  // The likeness-fence detour: same prompt, same reference, on whichever
  // model the capability table still says accepts photoreal people — never
  // on the one that just refused (likenessRetryTarget in send-plan.ts
  // resolves it, and returns null for any refusal that is not the likeness
  // fence or when no such model is left, in which case no button is
  // rendered and this never runs). The rejected attempt already
  // auto-refunded, so this is a clean fresh charge. The existing
  // model-change effect re-clamps the duration to the target's ceiling
  // before the deferred submit fires.
  function retryOnPhotorealModel(turnPrompt: string, targetModelId: string) {
    if (submitting) return;
    selectVideoModel(targetModelId);
    setPrompt(turnPrompt);
    // Same unfold-before-submit as generateAnyway above — the folded form
    // doesn't exist to receive requestSubmit.
    setComposerFolded(false);
    setTimeout(() => composerFormRef.current?.requestSubmit(), 80);
  }

  // Ask: one question, one streamed answer, no money moves.
  //
  // Server-Sent Events rather than a plain await because the alternative is a
  // spinner that sits still for eight seconds and then dumps a paragraph —
  // the exact failure the composer already learned about with renders. Text
  // arriving a token at a time is how a person knows it is working.
  //
  // Every failure lands as a bubble marked `failed`, never as a silently
  // dropped turn: the question stays on screen with the reason underneath, so
  // nobody is left wondering whether they actually pressed send.
  async function askAgent(question: string, renderablePrompt: string | null = null) {
    const trimmed = question.trim();
    if (!trimmed || asking) return;

    setError("");
    setPrompt("");
    setAsking(true);
    setLiveAsk({ question: trimmed, answer: "" });

    // The last twelve turns of THIS thread, as conversation. Renders are
    // deliberately not folded in here — the server already puts the last
    // fifteen of them, with their scores and failure reasons, into the
    // context it builds from the database. Sending them again as chat turns
    // would double the tokens to say the same thing twice.
    const history = [
      ...items
        .filter((item): item is AskChatItem => item.kind === "ask" && !item.failed)
        .flatMap((item) => [
          { role: "user" as const, content: item.question },
          { role: "assistant" as const, content: item.answer },
        ]),
      { role: "user" as const, content: trimmed },
    ];

    const controller = new AbortController();
    askAbortRef.current = controller;
    let answer = "";
    let failed = false;
    let failure = "";

    try {
      const response = await fetch("/api/agent/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          messages: history,
          mode: agentEffort,
          characterId: characterId || null,
        }),
        signal: controller.signal,
      });

      if (!response.ok || !response.body) {
        // The route answers refusals in JSON with a human sentence (out of
        // allowance, signed out, flag off). Show THAT, not a status code.
        const payload = await response.json().catch(() => null);
        failed = true;
        failure = (payload as { error?: string } | null)?.error ?? g.askFailed;
      } else {
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        // Framing lives in lib/agent/sse.ts so it can be tested against
        // chunk boundaries — a frame split in half by the network is common
        // on a phone and invisible in a click-through.
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const parsed = parseSseFrames(buffer);
          buffer = parsed.rest;
          for (const event of parsed.events) {
            if (event.kind === "error") {
              failed = true;
              failure = event.error;
            } else {
              answer += event.text;
              setLiveAsk({ question: trimmed, answer });
            }
          }
        }
        if (!failed && !answer.trim()) {
          failed = true;
          failure = g.askFailed;
        }
      }
    } catch (err) {
      // An abort is the person pressing Stop or starting a new chat, not a
      // failure — bail without archiving anything.
      if (err instanceof DOMException && err.name === "AbortError") {
        setAsking(false);
        setLiveAsk(null);
        askAbortRef.current = null;
        return;
      }
      failed = true;
      failure = g.askFailed;
    }

    askAbortRef.current = null;
    setItems((prev) => [
      ...prev,
      {
        kind: "ask",
        id: `ask-${Date.now()}`,
        question: trimmed,
        answer: failed ? failure : answer,
        createdAt: new Date().toISOString(),
        // Only offered on an answer that actually arrived — a chip under a
        // failure message would be asking someone to spend a credit on the
        // back of an error.
        ...(failed ? { failed: true } : { renderablePrompt }),
      },
    ]);
    setLiveAsk(null);
    setAsking(false);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();

    // With the assistant on, the message is read before anything else
    // happens — see lib/agent/intent.ts. A question short-circuits every
    // render pre-flight below (attachments, angles, storyboards, the
    // receipt), because none of it applies to a sentence nobody is going to
    // render, and running it would only let a render's rules block a
    // question.
    //
    // With the assistant OFF nothing is classified at all and this whole
    // branch is skipped: off means off.
    // ONE authority for this question — see sendIntent. The button's label,
    // the receipt's silence and this branch must never be able to disagree:
    // when they did, the button promised a render and the submit delivered a
    // chat turn.
    if (sendIntent() === "ask") {
      await askAgent(prompt, classifyMessage(prompt).renderablePrompt);
      return;
    }

    // The assistant is OFF, but this reads like a message TO it (operator,
    // 2026-09-06: two sends 90 seconds apart — "make a continuation prompt"
    // and "**Assistant, make a continuation prompt of this: …" — both queued,
    // both stopped, 8 credits gone on a mode error).
    //
    // "Off means off" governs ROUTING, and still does: nothing is silently
    // diverted to a chat turn. It cannot also govern SPENDING, because the
    // cost of guessing wrong is asymmetric — a refused send costs one tap to
    // correct, a wrong render costs money and cannot be taken back. So this
    // stops and asks rather than rendering or rerouting, and the person
    // decides.
    //
    // Only reachable with the assistant off; with it on the branch above has
    // already taken the message.
    if (!plainRenderIntended()) {
      setModeQuery(prompt);
      return;
    }

    const readyAttachments = pendingAttachments
      .filter((a): a is PendingAttachment & { status: "ready"; url: string; path: string } => a.status === "ready" && Boolean(a.url) && Boolean(a.path))
      .map((a) => ({ path: a.path, url: a.url, name: a.name, type: a.type, size: a.size }));

    // The Kling O3 aspect pre-flight now lives in the Send Receipt resolver
    // (REF_ASPECT_OUT_OF_RANGE, from server-measured upload dimensions) —
    // the old client-side Image() probe is gone. Same protection, one
    // consistent surface, and the strip shows the verdict before the click.

    if (multiAngleMode && contentType === "video") {
      const trimmed = prompt.trim();
      if (!trimmed) {
        setError(g.describeFirst);
        return;
      }
      if (!characterId) {
        setError(g.pickCharacter);
        return;
      }
      setError("");
      setPendingMultiAngle({ prompt: trimmed, attachments: readyAttachments });
      setSelectedAngles(DEFAULT_ANGLE_IDS);
      setPrompt("");
      setPendingAttachments([]);
      return;
    }

    // Cinema Studio: sending arms the PLANNING step, not a render. The
    // director runs first, the shot list and its full price appear, and only
    // then is anything spent.
    if (sceneMode && contentType === "video") {
      const trimmedScene = prompt.trim();
      if (!trimmedScene) {
        setError(g.describeFirst);
        return;
      }
      if (!characterId) {
        setError(g.pickCharacter);
        return;
      }
      setError("");
      setPendingScene({ prompt: trimmedScene, attachments: readyAttachments });
      setScenePlan(null);
      setPrompt("");
      setPendingAttachments([]);
      return;
    }

    if (storyboardActive) {
      if (!storyboardReady) {
        setError(g.storyboardNeedsPrompts);
        return;
      }
      if (!characterId) {
        setError(g.pickCharacter);
        return;
      }
      setError("");
      // The joined text is what History and the chat transcript show — the
      // per-shot payload rides formData separately (see submitPrompt).
      const joined = storyboardShots
        .map((s, i) => `Shot ${i + 1} (${s.seconds}s): ${s.prompt.trim()}`)
        .join("\n");
      await submitPrompt(joined, { attachments: readyAttachments });
      return;
    }

    await submitPrompt(prompt, { attachments: readyAttachments });
  }

  // The plain mic button (VoiceRecorderButton, next to the voice-session
  // icon) is a separate, simpler capability: record → transcribe →
  // append to the text box for review before sending, no auto-submit, no
  // command parsing. The voice-session icon is for hands-free use; this one
  // is for dictating without taking your hands off the keyboard entirely.
  function handleVoiceTranscript(text: string) {
    setPrompt((prev) => (prev ? `${prev} ${text}` : text));
  }

  // Shared between the docked header and the hero composer (see isHero
  // below) so picking a character never depends on which layout happens to
  // be showing. Renders as a clickable dropdown any time there's at least
  // one character — even with just one, nothing is pre-selected (see
  // characterId's initial state above), so this has to stay interactive
  // rather than collapsing into a static "already picked" chip, or there'd
  // be no way to actually select that one character.
  const castSize = (currentCharacter ? 1 : 0) + companionCharacterIds.length;
  // Should an empty character selector be flagged on this model?
  //
  // Everywhere EXCEPT the designated characterless lane. Not keyed on
  // identity.required on purpose (operator, 2026-08-30: "the no tint only
  // applies on Veo, not the rest"): Kling 1.6 can technically render a
  // generic person, but an unpicked character there is still much more
  // likely to be an oversight than an intention — the 2026-08-21 incident
  // this nudge was added for. Veo is the one lane the composer recommends
  // for rendering without a character, so an empty selector there is the
  // intended state rather than a mistake.
  const warnOnEmptyCharacter =
    contentType !== "video" || !CHARACTERLESS_MODEL_IDS.includes(videoModelId);

  // Does this model use exactly ONE identity photo?
  //
  // Decides whether the "which photo should this match?" picker is worth
  // showing at all. Since baseline multi-reference (2026-08-30) the elements
  // and citation lanes receive the character's whole gallery — up to four
  // photos — so asking someone to choose one is asking a question the send
  // no longer has an answer for: all of them ride, and the pick only
  // reorders which leads. On a single-reference lane the choice is real and
  // consequential, because that one photo IS the render's identity (and on
  // the first-frame models, its opening shot).
  //
  //   kling, kling-o3-pro, seedance, seedance-2  max 4  -> no picker
  //   kling-o3, kling-2.5, veo                   max 1  -> picker
  //
  // Images always show it: both image lanes (gpt-image, flux) take exactly
  // one source image, and the composer does not know which of the two is
  // active — an admin setting picks that — so 1 is the right constant here
  // rather than a lookup that could only ever return 1.
  const identityImageSlots =
    contentType === "video"
      ? (MODEL_CAPABILITIES[videoModelId as keyof typeof MODEL_CAPABILITIES]?.identity.max ?? 1)
      : 1;
  const anchorPhotoPickerRelevant = identityImageSlots <= 1;
  // The same condition that used to show the REFERENCE PHOTO row in the
  // composer; since direction B (2026-09-18) it decides whether the
  // character's pill names a photo ("1/6") and opens the photo menu.
  const anchorPickerShown =
    referencePhotos.length > 1 &&
    anchorPhotoPickerRelevant &&
    videoAdvancedMode === "none" &&
    !isMultiCharacter;
  const anchorIndex = Math.max(
    0,
    referencePhotos.findIndex((ph) => ph.path === anchorPhotoPath),
  );
  // The pill wears the photo this take will match, at the size a chip needs.
  const thumbOf = (url: string) =>
    url.startsWith("/api/media/") ? `${url}${url.includes("?") ? "&" : "?"}w=320` : url;

  const characterPicker =
    characters.length > 0 ? (
      <div ref={characterMenuRef} data-tour-id="tour-character-select" className="flex min-w-0">
        <button
          type="button"
          onClick={() => {
            // With several saved photos on a one-photo lane, the cell's first
            // job is WHICH photo (direction B); switching character is one
            // row inside that menu. Otherwise it opens the cast as before.
            if (anchorPickerShown) {
              setCharacterMenuOpen(false);
              setPhotoMenuOpen((v) => !v);
            } else {
              setPhotoMenuOpen(false);
              setCharacterMenuOpen((v) => !v);
            }
          }}
          disabled={locked}
          aria-haspopup={anchorPickerShown ? "dialog" : "listbox"}
          aria-expanded={characterMenuOpen || photoMenuOpen}
          aria-label={
            anchorPickerShown && currentCharacter
              ? formatMsg(g.characterPillPhotoAria, {
                  name: currentCharacter.name ?? "",
                  n: anchorIndex + 1,
                  total: referencePhotos.length,
                })
              : undefined
          }
          className={cn(
            // The CAST cell (slate composer, operator-approved pick
            // 2026-09-22): photo-first, the mono microlabel names the cell,
            // the chevron says it opens. Transparent until open/hover — the
            // slate's hairlines carry the shape.
            "flex min-w-0 items-center gap-2.5 rounded-[10px] px-2 py-1.5 text-left transition-colors disabled:opacity-50 max-sm:gap-1.5 max-sm:px-1",
            characterMenuOpen || photoMenuOpen
              ? "bg-atelier-ink/[0.07]"
              : !characterId && warnOnEmptyCharacter
                ? // Nothing picked yet AND this model cannot render without
                  // one: warm the cell so the empty selector can't be
                  // overlooked (the 2026-08-21 incident: a new user created a
                  // character, never selected it, and sent a character-less
                  // render without realising). Still never auto-picks — that
                  // rule stands.
                  //
                  // Narrowed to requiring models 2026-08-30 (operator: "you
                  // have the option to not select character, so the character
                  // dropdown must not be highlighted in red"). It used to
                  // warm on EVERY model, which made a legitimate choice look
                  // like a mistake: Kling 1.6 and Veo both render a generic
                  // person perfectly well without a character, and Veo is the
                  // lane the composer actively recommends for exactly that.
                  // An alarm that fires when nothing is wrong is an alarm
                  // people learn to ignore on the models where it matters.
                  "bg-atelier-accent/[0.09] hover:bg-atelier-accent/[0.14]"
                : "hover:bg-atelier-ink/[0.05]",
          )}
        >
          {isMultiCharacter ? (
            <span className="flex flex-shrink-0 -space-x-2">
              {[currentCharacter, ...companionCharacters].filter(Boolean).slice(0, 3).map((c, i) => {
                const ph = c!.referencePhotos[0]?.url;
                const t = ph?.startsWith("/api/media/") ? `${ph}${ph.includes("?") ? "&" : "?"}w=320` : ph;
                return t ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img key={c!.id} src={t} alt="" style={{ zIndex: 3 - i }} className="h-8 w-8 rounded-full border-2 border-atelier-paper bg-atelier-ink/10 object-cover" />
                ) : (
                  <span
                    key={c!.id}
                    className="flex h-8 w-8 items-center justify-center rounded-full border-2 border-atelier-paper bg-atelier-ink/10 text-xs font-medium text-atelier-muted"
                    style={{ zIndex: 3 - i }}
                  >
                    {c!.name?.[0]?.toUpperCase() ?? "?"}
                  </span>
                );
              })}
            </span>
          ) : currentCharacter?.referencePhotos[0]?.url ? (
            // The cell wears the character's real face, not an initial —
            // same photo the casting sheet leads with, wearing the lock's
            // corner marks (the identity story, in miniature). When the take
            // matches one of several photos, it wears THAT photo.
            <span className="relative h-9 w-9 flex-shrink-0 sm:h-11 sm:w-11" data-cast-photo>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={thumbOf(
                  (anchorPickerShown ? referencePhotos[anchorIndex]?.url : undefined) ??
                    currentCharacter.referencePhotos[0].url,
                )}
                alt=""
                className="h-full w-full rounded-[9px] bg-atelier-ink/10 object-cover"
              />
              <span
                aria-hidden
                className="lock-frame absolute inset-[3px]"
                style={
                  {
                    "--lock-arm": "10px",
                    "--lock-stroke": "1.5px",
                    "--lock-color": "rgba(224,164,104,0.85)",
                  } as React.CSSProperties
                }
              />
            </span>
          ) : (
            <span className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-[9px] bg-atelier-ink/10 text-xs font-medium text-atelier-muted sm:h-11 sm:w-11">
              {currentCharacter?.name?.[0]?.toUpperCase() ?? "?"}
            </span>
          )}
          <span className="flex min-w-0 flex-col gap-1">
            <span className="flex items-center gap-1 text-[9.5px] font-medium uppercase tracking-widest text-atelier-muted" data-cell-label>
              {g.slateCast}
              <ChevronDownIcon
                className={cn(
                  "h-3 w-3 flex-shrink-0 transition-transform",
                  (characterMenuOpen || photoMenuOpen) && "rotate-180",
                )}
              />
            </span>
            <span className="flex min-w-0 items-center gap-1.5">
              <span
                className={cn(
                  "min-w-0 max-w-[5.5rem] truncate text-[14px] font-medium leading-tight sm:max-w-[9rem]",
                  currentCharacter ? "text-atelier-ink" : "text-atelier-muted",
                )}
                data-cast-name
              >
                {isMultiCharacter
                  ? formatMsg(g.multiCharacterSummary, { name: currentCharacter?.name ?? "", n: companionCharacterIds.length })
                  : (currentCharacter?.name ?? g.selectCharacter)}
              </span>
              {/* The face-lock meter from the approved board — the casting
                  sheet's 5-bar meter in miniature, right on the cell: one
                  ochre bar per saved reference photo (capped at five).
                  Single-cast only; the stacked avatars already carry the
                  multi-cast story. */}
              {currentCharacter && !isMultiCharacter && currentCharacter.referencePhotos.length > 0 && (
                <span className="flex flex-shrink-0 items-center gap-[2.5px]" aria-hidden data-cast-meter>
                  {Array.from({ length: 5 }).map((_, i) => (
                    <span
                      key={i}
                      className={cn(
                        "h-[9px] w-[3px] rounded-[2px]",
                        i < Math.min(5, currentCharacter.referencePhotos.length)
                          ? "bg-atelier-accent"
                          : "bg-atelier-accent/25",
                      )}
                    />
                  ))}
                </span>
              )}
              {anchorPickerShown && (
                <span className="flex-shrink-0 text-[10px] font-medium uppercase tabular-nums tracking-[0.12em] text-atelier-muted">
                  {anchorIndex + 1}/{referencePhotos.length}
                </span>
              )}
            </span>
          </span>
        </button>

        {characterMenuOpen && (
          /* The Casting Sheet (2026-08-28, operator-approved direction 1):
             the text list becomes the cast wall in miniature — portrait
             cards with the photo, name and lock meter, ochre ring + check
             for selection, the dashed New card, and a Manage link. Same
             semantics as before: tap toggles, first pick is primary, cap 4. */
          <div
            role="listbox"
            aria-multiselectable="true"
            className="absolute bottom-full left-0 right-0 z-30 mb-2 rounded-[16px] bg-atelier-surface p-2.5 shadow-[0_0_0_1px_var(--frost-ring),0_24px_48px_-12px_rgba(0,0,0,0.25)] backdrop-blur-xl"
          >
            <div className="flex gap-2.5 overflow-x-auto pb-1">
              {characters.map((c) => {
                const selected = c.id === characterId || companionCharacterIds.includes(c.id);
                const disabled = !selected && castSize >= 4;
                const photo = c.referencePhotos[0]?.url;
                const photoThumb = photo?.startsWith("/api/media/")
                  ? `${photo}${photo.includes("?") ? "&" : "?"}w=320`
                  : photo;
                const lockBars = Math.min(c.referencePhotos.length, 5);
                return (
                  <button
                    key={c.id}
                    type="button"
                    role="option"
                    aria-selected={selected}
                    disabled={disabled}
                    onClick={() => toggleCompanionCharacter(c.id)}
                    className={cn(
                      "group relative w-[92px] flex-shrink-0 overflow-hidden rounded-[13px] text-left transition-shadow disabled:cursor-not-allowed disabled:opacity-40",
                      selected
                        ? "shadow-[0_0_0_2px_var(--color-atelier-accent),0_0_0_5px_var(--color-atelier-accent-soft,rgba(180,90,40,0.15))]"
                        : "shadow-[inset_0_0_0_1px_var(--color-atelier-rule)] hover:shadow-[0_0_0_1.5px_var(--color-atelier-muted)]",
                    )}
                  >
                    {photoThumb ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={photoThumb} alt="" loading="lazy" className="h-[116px] w-full bg-atelier-stage object-cover" />
                    ) : (
                      <span className="flex h-[116px] w-full items-end justify-center bg-gradient-to-br from-atelier-ink/30 to-atelier-ink/70 pb-2 text-3xl font-semibold text-atelier-paper/90">
                        {c.name?.[0]?.toUpperCase() ?? "?"}
                      </span>
                    )}
                    <span className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/85 to-transparent px-2 pb-1.5 pt-6">
                      <span className="block truncate text-[11px] font-semibold text-onmedia">{c.name}</span>
                      <span className="mt-0.5 flex gap-[2.5px]">
                        {Array.from({ length: 5 }).map((_, i) => (
                          <span
                            key={i}
                            className={cn("h-[3px] flex-1 rounded-full", i < lockBars ? "bg-[#e0a468]" : "bg-onmedia/25")}
                          />
                        ))}
                      </span>
                    </span>
                    {selected && (
                      <span className="absolute right-1.5 top-1.5 flex h-[17px] w-[17px] items-center justify-center rounded-full bg-atelier-accent text-atelier-paper">
                        <CheckIcon className="h-2.5 w-2.5" />
                      </span>
                    )}
                    {isMultiCharacter && c.id === characterId && (
                      <span className="absolute left-1.5 top-1.5 rounded-full bg-black/70 px-1.5 py-0.5 text-[9px] font-semibold text-onmedia">
                        {g.primaryCharacter}
                      </span>
                    )}
                  </button>
                );
              })}
              <Link
                href="/app/character/new"
                className="flex h-[116px] w-[92px] flex-shrink-0 flex-col items-center justify-center gap-1 self-start rounded-[13px] border-[1.5px] border-dashed border-atelier-rule text-atelier-muted transition-colors hover:border-atelier-muted hover:text-atelier-ink"
              >
                <span className="text-lg font-medium leading-none">+</span>
                <span className="px-1 text-center text-[10px] leading-tight">{g.castNew}</span>
              </Link>
            </div>
            <div className="mt-1.5 flex items-center justify-between gap-3 border-t border-atelier-rule/70 px-1 pt-2 text-[11px] leading-snug text-atelier-muted/80">
              <span>{castSize >= 4 ? g.multiCharacterCapReached : g.multiCharacterHint}</span>
              <Link href="/app/character" className="flex-shrink-0 font-medium text-atelier-accent hover:underline">
                {g.castManage}
              </Link>
            </div>
          </div>
        )}
        {photoMenuOpen && anchorPickerShown && currentCharacter && (
          /* The photo menu (direction B, 2026-09-18, board "B · Tap Eva's
             pill — the photo menu"): the REFERENCE PHOTO row that used to
             sit inside the composer — and cost the screen above it about
             85 px every time the composer opened — as a small sheet that
             opens UPWARD from the pill, like every sheet in this row. The
             same photos, the same choice, the same hint; one tap picks and
             closes. Switching character is the row at its foot. Its sheet is
             the composer's glass laid over the solid page ground, so the
             receipt and the take behind it never read through the photos. */
          <div
            role="dialog"
            aria-label={formatMsg(g.anchorPhotoMenuTitle, { name: currentCharacter.name ?? "" })}
            className="absolute bottom-full left-0 z-30 mb-2 w-[392px] max-w-[calc(100vw-2rem)] rounded-[16px] px-4 pb-2.5 pt-3.5 shadow-[0_0_0_1px_var(--frost-ring),0_24px_48px_-12px_rgba(0,0,0,0.25)] [background:linear-gradient(var(--color-atelier-surface),var(--color-atelier-surface)),var(--color-atelier-paper)]"
          >
            <div className="flex items-baseline justify-between gap-3">
              <span className="min-w-0 truncate text-[10px] font-medium uppercase tracking-widest text-atelier-muted">
                {formatMsg(g.anchorPhotoMenuTitle, { name: currentCharacter.name ?? "" })}
              </span>
              <span className="flex-shrink-0 text-[10px] font-medium uppercase tabular-nums tracking-widest text-atelier-accent">
                {formatMsg(g.anchorPhotoCount, { n: anchorIndex + 1, total: referencePhotos.length })}
              </span>
            </div>
            <p className="mt-1.5 text-[11px] leading-snug text-atelier-muted/80">{g.anchorPhotoHint}</p>
            {/* min-w-0 + overflow-x-auto + overscroll-x-contain: the
                2026-08-30 page-overflow incident — the strip scrolls INSIDE
                itself, and the flick must not chain to the page. */}
            <div className="mt-2.5 flex min-w-0 gap-2 overflow-x-auto overscroll-x-contain p-[2px]">
              {referencePhotos.map((ph, i) => {
                const selected = i === anchorIndex;
                return (
                  <button
                    key={ph.path}
                    type="button"
                    onClick={() => {
                      setAnchorPhotoPath(ph.path);
                      setPhotoMenuOpen(false);
                    }}
                    aria-pressed={selected}
                    aria-label={formatMsg(g.photoOption, { n: i + 1 })}
                    className={cn(
                      "relative h-[50px] w-[50px] flex-shrink-0 overflow-hidden rounded-[10px] bg-atelier-ink/10 transition-shadow",
                      selected
                        ? "shadow-[0_0_0_2px_var(--color-atelier-ink)]"
                        : "shadow-[inset_0_0_0_1px_var(--color-atelier-rule)] hover:shadow-[0_0_0_1.5px_var(--color-atelier-muted)]",
                    )}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={thumbOf(ph.url)} alt="" className="h-full w-full object-cover" />
                    {selected && (
                      <span className="absolute right-1 top-1 flex h-[15px] w-[15px] items-center justify-center rounded-full bg-atelier-ink text-atelier-paper">
                        <CheckIcon className="h-2 w-2" />
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
            <div className="mt-2.5 border-t border-atelier-rule/70 pt-1.5">
              <button
                type="button"
                onClick={() => {
                  setPhotoMenuOpen(false);
                  setCharacterMenuOpen(true);
                }}
                className="flex w-full items-center justify-between rounded-md px-0.5 py-1 text-[12.5px] text-atelier-ink/85 transition-colors hover:text-atelier-ink"
              >
                {g.switchCharacter}
                <ChevronDownIcon className="h-3.5 w-3.5 -rotate-90 text-atelier-muted" />
              </button>
            </div>
            <span
              aria-hidden
              className="absolute -bottom-[6px] left-6 h-3 w-3 rotate-45 shadow-[1px_1px_0_0_var(--frost-ring)] [background:linear-gradient(var(--color-atelier-surface),var(--color-atelier-surface)),var(--color-atelier-paper)]"
            />
          </div>
        )}
      </div>
    ) : null;

  // Credits at a specific duration for a model — falls back to that model's
  // own default duration if the requested one somehow isn't one of its
  // options (shouldn't happen given the reset effect above, but this is
  // display code, not the source of truth for what actually gets charged —
  // that's re-validated server-side in actions.ts regardless).
  function creditsForDuration(model: VideoModelOption, seconds: number): number {
    const base =
      model.durations.find((d) => d.seconds === seconds)?.creditWeight ??
      model.durations.find((d) => d.seconds === model.defaultDurationSeconds)?.creditWeight ??
      1;
    // A picked resolution changes what a render costs, so every price shown
    // has to reflect it — the chip beside the current model AND each row in
    // the switcher, whose whole job is making the tradeoff visible before
    // picking rather than discovering it against the plan limit later.
    //
    // Keyed on videoResolutionWanted (the standing preference) rather than
    // the derived active value on purpose: the dropdown answers "what would
    // THIS model cost me, given my settings", and picking Veo with 4K armed
    // genuinely will charge the higher weight. Models that do not offer the
    // resolution get null back and keep their base price, so the comparison
    // stays honest in both directions.
    return resolutionCreditWeight(model.id, videoResolutionWanted, seconds) ?? base;
  }

  // Mirrors the server's isFreeTierAccount (actions.ts): these accounts are
  // silently pinned to the free lane, so a credit-shortfall warning is a
  // false alarm for them (the send costs no credits) and the picture ENGINE
  // cell is not offered at all. Defined here rather than beside its other
  // readers below because the pickers, further up the render, need it.
  const freeTierClient = dailyFreeAvailable && purchasedCredits === 0;

  // Video model switcher — only worth showing once there's an actual
  // choice to make. Mirrors the character picker's dropdown pattern. Shows
  // each model's credit cost inline so the tradeoff is visible before
  // picking, not just discovered later against the plan limit.
  const currentVideoModel = videoModels.find((m) => m.id === videoModelId) ?? videoModels[0];
  const currentDurationCredits = currentVideoModel
    ? creditsForDuration(currentVideoModel, videoDurationSeconds)
    : 1;
  const videoModelPicker =
    contentType === "video" && videoModels.length > 1 ? (
      <div ref={videoModelMenuRef} data-tour-id="tour-video-model" className="flex min-w-0 items-stretch">
        <span aria-hidden className="my-2 w-px flex-shrink-0 self-stretch bg-atelier-rule/70" />
        <button
          type="button"
          onClick={() => {
            setModelMenuShowAll(false);
            setDurationMenuOpen(false);
            setVideoModelMenuOpen((v) => !v);
          }}
          disabled={locked}
          aria-haspopup="listbox"
          aria-expanded={videoModelMenuOpen}
          className={cn(
            // The ENGINE cell: mono microlabel over the engine's name. No
            // stock still — a photo that informs nothing goes (operator cut
            // model thumbnails once as "irrelevant"). The price lives in the
            // menu rows, the duration menu and on the Render key.
            "flex min-w-0 flex-col justify-center gap-1 rounded-[10px] px-2.5 py-1.5 text-left transition-colors disabled:opacity-50 max-sm:px-1.5 sm:px-3",
            videoModelMenuOpen ? "bg-atelier-ink/[0.07]" : "hover:bg-atelier-ink/[0.05]",
          )}
        >
          <span className="flex items-center gap-1 text-[9.5px] font-medium uppercase tracking-widest text-atelier-muted" data-cell-label>
            {g.slateEngine}
            <ChevronDownIcon
              className={cn(
                "h-3 w-3 flex-shrink-0 transition-transform",
                videoModelMenuOpen && "rotate-180",
              )}
            />
          </span>
          <span className="min-w-0 truncate text-[13.5px] font-medium leading-tight text-atelier-ink">
            {currentVideoModel?.name}
          </span>
        </button>

        {/* The LENGTH cell and its OWN dropdown (operator, 2026-09-02):
            a small upward menu of the engine's lengths, each priced —
            separate from the engine sheet. */}
        {!storyboardActive && currentVideoModel && currentVideoModel.durations.length > 1 && (
          <div ref={durationMenuRef} className="relative flex flex-shrink-0 items-stretch">
            <span aria-hidden className="my-2 w-px flex-shrink-0 self-stretch bg-atelier-rule/70" />
            <button
              type="button"
              disabled={locked}
              onClick={() => {
                setVideoModelMenuOpen(false);
                setDurationMenuOpen((v) => !v);
              }}
              aria-haspopup="listbox"
              aria-expanded={durationMenuOpen}
              title={currentDurationCredits === 1 ? g.durationCreditsOne : formatMsg(g.durationCredits, { n: currentDurationCredits })}
              className={cn(
                "flex flex-shrink-0 flex-col justify-center gap-1 rounded-[10px] px-2.5 py-1.5 text-left transition-colors disabled:opacity-50 max-sm:px-1.5 sm:px-3",
                durationMenuOpen ? "bg-atelier-ink/[0.07]" : "hover:bg-atelier-ink/[0.05]",
              )}
            >
              <span className="flex items-center gap-1 text-[9.5px] font-medium uppercase tracking-widest text-atelier-muted" data-cell-label>
                {g.slateLength}
                <ChevronDownIcon
                  className={cn(
                    "h-3 w-3 flex-shrink-0 transition-transform",
                    durationMenuOpen && "rotate-180",
                  )}
                />
              </span>
              <span className="font-numeral text-[16px] font-semibold leading-tight tabular-nums text-atelier-ink">
                {formatMsg(g.durationSecondsShort, { n: videoDurationSeconds })}
              </span>
            </button>
            {durationMenuOpen && (
              <div
                role="listbox"
                className="absolute bottom-full left-0 z-30 mb-2 w-max rounded-[12px] bg-atelier-surface p-1.5 shadow-[0_0_0_1px_var(--frost-ring),0_24px_48px_-12px_rgba(0,0,0,0.25)] backdrop-blur-xl"
              >
                {currentVideoModel.durations.map((d) => {
                  const c = creditsForDuration(currentVideoModel, d.seconds);
                  const active = videoDurationSeconds === d.seconds;
                  return (
                    <button
                      key={d.seconds}
                      type="button"
                      role="option"
                      aria-selected={active}
                      onClick={() => {
                        setVideoDurationSeconds(d.seconds);
                        setDurationMenuOpen(false);
                      }}
                      className={cn(
                        "flex w-full items-center gap-3 rounded-[8px] px-2.5 py-1.5 text-left text-sm transition-colors",
                        active
                          ? "bg-atelier-accent/[0.08] text-atelier-ink shadow-[inset_0_0_0_1.5px_var(--color-atelier-accent)]"
                          : "text-atelier-muted hover:bg-atelier-ink/5 hover:text-atelier-ink",
                      )}
                    >
                      <span className="min-w-[2rem] font-medium">
                        {formatMsg(g.durationSecondsShort, { n: d.seconds })}
                      </span>
                      {c > 1 && (
                        <span className="font-numeral text-[11px] tabular-nums text-atelier-accent">
                          {formatMsg(g.creditsShortN, { n: c })}
                        </span>
                      )}
                      {active && <CheckIcon className="ml-auto h-3.5 w-3.5 flex-shrink-0 text-atelier-accent" />}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {videoModelMenuOpen && (
          <div
            role="listbox"
            className="absolute bottom-full left-0 right-0 z-30 mb-2 max-h-[min(420px,55vh)] overflow-y-auto rounded-[14px] bg-atelier-surface p-1.5 shadow-[0_0_0_1px_var(--frost-ring),0_24px_48px_-12px_rgba(0,0,0,0.25)] backdrop-blur-xl"
          >
            {(() => {
              const featuredIds = FEATURED_VIDEO_MODEL_IDS as readonly string[];
              const featured = videoModels.filter((m) => featuredIds.includes(m.id));
              const rest = videoModels.filter((m) => !featuredIds.includes(m.id));
              // Auto-expand when the current selection lives in the long
              // tail — a picker that hides the checkmark teaches nothing.
              const showAll = modelMenuShowAll || featured.length === 0 || rest.some((m) => m.id === videoModelId);
              const shown = showAll ? [...featured, ...rest] : featured;
              // Plain-language jobs for the featured lanes; the long tail
              // keeps each model's own description. One key per id in
              // FEATURED_VIDEO_MODEL_IDS — a missing one renders an empty
              // subtitle rather than falling back to the description.
              const jobs: Record<string, string> = {
                "seedance-2": g.modelJobSeedance2,
                "kling-o3-pro": g.modelJobKlingO3Pro,
                "gemini-omni": g.modelJobGeminiOmni,
                veo: g.modelJobVeo,
              };
              return (
                <>
                  {shown.map((m) => {
              const listCredits = creditsForDuration(m, m.defaultDurationSeconds);
              return (
                <button
                  key={m.id}
                  type="button"
                  role="option"
                  aria-selected={m.id === videoModelId}
                  onClick={() => {
                    selectVideoModel(m.id);
                    setVideoModelMenuOpen(false);
                  }}
                  className={cn(
                    "flex w-full items-center gap-2.5 rounded-[12px] px-2 py-1.5 text-left transition-colors",
                    m.id === videoModelId
                      ? "bg-atelier-accent/[0.08] text-atelier-ink shadow-[inset_0_0_0_1.5px_var(--color-atelier-accent)]"
                      : "text-atelier-muted hover:bg-atelier-ink/5 hover:text-atelier-ink",
                  )}
                >
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-2 text-sm font-medium">
                      <span className="min-w-0 flex-1 truncate">{m.name}</span>
                      {listCredits > 1 && (
                        <span className="flex-shrink-0 rounded-full bg-atelier-accent/10 px-2 py-0.5 font-numeral text-[11px] font-medium tabular-nums text-atelier-accent">
                          {formatMsg(g.creditsEach, { n: listCredits })}
                        </span>
                      )}
                      {m.id === videoModelId && <CheckIcon className="h-3.5 w-3.5 flex-shrink-0 text-atelier-accent" />}
                    </span>
                    <span className="block truncate text-xs text-atelier-muted">{jobs[m.id] ?? m.description}</span>
                  </span>
                </button>
              );
            })}
                  {!showAll && rest.length > 0 && (
                    <button
                      type="button"
                      onClick={() => setModelMenuShowAll(true)}
                      className="mt-1 flex w-full items-center gap-1.5 rounded-control border-t border-atelier-rule/70 px-2.5 py-2 text-left text-xs text-atelier-muted transition-colors hover:bg-atelier-ink/5 hover:text-atelier-ink"
                    >
                      <ChevronDownIcon className="h-3 w-3 flex-shrink-0" />
                      {formatMsg(g.moreModels, { n: rest.length })}
                    </button>
                  )}
                </>
              );
            })()}
          </div>
        )}
      </div>
    ) : null;

  // The same ENGINE cell, for a picture (2026-09-23, the operator: "Make it
  // an option for the user to select. Not for free tier.").
  //
  // One cell, two catalogues — rather than a second control beside it. The
  // slate has one place that answers "what renders this", and a person
  // switching between Video and Image should find the engine in the same
  // spot both times.
  //
  // FREE ACCOUNTS DO NOT GET IT. Their sends are pinned to the admin default
  // server-side (actions.ts), so a picker would be a control that changes
  // nothing — and the free notice under the composer already names the lane.
  // The upsell version of this (a locked row that says "needs a plan") is a
  // deliberate later call, not an accident: it needs its own copy in four
  // languages to be worth showing.
  const imageLanes = selectableImageModels();
  const currentImageModel = imageLanes.find((m) => m.id === imageModelId);
  const imageModelPicker =
    contentType === "image" && !freeTierClient && imageLanes.length > 1 ? (
      <div ref={imageModelMenuRef} className="flex min-w-0 items-stretch">
        <span aria-hidden className="my-2 w-px flex-shrink-0 self-stretch bg-atelier-rule/70" />
        <button
          type="button"
          onClick={() => setImageModelMenuOpen((v) => !v)}
          disabled={locked}
          aria-haspopup="listbox"
          aria-expanded={imageModelMenuOpen}
          className={cn(
            "flex min-w-0 flex-col justify-center gap-1 rounded-[10px] px-2.5 py-1.5 text-left transition-colors disabled:opacity-50 max-sm:px-1.5 sm:px-3",
            imageModelMenuOpen ? "bg-atelier-ink/[0.07]" : "hover:bg-atelier-ink/[0.05]",
          )}
        >
          <span className="flex items-center gap-1 text-[9.5px] font-medium uppercase tracking-widest text-atelier-muted" data-cell-label>
            {g.slateEngine}
            <ChevronDownIcon
              className={cn("h-3 w-3 flex-shrink-0 transition-transform", imageModelMenuOpen && "rotate-180")}
            />
          </span>
          <span className="min-w-0 truncate text-[13.5px] font-medium leading-tight text-atelier-ink">
            {/* An admin default outside the offered lanes (Flux) still has to
                read truthfully, so fall back to the catalogue's own name
                rather than to the first row. */}
            {currentImageModel?.name ?? getImageModel(imageModelId).name}
          </span>
        </button>

        {imageModelMenuOpen && (
          <div
            role="listbox"
            className="absolute bottom-full left-0 right-0 z-30 mb-2 max-h-[min(420px,55vh)] overflow-y-auto rounded-[14px] bg-atelier-surface p-1.5 shadow-[0_0_0_1px_var(--frost-ring),0_24px_48px_-12px_rgba(0,0,0,0.25)] backdrop-blur-xl"
          >
            {imageLanes.map((m) => {
              // One key per id in SELECTABLE_IMAGE_MODEL_IDS, all four
              // locales — image-lane.test.ts fails the build on a missing
              // one, because an absent key renders an empty subtitle in that
              // language only and survives every English-language check.
              const jobs: Record<string, string> = {
                "gpt-image": g.imageModelJobGptImage,
                gemini: g.imageModelJobNanoBananaPro,
              };
              return (
                <button
                  key={m.id}
                  type="button"
                  role="option"
                  aria-selected={m.id === imageModelId}
                  onClick={() => {
                    setImageModelId(m.id);
                    setImageModelMenuOpen(false);
                  }}
                  className={cn(
                    "flex w-full items-center gap-2.5 rounded-[12px] px-2 py-1.5 text-left transition-colors",
                    m.id === imageModelId
                      ? "bg-atelier-accent/[0.08] text-atelier-ink shadow-[inset_0_0_0_1.5px_var(--color-atelier-accent)]"
                      : "text-atelier-muted hover:bg-atelier-ink/5 hover:text-atelier-ink",
                  )}
                >
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-2 text-sm font-medium">
                      <span className="min-w-0 flex-1 truncate">{m.name}</span>
                      {/* No price chip: an image is one credit on every lane
                          (quote.ts), so a chip here would invent a
                          difference the bill does not have. */}
                      {m.id === imageModelId && <CheckIcon className="h-3.5 w-3.5 flex-shrink-0 text-atelier-accent" />}
                    </span>
                    <span className="block truncate text-xs text-atelier-muted">{jobs[m.id] ?? m.description}</span>
                  </span>
                </button>
              );
            })}
          </div>
        )}
      </div>
    ) : null;

  // SIZE and FRAME, beside the picture's ENGINE (2026-09-23, the operator:
  // "Add 4k capabilities to gemini plus aspect ratio and any other features
  // they can offer").
  //
  // Both are drawn from the LANE's own offers, never a fixed list: GPT Image
  // sells one size band and three shapes, Nano Banana Pro sells three bands
  // and ten shapes. A cell with one row to pick is not a choice, so each
  // hides itself rather than offering a menu that cannot change anything —
  // which is why GPT shows a FRAME cell and no SIZE cell.
  //
  // Free accounts get neither, for the same reason they get no ENGINE cell:
  // they are pinned server-side to the default band and the square, and 4K
  // is the first picture in this product that costs two credits.
  const imageBandOffers = imageResolutionOffers(imageModelId);
  const imageShapeOffers = imageAspectOffers(imageModelId);
  const imageSizePicker =
    contentType === "image" && !freeTierClient && imageBandOffers.length > 1 ? (
      <SlateMenuCell
        testId="image-size"
        label={g.slateSize}
        value={imageResolution}
        open={imageSizeMenuOpen}
        onToggle={() => setImageSizeMenuOpen((v) => !v)}
        onClose={() => setImageSizeMenuOpen(false)}
        disabled={locked}
        selected={imageResolution}
        onPick={(id) => setImageResolution(id as ImageResolution)}
        menuRef={imageSizeMenuRef}
        options={imageBandOffers.map((o) => ({
          id: o.value,
          name: o.value,
          // Locale-neutral on purpose: the long edge in pixels needs no
          // translation, and ten invented adjectives in four languages would.
          sub: o.value === "1K" ? "1024 px" : o.value === "2K" ? "2048 px" : "4096 px",
          credits: o.creditWeight,
          creditsLabel: formatMsg(g.creditsEach, { n: o.creditWeight }),
        }))}
      />
    ) : null;
  const imageFramePicker =
    contentType === "image" && !freeTierClient && imageShapeOffers.length > 1 ? (
      <SlateMenuCell
        testId="image-frame"
        label={g.slateFrame}
        value={imageAspect}
        open={imageFrameMenuOpen}
        onToggle={() => setImageFrameMenuOpen((v) => !v)}
        onClose={() => setImageFrameMenuOpen(false)}
        disabled={locked}
        selected={imageAspect}
        onPick={(id) => setImageAspect(id as ImageAspect)}
        menuRef={imageFrameMenuRef}
        // No subtitle: a ratio reads the same in every language, and naming
        // ten of them would be forty strings that say what "16:9" already does.
        options={imageShapeOffers.map((a) => ({ id: a, name: a }))}
      />
    ) : null;

  // QUALITY — how hard the model works (2026-09-24, the operator: "Give the
  // user the option to chose from High to max. Only for paid subscribers").
  //
  // Only where the lane HAS the control: GPT Image 2.5's own enum. fal's
  // Nano Banana Pro endpoint takes no quality parameter, so that lane shows
  // no cell rather than one that changes nothing. Free accounts see none of
  // it — the tiers above `high` are the paid ones, and the server pins them
  // to `high` whatever the form sends.
  const imageQualityTiers = imageQualityOffers(imageModelId);
  const imageQualityPicker =
    contentType === "image" && !freeTierClient && imageQualityTiers.length > 1 ? (
      <SlateMenuCell
        testId="image-quality"
        label={g.slateQuality}
        value={g[`imageQuality_${imageQuality}` as keyof typeof g] as string}
        open={imageQualityMenuOpen}
        onToggle={() => setImageQualityMenuOpen((v) => !v)}
        onClose={() => setImageQualityMenuOpen(false)}
        disabled={locked}
        selected={imageQuality}
        onPick={(id) => setImageQuality(id as ImageQuality)}
        menuRef={imageQualityMenuRef}
        options={imageQualityTiers.map((o) => ({
          id: o.value,
          name: g[`imageQuality_${o.value}` as keyof typeof g] as string,
          credits: o.creditWeight,
          creditsLabel: formatMsg(g.creditsEach, { n: o.creditWeight }),
        }))}
      />
    ) : null;


  // One resolve per render, shared by the slate's receipt cells and the
  // issue rows (2026-08-26 declutter; slate geometry 2026-09-22 — same
  // resolver, same strings, drawn as cells instead of a band).
  const sendPlanNow = resolveSendPlan(buildSendPlanInput());
  const receiptParts = planReceiptParts(sendPlanNow, g, {
    dialogueNote:
      contentType === "video" && dialogueText.trim().length > 0
        ? formatMsg(g.dialogueCreditNote, {
            n: getDialogueCreditWeight(videoDurationSeconds),
          })
        : null,
    facePhotoText: anchorPickerShown
      ? formatMsg(g.receiptFacePhoto, {
          n: anchorIndex + 1,
          total: referencePhotos.length,
        })
      : null,
  });
  // FACE and OUTFIT get cells of their own on the slate; everything rarer
  // (cast, frames, storyboard, continuation, scene, prop, reference, rules
  // off, dropped-attachment notes — and the dialogue surcharge, which only
  // exists once a line is typed) renders as mono statements in a wrap line
  // under the row.
  const facePart = receiptParts.find((p) => p.slot === "identity") ?? null;
  const outfitPart = receiptParts.find((p) => p.slot === "outfit") ?? null;
  const extraParts = receiptParts.filter((p) => p !== facePart && p !== outfitPart);
  // The Outfit toggle chip's own conditions, unchanged from the chip row it
  // replaces (2026-08-24) — the cell stays pressable with the same state.
  const outfitChipAvailable = Boolean(
    currentCharacter?.hasOutfit && companionCharacterIds.length === 0 && !storyboardActive,
  );
  const outfitNativeHere =
    contentType === "image" ||
    (videoAdvancedMode === "none" && (videoModelId === "seedance" || videoModelId === "seedance-2"));
  const outfitCellShown = contentType === "video" && (outfitChipAvailable || outfitPart !== null);
  // The asterisk footnote appears only when the engine can't take outfit
  // photos — the honest per-model caption, same strings as the chip's note.
  const outfitFootnote =
    contentType === "video" && outfitChipAvailable && useOutfit && !outfitNativeHere
      ? g.outfitDescribeNote
      : null;
  const outfitCellValue = outfitPart
    ? outfitPart.value
    : useOutfit && outfitChipAvailable
      ? outfitNativeHere
        ? g.receiptAttached
        : g.receiptDescribed
      : g.receiptUnused;

  // Is the next send going to be ANSWERED rather than rendered? Resolved
  // once per render and shared, rather than re-classifying at each call site.
  const willAsk = sendIntent() === "ask";
  // The phone dock's lit chips — every armed state the raised sheet holds,
  // worded with the same labels its controls wear.
  const presetName = (id: string) => (g.cinemaPresetLabels as Record<string, string>)[id] ?? id;
  const litChips: { id: string; label: string }[] = [
    ...(contentType === "video"
      ? [
          multiAngleMode && {
            id: "angles",
            label: selectedAngles.length > 1 ? `${g.multiAngleLabel} · ${selectedAngles.length}` : g.multiAngleLabel,
          },
          storyboardActive && { id: "storyboard", label: g.storyboardPillLabel },
          sceneMode && { id: "cinema", label: g.cinemaLabel },
          videoAdvancedMode !== "none" && { id: "frames", label: g.framesPillLabel },
          cinemaPresetsAvailable &&
            cinemaPresetIds.move && { id: "move", label: `${g.presetTabCamera} · ${presetName(cinemaPresetIds.move)}` },
          cinemaPresetsAvailable &&
            cinemaPresetIds.look && { id: "look", label: `${g.presetTabLight} · ${presetName(cinemaPresetIds.look)}` },
          // A picked resolution changes the price on the key, so it never
          // hides in the lowered sheet (verifier, 2026-09-22: "RENDER 18
          // credits" with no 4K in sight). Same extra as the sheet's toggle.
          videoResolution !== null && {
            id: "res",
            label: (() => {
              const total = resolutionCreditWeight(videoModelId, videoResolution, videoDurationSeconds);
              const extra = total === null ? 0 : Math.max(0, total - baseDurationCredits);
              return extra > 0
                ? `${videoResolution.toUpperCase()} · +${extra}`
                : videoResolution.toUpperCase();
            })(),
          },
        ]
      : []),
    chatAgentEnabled &&
      assistantOn && {
        id: "assistant",
        label: agentEffort === "smarter" ? `${g.assistant} · ${g.effortSmarter}` : g.assistant,
      },
  ].filter((c): c is { id: string; label: string } => Boolean(c));

  // THE ONE-VOICE RULE, EXTENDED (operator-reported, 2026-08-31: with the
  // assistant on, typing a question at Kling popped "pick a character").
  //
  // The whole render pre-flight — the Send Receipt, the blocking fences, the
  // credit warnings — exists to describe what a SEND is about to do. When
  // the assistant is on and what you have typed reads as a question, the
  // send is not a render, so every one of those has stopped being true.
  // Demanding a character for a sentence nobody is going to render is the
  // composer arguing with itself: the send button has already turned into an
  // ochre spark saying "this will be answered", while the strip underneath
  // insists you fix a render you never asked for.
  //
  // This file already had the principle, one line down — "while a red fence
  // is on screen, the credit banners stay quiet ('you can't run this'
  // already owns the moment)". Same idea: while the composer is about to
  // answer, the render fences stay quiet.
  //
  // Note this gates on the LIVE reading, not on the switch: with the
  // assistant on and a shot in the box, the receipt behaves exactly as it
  // always has, character requirement and all. An empty box still reads as
  // "render", so the baseline receipt keeps greeting you unchanged.
  const receiptEngaged =
    !willAsk &&
    (prompt.trim().length > 0 || pendingAttachments.length > 0 || Boolean(characterId));
  // Image mode carries no baseline line at all (operator: not relevant
  // there) — the strip appears only when it has something real to say: an
  // attachment riding the send, or an engagement-gated warning.
  const showImageReceipt =
    contentType === "image" &&
    (pendingAttachments.length > 0 || (receiptEngaged && sendPlanNow.issues.length > 0));
  // Composer cleanup (2026-08-26). freeTierClient mirrors the server's
  // isFreeTierAccount (actions.ts): these accounts are silently pinned to
  // the free lane server-side, so a credit-shortfall warning is a false
  // alarm for them — the send costs no credits. blockingFenceVisible feeds
  // the one-voice rule: while a red fence is on screen, the credit banners
  // stay quiet ("you can't run this" already owns the moment).
  const blockingFenceVisible =
    receiptEngaged && sendPlanNow.issues.some((i) => i.severity === "block");
  // Mirrors the banner-slot ternary in the sticky wrapper below: when a
  // banner strip is fused to the composer's top edge, the (now standalone,
  // fully-rounded) form flattens its top corners so the two read as one
  // piece — the same seam contract the old in-card composer had.
  // A prompt-gate refusal takes the banner slot ahead of the credits and
  // usage strips — it is the answer to what was just sent — and in the hero
  // layout too, which sends as well whenever a caller passes heroMode. See
  // PolicyRefusalBanner.
  const policyRefusal = error && isPolicyRefusal(error) ? error : null;
  const composerBannerVisible =
    policyRefusal !== null ||
    (!isHero &&
      ((cannotAfford && !freeTierClient && !blockingFenceVisible && Boolean(selectedVideoModel)) ||
        approachingLimit));

  // First-login walkthrough (or a replay via ?tour=1 from the sidebar's
  // settings menu — see the effect above that strips that param). Steps are
  // controlled (stepIndex lives here, not inside OnboardingTour) because two
  // of them point at composer elements that are normally hidden in hero mode
  // (the video model picker and the advanced-options arrow are both gated
  // behind creationModeActive) — the effect below flips the composer into
  // the right state a moment before OnboardingTour tries to measure that
  // step's target.
  function finishTour() {
    setTourActive(false);
    setTourStepIndex(0);
    // Nothing to restore: the tour no longer changes the composer's mode.
    void setHasCompletedOnboarding();
  }
  function finishVideoTour() {
    setVideoTourActive(false);
    setVideoTourStep(0);
    try {
      window.localStorage.setItem(VIDEO_TOUR_KEY, "1");
    } catch {
      // Storage blocked: it will show again next time, which beats never.
    }
  }

  // Rendered in BOTH layouts. The docked layout drops it into the message
  // list alongside the generating bubble; hero mode has no message list at
  // all (the whole list is behind !isHero), so it goes directly above the
  // composer there instead — otherwise starting a voice session on the
  // dashboard home turned the mic on with nothing at all on screen to show
  // for it, which is exactly what "it doesn't work" looked like.
  const voiceSessionCard = voiceSessionActive ? (
    <VoiceSessionCard
      agentMessage={voiceAgentMessage}
      interimText={voiceInterimCaption}
      statusMessage={voiceStatusMessage}
      onStop={stopVoiceSession}
      g={g}
    />
  ) : null;

  // ── The Stage (A×B redesign, operator-chosen 2026-09-01) ──────────────
  // Docked-only derivations for the stage + filmstrip: the same `items`
  // state the thread renders, never a fetch of its own. Newest first, ask
  // turns excluded — an answer has no frame to show. The in-flight
  // placeholder clears once the result is being revealed (liveResult), not
  // when it's archived, so the strip never says "Rendering…" beside an
  // already-visible result — same rule the old Takes rail enforced.
  const stageTakes = isHero
    ? []
    : [...items]
        .filter((it): it is Exclude<ChatItem, AskChatItem> => it.kind !== "ask")
        .reverse();
  const stageInFlightPrompt = liveMultiAngle
    ? liveMultiAngle.prompt
    : liveResult === null
      ? livePrompt
      : null;
  const stageTake =
    (stageTakeId !== null
      ? stageTakes.find((t) => (t.kind === "single" ? t.id : t.groupId) === stageTakeId)
      : undefined) ??
    stageTakes[0] ??
    null;
  // Both shapes in the union carry it: ChatTurn through HistoryTurn, and
  // MultiAngleChatItem directly.
  const stageTakePrompt = stageTake?.prompt ?? "";
  const stageTakeUrl = stageTake
    ? stageTake.kind === "single"
      ? stageTake.succeeded
        ? stageTake.resultUrl
        : null
      : (stageTake.angles.find((a) => a.succeeded && a.resultUrl)?.resultUrl ?? null)
    : null;
  const stageTakeIsVideo = stageTake
    ? stageTake.kind === "single"
      ? stageTake.contentType === "video"
      : true
    : false;

  // ── The Screening Room (operator-chosen direction A, 2026-09-17) ───────
  // The take is the room. On a phone this is an edge-to-edge screen in the
  // page's flow; from md up it IS the pane — the page header, the filmstrip,
  // the transcript and the composer are all drawn over it (see the md:
  // classes on those wrappers below, and the :has() rule in globals.css that
  // gives this page the whole content column).
  //
  // Everything painted here uses fixed warm literals, never theme-mapped
  // colors: the screen is dark in both themes, exactly like the stage it
  // replaces (--color-atelier-stage's old rule, now the whole surface).
  const stageTakeIndex = stageTake ? stageTakes.indexOf(stageTake) : -1;
  const stageTakeNo = stageTakeIndex < 0 ? 0 : stageTakes.length - stageTakeIndex;
  const stageScore =
    stageTake?.kind === "single" && typeof stageTake.matchScore === "number"
      ? stageTake.matchScore
      : null;
  const stageCharacterName = stageTake?.kind === "single" ? (stageTake.characterName ?? null) : null;
  const stageCharacterPhoto =
    stageTake?.kind === "single" ? (stageTake.takeMeta?.characterPhotoUrl ?? null) : null;
  // The frame is shaped to the media, so a portrait take is a portrait frame
  // and nothing is ever cropped to fill the screen: the loaded pixels' own
  // ratio once known, the aspect the request rode with until then, 16:9
  // before either. Sized in container-query units — no measuring, no
  // ResizeObserver, correct on the first paint.
  const stageRatio = (() => {
    const measured = stageTakeUrl ? stageRatios[stageTakeUrl] : undefined;
    if (measured) return measured;
    const asked = stageTake?.kind === "single" ? (stageTake.takeMeta?.aspectRatio ?? null) : null;
    const parsed = asked ? /^(\d+(?:\.\d+)?):(\d+(?:\.\d+)?)$/.exec(asked) : null;
    return parsed ? Number(parsed[1]) / Number(parsed[2]) : 16 / 9;
  })();
  function noteStageRatio(url: string, w: number, h: number) {
    if (!w || !h) return;
    const ratio = w / h;
    setStageRatios((prev) =>
      prev[url] && Math.abs(prev[url] - ratio) < 0.001 ? prev : { ...prev, [url]: ratio },
    );
  }
  const stageSpec =
    stageTake === null
      ? null
      : stageTake.kind === "multi"
        ? formatMsg(g.takesAngles, { n: stageTake.angles.length })
        : stageTake.takeMeta
          ? `${stageTake.takeMeta.modelName} · ${formatMsg(g.durationSecondsShort, { n: stageTake.takeMeta.durationSeconds })}${stageTake.takeMeta.aspectRatio ? ` · ${stageTake.takeMeta.aspectRatio}` : ""}`
          : stageTakeIsVideo
            ? g.video
            : g.image;

  // ── The premiere (operator-approved B opening, 2026-09-22) ──────────────
  // The empty screen becomes an opening title: the character's saved photo
  // fanned between two tilted cards over "WHAT ARE WE SHOOTING?". It stands
  // whenever the session has no takes yet and the CURRENT character has a
  // saved photo — video and image mode alike (a fallback to another character
  // once starred someone not on set, and the subtitle then promised scoring
  // that would not run). With no such character the plain
  // hint keeps the stage, and the no-character page state upstream stays as
  // it is. The centre card wears the anchor photo (the one this take would
  // match); the side cards are the character's other saved photos, topped up
  // with set dressing when there are none.
  const premiereCharacter =
    currentCharacter?.referencePhotos[0]?.url ? currentCharacter : null;
  const premiereThumb = (url: string) =>
    url.startsWith("/api/media/") ? `${url}${url.includes("?") ? "&" : "?"}w=640` : url;
  const premiereCenterUrl = premiereCharacter
    ? ((premiereCharacter === currentCharacter && anchorPickerShown
        ? referencePhotos[anchorIndex]?.url
        : undefined) ?? premiereCharacter.referencePhotos[0]?.url ?? null)
    : null;
  // Spare reference photos first; the posters only top up what is missing,
  // and a lone empty slot always gets the BRIGHT poster (the dark one reads
  // near-black inside a dimmed 220×124 side card).
  const premiereSpares = premiereCharacter
    ? premiereCharacter.referencePhotos
        .map((p) => p.url)
        .filter((u) => u !== premiereCenterUrl)
        .map(premiereThumb)
    : [];
  const premiereSideUrls = premiereCharacter
    ? [
        ...premiereSpares,
        ...(premiereSpares.length ? [] : ["/hero-band-3-poster.jpg"]),
        "/hero-band-2-poster.jpg",
      ].slice(0, 2)
    : [];
  const premiereShown =
    !isHero &&
    stageTakes.length === 0 &&
    stageInFlightPrompt === null &&
    premiereCharacter !== null &&
    premiereCenterUrl !== null;
  // The name gets its own italic serif; the sentence around it comes from
  // the catalog whole, split at the placeholder.
  const [premiereSubBefore, premiereSubAfter = ""] = g.premiereSub.split("{name}");

  // ── Direction B (operator-picked, 2026-09-18): where the Takes strip goes.
  // Until today it always stood in a band over the screen's bottom, and a
  // VIDEO frame gave up 124 px of height under itself so the strip never sat
  // on the player's controls. With the composer open on a short window that
  // band is what the take could not afford: 632 − 78 header − ~375 composer −
  // 124 band left it 55 px tall. From md up the strip can instead stand in a
  // column at the screen's left, beside the frame, and the frame then ends
  // just above the composer — at the cost of a gutter each side, which
  // narrows a frame that was limited by WIDTH. So it goes wherever the take
  // comes out bigger: beside it on a short window with the composer open, in
  // the band (exactly as before) when the take is already wide, and never
  // for stills, which were already allowed to run under the band.
  const STAGE_TOP_PX = 78; // md:top-[78px] on the media box
  const BAND_RESERVE_PX = 124; // video frame's gap for the band (below)
  const COLUMN_RESERVE_PX = 34; // the slate line's room above the composer
  const BAND_SIDE_PX = 32; // md:inset-x-8
  const COLUMN_SIDE_PX = 176; // the column (116 px tiles + ring) and a gutter
  const DRAWER_SIDE_PX = 452; // lg:right-[452px] while the transcript is open
  const stripBeside = (() => {
    if (!stagePane.md || !stageTakeUrl || !stageTakeIsVideo || stageInFlightPrompt !== null) return false;
    const drawer = transcriptOpen && stagePane.lg;
    const widthFor = (reserve: number, left: number, right: number) => {
      const h = stagePane.h - STAGE_TOP_PX - dockHeight - reserve;
      if (h <= 0) return 0;
      return Math.min(h * stageRatio, stagePane.w - left - right);
    };
    const inBand = widthFor(BAND_RESERVE_PX, BAND_SIDE_PX, drawer ? DRAWER_SIDE_PX : BAND_SIDE_PX);
    const beside = widthFor(COLUMN_RESERVE_PX, COLUMN_SIDE_PX, drawer ? DRAWER_SIDE_PX : COLUMN_SIDE_PX);
    // A margin, so a pane on the fence does not flip the strip back and forth.
    return beside > inBand + 24;
  })();
  // The frame's own size from md up (0 × 0 before the stage is measured) —
  // the same arithmetic the box above runs in CSS. The frame's overlays were
  // drawn for a big take; on a small one (a short window with the composer
  // open) the take label ran into the download button and the identity
  // plate sat over the middle of the picture, so both step back below these
  // sizes (see stageFrameNarrow / stageFrameShort at their elements).
  const stageFrame = (() => {
    if (!stagePane.md || !stageTakeUrl) return { w: 0, h: 0 };
    const drawer = transcriptOpen && stagePane.lg;
    const left = stripBeside ? COLUMN_SIDE_PX : BAND_SIDE_PX;
    const right = drawer ? DRAWER_SIDE_PX : stripBeside ? COLUMN_SIDE_PX : BAND_SIDE_PX;
    const reserve = stripBeside || !stageTakeIsVideo ? COLUMN_RESERVE_PX : BAND_RESERVE_PX;
    const boxW = stagePane.w - left - right;
    const boxH = stagePane.h - STAGE_TOP_PX - dockHeight - reserve;
    if (boxW <= 0 || boxH <= 0) return { w: 0, h: 0 };
    const w = Math.min(boxW, boxH * stageRatio);
    return { w, h: w / stageRatio };
  })();
  const stageFrameNarrow = stageFrame.w > 0 && stageFrame.w < 460;
  const stageFrameShort = stageFrame.h > 0 && stageFrame.h < 240;
  // Whether the spec caption (right of the composer, under the frame's
  // bottom-right corner) has room. A grown dock — the dialogue surcharge
  // line, an armed note — used to push the caption up into the lock
  // bracket's lower arms; and measured live (2026-09-22) those states have
  // NO free band at all between the bracket and the composer card, so no
  // anchor can save it — it steps back instead, like the frame's other
  // overlays (stageFrameShort). The slate's ENGINE/LENGTH/FRAME cells say
  // the same words, so nothing is lost while it is hidden. The caption sits
  // at bottom dock+22, its 16px line box topping out at dock+38; the
  // bracket's lower arm sits 7px under the frame's bottom edge, which is
  // dock + reserve + the centering slack up — so it clears while that
  // distance stays >= 45px.
  const stageCaptionClear = (() => {
    if (stageFrame.h === 0 || stageScore === null) return true;
    const boxH = stagePane.h - STAGE_TOP_PX - dockHeight - COLUMN_RESERVE_PX;
    return COLUMN_RESERVE_PX + Math.max(0, (boxH - stageFrame.h) / 2) >= 45;
  })();
  // The identity plate keeps to ONE line. Under a phone's frame it hangs by
  // its own bottom edge, 34px below the frame's, so a label that wrapped grew
  // the plate upward and put the 26px number on the lock bracket's lower arm
  // — Portuguese "CORRESPONDÊNCIA DE IDENTIDADE" on a 405px phone, in the Play
  // listing's own stage shot (2026-09-22). So where the label will not fit
  // beside the number as designed, it gives way only as far as it has to:
  // first its tracking eases toward zero, then its size toward 8px, and
  // where even that is too wide (a portrait take, a retried take's note on a
  // phone) the plate shrinks to its number, exactly as it does on a short
  // frame. Measured: the room depends on the take's shape, the words on the
  // locale, the widths on the loaded faces.
  const stagePlateRef = useRef<HTMLDivElement | null>(null);
  const stagePlateLabelRef = useRef<HTMLSpanElement | null>(null);
  // null: the designed label. Otherwise the eased tracking and size, in px;
  // "none": no room for the label — the number stands alone.
  const [stagePlateFit, setStagePlateFit] = useState<{ spacing: number; size: number } | "none" | null>(null);
  const stagePlateLabelFit = stageFrameShort ? null : stagePlateFit;
  const stageAttemptCount = stageTake?.kind === "single" ? stageTake.attempts.length : 0;
  useLayoutEffect(() => {
    const plate = stagePlateRef.current;
    const label = stagePlateLabelRef.current;
    const frame = plate?.parentElement;
    if (!plate || !label || !frame || stageFrameShort) return;
    const fit = () => {
      const plateStyle = getComputedStyle(plate);
      const labelStyle = getComputedStyle(label);
      const gap = parseFloat(plateStyle.columnGap) || 0;
      // The frame's width, less the plate's inset on both sides (none under
      // the frame, right-3 inside it from md up — its max-width classes say
      // the same), its padding, and whatever else rides beside the label.
      let room =
        frame.getBoundingClientRect().width -
        2 * (parseFloat(plateStyle.right) || 0) -
        (parseFloat(plateStyle.paddingLeft) || 0) -
        (parseFloat(plateStyle.paddingRight) || 0) -
        1;
      for (const child of Array.from(plate.children)) {
        if (child !== label) room -= child.getBoundingClientRect().width + gap;
      }
      const chars = Array.from(label.textContent ?? "").length;
      if (!chars) return;
      const range = document.createRange();
      range.selectNodeContents(label);
      const size = parseFloat(labelStyle.fontSize);
      const spacing = parseFloat(labelStyle.letterSpacing) || 0;
      // The words' own width at the designed 10px with no tracking (the
      // label's text-[10px] tracking-widest, i.e. 1px a letter); glyphs
      // scale with the size.
      const bare = ((range.getBoundingClientRect().width - chars * spacing) * 10) / size;
      const next =
        bare + chars <= room
          ? null
          : bare <= room
            ? { spacing: (room - bare) / chars, size: 10 }
            : bare * 0.8 <= room
              ? { spacing: 0, size: (10 * room) / bare }
              : "none";
      setStagePlateFit((prev) =>
        typeof prev === "object" &&
        prev !== null &&
        typeof next === "object" &&
        next !== null &&
        Math.abs(prev.spacing - next.spacing) < 0.05 &&
        Math.abs(prev.size - next.size) < 0.05
          ? prev
          : next,
      );
    };
    fit();
    if (typeof ResizeObserver === "undefined") return;
    // The frame for the room; the plate's pieces for a face that loads late
    // or a score that grows a digit.
    const ro = new ResizeObserver(fit);
    ro.observe(frame);
    for (const child of Array.from(plate.children)) ro.observe(child);
    document.fonts?.addEventListener("loadingdone", fit);
    return () => {
      ro.disconnect();
      document.fonts?.removeEventListener("loadingdone", fit);
    };
  }, [stageScore, stageTakeUrl, stageFrameShort, stageAttemptCount, g.identityMatchLabel]);

  // The take numbers on the tiles and the slate line: 01, 02 … counting up
  // from the session's first send (the strip itself runs newest first).
  const takeLabelNo = (n: number) => (n < 10 ? `0${n}` : String(n));

  const stageMediaClass = "absolute inset-0 h-full w-full object-contain";

  // One filmstrip, three homes: in the page's flow under the phone screen,
  // over the screen's bottom from md up, and — direction B — in a column at
  // the screen's left, beside the frame (stripBeside).
  function filmstrip(where: "page" | "screen" | "column") {
    const onScreen = where !== "page";
    const column = where === "column";
    const page = where === "page";
    const body = (
      <div
        className={cn(
          "flex min-w-0 gap-3",
          column ? "min-h-0 flex-col items-start gap-2" : "items-center",
          column ? null : onScreen ? "min-w-0 flex-1" : "w-full",
        )}
      >
        <div className={cn("flex flex-shrink-0 flex-col", page && "hidden")}>
          <span
            className={cn(
              "text-[10px] font-medium uppercase tracking-widest",
              onScreen ? "text-[#cfc6b8]" : "text-atelier-muted",
            )}
          >
            {g.takesShort}
          </span>
          <span
            className={cn(
              "font-numeral text-lg font-semibold leading-tight tabular-nums",
              onScreen ? "text-[#f3ede4]" : "text-atelier-ink",
            )}
          >
            {stageTakes.length}
          </span>
        </div>
        {/* Scrolls inside itself (the 2026-08-09 / 2026-08-30 page-overflow
            incidents both came from strips that couldn't), with 3px of room
            for the selected tile's ring, which overflow would otherwise
            clip. */}
        <div
          data-takes-strip
          data-producer-spot="renders"
          className={cn(
            "flex min-w-0 gap-2 p-[3px]",
            column
              ? "min-h-0 flex-col overflow-y-auto overscroll-y-contain"
              : "flex-1 items-center overflow-x-auto overscroll-x-contain",
          )}
        >
          {stageInFlightPrompt !== null && (
            <div
              title={stageInFlightPrompt}
              className={cn(
                "flex h-[66px] w-[116px] flex-shrink-0 flex-col items-center justify-center gap-1.5 rounded-[4px] border border-dashed",
                onScreen
                  ? "border-[#f3ede4]/25 bg-[#0e0c0a]/50"
                  : "border-atelier-rule bg-atelier-surface/40",
              )}
            >
              <span
                className={cn(
                  "h-[3px] w-[62px] overflow-hidden rounded-full",
                  onScreen ? "bg-[#f3ede4]/15" : "bg-atelier-ink/10",
                )}
              >
                <span className="block h-full w-[38%] animate-pulse rounded-full bg-[#e0a468]" />
              </span>
              <span
                className={cn(
                  "px-2 text-center text-[10px] font-medium uppercase tracking-widest",
                  onScreen ? "text-[#cfc6b8]" : "text-atelier-muted",
                )}
              >
                {g.takesRendering}
              </span>
            </div>
          )}
          {stageTakes.map((it, i) => {
            const tid = it.kind === "single" ? it.id : it.groupId;
            const url =
              it.kind === "single"
                ? it.succeeded
                  ? it.resultUrl
                  : null
                : (it.angles.find((a) => a.succeeded && a.resultUrl)?.resultUrl ?? null);
            const tileIsVideo = it.kind === "single" ? it.contentType === "video" : true;
            const score =
              it.kind === "single" && typeof it.matchScore === "number" ? it.matchScore : null;
            const selected =
              stageTake !== null &&
              (stageTake.kind === "single" ? stageTake.id : stageTake.groupId) === tid;
            return (
              <button
                key={tid}
                type="button"
                title={it.prompt}
                data-producer-render={it.kind === "single" ? it.id : undefined}
                onClick={() => {
                  setStageTakeId(tid);
                  if (transcriptOpen) {
                    document
                      .getElementById(`take-${tid}`)
                      ?.scrollIntoView({ behavior: "smooth", block: "start" });
                  }
                }}
                className={cn(
                  "relative h-[66px] w-[116px] flex-shrink-0 overflow-hidden rounded-[4px] bg-[#16130f] transition-shadow focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#e0a468]",
                  selected
                    ? "shadow-[0_0_0_2px_#e0a468]"
                    : onScreen
                      ? "opacity-85 hover:opacity-100 hover:shadow-[0_0_0_1px_rgba(243,237,228,0.35)]"
                      : "hover:shadow-[0_0_0_1px_var(--color-atelier-rule)]",
                )}
              >
                {url ? (
                  tileIsVideo ? (
                    // #t fragment: paints the first frame in Android WebView
                    // too — see history/page.tsx.
                    <video
                      src={`${url}#t=0.1`}
                      muted
                      playsInline
                      preload="metadata"
                      className="h-full w-full object-cover"
                    />
                  ) : (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={url} alt="" className="h-full w-full object-cover" />
                  )
                ) : (
                  <span className="flex h-full w-full items-center justify-center text-[#a39a88]">
                    <XIcon className="h-4 w-4" />
                  </span>
                )}
                {/* The slate under every take: its number, and the score the
                    verifier gave it. */}
                <span className="absolute inset-x-0 bottom-0 flex items-baseline gap-1 bg-[linear-gradient(180deg,rgba(14,12,10,0)_0%,rgba(14,12,10,0.82)_100%)] px-1.5 pb-1 pt-3 text-[9px] font-medium uppercase tracking-widest text-[#f3ede4]">
                  {takeLabelNo(stageTakes.length - i)}
                  {score !== null && (
                    <>
                      <span aria-hidden className="text-[#f3ede4]/40">
                        ·
                      </span>
                      <span className="font-numeral text-[11px] font-semibold tabular-nums text-[#e0a468]">
                        {score}
                      </span>
                    </>
                  )}
                </span>
              </button>
            );
          })}
        </div>
      </div>
    );
    if (!page) return body;
    // The phone's takes caption (the sheet, 2026-09-22): TAKES and its
    // count on one baseline, the page's reliability pair at the right —
    // they left the header when it became one line — then the strip at
    // full width.
    const statsShown = phoneStats !== undefined && phoneStats.total > 0;
    return (
      <div className="flex min-w-0 flex-col gap-1.5">
        {/* One line in every language: the stats wear their short labels
            here (the full wording rides the title), and a label truncates
            before the row can wrap raggedly or scroll the page sideways. */}
        <div className="flex min-w-0 flex-nowrap items-baseline gap-x-4">
          <span className="flex flex-shrink-0 items-baseline gap-[7px]">
            <span className="text-[10px] font-medium uppercase tracking-widest text-atelier-muted">
              {g.takesShort}
            </span>
            <span className="font-numeral text-[15px] font-semibold leading-none tabular-nums text-atelier-ink">
              {stageTakes.length}
            </span>
          </span>
          {statsShown && (
            <span className="ml-auto flex min-w-0 items-baseline gap-x-3">
              {phoneStats.firstTryRate !== null && (
                <span className="flex min-w-0 items-baseline gap-[5px]" title={g.firstTrySuccess}>
                  <span className="font-numeral text-[15px] font-semibold leading-none tabular-nums text-atelier-ink">
                    {phoneStats.firstTryRate}%
                  </span>
                  <span className="min-w-0 truncate whitespace-nowrap text-[10px] font-medium uppercase tracking-[0.08em] text-atelier-muted">
                    {g.firstTryShort}
                  </span>
                </span>
              )}
              {phoneStats.avgAttempts !== null && (
                <span className="flex min-w-0 items-baseline gap-[5px]" title={g.avgAttempts}>
                  <span className="font-numeral text-[15px] font-semibold leading-none tabular-nums text-atelier-ink">
                    {phoneStats.avgAttempts}
                  </span>
                  <span className="min-w-0 truncate whitespace-nowrap text-[10px] font-medium uppercase tracking-[0.08em] text-atelier-muted">
                    {g.avgAttemptsShort}
                  </span>
                </span>
              )}
            </span>
          )}
        </div>
        {body}
      </div>
    );
  }

  const stagePanel = isHero ? null : (
    <div
      ref={stagePanelRef}
      data-screening-stage
      data-producer-spot="render"
      style={{ "--frame-h": `calc((100vw - 32px) / ${stageRatio} + 84px)` } as React.CSSProperties}
      className={cn(
        "relative -mx-4 mb-3 h-[min(46svh,440px,max(292px,var(--frame-h)))] overflow-hidden bg-[#0e0c0a] sm:-mx-8",
        "md:absolute md:inset-0 md:mx-0 md:mb-0 md:h-auto",
      )}
    >
      {/* The room's light: the take itself, thrown across the whole screen,
          blurred and dimmed. Same URL as the frame, so it costs no second
          download — and it is what makes a portrait take sit in a room
          instead of on two grey bars. */}
      {stageTakeUrl && (
        <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
          {stageTakeIsVideo ? (
            <video
              key={`ambient-${stageTakeUrl}`}
              src={`${stageTakeUrl}#t=0.1`}
              muted
              playsInline
              preload="metadata"
              tabIndex={-1}
              className="absolute inset-0 h-full w-full scale-110 object-cover opacity-40 blur-[44px]"
            />
          ) : (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              key={`ambient-${stageTakeUrl}`}
              src={stageTakeUrl}
              alt=""
              className="absolute inset-0 h-full w-full scale-110 object-cover opacity-40 blur-[44px]"
            />
          )}
        </div>
      )}
      {/* Reading shade — the header at the top, the strip and composer at the
          bottom, both over whatever the ambient throws up. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 bg-[linear-gradient(180deg,rgba(14,12,10,0.72)_0%,rgba(14,12,10,0.06)_20%,rgba(14,12,10,0.06)_46%,rgba(14,12,10,0.9)_100%)]"
      />

      {/* The page's own header, riding the top of the screen from md up (the
          phone keeps it in the page's flow — see generate/page.tsx). */}
      {screenHeader && (
        <div className="absolute inset-x-0 top-0 z-20 hidden px-8 pt-5 md:block">{screenHeader}</div>
      )}

      {/* The media box: header above, filmstrip and composer below. Its
          padding is the room the frame's two slate lines sit in. */}
      <div
        role="status"
        aria-live="polite"
        className={cn(
          "absolute inset-x-4 bottom-11 top-10 flex items-center justify-center [container-type:size]",
          "md:top-[78px] md:transition-[bottom,right,left] md:duration-300 md:ease-out",
          // An image may run under the filmstrip — the board drew it that way
          // and nothing there is clickable. A VIDEO may not: its own control
          // bar lives at the bottom of the frame, and the strip would sit on
          // the play button. Unless the strip stands beside the frame
          // (direction B, stripBeside): then the frame keeps a gutter each
          // side instead and runs down to just above the composer.
          stripBeside
            ? "md:left-[176px] md:right-[176px] md:bottom-[calc(var(--dock-h)+34px)]"
            : cn(
                "md:inset-x-8",
                stageTakeIsVideo ? "md:bottom-[calc(var(--dock-h)+124px)]" : "md:bottom-[calc(var(--dock-h)+34px)]",
              ),
          transcriptOpen && "lg:right-[452px]",
        )}
      >
        {stageInFlightPrompt !== null ? (
          <div className="flex flex-col items-center gap-3 px-6 text-center">
            <LoaderIcon className="h-5 w-5 text-[#e0a468]" />
            <p className="text-sm text-[#e7e0d5]">
              {liveProgress ? localizeServerText(liveProgress, t) : g.runningPipeline}
            </p>
            <p className="max-w-md truncate text-[11px] text-[#a39a88]">{stageInFlightPrompt}</p>
          </div>
        ) : stageTakeUrl ? (
          <div
            className="relative max-h-full max-w-full"
            style={{
              width: `min(100cqw, calc(100cqh * ${stageRatio}))`,
              aspectRatio: String(stageRatio),
            }}
          >
            {stageTakeIsVideo ? (
              // key remounts the player when the filmstrip picks another
              // take — without it the <video> keeps playing the old src.
              <video
                key={stageTakeUrl}
                ref={stageVideoRef}
                src={stageTakeUrl}
                controls
                playsInline
                preload="metadata"
                aria-label={stageTakePrompt || g.resultAlt}
                onLoadedMetadata={(e) =>
                  noteStageRatio(
                    stageTakeUrl,
                    e.currentTarget.videoWidth,
                    e.currentTarget.videoHeight,
                  )
                }
                className={stageMediaClass}
              />
            ) : (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                key={stageTakeUrl}
                src={stageTakeUrl}
                // The prompt, not "". Each take is unique to what was asked
                // for, so the prompt describes it better than any fixed
                // string — the same rule ResultMedia states for the
                // transcript copy of this image.
                alt={stageTakePrompt || g.resultAlt}
                onLoad={(e) =>
                  noteStageRatio(
                    stageTakeUrl,
                    e.currentTarget.naturalWidth,
                    e.currentTarget.naturalHeight,
                  )
                }
                className={stageMediaClass}
              />
            )}

            {/* The lock: corner marks on a take the verifier scored, and the
                number under them. Not a claim that the face passed — a take
                that misses twice is still delivered (lib/generations/
                identity-gate.ts) — so the mark says scored and the number
                says how well. */}
            {stageScore !== null && (
              <div aria-hidden className="lock-frame absolute -inset-[7px] [--lock-arm:18px] sm:[--lock-arm:26px]" />
            )}
            {(stageCharacterName || stageTakeNo > 0) && (
              <div
                className={cn(
                  "pointer-events-none absolute -top-[26px] left-0 flex max-w-full items-center gap-2 pr-2 md:left-3 md:top-3 md:rounded-full md:bg-[#0e0c0a]/55 md:py-1 md:pl-1 md:pr-3 md:backdrop-blur-[6px]",
                  // A narrow frame's top edge belongs to its actions; the
                  // character's pill and the strip's tile already say who and
                  // which take (2026-09-18).
                  stageFrameNarrow && "md:hidden",
                )}
              >
                {stageCharacterPhoto && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={stageCharacterPhoto}
                    alt=""
                    className="h-[18px] w-[18px] flex-shrink-0 rounded-full object-cover [object-position:50%_30%]"
                  />
                )}
                <span className="truncate text-[10.5px] font-medium uppercase tracking-[0.14em] text-[#e0a468]">
                  {[stageCharacterName, formatMsg(g.stageTakeNumber, { n: takeLabelNo(stageTakeNo) })]
                    .filter(Boolean)
                    .join(" · ")}
                </span>
              </div>
            )}
            {stageScore !== null && (
              <div
                ref={stagePlateRef}
                className={cn(
                  "pointer-events-none absolute -bottom-[34px] right-0 flex max-w-full items-baseline gap-2 whitespace-nowrap md:right-3 md:max-w-[calc(100%-24px)] md:rounded-[8px] md:bg-[#0e0c0a]/55 md:px-2.5 md:py-1.5 md:backdrop-blur-[6px]",
                  // A video's own control bar owns the bottom of the frame —
                  // the plate lifts clear of it, exactly as it did on the old
                  // stage.
                  stageTakeIsVideo ? "md:bottom-[52px]" : "md:bottom-3",
                  // On a short frame the plate shrinks to its number and sits
                  // low in the corner, clear of the picture's middle.
                  stageFrameShort && (stageTakeIsVideo ? "md:bottom-[46px] md:px-2 md:py-1" : "md:px-2 md:py-1"),
                )}
              >
                {!stageFrameShort && stageTake?.kind === "single" && stageTake.attempts.length > 1 && (
                  <span className="text-[11px] lowercase text-[#cfc6b8]">
                    {formatMsg(g.passedOnAttempt, { n: stageTake.attempts.length })}
                  </span>
                )}
                {/* Kept for screen readers on a short frame, where only the
                    number shows — and wherever the label has no room at all
                    (stagePlateFit). */}
                <span
                  ref={stagePlateLabelRef}
                  style={
                    typeof stagePlateLabelFit === "object" && stagePlateLabelFit !== null
                      ? { letterSpacing: `${stagePlateLabelFit.spacing}px`, fontSize: `${stagePlateLabelFit.size}px` }
                      : undefined
                  }
                  className={cn(
                    "min-w-0 text-[10px] font-medium uppercase tracking-widest text-[#cfc6b8]",
                    (stageFrameShort || stagePlateLabelFit === "none") && "sr-only",
                  )}
                >
                  {g.identityMatchLabel}
                </span>
                <span
                  className={cn(
                    "shrink-0 font-numeral font-semibold leading-none tabular-nums text-[#e0a468]",
                    stageFrameShort ? "text-[26px] md:text-[17px]" : "text-[26px]",
                  )}
                >
                  {stageScore}%
                </span>
              </div>
            )}

            {/* The ghost actions, on the frame's own top-right — only the
                ones that genuinely work: download (both media kinds) and
                fullscreen (video). No share ghost: a dead control is worse
                than a missing one. */}
            <div className="absolute right-3 top-3 z-10 flex gap-2">
              <DownloadButton
                url={stageTakeUrl}
                contentType={stageTakeIsVideo ? "video" : "image"}
                // A multi-angle take is several rows; the id here is the
                // representative the screen is actually showing, which is the
                // one the person is choosing to keep.
                generationId={
                  stageTake?.kind === "single"
                    ? stageTake.id
                    : (stageTake?.angles.find((a) => a.succeeded && a.resultUrl)?.id ?? undefined)
                }
                variant="ghost"
              />
              {/* No expand in the phone app: its WebView has no fullscreen,
                  so the button did nothing and threw "Fullscreen is not
                  supported" (auto-filed from a Galaxy A23, 2026-09-18). */}
              {stageTakeIsVideo && !nativeClient && (
                <button
                  type="button"
                  onClick={() => void stageVideoRef.current?.requestFullscreen?.()?.catch(() => {})}
                  title={g.expandStage}
                  aria-label={g.expandStage}
                  className="flex h-[30px] w-[30px] items-center justify-center rounded-[8px] bg-onmedia/10 text-onmedia/85 transition-colors hover:bg-onmedia/20"
                >
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" className="h-[15px] w-[15px]">
                    <path d="M9 4H4v5M15 4h5v5M9 20H4v-5M15 20h5v-5" />
                  </svg>
                </button>
              )}
              {/* Upscale, in the moment of admiring the result (operator-
                  picked placement A + the sidebar group, 2026-09-03).
                  Session takes only — a history-resumed take has no
                  takeMeta and keeps its Upscale entry on its History page.
                  Storyboards past the provider's 20s cap self-exclude. */}
              {stageTakeIsVideo &&
                stageTake?.kind === "single" &&
                stageTake.succeeded &&
                stageTake.takeMeta?.modelId &&
                stageTake.takeMeta.durationSeconds <= UPSCALE_MAX_SECONDS &&
                availableUpscaleTiers(takeSourceHeight(stageTake.takeMeta.modelId)).length > 0 && (
                  <UpscaleButton
                    trigger="stageGhost"
                    generationId={stageTake.id}
                    seconds={stageTake.takeMeta.durationSeconds}
                    tiers={availableUpscaleTiers(takeSourceHeight(stageTake.takeMeta.modelId))}
                  />
                )}
            </div>
          </div>
        ) : stageTake ? (
          <div className="flex flex-col items-center gap-2 px-6 text-center">
            <XIcon className="h-5 w-5 text-[#a39a88]" />
            <p className="text-sm text-[#e7e0d5]">{g.couldntValidate}</p>
            <button
              type="button"
              onClick={() => setTranscriptOpen(true)}
              className="text-[12px] font-medium text-[#e0a468] underline-offset-2 hover:underline"
            >
              {g.sessionTranscript}
            </button>
          </div>
        ) : premiereShown && premiereCharacter && premiereCenterUrl ? (
          /* The opening title (approved B, 2026-09-22): the fan of three
             cards — the saved photo locked in the centre, two tilted takes
             of set dressing behind — over the marquee headline. Fixed warm
             literals: the screen is dark in both themes. */
          <div className="flex -translate-y-1.5 flex-col items-center px-6 text-center">
            <div
              aria-hidden
              className="relative mb-[18px] h-[132px] w-[340px] max-w-full sm:mb-[26px] sm:h-[196px] sm:w-[560px]"
            >
              <span className="absolute -bottom-[26px] left-1/2 h-[60px] w-[260px] -translate-x-1/2 rounded-full bg-[radial-gradient(50%_50%_at_50%_50%,rgba(224,164,104,0.28),rgba(224,164,104,0)_70%)] blur-[6px] sm:w-[420px]" />
              <span className="absolute left-1/2 top-1/2 block h-[79px] w-[140px] overflow-hidden rounded-[12px] bg-[#16130f] brightness-[.7] saturate-[.8] shadow-[0_0_0_1px_rgba(255,240,220,0.16),inset_0_1px_0_rgba(255,240,220,0.25),0_24px_40px_-12px_rgba(0,0,0,0.85)] [transform:translate(-118%,-42%)_rotate(-7deg)] sm:h-[124px] sm:w-[220px]">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={premiereSideUrls[0]} alt="" className="h-full w-full object-cover object-[50%_32%]" />
              </span>
              <span className="absolute left-1/2 top-1/2 block h-[79px] w-[140px] overflow-hidden rounded-[12px] bg-[#16130f] brightness-[.7] saturate-[.8] shadow-[0_0_0_1px_rgba(255,240,220,0.16),inset_0_1px_0_rgba(255,240,220,0.25),0_24px_40px_-12px_rgba(0,0,0,0.85)] [transform:translate(18%,-42%)_rotate(7deg)] sm:h-[124px] sm:w-[220px]">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={premiereSideUrls[1]} alt="" className="h-full w-full object-cover object-[50%_32%]" />
              </span>
              <span className="absolute left-1/2 top-1/2 z-[2] block h-[110px] w-[196px] -translate-x-1/2 -translate-y-1/2 overflow-hidden rounded-[12px] bg-[#16130f] shadow-[0_0_0_1px_rgba(255,240,220,0.26),inset_0_1px_0_rgba(255,240,220,0.3),0_30px_60px_-14px_rgba(0,0,0,0.9)] sm:h-[169px] sm:w-[300px]">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={premiereThumb(premiereCenterUrl)}
                  alt=""
                  className="h-full w-full object-cover object-[50%_32%]"
                />
                <span
                  className="lock-frame absolute inset-1.5"
                  style={
                    { "--lock-arm": "16px", "--lock-stroke": "2px" } as React.CSSProperties
                  }
                />
                <span className="absolute bottom-1.5 left-1.5 rounded-full bg-[#0e0c0a]/55 px-2 py-[3px] text-[8.5px] uppercase tracking-[0.12em] text-[#f3ede4] backdrop-blur-[6px] sm:bottom-2 sm:left-2.5 sm:text-[10px]">
                  {premiereCharacter.name} · {g.receiptSrcSaved}
                </span>
              </span>
            </div>
            <h2 className="marquee max-w-[320px] bg-[linear-gradient(180deg,#fdf8f0_22%,#a89c8b_100%)] bg-clip-text text-[24px] leading-[1.05] text-transparent [text-wrap:balance] sm:max-w-none sm:text-[38px] sm:leading-none">
              {g.premiereTitle}
            </h2>
            <p className="mt-2.5 max-w-md text-[13px] leading-snug text-[#a89f92] [text-wrap:balance] sm:mt-3 sm:text-sm">
              {premiereSubBefore}
              <em className="font-numeral text-[16px] italic text-[#e0a468] sm:text-[17px]">
                {premiereCharacter.name}
              </em>
              {premiereSubAfter}
            </p>
          </div>
        ) : (
          <div className="flex flex-col items-center gap-3 px-6 py-10 text-center">
            <div className="flex h-12 w-12 items-center justify-center rounded-media bg-onmedia/10 text-[#e7e0d5]">
              {contentType === "video" ? <VideoIcon className="h-5 w-5" /> : <ImageIcon className="h-5 w-5" />}
            </div>
            <div>
              <p className="text-sm font-medium text-[#e7e0d5]">
                {creationModeActive
                  ? contentType === "video"
                    ? g.createVideosTitle
                    : g.createImagesTitle
                  : nativeClient
                    ? g.noMessagesNative
                    : g.noMessages}
              </p>
              {creationModeActive && (
                <p className="mt-1 text-xs text-[#a39a88]">{g.createModeSubtitle}</p>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Direction B: the strip in a column at the screen's left, beside the
          frame, and the slate line on its own at the right above the
          composer — where the band used to end. */}
      {stripBeside && (
        <>
          <div className="absolute left-8 top-[92px] z-20 hidden max-h-[calc(100%-92px-var(--dock-h)-28px)] min-h-0 flex-col md:flex">
            {filmstrip("column")}
          </div>
          {/* Not while the transcript drawer is open: the drawer pulls the
              line in to the frame's own bottom-right corner, where it sat on
              the lock's bracket — and the drawer already names the take. */}
          {!(transcriptOpen && stagePane.lg) && stageCaptionClear && (
            <p className="absolute right-8 z-20 hidden max-w-[320px] truncate text-right text-[10.5px] font-medium uppercase tracking-[0.14em] text-[#cfc6b8] md:block md:bottom-[calc(var(--dock-h)+22px)] md:transition-[bottom,right] md:duration-300 md:ease-out">
              {stageSpec}
            </p>
          )}
        </>
      )}
      {/* The filmstrip band, over the screen's bottom from md up — the phone
          keeps its strip in the page's flow, under the screen. Not mounted
          while the strip stands beside the frame, so no tile loads twice —
          nor under the premiere, whose subtitle already says what the
          Takes-0 note said. */}
      {!stripBeside && !premiereShown && (
      <div
        className={cn(
          "absolute inset-x-8 z-20 hidden items-end gap-5 md:flex md:bottom-[calc(var(--dock-h)+22px)] md:transition-[bottom,right] md:duration-300 md:ease-out",
          transcriptOpen && "lg:right-[452px]",
        )}
      >
        {filmstrip("screen")}
        {stageTake === null ? (
          <p className="hidden max-w-[300px] flex-shrink-0 text-right text-[11.5px] leading-snug text-[#cfc6b8] lg:block">
            {g.stageScoredNote}
          </p>
        ) : (
          <p className="hidden max-w-[320px] flex-shrink-0 truncate text-right text-[10.5px] font-medium uppercase tracking-[0.14em] text-[#cfc6b8] lg:block">
            {stageSpec}
          </p>
        )}
      </div>
      )}
    </div>
  );

  return (
    <>
      {tourActive && (
        <OnboardingTour
          steps={tourSteps}
          stepIndex={tourStepIndex}
          onNext={() => setTourStepIndex((i) => i + 1)}
          onFinish={finishTour}
          onJump={setTourStepIndex}
          next={ob.next}
          skip={ob.skip}
          finish={ob.finish}
          stepsLabel={ob.stepsLabel}
        />
      )}
      {videoTourActive && (
        <OnboardingTour
          steps={videoTourSteps}
          stepIndex={videoTourStep}
          onNext={() => setVideoTourStep((i) => i + 1)}
          onFinish={finishVideoTour}
          onJump={setVideoTourStep}
          next={ob.next}
          skip={ob.skip}
          finish={ob.finish}
          stepsLabel={ob.stepsLabel}
        />
      )}
    {/* The Screening Room (direction A, 2026-09-17): on a phone this is the
        old column — screen, filmstrip, transcript, composer. From md up the
        screen fills the pane and the rest is drawn over it, so this wrapper
        becomes the positioning context and publishes the composer's measured
        height for the screen's own layout. */}
    <div
      className={cn(
        "md:relative md:h-full",
        !isHero && "max-md:pb-[var(--dock-h)]",
        // Phones: the page is always a little taller than the screen, and
        // the disclaimer sits at its very end (mt-auto) — so at rest it is
        // behind the dock, never a ghost line in the dock's fade, and one
        // flick shows it whole (craft audit, 2026-09-22).
        !isHero && !premiereShown && "max-md:flex max-md:min-h-[calc(100dvh+2rem)] max-md:flex-col",
      )}
      style={{ "--dock-h": `${Math.round(dockHeight)}px` } as React.CSSProperties}
    >
    {/* The phone's header, ONE line (the sheet, 2026-09-22): the title,
        the credit balance, then Session transcript and New chat as icon
        keys — the reliability pair moved to the takes caption. md and up
        keep the page's screenHeader over the room. */}
    {!isHero && (
      <div className="-mt-1 mb-2 flex h-11 items-center gap-3 md:hidden">
        {/* The title never gives way; the credits label wraps onto two
            short lines first (the ochre number stays whole), and the icon
            keys' glyphs end on the same 16 px gutter as the dock. */}
        <h1 className="marquee flex-shrink-0 whitespace-nowrap text-[17px] leading-none text-atelier-ink">{g.pageTitle}</h1>
        <div data-producer-spot="credits" className="ml-auto flex min-w-0 items-center gap-[7px]">
          <span className="font-numeral text-[17px] font-semibold leading-none tabular-nums text-atelier-accent">
            {creditsAvailable}
          </span>
          <span className="min-w-0 text-[10px] font-medium uppercase leading-[1.2] tracking-widest text-atelier-muted max-[419px]:max-w-[5.25rem]">
            {g.creditsLabel}
          </span>
        </div>
        <div className="-mr-[15px] flex flex-shrink-0 items-center">
          <button
            type="button"
            onClick={() => setTranscriptOpen((v) => !v)}
            aria-label={g.sessionTranscript}
            aria-pressed={transcriptOpen}
            title={g.sessionTranscript}
            className={cn(
              "flex h-11 w-11 items-center justify-center rounded-full transition-colors",
              transcriptOpen ? "text-atelier-accent" : "text-atelier-muted hover:text-atelier-ink",
            )}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" className="h-[18px] w-[18px]" aria-hidden>
              <path d="M4 6h16M4 12h10M4 18h7" />
            </svg>
          </button>
          {hasAnyMessages && (
            <button
              type="button"
              onClick={() => {
                // The same detach-then-reset as the slate's New chat.
                if (canDetach) detachLiveRender();
                resetChat();
              }}
              disabled={locked && !canDetach}
              aria-label={g.newChat}
              title={g.newChat}
              className="flex h-11 w-11 items-center justify-center rounded-full text-atelier-muted transition-colors hover:text-atelier-ink disabled:opacity-40"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" className="h-[18px] w-[18px]" aria-hidden>
                <path d="M12 20h9" />
                <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" />
              </svg>
            </button>
          )}
        </div>
      </div>
    )}
    {stagePanel}
    {!isHero && !premiereShown && <div className="mb-4 md:hidden">{filmstrip("page")}</div>}
    <div
      className={cn(
        "relative flex flex-col transition-all duration-300 ease-out md:static",
        // Phones: this column (the transcript, the fixed dock, then the
        // disclaimer) sits at the END of the page's minimum height.
        !isHero && "max-md:mt-auto",
        // Docked is a plain column now — the glass card belongs to the
        // transcript and the composer individually, not to one shell
        // around everything.
        isHero && "min-h-[60vh] items-center justify-center gap-6",
        justArrived && "transition-opacity duration-[220ms] ease-out",
        justArrived && !settled && "opacity-0",
      )}
    >
      {isHero && <h1 className="text-2xl font-semibold text-atelier-ink">{greeting}</h1>}

      {!isHero && transcriptOpen && (
      <>
      {/* The Session transcript — the chat thread in its own glass card,
          opened from the filmstrip's toggle (and forced open by an Ask
          answer, a failed render, or ?resume= — see transcriptOpen). */}
      <div
        className={cn(
          "isolate relative mb-4 transform-gpu rounded-[26px] bg-atelier-surface/80 backdrop-blur-xl",
          // From md up it is a drawer down the screen's right side: over the
          // room below lg (where a 420px column would leave the take
          // nothing), beside it from lg, where the media box makes way.
          "md:absolute md:inset-x-4 md:bottom-[calc(var(--dock-h)+22px)] md:top-[86px] md:z-20 md:mb-0 md:overflow-hidden",
          "lg:left-auto lg:right-4 lg:w-[420px]",
        )}
      >
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 -z-10 rounded-[26px] shadow-[0_0_0_1px_var(--frost-ring),0_2px_6px_rgba(0,0,0,0.04),0_24px_56px_-20px_rgba(0,0,0,0.22)] [-webkit-mask-image:-webkit-radial-gradient(white,black)]"
        />
      <div ref={transcriptScrollRef} className="min-h-[280px] space-y-7 p-6 md:h-full md:overflow-y-auto md:overscroll-contain">
        {!hasAnyMessages ? (
          creationModeActive ? (
            <div className="flex flex-col items-center gap-3 py-10 text-center">
              <div className="flex h-12 w-12 items-center justify-center rounded-media bg-atelier-ink text-atelier-paper">
                {contentType === "video" ? <VideoIcon className="h-5 w-5" /> : <ImageIcon className="h-5 w-5" />}
              </div>
              <div>
                <h2 className="text-lg font-semibold text-atelier-ink">
                  {contentType === "video" ? g.createVideosTitle : g.createImagesTitle}
                </h2>
                <p className="mt-1 text-sm text-atelier-muted">{g.createModeSubtitle}</p>
              </div>
            </div>
          ) : (
            <p className="py-10 text-center text-sm text-atelier-muted">
              {nativeClient ? g.noMessagesNative : g.noMessages}
            </p>
          )
        ) : (
          <>
            {items.map((item) =>
              item.kind === "ask" ? (
                <AskTurnBubble key={item.id} item={item} onRenderThis={fillComposer} />
              ) : item.kind === "single" ? (
                <SingleTurnBubble key={item.id} turn={item} domId={`take-${item.id}`} onGenerateAnyway={generateAnyway} onRetryPhotoreal={retryOnPhotorealModel} />
              ) : (
                <MultiAngleTurnBubble key={item.groupId} item={item} domId={`take-${item.groupId}`} />
              ),
            )}

            {liveAsk && <AskLiveBubble question={liveAsk.question} answer={liveAsk.answer} />}

            {liveMultiAngle && (
              <div className="space-y-3">
                <UserBubble prompt={liveMultiAngle.prompt} attachments={liveMultiAngle.attachments} />
                <div className="flex justify-start">
                  <div className="max-w-[90%] rounded-[18px] rounded-bl-[6px] bg-atelier-surface px-4.5 py-4 shadow-[0_1px_2px_rgba(33,29,22,0.05),0_8px_20px_-14px_rgba(33,29,22,0.12)]">
                    <div className="flex items-center gap-2 text-sm text-atelier-muted">
                      <LoaderIcon className="h-4 w-4" />
                      {liveMultiAngle.angleIds.length === 1
                        ? g.generatingAngleOne
                        : formatMsg(g.generatingAngleOther, { n: liveMultiAngle.angleIds.length })}
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* Renders re-attached to on mount — the reopened-app case. Same
                bubble anatomy as the live turn below, with a per-job Stop. */}
            {resumedJobs.map((job) => (
              <div key={job.id} className="space-y-3">
                <UserBubble prompt={job.prompt} />
                <div className="flex justify-start">
                  <div className="group max-w-[90%] rounded-[18px] rounded-bl-[6px] bg-atelier-surface px-4.5 py-4 shadow-[0_1px_2px_rgba(33,29,22,0.05),0_8px_20px_-14px_rgba(33,29,22,0.12)]">
                    <div className="flex items-center gap-3 text-sm text-atelier-muted">
                      <LoaderIcon className="h-4 w-4" />
                      <span>{job.progress ? localizeServerText(job.progress, t) : g.resumingRender}</span>
                      <button
                        type="button"
                        onClick={() => stopResumedJob(job.id)}
                        disabled={job.stopping}
                        className="rounded-control border border-atelier-rule px-2.5 py-1 text-xs text-atelier-muted transition-colors hover:border-atelier-muted hover:text-atelier-ink disabled:opacity-50"
                      >
                        {job.stopping ? g.stopping : g.stop}
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            ))}

            {livePrompt !== null && (
              <div className="space-y-3">
                <UserBubble prompt={livePrompt} attachments={liveAttachments} />
                <div className="flex justify-start">
                  <div className="group max-w-[90%] rounded-[18px] rounded-bl-[6px] bg-atelier-surface px-4.5 py-4 shadow-[0_1px_2px_rgba(33,29,22,0.05),0_8px_20px_-14px_rgba(33,29,22,0.12)]">
                    {liveTimeline.length === 0 && !liveResult && (
                      // The server call itself (draft + review + the actual
                      // generation) can take anywhere from several seconds to
                      // a few minutes for real video/image providers, and
                      // nothing else renders in this bubble until it resolves
                      // — without this, the bubble just sits empty and looks
                      // frozen the whole time.
                      <div className="flex items-center gap-2 text-sm text-atelier-muted">
                        <LoaderIcon className="h-4 w-4" />
                        {/* Once the render is queued, say what it's actually
                            doing. A video can take ten minutes, and a single
                            unchanging "Running pipeline" for that long is
                            indistinguishable from a hang — which is exactly
                            what long generations used to look like before the
                            job survived longer than the request did. */}
                        {liveProgress ? localizeServerText(liveProgress, t) : g.runningPipeline}
                      </div>
                    )}
                    <PipelineTrace
                      timeline={liveTimeline}
                      revealedCount={revealedCount}
                      isAnimating={isAnimating}
                      isLive={liveIsLive}
                    />
                    {liveResult && (
                      <>
                        {liveResult.succeeded ? (
                          <>
                            <ResultMedia
                              succeeded={liveResult.succeeded}
                              resultUrl={liveResult.resultUrl}
                              contentType={liveContentType}
                              prompt={livePrompt ?? undefined}
                              generationId={liveResult.id}
                            />
                            <div className="mt-3 flex items-center gap-2">
                              <Badge tone={liveIsLive ? "success" : "neutral"}>
                                {liveIsLive ? g.live : g.simulated}
                              </Badge>
                              {liveResult.attempts > 1 && (
                                <p className="font-numeral text-xs tabular-nums text-atelier-accent">
                                  {formatMsg(g.passedOnAttempt, { n: liveResult.attempts })}
                                </p>
                              )}
                            </div>
                            {/* Same submitted-type fix as ResultMedia above —
                                promotability belongs to what the request
                                produced, not the toggle's current position. */}
                            <ResultActions generationId={liveResult.id} copyText={liveResult.finalPrompt || livePrompt || ""} promotable={liveContentType === "image"} />
                          </>
                        ) : (
                          <div className="mt-3 space-y-2">
                            <div className="flex items-center gap-2">
                              <Badge tone="danger">{g.couldntValidate}</Badge>
                              <p className="text-xs text-atelier-muted">
                                {liveResult.reason ??
                                  (liveResult.attempts === 1 ? g.noPassingResultOne : formatMsg(g.noPassingResultOther, { n: liveResult.attempts }))}
                              </p>
                            </div>
                            {liveResult.attemptsLog && liveResult.prompt && rulesBlockOf(liveResult.attemptsLog) && (
                              <button
                                type="button"
                                onClick={() => generateAnyway(liveResult.prompt)}
                                className="rounded-full border border-atelier-rule px-3 py-1.5 text-xs font-medium text-atelier-ink transition-colors hover:border-atelier-muted hover:bg-atelier-ink/5"
                              >
                                {g.generateAnyway}
                              </button>
                            )}
                            {(() => {
                              const target =
                                liveResult.attemptsLog && liveResult.prompt
                                  ? likenessRetryTarget(liveResult.attemptsLog)
                                  : null;
                              if (!target) return null;
                              return (
                                <button
                                  type="button"
                                  onClick={() => retryOnPhotorealModel(liveResult.prompt!, target)}
                                  className="rounded-full bg-atelier-ink px-3 py-1.5 text-xs font-medium text-atelier-paper transition-opacity hover:opacity-90"
                                >
                                  {formatMsg(g.retryOnModel, { model: getVideoModel(target).name })}
                                </button>
                              );
                            })()}
                          </div>
                        )}
                      </>
                    )}
                  </div>
                </div>
              </div>
            )}
          </>
        )}
        <div ref={bottomRef} />
      </div>
      </div>
      </>
      )}

      {/* The voice session card sits directly above the composer in BOTH
          layouts now — in the Stage layout the thread can be collapsed, and
          a live mic session must never be invisible (2026-08-24 incident:
          the mic turned on with nothing on screen to show for it). */}
      {voiceSessionCard && (
        <div
          className={cn(
            isHero
              ? "mx-auto w-full max-w-5xl"
              : "mb-3 md:absolute md:inset-x-8 md:bottom-[calc(var(--dock-h)+22px)] md:z-30 md:mx-auto md:mb-0 md:w-auto md:max-w-[880px]",
          )}
        >
          {voiceSessionCard}
        </div>
      )}

      {/* max-w-5xl, matching the app layout's own container.

          These used to be max-w-2xl, which meant the composer jumped from
          672px to 1024px the moment it docked — the hero wrapper fell away and
          the layout's width took over. Submitting a prompt is the worst moment
          for the thing you just typed into to change size. */}
      {/* The raised sheet's scrim (phones): the stage dims behind it, and a
          tap on it lowers the sheet. */}
      {/* A pointer affordance only (aria-hidden): the pull key is the
          sheet's one accessible toggle, so a screen reader never meets a
          second "All settings" that closes instead. */}
      {!isHero && sheetRaised && (
        <button
          type="button"
          aria-hidden
          tabIndex={-1}
          onClick={closeSheet}
          data-closing={sheetClosing ? "" : undefined}
          className="dock-scrim fixed inset-0 z-[36] bg-[#070605]/60 md:hidden"
        />
      )}
      <div
        ref={dockRef}
        data-dock={isHero ? undefined : ""}
        data-sheet={sheetRaised ? "open" : "rest"}
        data-sheet-closing={sheetClosing && !sheetShown ? "" : undefined}
        className={cn(
          "relative z-10",
          // From md up the composer floats over the screen at its bottom
          // rather than sticking to the end of a scrolling column — the
          // screen has no scroll to stick to. --native-tab-bar keeps the
          // native shell's fixed bar clear, exactly as when docked.
          !isHero &&
            "md:absolute md:inset-x-8 md:bottom-[calc(1rem+var(--native-tab-bar,0px))] md:z-40 md:mx-auto md:w-auto md:max-w-[880px]",
          // Docked: the composer floats at the approved board's width —
          // narrower than the stage above it, centered — instead of
          // spanning the whole container (fidelity pass, 2026-09-02).
          // The bottom offset folds in the native shell's fixed tab bar
          // (--native-tab-bar, published by NativeTabBar; 0 on the web) —
          // without it the z-40 bar covered the docked composer's bottom
          // control row, send button included, whenever it was pinned.
          isHero
            ? "mx-auto w-full max-w-5xl"
            : "sticky bottom-[calc(1rem+var(--native-tab-bar,0px))] mx-auto w-full max-w-[880px]",
        )}
      >
        {/* Sits directly on top of the form with no gap, sharing its
            rounded-[22px] outer frame (see UsageBanner's own comment) —
            not a floating card of its own, which is what made two earlier
            passes at this look wrong. */}
        {/* The affordability warning takes precedence over the usage strip:
            "you can't run this" is more urgent than "you're getting low", and
            two stacked banners on top of the composer is one too many.
            Deliberately NOT gated on approachingLimit — someone with plenty of
            allowance can still be short for a 51-credit 30s clip. */}
        {/* Image sends with the free daily slot available are NOT short —
            the server takes the free slot, and the footer pill says so
            ("Uses today's free generation · image"). Showing the red
            shortfall over that pill was a live contradiction (caught
            2026-08-26). Video mode is left exactly as it was: whether the
            free slot covers a given VIDEO model is a server-side rule this
            strip doesn't know, so it keeps warning there. */}
        {policyRefusal ? (
          <PolicyRefusalBanner
            // A different refusal is a new message: remount so it animates in.
            key={policyRefusal}
            message={localizeServerText(policyRefusal, t)}
            hero={isHero}
            dismissLabel={g.dismissBanner}
            onDismiss={() => setError((cur) => (cur === policyRefusal ? "" : cur))}
          />
        ) : !isHero &&
        cannotAfford &&
        !freeTierClient &&
        !blockingFenceVisible &&
        selectedVideoModel ? (
          <InsufficientCreditsBanner
            // Remounts when the selection changes, so dismissing the strip
            // suspends it for THAT selection rather than silencing a
            // different, larger shortfall the person hasn't seen yet. Image
            // mode is its own selection for the same reason.
            key={contentType === "image" ? "image" : `${selectedVideoModel.id}-${videoDurationSeconds}-${sendRenderCount}`}
            needed={sendCreditCost}
            available={creditsAvailable}
            allowExternalPurchase={allowExternalPurchase}
            modelName={selectedVideoModel.name}
            seconds={videoDurationSeconds}
            kind={contentType === "image" ? "image" : "video"}
            // A free-plan account (no monthly allowance) whose daily slot is
            // spent: creditsLimit stays 0 only off-plan, and dailyFreeAvailable
            // is the server's own answer about today's slot. A bonus balance
            // takes an account off the daily lane (onDailyFreeTier), and
            // since 2026-09-23 creditsLimit no longer carries it, so it is
            // asked for by name — else a plan-less grant holder short of a
            // send is promised a free render that is not coming.
            freeReturnsTomorrow={creditsLimit === 0 && bonusCredits === 0 && !dailyFreeAvailable}
          />
        ) : approachingLimit && !isHero ? (
          <UsageBanner used={creditsUsed} limit={creditsLimit} currentPeriodEnd={currentPeriodEnd} g={g} />
        ) : null}


      {/* The fold: while collapsed, the whole composer is a slim pull-up
          bar — top edge visible, shadow above it, freed space to the
          render. Tapping it (or a header chip) restores the composer. */}
      {composerFolded ? (
        <button
          type="button"
          onClick={() => setComposerFolded(false)}
          className={cn(
            "relative z-10 flex w-full flex-col items-center gap-0.5 bg-atelier-surface/90 py-2 shadow-[0_-12px_28px_-16px_rgba(20,22,30,0.3)] backdrop-blur-xl",
            composerBannerVisible ? "rounded-b-[26px]" : "rounded-[18px]",
          )}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4 text-atelier-ink/70">
            <path d="m6 14 6-6 6 6" />
          </svg>
          <span className="text-[9px] font-medium uppercase tracking-widest text-atelier-muted">
            {g.pullUpToEdit}
          </span>
        </button>
      ) : (
      <form
        ref={composerFormRef}
        data-producer-spot="composer"
        onSubmit={handleSubmit}
        className={cn(
          // Borderless everywhere (operator, 2026-08-21 — GPT-style): the
          // frame gets its edge from the shadow ring layer below. Since the
          // Stage redesign the docked composer is a standalone floating
          // card too, not the bottom slab of a chat card — fully rounded
          // unless a banner strip is fused above it.
          "relative z-10 isolate transform-gpu backdrop-blur-xl",
          // Docked, the slate sits tighter to the card's edge — the target
          // height (~230px at 1440×900) is most of what the operator picked
          // the capsule for.
          isHero ? "p-4" : "px-4 pb-3 pt-2.5",
          isHero
            ? cn(
                "bg-atelier-surface/80",
                // Only a refusal strip ever sits on the hero composer.
                composerBannerVisible ? "rounded-b-[28px]" : "rounded-[28px]",
              )
            : cn(
                "bg-atelier-surface/90",
                composerBannerVisible ? "rounded-b-[22px]" : "rounded-[22px]",
              ),
        )}
      >
        {/* Lives inside the form (not the outer wrapper) specifically so its
            absolute "rise from behind" positioning is always anchored to
            the form's own top edge, regardless of whether UsageBanner is
            also rendered above it pushing the form down. */}
        {/* Everything but a prompt-gate refusal, which holds still in the
            banner slot above instead (PolicyRefusalBanner). */}
        {error && !policyRefusal && (
          <ComposerToast key={error} message={localizeServerText(error, t)} onDone={() => setError("")} />
        )}
        {/* Decorative shadow layer, separate from the form itself: the
            Safari shadow-corner mask fix would also clip the "+" dropdown
            and the loadout sheets, which are children of this form and need
            to render outside its bounds when open. */}
        <div
          aria-hidden
          data-dock-ring
          className={cn(
            "pointer-events-none absolute inset-0 -z-10 shadow-[0_0_0_1px_var(--frost-ring),0_2px_6px_rgba(0,0,0,0.04),0_24px_56px_-20px_rgba(0,0,0,0.22)] [-webkit-mask-image:-webkit-radial-gradient(white,black)]",
            isHero
              ? composerBannerVisible
                ? "rounded-b-[28px]"
                : "rounded-[28px]"
              : composerBannerVisible
                ? "rounded-b-[22px]"
                : "rounded-[22px]",
          )}
        />
        {/* The loadout row — the Casting Bar relocated from the old card
            header into the composer itself (A×B redesign): character,
            engine + price, durations and the Send Receipt all live where
            the send happens. The wrapper is the positioning context; both
            sheets open UPWARD here, since the composer sits at the bottom
            of the screen — the same rule the + menu already follows. */}
        {!isHero && (
          <>
            {/* THE SLATE (operator-approved pick, 2026-09-22): the Send
                Receipt band and the loadout chips fused into one ruled row
                of cells — controls first (CAST · ENGINE · LENGTH · FRAME),
                then the receipt half (FACE · OUTFIT), split by hairlines.
                No TOTAL cell: the price lives on the Render key alone,
                quoted by the same sendCreditCost. Rarer receipt entries
                render as mono statements in a wrap line under the row, and
                the resolver's warn/block rows keep their full-width rows
                with their one-tap remedies — same module, new geometry.

                On a phone the row wraps into two runs: the controls, then
                the receipt half on its own ruled line. The .relative wrapper
                stays the anchor, so the casting sheet, the photo menu and
                the engine sheet still open bar-wide above the row. */}
          <div className="mb-1" data-slate>
            {/* The sheet's handle (phones only): the grabber band across
                the dock's top edge and the pull key at the values line's
                end — both raise and lower the sheet. The pull key doubles
                as the modes' tour anchor while they rest inside it. */}
            <button
              type="button"
              tabIndex={-1}
              aria-hidden
              onPointerDown={(e) => {
                grabStartY.current = e.clientY;
                grabSwiped.current = false;
                e.currentTarget.setPointerCapture?.(e.pointerId);
              }}
              onPointerUp={(e) => {
                const start = grabStartY.current;
                grabStartY.current = null;
                if (start === null) return;
                const dy = e.clientY - start;
                if (dy < -24) {
                  grabSwiped.current = true;
                  if (!sheetOpen) openSheet();
                } else if (dy > 24) {
                  grabSwiped.current = true;
                  if (sheetOpen) closeSheet();
                }
              }}
              onPointerCancel={() => {
                grabStartY.current = null;
              }}
              onClick={() => {
                if (grabSwiped.current) {
                  grabSwiped.current = false;
                  return;
                }
                toggleSheet();
              }}
              className="dock-grabber absolute inset-x-0 z-[1] touch-none md:hidden"
            />
            <div className="relative" data-slate-box>
              <button
                type="button"
                data-dock-pull
                data-tour-id={contentType === "video" ? "tour-advanced-toggle" : undefined}
                onClick={() => {
                  setFrameSheetOpen(false);
                  toggleSheet();
                }}
                aria-label={g.composerMore}
                aria-expanded={sheetShown}
                title={g.composerMore}
                className="absolute right-0 top-0 z-[2] flex h-11 w-11 items-center justify-center rounded-full text-atelier-ink shadow-[inset_0_0_0_1px_var(--color-atelier-rule)] transition-colors hover:bg-atelier-ink/[0.05] md:hidden"
              >
                <ChevronDownIcon
                  className={cn(
                    "h-4 w-4 transition-transform duration-200 motion-reduce:transition-none",
                    !sheetShown && "rotate-180",
                  )}
                />
              </button>
              <div className="flex min-w-0 flex-wrap items-stretch" data-slate-row>
                {/* max-sm:basis-full on BOTH runs: with flex-1's zero basis
                    alone, the receipt's 100% basis still fit on one line and
                    crushed the controls to nothing (measured at 390). */}
                <div className="flex min-w-0 flex-1 items-stretch max-lg:flex-wrap max-lg:basis-full" data-slate-controls>
                {characterPicker}
                {videoModelPicker}
                {imageModelPicker}
                {imageSizePicker}
                {imageFramePicker}
                {imageQualityPicker}
                {/* Image mode on a phone, at rest: the Outfit toggle rides
                    the values line beside the cast (the same toggle as the
                    chip below, which the raised sheet shows with its whole
                    sentence). */}
                {contentType === "image" && outfitChipAvailable && currentCharacter && (
                  <div className="hidden flex-shrink-0 items-center gap-2" data-dock-outfit>
                    <span aria-hidden className="h-3.5 w-px flex-shrink-0 bg-atelier-rule/70" />
                    <button
                      type="button"
                      onClick={() => setUseOutfit((v) => !v)}
                      aria-pressed={useOutfit}
                      className={cn(
                        // A value key like its neighbours (no fill — filled
                        // pills are the lit chips, which raise the sheet):
                        // accent + check when the outfit rides along.
                        "flex h-11 items-center gap-1.5 rounded-[10px] px-2 transition-colors hover:bg-atelier-ink/[0.05]",
                        useOutfit ? "text-atelier-accent" : "text-atelier-muted",
                      )}
                    >
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-3.5 w-3.5 flex-shrink-0" aria-hidden>
                        <path d="M20.4 6 16 4l-4 2.5L8 4 3.6 6l1.9 4.6 2-.7V20h9v-10l2 .6z" />
                      </svg>
                      {g.outfitChip}
                      {useOutfit && <CheckIcon className="h-3 w-3 flex-shrink-0" />}
                    </button>
                  </div>
                )}
                {/* FRAME — the real two-way aspect toggle, drawn to ratio;
                    neither lit = the prompt decides, and the cell SAYS so
                    now ("Automatic" / the pressed ratio word) like every
                    other cell's value. Below lg the cell takes its own ruled
                    run, which is what lets the ratio words and the 44px hit
                    areas fit at 390 (addendum §1). */}
                {contentType === "video" && (
                  <div className="flex flex-shrink-0 items-stretch max-lg:mt-0.5 max-lg:basis-full max-lg:border-t max-lg:border-atelier-rule/60 max-lg:pt-0.5" data-slate-frame>
                    <span aria-hidden className="my-2 w-px flex-shrink-0 self-stretch bg-atelier-rule/70 max-lg:hidden" />
                    <div className="flex flex-col justify-center gap-1 px-2.5 py-1.5 max-sm:px-1.5 sm:px-3">
                      <span className="text-[9.5px] font-medium uppercase tracking-widest text-atelier-muted">
                        {g.slateFrame}
                      </span>
                      <div className="flex items-center gap-1">
                        {(["16:9", "9:16"] as const).map((ar) => (
                          <button
                            key={ar}
                            type="button"
                            disabled={submitting}
                            onClick={() => setVideoAspectRatio((prev) => (prev === ar ? null : ar))}
                            title={ar === "16:9" ? g.aspectWideTitle : g.aspectTallTitle}
                            aria-label={ar === "16:9" ? g.aspectWideTitle : g.aspectTallTitle}
                            aria-pressed={videoAspectRatio === ar}
                            className={cn(
                              "relative flex h-[22px] items-center gap-1 rounded-[6px] px-1.5 transition-colors disabled:opacity-50 before:absolute before:-inset-y-[11px] before:inset-x-0 before:content-[''] lg:before:content-none",
                              videoAspectRatio === ar
                                ? "bg-atelier-accent/10 text-atelier-accent shadow-[inset_0_0_0_1px_rgba(224,164,104,0.45)]"
                                : "text-atelier-muted/80 shadow-[inset_0_0_0_1px_var(--color-atelier-rule)] hover:text-atelier-ink",
                            )}
                          >
                            {ar === "16:9" ? (
                              <LandscapeIcon className="h-3.5 w-3.5" />
                            ) : (
                              <PortraitIcon className="h-3.5 w-3.5" />
                            )}
                            <span className="text-[10.5px] font-medium tabular-nums">{ar}</span>
                          </button>
                        ))}
                        <span className="ml-1 text-[12.5px] leading-tight text-atelier-ink/75">
                          {videoAspectRatio ?? t.settings.aspectAuto}
                        </span>
                      </div>
                    </div>
                  </div>
                )}
                {/* FRAME at rest on a phone: one value key — the frame glyph,
                    then the real state in words ("Automatic" or the pressed
                    ratio) — opening a small sheet with the same two toggles,
                    worded. The slate's FRAME cell above is the raised
                    sheet's; both drive videoAspectRatio. */}
                {contentType === "video" && (
                  <div className="hidden flex-shrink-0 items-stretch" data-dock-frame>
                    <span aria-hidden className="w-px flex-shrink-0 bg-atelier-rule/70" data-dock-tick />
                    <button
                      type="button"
                      disabled={submitting}
                      onClick={() => {
                        setCharacterMenuOpen(false);
                        setPhotoMenuOpen(false);
                        setVideoModelMenuOpen(false);
                        setDurationMenuOpen(false);
                        setFrameSheetOpen((v) => !v);
                      }}
                      aria-haspopup="dialog"
                      aria-expanded={frameSheetOpen}
                      aria-label={`${g.slateFrame}: ${videoAspectRatio ?? t.settings.aspectAuto}`}
                      className={cn(
                        "flex h-11 min-w-0 items-center gap-1.5 rounded-[10px] px-2 text-[13px] leading-none text-atelier-ink/85 transition-colors disabled:opacity-50",
                        frameSheetOpen ? "bg-atelier-ink/[0.07]" : "hover:bg-atelier-ink/[0.05]",
                      )}
                    >
                      {videoAspectRatio === "9:16" ? (
                        <PortraitIcon className="h-3.5 w-3.5 flex-shrink-0 text-atelier-muted" />
                      ) : videoAspectRatio === "16:9" ? (
                        <LandscapeIcon className="h-3.5 w-3.5 flex-shrink-0 text-atelier-muted" />
                      ) : (
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" className="h-3.5 w-3.5 flex-shrink-0 text-atelier-muted" aria-hidden>
                          <path d="M4 8V5.5A1.5 1.5 0 0 1 5.5 4H8M16 4h2.5A1.5 1.5 0 0 1 20 5.5V8M20 16v2.5a1.5 1.5 0 0 1-1.5 1.5H16M8 20H5.5A1.5 1.5 0 0 1 4 18.5V16" />
                        </svg>
                      )}
                      <span className="truncate">{videoAspectRatio ?? t.settings.aspectAuto}</span>
                    </button>
                    {frameSheetOpen && (
                      <div
                        role="dialog"
                        aria-label={g.slateFrame}
                        className="absolute bottom-full right-0 z-30 mb-2 w-[min(300px,calc(100vw-32px))] rounded-[16px] bg-atelier-paper p-2 shadow-[0_0_0_1px_var(--frost-ring),0_24px_48px_-12px_rgba(0,0,0,0.35)] backdrop-blur-xl"
                      >
                        <p className="px-2 pb-1.5 pt-1 text-[9.5px] font-medium uppercase tracking-widest text-atelier-muted">
                          {g.slateFrame}
                        </p>
                        {/* Automatic is a row of its own (checked while
                            neither ratio is pressed), so the footnote only
                            explains it instead of repeating its name. */}
                        {([null, "16:9", "9:16"] as const).map((ar) => (
                          <button
                            key={ar ?? "auto"}
                            type="button"
                            disabled={submitting}
                            onClick={() => {
                              setVideoAspectRatio((prev) => (ar === null || prev === ar ? null : ar));
                              setFrameSheetOpen(false);
                            }}
                            title={ar === null ? t.settings.aspectAuto : ar === "16:9" ? g.aspectWideTitle : g.aspectTallTitle}
                            aria-label={ar === null ? t.settings.aspectAuto : ar === "16:9" ? g.aspectWideTitle : g.aspectTallTitle}
                            aria-pressed={videoAspectRatio === ar}
                            className={cn(
                              "flex h-11 w-full items-center gap-2.5 rounded-[10px] px-2.5 text-left text-[14px] transition-colors disabled:opacity-50",
                              videoAspectRatio === ar
                                ? "bg-atelier-accent/10 text-atelier-accent"
                                : "text-atelier-ink hover:bg-atelier-ink/[0.05]",
                            )}
                          >
                            {ar === null ? (
                              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4 flex-shrink-0" aria-hidden>
                                <path d="M4 8V5.5A1.5 1.5 0 0 1 5.5 4H8M16 4h2.5A1.5 1.5 0 0 1 20 5.5V8M20 16v2.5a1.5 1.5 0 0 1-1.5 1.5H16M8 20H5.5A1.5 1.5 0 0 1 4 18.5V16" />
                              </svg>
                            ) : ar === "16:9" ? (
                              <LandscapeIcon className="h-4 w-4 flex-shrink-0" />
                            ) : (
                              <PortraitIcon className="h-4 w-4 flex-shrink-0" />
                            )}
                            <span className="flex-1">
                              {ar === null
                                ? t.settings.aspectAuto
                                : ar === "16:9"
                                  ? t.settings.aspectLandscape
                                  : t.settings.aspectPortrait}
                            </span>
                            {videoAspectRatio === ar && <CheckIcon className="h-3.5 w-3.5 flex-shrink-0" />}
                          </button>
                        ))}
                        <p className="px-2.5 pb-1 pt-2 text-[11.5px] leading-snug text-atelier-muted">
                          {t.settings.aspectHelp}
                        </p>
                      </div>
                    )}
                  </div>
                )}
                </div>
                {/* The receipt half of the slate: FACE is a read-only cell
                    (muted ink, no chevron, no hover — the photo choice
                    itself opens from the CAST cell); OUTFIT is the toggle
                    chip become a cell, pressable with the same aria-pressed
                    state. On a phone this half takes its own ruled run. */}
                {contentType === "video" && (facePart !== null || outfitCellShown) && (
                  <div className="flex min-w-0 items-stretch max-lg:mt-0.5 max-lg:basis-full max-lg:border-t max-lg:border-atelier-rule/60 max-lg:pt-0.5" data-slate-receipt>
                    <span aria-hidden className="my-2 hidden w-px flex-shrink-0 self-stretch bg-atelier-rule/70 lg:block" />
                    {facePart && (
                      <div className="flex min-w-0 flex-col justify-center gap-1 px-2.5 py-1.5 max-sm:px-1 sm:px-3">
                        <span className="text-[9.5px] font-medium uppercase tracking-widest text-atelier-muted/80">
                          {facePart.label ?? g.receiptFace}
                        </span>
                        <span className="flex min-w-0 items-center gap-1 text-[12.5px] leading-tight text-atelier-ink/75">
                          <span className="truncate">{facePart.value}</span>
                          {facePart.ok && (
                            <CheckIcon className="h-3 w-3 flex-shrink-0 text-atelier-accent" />
                          )}
                        </span>
                      </div>
                    )}
                    {outfitCellShown && (
                      <div className="flex min-w-0 items-stretch">
                        {facePart && (
                          <span aria-hidden className="my-2 w-px flex-shrink-0 self-stretch bg-atelier-rule/70" />
                        )}
                        {outfitChipAvailable ? (
                          <button
                            type="button"
                            onClick={() => setUseOutfit((v) => !v)}
                            aria-pressed={useOutfit}
                            className="flex min-w-0 flex-col justify-center gap-1 rounded-[10px] px-2.5 py-1.5 text-left transition-colors hover:bg-atelier-ink/[0.05] max-sm:px-1.5 sm:px-3"
                          >
                            <span className="flex items-center gap-1.5 text-[9.5px] font-medium uppercase tracking-widest text-atelier-muted">
                              {g.receiptOutfit}
                              <span
                                aria-hidden
                                className={cn(
                                  "relative h-[9px] w-4 flex-shrink-0 rounded-full transition-colors",
                                  useOutfit ? "bg-atelier-accent/35" : "bg-atelier-ink/15",
                                )}
                              >
                                <span
                                  className={cn(
                                    "absolute left-[1.5px] top-[1.5px] h-1.5 w-1.5 rounded-full transition-transform",
                                    useOutfit ? "translate-x-[7px] bg-atelier-accent" : "bg-atelier-muted",
                                  )}
                                />
                              </span>
                            </span>
                            <span className="flex min-w-0 items-center gap-1 text-[12.5px] leading-tight text-atelier-ink/75">
                              <span className="truncate">{outfitCellValue}</span>
                              {outfitPart?.ok && (
                                <CheckIcon className="h-3 w-3 flex-shrink-0 text-atelier-accent" />
                              )}
                              {outfitFootnote && (
                                <sup className="text-[10px] leading-none text-atelier-accent" data-foot-mark>*</sup>
                              )}
                            </span>
                          </button>
                        ) : (
                          <div className="flex min-w-0 flex-col justify-center gap-1 px-2.5 py-1.5 sm:px-3">
                            <span className="text-[9.5px] font-medium uppercase tracking-widest text-atelier-muted/80">
                              {g.receiptOutfit}
                            </span>
                            <span className="flex min-w-0 items-center gap-1 text-[12.5px] leading-tight text-atelier-ink/75">
                              <span className="truncate">{outfitCellValue}</span>
                              {outfitPart?.ok && (
                                <CheckIcon className="h-3 w-3 flex-shrink-0 text-atelier-accent" />
                              )}
                            </span>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
            {/* Lit chips (phones, at rest): whatever is switched on in the
                sheet stays in sight while the sheet is down — a state is
                never hidden while it is active. Each chip raises the sheet
                where its real control lives. */}
            {litChips.length > 0 && (
              <div className="mt-2 hidden flex-wrap gap-1.5 pr-12" data-dock-lit>
                {litChips.map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    onClick={openSheet}
                    className="relative flex h-9 max-w-full items-center gap-1 rounded-full bg-atelier-accent/10 px-3 text-[12px] font-medium text-atelier-accent shadow-[inset_0_0_0_1px_color-mix(in_oklab,var(--color-atelier-accent)_45%,transparent)] after:absolute after:inset-x-0 after:top-0 after:-bottom-2 after:content-['']"
                  >
                    <span className="truncate">{c.label}</span>
                  </button>
                ))}
              </div>
            )}
            {/* The footnote row: the outfit reason, whole, never behind a
                hover (phones have none). */}
            {outfitFootnote && (
              <p className="mt-1 border-t border-atelier-rule/50 px-1 pb-0.5 pt-1.5 text-[10.5px] leading-snug text-atelier-muted/85" data-slate-foot>
                <sup className="mr-1 text-atelier-accent">*</sup>
                {outfitFootnote}
              </p>
            )}
            {/* Rare receipt entries — cast, frames, storyboard,
                continuation, scene, prop, reference, rules-off, dropped
                attachments, and the dialogue surcharge — as small mono
                statements. In image mode this line is the whole receipt,
                gated exactly as the old band was (attachments riding or an
                engaged issue). */}
            {(contentType === "video" ? extraParts : showImageReceipt ? receiptParts : []).length > 0 && (
              <div className="mt-1 flex flex-wrap items-baseline gap-x-4 gap-y-1 border-t border-atelier-rule/50 px-1 pb-0.5 pt-1.5">
                {(contentType === "video" ? extraParts : receiptParts).map((p, i) => (
                  <span key={i} className="flex min-w-0 items-baseline gap-1.5 text-[11px] leading-snug">
                    {p.label && (
                      <span className="text-[9px] font-medium uppercase tracking-widest text-atelier-muted/80">
                        {p.label}
                      </span>
                    )}
                    <span
                      className={
                        p.accent
                          ? cn(
                              "font-numeral tabular-nums text-atelier-accent",
                              // A whole sentence (the dialogue surcharge) is
                              // not a figure: on a phone it reads in the sans
                              // face like the lines around it. md+ unchanged.
                              !/^[+\d]/.test(p.value.trim()) && "max-md:font-sans",
                            )
                          : "text-atelier-ink/80"
                      }
                    >
                      {p.value}
                    </span>
                    {p.ok && <CheckIcon className="h-3 w-3 flex-shrink-0 self-center text-atelier-accent" />}
                  </span>
                ))}
              </div>
            )}
            {/* The resolver's verdicts: persistent warn/block rows with
                their one-tap remedies, unchanged (see receipt-strip.tsx).
                The submit-time soft-block behaviour is untouched. */}
            {receiptEngaged && sendPlanNow.issues.length > 0 && (
              <div className="mt-2" data-plan-issues>
                <PlanIssueRows
                  issues={sendPlanNow.issues}
                  g={g}
                  modelName={sendPlanModelName()}
                  onAction={handlePlanAction}
                  hasAttachmentRiding={planHasAttachmentRiding(sendPlanNow)}
                />
              </div>
            )}
            {/* The REFERENCE PHOTO row lived here until direction B
                (2026-09-18): opening the composer grew it by about 85 px,
                and the screen above paid for every pixel — on a 632 px
                window the take shrank to 55 px. The same choice now opens
                from the character's cell and the FACE cell's photo count
                (the photo menu, in characterPicker). */}
            {isMultiCharacter && castMemberMissingPhoto && (
              <p className="mt-1.5 text-xs text-red-500">
                {formatMsg(g.multiCharacterNeedsPhoto, { name: castMemberMissingPhoto.name })}
              </p>
            )}
          </div>
          </>
        )}
        <Label htmlFor="prompt" className="sr-only">
          {g.messageLabel}
        </Label>

        {/* The input chip: NO outline (the old "single crisp 1px ink
            hairline" was exactly the line the operator called too thick —
            removed 2026-08-21, GPT-style). Separation now comes from a soft
            ink-tint fill that works in both themes (ink flips with the
            theme, so the tint does too), deepening slightly on focus.
            There's deliberately NO overflow-hidden here, because the "+"
            menu opens outside this box's bounds. */}
        {/* The Seedance 2.5 photoreal fence now lives in the Send Receipt
            strip (SEEDANCE25_PHOTOREAL warn row with the one-tap switch),
            computed by the same resolver the server parity-checks — the
            ad-hoc banner that used to sit here was deleted in P1. */}
        {/* The attachment-anchor amber fence (2026-08-24) was retired in
            Send Receipt P2: attachments now carry ROLES (Face / Outfit /
            Scene / Not used, classifier-pre-picked, tap to change), so an
            outfit or scenery photo can no longer ambiguously occupy the
            face slot — the confusion the fence lectured about is
            inexpressible. The receipt strip's inventory line still names
            the face source on every send. */}
        {/* Outfit chip (2026-08-24, operator-approved mock): appears only when
            the selected character has saved outfit photos. On by default —
            tap toggles it off for one-off scenes. The caption is honest per
            model: Seedance and image generations get the actual photo as a
            cited reference; the Kling family's endpoints only take person
            references, so there the stored description rides the prompt.
            Image mode only since the slate (2026-09-22): in video mode the
            chip became the slate's OUTFIT cell and its caption the footnote
            row — same strings, same toggle. */}
        {contentType === "image" && outfitChipAvailable && currentCharacter && (
          <div className="mb-2.5 flex flex-wrap items-center gap-2" data-image-outfit>
            <button
              type="button"
              onClick={() => setUseOutfit((v) => !v)}
              aria-pressed={useOutfit}
              className={cn(
                "flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[12px] font-medium transition-colors",
                useOutfit
                  ? "bg-atelier-accent/10 text-atelier-accent"
                  : "bg-transparent text-atelier-muted shadow-[inset_0_0_0_1px_var(--color-atelier-rule)]",
              )}
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" className="h-3.5 w-3.5 flex-shrink-0">
                <path d="M20.4 6 16 4l-4 2.5L8 4 3.6 6l1.9 4.6 2-.7V20h9v-10l2 .6z" />
              </svg>
              {g.outfitChip}
            </button>
            {useOutfit && (
              <span className="min-w-0 text-[11px] leading-snug text-atelier-muted">
                {contentType === "image" ||
                (videoAdvancedMode === "none" &&
                  (videoModelId === "seedance" || videoModelId === "seedance-2"))
                  ? formatMsg(g.outfitAttachNote, { name: currentCharacter.name })
                  : g.outfitDescribeNote}
              </span>
            )}
          </div>
        )}
        {/* Cinema presets (2026-08-26): proven camera moves and film looks.
            Every thumbnail IS that preset's own proof render from the
            validation matrix — nothing unproven gets a chip. Tap toggles;
            the selected block is applied server-side after drafting. */}
        {/* Camera moves & lighting looks (A×B layout integration,
            2026-09-02 — operator: "you forgot to add the camera angles and
            lighting to the new layout"): the strip no longer hides behind a
            lone Presets button — the labeled Camera / Lighting pills in the
            controls row below open it straight onto their tab, and wear the
            armed preset's name. This block is now just the tabs + chips. */}
        {cinemaPresetsAvailable && presetRowOpen && (
          <div className="mb-2.5" data-preset-row>
            {(() => {
              const provenPresets = CINEMA_PRESETS.filter(isProvenPreset);
              const tabs = (["move", "look", "fx"] as const).filter((cat) =>
                provenPresets.some((p) => p.category === cat),
              );
              const activeTab = tabs.includes(presetTab) ? presetTab : tabs[0];
              const tabLabels: Record<CinemaPresetCategory, string> = {
                move: g.presetTabCamera,
                look: g.presetTabLight,
                fx: g.presetTabFx,
              };
              return (
                <>
                  {tabs.length > 1 && (
                    <div className="mt-2 flex items-center gap-1">
                      {tabs.map((cat) => (
                        <button
                          key={cat}
                          type="button"
                          onClick={() => setPresetTab(cat)}
                          aria-pressed={activeTab === cat}
                          className={cn(
                            "rounded-full px-2.5 py-1 text-[10.5px] font-medium transition-colors",
                            activeTab === cat
                              ? "bg-atelier-ink text-atelier-paper"
                              : "text-atelier-muted hover:text-atelier-ink",
                          )}
                        >
                          {tabLabels[cat]}
                        </button>
                      ))}
                    </div>
                  )}
                  <div
                    className="mt-2 flex items-center gap-2.5 overflow-x-auto pb-1"
                    onScroll={() => setPresetPreview(null)}
                  >
                  {provenPresets.filter((p) => p.category === activeTab).map((p) => {
                const selected = cinemaPresetIds[p.category] === p.id;
                const label =
                  (g.cinemaPresetLabels as Record<string, string>)[p.id] ?? p.id;
                return (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() =>
                      setCinemaPresetIds((prev) => ({ ...prev, [p.category]: selected ? undefined : p.id }))
                    }
                    // onMouseMove too, not just enter: the row can shift
                    // (selection pin, note line) between enter and paint,
                    // and a cached rect then points at yesterday's layout —
                    // the live refresh keeps the tooltip glued to the chip.
                    onMouseEnter={(e) => {
                      const r = e.currentTarget.getBoundingClientRect();
                      setPresetPreview({ id: p.id, left: r.left + r.width / 2, topY: r.top, bottomY: r.bottom });
                    }}
                    onMouseMove={(e) => {
                      const r = e.currentTarget.getBoundingClientRect();
                      setPresetPreview({ id: p.id, left: r.left + r.width / 2, topY: r.top, bottomY: r.bottom });
                    }}
                    onMouseLeave={() => setPresetPreview(null)}
                    aria-pressed={selected}
                    className="group flex flex-shrink-0 flex-col items-center gap-1"
                  >
                    <span
                      className={cn(
                        "block h-11 w-[74px] overflow-hidden rounded-[10px] transition-shadow",
                        selected
                          ? "shadow-[0_0_0_2px_var(--color-atelier-accent)]"
                          : "shadow-[inset_0_0_0_1px_var(--color-atelier-rule)] group-hover:shadow-[0_0_0_1.5px_var(--color-atelier-muted)]",
                      )}
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={`/presets/${p.id}.jpg`}
                        alt=""
                        loading="lazy"
                        className="h-full w-full object-cover"
                      />
                    </span>
                    <span
                      className={cn(
                        "max-w-[78px] truncate text-[10.5px] leading-tight",
                        selected ? "font-medium text-atelier-accent" : "text-atelier-muted",
                      )}
                    >
                      {label}
                    </span>
                  </button>
                );
              })}
                  </div>
                </>
              );
            })()}
            {/* Hover tooltip preview: the hovered chip's proof clip — the
                exact validation render behind its thumbnail — floating above
                the chip like a rich tooltip. pointer-events-none so it can
                never steal the hover it depends on. */}
            {presetRowOpen && presetPreview && createPortal(
              <div
                className="pointer-events-none fixed z-40"
                style={
                  presetPreview.topY < 240
                    ? { left: presetPreview.left, top: presetPreview.bottomY + 8, transform: "translateX(-50%)" }
                    : { left: presetPreview.left, top: presetPreview.topY - 8, transform: "translate(-50%, -100%)" }
                }
              >
                <video
                  key={presetPreview.id}
                  src={`/presets/${presetPreview.id}.mp4`}
                  autoPlay
                  muted
                  loop
                  playsInline
                  className="aspect-video w-64 rounded-[12px] bg-black shadow-[0_0_0_1px_var(--frost-ring),0_24px_48px_-12px_rgba(0,0,0,0.35)]"
                />
              </div>,
              // Portalled to <body> on purpose: the composer's frosted
              // ancestors (backdrop-filter / transforms) hijack position:
              // fixed into ancestor-relative coordinates — the tooltip
              // rendered offset and below until it escaped the subtree.
              document.body,
            )}
            {presetRowOpen && armedPresetIds.length > 0 && (
              <p className="mt-1 text-[11px] leading-snug text-atelier-muted">{g.cinemaPresetNote}</p>
            )}
          </div>
        )}
        <div
          data-tour-id="tour-prompt"
          className={cn(
            "rounded-[14px] transition-colors",
            // The board runs the prompt bare on the card; hero keeps the
            // soft chip fill it always had. Docked, the slate's script
            // lines (ACTION, DIALOGUE) hang from a rule under the cells.
            isHero
              ? "bg-atelier-ink/[0.045] focus-within:bg-atelier-ink/[0.07]"
              : "rounded-none border-t border-atelier-rule/60",
          )}
        >
          {/* Hidden while the render is in flight: the staged plan is kept
              (a stop or a rejected send brings the panel back for retry),
              but its Render button must not share the screen with a running
              render it could double-charge. */}
          {pendingScene && !submitting ? (
            <div className="space-y-3 p-4">
              <div>
                <p className="text-xs font-medium uppercase tracking-widest text-atelier-muted">
                  {g.sceneIdeaLabel}
                </p>
                <p className="mt-1 text-sm text-atelier-ink/80">{pendingScene.prompt}</p>
              </div>

              {!scenePlan ? (
                <div className="space-y-3">
                  <div>
                    <p className="text-xs font-medium uppercase tracking-widest text-atelier-muted">
                      {g.sceneShotsLabel}
                    </p>
                    <div className="mt-2 flex gap-2">
                      {[2, 3, 4, 5, 6].map((n) => (
                        <button
                          key={n}
                          type="button"
                          onClick={() => setSceneShotCount(n)}
                          disabled={scenePlanning}
                          aria-pressed={sceneShotCount === n}
                          className={cn(
                            "h-9 w-9 rounded-control border text-sm transition-colors disabled:opacity-50",
                            sceneShotCount === n
                              ? "border-atelier-ink bg-atelier-surface text-atelier-ink"
                              : "border-atelier-rule text-atelier-muted hover:border-atelier-muted hover:text-atelier-ink",
                          )}
                        >
                          {n}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div className="flex items-center justify-end gap-2 pt-1">
                    <button
                      type="button"
                      onClick={exitSceneMode}
                      className="rounded-control px-3.5 py-2 text-sm text-atelier-muted transition-colors hover:bg-atelier-ink/5"
                    >
                      {g.cancel}
                    </button>
                    <button
                      type="button"
                      onClick={planCurrentScene}
                      disabled={scenePlanning}
                      className="flex items-center gap-2 rounded-control bg-atelier-ink px-4 py-2 text-sm font-medium text-atelier-paper transition-opacity hover:opacity-90 disabled:opacity-40"
                    >
                      {scenePlanning && <LoaderIcon className="h-3.5 w-3.5" />}
                      {scenePlanning ? g.scenePlanning : g.scenePlanAction}
                    </button>
                  </div>
                </div>
              ) : (
                <div className="space-y-3">
                  <div>
                    <p className="text-xs font-medium uppercase tracking-widest text-atelier-muted">
                      {scenePlan.title}
                    </p>
                    <ol className="mt-2 space-y-1.5">
                      {scenePlan.shots.map((shot, i) => (
                        <li
                          key={i}
                          className="flex gap-2.5 rounded-control border border-atelier-rule px-2.5 py-2 text-sm"
                        >
                          <span className="mt-0.5 text-xs tabular-nums text-atelier-muted">{i + 1}</span>
                          <span className="min-w-0 flex-1">
                            <span className="block text-atelier-ink/85">{shot.prompt}</span>
                            {/* The seconds render unconditionally — nesting
                                them inside the move meant a shot the director
                                gave no camera move simply had no length shown,
                                which is the one number that explains the
                                price. */}
                            <span className="mt-0.5 block text-xs text-atelier-muted">
                              {shot.movePresetId ? `${shot.movePresetId} · ` : ""}
                              {shot.seconds}s
                            </span>
                          </span>
                        </li>
                      ))}
                    </ol>
                  </div>
                  {/* The full price of the whole scene, before anything is
                      spent — through the same function the server charges
                      with. */}
                  <p className="text-xs text-atelier-muted">
                    {formatMsg(g.sceneCost, {
                      shots: scenePlan.shots.length,
                      seconds: scenePlan.shots.reduce((t, sh) => t + sh.seconds, 0),
                      credits: sendQuote.totalCredits,
                    })}
                  </p>
                  <div className="flex items-center justify-end gap-2 pt-1">
                    <button
                      type="button"
                      onClick={() => setScenePlan(null)}
                      className="rounded-control px-3.5 py-2 text-sm text-atelier-muted transition-colors hover:bg-atelier-ink/5"
                    >
                      {g.sceneReplan}
                    </button>
                    <button
                      type="button"
                      onClick={confirmScene}
                      disabled={cannotAfford || submitting}
                      className="rounded-control bg-atelier-ink px-4 py-2 text-sm font-medium text-atelier-paper transition-opacity hover:opacity-90 disabled:opacity-40"
                    >
                      {formatMsg(g.sceneRender, { n: scenePlan.shots.length })}
                    </button>
                  </div>
                </div>
              )}
            </div>
          ) : pendingMultiAngle ? (

            <div className="space-y-3 p-4">
              <div>
                <p className="text-xs font-medium uppercase tracking-widest text-atelier-muted">
                  {g.multiAnglePromptLabel}
                </p>
                <p className="mt-1 text-sm text-atelier-ink/80">{pendingMultiAngle.prompt}</p>
              </div>

              <div>
                <p className="text-xs font-medium uppercase tracking-widest text-atelier-muted">{g.anglesLabel}</p>
                <div className="mt-2 grid grid-cols-3 gap-2 sm:grid-cols-5">
                  {ANGLE_PRESETS.map((preset) => {
                    const checked = selectedAngles.includes(preset.id);
                    return (
                      <button
                        key={preset.id}
                        type="button"
                        onClick={() => toggleAngle(preset.id)}
                        className={cn(
                          "flex flex-col items-center gap-1 rounded-control border px-2 py-2.5 text-xs transition-colors",
                          checked
                            ? "border-atelier-ink bg-atelier-surface text-atelier-ink"
                            : "border-atelier-rule text-atelier-muted hover:border-atelier-muted hover:text-atelier-ink",
                        )}
                      >
                        <span>{preset.label}</span>
                        {checked && <CheckIcon className="h-3 w-3" />}
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="flex items-center justify-end gap-2 pt-1">
                <button
                  type="button"
                  onClick={cancelMultiAngle}
                  className="rounded-control px-3.5 py-2 text-sm text-atelier-muted transition-colors hover:bg-atelier-ink/5"
                >
                  {g.cancel}
                </button>
                <button
                  type="button"
                  onClick={() => confirmMultiAngle()}
                  disabled={selectedAngles.length === 0 || submitting}
                  className="rounded-control bg-atelier-ink px-4 py-2 text-sm font-medium text-atelier-paper transition-opacity hover:opacity-90 disabled:opacity-40"
                >
                  {selectedAngles.length === 1 ? g.generateAngleOne : formatMsg(g.generateAngleOther, { n: selectedAngles.length })}
                </button>
              </div>
            </div>
          ) : (
            <>
              {continueFromId && contentType === "video" && (
                <div className="flex flex-wrap gap-2 px-3 pt-3">
                  <span className="flex items-center gap-1.5 rounded-full border border-atelier-rule bg-atelier-surface px-2.5 py-1 text-xs text-atelier-ink">
                    <VideoIcon className="h-3.5 w-3.5 text-atelier-muted" />
                    {g.continuingFromClip}
                    <button
                      type="button"
                      onClick={() => setContinueFromId(null)}
                      aria-label={g.cancel}
                      className="ml-0.5 rounded-full p-0.5 text-atelier-muted transition-colors hover:bg-atelier-ink/5 hover:text-atelier-ink"
                    >
                      <XIcon className="h-3 w-3" />
                    </button>
                  </span>
                </div>
              )}
              {pendingAttachments.length > 0 && (
                <div className="flex flex-wrap gap-2 px-3 pt-3">
                  {pendingAttachments.map((att) => (
                    <PendingAttachmentChip key={att.id} attachment={att} onRemove={() => removeAttachment(att.id)} />
                  ))}
                </div>
              )}

              {videoAdvancedMode !== "none" && !advancedPanelOpen && (
                <div className="flex flex-wrap items-center gap-2 px-3 pt-3">
                  <span className="inline-flex items-center gap-1.5 rounded-full border border-atelier-rule px-3 py-1 text-xs text-atelier-muted">
                    {videoAdvancedMode === "storyboard"
                      ? g.storyboardActive
                      : formatMsg(g.multiRefActive, { n: multiRefPaths.length })}
                    <button
                      type="button"
                      onClick={clearAdvancedVideo}
                      aria-label={g.cancel}
                      className="text-atelier-muted/80 hover:text-atelier-ink"
                    >
                      <XIcon className="h-3 w-3" />
                    </button>
                  </span>
                </div>
              )}

              {storyboardActive ? (
                /* The shot list stands in for the textarea while the
                   storyboard toggle is on — same padding rhythm, so the
                   composer card doesn't jump. Turning the toggle off brings
                   the textarea (and whatever was typed in it) straight
                   back. */
                <div className="max-h-64 space-y-2 overflow-y-auto px-3.5 py-3">
                  {storyboardShots.map((shot, i) => (
                    <div key={shot.id} className="flex items-center gap-2">
                      <span className="w-14 flex-shrink-0 text-[10px] font-medium uppercase tracking-widest text-atelier-muted">
                        {formatMsg(g.storyboardShotLabel, { n: i + 1 })}
                      </span>
                      <input
                        value={shot.prompt}
                        onChange={(e) =>
                          setStoryboardShots((prev) =>
                            prev.map((s) => (s.id === shot.id ? { ...s, prompt: e.target.value } : s)),
                          )
                        }
                        // The visible "Shot N" span isn't programmatically
                        // associated — this is its accessible twin.
                        aria-label={formatMsg(g.storyboardShotLabel, { n: i + 1 })}
                        placeholder={g.storyboardShotPlaceholder}
                        disabled={submitting}
                        maxLength={1200}
                        className="min-w-0 flex-1 rounded-control border border-atelier-rule bg-transparent px-2.5 py-1.5 text-sm text-atelier-ink outline-none placeholder:text-atelier-muted/80 focus:border-atelier-muted disabled:opacity-60"
                      />
                      <div className="flex flex-shrink-0 items-center gap-0.5">
                        <button
                          type="button"
                          disabled={submitting || shot.seconds <= 1}
                          onClick={() =>
                            setStoryboardShots((prev) =>
                              prev.map((s) => (s.id === shot.id ? { ...s, seconds: s.seconds - 1 } : s)),
                            )
                          }
                          className="flex h-6 w-6 items-center justify-center rounded-full text-atelier-muted transition-colors hover:bg-atelier-ink/5 hover:text-atelier-ink disabled:opacity-30"
                        >
                          −
                        </button>
                        <span className="w-7 text-center font-numeral text-xs tabular-nums text-atelier-ink">
                          {shot.seconds}s
                        </span>
                        <button
                          type="button"
                          disabled={submitting || shot.seconds >= 15 || storyboardTotalSeconds >= 30}
                          onClick={() =>
                            setStoryboardShots((prev) =>
                              prev.map((s) => (s.id === shot.id ? { ...s, seconds: s.seconds + 1 } : s)),
                            )
                          }
                          className="flex h-6 w-6 items-center justify-center rounded-full text-atelier-muted transition-colors hover:bg-atelier-ink/5 hover:text-atelier-ink disabled:opacity-30"
                        >
                          +
                        </button>
                      </div>
                      {storyboardShots.length > 2 && (
                        <button
                          type="button"
                          disabled={submitting}
                          onClick={() =>
                            setStoryboardShots((prev) => prev.filter((s) => s.id !== shot.id))
                          }
                          aria-label={g.storyboardRemoveShot}
                          className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full text-atelier-muted transition-colors hover:bg-atelier-ink/5 hover:text-atelier-ink"
                        >
                          <XIcon className="h-3 w-3" />
                        </button>
                      )}
                    </div>
                  ))}
                  <div className="flex items-center justify-between pt-0.5">
                    {storyboardShots.length < 6 && storyboardTotalSeconds < 30 ? (
                      <button
                        type="button"
                        disabled={submitting}
                        onClick={() =>
                          setStoryboardShots((prev) => [
                            ...prev,
                            { id: storyboardIdRef.current++, prompt: "", seconds: Math.min(5, 30 - storyboardTotalSeconds) },
                          ])
                        }
                        className="cursor-pointer text-xs font-medium text-atelier-accent underline underline-offset-2 hover:text-atelier-accent/80"
                      >
                        + {g.storyboardAddShot}
                      </button>
                    ) : (
                      <span />
                    )}
                    <span className="font-numeral text-xs tabular-nums text-atelier-muted">
                      {formatMsg(storyboardCredits === 1 ? g.storyboardCostOne : g.storyboardCost, { seconds: storyboardTotalSeconds, credits: storyboardCredits })}
                    </span>
                  </div>
                </div>
              ) : (
              <>
              {/* Docked, the prompt is a script line under its mono margin
                  label (ACTION, md+ only — the phone keeps the full width);
                  hero keeps rows={2} (one line was too cramped to read a
                  prompt back before sending). The auto-grow effect on
                  `prompt` takes over from there, up to the max-h-36 cap
                  (six lines) with internal scrolling beyond. Enter still
                  sends and Shift+Enter still breaks the line — unchanged. */}
              <div className={cn(!isHero && "flex items-start")} data-prompt-row>
                {!isHero && (
                  <span
                    aria-hidden
                    className="hidden w-[84px] flex-shrink-0 select-none pl-1 pt-[15px] text-[9.5px] font-medium uppercase tracking-widest text-atelier-muted md:block"
                  >
                    {g.slateAction}
                  </span>
                )}
                <textarea
                  ref={promptTextareaRef}
                  id="prompt"
                  rows={isHero ? 2 : 1}
                  value={prompt}
                  onChange={(e) => {
                    setPrompt(e.target.value);
                    // Editing the refused prompt retires its refusal strip; any
                    // other message is the toast's and keeps its own clock.
                    setError((cur) => (isPolicyRefusal(cur) ? "" : cur));
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      e.currentTarget.form?.requestSubmit();
                    }
                  }}
                  placeholder={
                    chatAgentEnabled && assistantOn
                      ? g.askPlaceholder
                      : contentType === "video"
                        ? g.videoPlaceholder
                        : g.imagePlaceholder
                  }
                  disabled={submitting || asking}
                  maxLength={COMPOSER_MAX_CHARS}
                  className={cn(
                    "max-h-36 w-full min-w-0 flex-1 resize-none border-none bg-transparent px-3.5 py-3 text-[15px] text-atelier-ink outline-none placeholder:text-atelier-muted/80 disabled:opacity-60",
                    !isHero && "md:pl-0",
                  )}
                />
              </div>
              </>
              )}

              {/* Dialogue is a first-class line now (A×B) — it used to hide
                  behind the advanced reveal, which no longer exists. ALWAYS
                  visible for voiced characters in video mode (settled).
                  Docked, it is the slate's second script line, under its
                  own mono margin label from md up. */}
              {contentType === "video" && currentCharacter?.voiceId && (
                <div
                  className={cn(
                    "flex items-center gap-2 px-3.5",
                    isHero
                      ? "border-t border-atelier-rule/70 py-2"
                      : "border-t border-dashed border-atelier-rule/50 py-1.5",
                  )}
                  data-dialogue-row
                >
                  {!isHero && (
                    <span
                      aria-hidden
                      className="hidden w-[84px] flex-shrink-0 select-none pl-1 text-[9.5px] font-medium uppercase tracking-widest text-atelier-muted md:block"
                    >
                      {g.receiptDialogue}
                    </span>
                  )}
                  <svg
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.75"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    className={cn(
                      "h-[13px] w-[13px] flex-shrink-0 text-atelier-muted",
                      !isHero && "md:hidden",
                    )}
                  >
                    <path d="M4 5.5h16v11H10l-5.5 4z" />
                  </svg>
                  <input
                    value={dialogueText}
                    onChange={(e) => setDialogueText(e.target.value)}
                    disabled={submitting}
                    maxLength={500}
                    // A placeholder is not a name — once text is typed this
                    // field had NO accessible name at all (2026-09-05 audit).
                    aria-label={formatMsg(g.dialoguePlaceholder, { name: currentCharacter.name })}
                    placeholder={formatMsg(g.dialoguePlaceholder, { name: currentCharacter.name })}
                    className="min-w-0 flex-1 border-none bg-transparent py-1 text-[13px] text-atelier-ink/90 outline-none placeholder:text-atelier-muted/80 disabled:opacity-60"
                  />
                  {/* Only once there's actually dialogue to charge for —
                      showing a surcharge against an empty field would read
                      as a warning about something they haven't done. The
                      real function, not a re-typed divisor — the hardcoded
                      /5 here kept quoting the old price the day the rate
                      changed (2026-08-31). Docked, the same sentence is the
                      slate's DIALOGUE statement above; hero keeps it here. */}
                  {isHero && dialogueText.trim().length > 0 && (
                    <span className="flex-shrink-0 whitespace-nowrap text-[11.5px] text-atelier-muted">
                      {formatMsg(g.dialogueCreditNote, {
                        n: getDialogueCreditWeight(videoDurationSeconds),
                      })}
                    </span>
                  )}
                </div>
              )}

              {advancedPanelOpen && advancedVideoEligible && (
                <div className="space-y-3 border-t border-atelier-rule/70 px-3 py-3" data-advanced-panel>
                  <div className="flex gap-1 rounded-control bg-atelier-ink/5 p-1">
                    {(["storyboard", "multiref"] as const).map((mode) => (
                      <button
                        key={mode}
                        type="button"
                        onClick={() => setVideoAdvancedMode(mode)}
                        className={cn(
                          "flex-1 rounded-[4px] py-1.5 text-xs font-medium transition-colors",
                          videoAdvancedMode === mode
                            ? "bg-atelier-surface text-atelier-ink shadow-sm"
                            : "text-atelier-muted hover:text-atelier-ink",
                        )}
                      >
                        {mode === "storyboard" ? g.storyboardLabel : g.multiRefLabel}
                      </button>
                    ))}
                  </div>

                  {videoAdvancedMode === "storyboard" && (
                    <div className="space-y-3">
                      <p className="text-xs text-atelier-muted">{g.storyboardHint}</p>
                      <div>
                        <p className="text-[11px] font-medium uppercase tracking-widest text-atelier-muted">
                          {g.startFrameLabel}
                        </p>
                        <div className="mt-1.5 grid grid-cols-5 gap-1.5">
                          <button
                            type="button"
                            title={g.uploadPhotoTitle}
                            aria-label={g.uploadPhotoTitle}
                            onClick={() => panelUploadInputRef.current?.click()}
                            disabled={panelUploadBusy}
                            className="flex aspect-square items-center justify-center rounded-media border-2 border-dashed border-atelier-rule text-atelier-muted transition-colors hover:border-atelier-muted hover:text-atelier-ink disabled:opacity-50"
                          >
                            {panelUploadBusy ? (
                              <LoaderIcon className="h-4 w-4" />
                            ) : (
                              <PlusIcon className="h-4 w-4" />
                            )}
                          </button>
                          {advancedPhotoOptions.map((p, i) => (
                            <button
                              key={p.key}
                              type="button"
                              onClick={() => toggleStoryboardPhoto(p.value, "start")}
                              aria-pressed={storyboardStartPath === p.value}
                              aria-label={formatMsg(g.photoOption, { n: i + 1 })}
                              className={cn(
                                "relative aspect-square overflow-hidden rounded-media border-2",
                                storyboardStartPath === p.value ? "border-atelier-ink" : "border-transparent",
                              )}
                            >
                              {/* eslint-disable-next-line @next/next/no-img-element */}
                              <img src={p.thumbUrl} alt="" className="h-full w-full object-cover" />
                            </button>
                          ))}
                        </div>
                      </div>
                      <div>
                        <p className="text-[11px] font-medium uppercase tracking-widest text-atelier-muted">
                          {g.endFrameLabel}
                        </p>
                        <div className="mt-1.5 grid grid-cols-5 gap-1.5">
                          <button
                            type="button"
                            title={g.uploadPhotoTitle}
                            aria-label={g.uploadPhotoTitle}
                            onClick={() => panelUploadInputRef.current?.click()}
                            disabled={panelUploadBusy}
                            className="flex aspect-square items-center justify-center rounded-media border-2 border-dashed border-atelier-rule text-atelier-muted transition-colors hover:border-atelier-muted hover:text-atelier-ink disabled:opacity-50"
                          >
                            {panelUploadBusy ? (
                              <LoaderIcon className="h-4 w-4" />
                            ) : (
                              <PlusIcon className="h-4 w-4" />
                            )}
                          </button>
                          {advancedPhotoOptions.map((p, i) => (
                            <button
                              key={p.key}
                              type="button"
                              onClick={() => toggleStoryboardPhoto(p.value, "end")}
                              aria-pressed={storyboardEndPath === p.value}
                              aria-label={formatMsg(g.photoOption, { n: i + 1 })}
                              className={cn(
                                "relative aspect-square overflow-hidden rounded-media border-2",
                                storyboardEndPath === p.value ? "border-atelier-ink" : "border-transparent",
                              )}
                            >
                              {/* eslint-disable-next-line @next/next/no-img-element */}
                              <img src={p.thumbUrl} alt="" className="h-full w-full object-cover" />
                            </button>
                          ))}
                        </div>
                      </div>
                    </div>
                  )}

                  {videoAdvancedMode === "multiref" && (
                    <div className="space-y-2">
                      <p className="text-xs text-atelier-muted">{g.multiRefHint}</p>
                      <div className="grid grid-cols-5 gap-1.5">
                        <button
                          type="button"
                          title={g.uploadPhotoTitle}
                          aria-label={g.uploadPhotoTitle}
                          onClick={() => panelUploadInputRef.current?.click()}
                          disabled={panelUploadBusy}
                          className="flex aspect-square items-center justify-center rounded-media border-2 border-dashed border-atelier-rule text-atelier-muted transition-colors hover:border-atelier-muted hover:text-atelier-ink disabled:opacity-50"
                        >
                          {panelUploadBusy ? (
                            <LoaderIcon className="h-4 w-4" />
                          ) : (
                            <PlusIcon className="h-4 w-4" />
                          )}
                        </button>
                        {advancedPhotoOptions.map((p, i) => {
                          const checked = multiRefPaths.includes(p.value);
                          return (
                            <button
                              key={p.key}
                              type="button"
                              onClick={() => toggleMultiRefPhoto(p.value)}
                              aria-pressed={checked}
                              aria-label={formatMsg(g.photoOption, { n: i + 1 })}
                              className={cn(
                                "relative aspect-square overflow-hidden rounded-media border-2",
                                checked ? "border-atelier-ink" : "border-transparent",
                              )}
                            >
                              {/* eslint-disable-next-line @next/next/no-img-element */}
                              <img src={p.thumbUrl} alt="" className="h-full w-full object-cover" />
                              {checked && (
                                <span className="absolute right-1 top-1 flex h-4 w-4 items-center justify-center rounded-full bg-atelier-ink text-atelier-paper">
                                  <CheckIcon className="h-2.5 w-2.5" />
                                </span>
                              )}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  <input
                    ref={panelUploadInputRef}
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={handlePanelFileSelected}
                  />

                  <div className="flex justify-end gap-2 pt-1">
                    <button
                      type="button"
                      onClick={clearAdvancedVideo}
                      className="rounded-control px-3 py-1.5 text-xs text-atelier-muted transition-colors hover:bg-atelier-ink/5"
                    >
                      {g.cancel}
                    </button>
                    <button
                      type="button"
                      onClick={() => setAdvancedPanelOpen(false)}
                      className="rounded-control bg-atelier-ink px-3 py-1.5 text-xs font-medium text-atelier-paper transition-opacity hover:opacity-90"
                    >
                      {g.done}
                    </button>
                  </div>
                </div>
              )}

              {savedRecompiledFrom && (
                <div className="mx-2.5 mb-2.5 rounded-control border border-atelier-rule bg-atelier-surface p-3">
                  <p className="text-[11px] leading-relaxed text-atelier-muted">
                    {g.savedRecompileNote.replace("{name}", savedRecompiledFrom)}
                  </p>
                  <button
                    type="button"
                    onClick={() => setSavedRecompiledFrom(null)}
                    className="mt-1.5 text-[11px] font-medium text-atelier-muted underline underline-offset-2 hover:text-atelier-ink"
                  >
                    {g.enhanceDismiss}
                  </button>
                </div>
              )}

              {savedOpen && (
                <div className="mx-2.5 mb-2.5 max-h-72 overflow-y-auto rounded-control border border-atelier-rule bg-atelier-surface p-3">
                  <div className="mb-2 flex items-center justify-between">
                    <p className="text-[11px] font-medium uppercase tracking-widest text-atelier-muted">
                      {g.savedPrompts}
                    </p>
                    <button
                      type="button"
                      onClick={() => setSavedOpen(false)}
                      className="text-[11px] text-atelier-muted transition-colors hover:text-atelier-ink"
                    >
                      {g.enhanceDismiss}
                    </button>
                  </div>
                  {savedLoading ? (
                    <p className="py-3 text-center text-xs text-atelier-muted">{g.savedLoading}</p>
                  ) : savedItems.length === 0 ? (
                    <p className="py-3 text-center text-xs leading-relaxed text-atelier-muted">
                      {g.savedEmpty}
                    </p>
                  ) : (
                    <ul className="space-y-1.5">
                      {savedItems.map((item) => {
                        const owner = characters.find((c) => c.id === item.characterId);
                        return (
                          <li
                            key={item.id}
                            className="rounded-control border border-atelier-rule/70 bg-atelier-paper/60 p-2.5"
                          >
                            <p className="line-clamp-2 text-xs leading-relaxed text-atelier-ink/80">
                              {item.prompt}
                            </p>
                            <div className="mt-1.5 flex items-center gap-2">
                              <span className="text-[10px] text-atelier-muted/70">
                                {owner
                                  ? g.savedForCharacter.replace("{name}", owner.name)
                                  : g.savedNoCharacter}
                                {" · "}
                                {item.contentType === "video" ? g.video : g.image}
                              </span>
                              <button
                                type="button"
                                onClick={() => openSavedPrompt(item)}
                                className="ml-auto rounded-control bg-atelier-ink px-2.5 py-1 text-[11px] font-semibold text-atelier-paper transition-colors hover:bg-atelier-ink/90"
                              >
                                {g.savedUse}
                              </button>
                              <button
                                type="button"
                                onClick={() => removeSavedPrompt(item.id)}
                                title={g.savedDelete}
                                aria-label={g.savedDelete}
                                className="rounded-control px-1.5 py-1 text-[11px] text-atelier-muted transition-colors hover:text-red-600"
                              >
                                <XIcon className="h-3 w-3" />
                              </button>
                            </div>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </div>
              )}

              {(enhanced || enhanceError) && (
                <div className="mx-2.5 mb-2.5 rounded-control border border-atelier-accent/30 bg-atelier-accent/5 p-3.5">
                  {enhanceError ? (
                    // compilePrompt's errors are the server's English — the
                    // content gate's refusal among them.
                    <p className="text-xs leading-relaxed text-red-600">{localizeServerText(enhanceError, t)}</p>
                  ) : (
                    <>
                      <div className="flex items-baseline justify-between gap-3">
                        <p className="text-[11px] font-medium uppercase tracking-widest text-atelier-accent">
                          {g.enhanceTitle}
                        </p>
                        <p className="text-[11px] text-atelier-muted/80">{g.enhanceSubtitle}</p>
                      </div>
                      <p className="mt-2 whitespace-pre-wrap text-[13px] leading-relaxed text-atelier-ink">
                        {enhanced}
                      </p>
                      <div className="mt-3 flex flex-wrap items-center gap-2">
                        <button
                          type="button"
                          onClick={useEnhancedPrompt}
                          className="rounded-control bg-atelier-ink px-3.5 py-1.5 text-xs font-semibold text-atelier-paper transition-colors hover:bg-atelier-ink/90"
                        >
                          {g.enhanceUse}
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            enhanceKind === "image" ? runDescribe(describedMode) : runEnhance()
                          }
                          disabled={enhancing}
                          className="rounded-control border border-atelier-rule bg-atelier-surface px-3 py-1.5 text-xs font-medium text-atelier-ink/80 transition-colors hover:border-atelier-muted disabled:opacity-50"
                        >
                          {enhancing ? g.enhanceWorking : g.enhanceRetry}
                        </button>
                        <button
                          type="button"
                          onClick={saveCurrentPrompt}
                          disabled={savedJustSaved}
                          className="flex items-center gap-1.5 rounded-control border border-atelier-rule bg-atelier-surface px-3 py-1.5 text-xs font-medium text-atelier-ink/80 transition-colors hover:border-atelier-muted disabled:opacity-60"
                        >
                          <BookmarkIcon className="h-3 w-3" />
                          {savedJustSaved ? g.savePromptDone : g.savePrompt}
                        </button>
                        <button
                          type="button"
                          onClick={() => setEnhanced(null)}
                          className="rounded-control px-2 py-1.5 text-xs text-atelier-muted transition-colors hover:text-atelier-ink"
                        >
                          {g.enhanceDismiss}
                        </button>
                        {assistsLeft !== undefined && (
                          <span className="ml-auto font-numeral text-[11px] tabular-nums text-atelier-accent">
                            {assistsLeft === null
                              ? g.enhanceUnlimited
                              : g.enhanceLeft.replace("{n}", String(assistsLeft))}
                          </span>
                        )}
                      </div>
                      {enhanceKind === "image" && (
                        <div className="mt-2.5 border-t border-atelier-accent/20 pt-2.5">
                          <button
                            type="button"
                            onClick={() =>
                              runDescribe(describedMode === "scene" ? "standalone" : "scene")
                            }
                            disabled={enhancing}
                            className="text-[11px] font-medium text-atelier-accent underline underline-offset-2 transition-opacity hover:opacity-80 disabled:opacity-50"
                          >
                            {describedMode === "scene" ? g.describeIncludePerson : g.describeSceneOnly}
                          </button>
                          {/* Shown only on the mode that actually describes a
                              person: that's the one where whose photo it is
                              starts to matter. */}
                          {describedMode === "standalone" && (
                            <p className="mt-1.5 text-[11px] text-atelier-muted/80">{g.describeRights}</p>
                          )}
                          {/* Says out loud what accepting does to the upload,
                              so the photo disappearing from the composer
                              reads as intended rather than as a glitch. */}
                          {describedAttachmentId && (
                            <p className="mt-1.5 text-[11px] leading-relaxed text-atelier-muted/80">
                              {g.describeSourceNote}
                            </p>
                          )}
                        </div>
                      )}
                    </>
                  )}
                </div>
              )}

              <div
                className={cn(
                  "flex min-w-0 items-center justify-between gap-2",
                  // Docked: the keys row sits on its own rule, closing the
                  // slate — attach + modes at the left, the session pair and
                  // the Render key at the right. On a phone the key wraps to
                  // its own run, so the "+" tops out level with the icons.
                  isHero
                    ? "px-2.5 pb-3"
                    : "border-t border-atelier-rule/60 px-0.5 pb-0.5 pt-2.5 max-lg:items-start",
                )}
                data-keys
              >
                <div ref={plusMenuRef} className="relative flex flex-shrink-0 items-center gap-2" data-keys-attach>
                  <button
                    type="button"
                    onClick={() => setPlusMenuOpen((v) => !v)}
                    disabled={submitting}
                    title={plusMenuOpen ? g.cancel : g.attachTitle}
                    aria-label={plusMenuOpen ? g.cancel : g.attachTitle}
                    aria-haspopup="menu"
                    aria-expanded={plusMenuOpen}
                    className="relative flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full border border-atelier-rule text-atelier-muted transition-colors hover:bg-atelier-ink/5 hover:text-atelier-ink disabled:opacity-50 after:absolute after:-inset-1.5 after:content-[''] lg:after:content-none"
                  >
                    {plusMenuOpen ? <XIcon className="h-4 w-4" /> : <PlusIcon className="h-4 w-4" />}
                  </button>

                  {creationModeActive && (
                    <button
                      type="button"
                      onClick={clearCreationMode}
                      // Locked while a request is live, same as every sibling
                      // control in this row: clearing flips contentType back
                      // to video, which the resetChat effect treats as "new
                      // thread" — mid-render that wiped the live bubble and
                      // orphaned the in-flight generation.
                      disabled={submitting}
                      className="flex flex-shrink-0 items-center gap-1 rounded-full border border-atelier-rule py-1.5 pl-3 pr-2 text-xs font-medium text-atelier-ink/80 transition-colors hover:border-atelier-muted disabled:opacity-50"
                    >
                      {contentType === "video" ? g.video : g.image}
                      <XIcon className="h-3 w-3" />
                    </button>
                  )}

                  <input
                    ref={fileInputRef}
                    type="file"
                    multiple
                    hidden
                    accept="image/*,video/*,.pdf,.txt,.doc,.docx"
                    onChange={handleFilesSelected}
                  />
                  <input
                    ref={cameraInputRef}
                    type="file"
                    hidden
                    accept="image/*"
                    capture="environment"
                    onChange={handleFilesSelected}
                  />

                  {plusMenuOpen && (
                    <div
                      role="menu"
                      className={cn(
                        "absolute left-0 z-20 w-56 overflow-hidden rounded-control bg-atelier-surface/95 backdrop-blur-xl p-1.5 shadow-[0_0_0_1px_var(--frost-ring),0_24px_48px_-12px_rgba(0,0,0,0.3)]",
                        // Docked mode sits near the bottom of the viewport
                        // (sticky), so the menu opens upward there. Hero mode
                        // has open space below instead — opening upward in
                        // hero left nowhere for a 3-item menu to go but
                        // overlapping the placeholder text above it.
                        isHero ? "top-full mt-2" : "bottom-full mb-2",
                      )}
                    >
                      {showCameraOption && (
                        <button
                          type="button"
                          role="menuitem"
                          onClick={() => {
                            setPlusMenuOpen(false);
                            cameraInputRef.current?.click();
                          }}
                          className="flex w-full items-center gap-2.5 whitespace-nowrap rounded-control px-2.5 py-2 text-left text-sm text-atelier-muted transition-colors hover:bg-atelier-ink/5 hover:text-atelier-ink"
                        >
                          <CameraIcon className="h-4 w-4" />
                          {g.takePhoto}
                        </button>
                      )}
                      <button
                        type="button"
                        role="menuitem"
                        onClick={() => {
                          setPlusMenuOpen(false);
                          fileInputRef.current?.click();
                        }}
                        className="flex w-full items-center gap-2.5 whitespace-nowrap rounded-control px-2.5 py-2 text-left text-sm text-atelier-muted transition-colors hover:bg-atelier-ink/5 hover:text-atelier-ink"
                      >
                        <FileIcon className="h-4 w-4" />
                        {g.uploadFiles}
                      </button>
                      <button
                        type="button"
                        role="menuitem"
                        onClick={openSavedPrompts}
                        className="flex w-full items-center gap-2.5 whitespace-nowrap rounded-control px-2.5 py-2 text-left text-sm text-atelier-muted transition-colors hover:bg-atelier-ink/5 hover:text-atelier-ink"
                      >
                        <BookmarkIcon className="h-4 w-4" />
                        {g.savedPrompts}
                      </button>
                      {/* Divider: everything above works on the message you're
                          writing (attach, reuse); everything below switches
                          what you're making. Two different kinds of action. */}
                      <div className="my-1 h-px bg-atelier-rule/70" />
                      <button
                        type="button"
                        role="menuitem"
                        onClick={() => chooseCreationMode("image")}
                        className="flex w-full items-center gap-2.5 whitespace-nowrap rounded-control px-2.5 py-2 text-left text-sm text-atelier-muted transition-colors hover:bg-atelier-ink/5 hover:text-atelier-ink"
                      >
                        <ImageIcon className="h-4 w-4" />
                        {g.createImage}
                      </button>
                      <button
                        type="button"
                        role="menuitem"
                        onClick={() => chooseCreationMode("video")}
                        className="flex w-full items-center gap-2.5 whitespace-nowrap rounded-control px-2.5 py-2 text-left text-sm text-atelier-muted transition-colors hover:bg-atelier-ink/5 hover:text-atelier-ink"
                      >
                        <VideoIcon className="h-4 w-4" />
                        {g.createVideo}
                      </button>
                      {/* Director's Cut (2026-09-24): the third thing you can
                          make — your own footage, edited. Opens its bench. */}
                      {directorsCutOn && (
                        <Link
                          href="/app/edit"
                          role="menuitem"
                          onClick={() => setPlusMenuOpen(false)}
                          className="flex w-full items-center gap-2.5 whitespace-nowrap rounded-control px-2.5 py-2 text-left text-sm text-atelier-muted transition-colors hover:bg-atelier-ink/5 hover:text-atelier-ink"
                        >
                          <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                            <circle cx="6" cy="6" r="3" />
                            <circle cx="6" cy="18" r="3" />
                            <path d="M8.1 8.1 20 20M14.5 9.5 20 4M8.1 15.9l3.4-3.4" />
                          </svg>
                          {t.directorsCut.menuEntry}
                        </Link>
                      )}
                    </div>
                  )}
                </div>

                <div
                  className={cn(
                    "flex min-w-0 items-center gap-1.5",
                    // Docked: the row WRAPS instead of clipping — on a phone
                    // the key takes its own full-width run (basis-full
                    // below); at desktop an armed key + Assistant pair (or
                    // the Seedance Camera/Light pills, or Italian) used to
                    // push whole word pills into the strip's invisible
                    // internal scroll, against "Frames stays visible".
                    // flex-wrap only takes effect when a line genuinely
                    // overflows, so the everyday one-run state is untouched.
                    !isHero && "flex-wrap justify-end gap-y-2",
                  )}
                  data-keys-right
                >
                  {/* Real incident, 2026-08-09: this whole icon strip (up to
                      7 buttons once video + advancedOpen reveal the extra
                      pair) had no way to shrink or wrap, so on a phone-width
                      screen it simply overflowed the composer card — the
                      rightmost button (Send) got pushed out past the visible
                      edge instead of staying reachable. Everything except
                      Send/Stop lives in its own min-w-0 strip that WRAPS
                      below lg, so it grows a run instead of pushing Send
                      off-screen — every control stays visible and tappable
                      (its old internal overflow-x-auto scroll hid controls
                      with no affordance, and its scroll box clipped the
                      buttons' 44px after: hit extensions). At lg+ the strip
                      refuses to shrink instead (min-w-fit) so the row above
                      wraps the key to its own run — an invisible horizontal
                      scroll at desktop hid Frames and cut "Cinema Studio"
                      mid-word (audit, 2026-09-22). */}
                  <div className="flex min-w-0 items-center gap-1.5 max-lg:flex-wrap max-lg:gap-y-2 lg:min-w-fit" data-keys-modes>
                  {/* Prompt Studio. Only appears once there's something to
                      enhance — an empty composer has nothing to improve, and
                      a control that can't do anything yet is just noise. */}
                  {(prompt.trim().length > 0 || hasReadyImageAttachment) && (
                    <button
                      type="button"
                      onClick={() =>
                        prompt.trim().length > 0
                          ? runEnhance()
                          : runDescribe(characterId ? "scene" : "standalone")
                      }
                      disabled={enhancing || submitting}
                      title={prompt.trim().length > 0 ? g.enhance : g.describeImage}
                      aria-label={prompt.trim().length > 0 ? g.enhance : g.describeImage}
                      className="relative flex flex-shrink-0 items-center gap-1.5 rounded-full border border-atelier-accent/40 px-3 py-1.5 text-xs font-semibold text-atelier-accent transition-colors hover:bg-atelier-accent/10 disabled:opacity-50 after:absolute after:-inset-y-[7px] after:inset-x-0 after:content-[''] lg:after:content-none"
                      data-keys-enhance
                    >
                      <SparkIcon className={cn("h-3.5 w-3.5", enhancing && "animate-pulse")} />
                      {/* Icon-only below sm: on a phone the full label ate
                          the strip's width and scrolled every other control
                          out of view (operator-reported, 2026-08-21). The
                          title/aria-label above carry the words. */}
                      <span className="hidden sm:inline">
                        {enhancing
                          ? g.enhanceWorking
                          : prompt.trim().length > 0
                            ? g.enhance
                            : g.describeImage}
                      </span>
                    </button>
                  )}
                  {/* The mode pills (A×B redesign): every mode is a LABELED
                      pill, always rendered — no width-clip reveal, no
                      unlabeled chevron. The four abstract rectangle-stack
                      icons at 16px were shipped confusables (Clapper/Film
                      identical); the word does the work now, the icon just
                      anchors it. Same handlers, locks and one-tap
                      explanations as before — locked stays clickable, the
                      tap says why (disabled buttons dispatch no events on
                      touch). The group carries the tour anchor the chevron
                      used to. */}
                  {contentType === "video" && (
                    <div
                      data-tour-id="tour-advanced-toggle"
                      className="flex flex-shrink-0 items-center gap-1.5"
                    >
                      <button
                        type="button"
                        onClick={() =>
                          multiAngleLocked ? setError(g.multiAngleLocked) : toggleMultiAngleMode()
                        }
                        disabled={submitting}
                        title={
                          multiAngleLocked
                            ? g.multiAngleLocked
                            : multiAngleMode
                              ? g.multiAngleOnTitle
                              : g.multiAngleOffTitle
                        }
                        aria-label={
                          multiAngleLocked
                            ? g.multiAngleLocked
                            : multiAngleMode
                              ? g.multiAngleOnTitle
                              : g.multiAngleOffTitle
                        }
                        aria-pressed={multiAngleMode}
                        aria-disabled={multiAngleLocked || undefined}
                        className={cn(
                          "relative flex h-9 flex-shrink-0 items-center gap-1.5 rounded-full px-2.5 text-xs font-medium transition-colors disabled:opacity-50 after:absolute after:-inset-1 after:content-[''] lg:after:content-none",
                          multiAngleLocked
                            ? "text-atelier-muted/40 hover:bg-atelier-ink/5 hover:text-atelier-muted/70"
                            : multiAngleMode
                              ? "bg-atelier-accent/10 text-atelier-accent shadow-[inset_0_0_0_1px_rgba(180,90,40,0.45)]"
                              : "text-atelier-muted hover:bg-atelier-ink/5 hover:text-atelier-ink",
                        )}
                      >
                        <AnglesIcon className="h-4 w-4" />
                        <span className="hidden md:inline" data-mode-word>{g.multiAngleLabel}</span>
                        {multiAngleMode && (
                          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.25" strokeLinecap="round" strokeLinejoin="round" className="h-3 w-3" aria-hidden>
                            <path d="M5 12.5l4.5 4.5L19 7.5" />
                          </svg>
                        )}
                      </button>

                      {/* Storyboard (multi-shot) — O3 Pro only, so the
                          button exists only there; the same plan lock as
                          its siblings. Turning it on clears the modes it
                          can't combine with (multi-angle, start/end
                          frames) instead of letting the server bounce
                          the submit later. */}
                      {videoModelId === "kling-o3-pro" && (
                        <button
                          type="button"
                          onClick={() => {
                            if (advancedVideoLockedReason === "plan") {
                              setError(g.advancedVideoLocked);
                              return;
                            }
                            if (storyboardMode) {
                              setStoryboardMode(false);
                              return;
                            }
                            if (multiAngleMode) toggleMultiAngleMode();
                            clearAdvancedVideo();
                            setStoryboardMode(true);
                          }}
                          disabled={submitting}
                          title={storyboardActive ? g.storyboardOnTitle : g.storyboardOffTitle}
                          aria-label={storyboardActive ? g.storyboardOnTitle : g.storyboardOffTitle}
                          aria-pressed={storyboardActive}
                          className={cn(
                            "relative flex h-9 flex-shrink-0 items-center gap-1.5 rounded-full px-2.5 text-xs font-medium transition-colors disabled:opacity-50 after:absolute after:-inset-1 after:content-[''] lg:after:content-none",
                            advancedVideoLockedReason === "plan"
                              ? "text-atelier-muted/40 hover:bg-atelier-ink/5 hover:text-atelier-muted/70"
                              : storyboardActive
                                ? "bg-atelier-accent/10 text-atelier-accent shadow-[inset_0_0_0_1px_rgba(180,90,40,0.45)]"
                                : "text-atelier-muted hover:bg-atelier-ink/5 hover:text-atelier-ink",
                          )}
                        >
                          <FilmIcon className="h-4 w-4" />
                          <span className="hidden md:inline" data-mode-word>{g.storyboardPillLabel}</span>
                        </button>
                      )}
                      {/* Cinema Studio. Shares multi-angle's plan gate: both
                          fan one send out into several paid renders, so the
                          same entitlement applies. */}
                      <button
                        type="button"
                        onClick={() =>
                          multiAngleLocked ? setError(g.multiAngleLocked) : toggleSceneMode()
                        }
                        disabled={submitting}
                        title={
                          multiAngleLocked
                            ? g.multiAngleLocked
                            : sceneMode
                              ? g.sceneModeOnTitle
                              : g.sceneModeOffTitle
                        }
                        aria-label={
                          multiAngleLocked
                            ? g.multiAngleLocked
                            : sceneMode
                              ? g.sceneModeOnTitle
                              : g.sceneModeOffTitle
                        }
                        aria-pressed={sceneMode}
                        aria-disabled={multiAngleLocked || undefined}
                        className={cn(
                          "relative flex h-9 flex-shrink-0 items-center gap-1.5 rounded-full px-2.5 text-xs font-medium transition-colors disabled:opacity-50 after:absolute after:-inset-1 after:content-[''] lg:after:content-none",
                          multiAngleLocked
                            ? "text-atelier-muted/40 hover:bg-atelier-ink/5 hover:text-atelier-muted/70"
                            : sceneMode
                              ? "bg-atelier-accent/10 text-atelier-accent shadow-[inset_0_0_0_1px_rgba(180,90,40,0.45)]"
                              : "text-atelier-muted hover:bg-atelier-ink/5 hover:text-atelier-ink",
                        )}
                      >
                        <ClapperIcon className="h-4 w-4" />
                        <span className="hidden md:inline" data-mode-word>{g.cinemaLabel}</span>
                      </button>

                      <button
                        type="button"
                        onClick={() => {
                          if (advancedVideoLockedReason === "plan") {
                            setError(g.advancedVideoLocked);
                            return;
                          }
                          if (advancedVideoLockedReason === "model") {
                            setError(g.advancedVideoNeedsKling);
                            return;
                          }
                          if (videoAdvancedMode === "none") {
                            openAdvancedVideo("storyboard");
                          } else {
                            setAdvancedPanelOpen((v) => !v);
                          }
                        }}
                        disabled={submitting}
                        title={
                          advancedVideoLockedReason === "plan"
                            ? g.advancedVideoLocked
                            : advancedVideoLockedReason === "model"
                              ? g.advancedVideoNeedsKling
                              : videoAdvancedMode === "none"
                                ? g.advancedVideoOffTitle
                                : g.advancedVideoOnTitle
                        }
                        aria-label={
                          advancedVideoLockedReason === "plan"
                            ? g.advancedVideoLocked
                            : advancedVideoLockedReason === "model"
                              ? g.advancedVideoNeedsKling
                              : videoAdvancedMode === "none"
                                ? g.advancedVideoOffTitle
                                : g.advancedVideoOnTitle
                        }
                        aria-pressed={videoAdvancedMode !== "none"}
                        aria-disabled={advancedVideoLockedReason !== null || undefined}
                        className={cn(
                          "relative flex h-9 flex-shrink-0 items-center gap-1.5 rounded-full px-2.5 text-xs font-medium transition-colors disabled:opacity-50 after:absolute after:-inset-1 after:content-[''] lg:after:content-none",
                          advancedVideoLockedReason !== null
                            ? "text-atelier-muted/40 hover:bg-atelier-ink/5 hover:text-atelier-muted/70"
                            : videoAdvancedMode !== "none"
                              ? "bg-atelier-accent/10 text-atelier-accent shadow-[inset_0_0_0_1px_rgba(180,90,40,0.45)]"
                              : "text-atelier-muted hover:bg-atelier-ink/5 hover:text-atelier-ink",
                        )}
                      >
                        <StackIcon className="h-4 w-4" />
                        <span className="hidden md:inline" data-mode-word>{g.framesPillLabel}</span>
                      </button>
                    </div>
                  )}

                  {/* Camera & Lighting — the proven cinema presets (they
                      lived in the loadout row until the slate, 2026-09-22;
                      the slate's cells are pickers, and these are modes, so
                      they sit with the mode words now). Warm when armed,
                      wearing the armed preset's name; tap opens the
                      proof-render strip straight on that tab. Seedance
                      lanes only — the presets don't exist elsewhere. */}
                  {!isHero && cinemaPresetsAvailable && (
                    <>
                      <button
                        type="button"
                        onClick={() => {
                          if (presetRowOpen && presetTab === "move") {
                            setPresetRowOpen(false);
                          } else {
                            setPresetTab("move");
                            setPresetRowOpen(true);
                          }
                        }}
                        disabled={submitting}
                        aria-expanded={presetRowOpen && presetTab === "move"}
                        aria-pressed={Boolean(cinemaPresetIds.move)}
                        className={cn(
                          "relative flex h-9 flex-shrink-0 items-center gap-1.5 rounded-full px-2.5 text-xs font-medium transition-colors disabled:opacity-50 after:absolute after:-inset-1 after:content-[''] lg:after:content-none",
                          cinemaPresetIds.move
                            ? "bg-atelier-accent/10 text-atelier-accent shadow-[inset_0_0_0_1px_rgba(180,90,40,0.45)]"
                            : "text-atelier-muted hover:bg-atelier-ink/5 hover:text-atelier-ink",
                        )}
                      >
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" className="h-3.5 w-3.5 flex-shrink-0">
                          <path d="M4 8h16v11a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1z" />
                          <path d="m4 8-1.5-3.5 15.5-2L19.5 6z" />
                          <path d="m8 7.2 2.5-3.7M13 6.5l2.5-3.7" />
                        </svg>
                        <span className="hidden md:inline" data-mode-word>{g.presetTabCamera}</span>
                        {cinemaPresetIds.move
                          ? ` · ${(g.cinemaPresetLabels as Record<string, string>)[cinemaPresetIds.move] ?? cinemaPresetIds.move}`
                          : ""}
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          if (presetRowOpen && presetTab === "look") {
                            setPresetRowOpen(false);
                          } else {
                            setPresetTab("look");
                            setPresetRowOpen(true);
                          }
                        }}
                        disabled={submitting}
                        aria-expanded={presetRowOpen && presetTab === "look"}
                        aria-pressed={Boolean(cinemaPresetIds.look)}
                        className={cn(
                          "relative flex h-9 flex-shrink-0 items-center gap-1.5 rounded-full px-2.5 text-xs font-medium transition-colors disabled:opacity-50 after:absolute after:-inset-1 after:content-[''] lg:after:content-none",
                          cinemaPresetIds.look
                            ? "bg-atelier-accent/10 text-atelier-accent shadow-[inset_0_0_0_1px_rgba(180,90,40,0.45)]"
                            : "text-atelier-muted hover:bg-atelier-ink/5 hover:text-atelier-ink",
                        )}
                      >
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" className="h-3.5 w-3.5 flex-shrink-0">
                          <circle cx="12" cy="12" r="4" />
                          <path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6l1.4 1.4M17 17l1.4 1.4M18.4 5.6L17 7M7 17l-1.4 1.4" />
                        </svg>
                        <span className="hidden md:inline" data-mode-word>{g.presetTabLight}</span>
                        {cinemaPresetIds.look
                          ? ` · ${(g.cinemaPresetLabels as Record<string, string>)[cinemaPresetIds.look] ?? cinemaPresetIds.look}`
                          : ""}
                      </button>
                    </>
                  )}

                  {/* Aspect moved to the loadout row as text chips (approved
                      board) — the icon pair that lived here is gone. */}
{/* Free resolution upgrade. Only rendered when the selected
                      model genuinely bills the higher resolution at its
                      default rate (freeHighResolution) — today that is Veo
                      3.1 alone, whose endpoints default to 720p while
                      charging the 720p-or-1080p price either way. Written as
                      a plain toggle rather than a picker because there is
                      exactly one honest option: 4K bills 1.5x and belongs
                      behind a real credit weight, not a free switch. */}
                  {contentType === "video" && resolutionOffers.length > 0 && (
                    <div className="flex flex-shrink-0 items-center gap-0.5 rounded-full border border-atelier-rule p-1">
                      {resolutionOffers.map((offer) => {
                        const total = resolutionCreditWeight(
                          videoModelId,
                          offer.value,
                          videoDurationSeconds,
                        );
                        const extra = total === null ? 0 : Math.max(0, total - baseDurationCredits);
                        const active = videoResolution === offer.value;
                        return (
                          <button
                            key={offer.value}
                            type="button"
                            onClick={() =>
                              setVideoResolutionWanted((prev) =>
                                prev === offer.value ? null : offer.value,
                              )
                            }
                            disabled={submitting}
                            title={
                              extra > 0
                                ? formatMsg(extra === 1 ? g.resolutionCostTitleOne : g.resolutionCostTitle, {
                                    res: offer.value.toUpperCase(),
                                    n: extra,
                                  })
                                : formatMsg(g.resolutionFreeTitle, { res: offer.value })
                            }
                            aria-pressed={active}
                            className={cn(
                              "flex h-7 flex-shrink-0 items-center gap-1 rounded-full px-2.5 text-[11px] font-semibold tracking-wide transition-colors disabled:opacity-50",
                              active
                                ? "bg-atelier-accent/12 text-atelier-accent"
                                : "text-atelier-muted hover:text-atelier-ink",
                            )}
                          >
                            {offer.value.toUpperCase()}
                            {extra > 0 && (
                              <span className={cn("text-[10px]", active ? "" : "opacity-70")}>
                                +{extra}
                              </span>
                            )}
                          </button>
                        );
                      })}
                    </div>
                  )}

                  {/* Voice mode sits behind its own feature flag (see
                      lib/voice/enabled.ts) — off while the conversational
                      agent is unfinished. The plain mic below stays.
                      Both voice buttons are hidden in the native shell:
                      getUserMedia is denied in the WebView (no RECORD_AUDIO
                      wiring), so on a phone they were dead controls whose
                      only effect was overflowing the toolbar strip
                      (operator-reported, 2026-08-20). */}
                  {/* Voice controls left the composer row (composer
                      cleanup case 5, 2026-08-26). The conversational agent
                      stays flag-gated machinery behind lib/voice/enabled;
                      dictation lives in the keyboard's own mic. The
                      sidebar's voice search is untouched. */}
                  </div>

                  {/* The session pair (docked): the Assistant switch and New
                      chat, quiet at the row's right, beside the key. The
                      switch is the same control that lived under the input
                      chip — same handlers, same Faster/Smarter pair while
                      it is on. */}
                  {!isHero && chatAgentEnabled && (
                    <div className="flex min-w-0 flex-shrink-0 items-center gap-x-2" data-keys-session>
                      <button
                        type="button"
                        role="switch"
                        aria-checked={assistantOn}
                        onClick={toggleAssistant}
                        disabled={submitting || asking}
                        title={assistantOn ? g.assistantOnHint : g.assistantOffHint}
                        className="relative flex h-6 flex-shrink-0 items-center gap-1.5 rounded-full disabled:opacity-50 after:absolute after:-inset-y-[10px] after:-inset-x-1 after:content-[''] lg:after:content-none"
                      >
                        <span
                          aria-hidden
                          className={cn(
                            "relative h-3.5 w-[26px] flex-shrink-0 rounded-full transition-colors duration-200",
                            assistantOn ? "bg-atelier-accent" : "bg-atelier-ink/15",
                          )}
                        >
                          <span
                            className={cn(
                              "absolute left-0.5 top-0.5 h-2.5 w-2.5 rounded-full bg-atelier-paper shadow-[0_1px_2px_rgba(33,29,22,0.25)] transition-transform duration-200 motion-reduce:transition-none",
                              assistantOn && "translate-x-3",
                            )}
                          />
                        </span>
                        <span
                          className={cn(
                            "text-[11px] font-medium transition-colors",
                            assistantOn ? "text-atelier-ink" : "text-atelier-muted",
                          )}
                        >
                          {g.assistant}
                        </span>
                      </button>
                      {assistantOn && (
                        <div className="flex items-center gap-1.5">
                          <button
                            type="button"
                            onClick={() => setAgentEffort("faster")}
                            disabled={asking}
                            aria-pressed={agentEffort === "faster"}
                            title={g.effortFasterHint}
                            className={cn(
                              "relative -my-1.5 rounded-full px-1 py-1.5 text-[11px] font-medium transition-colors disabled:opacity-50 after:absolute after:-inset-y-2 after:content-[''] lg:after:content-none",
                              agentEffort === "faster"
                                ? "text-atelier-ink"
                                : "text-atelier-muted/70 hover:text-atelier-ink",
                            )}
                          >
                            {g.effortFaster}
                          </button>
                          <span aria-hidden className="text-[10px] text-atelier-muted/40">·</span>
                          <button
                            type="button"
                            onClick={() => {
                              // Not disabled, deliberately. A disabled button
                              // dispatches no events, so its `title` is
                              // unreachable on a touch screen — in the phone
                              // shell a free account got a dead control and no
                              // way to find out why. Tapping now says so.
                              if (!chatSmarterAvailable) {
                                setError(g.effortSmarterPaid);
                                return;
                              }
                              setAgentEffort((v) => {
                                if (v !== "smarter") setSparkBurstKey((k) => k + 1);
                                return "smarter";
                              });
                            }}
                            disabled={asking}
                            aria-disabled={!chatSmarterAvailable}
                            aria-pressed={agentEffort === "smarter"}
                            title={chatSmarterAvailable ? g.effortSmarterHint : g.effortSmarterPaid}
                            className={cn(
                              "relative -my-1.5 flex items-center rounded-full px-1 py-1.5 text-[11px] font-medium transition-colors disabled:opacity-50 after:absolute after:-inset-y-2 after:content-[''] lg:after:content-none",
                              agentEffort === "smarter"
                                ? "px-1.5 text-atelier-accent"
                                : "text-atelier-muted/70 hover:text-atelier-ink",
                            )}
                          >
                            <span
                              key={sparkBurstKey}
                              className={cn(
                                "flex origin-left items-center gap-1",
                                sparkBurstKey > 0 &&
                                  agentEffort === "smarter" &&
                                  "motion-safe:[animation:smarter-pop_0.5s_cubic-bezier(0.34,1.56,0.64,1)_1]",
                              )}
                            >
                              {agentEffort === "smarter" && (
                                <SparkIcon className="h-3 w-3 flex-shrink-0" />
                              )}
                              <span
                                className={
                                  agentEffort === "smarter" && asking ? "smarter-shimmer" : undefined
                                }
                              >
                                {g.effortSmarter}
                              </span>
                            </span>
                            {sparkBurstKey > 0 && agentEffort === "smarter" && (
                              <span
                                key={`burst-${sparkBurstKey}`}
                                aria-hidden
                                className="pointer-events-none absolute inset-0 hidden motion-safe:block"
                              >
                                <span className="absolute inset-0 rounded-full border border-atelier-accent/50 [animation:spark-ring_0.5s_ease-out_forwards]" />
                                {SPARK_PARTICLES.map((d, i) => (
                                  <span
                                    key={i}
                                    className={cn(
                                      "absolute left-1/2 top-1/2 bg-atelier-accent [animation:spark-burst_0.6s_ease-out_forwards]",
                                      d.size,
                                      d.star ? "spark-star" : "rounded-full",
                                    )}
                                    style={{
                                      "--spark-x": d.x,
                                      "--spark-y": d.y,
                                      "--spark-scale": d.scale,
                                      animationDelay: `${d.delay}ms`,
                                      opacity: 0,
                                      animationFillMode: "both",
                                    } as React.CSSProperties}
                                  />
                                ))}
                              </span>
                            )}
                          </button>
                        </div>
                      )}
                    </div>
                  )}
                  {/* New chat — a quiet session action at the right, where
                      the pick put it. Same detach-then-reset behaviour. */}
                  {!isHero && hasAnyMessages && (
                    <button
                      type="button"
                      onClick={() => {
                        // Instead of being dead for the whole render, New chat
                        // now sends a queued render to the background and
                        // starts fresh — the render keeps its own visible
                        // turn and Stop (see detachLiveRender).
                        if (canDetach) detachLiveRender();
                        resetChat();
                      }}
                      disabled={locked && !canDetach}
                      className="relative flex-shrink-0 rounded-full px-2 py-1.5 text-xs font-medium text-atelier-muted transition-colors hover:bg-atelier-ink/5 hover:text-atelier-ink disabled:opacity-50 after:absolute after:-inset-y-2 after:content-[''] max-md:hidden lg:after:content-none"
                    >
                      {g.newChat}
                    </button>
                  )}

                  {/* The price lives ON the key (operator's pick,
                      2026-09-22): the same sendCreditCost the old Total cell
                      quoted, as a chip on the Render key — quoted before the
                      button, still. The label carries the ask verdict. */}
                  {asking ? (
                    // Stop for a streaming answer. Separate from the render
                    // Stop below because it cancels a fetch, not a queued
                    // job — nothing to cancel server-side, nothing to refund.
                    <button
                      type="button"
                      onClick={() => askAbortRef.current?.abort()}
                      title={g.stop}
                      aria-label={g.stop}
                      className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full bg-atelier-ink text-atelier-paper transition-colors hover:bg-atelier-ink/90"
                    >
                      <StopIcon className="h-3.5 w-3.5" />
                    </button>
                  ) : submitting ? (
                    <>
                      {/* Two concurrent renders (operator, 2026-09-05): once
                          the send is queued, it can keep rendering in the
                          background — visible turn, own Stop — and the
                          composer frees for the next one. */}
                      {canDetach && (
                        <button
                          type="button"
                          onClick={detachLiveRender}
                          className="flex-shrink-0 rounded-full border border-atelier-rule px-3 py-1.5 text-xs font-medium text-atelier-muted transition-colors hover:border-atelier-muted hover:text-atelier-ink"
                        >
                          {g.renderInBackground}
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={handleStop}
                        disabled={stopping}
                        title={stopping ? g.stopping : g.stop}
                        aria-label={stopping ? g.stopping : g.stop}
                        className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full bg-atelier-ink text-atelier-paper transition-colors hover:bg-atelier-ink/90 disabled:opacity-60"
                      >
                        <StopIcon className="h-3.5 w-3.5" />
                      </button>
                    </>
                  ) : (
                    <button
                      type="submit"
                      data-tour-id="tour-send"
                      disabled={
                        willAsk
                          ? !prompt.trim()
                          : isUploading ||
                            (storyboardActive
                              ? !storyboardReady
                              : !prompt.trim() && pendingAttachments.length === 0)
                      }
                      title={willAsk ? g.askSend : g.send}
                      aria-label={willAsk ? g.askSend : g.send}
                      className={cn(
                        // The RENDER key (operator's pick, 2026-09-22): the
                        // one luminous ochre key, marquee-lettered, wearing
                        // its price — always lit; disabled only dims a
                        // little and stays readable. The classifier's
                        // verdict stays spelled out: with the Assistant on
                        // and a question in the box, the key becomes the
                        // outline Ask twin (spark, accent, free).
                        // The hero (dashboard) composer keeps its own quiet
                        // pair untouched.
                        isHero
                          ? cn(
                              "flex h-9 flex-shrink-0 items-center justify-center gap-2 rounded-[10px] text-[13.5px] font-medium text-atelier-paper shadow-[0_8px_18px_-8px_rgba(35,37,45,0.5)] transition-colors disabled:opacity-30 max-sm:w-9 sm:px-[18px]",
                              willAsk
                                ? "bg-atelier-accent hover:bg-atelier-accent/90 screening:bg-transparent screening:text-atelier-accent screening:shadow-[inset_0_0_0_1px_var(--color-atelier-accent)] screening:hover:bg-atelier-accent/10"
                                : "bg-atelier-ink hover:bg-atelier-ink/90 screening:bg-[#a84e24] screening:text-white screening:shadow-[0_0_30px_-4px_rgba(224,164,104,0.45)] screening:hover:bg-[#8a3d18]",
                            )
                          : cn(
                              "flex h-11 flex-shrink-0 items-center justify-center gap-2 rounded-[12px] px-3.5 text-[12.5px] font-extrabold uppercase tracking-[0.06em] transition-[filter,opacity] max-lg:basis-full sm:px-4",
                              "[font-family:var(--font-marquee)] [font-stretch:112%] [font-variation-settings:'wdth'_112]",
                              willAsk
                                ? "bg-transparent text-atelier-accent shadow-[inset_0_0_0_1.5px_var(--color-atelier-accent)] hover:bg-atelier-accent/10 disabled:opacity-60"
                                : "bg-[linear-gradient(180deg,#f0bb84_0%,#dc9c5e_100%)] text-[#1c1209] shadow-[inset_0_-3px_0_#97602f,inset_0_1px_0_rgba(255,245,230,0.6),0_6px_4px_rgba(0,0,0,0.25),0_24px_28px_-6px_rgba(224,164,104,0.28)] hover:brightness-105 disabled:opacity-80 disabled:saturate-[.6]",
                            ),
                      )}
                    >
                      <span className={cn(isHero && "hidden sm:inline")} data-send-label>
                        {willAsk
                          ? g.askSend
                          : multiAngleMode && selectedAngles.length > 1
                            ? formatMsg(g.renderAnglesN, { n: selectedAngles.length })
                            : g.sendRender}
                      </span>
                      {/* The phone dock's short form of a fanned-out label:
                          RENDER alone, with the fan-out riding the price
                          chip (×3) — "RENDERIZZA 3 ANGOLAZIONI" on one line
                          took the dialogue line's room (audit, 2026-09-22). */}
                      {!isHero && !willAsk && multiAngleMode && selectedAngles.length > 1 && (
                        <span className="hidden" data-send-short>
                          {g.sendRender}
                        </span>
                      )}
                      {willAsk ? (
                        <SparkIcon className="h-4 w-4" />
                      ) : (
                        <SendIcon className={isHero ? "h-4 w-4" : "h-3.5 w-3.5"} />
                      )}
                      {/* The price, on the key alone (no TOTAL cell): the
                          same sendCreditCost the receipt band's Total used
                          to quote, through the same strings — including the
                          fan-out label above ("Render 4 angles"). */}
                      {!isHero && !willAsk && sendCreditCost > 0 && !freeTierClient && (
                        <span className="ml-0.5 rounded-[6px] bg-[#1c1209]/[0.14] px-1.5 py-[3px] text-[10.5px] font-medium normal-case tracking-[0.03em] tabular-nums [font-family:var(--font-slate)]">
                          {multiAngleMode && selectedAngles.length > 1 && (
                            <span className="hidden" data-send-fan>
                              ×{selectedAngles.length} ·{" "}
                            </span>
                          )}
                          {sendCreditCost === 1
                            ? g.durationCreditsOne
                            : formatMsg(g.durationCredits, { n: sendCreditCost })}
                        </span>
                      )}
                    </button>
                  )}
                </div>
              </div>
              {/* Typed a question with the assistant switched off. Sending
                  it would render the question — a credit spent on a sentence
                  nobody wanted a picture of. One quiet line, only while the
                  text actually reads as a question, and it turns the switch
                  on rather than lecturing about it. */}
              {chatAgentEnabled && !assistantOn && !submitting &&
                prompt.trim().length > 8 &&
                classifyMessage(prompt).intent === "ask" && (
                  <div className="px-4 pb-2.5">
                    <button
                      type="button"
                      onClick={toggleAssistant}
                      className="flex items-start gap-1.5 text-left text-[11px] leading-snug text-atelier-muted transition-colors hover:text-atelier-ink"
                    >
                      <SparkIcon className="mt-px h-3 w-3 flex-shrink-0 text-atelier-accent" />
                      <span>{g.assistantOffQuestion}</span>
                    </button>
                  </div>
                )}
              {/* The send was stopped because the text reads as a message to
                  the assistant (2026-09-06: 8 credits on a mode error). The
                  quiet line above is the same judgement offered earlier and
                  passively; this is the last moment before money moves, so it
                  asks outright and does not decide. */}
              {modeQuery !== null && (
                <div className="mx-4 mb-2.5 rounded-card border border-atelier-rule bg-atelier-surface p-3">
                  <p className="text-[12px] leading-snug text-atelier-ink">
                    {g.modeQueryTitle}
                  </p>
                  <div className="mt-2.5 flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        setModeQuery(null);
                        if (!assistantOn) toggleAssistant();
                      }}
                      className="rounded-control bg-atelier-ink px-3 py-1.5 text-xs font-medium text-atelier-paper transition-opacity duration-150 hover:opacity-90"
                    >
                      {g.modeQueryAsk}
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        // Consumed by plainRenderIntended on the next submit:
                        // the person has answered for THIS text, so the guard
                        // stands aside exactly once.
                        renderAnywayRef.current = prompt;
                        setModeQuery(null);
                      }}
                      className="rounded-control border border-atelier-rule px-3 py-1.5 text-xs font-medium text-atelier-ink transition-opacity duration-150 hover:opacity-80"
                    >
                      {g.modeQueryRender}
                    </button>
                  </div>
                </div>
              )}

              {/* Guardrail footer (2026-08-21 incident): what a send spends,
                  and the two first-session nudges. Renders nothing for
                  established paid accounts. */}
              {/* Same rule as the receipt above: "uses today's free
                  generation" is a promise about a render, and a question
                  spends no generation. */}
              {!willAsk &&
                (sendRidesFreeSlot ||
                (!hasGeneratedBefore && contentType === "image")) &&
                !submitting && (
                  <div className="space-y-1 px-4 pb-2.5">
                    {sendRidesFreeSlot && (
                      <p className="flex items-center justify-end gap-1.5 text-[11px] text-atelier-muted">
                        <span className="h-1.5 w-1.5 flex-shrink-0 rounded-full bg-atelier-accent" />
                        {g.dailyFreeNotice} ·{" "}
                        {contentType === "video"
                          ? `${videoDurationSeconds}s ${g.video.toLowerCase()}`
                          : g.image.toLowerCase()}
                        {/* Free sends are pinned server-side to the free
                            lane whatever the picker says (actions.ts) —
                            say so instead of letting the render surprise. */}
                        {/* Read from FREE_TIER_VIDEO_MODEL_ID, never a
                            literal. This said "Kling 1.6" for the hours
                            between the free tier moving to Wan 2.2 Turbo and
                            somebody noticing — telling free users their
                            render runs on a model it no longer runs on. */}
                        {freeTierClient &&
                          contentType === "video" &&
                          videoModelId !== FREE_TIER_VIDEO_MODEL_ID && (
                            <>
                              {" · "}
                              {formatMsg(g.freePinnedNote, {
                                model:
                                  videoModels.find((m) => m.id === FREE_TIER_VIDEO_MODEL_ID)?.name ??
                                  FREE_TIER_VIDEO_MODEL_ID,
                              })}
                            </>
                          )}
                      </p>
                    )}
                    {!hasGeneratedBefore && contentType === "image" && (
                      <p className="text-[11px] text-atelier-muted">{g.imageFirstHint}</p>
                    )}
                  </div>
                )}
            </>
          )}
        </div>

              {/* The assistant strip (2026-08-31, third design after two
                  operator rejections — the brief that stuck: "something
                  more like C, but more subtle and very well
                  engineeringly placed").
                  One quiet line tucked directly under the input chip,
                  inside the card — where the metadata already lives, above
                  the "Picacho is AI" note. Not a floating pill below the
                  card, and not another occupant of the control row: the row
                  keeps its 2026-08-09 overflow contract untouched and
                  nothing new competes with Send.
                  Everything here is 11px and muted until it is ON; the
                  only saturated pixel while idle is the knob when lit.
                  Hidden entirely when the feature flag is off.
                  flex-wrap + min-w-0 on the row is not decoration: this
                  repo has shipped horizontal page overflow twice from a
                  non-wrapping composer row (2026-08-09 icon strip,
                  2026-08-30 reference-photo strip). At Android's larger
                  system font scales this row outgrows a 320px screen, and
                  without wrapping it would push the whole PAGE sideways
                  again. */}
              {/* The assistant strip, back in its original home (operator,
                  2026-09-02: "move assist to the same place it was") — the
                  quiet 26x14 switch under the input chip, with the
                  Faster/Smarter words beside it while it is on. HERO ONLY
                  since the slate (2026-09-22): docked, the switch sits in
                  the keys row beside Render — see the session pair above. */}
              {isHero && chatAgentEnabled && (
                <div className="mt-1.5 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 px-3.5">
                  <button
                    type="button"
                    role="switch"
                    aria-checked={assistantOn}
                    onClick={toggleAssistant}
                    disabled={submitting || asking}
                    title={assistantOn ? g.assistantOnHint : g.assistantOffHint}
                    className="flex h-6 flex-shrink-0 items-center gap-1.5 rounded-full disabled:opacity-50"
                  >
                    {/* Track and knob, sized to the strip: 26x14 with a
                        10px knob sliding 12px. Unmistakably a switch,
                        small enough to be furniture. */}
                    <span
                      aria-hidden
                      className={cn(
                        "relative h-3.5 w-[26px] flex-shrink-0 rounded-full transition-colors duration-200",
                        assistantOn ? "bg-atelier-accent" : "bg-atelier-ink/15",
                      )}
                    >
                      <span
                        className={cn(
                          "absolute left-0.5 top-0.5 h-2.5 w-2.5 rounded-full bg-atelier-paper shadow-[0_1px_2px_rgba(33,29,22,0.25)] transition-transform duration-200 motion-reduce:transition-none",
                          assistantOn && "translate-x-3",
                        )}
                      />
                    </span>
                    <span
                      className={cn(
                        "text-[11px] font-medium transition-colors",
                        assistantOn ? "text-atelier-ink" : "text-atelier-muted",
                      )}
                    >
                      {g.assistant}
                    </span>
                  </button>

                  {assistantOn && (
                    <>
                      <span aria-hidden className="h-3.5 w-px flex-shrink-0 bg-atelier-rule" />
                      <div className="flex items-center gap-1.5">
                        <button
                          type="button"
                          onClick={() => setAgentEffort("faster")}
                          disabled={asking}
                          aria-pressed={agentEffort === "faster"}
                          title={g.effortFasterHint}
                          className={cn(
                            // -my-1.5 py-1.5 keeps the strip the same height
                            // while giving a finger something to hit — bare
                            // 11px text was a 17px-tall target.
                            "-my-1.5 rounded-full px-1 py-1.5 text-[11px] font-medium transition-colors disabled:opacity-50",
                            agentEffort === "faster"
                              ? "text-atelier-ink"
                              : "text-atelier-muted/70 hover:text-atelier-ink",
                          )}
                        >
                          {g.effortFaster}
                        </button>
                        <span aria-hidden className="text-[10px] text-atelier-muted/40">·</span>
                        <button
                          type="button"
                          onClick={() => {
                            // Not disabled, deliberately. A disabled button
                            // dispatches no events, so its `title` is
                            // unreachable on a touch screen — in the phone
                            // shell a free account got a dead control and no
                            // way to find out why. Tapping now says so.
                            if (!chatSmarterAvailable) {
                              setError(g.effortSmarterPaid);
                              return;
                            }
                            setAgentEffort((v) => {
                              if (v !== "smarter") setSparkBurstKey((k) => k + 1);
                              return "smarter";
                            });
                          }}
                          disabled={asking}
                          aria-disabled={!chatSmarterAvailable}
                          aria-pressed={agentEffort === "smarter"}
                          title={chatSmarterAvailable ? g.effortSmarterHint : g.effortSmarterPaid}
                          className={cn(
                            "relative -my-1.5 flex items-center rounded-full px-1 py-1.5 text-[11px] font-medium transition-colors disabled:opacity-50",
                            agentEffort === "smarter"
                              ? "px-1.5 text-atelier-accent"
                              : "text-atelier-muted/70 hover:text-atelier-ink",
                          )}
                        >
                          {/* The pop: keyed on the burst counter so every
                              pick replays it — a spring overshoot on the
                              icon and word together, transform-origin at
                              the left so it grows out of the strip rather
                              than jumping off it. */}
                          <span
                            key={sparkBurstKey}
                            className={cn(
                              "flex origin-left items-center gap-1",
                              sparkBurstKey > 0 &&
                                agentEffort === "smarter" &&
                                "motion-safe:[animation:smarter-pop_0.5s_cubic-bezier(0.34,1.56,0.64,1)_1]",
                            )}
                          >
                            {agentEffort === "smarter" && (
                              <SparkIcon className="h-3 w-3 flex-shrink-0" />
                            )}
                            {/* The shimmer: while a Smarter answer is being
                                worked out, a sheen travels across the word.
                                Light moving over the label reads as
                                thinking; the old opacity pulse read as a
                                fault. Degrades to a steady accent under
                                reduced motion — see globals.css. */}
                            <span
                              className={
                                agentEffort === "smarter" && asking ? "smarter-shimmer" : undefined
                              }
                            >
                              {g.effortSmarter}
                            </span>
                          </span>
                          {/* The burst and the ring, remounted on every pick
                              via the key so they replay each time.
                              pointer-events-none so a spark never eats the
                              tap that made it. */}
                          {sparkBurstKey > 0 && agentEffort === "smarter" && (
                            <span
                              key={`burst-${sparkBurstKey}`}
                              aria-hidden
                              className="pointer-events-none absolute inset-0 hidden motion-safe:block"
                            >
                              <span className="absolute inset-0 rounded-full border border-atelier-accent/50 [animation:spark-ring_0.5s_ease-out_forwards]" />
                              {SPARK_PARTICLES.map((d, i) => (
                                <span
                                  key={i}
                                  className={cn(
                                    "absolute left-1/2 top-1/2 bg-atelier-accent [animation:spark-burst_0.6s_ease-out_forwards]",
                                    d.size,
                                    d.star ? "spark-star" : "rounded-full",
                                  )}
                                  style={{
                                    "--spark-x": d.x,
                                    "--spark-y": d.y,
                                    "--spark-scale": d.scale,
                                    animationDelay: `${d.delay}ms`,
                                    opacity: 0,
                                    animationFillMode: "both",
                                  } as React.CSSProperties}
                                />
                              ))}
                            </span>
                          )}
                        </button>
                      </div>
                    </>
                  )}
                </div>
              )}

        {/* The armed-mode sentence, written out (board's second state):
            never silent arming, never a mystery about what Storyboard did. */}
        {multiAngleMode && contentType === "video" && !submitting && (
          <p className="mt-2 px-1 text-[11.5px] text-atelier-muted" data-armed-note>
            {formatMsg(g.multiAngleArmedNote, { n: selectedAngles.length })}
          </p>
        )}
        {/* "You can leave" reassurance, only while it's actually true:
            liveProgress is set on exactly the paths where a render is queued
            at fal.ai and being driven by polls (submit, multi-angle, resume)
            — the phase the whole fire-and-poll architecture exists for. The
            job's state lives server-side and the webhook collects the result
            even with every tab closed, so leaving costs nothing. Which
            promise we make depends on the platform — see nativeClient. */}
        {liveProgress !== null && (
          <p className="mt-3 text-xs text-atelier-muted/80">
            {nativeClient ? g.safeToCloseNative : g.safeToCloseWeb}
          </p>
        )}
        {/* Submitting's own "running the pipeline" status now shows inside the
            chat bubble itself (with a spinner) as soon as a message exists —
            repeating it here too was redundant clutter right above the AI
            disclaimer. Multi-angle review and upload progress still show
            here since neither has a bubble to live in yet at that point. */}
        {(pendingMultiAngle || isUploading) && (
          <p className="mt-3 text-xs text-atelier-muted/80">
            {pendingMultiAngle ? g.reviewAngles : g.uploading}
          </p>
        )}
      </form>
      )}
      {/* The AI disclaimer lives OUTSIDE the card (operator, 2026-08-31:
          "move Picacho is AI and can make mistakes outside the box. Let the
          UI stay clean") — centered on the page background under the
          composer, the way Claude's own line sits. A plain <div>, not <p>:
          FeedbackLink's popover renders its own <p> tags, and a <p> can't
          legally contain another <p> — browsers silently auto-close the
          outer one, desyncing the DOM from React and throwing a hydration
          error. Rendered only alongside the form: a folded composer keeps
          its pull-up tab clean. */}
      {!composerFolded && (
        <div className={cn("mt-2.5 text-center", !isHero && "max-md:hidden")}>
          {/* Its own ground. Sitting in the sticky wrapper with a transparent
              background meant the scrolling thread passed straight behind
              these words. Paper rather than surface, and inline-block so the
              tint hugs the sentence: it stays visibly OFF the card, which is
              where the operator asked for it, without chat text sliding
              underneath. */}
          {/* Screening dark wears it as a whisper — no pill, no blur, just
              quiet ink on the ground (the Console frame's rule); Frost and
              the hero keep the pill so chat text can't slide underneath. */}
          <span className="inline-block rounded-full bg-atelier-paper/85 px-3 py-1 text-[11px] text-atelier-muted/70 backdrop-blur-sm screening-dark:bg-transparent screening-dark:text-atelier-muted/75 screening-dark:backdrop-blur-none">
          {t.common.aiDisclaimer}{" "}
          <FeedbackLink
            label={t.common.aiDisclaimerFeedbackCta}
            title={t.common.feedbackTitle}
            placeholder={t.common.feedbackPlaceholder}
            submitLabel={t.common.feedbackSubmit}
            sendingLabel={t.common.feedbackSending}
            sentLabel={t.common.feedbackSent}
          />
          </span>
        </div>
      )}
      </div>
      {/* On a phone the dock is fixed over the tab bar, so the disclaimer
          leaves it and closes the page's own scroll instead — one flick
          past the takes shows it just above the dock. */}
      {!isHero && !premiereShown && (
        <div className="px-2 pb-3 pt-6 text-center text-[11px] leading-relaxed text-atelier-muted/80 md:hidden">
          {t.common.aiDisclaimer}{" "}
          <FeedbackLink
            label={t.common.aiDisclaimerFeedbackCta}
            title={t.common.feedbackTitle}
            placeholder={t.common.feedbackPlaceholder}
            submitLabel={t.common.feedbackSubmit}
            sendingLabel={t.common.feedbackSending}
            sentLabel={t.common.feedbackSent}
          />
        </div>
      )}
    </div>
    </div>
    </>
  );
}


/**
 * A slate cell whose value opens a small upward menu — the shape the ENGINE
 * cell established, factored out when the picture lane gained a SIZE and a
 * FRAME of its own (2026-09-23) rather than copied a third and fourth time.
 *
 * Rows carry an optional credit chip because one of them genuinely costs
 * more: 4K on Nano Banana Pro is two credits (image-resolution.ts), and a
 * picker whose rows hide that is the thing the video model picker's own
 * comment warns about — the tradeoff must be visible before picking, not
 * discovered later against the plan limit.
 */
function SlateMenuCell({
  label,
  value,
  open,
  onToggle,
  onClose,
  disabled,
  options,
  selected,
  onPick,
  menuRef,
  testId,
}: {
  label: string;
  value: string;
  open: boolean;
  onToggle: () => void;
  onClose: () => void;
  disabled?: boolean;
  options: readonly { id: string; name: string; sub?: string; credits?: number; creditsLabel?: string }[];
  selected: string;
  onPick: (id: string) => void;
  menuRef: React.RefObject<HTMLDivElement | null>;
  testId?: string;
}) {
  return (
    <div ref={menuRef} className="flex min-w-0 items-stretch" data-slate-cell={testId}>
      <span aria-hidden className="my-2 w-px flex-shrink-0 self-stretch bg-atelier-rule/70" />
      <button
        type="button"
        onClick={onToggle}
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        className={cn(
          "flex min-w-0 flex-col justify-center gap-1 rounded-[10px] px-2.5 py-1.5 text-left transition-colors disabled:opacity-50 max-sm:px-1.5 sm:px-3",
          open ? "bg-atelier-ink/[0.07]" : "hover:bg-atelier-ink/[0.05]",
        )}
      >
        <span className="flex items-center gap-1 text-[9.5px] font-medium uppercase tracking-widest text-atelier-muted" data-cell-label>
          {label}
          <ChevronDownIcon className={cn("h-3 w-3 flex-shrink-0 transition-transform", open && "rotate-180")} />
        </span>
        <span className="min-w-0 truncate text-[13.5px] font-medium leading-tight text-atelier-ink">{value}</span>
      </button>

      {open && (
        <div
          role="listbox"
          className="absolute bottom-full left-0 right-0 z-30 mb-2 max-h-[min(420px,55vh)] overflow-y-auto rounded-[14px] bg-atelier-surface p-1.5 shadow-[0_0_0_1px_var(--frost-ring),0_24px_48px_-12px_rgba(0,0,0,0.25)] backdrop-blur-xl"
        >
          {options.map((o) => (
            <button
              key={o.id}
              type="button"
              role="option"
              aria-selected={o.id === selected}
              onClick={() => {
                onPick(o.id);
                onClose();
              }}
              className={cn(
                "flex w-full items-center gap-2.5 rounded-[12px] px-2 py-1.5 text-left transition-colors",
                o.id === selected
                  ? "bg-atelier-accent/[0.08] text-atelier-ink shadow-[inset_0_0_0_1.5px_var(--color-atelier-accent)]"
                  : "text-atelier-muted hover:bg-atelier-ink/5 hover:text-atelier-ink",
              )}
            >
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-2 text-sm font-medium">
                  <span className="min-w-0 flex-1 truncate">{o.name}</span>
                  {typeof o.credits === "number" && o.credits > 1 && (
                    <span className="flex-shrink-0 rounded-full bg-atelier-accent/10 px-2 py-0.5 font-numeral text-[11px] font-medium tabular-nums text-atelier-accent">
                      {o.creditsLabel}
                    </span>
                  )}
                  {o.id === selected && <CheckIcon className="h-3.5 w-3.5 flex-shrink-0 text-atelier-accent" />}
                </span>
                {o.sub && <span className="block truncate text-xs text-atelier-muted">{o.sub}</span>}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
