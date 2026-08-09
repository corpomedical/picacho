"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/field";
import {
  runGeneration,
  runMultiAngleGeneration,
  requestGenerationCancel,
  requestMultiAngleGenerationCancel,
  getGenerationThread,
  type HistoryTurn,
  type ChatHistoryItem,
} from "@/lib/generations/actions";
import { synthesizeVoice } from "@/lib/voice/actions";
import { toUserFacingError } from "@/lib/generations/user-facing-error";
import { uploadChatAttachment, deleteChatAttachment, type ChatAttachment } from "@/lib/attachments/actions";
import { setHasCompletedOnboarding } from "@/lib/profile/actions";
import { VoiceRecorderButton } from "@/components/voice-recorder-button";
import { DownloadButton } from "@/components/download-button";
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

const VOICE_MODE_STORAGE_KEY = "picacho_voice_mode";

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
function summarizeFailure(attempts: AttemptLog[], stoppedLabel?: string): string | null {
  const last = attempts[attempts.length - 1];
  if (!last) return null;

  // A user-initiated stop, not a real failure — say so plainly instead of
  // running it through the provider-error/missing-traits messaging below,
  // which would either show nothing useful (no error step exists) or, worse,
  // surface a stale reason left over from an earlier attempt.
  if (last.issues.includes("cancelled")) return stoppedLabel ?? "Stopped.";

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
    return `The result was missing: ${traitIssues.join(", ")}.`;
  }

  return null;
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

function notifyIfHidden(title: string, body: string) {
  if (typeof window === "undefined" || !("Notification" in window)) return;
  if (Notification.permission !== "granted") return;
  if (document.visibilityState !== "hidden") return;
  new Notification(title, { body });
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
                isCurrent ? "animate-pulse bg-neutral-900" : "bg-neutral-300",
              )}
            />
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <span className="inline-flex items-center rounded-full bg-neutral-100 px-2 py-0.5 text-[11px] font-medium text-neutral-600">
                  {stepLabel(item.step.step, isLive, g)}
                </span>
                {timeline.some((entry) => entry.kind === "step" && entry.attempt > 1) && (
                  <span className="text-[11px] text-neutral-400">
                    {formatMsg(g.attemptSuffix, { n: item.attempt })}
                  </span>
                )}
              </div>
              <p className="mt-1 whitespace-pre-wrap text-sm text-neutral-700">
                {item.step.detail}
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

  if (resultUrl && resultUrl.startsWith("http")) {
    return contentType === "video" ? (
      <div className="relative mt-4">
        <video
          src={resultUrl}
          controls
          aria-label={prompt}
          className="aspect-video w-full rounded-[16px] bg-neutral-950"
        />
        <DownloadButton url={resultUrl} contentType={contentType} />
      </div>
    ) : (
      <div className="relative mt-4">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={resultUrl}
          alt={prompt || t.generate.resultAlt}
          className="w-full rounded-[16px] bg-neutral-100 object-cover"
        />
        <DownloadButton url={resultUrl} contentType={contentType} />
      </div>
    );
  }

  const typeLabel = (contentType === "video" ? t.generate.video : t.generate.image).toLowerCase();

  return (
    <div className="mt-4 flex aspect-video items-center justify-center rounded-[16px] bg-neutral-100 text-center">
      <p className="max-w-xs px-4 text-xs text-neutral-500">
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
    <div className={cn("flex items-center justify-center bg-neutral-100 text-neutral-400", className)}>
      <FileIcon className="h-5 w-5" />
    </div>
  );
}

function UserBubble({ prompt, attachments }: { prompt: string; attachments?: ChatAttachment[] }) {
  return (
    <div className="flex justify-end">
      <div className="max-w-[85%] space-y-2">
        {attachments && attachments.length > 0 && (
          <div className="flex flex-wrap justify-end gap-1.5">
            {attachments.map((att) => (
              <a
                key={att.path}
                href={att.url}
                target="_blank"
                rel="noreferrer"
                title={att.name}
                className="block h-16 w-16 flex-shrink-0 overflow-hidden rounded-[12px] border border-neutral-200"
              >
                <AttachmentThumb attachment={att} className="h-full w-full" />
              </a>
            ))}
          </div>
        )}
        {prompt && (
          <div className="rounded-[18px] rounded-br-[6px] bg-neutral-900 px-4.5 py-3 text-sm leading-relaxed text-white">
            {prompt}
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
          "pointer-events-auto max-w-[92%] rounded-full bg-neutral-900 px-4 py-2.5 text-center text-sm text-white shadow-[0_12px_28px_-10px_rgba(0,0,0,0.45)] transition-all duration-300 ease-out",
          entered ? "-translate-y-[130%] opacity-100" : "translate-y-0 opacity-0",
        )}
      >
        {message}
      </div>
    </div>
  );
}

function PendingAttachmentChip({ attachment, onRemove }: { attachment: PendingAttachment; onRemove: () => void }) {
  const { t } = useLocale();
  const isImage = attachment.type.startsWith("image/");
  const isVideo = attachment.type.startsWith("video/");

  return (
    <div className="group relative h-16 w-16 flex-shrink-0 overflow-hidden rounded-[12px] border border-neutral-200 bg-neutral-50">
      {isImage && attachment.url ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={attachment.url} alt={attachment.name} className="h-full w-full object-cover" />
      ) : isVideo && attachment.url ? (
        <video src={attachment.url} className="h-full w-full object-cover" muted />
      ) : (
        <div className="flex h-full w-full flex-col items-center justify-center gap-1 px-1 text-neutral-400">
          <FileIcon className="h-4 w-4" />
          <span className="w-full truncate text-center text-[9px] leading-tight">{attachment.name}</span>
          <span className="text-[8px] text-neutral-300">{formatBytes(attachment.size)}</span>
        </div>
      )}

      {attachment.status === "uploading" && (
        <div className="absolute inset-0 flex items-center justify-center bg-white/70">
          <LoaderIcon className="h-4 w-4 text-neutral-500" />
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
        className="absolute right-0.5 top-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-neutral-950/70 text-white opacity-0 transition-opacity group-hover:opacity-100"
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
  elitePlanActive: boolean;
  approachingLimit: boolean;
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
}) {
  return (
    <Suspense fallback={null}>
      <GenerateFormInner {...props} />
    </Suspense>
  );
}

type ChatTurn = HistoryTurn & { attachments: ChatAttachment[] };

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

function SingleTurnBubble({ turn }: { turn: ChatTurn }) {
  const { t } = useLocale();
  const g = t.generate;
  const live = isLiveTurn(turn.attempts);
  const timeline = buildTimeline(turn.attempts);
  return (
    <div className="space-y-3">
      <UserBubble prompt={turn.prompt} attachments={turn.attachments} />
      <div className="flex justify-start">
        <div className="group max-w-[90%] rounded-[18px] rounded-bl-[6px] border border-neutral-100 bg-neutral-50 px-4.5 py-4">
          <PipelineTrace timeline={timeline} revealedCount={timeline.length} isAnimating={false} isLive={live} />
          {turn.succeeded ? (
            <>
              <ResultMedia succeeded={turn.succeeded} resultUrl={turn.resultUrl} contentType={turn.contentType} prompt={turn.prompt} />
              <div className="mt-3 flex items-center gap-2">
                <Badge tone={live ? "success" : "neutral"}>{live ? g.live : g.simulated}</Badge>
                <p className="text-xs text-neutral-500">{formatMsg(g.passedOnAttempt, { n: turn.attempts.length })}</p>
              </div>
              <ResultActions generationId={turn.id} copyText={turn.finalPrompt || turn.prompt} />
            </>
          ) : (
            <div className="mt-3 flex items-center gap-2">
              <Badge tone="danger">{g.couldntValidate}</Badge>
              <p className="text-xs text-neutral-500">
                {summarizeFailure(turn.attempts, g.stoppedByUser) ??
                  (turn.attempts.length === 1 ? g.noPassingResultOne : formatMsg(g.noPassingResultOther, { n: turn.attempts.length }))}
              </p>
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
                "rounded-full border px-3 py-1 text-xs font-medium transition-colors",
                isActive
                  ? "border-neutral-900 bg-neutral-900 text-white"
                  : "border-neutral-200 text-neutral-500 hover:border-neutral-300 hover:text-neutral-900",
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
                <p className="text-xs text-neutral-500">{formatMsg(g.passedOnAttempt, { n: active.attempts.length })}</p>
              </div>
              <ResultActions key={active.id} generationId={active.id} copyText={active.finalPrompt || prompt || ""} />
            </>
          ) : (
            <div className="mt-3 flex items-center gap-2">
              <Badge tone="danger">{g.couldntValidate}</Badge>
              <p className="text-xs text-neutral-500">
                {summarizeFailure(active.attempts, g.stoppedByUser) ??
                  (active.attempts.length === 1 ? g.noPassingResultOne : formatMsg(g.noPassingResultOther, { n: active.attempts.length }))}
              </p>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function MultiAngleTurnBubble({ item }: { item: MultiAngleChatItem }) {
  return (
    <div className="space-y-3">
      <UserBubble prompt={item.prompt} attachments={item.attachments} />
      <div className="flex justify-start">
        <div className="group max-w-[90%] rounded-[18px] rounded-bl-[6px] border border-neutral-100 bg-neutral-50 px-4.5 py-4">
          <MultiAngleResult angles={item.angles} prompt={item.prompt} />
        </div>
      </div>
    </div>
  );
}

function GenerateFormInner({
  characters,
  videoModels,
  defaultVideoModelId,
  elitePlanActive,
  approachingLimit,
  heroMode = false,
  greeting,
  startOnboarding = false,
}: {
  characters: CharacterOption[];
  videoModels: VideoModelOption[];
  defaultVideoModelId: string;
  elitePlanActive: boolean;
  approachingLimit: boolean;
  heroMode?: boolean;
  greeting?: string;
  startOnboarding?: boolean;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { t } = useLocale();
  const g = t.generate;

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
  const [contentType, setContentType] = useState<ContentType>(() =>
    searchParams.get("type") === "image" ? "image" : "video",
  );
  const [prompt, setPrompt] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [stopping, setStopping] = useState(false);
  // Which request is currently live and what to cancel it by — a client-
  // generated id/groupId, set the instant a request goes out (see
  // submitPrompt/confirmMultiAngle), not whatever the server eventually
  // returns, since by then it's too late for Stop to do anything useful. A
  // ref because it's only ever read inside an event handler, never rendered.
  const activeGenerationRef = useRef<
    { kind: "single"; id: string } | { kind: "multi"; groupId: string } | null
  >(null);
  const [error, setError] = useState("");
  const [voiceMode, setVoiceMode] = useState(false);
  const [pendingAttachments, setPendingAttachments] = useState<PendingAttachment[]>([]);

  const [items, setItems] = useState<ChatItem[]>([]);

  const [livePrompt, setLivePrompt] = useState<string | null>(null);
  const [liveAttachments, setLiveAttachments] = useState<ChatAttachment[]>([]);
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

  // Hero mode (dashboard home only — see the heroMode prop): starts as just
  // a greeting and a plain composer, no toolbar/character-picker/card
  // chrome. Typing and hitting send does NOT dock it — that would expand
  // the composer before the person actually asked for anything, which felt
  // premature. It docks for one of two real reasons instead: a message
  // actually gets sent (hasAnyMessages), or the person explicitly picks
  // Create image/video from the + menu (creationModeActive).
  const hasAnyMessages = items.length > 0 || livePrompt !== null || liveMultiAngle !== null;
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
  const [videoModelId, setVideoModelId] = useState(defaultVideoModelId);
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
  const isAnimating = revealedCount > 0 && revealedCount < liveTimeline.length;
  const isUploading = pendingAttachments.some((a) => a.status === "uploading");
  const locked = submitting || pendingMultiAngle !== null;

  const currentCharacter = characters.find((c) => c.id === characterId);
  const referencePhotos = currentCharacter?.referencePhotos ?? [];

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
  // depend on a character being picked yet, so the option stays visible
  // (with a "pick a character first" hint inside) instead of quietly
  // vanishing now that no character is auto-selected on load.
  const advancedVideoEligible = contentType === "video" && videoModelId === "kling" && elitePlanActive;
  const canUseAdvancedVideo = advancedVideoEligible && referencePhotos.length > 0;

  useEffect(() => {
    const saved = window.localStorage.getItem(VOICE_MODE_STORAGE_KEY);
    if (saved === "1") setVoiceMode(true);
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

  function toggleVoiceMode() {
    setVoiceMode((prev) => {
      const next = !prev;
      window.localStorage.setItem(VOICE_MODE_STORAGE_KEY, next ? "1" : "0");
      return next;
    });
  }

  async function speak(text: string) {
    try {
      const result = await synthesizeVoice(text);
      if (result.error !== null) return; // voice is a nice-to-have — fail quietly
      const audio = new Audio(`data:audio/mpeg;base64,${result.audioBase64}`);
      await audio.play();
    } catch {
      // Autoplay can be blocked before the user has interacted with the
      // page at all — not worth surfacing an error for that.
    }
  }

  function resetChat() {
    setItems([]);
    setLivePrompt(null);
    setLiveAttachments([]);
    setLiveTimeline([]);
    setLiveResult(null);
    setRevealedCount(0);
    setError("");
    setPendingAttachments([]);
    setPendingMultiAngle(null);
    setLiveMultiAngle(null);
    setSelectedAngles(DEFAULT_ANGLE_IDS);
    clearAdvancedVideo();
    setAnchorPhotoPath(null);
  }

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

    const result = await runMultiAngleGeneration(formData);

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

    const anyAngleSucceeded = result.angles.some((a) => a.succeeded);
    notifyIfHidden(
      anyAngleSucceeded ? g.notifyReadyTitle : g.notifyFailedTitle,
      anyAngleSucceeded
        ? formatMsg(g.passedOnAttempt, { n: result.angles[0]?.attempts.length ?? 1 })
        : (summarizeFailure(result.angles[0]?.attempts ?? [], g.stoppedByUser) ?? g.noPassingResultOne),
    );

    setItems((prev) => [
      ...prev,
      {
        kind: "multi",
        groupId: result.groupId,
        prompt: mPrompt,
        attachments,
        createdAt: new Date().toISOString(),
        angles: result.angles,
      },
    ]);
    setLiveMultiAngle(null);
    setSubmitting(false);
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
          const message = `${file.name} couldn't be uploaded — it may be too large or the connection dropped.`;
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
    resetChat();
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

  useEffect(() => {
    if (searchParams.get("tour") === "1") {
      router.replace("/app", { scroll: false });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // The "AI providers" and "multi-angle/storyboard" stops point at composer
  // elements that only exist once the composer is out of hero mode with
  // video selected (see isHero above — the model picker and the advanced-
  // options arrow are both gated behind creationModeActive). This nudges the
  // composer into that state a render ahead of OnboardingTour trying to
  // measure the target, the same way clicking "Create video" from the +
  // menu would.
  useEffect(() => {
    if (!tourActive) return;
    const needsVideoMode = tourStepIndex === 2 || tourStepIndex === 3;
    if (needsVideoMode) {
      setContentType("video");
      setCreationModeActive(true);
    }
  }, [tourActive, tourStepIndex]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [items.length, revealedCount, livePrompt, liveMultiAngle]);

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
    if (active.kind === "single") {
      await requestGenerationCancel(active.id);
    } else {
      await requestMultiAngleGenerationCancel(active.groupId);
    }
  }

  async function submitPrompt(
    rawPrompt: string,
    opts?: { speak?: boolean; attachments?: ChatAttachment[] },
  ) {
    const submittedPrompt = rawPrompt.trim();
    const submittedAttachments = opts?.attachments ?? [];
    if (!submittedPrompt) {
      setError(g.describeFirst);
      return;
    }
    if (!characterId) {
      setError(g.pickCharacter);
      return;
    }
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

    const shouldSpeak = Boolean(opts?.speak || voiceMode);

    requestNotificationPermission();

    setError("");
    setSubmitting(true);
    setStopping(false);
    setLivePrompt(submittedPrompt);
    setLiveAttachments(submittedAttachments);
    setPrompt("");
    setPendingAttachments([]);
    setLiveTimeline([]);
    setLiveResult(null);
    setRevealedCount(0);

    if (shouldSpeak) speak(g.speakWorkingOnIt);

    const generationId = crypto.randomUUID();
    activeGenerationRef.current = { kind: "single", id: generationId };

    const formData = new FormData();
    formData.set("generation_id", generationId);
    formData.set("prompt", submittedPrompt);
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
    const submittedDialogue = contentType === "video" ? dialogueText.trim() : "";
    if (submittedDialogue) {
      formData.set("dialogue", submittedDialogue);
    }
    formData.set("character_id", characterId);
    if (companionCharacterIds.length > 0) {
      formData.set("companion_character_ids", JSON.stringify(companionCharacterIds));
    }
    formData.set("content_type", contentType);
    if (contentType === "video") {
      formData.set("video_model_id", videoModelId);
      formData.set("video_duration_seconds", String(videoDurationSeconds));
      if (videoAspectRatio) formData.set("video_aspect_ratio", videoAspectRatio);
    }
    setDialogueText("");

    const result = await runGeneration(formData);

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

    const items = buildTimeline(result.attempts);
    setLiveTimeline(items);
    setLiveIsLive(isLiveTurn(result.attempts));

    for (let i = 1; i <= items.length; i++) {
      await new Promise((resolve) => setTimeout(resolve, 420));
      setRevealedCount(i);
    }

    const failureReason = result.succeeded ? null : summarizeFailure(result.attempts, g.stoppedByUser);
    setLiveResult({
      id: result.id,
      succeeded: result.succeeded,
      resultUrl: result.resultUrl,
      attempts: result.attempts.length,
      reason: failureReason,
      finalPrompt: result.finalPrompt,
    });

    notifyIfHidden(
      result.succeeded ? g.notifyReadyTitle : g.notifyFailedTitle,
      result.succeeded
        ? formatMsg(g.passedOnAttempt, { n: result.attempts.length })
        : (failureReason ??
            (result.attempts.length === 1 ? g.noPassingResultOne : formatMsg(g.noPassingResultOther, { n: result.attempts.length }))),
    );

    if (shouldSpeak) {
      speak(
        result.succeeded
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
        contentType,
        attempts: result.attempts,
        succeeded: result.succeeded,
        finalPrompt: result.finalPrompt,
        resultUrl: result.resultUrl,
        createdAt: new Date().toISOString(),
        attachments: submittedAttachments,
      },
    ]);
    setLivePrompt(null);
    setLiveAttachments([]);
    setLiveTimeline([]);
    setLiveResult(null);
    setRevealedCount(0);
    setSubmitting(false);
  }

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

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();

    const readyAttachments = pendingAttachments
      .filter((a): a is PendingAttachment & { status: "ready"; url: string; path: string } => a.status === "ready" && Boolean(a.url) && Boolean(a.path))
      .map((a) => ({ path: a.path, url: a.url, name: a.name, type: a.type, size: a.size }));

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

    await submitPrompt(prompt, { attachments: readyAttachments });
  }

  function handleVoiceTranscript(text: string) {
    if (voiceMode) {
      submitPrompt(text, { speak: true });
    } else {
      setPrompt((prev) => (prev ? `${prev} ${text}` : text));
    }
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
      <div ref={characterMenuRef} className="relative">
        <button
          type="button"
          onClick={() => setCharacterMenuOpen((v) => !v)}
          disabled={locked}
          aria-haspopup="listbox"
          aria-expanded={characterMenuOpen}
          className={cn(
            "flex w-full items-center gap-2.5 rounded-full border bg-neutral-50 py-1.5 pl-1.5 pr-3.5 text-left transition-colors disabled:opacity-50",
            characterMenuOpen ? "border-neutral-300" : "border-neutral-100 hover:border-neutral-200",
          )}
        >
          {isMultiCharacter ? (
            <span className="flex flex-shrink-0 -space-x-2">
              {[currentCharacter, ...companionCharacters].filter(Boolean).slice(0, 3).map((c, i) => (
                <span
                  key={c!.id}
                  className="flex h-7 w-7 items-center justify-center rounded-full border-2 border-white bg-neutral-100 text-xs font-medium text-neutral-600"
                  style={{ zIndex: 3 - i }}
                >
                  {c!.name?.[0]?.toUpperCase() ?? "?"}
                </span>
              ))}
            </span>
          ) : (
            <span className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full bg-neutral-100 text-xs font-medium text-neutral-600">
              {currentCharacter?.name?.[0]?.toUpperCase() ?? "?"}
            </span>
          )}
          <span
            className={cn(
              "min-w-0 flex-1 truncate text-sm",
              currentCharacter ? "text-neutral-900" : "text-neutral-500",
            )}
          >
            {isMultiCharacter
              ? formatMsg(g.multiCharacterSummary, { name: currentCharacter?.name ?? "", n: companionCharacterIds.length })
              : (currentCharacter?.name ?? g.selectCharacter)}
          </span>
          <ChevronDownIcon
            className={cn(
              "h-3.5 w-3.5 flex-shrink-0 text-neutral-400 transition-transform",
              characterMenuOpen && "rotate-180",
            )}
          />
        </button>

        {characterMenuOpen && (
          <div
            role="listbox"
            aria-multiselectable="true"
            className="absolute left-0 top-full z-20 mt-1.5 max-h-72 w-full min-w-[240px] overflow-y-auto rounded-[16px] border border-neutral-200 bg-white p-1.5 shadow-[0_16px_40px_-12px_rgba(0,0,0,0.18)]"
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
                    "flex w-full items-center gap-2.5 rounded-[10px] px-2.5 py-2 text-left text-sm transition-colors disabled:cursor-not-allowed disabled:opacity-40",
                    selected ? "bg-neutral-100 text-neutral-900" : "text-neutral-600 hover:bg-neutral-50",
                  )}
                >
                  <span
                    className={cn(
                      "flex h-4 w-4 flex-shrink-0 items-center justify-center rounded-[5px] border transition-colors",
                      selected ? "border-neutral-900 bg-neutral-900" : "border-neutral-300 bg-white",
                    )}
                  >
                    {selected && <CheckIcon className="h-2.5 w-2.5 text-white" />}
                  </span>
                  <span className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full bg-neutral-100 text-[11px] font-medium text-neutral-600">
                    {c.name?.[0]?.toUpperCase() ?? "?"}
                  </span>
                  <span className="min-w-0 flex-1 truncate">{c.name}</span>
                  {c.id === characterId && <span className="text-[10px] text-neutral-400">{g.primaryCharacter}</span>}
                </button>
              );
            })}
            <div className="mt-1 border-t border-neutral-100 px-2.5 pt-2 text-[11px] leading-snug text-neutral-400">
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
            "flex w-full items-center gap-2 rounded-full border bg-neutral-50 py-1.5 pl-3 pr-3.5 text-left transition-colors disabled:opacity-50",
            videoModelMenuOpen ? "border-neutral-300" : "border-neutral-100 hover:border-neutral-200",
          )}
        >
          <span className="min-w-0 flex-1 truncate text-sm text-neutral-900">{currentVideoModel?.name}</span>
          {currentDurationCredits > 1 && (
            <span className="flex-shrink-0 rounded-full bg-neutral-200 px-2 py-0.5 text-[11px] font-medium text-neutral-600">
              {formatMsg(g.creditsEach, { n: currentDurationCredits })}
            </span>
          )}
          <ChevronDownIcon
            className={cn(
              "h-3.5 w-3.5 flex-shrink-0 text-neutral-400 transition-transform",
              videoModelMenuOpen && "rotate-180",
            )}
          />
        </button>

        {videoModelMenuOpen && (
          <div
            role="listbox"
            className="absolute left-0 top-full z-20 mt-1.5 w-full min-w-[260px] overflow-y-auto rounded-[16px] border border-neutral-200 bg-white p-1.5 shadow-[0_16px_40px_-12px_rgba(0,0,0,0.18)]"
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
                    "flex w-full flex-col gap-0.5 rounded-[10px] px-2.5 py-2 text-left transition-colors",
                    m.id === videoModelId
                      ? "bg-neutral-100 text-neutral-900"
                      : "text-neutral-600 hover:bg-neutral-50",
                  )}
                >
                  <span className="flex items-center gap-2 text-sm">
                    <span className="min-w-0 flex-1 truncate">{m.name}</span>
                    {listCredits > 1 && (
                      <span className="flex-shrink-0 rounded-full bg-neutral-200 px-2 py-0.5 text-[11px] font-medium text-neutral-600">
                        {formatMsg(g.creditsEach, { n: listCredits })}
                      </span>
                    )}
                    {m.id === videoModelId && <CheckIcon className="h-3.5 w-3.5 flex-shrink-0 text-neutral-900" />}
                  </span>
                  <span className="text-xs text-neutral-500">{m.description}</span>
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
    contentType === "video" && currentVideoModel && currentVideoModel.durations.length > 1 ? (
      <div className="flex flex-shrink-0 items-center gap-1 rounded-full border border-neutral-100 bg-neutral-50 p-1">
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
                ? "bg-neutral-900 text-white"
                : "text-neutral-500 hover:text-neutral-900",
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
  const ob = t.onboarding;
  const TOUR_STEPS: TourStep[] = [
    { targetId: null, title: ob.welcomeTitle, body: ob.welcomeBody },
    { targetId: "tour-characters", title: ob.charactersTitle, body: ob.charactersBody },
    { targetId: "tour-video-model", title: ob.providersTitle, body: ob.providersBody },
    { targetId: "tour-advanced-toggle", title: ob.multiAngleTitle, body: ob.multiAngleBody },
    { targetId: null, title: ob.doneTitle, body: ob.doneBody },
  ];

  function finishTour() {
    setTourActive(false);
    setTourStepIndex(0);
    // Leave the composer the way it was before the tour nudged it into
    // video-creation mode, so a first-time user lands back on the plain
    // hero greeting rather than a half-filled-in composer they never chose.
    clearCreationMode();
    void setHasCompletedOnboarding();
  }

  return (
    <>
      {tourActive && (
        <OnboardingTour
          steps={TOUR_STEPS}
          stepIndex={tourStepIndex}
          onNext={() => setTourStepIndex((i) => i + 1)}
          onFinish={finishTour}
          next={ob.next}
          skip={ob.skip}
          finish={ob.finish}
        />
      )}
    <div
      className={cn(
        "relative flex flex-col transition-all duration-300 ease-out",
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
            "isolate transform-gpu rounded-[22px] border border-neutral-100 bg-white",
        justArrived && "transition-opacity duration-[220ms] ease-out",
        justArrived && !settled && "opacity-0",
      )}
    >
      {!isHero && (
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 -z-10 rounded-[22px] shadow-[0_1px_2px_rgba(0,0,0,0.04),0_20px_44px_-18px_rgba(0,0,0,0.14)] [-webkit-mask-image:-webkit-radial-gradient(white,black)]"
        />
      )}
      {isHero && <h1 className="text-2xl font-semibold text-neutral-900">{greeting}</h1>}

      {!isHero && (
      <>
      <div className="space-y-3 border-b border-neutral-100 p-5">
        {hasAnyMessages && (
          <div className="flex justify-end">
            <button
              type="button"
              onClick={resetChat}
              disabled={locked}
              className="flex-shrink-0 rounded-full border border-neutral-200 px-3.5 py-2 text-xs font-medium text-neutral-600 transition-colors hover:border-neutral-300 hover:bg-neutral-50 disabled:opacity-50"
            >
              {g.newChat}
            </button>
          </div>
        )}

        {characterPicker}
        {referencePhotos.length > 1 && videoAdvancedMode === "none" && !isMultiCharacter && (
          <div>
            <p className="text-[11px] font-medium uppercase tracking-wide text-neutral-400">
              {g.anchorPhotoLabel}
            </p>
            <p className="mt-0.5 text-[11px] leading-snug text-neutral-400">{g.anchorPhotoHint}</p>
            <div className="mt-1.5 flex gap-1.5">
              {referencePhotos.map((p, i) => {
                const selected = anchorPhotoPath ? anchorPhotoPath === p.path : i === 0;
                return (
                  <button
                    key={p.path}
                    type="button"
                    onClick={() => setAnchorPhotoPath(p.path)}
                    className={cn(
                      "relative h-12 w-12 flex-shrink-0 overflow-hidden rounded-[10px] border-2",
                      selected ? "border-neutral-900" : "border-transparent",
                    )}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={p.url} alt="" className="h-full w-full object-cover" />
                    {selected && (
                      <span className="absolute right-0.5 top-0.5 flex h-3.5 w-3.5 items-center justify-center rounded-full bg-neutral-900 text-white">
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
              <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-neutral-900 text-white">
                {contentType === "video" ? <VideoIcon className="h-5 w-5" /> : <ImageIcon className="h-5 w-5" />}
              </div>
              <div>
                <h2 className="text-lg font-semibold text-neutral-900">
                  {contentType === "video" ? g.createVideosTitle : g.createImagesTitle}
                </h2>
                <p className="mt-1 text-sm text-neutral-500">{g.createModeSubtitle}</p>
              </div>
            </div>
          ) : (
            <p className="py-10 text-center text-sm text-neutral-400">
              {g.noMessages}
            </p>
          )
        ) : (
          <>
            {items.map((item) =>
              item.kind === "single" ? (
                <SingleTurnBubble key={item.id} turn={item} />
              ) : (
                <MultiAngleTurnBubble key={item.groupId} item={item} />
              ),
            )}

            {liveMultiAngle && (
              <div className="space-y-3">
                <UserBubble prompt={liveMultiAngle.prompt} attachments={liveMultiAngle.attachments} />
                <div className="flex justify-start">
                  <div className="max-w-[90%] rounded-[18px] rounded-bl-[6px] border border-neutral-100 bg-neutral-50 px-4.5 py-4">
                    <div className="flex items-center gap-2 text-sm text-neutral-500">
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
                  <div className="group max-w-[90%] rounded-[18px] rounded-bl-[6px] border border-neutral-100 bg-neutral-50 px-4.5 py-4">
                    {liveTimeline.length === 0 && !liveResult && (
                      // The server call itself (draft + review + the actual
                      // generation) can take anywhere from several seconds to
                      // a few minutes for real video/image providers, and
                      // nothing else renders in this bubble until it resolves
                      // — without this, the bubble just sits empty and looks
                      // frozen the whole time.
                      <div className="flex items-center gap-2 text-sm text-neutral-500">
                        <LoaderIcon className="h-4 w-4" />
                        {g.runningPipeline}
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
                              contentType={contentType}
                              prompt={livePrompt ?? undefined}
                            />
                            <div className="mt-3 flex items-center gap-2">
                              <Badge tone={liveIsLive ? "success" : "neutral"}>
                                {liveIsLive ? g.live : g.simulated}
                              </Badge>
                              <p className="text-xs text-neutral-500">
                                {formatMsg(g.passedOnAttempt, { n: liveResult.attempts })}
                              </p>
                            </div>
                            <ResultActions generationId={liveResult.id} copyText={liveResult.finalPrompt || livePrompt || ""} />
                          </>
                        ) : (
                          <div className="mt-3 flex items-center gap-2">
                            <Badge tone="danger">{g.couldntValidate}</Badge>
                            <p className="text-xs text-neutral-500">
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
        <div ref={bottomRef} />
      </div>
      </>
      )}

      <div className={cn("relative z-10", isHero ? "mx-auto w-full max-w-2xl" : "sticky bottom-4")}>
        {approachingLimit && !isHero && (
          <div className="mx-4 mb-2 rounded-[14px] bg-amber-50 px-3.5 py-2.5 text-xs text-amber-800 dark:bg-amber-500/15 dark:text-amber-300">
            {g.approachingLimitMessage}{" "}
            <Link href="/app/settings?tab=usage" className="font-medium underline">
              {g.getMoreUsage}
            </Link>
          </div>
        )}

        {error && <ComposerToast key={error} message={error} onDone={() => setError("")} />}

      <form
        onSubmit={handleSubmit}
        className={cn(
          "relative z-10 bg-white p-4",
          isHero
            ? "isolate transform-gpu rounded-[28px] border border-neutral-100"
            : "rounded-b-[22px] border-t border-neutral-100",
        )}
      >
        {isHero && (
          // Decorative shadow layer, separate from the form itself: the
          // Safari shadow-corner mask fix (see the docked container above)
          // would also clip the "+" dropdown, which is a child of this form
          // and needs to render outside its bounds when open.
          <div
            aria-hidden
            className="pointer-events-none absolute inset-0 -z-10 rounded-[28px] shadow-[0_1px_2px_rgba(0,0,0,0.04)] [-webkit-mask-image:-webkit-radial-gradient(white,black)]"
          />
        )}
        <Label htmlFor="prompt" className="sr-only">
          {g.messageLabel}
        </Label>

        <div className="rounded-[24px] border border-neutral-200 bg-white transition-colors focus-within:border-neutral-400 focus-within:ring-4 focus-within:ring-neutral-900/[0.04]">
          {pendingMultiAngle ? (
            <div className="space-y-3 p-4">
              <div>
                <p className="text-xs font-medium uppercase tracking-wide text-neutral-400">
                  {g.multiAnglePromptLabel}
                </p>
                <p className="mt-1 text-sm text-neutral-700">{pendingMultiAngle.prompt}</p>
              </div>

              <div>
                <p className="text-xs font-medium uppercase tracking-wide text-neutral-400">{g.anglesLabel}</p>
                <div className="mt-2 grid grid-cols-3 gap-2 sm:grid-cols-5">
                  {ANGLE_PRESETS.map((preset) => {
                    const checked = selectedAngles.includes(preset.id);
                    return (
                      <button
                        key={preset.id}
                        type="button"
                        onClick={() => toggleAngle(preset.id)}
                        className={cn(
                          "flex flex-col items-center gap-1 rounded-[14px] border px-2 py-2.5 text-xs transition-colors",
                          checked
                            ? "border-neutral-900 bg-neutral-50 text-neutral-900"
                            : "border-neutral-200 text-neutral-400 hover:border-neutral-300 hover:text-neutral-700",
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
                  className="rounded-full px-3.5 py-2 text-sm text-neutral-500 transition-colors hover:bg-neutral-100"
                >
                  {g.cancel}
                </button>
                <button
                  type="button"
                  onClick={confirmMultiAngle}
                  disabled={selectedAngles.length === 0}
                  className="rounded-full bg-neutral-900 px-4 py-2 text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-40"
                >
                  {selectedAngles.length === 1 ? g.generateAngleOne : formatMsg(g.generateAngleOther, { n: selectedAngles.length })}
                </button>
              </div>
            </div>
          ) : (
            <>
              {pendingAttachments.length > 0 && (
                <div className="flex flex-wrap gap-2 px-3 pt-3">
                  {pendingAttachments.map((att) => (
                    <PendingAttachmentChip key={att.id} attachment={att} onRemove={() => removeAttachment(att.id)} />
                  ))}
                </div>
              )}

              {videoAdvancedMode !== "none" && !advancedPanelOpen && (
                <div className="flex flex-wrap items-center gap-2 px-3 pt-3">
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-neutral-100 px-3 py-1 text-xs text-neutral-600">
                    {videoAdvancedMode === "storyboard"
                      ? g.storyboardActive
                      : formatMsg(g.multiRefActive, { n: multiRefPaths.length })}
                    <button
                      type="button"
                      onClick={clearAdvancedVideo}
                      aria-label={g.cancel}
                      className="text-neutral-400 hover:text-neutral-700"
                    >
                      <XIcon className="h-3 w-3" />
                    </button>
                  </span>
                </div>
              )}

              <textarea
                id="prompt"
                rows={1}
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
                className="max-h-40 w-full resize-none border-none bg-transparent px-3.5 py-3 text-sm text-neutral-900 outline-none placeholder:text-neutral-400 disabled:opacity-60"
              />

              {contentType === "video" && currentCharacter?.voiceId && (
                <div className="border-t border-neutral-100 px-3.5 py-2.5">
                  <input
                    value={dialogueText}
                    onChange={(e) => setDialogueText(e.target.value)}
                    disabled={submitting}
                    maxLength={500}
                    placeholder={formatMsg(g.dialoguePlaceholder, { name: currentCharacter.name })}
                    className="w-full border-none bg-transparent text-sm text-neutral-700 outline-none placeholder:text-neutral-400 disabled:opacity-60"
                  />
                </div>
              )}

              {advancedPanelOpen && advancedVideoEligible && !canUseAdvancedVideo && (
                <div className="border-t border-neutral-100 px-3 py-3">
                  <p className="text-xs text-neutral-500">{g.needsCharacterForAdvanced}</p>
                </div>
              )}

              {advancedPanelOpen && canUseAdvancedVideo && (
                <div className="space-y-3 border-t border-neutral-100 px-3 py-3">
                  <div className="flex gap-1 rounded-full bg-neutral-100 p-1">
                    {(["storyboard", "multiref"] as const).map((mode) => (
                      <button
                        key={mode}
                        type="button"
                        onClick={() => setVideoAdvancedMode(mode)}
                        className={cn(
                          "flex-1 rounded-full py-1.5 text-xs font-medium transition-colors",
                          videoAdvancedMode === mode
                            ? "bg-white text-neutral-900 shadow-sm"
                            : "text-neutral-500 hover:text-neutral-900",
                        )}
                      >
                        {mode === "storyboard" ? g.storyboardLabel : g.multiRefLabel}
                      </button>
                    ))}
                  </div>

                  {videoAdvancedMode === "storyboard" && (
                    <div className="space-y-3">
                      <p className="text-xs text-neutral-500">{g.storyboardHint}</p>
                      <div>
                        <p className="text-[11px] font-medium uppercase tracking-wide text-neutral-400">
                          {g.startFrameLabel}
                        </p>
                        <div className="mt-1.5 grid grid-cols-5 gap-1.5">
                          {referencePhotos.map((p) => (
                            <button
                              key={p.path}
                              type="button"
                              onClick={() => toggleStoryboardPhoto(p.path, "start")}
                              className={cn(
                                "relative aspect-square overflow-hidden rounded-[10px] border-2",
                                storyboardStartPath === p.path ? "border-neutral-900" : "border-transparent",
                              )}
                            >
                              {/* eslint-disable-next-line @next/next/no-img-element */}
                              <img src={p.url} alt="" className="h-full w-full object-cover" />
                            </button>
                          ))}
                        </div>
                      </div>
                      <div>
                        <p className="text-[11px] font-medium uppercase tracking-wide text-neutral-400">
                          {g.endFrameLabel}
                        </p>
                        <div className="mt-1.5 grid grid-cols-5 gap-1.5">
                          {referencePhotos.map((p) => (
                            <button
                              key={p.path}
                              type="button"
                              onClick={() => toggleStoryboardPhoto(p.path, "end")}
                              className={cn(
                                "relative aspect-square overflow-hidden rounded-[10px] border-2",
                                storyboardEndPath === p.path ? "border-neutral-900" : "border-transparent",
                              )}
                            >
                              {/* eslint-disable-next-line @next/next/no-img-element */}
                              <img src={p.url} alt="" className="h-full w-full object-cover" />
                            </button>
                          ))}
                        </div>
                      </div>
                    </div>
                  )}

                  {videoAdvancedMode === "multiref" && (
                    <div className="space-y-2">
                      <p className="text-xs text-neutral-500">{g.multiRefHint}</p>
                      <div className="grid grid-cols-5 gap-1.5">
                        {referencePhotos.map((p) => {
                          const checked = multiRefPaths.includes(p.path);
                          return (
                            <button
                              key={p.path}
                              type="button"
                              onClick={() => toggleMultiRefPhoto(p.path)}
                              className={cn(
                                "relative aspect-square overflow-hidden rounded-[10px] border-2",
                                checked ? "border-neutral-900" : "border-transparent",
                              )}
                            >
                              {/* eslint-disable-next-line @next/next/no-img-element */}
                              <img src={p.url} alt="" className="h-full w-full object-cover" />
                              {checked && (
                                <span className="absolute right-1 top-1 flex h-4 w-4 items-center justify-center rounded-full bg-neutral-900 text-white">
                                  <CheckIcon className="h-2.5 w-2.5" />
                                </span>
                              )}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  <div className="flex justify-end gap-2 pt-1">
                    <button
                      type="button"
                      onClick={clearAdvancedVideo}
                      className="rounded-full px-3 py-1.5 text-xs text-neutral-500 transition-colors hover:bg-neutral-100"
                    >
                      {g.cancel}
                    </button>
                    <button
                      type="button"
                      onClick={() => setAdvancedPanelOpen(false)}
                      className="rounded-full bg-neutral-900 px-3 py-1.5 text-xs font-medium text-white transition-opacity hover:opacity-90"
                    >
                      {g.done}
                    </button>
                  </div>
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
                    className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full text-neutral-500 transition-colors hover:bg-neutral-100 hover:text-neutral-900 disabled:opacity-50"
                  >
                    {plusMenuOpen ? <XIcon className="h-4 w-4" /> : <PlusIcon className="h-4 w-4" />}
                  </button>

                  {creationModeActive && (
                    <button
                      type="button"
                      onClick={clearCreationMode}
                      className="flex flex-shrink-0 items-center gap-1 rounded-full bg-neutral-100 py-1.5 pl-3 pr-2 text-xs font-medium text-neutral-700 transition-colors hover:bg-neutral-200"
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
                        "absolute left-0 z-20 w-56 overflow-hidden rounded-[16px] border border-neutral-200 bg-white p-1.5 shadow-[0_16px_40px_-12px_rgba(0,0,0,0.18)]",
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
                          className="flex w-full items-center gap-2.5 whitespace-nowrap rounded-[10px] px-2.5 py-2 text-left text-sm text-neutral-700 transition-colors hover:bg-neutral-50"
                        >
                          <CameraIcon className="h-4 w-4 text-neutral-400" />
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
                        className="flex w-full items-center gap-2.5 whitespace-nowrap rounded-[10px] px-2.5 py-2 text-left text-sm text-neutral-700 transition-colors hover:bg-neutral-50"
                      >
                        <FileIcon className="h-4 w-4 text-neutral-400" />
                        {g.uploadFiles}
                      </button>
                      <button
                        type="button"
                        role="menuitem"
                        onClick={() => chooseCreationMode("image")}
                        className="flex w-full items-center gap-2.5 whitespace-nowrap rounded-[10px] px-2.5 py-2 text-left text-sm text-neutral-700 transition-colors hover:bg-neutral-50"
                      >
                        <ImageIcon className="h-4 w-4 text-neutral-400" />
                        {g.createImage}
                      </button>
                      <button
                        type="button"
                        role="menuitem"
                        onClick={() => chooseCreationMode("video")}
                        className="flex w-full items-center gap-2.5 whitespace-nowrap rounded-[10px] px-2.5 py-2 text-left text-sm text-neutral-700 transition-colors hover:bg-neutral-50"
                      >
                        <VideoIcon className="h-4 w-4 text-neutral-400" />
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
                  {contentType === "video" && (
                    <>
                      <div
                        className={cn(
                          "overflow-hidden transition-all duration-300 ease-out",
                          advancedOpen ? "max-w-[96px] opacity-100" : "max-w-0 opacity-0",
                        )}
                      >
                        <div className="flex items-center gap-1.5 pr-1">
                          <button
                            type="button"
                            onClick={toggleMultiAngleMode}
                            disabled={submitting}
                            title={multiAngleMode ? g.multiAngleOnTitle : g.multiAngleOffTitle}
                            aria-label={multiAngleMode ? g.multiAngleOnTitle : g.multiAngleOffTitle}
                            aria-pressed={multiAngleMode}
                            className={cn(
                              "flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full transition-colors disabled:opacity-50",
                              multiAngleMode
                                ? "bg-neutral-900 text-white"
                                : "text-neutral-500 hover:bg-neutral-100 hover:text-neutral-900",
                            )}
                          >
                            <AnglesIcon className="h-4 w-4" />
                          </button>

                          {advancedVideoEligible && (
                            <button
                              type="button"
                              onClick={() =>
                                videoAdvancedMode === "none"
                                  ? openAdvancedVideo("storyboard")
                                  : setAdvancedPanelOpen((v) => !v)
                              }
                              disabled={submitting}
                              title={videoAdvancedMode === "none" ? g.advancedVideoOffTitle : g.advancedVideoOnTitle}
                              aria-label={videoAdvancedMode === "none" ? g.advancedVideoOffTitle : g.advancedVideoOnTitle}
                              aria-pressed={videoAdvancedMode !== "none"}
                              className={cn(
                                "flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full transition-colors disabled:opacity-50",
                                videoAdvancedMode !== "none"
                                  ? "bg-neutral-900 text-white"
                                  : "text-neutral-500 hover:bg-neutral-100 hover:text-neutral-900",
                              )}
                            >
                              <StackIcon className="h-4 w-4" />
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
                        className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full text-neutral-500 transition-colors hover:bg-neutral-100 hover:text-neutral-900"
                      >
                        <ChevronLeftIcon
                          className={cn("h-4 w-4 transition-transform duration-300", advancedOpen && "rotate-180")}
                        />
                      </button>
                    </>
                  )}

                  {contentType === "video" && (
                    <div className="flex flex-shrink-0 items-center gap-0.5 rounded-full border border-neutral-100 bg-neutral-50 p-1">
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
                            ? "bg-neutral-900 text-white"
                            : "text-neutral-400 hover:bg-neutral-100 hover:text-neutral-900",
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
                            ? "bg-neutral-900 text-white"
                            : "text-neutral-400 hover:bg-neutral-100 hover:text-neutral-900",
                        )}
                      >
                        <PortraitIcon className="h-4 w-4" />
                      </button>
                    </div>
                  )}

                  <button
                    type="button"
                    onClick={toggleVoiceMode}
                    disabled={submitting}
                    title={voiceMode ? g.voiceOnTitle : g.voiceOffTitle}
                    aria-label={voiceMode ? g.voiceOnTitle : g.voiceOffTitle}
                    aria-pressed={voiceMode}
                    className={cn(
                      "flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full transition-colors disabled:opacity-50",
                      voiceMode
                        ? "bg-neutral-900 text-white"
                        : "text-neutral-500 hover:bg-neutral-100 hover:text-neutral-900",
                    )}
                  >
                    <VoiceIcon className="h-4 w-4" />
                  </button>

                  <VoiceRecorderButton onTranscript={handleVoiceTranscript} disabled={submitting} size="md" />
                  </div>

                  {submitting ? (
                    <button
                      type="button"
                      onClick={handleStop}
                      disabled={stopping}
                      title={stopping ? g.stopping : g.stop}
                      aria-label={stopping ? g.stopping : g.stop}
                      className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full bg-neutral-900 text-white transition-colors hover:bg-neutral-800 disabled:opacity-60"
                    >
                      <StopIcon className="h-3.5 w-3.5" />
                    </button>
                  ) : (
                    <button
                      type="submit"
                      disabled={isUploading || (!prompt.trim() && pendingAttachments.length === 0)}
                      title={g.send}
                      aria-label={g.send}
                      className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full bg-neutral-900 text-white transition-colors hover:bg-neutral-800 disabled:opacity-30"
                    >
                      <SendIcon className="h-4 w-4" />
                    </button>
                  )}
                </div>
              </div>
            </>
          )}
        </div>

        {/* Submitting's own "running the pipeline" status now shows inside the
            chat bubble itself (with a spinner) as soon as a message exists —
            repeating it here too was redundant clutter right above the AI
            disclaimer. Multi-angle review and upload progress still show
            here since neither has a bubble to live in yet at that point. */}
        {(pendingMultiAngle || isUploading) && (
          <p className="mt-3 text-xs text-neutral-400">
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
            "text-xs text-neutral-400",
            pendingMultiAngle || isUploading ? "mt-1" : "mt-3",
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
    </>
  );
}
