"use client";

import { Suspense, useEffect, useMemo, useRef, useState } from "react";
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
import { synthesizeVoice } from "@/lib/voice/actions";
import { parseVoiceCommand } from "@/lib/voice/commands";
import { recommendCreditPack } from "@/lib/stripe/credit-packs";
import { createCreditCheckoutSession } from "@/lib/stripe/actions";
import { isNativeAppClient } from "@/lib/native/platform";
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
import { toUserFacingError, isRawProviderError } from "@/lib/generations/user-facing-error";
import { uploadChatAttachment, deleteChatAttachment, type ChatAttachment } from "@/lib/attachments/actions";
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
import { VoiceRecorderButton } from "@/components/voice-recorder-button";
import { DownloadButton } from "@/components/download-button";
import { ZoomableImage } from "@/components/zoomable-image";
import { NEW_CHAT_EVENT } from "@/components/native-quick-pill";
import { FeedbackLink } from "@/components/feedback-link";
import { ResultActions } from "@/components/result-actions";
import { OnboardingTour, type TourStep } from "@/components/onboarding-tour";
import {
  type AttemptLog,
  type PipelineStepLog,
  type ContentType,
} from "@/lib/generations/pipeline";
import { ANGLE_PRESETS, DEFAULT_ANGLE_IDS, getAnglePreset, type AngleId } from "@/lib/generations/angles";
import type { VideoDurationOption } from "@/lib/generations/providers/video-models";
import { useLocale } from "@/lib/i18n/provider";
import { formatMsg } from "@/lib/i18n/format";
import type { Messages } from "@/lib/i18n/messages";
import { cn } from "@/lib/cn";

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

function summarizeFailure(attempts: AttemptLog[], g: Messages["generate"]): string | null {
  // The user's own rules blocking is its own story — the rule, the words
  // that triggered it, and the suggested rewording, verbatim from the log.
  const blocked = rulesBlockOf(attempts);
  if (blocked) return blocked;

  const last = attempts[attempts.length - 1];
  if (!last) return null;

  // A user-initiated stop, not a real failure — say so plainly instead of
  // running it through the provider-error/missing-traits messaging below,
  // which would either show nothing useful (no error step exists) or, worse,
  // surface a stale reason left over from an earlier attempt.
  if (last.issues.includes("cancelled")) return g.stoppedByUser;

  if (last.issues.includes("provider_error")) {
    const errorStep = [...last.steps]
      .reverse()
      .find(
        (s) =>
          (s.step === "generate" || s.step === "review" || s.step === "draft") &&
          !s.detail.startsWith("Generated") &&
          !s.detail.startsWith("Mock "),
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

    if (poll.error !== null) return { state: "failed", error: poll.error };

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
// hiccup instead of a silent hang.
function isStaleDeployError(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err);
  return /unexpected response was received from the server/i.test(message);
}

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
                    /admin/reports. */}
                {isRawProviderError(item.step.detail) ? g.stepFailedGeneric : item.step.detail}
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
}: {
  succeeded: boolean;
  resultUrl: string | null;
  contentType: ContentType;
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
        <DownloadButton url={resultUrl} contentType={contentType} />
      </div>
    ) : (
      <div className="relative mt-4">
        <ZoomableImage
          src={resultUrl}
          alt={prompt || t.generate.resultAlt}
          className="w-full rounded-media bg-atelier-ink/5 object-cover"
          downloadUrl={resultUrl}
        />
        <DownloadButton url={resultUrl} contentType={contentType} />
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

// Trigger for the composer's slide-out advanced-options panel (multi-angle,
// storyboard/multi-reference) — points left to hint that the options slide
// out in that direction, and flips to point right once open.
function ChevronLeftIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <path d="m15 6-6 6 6 6" />
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
// distinct from the single-angles icon above.
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

// Wide rectangle — 16:9 / widescreen.
function LandscapeIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <rect x="2" y="6" width="20" height="12" rx="2" />
    </svg>
  );
}

// Tall rectangle — 9:16 / vertical.
function PortraitIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <rect x="6" y="2" width="12" height="20" rx="2" />
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
  allowExternalPurchase,
}: {
  needed: number;
  available: number;
  modelName: string;
  seconds: number;
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
  useEffect(() => {
    setNative(isNativeAppClient());
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
        {formatMsg(g.insufficientCredits, { model: modelName, seconds, needed, available })}{" "}
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
        {/* The US-native counterpart: same inline-link voice, but it opens
            website checkout in the system browser (picacho.io is outside
            allowNavigation, so the WebView kicks it external). */}
        {native && allowExternalPurchase && (
          <button
            type="button"
            onClick={() => window.open("https://picacho.io/pricing", "_blank")}
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
        {formatMsg(g.approachingLimitUsage, { used, limit })} · {resetLabel} ·{" "}
        <Link href="/app/settings?tab=usage" className="font-medium text-atelier-accent underline underline-offset-2">
          {g.getMoreUsage}
        </Link>
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

function PendingAttachmentChip({ attachment, onRemove }: { attachment: PendingAttachment; onRemove: () => void }) {
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
        className="absolute right-0.5 top-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-neutral-950/70 text-[#faf8f3] opacity-0 transition-opacity group-hover:opacity-100"
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
  advancedPlanActive: boolean;
  multiAngleAvailable: boolean;
  approachingLimit: boolean;
  voiceModeEnabled: boolean;
  // Raw numbers behind approachingLimit, plus the real reset timestamp when
  // the account has one (see currentPeriodEnd below) — passed straight
  // through from getGenerateWorkspaceData so the usage banner can show
  // specifics ("12 of 15 used") instead of just a plain warning.
  creditsUsed: number;
  creditsLimit: number;
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
}) {
  return (
    <Suspense fallback={null}>
      <GenerateFormInner {...props} />
    </Suspense>
  );
}

type ChatTurn = HistoryTurn & {
  attachments: ChatAttachment[];
  // Which model/length produced this turn — captured client-side at submit
  // time purely for the Takes rail's microlabel. HistoryTurn doesn't record
  // it, so turns resumed from History won't have it; the rail falls back to
  // the plain content-type label there.
  takeMeta?: { modelName: string; durationSeconds: number } | null;
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

type ChatItem = ({ kind: "single" } & ChatTurn) | MultiAngleChatItem;

// Maps a loaded-from-the-database history row (see getGenerationThread) to
// the same shape a freshly-generated turn already gets in `items` — past
// attachments aren't tracked anywhere to reload, so those are always empty;
// everything else lines up 1:1.
function historyItemToChatItem(item: ChatHistoryItem): ChatItem {
  if (item.kind === "multi") {
    return { ...item, attachments: [] };
  }
  return { ...item, attachments: [] };
}

// `domId` (optional) is the anchor the Takes rail scrolls to — a plain DOM
// id, set only at the session-thread call site, plus scroll-mt so the jumped-
// to turn lands with breathing room instead of glued to the container's top.
function SingleTurnBubble({
  turn,
  domId,
  onGenerateAnyway,
}: {
  turn: ChatTurn;
  domId?: string;
  // Offered only on rules-block failures: resubmits this turn's prompt with
  // the caller's own brand prohibitions suspended for that one send.
  onGenerateAnyway?: (turnPrompt: string) => void;
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
              <ResultMedia succeeded={turn.succeeded} resultUrl={turn.resultUrl} contentType={turn.contentType} prompt={turn.prompt} />
              <div className="mt-3 flex items-center gap-2">
                <Badge tone={live ? "success" : "neutral"}>{live ? g.live : g.simulated}</Badge>
                <p className="font-numeral text-xs tabular-nums text-atelier-accent">{formatMsg(g.passedOnAttempt, { n: turn.attempts.length })}</p>
                {typeof turn.matchScore === "number" && (
                  <p className="font-numeral text-xs tabular-nums text-atelier-accent">{formatMsg(g.identityMatch, { n: turn.matchScore })}</p>
                )}
              </div>
              <ResultActions generationId={turn.id} copyText={turn.finalPrompt || turn.prompt} promotable={turn.contentType === "image"} />
            </>
          ) : (
            <div className="mt-3 space-y-2">
              <div className="flex items-center gap-2">
                <Badge tone="danger">{g.couldntValidate}</Badge>
                <p className="text-xs text-atelier-muted">
                  {summarizeFailure(turn.attempts, g) ??
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
          <ResultMedia succeeded={active.succeeded} resultUrl={active.resultUrl} contentType="video" prompt={prompt} />
          {active.succeeded ? (
            <>
              <div className="mt-3 flex items-center gap-2">
                <Badge tone={isLive ? "success" : "neutral"}>{isLive ? g.live : g.simulated}</Badge>
                <p className="font-numeral text-xs tabular-nums text-atelier-accent">{formatMsg(g.passedOnAttempt, { n: active.attempts.length })}</p>
              </div>
              <ResultActions key={active.id} generationId={active.id} copyText={active.finalPrompt || prompt || ""} />
            </>
          ) : (
            <div className="mt-3 flex items-center gap-2">
              <Badge tone="danger">{g.couldntValidate}</Badge>
              <p className="text-xs text-atelier-muted">
                {summarizeFailure(active.attempts, g) ??
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

// One frame of the Takes rail below: stage-grounded thumb, one-line caption,
// caps microlabel, and the identity score in the ochre numeral serif when the
// turn was scored. The whole frame is a button that scrolls the chat to its
// turn (each bubble carries a matching DOM id — see SingleTurnBubble's domId).
function TakesRailEntry({
  domId,
  prompt,
  resultUrl,
  isVideo,
  microLabel,
  score,
}: {
  domId: string;
  prompt: string;
  resultUrl: string | null;
  isVideo: boolean;
  microLabel: string;
  score: number | null;
}) {
  const { t } = useLocale();
  const g = t.generate;
  return (
    <li>
      <button
        type="button"
        onClick={() =>
          document.getElementById(domId)?.scrollIntoView({ behavior: "smooth", block: "start" })
        }
        title={prompt}
        className="group/take block w-full rounded-media text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-atelier-accent"
      >
        {/* Media sits on the fixed Darkroom stage, like every other render
            surface — so anything drawn ON the thumb uses fixed Darkroom
            literals (#a39a88 muted), never theme-mapped colors: the stage
            deliberately doesn't flip with the theme (see globals.css). */}
        <div className="aspect-video overflow-hidden rounded-media bg-atelier-stage">
          {resultUrl ? (
            isVideo ? (
              // #t fragment: paints the first frame in Android WebView too —
              // see history/page.tsx.
              <video src={`${resultUrl}#t=0.1`} muted playsInline preload="metadata" className="h-full w-full object-cover" />
            ) : (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={resultUrl} alt="" className="h-full w-full object-cover" />
            )
          ) : (
            // A take that didn't pass — an empty frame on the stage.
            <div className="flex h-full w-full items-center justify-center text-[#a39a88]">
              <XIcon className="h-4 w-4" />
            </div>
          )}
        </div>
        <p className="mt-1.5 truncate text-[11px] leading-snug text-atelier-ink/80 transition-colors group-hover/take:text-atelier-ink">
          {prompt}
        </p>
        <div className="mt-0.5 flex items-baseline justify-between gap-2">
          <span className="truncate text-[9px] font-medium uppercase tracking-widest text-atelier-muted/80">
            {microLabel}
          </span>
          {score !== null && (
            <span
              title={formatMsg(g.identityMatch, { n: score })}
              className="flex-shrink-0 font-numeral text-[11px] font-semibold tabular-nums text-atelier-accent"
            >
              {score}%
            </span>
          )}
        </div>
      </button>
    </li>
  );
}

// The Takes rail — a slim, desktop-only (hidden below xl, so phones and
// tablets are untouched) filmstrip beside the chat listing THIS session's
// finished turns, newest first, straight from the same `items` state the
// thread renders — no fetch of its own. An in-flight render shows as a
// dashed frame with an ochre "Rendering…" pulse until it's archived into
// `items`. Sticky within the app's scroll container so it stays in view
// while the thread scrolls.
function TakesRail({ items, inFlightPrompt }: { items: ChatItem[]; inFlightPrompt: string | null }) {
  const { t } = useLocale();
  const g = t.generate;
  const takes = [...items].reverse();

  return (
    <aside
      aria-label={g.takesTitle}
      className="sticky top-6 hidden max-h-[calc(100vh-8rem)] w-48 flex-shrink-0 flex-col overflow-y-auto xl:flex"
    >
      <div className="flex items-baseline justify-between gap-2 border-b border-atelier-rule pb-2">
        <h2 className="text-[10px] font-medium uppercase tracking-widest text-atelier-muted">
          {g.takesTitle}
        </h2>
        <p className="font-numeral text-sm font-semibold tabular-nums text-atelier-ink">{items.length}</p>
      </div>

      {takes.length === 0 && inFlightPrompt === null ? (
        <p className="mt-3 text-[11px] leading-relaxed text-atelier-muted/80">{g.takesEmpty}</p>
      ) : (
        <ol className="mt-3 space-y-3.5">
          {inFlightPrompt !== null && (
            <li>
              <div className="flex aspect-video items-center justify-center rounded-media border border-dashed border-atelier-rule">
                <span className="animate-pulse text-[10px] font-medium uppercase tracking-widest text-atelier-accent">
                  {g.takesRendering}
                </span>
              </div>
              {inFlightPrompt && (
                <p
                  title={inFlightPrompt}
                  className="mt-1.5 truncate text-[11px] leading-snug text-atelier-muted"
                >
                  {inFlightPrompt}
                </p>
              )}
            </li>
          )}
          {takes.map((item) => {
            if (item.kind === "single") {
              return (
                <TakesRailEntry
                  key={item.id}
                  domId={`take-${item.id}`}
                  prompt={item.prompt}
                  resultUrl={item.succeeded ? item.resultUrl : null}
                  isVideo={item.contentType === "video"}
                  microLabel={
                    !item.succeeded
                      ? g.failed
                      : item.contentType === "video"
                        ? item.takeMeta
                          ? `${item.takeMeta.modelName} · ${formatMsg(g.durationSecondsShort, { n: item.takeMeta.durationSeconds })}`
                          : g.video
                        : g.image
                  }
                  score={typeof item.matchScore === "number" ? item.matchScore : null}
                />
              );
            }
            const firstClip = item.angles.find((a) => a.succeeded && a.resultUrl) ?? null;
            return (
              <TakesRailEntry
                key={item.groupId}
                domId={`take-${item.groupId}`}
                prompt={item.prompt}
                resultUrl={firstClip?.resultUrl ?? null}
                isVideo
                microLabel={
                  firstClip ? formatMsg(g.takesAngles, { n: item.angles.length }) : g.failed
                }
                score={null}
              />
            );
          })}
        </ol>
      )}
    </aside>
  );
}

function GenerateFormInner({
  characters,
  videoModels,
  defaultVideoModelId,
  advancedPlanActive,
  multiAngleAvailable,
  approachingLimit,
  voiceModeEnabled,
  creditsUsed,
  creditsLimit,
  purchasedCredits,
  currentPeriodEnd,
  allowExternalPurchase = false,
  heroMode = false,
  greeting,
  startOnboarding = false,
  dailyFreeAvailable = false,
  hasGeneratedBefore = true,
}: {
  characters: CharacterOption[];
  videoModels: VideoModelOption[];
  defaultVideoModelId: string;
  advancedPlanActive: boolean;
  multiAngleAvailable: boolean;
  approachingLimit: boolean;
  voiceModeEnabled: boolean;
  creditsUsed: number;
  creditsLimit: number;
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
    return fromUrl && characters.some((c) => c.id === fromUrl) ? fromUrl : "";
  });
  const [characterMenuOpen, setCharacterMenuOpen] = useState(false);
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
  const [liveMultiAngle, setLiveMultiAngle] = useState<{ prompt: string; attachments: ChatAttachment[]; angleIds: AngleId[] } | null>(null);


  // New composer toolbar state (the + menu / creation-mode chip / slide-out
  // advanced options) — see the render return below.
  const [plusMenuOpen, setPlusMenuOpen] = useState(false);
  const [creationModeActive, setCreationModeActive] = useState(false);
  const [advancedOpen, setAdvancedOpen] = useState(false);
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
  const hasAnyMessages = items.length > 0 || livePrompt !== null || liveMultiAngle !== null;
  const isHero = heroMode && !creationModeActive && !hasAnyMessages;

  // The Takes rail renders only for the /app/generate instance (heroMode is
  // the dashboard-home embed, which keeps its narrower container and its
  // plain greeting), and only at xl+ — see TakesRail itself for the
  // below-xl hiding, so phones and tablets are untouched.
  const takesRailEnabled = !heroMode;

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
  const [videoModelId, setVideoModelId] = useState(defaultVideoModelId);
  // Clip continuation, arriving via ?continue=<generationId> from a video's
  // History page. The chip above the composer shows it; the id rides the
  // submit as continue_from_generation_id and the server re-validates
  // ownership. Seedance-only: the mount effect below steers the model there
  // once, and a LATER manual switch away quietly drops the chip instead of
  // fighting the user for the picker.
  const [continueFromId, setContinueFromId] = useState<string | null>(() =>
    searchParams.get("continue"),
  );
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
  const storyboardCredits = Math.ceil(storyboardTotalSeconds * 0.5); // $0.14/s ÷ $0.28 — server recomputes authoritatively
  const storyboardReady =
    storyboardShots.length >= 2 && storyboardShots.every((s) => s.prompt.trim().length > 0);
  useEffect(() => {
    if (storyboardMode && (contentType !== "video" || videoModelId !== "kling-o3-pro")) {
      setStoryboardMode(false);
    }
  }, [storyboardMode, contentType, videoModelId]);

  const continueModelAppliedRef = useRef(false);
  useEffect(() => {
    if (!continueFromId) return;
    if (videoModelId === "seedance" || videoModelId === "seedance-2") {
      continueModelAppliedRef.current = true;
      return;
    }
    if (!continueModelAppliedRef.current) {
      setVideoModelId("seedance-2");
    } else {
      setContinueFromId(null);
    }
  }, [continueFromId, videoModelId]);
  const [videoModelMenuOpen, setVideoModelMenuOpen] = useState(false);
  const videoModelMenuRef = useRef<HTMLDivElement>(null);

  // Clip length — each model has its own real set of valid durations (see
  // video-models.ts), so this always has to be one of the CURRENT model's
  // options, not an arbitrary number. Starts at the default model's default
  // duration; the effect below re-snaps it any time the model changes to one
  // where the current value isn't valid (e.g. switching from Kling O3's 15s
  // down to Kling 1.6, which tops out at 10s).
  const [videoDurationSeconds, setVideoDurationSeconds] = useState(
    () => videoModels.find((m) => m.id === defaultVideoModelId)?.defaultDurationSeconds ?? 5,
  );

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
  const selectedVideoModel = videoModels.find((m) => m.id === videoModelId);
  const selectedCreditCost =
    contentType === "video" && storyboardActive
      ? storyboardCredits
      : contentType === "video" && selectedVideoModel
        ? (selectedVideoModel.durations.find((d) => d.seconds === videoDurationSeconds)?.creditWeight ?? 1)
        : 1;
  const creditsAvailable = Math.max(0, creditsLimit - creditsUsed) + purchasedCredits;
  const cannotAfford = selectedCreditCost > creditsAvailable;
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
  const [videoAspectRatio, setVideoAspectRatio] = useState<"16:9" | "9:16" | null>(null);

  const [videoAdvancedMode, setVideoAdvancedMode] = useState<"none" | "storyboard" | "multiref">("none");
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
    if (!characterMenuOpen) return;
    function onClick(e: MouseEvent) {
      if (characterMenuRef.current && !characterMenuRef.current.contains(e.target as Node)) {
        setCharacterMenuOpen(false);
      }
    }
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [characterMenuOpen]);

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
      const audio = new Audio(`data:audio/mpeg;base64,${result.audioBase64}`);
      currentAudioRef.current = audio;
      await new Promise<void>((resolve) => {
        let settled = false;
        const finish = () => {
          if (settled) return;
          settled = true;
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
    setSelectedAngles(DEFAULT_ANGLE_IDS);
    clearAdvancedVideo();
    setAnchorPhotoPath(null);
  }

  // The native quick pill's pencil fires this event from OUTSIDE the
  // composer (it's fixed chrome in the app layout, not a child here). Ref
  // indirection so the listener binds once but always calls the latest
  // resetChat; ignored mid-request for the same reason the New chat button
  // is disabled then — clearing the live bubble would orphan the render.
  // "Generate anyway" on a rules-block failure: a one-shot flag consumed by
  // the next submit (adds skip_brand_rules=1 — the server logs the send as
  // rules-suspended), plus a ref to the composer form so the button can
  // resubmit programmatically after restoring the blocked prompt.
  const skipRulesOnceRef = useRef(false);
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

  function toggleAngle(id: AngleId) {
    setSelectedAngles((prev) => (prev.includes(id) ? prev.filter((a) => a !== id) : [...prev, id]));
  }

  function toggleMultiAngleMode() {
    setMultiAngleMode((prev) => {
      const next = !prev;
      if (next) {
        clearAdvancedVideo();
        setCompanionCharacterIds([]);
      }
      return next;
    });
  }

  function clearAdvancedVideo() {
    setVideoAdvancedMode("none");
    setAdvancedPanelOpen(false);
    setStoryboardStartPath(null);
    setStoryboardEndPath(null);
    setMultiRefPaths([]);
    setPanelUploads([]);
  }

  function openAdvancedVideo(mode: "storyboard" | "multiref") {
    setMultiAngleMode(false);
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
  function handlePanelFileSelected(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setPanelUploadBusy(true);
    const formData = new FormData();
    formData.set("file", file);
    uploadChatAttachment(formData)
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

  async function confirmMultiAngle() {
    if (!pendingMultiAngle || !characterId) return;
    if (selectedAngles.length === 0) {
      setError(g.pickAngle);
      return;
    }

    const { prompt: mPrompt, attachments } = pendingMultiAngle;
    requestNotificationPermission();
    setSubmitting(true);
    setStopping(false);
    setError("");
    setLiveMultiAngle({ prompt: mPrompt, attachments, angleIds: selectedAngles });
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
    selectedAngles.forEach((id) => formData.append("angle", id));
    // Same attachment/anchor-photo priority as the single-generation path
    // above — see the comments there.
    const anchorAttachment = attachments.find((a) => a.type.startsWith("image/"));
    if (anchorAttachment) {
      formData.set("attachment_reference_url", anchorAttachment.url);
    } else if (anchorPhotoPath) {
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
      if (stale) setTimeout(() => window.location.reload(), 1800);
      return;
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
      return;
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
      return;
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
    notifyIfHidden(
      anyAngleSucceeded ? g.notifyReadyTitle : g.notifyFailedTitle,
      anyAngleSucceeded
        ? formatMsg(g.passedOnAttempt, { n: angles[0]?.attempts.length ?? 1 })
        : (summarizeFailure(angles[0]?.attempts ?? [], g) ?? g.noPassingResultOne),
    );
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

      const formData = new FormData();
      formData.set("file", file);
      uploadChatAttachment(formData)
        .then((result) => {
          setPendingAttachments((prev) =>
            prev.map((a) => {
              if (a.id !== id) return a;
              if (result.error !== null) return { ...a, status: "error", error: result.error };
              return { ...a, status: "ready", url: result.attachment!.url, path: result.attachment!.path };
            }),
          );
          if (result.error !== null) setError(result.error);
        })
        .catch(() => {
          // A rejected promise here (vs. the function's own { error } return
          // above) means the request never made it into uploadChatAttachment
          // at all — e.g. Next.js's Server Action body size limit rejecting
          // an oversized file before our own 25MB check ever runs. Without
          // this catch, the chip was left stuck on its spinner forever with
          // no visible sign anything had gone wrong.
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
  const [tourActive, setTourActive] = useState(
    () => startOnboarding === true || searchParams.get("tour") === "1",
  );
  const [tourStepIndex, setTourStepIndex] = useState(0);

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
  // Deliberately quiet. It refreshes the route when something lands so the
  // result appears in the workspace and History, rather than trying to
  // reconstruct a live bubble for a request this page never made.
  useEffect(() => {
    let cancelled = false;

    (async () => {
      let inFlight: Awaited<ReturnType<typeof listInFlightGenerations>> = [];
      try {
        inFlight = await listInFlightGenerations();
      } catch {
        // Never block the composer over this — it's recovery, not the
        // main path.
        return;
      }
      if (cancelled || inFlight.length === 0) return;

      setLiveProgress(
        inFlight.length === 1 ? g.resumingRender : formatMsg(g.finishingRenders, { n: inFlight.length }),
      );

      await Promise.all(
        inFlight.map((gen) =>
          awaitQueuedGeneration(
            gen.id,
            () => {},
            () => cancelled,
            g.lostTrackOfRender,
          ),
        ),
      );

      if (cancelled) return;
      setLiveProgress(null);
      router.refresh();
    })();

    return () => {
      cancelled = true;
    };
    // Once per mount. Re-running on every render would start duplicate
    // pollers for the same jobs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
    if (searchParams.get("tour") !== "1") return;
    setTourActive(true);
    setTourStepIndex(0);
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
  }, [searchParams, router, pathname]);

  // The "AI providers" and "multi-angle/storyboard" stops point at composer
  // elements that only exist once the composer is out of hero mode with
  // video selected (see isHero above — the model picker and the advanced-
  // options arrow are both gated behind creationModeActive). This nudges the
  // composer into that state a render ahead of OnboardingTour trying to
  // measure the target, the same way clicking "Create video" from the +
  // menu would.
  // The tour's stops, in first-session order. `revealedByTour` marks the two
  // composer targets the tour itself flips into existence (video mode) — they
  // are exempt from the present-in-DOM filter below, which otherwise drops
  // stops whose anchor doesn't exist in this layout (the sidebar links on
  // phones and in the native shell), so the tour never spotlights thin air.
  const ob = t.onboarding;
  const allTourSteps: (TourStep & { revealedByTour?: boolean })[] = [
    { targetId: null, title: ob.welcomeTitle, body: ob.welcomeBody },
    { targetId: "tour-characters", title: ob.charactersTitle, body: ob.charactersBody },
    { targetId: "tour-character-select", title: ob.characterSelectTitle, body: ob.characterSelectBody },
    { targetId: "tour-prompt", title: ob.promptTitle, body: ob.promptBody },
    { targetId: "tour-video-model", title: ob.providersTitle, body: ob.providersBody, revealedByTour: true },
    { targetId: "tour-advanced-toggle", title: ob.multiAngleTitle, body: ob.multiAngleBody, revealedByTour: true },
    { targetId: "tour-templates", title: ob.templatesTitle, body: ob.templatesBody },
    { targetId: "tour-community", title: ob.communityTitle, body: ob.communityBody },
    { targetId: null, title: ob.doneTitle, body: ob.doneBody },
  ];
  // Filtered once per tour open — a step list that mutated mid-tour would
  // yank the current index out from under the person.
  const tourSteps = useMemo(
    () =>
      tourActive
        ? allTourSteps.filter(
            (s) =>
              s.targetId === null ||
              s.revealedByTour ||
              document.querySelector(`[data-tour-id="${s.targetId}"]`) !== null,
          )
        : allTourSteps,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [tourActive],
  );

  useEffect(() => {
    // Never while a request is live: setContentType triggers the resetChat
    // effect, which would wipe the in-flight thread mid-render — same hazard
    // as the creation-mode chip's clear button, guarded the same way. With
    // `submitting` in the deps, the nudge still lands once the render ends
    // if the tour is somehow open through one.
    if (!tourActive || submitting) return;
    // Target-based, not index-based: the filtered step list shifts indexes
    // per layout, so the old hardcoded `=== 2 || === 3` would reveal the
    // composer on the wrong stop.
    const target = tourSteps[tourStepIndex]?.targetId;
    const needsVideoMode = target === "tour-video-model" || target === "tour-advanced-toggle";
    if (needsVideoMode) {
      setContentType("video");
      setCreationModeActive(true);
    }
  }, [tourActive, tourStepIndex, submitting, tourSteps]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [items.length, revealedCount, livePrompt, liveMultiAngle]);

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
    if (contentType !== "video") setMultiAngleMode(false);
  }, [contentType]);

  // Typing on the dashboard's landing composer and hitting send arrives here
  // as ?prompt=<text> — unlike ?voice=, this only fills the textarea so the
  // person can review or edit before actually sending it.
  useEffect(() => {
    const prefill = searchParams.get("prompt");
    if (!prefill) return;
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

    const shouldSpeak = Boolean(opts?.speak);

    requestNotificationPermission();

    setError("");
    setSubmitting(true);
    setStopping(false);
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
      const anchorAttachment = submittedAttachments.find((a) => a.type.startsWith("image/"));
      if (anchorAttachment) {
        formData.set("attachment_reference_url", anchorAttachment.url);
      } else if (anchorPhotoPath) {
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
    if (effectiveContentType === "video") {
      formData.set("video_model_id", videoModelId);
      formData.set("video_duration_seconds", String(videoDurationSeconds));
      if (videoAspectRatio) formData.set("video_aspect_ratio", videoAspectRatio);
    }
    if (skipRulesOnceRef.current) {
      // One send only — the override never outlives the click that asked
      // for it (the server logs the suspension in the pipeline trace).
      formData.set("skip_brand_rules", "1");
      skipRulesOnceRef.current = false;
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
      if (shouldSpeak) speak(formatMsg(g.speakError, { error: message }));
      if (stale) setTimeout(() => window.location.reload(), 1800);
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
      if (shouldSpeak) speak(formatMsg(g.speakError, { error: result.error }));
      return;
    }

    // Queued rather than finished: the render is sitting with fal.ai and this
    // drives it to completion in short polls instead of one long request.
    // See awaitQueuedGeneration for why that matters.
    let succeeded = result.succeeded;
    let resultUrl = result.resultUrl;
    let queuedFailure: string | null = null;

    if (result.pending) {
      setLiveProgress(result.progress ?? null);
      const outcome = await awaitQueuedGeneration(
        result.id,
        setLiveProgress,
        () => userStoppedRef.current,
        g.lostTrackOfRender,
      );
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
    const failureReason = succeeded
      ? null
      : (queuedFailure ?? summarizeFailure(result.attempts, g));
    setLiveResult({
      id: result.id,
      succeeded,
      resultUrl,
      attempts: result.attempts.length,
      reason: failureReason,
      finalPrompt: result.finalPrompt,
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
        attachments: submittedAttachments,
        // Submit-time snapshot for the Takes rail's microlabel — the model/
        // duration the request actually ran with, not wherever the pickers
        // sit by the time this resolves.
        takeMeta:
          effectiveContentType === "video" && selectedVideoModel
            ? { modelName: selectedVideoModel.name, durationSeconds: videoDurationSeconds }
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
    notifyIfHidden(
      succeeded ? g.notifyReadyTitle : g.notifyFailedTitle,
      succeeded
        ? formatMsg(g.passedOnAttempt, { n: result.attempts.length })
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
    skipRulesOnceRef.current = true;
    setPrompt(turnPrompt);
    setTimeout(() => composerFormRef.current?.requestSubmit(), 40);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();

    const readyAttachments = pendingAttachments
      .filter((a): a is PendingAttachment & { status: "ready"; url: string; path: string } => a.status === "ready" && Boolean(a.url) && Boolean(a.path))
      .map((a) => ({ path: a.path, url: a.url, name: a.name, type: a.type, size: a.size }));

    // Kling O3's reference input rejects extreme aspect ratios AT THE
    // PROVIDER — a 422 after credits are already reserved (2026-08-24
    // incident: 3 credits burned on an ultra-wide frame). Measure the
    // anchor image up front and fail free instead. A measurement failure
    // never blocks the send — the provider stays the backstop.
    if (contentType === "video" && videoModelId.startsWith("kling-o3")) {
      const anchor = readyAttachments.find((a) => a.type.startsWith("image/"));
      if (anchor) {
        const aspectOk = await new Promise<boolean>((resolve) => {
          const probe = new Image();
          probe.onload = () => {
            const ratio = probe.naturalWidth / Math.max(1, probe.naturalHeight);
            resolve(ratio >= 0.4 && ratio <= 2.5);
          };
          probe.onerror = () => resolve(true);
          probe.src = anchor.url;
        });
        if (!aspectOk) {
          setError(g.referenceAspectError);
          return;
        }
      }
    }

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
  const characterPicker =
    characters.length > 0 ? (
      <div ref={characterMenuRef} data-tour-id="tour-character-select" className="relative">
        <button
          type="button"
          onClick={() => setCharacterMenuOpen((v) => !v)}
          disabled={locked}
          aria-haspopup="listbox"
          aria-expanded={characterMenuOpen}
          className={cn(
            // Borderless soft chip — same recipe as the input box (operator,
            // 2026-08-21: "apply the same to Select Character").
            "flex w-full items-center gap-2.5 rounded-full py-1.5 pl-1.5 pr-3.5 text-left transition-colors disabled:opacity-50",
            characterMenuOpen
              ? "bg-atelier-ink/[0.08]"
              : !characterId
                ? // Nothing picked yet: warm the chip so the empty selector
                  // can't be overlooked (the 2026-08-21 incident: a new user
                  // created a character, never selected it, and sent a
                  // character-less render without realising). Still never
                  // auto-picks — that rule stands.
                  "bg-atelier-accent/[0.09] hover:bg-atelier-accent/[0.14]"
                : "bg-atelier-ink/[0.045] hover:bg-atelier-ink/[0.07]",
          )}
        >
          {isMultiCharacter ? (
            <span className="flex flex-shrink-0 -space-x-2">
              {[currentCharacter, ...companionCharacters].filter(Boolean).slice(0, 3).map((c, i) => (
                <span
                  key={c!.id}
                  className="flex h-7 w-7 items-center justify-center rounded-full border-2 border-atelier-paper bg-atelier-ink/10 text-xs font-medium text-atelier-muted"
                  style={{ zIndex: 3 - i }}
                >
                  {c!.name?.[0]?.toUpperCase() ?? "?"}
                </span>
              ))}
            </span>
          ) : (
            <span className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full bg-atelier-ink/10 text-xs font-medium text-atelier-muted">
              {currentCharacter?.name?.[0]?.toUpperCase() ?? "?"}
            </span>
          )}
          <span
            className={cn(
              "min-w-0 flex-1 truncate text-sm",
              currentCharacter ? "text-atelier-ink" : "text-atelier-muted",
            )}
          >
            {isMultiCharacter
              ? formatMsg(g.multiCharacterSummary, { name: currentCharacter?.name ?? "", n: companionCharacterIds.length })
              : (currentCharacter?.name ?? g.selectCharacter)}
          </span>
          <ChevronDownIcon
            className={cn(
              "h-3.5 w-3.5 flex-shrink-0 text-atelier-muted transition-transform",
              characterMenuOpen && "rotate-180",
            )}
          />
        </button>

        {characterMenuOpen && (
          <div
            role="listbox"
            aria-multiselectable="true"
            className="absolute left-0 top-full z-20 mt-1.5 max-h-72 w-full min-w-[240px] overflow-y-auto rounded-[14px] bg-atelier-surface p-1.5 shadow-[0_0_0_1px_var(--frost-ring),0_24px_48px_-12px_rgba(0,0,0,0.25)] backdrop-blur-xl"
          >
            {characters.map((c) => {
              const selected = c.id === characterId || companionCharacterIds.includes(c.id);
              const disabled = !selected && castSize >= 4;
              return (
                <button
                  key={c.id}
                  type="button"
                  role="option"
                  aria-selected={selected}
                  disabled={disabled}
                  onClick={() => toggleCompanionCharacter(c.id)}
                  className={cn(
                    "flex w-full items-center gap-2.5 rounded-control px-2.5 py-2 text-left text-sm transition-colors disabled:cursor-not-allowed disabled:opacity-40",
                    selected ? "bg-atelier-ink/5 text-atelier-ink shadow-[inset_2px_0_0_var(--color-atelier-accent)]" : "text-atelier-muted hover:bg-atelier-ink/5 hover:text-atelier-ink",
                  )}
                >
                  <span
                    className={cn(
                      "flex h-4 w-4 flex-shrink-0 items-center justify-center rounded-[5px] border transition-colors",
                      selected ? "border-atelier-ink bg-atelier-ink" : "border-atelier-rule bg-transparent",
                    )}
                  >
                    {selected && <CheckIcon className="h-2.5 w-2.5 text-atelier-paper" />}
                  </span>
                  <span className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full bg-atelier-ink/10 text-[11px] font-medium text-atelier-muted">
                    {c.name?.[0]?.toUpperCase() ?? "?"}
                  </span>
                  <span className="min-w-0 flex-1 truncate">{c.name}</span>
                  {c.id === characterId && <span className="text-[10px] text-atelier-muted/70">{g.primaryCharacter}</span>}
                </button>
              );
            })}
            <div className="mt-1 border-t border-atelier-rule/70 px-2.5 pt-2 text-[11px] leading-snug text-atelier-muted/80">
              {castSize >= 4 ? g.multiCharacterCapReached : g.multiCharacterHint}
            </div>
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
    return (
      model.durations.find((d) => d.seconds === seconds)?.creditWeight ??
      model.durations.find((d) => d.seconds === model.defaultDurationSeconds)?.creditWeight ??
      1
    );
  }

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
      <div ref={videoModelMenuRef} data-tour-id="tour-video-model" className="relative min-w-0 flex-1">
        <button
          type="button"
          onClick={() => setVideoModelMenuOpen((v) => !v)}
          disabled={locked}
          aria-haspopup="listbox"
          aria-expanded={videoModelMenuOpen}
          className={cn(
            // Borderless soft chip — matches the character select above.
            "flex w-full items-center gap-2 rounded-full py-1.5 pl-3 pr-3.5 text-left transition-colors disabled:opacity-50",
            videoModelMenuOpen ? "bg-atelier-ink/[0.08]" : "bg-atelier-ink/[0.045] hover:bg-atelier-ink/[0.07]",
          )}
        >
          <span className="min-w-0 flex-1 truncate text-sm text-atelier-ink">{currentVideoModel?.name}</span>
          {currentDurationCredits > 1 && (
            <span className="flex-shrink-0 rounded-full bg-atelier-accent/10 px-2 py-0.5 font-numeral text-[11px] font-medium tabular-nums text-atelier-accent">
              {formatMsg(g.creditsEach, { n: currentDurationCredits })}
            </span>
          )}
          <ChevronDownIcon
            className={cn(
              "h-3.5 w-3.5 flex-shrink-0 text-atelier-muted transition-transform",
              videoModelMenuOpen && "rotate-180",
            )}
          />
        </button>

        {videoModelMenuOpen && (
          <div
            role="listbox"
            className="absolute left-0 top-full z-20 mt-1.5 w-full min-w-[260px] overflow-y-auto rounded-[14px] bg-atelier-surface p-1.5 shadow-[0_0_0_1px_var(--frost-ring),0_24px_48px_-12px_rgba(0,0,0,0.25)] backdrop-blur-xl"
          >
            {videoModels.map((m) => {
              const listCredits = creditsForDuration(m, m.defaultDurationSeconds);
              return (
                <button
                  key={m.id}
                  type="button"
                  role="option"
                  aria-selected={m.id === videoModelId}
                  onClick={() => {
                    setVideoModelId(m.id);
                    setVideoModelMenuOpen(false);
                  }}
                  className={cn(
                    "flex w-full flex-col gap-0.5 rounded-control px-2.5 py-2 text-left transition-colors",
                    m.id === videoModelId
                      ? "bg-atelier-ink/5 text-atelier-ink shadow-[inset_2px_0_0_var(--color-atelier-accent)]"
                      : "text-atelier-muted hover:bg-atelier-ink/5 hover:text-atelier-ink",
                  )}
                >
                  <span className="flex items-center gap-2 text-sm">
                    <span className="min-w-0 flex-1 truncate">{m.name}</span>
                    {listCredits > 1 && (
                      <span className="flex-shrink-0 rounded-full bg-atelier-accent/10 px-2 py-0.5 font-numeral text-[11px] font-medium tabular-nums text-atelier-accent">
                        {formatMsg(g.creditsEach, { n: listCredits })}
                      </span>
                    )}
                    {m.id === videoModelId && <CheckIcon className="h-3.5 w-3.5 flex-shrink-0 text-atelier-ink" />}
                  </span>
                  <span className="text-xs text-atelier-muted">{m.description}</span>
                </button>
              );
            })}
          </div>
        )}
      </div>
    ) : null;

  // Clip length picker — a compact segmented control (not a dropdown, since
  // it's never more than 3 options) sitting right next to the model picker.
  // Each option shows its own credit cost so the tradeoff of picking a
  // longer clip is visible before generating, not just discovered later
  // against the plan limit.
  const videoDurationPicker =
    // Hidden while a storyboard is on: per-shot durations rule there, and a
    // dead global picker would just invite a click that does nothing.
    contentType === "video" && !storyboardActive && currentVideoModel && currentVideoModel.durations.length > 1 ? (
      <div className="flex flex-shrink-0 items-center gap-1 rounded-full border border-atelier-rule p-1">
        {currentVideoModel.durations.map((d) => (
          <button
            key={d.seconds}
            type="button"
            disabled={locked}
            onClick={() => setVideoDurationSeconds(d.seconds)}
            aria-pressed={videoDurationSeconds === d.seconds}
            title={formatMsg(g.durationCredits, { n: d.creditWeight })}
            className={cn(
              "rounded-full px-2.5 py-1 text-xs font-medium transition-colors disabled:opacity-50",
              videoDurationSeconds === d.seconds
                ? "bg-atelier-ink text-atelier-paper"
                : "text-atelier-muted hover:text-atelier-ink",
            )}
          >
            {formatMsg(g.durationSecondsShort, { n: d.seconds })}
          </button>
        ))}
      </div>
    ) : null;

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
    // Leave the composer the way it was before the tour nudged it into
    // video-creation mode, so a first-time user lands back on the plain
    // hero greeting rather than a half-filled-in composer they never chose.
    clearCreationMode();
    void setHasCompletedOnboarding();
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
    {/* Below xl (and on the dashboard-home embed) this wrapper is a plain
        block and nothing changes; at xl+ on /app/generate it becomes the row
        that seats the Takes rail beside the chat card. The card keeps
        min-w-0 + flex-1 so it yields the rail's slim column without any of
        its internals reflowing differently. */}
    <div className={cn(takesRailEnabled && "xl:flex xl:items-start xl:gap-5")}>
    <div
      className={cn(
        "relative flex flex-col transition-all duration-300 ease-out",
        takesRailEnabled && "xl:min-w-0 xl:flex-1",
        isHero
          ? "min-h-[60vh] items-center justify-center gap-6"
          : // isolate + transform-gpu forces this onto its own GPU layer, which
            // works around a Safari bug where border-radius on an element whose
            // ancestor has a CSS transition renders with square/banded corners
            // instead of the actual radius. The box-shadow itself lives on the
            // decorative aria-hidden layer rendered just below, not on this
            // element — putting the Safari shadow-corner mask fix here would
            // also clip the "+" dropdown and character switcher, which need
            // to render outside this box's bounds.
            // Borderless (operator, 2026-08-21): edge definition comes from
            // the shadow layer's 1px ring below, GPT-style — no border line.
            "isolate transform-gpu rounded-[26px] bg-atelier-surface/80 backdrop-blur-xl",
        justArrived && "transition-opacity duration-[220ms] ease-out",
        justArrived && !settled && "opacity-0",
      )}
    >
      {!isHero && (
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 -z-10 rounded-[26px] shadow-[0_0_0_1px_var(--frost-ring),0_2px_6px_rgba(0,0,0,0.04),0_24px_56px_-20px_rgba(0,0,0,0.22)] [-webkit-mask-image:-webkit-radial-gradient(white,black)]"
        />
      )}
      {isHero && <h1 className="text-2xl font-semibold text-atelier-ink">{greeting}</h1>}

      {!isHero && (
      <>
      <div className="space-y-3 border-b border-atelier-rule p-5">
        {hasAnyMessages && (
          <div className="flex justify-end">
            <button
              type="button"
              onClick={() => resetChat()}
              disabled={locked}
              className="flex-shrink-0 rounded-full border border-atelier-rule px-3.5 py-2 text-xs font-medium text-atelier-muted transition-colors hover:border-atelier-muted hover:text-atelier-ink disabled:opacity-50"
            >
              {g.newChat}
            </button>
          </div>
        )}

        {characterPicker}
        {referencePhotos.length > 1 && videoAdvancedMode === "none" && !isMultiCharacter && (
          <div>
            <p className="text-[11px] font-medium uppercase tracking-widest text-atelier-muted">
              {g.anchorPhotoLabel}
            </p>
            <p className="mt-0.5 text-[11px] leading-snug text-atelier-muted/80">{g.anchorPhotoHint}</p>
            <div className="mt-1.5 flex gap-1.5">
              {referencePhotos.map((p, i) => {
                const selected = anchorPhotoPath ? anchorPhotoPath === p.path : i === 0;
                return (
                  <button
                    key={p.path}
                    type="button"
                    onClick={() => setAnchorPhotoPath(p.path)}
                    className={cn(
                      "relative h-12 w-12 flex-shrink-0 overflow-hidden rounded-media border-2",
                      selected ? "border-atelier-ink" : "border-transparent",
                    )}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={p.url} alt="" className="h-full w-full object-cover" />
                    {selected && (
                      <span className="absolute right-0.5 top-0.5 flex h-3.5 w-3.5 items-center justify-center rounded-full bg-atelier-ink text-atelier-paper">
                        <CheckIcon className="h-2 w-2" />
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        )}
        {isMultiCharacter && castMemberMissingPhoto && (
          <p className="text-xs text-red-500">
            {formatMsg(g.multiCharacterNeedsPhoto, { name: castMemberMissingPhoto.name })}
          </p>
        )}
        {(videoModelPicker || videoDurationPicker) && (
          <div className="flex items-center gap-2">
            {videoModelPicker}
            {videoDurationPicker}
          </div>
        )}
      </div>

      <div className="min-h-[280px] space-y-7 p-6">
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
              item.kind === "single" ? (
                <SingleTurnBubble key={item.id} turn={item} domId={`take-${item.id}`} onGenerateAnyway={generateAnyway} />
              ) : (
                <MultiAngleTurnBubble key={item.groupId} item={item} domId={`take-${item.groupId}`} />
              ),
            )}

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
                        {liveProgress ?? g.runningPipeline}
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
                            />
                            <div className="mt-3 flex items-center gap-2">
                              <Badge tone={liveIsLive ? "success" : "neutral"}>
                                {liveIsLive ? g.live : g.simulated}
                              </Badge>
                              <p className="font-numeral text-xs tabular-nums text-atelier-accent">
                                {formatMsg(g.passedOnAttempt, { n: liveResult.attempts })}
                              </p>
                            </div>
                            {/* Same submitted-type fix as ResultMedia above —
                                promotability belongs to what the request
                                produced, not the toggle's current position. */}
                            <ResultActions generationId={liveResult.id} copyText={liveResult.finalPrompt || livePrompt || ""} promotable={liveContentType === "image"} />
                          </>
                        ) : (
                          <div className="mt-3 flex items-center gap-2">
                            <Badge tone="danger">{g.couldntValidate}</Badge>
                            <p className="text-xs text-atelier-muted">
                              {liveResult.reason ??
                                (liveResult.attempts === 1 ? g.noPassingResultOne : formatMsg(g.noPassingResultOther, { n: liveResult.attempts }))}
                            </p>
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
        {voiceSessionCard}
        <div ref={bottomRef} />
      </div>
      </>
      )}

      {isHero && voiceSessionCard && (
        <div className="mx-auto w-full max-w-5xl">{voiceSessionCard}</div>
      )}

      {/* max-w-5xl, matching the app layout's own container.

          These used to be max-w-2xl, which meant the composer jumped from
          672px to 1024px the moment it docked — the hero wrapper fell away and
          the layout's width took over. Submitting a prompt is the worst moment
          for the thing you just typed into to change size. */}
      <div className={cn("relative z-10", isHero ? "mx-auto w-full max-w-5xl" : "sticky bottom-4")}>
        {/* Sits directly on top of the form with no gap, sharing its
            rounded-[22px] outer frame (see UsageBanner's own comment) —
            not a floating card of its own, which is what made two earlier
            passes at this look wrong. */}
        {/* The affordability warning takes precedence over the usage strip:
            "you can't run this" is more urgent than "you're getting low", and
            two stacked banners on top of the composer is one too many.
            Deliberately NOT gated on approachingLimit — someone with plenty of
            allowance can still be short for a 51-credit 30s clip. */}
        {!isHero && cannotAfford && selectedVideoModel ? (
          <InsufficientCreditsBanner
            // Remounts when the model or duration changes, so dismissing the
            // strip suspends it for THAT selection rather than silencing a
            // different, larger shortfall the person hasn't seen yet.
            key={`${selectedVideoModel.id}-${videoDurationSeconds}`}
            needed={selectedCreditCost}
            available={creditsAvailable}
            allowExternalPurchase={allowExternalPurchase}
            modelName={selectedVideoModel.name}
            seconds={videoDurationSeconds}
          />
        ) : approachingLimit && !isHero ? (
          <UsageBanner used={creditsUsed} limit={creditsLimit} currentPeriodEnd={currentPeriodEnd} g={g} />
        ) : null}

      <form
        ref={composerFormRef}
        onSubmit={handleSubmit}
        className={cn(
          // Borderless everywhere (operator, 2026-08-21 — GPT-style): the
          // hero frame gets its edge from the shadow ring layer below; the
          // docked form's old border-t divider is gone too — the input
          // chip's own fill is the separation now.
          "relative z-10 p-4",
          isHero
            ? "isolate transform-gpu rounded-[28px] bg-atelier-surface/80 backdrop-blur-xl"
            : "rounded-b-[22px] bg-atelier-surface",
        )}
      >
        {/* Lives inside the form (not the outer wrapper) specifically so its
            absolute "rise from behind" positioning is always anchored to
            the form's own top edge, regardless of whether UsageBanner is
            also rendered above it pushing the form down. */}
        {error && <ComposerToast key={error} message={error} onDone={() => setError("")} />}
        {isHero && (
          // Decorative shadow layer, separate from the form itself: the
          // Safari shadow-corner mask fix (see the docked container above)
          // would also clip the "+" dropdown, which is a child of this form
          // and needs to render outside its bounds when open.
          <div
            aria-hidden
            className="pointer-events-none absolute inset-0 -z-10 rounded-[28px] shadow-[0_0_0_1px_var(--frost-ring),0_2px_6px_rgba(0,0,0,0.04),0_24px_56px_-20px_rgba(0,0,0,0.22)] [-webkit-mask-image:-webkit-radial-gradient(white,black)]"
          />
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
        {/* The Seedance 2.5 photoreal fence, surfaced BEFORE money moves:
            2.5 is the illustrated lane and ByteDance hard-rejects photoreal
            people (verified live 2026-08-21) — but nothing used to stop a
            photo-referenced character from being sent there (2026-08-24
            incident: 103 credits across three attempts). Warn, and offer
            the one-tap fix. Not a hard block: illustrated characters with
            reference images are legitimate on 2.5. */}
        {contentType === "video" &&
          videoModelId === "seedance" &&
          (() => {
            const warnCharacter = characters.find((c) => c.id === characterId);
            if (!warnCharacter || warnCharacter.referencePhotos.length === 0) return null;
            return (
              <div className="mb-2.5 flex flex-wrap items-center gap-2 rounded-[12px] bg-amber-500/10 px-3 py-2 text-[11.5px] leading-snug text-amber-800 dark:text-amber-300">
                <span className="min-w-0 flex-1">{formatMsg(g.seedance25Warn, { name: warnCharacter.name })}</span>
                <button
                  type="button"
                  onClick={() => setVideoModelId("seedance-2")}
                  className="flex-shrink-0 rounded-full bg-atelier-ink px-2.5 py-1 text-[11px] font-semibold text-atelier-paper transition-opacity hover:opacity-90"
                >
                  {g.seedance25Switch}
                </button>
              </div>
            );
          })()}
        <div data-tour-id="tour-prompt" className="rounded-[14px] bg-atelier-ink/[0.045] transition-colors focus-within:bg-atelier-ink/[0.07]">
          {pendingMultiAngle ? (
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
                  onClick={confirmMultiAngle}
                  disabled={selectedAngles.length === 0}
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
                        placeholder={g.storyboardShotPlaceholder}
                        disabled={submitting}
                        maxLength={1200}
                        className="min-w-0 flex-1 rounded-control border border-atelier-rule bg-transparent px-2.5 py-1.5 text-sm text-atelier-ink outline-none placeholder:text-atelier-muted/60 focus:border-atelier-muted disabled:opacity-60"
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
                      {formatMsg(g.storyboardCost, { seconds: storyboardTotalSeconds, credits: storyboardCredits })}
                    </span>
                  </div>
                </div>
              ) : (
              <>
              {/* rows={2} is the resting height (one line was too cramped to
                  read a prompt back before sending); the auto-grow effect on
                  `prompt` takes over from there, up to the max-h-36 cap
                  (six lines) with internal scrolling beyond. Enter still
                  sends and Shift+Enter still breaks the line — unchanged. */}
              <textarea
                ref={promptTextareaRef}
                id="prompt"
                rows={2}
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    e.currentTarget.form?.requestSubmit();
                  }
                }}
                placeholder={contentType === "video" ? g.videoPlaceholder : g.imagePlaceholder}
                disabled={submitting}
                maxLength={2000}
                className="max-h-36 w-full resize-none border-none bg-transparent px-3.5 py-3 text-sm text-atelier-ink outline-none placeholder:text-atelier-muted/70 disabled:opacity-60"
              />
              </>
              )}

              {contentType === "video" && currentCharacter?.voiceId && (
                <div className="border-t border-atelier-rule/70 px-3.5 py-2.5">
                  <input
                    value={dialogueText}
                    onChange={(e) => setDialogueText(e.target.value)}
                    disabled={submitting}
                    maxLength={500}
                    placeholder={formatMsg(g.dialoguePlaceholder, { name: currentCharacter.name })}
                    className="w-full border-none bg-transparent text-sm text-atelier-ink/80 outline-none placeholder:text-atelier-muted/70 disabled:opacity-60"
                  />
                  {/* Only once there's actually dialogue to charge for —
                      showing a surcharge against an empty field would read
                      as a warning about something they haven't done. */}
                  {dialogueText.trim().length > 0 && (
                    <p className="mt-1 font-numeral text-[11px] tabular-nums text-atelier-accent">
                      {formatMsg(g.dialogueCreditNote, {
                        n: Math.max(1, Math.ceil(videoDurationSeconds / 5)),
                      })}
                    </p>
                  )}
                </div>
              )}

              {advancedPanelOpen && advancedVideoEligible && (
                <div className="space-y-3 border-t border-atelier-rule/70 px-3 py-3">
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
                          {advancedPhotoOptions.map((p) => (
                            <button
                              key={p.key}
                              type="button"
                              onClick={() => toggleStoryboardPhoto(p.value, "start")}
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
                          {advancedPhotoOptions.map((p) => (
                            <button
                              key={p.key}
                              type="button"
                              onClick={() => toggleStoryboardPhoto(p.value, "end")}
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
                        {advancedPhotoOptions.map((p) => {
                          const checked = multiRefPaths.includes(p.value);
                          return (
                            <button
                              key={p.key}
                              type="button"
                              onClick={() => toggleMultiRefPhoto(p.value)}
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
                    <p className="text-xs leading-relaxed text-red-600">{enhanceError}</p>
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

              <div className="flex min-w-0 items-center justify-between gap-2 px-2.5 pb-3">
                <div ref={plusMenuRef} className="relative flex flex-shrink-0 items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setPlusMenuOpen((v) => !v)}
                    disabled={submitting}
                    title={plusMenuOpen ? g.cancel : g.attachTitle}
                    aria-label={plusMenuOpen ? g.cancel : g.attachTitle}
                    aria-haspopup="menu"
                    aria-expanded={plusMenuOpen}
                    className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full text-atelier-muted transition-colors hover:bg-atelier-ink/5 hover:text-atelier-ink disabled:opacity-50"
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
                    </div>
                  )}
                </div>

                <div className="flex min-w-0 items-center gap-1.5">
                  {/* Real incident, 2026-08-09: this whole icon strip (up to
                      7 buttons once video + advancedOpen reveal the extra
                      pair) had no way to shrink or wrap, so on a phone-width
                      screen it simply overflowed the composer card — the
                      rightmost button (Send) got pushed out past the visible
                      edge instead of staying reachable. Everything except
                      Send/Stop now lives in its own min-w-0 + overflow-x-auto
                      strip, same pattern as the admin nav's mobile fix, so it
                      scrolls internally instead of pushing Send off-screen —
                      Send/Stop stays outside it, always visible. */}
                  <div className="flex min-w-0 items-center gap-1.5 overflow-x-auto overscroll-x-contain">
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
                      className="flex flex-shrink-0 items-center gap-1.5 rounded-full border border-atelier-accent/40 px-3 py-1.5 text-xs font-semibold text-atelier-accent transition-colors hover:bg-atelier-accent/10 disabled:opacity-50"
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
                  {contentType === "video" && (
                    <>
                      <div
                        className={cn(
                          // flex-shrink-0 matters here specifically because
                          // this div has overflow-hidden (needed for the
                          // width-clip animation) — per the flexbox spec, an
                          // overflow:hidden flex item's automatic minimum
                          // size is 0, not its content size. Inside the new
                          // overflow-x-auto strip above, that made this one
                          // element (uniquely, of everything in the row) a
                          // candidate to get squeezed toward 0 width under
                          // space pressure instead of just scrolling into
                          // view — which is what made the two icons collapse
                          // to a sliver behind the neighboring chip when
                          // expanded, real incident 2026-08-09.
                          "flex-shrink-0 overflow-hidden transition-all duration-300 ease-out",
                          advancedOpen ? "max-w-[144px] opacity-100" : "max-w-0 opacity-0",
                        )}
                      >
                        <div className="flex items-center gap-1.5 pr-1">
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
                              "flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full transition-colors disabled:opacity-50",
                              multiAngleLocked
                                ? "text-atelier-muted/40 hover:bg-atelier-ink/5 hover:text-atelier-muted/70"
                                : multiAngleMode
                                  ? "bg-atelier-ink text-atelier-paper"
                                  : "text-atelier-muted hover:bg-atelier-ink/5 hover:text-atelier-ink",
                            )}
                          >
                            <AnglesIcon className="h-4 w-4" />
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
                              "flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full transition-colors disabled:opacity-50",
                              advancedVideoLockedReason !== null
                                ? "text-atelier-muted/40 hover:bg-atelier-ink/5 hover:text-atelier-muted/70"
                                : videoAdvancedMode !== "none"
                                  ? "bg-atelier-ink text-atelier-paper"
                                  : "text-atelier-muted hover:bg-atelier-ink/5 hover:text-atelier-ink",
                            )}
                          >
                            <StackIcon className="h-4 w-4" />
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
                                "flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full transition-colors disabled:opacity-50",
                                advancedVideoLockedReason === "plan"
                                  ? "text-atelier-muted/40 hover:bg-atelier-ink/5 hover:text-atelier-muted/70"
                                  : storyboardActive
                                    ? "bg-atelier-ink text-atelier-paper"
                                    : "text-atelier-muted hover:bg-atelier-ink/5 hover:text-atelier-ink",
                              )}
                            >
                              <FilmIcon className="h-4 w-4" />
                            </button>
                          )}
                        </div>
                      </div>

                      <button
                        type="button"
                        data-tour-id="tour-advanced-toggle"
                        onClick={() => setAdvancedOpen((v) => !v)}
                        title={advancedOpen ? g.advancedOptionsHide : g.advancedOptionsShow}
                        aria-label={advancedOpen ? g.advancedOptionsHide : g.advancedOptionsShow}
                        aria-expanded={advancedOpen}
                        className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full text-atelier-muted transition-colors hover:bg-atelier-ink/5 hover:text-atelier-ink"
                      >
                        <ChevronLeftIcon
                          className={cn("h-4 w-4 transition-transform duration-300", advancedOpen && "rotate-180")}
                        />
                      </button>
                    </>
                  )}

                  {contentType === "video" && (
                    <div className="flex flex-shrink-0 items-center gap-0.5 rounded-full border border-atelier-rule p-1">
                      <button
                        type="button"
                        onClick={() => setVideoAspectRatio((prev) => (prev === "16:9" ? null : "16:9"))}
                        disabled={submitting}
                        title={g.aspectWideTitle}
                        aria-label={g.aspectWideTitle}
                        aria-pressed={videoAspectRatio === "16:9"}
                        className={cn(
                          "flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full transition-colors disabled:opacity-50",
                          videoAspectRatio === "16:9"
                            ? "bg-atelier-ink text-atelier-paper"
                            : "text-atelier-muted/80 hover:bg-atelier-ink/5 hover:text-atelier-ink",
                        )}
                      >
                        <LandscapeIcon className="h-4 w-4" />
                      </button>
                      <button
                        type="button"
                        onClick={() => setVideoAspectRatio((prev) => (prev === "9:16" ? null : "9:16"))}
                        disabled={submitting}
                        title={g.aspectTallTitle}
                        aria-label={g.aspectTallTitle}
                        aria-pressed={videoAspectRatio === "9:16"}
                        className={cn(
                          "flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full transition-colors disabled:opacity-50",
                          videoAspectRatio === "9:16"
                            ? "bg-atelier-ink text-atelier-paper"
                            : "text-atelier-muted/80 hover:bg-atelier-ink/5 hover:text-atelier-ink",
                        )}
                      >
                        <PortraitIcon className="h-4 w-4" />
                      </button>
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
                  {voiceModeEnabled && !nativeClient && (
                  <button
                    type="button"
                    onClick={voiceSessionActive ? stopVoiceSession : startVoiceSession}
                    disabled={submitting}
                    title={voiceSessionActive ? g.voiceOnTitle : g.voiceOffTitle}
                    aria-label={voiceSessionActive ? g.voiceOnTitle : g.voiceOffTitle}
                    aria-pressed={voiceSessionActive}
                    className={cn(
                      "flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full transition-colors disabled:opacity-50",
                      voiceSessionActive
                        ? "bg-atelier-ink text-atelier-paper"
                        : "text-atelier-muted hover:bg-atelier-ink/5 hover:text-atelier-ink",
                    )}
                  >
                    <VoiceIcon className="h-4 w-4" />
                  </button>
                  )}

                  {!nativeClient && (
                    <VoiceRecorderButton onTranscript={handleVoiceTranscript} disabled={submitting} size="md" />
                  )}
                  </div>

                  {submitting ? (
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
                  ) : (
                    <button
                      type="submit"
                      disabled={
                        isUploading ||
                        (storyboardActive
                          ? !storyboardReady
                          : !prompt.trim() && pendingAttachments.length === 0)
                      }
                      title={g.send}
                      aria-label={g.send}
                      className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full bg-atelier-ink text-atelier-paper transition-colors hover:bg-atelier-ink/90 disabled:opacity-30"
                    >
                      <SendIcon className="h-4 w-4" />
                    </button>
                  )}
                </div>
              </div>
              {/* Guardrail footer (2026-08-21 incident): what a send spends,
                  and the two first-session nudges. Renders nothing for
                  established paid accounts. */}
              {(dailyFreeAvailable ||
                (!characterId && characters.length > 0) ||
                (!hasGeneratedBefore && contentType === "image")) &&
                !submitting && (
                  <div className="space-y-1 px-4 pb-2.5">
                    {dailyFreeAvailable && (
                      <p className="flex items-center justify-end gap-1.5 text-[11px] text-atelier-muted">
                        <span className="h-1.5 w-1.5 flex-shrink-0 rounded-full bg-atelier-accent" />
                        {g.dailyFreeNotice} ·{" "}
                        {contentType === "video"
                          ? `${videoDurationSeconds}s ${g.video.toLowerCase()}`
                          : g.image.toLowerCase()}
                      </p>
                    )}
                    {!characterId && characters.length > 0 && (
                      <p className="text-[11px] text-atelier-muted">{g.pickCharacterHint}</p>
                    )}
                    {!hasGeneratedBefore && contentType === "image" && (
                      <p className="text-[11px] text-atelier-muted">{g.imageFirstHint}</p>
                    )}
                  </div>
                )}
            </>
          )}
        </div>

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
        {/* A plain <div>, not <p> — FeedbackLink's popover renders its own
            <p> tags, and a <p> can't legally contain another <p> (or
            anything else that's block-level). Browsers silently auto-close
            the outer <p> the moment they hit one, which desyncs the DOM
            from what React rendered and throws a hydration error. Visually
            identical either way — this line never relied on <p>-specific
            behavior. */}
        <div
          className={cn(
            "text-xs text-atelier-muted/80",
            // mt-1 whenever any status line renders above (multi-angle
            // review, upload progress, or the safe-to-close note), mt-3
            // when this sits alone under the composer.
            pendingMultiAngle || isUploading || liveProgress !== null ? "mt-1" : "mt-3",
          )}
        >
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
      </form>
      </div>
    </div>
    {/* The Takes rail — this session's finished turns as a filmstrip, fed
        straight from the `items`/live state above. Rendered in the tree even
        in hero mode's brief docked-transition frames is harmless: it hides
        itself below xl, and takesRailEnabled already excludes the dashboard
        embed entirely. The in-flight placeholder clears once the result is
        being revealed in the thread (liveResult), not when it's archived —
        so the rail never says "Rendering…" next to an already-visible
        result. */}
    {takesRailEnabled && (
      <TakesRail
        items={items}
        inFlightPrompt={
          liveMultiAngle ? liveMultiAngle.prompt : liveResult === null ? livePrompt : null
        }
      />
    )}
    </div>
    </>
  );
}
