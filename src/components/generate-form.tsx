"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/field";
import { runGeneration, runMultiAngleGeneration, type HistoryTurn } from "@/lib/generations/actions";
import { synthesizeVoice } from "@/lib/voice/actions";
import { uploadChatAttachment, deleteChatAttachment, type ChatAttachment } from "@/lib/attachments/actions";
import { VoiceRecorderButton } from "@/components/voice-recorder-button";
import {
  type AttemptLog,
  type PipelineStepLog,
  type ContentType,
} from "@/lib/generations/pipeline";
import { ANGLE_PRESETS, DEFAULT_ANGLE_IDS, getAnglePreset, type AngleId } from "@/lib/generations/angles";
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
                "mt-1.5 h-1.5 w-1.5 flex-shrink-0 rounded-full",
                isCurrent ? "animate-pulse bg-neutral-900" : "bg-neutral-300",
              )}
            />
            <div className="min-w-0">
              <p className="text-xs font-semibold uppercase tracking-wide text-neutral-500">
                {stepLabel(item.step.step, isLive, g)}
                {timeline.some((entry) => entry.kind === "step" && entry.attempt > 1) && (
                  <span className="ml-2 font-normal normal-case text-neutral-400">
                    {formatMsg(g.attemptSuffix, { n: item.attempt })}
                  </span>
                )}
              </p>
              <p className="mt-0.5 whitespace-pre-wrap text-sm text-neutral-700">
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
      <video
        src={resultUrl}
        controls
        aria-label={prompt}
        className="mt-4 aspect-video w-full rounded-[14px] bg-neutral-950"
      />
    ) : (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={resultUrl}
        alt={prompt || t.generate.resultAlt}
        className="mt-4 w-full rounded-[14px] bg-neutral-100 object-cover"
      />
    );
  }

  const typeLabel = (contentType === "video" ? t.generate.video : t.generate.image).toLowerCase();

  return (
    <div className="mt-4 flex aspect-video items-center justify-center rounded-[14px] bg-neutral-100 text-center">
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
                className="block h-16 w-16 flex-shrink-0 overflow-hidden rounded-[10px] border border-neutral-200"
              >
                <AttachmentThumb attachment={att} className="h-full w-full" />
              </a>
            ))}
          </div>
        )}
        {prompt && (
          <div className="rounded-[16px] rounded-br-[4px] bg-neutral-900 px-4 py-2.5 text-sm text-white">
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

function LoaderIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="animate-spin" {...props}>
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

function PendingAttachmentChip({ attachment, onRemove }: { attachment: PendingAttachment; onRemove: () => void }) {
  const { t } = useLocale();
  const isImage = attachment.type.startsWith("image/");
  const isVideo = attachment.type.startsWith("video/");

  return (
    <div className="group relative h-16 w-16 flex-shrink-0 overflow-hidden rounded-[10px] border border-neutral-200 bg-neutral-50">
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
        <div className="absolute inset-0 flex items-center justify-center bg-red-50/90 p-1 text-center text-[9px] text-red-600 dark:bg-red-500/20 dark:text-red-400">
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

export function GenerateForm(props: {
  characters: CharacterOption[];
  klingActive: boolean;
  elitePlanActive: boolean;
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

function SingleTurnBubble({ turn }: { turn: ChatTurn }) {
  const { t } = useLocale();
  const g = t.generate;
  const live = isLiveTurn(turn.attempts);
  const timeline = buildTimeline(turn.attempts);
  return (
    <div className="space-y-3">
      <UserBubble prompt={turn.prompt} attachments={turn.attachments} />
      <div className="flex justify-start">
        <div className="max-w-[90%] rounded-[16px] rounded-bl-[4px] border border-neutral-100 bg-neutral-50 px-4 py-3.5">
          <PipelineTrace timeline={timeline} revealedCount={timeline.length} isAnimating={false} isLive={live} />
          {turn.succeeded ? (
            <>
              <ResultMedia succeeded={turn.succeeded} resultUrl={turn.resultUrl} contentType={turn.contentType} prompt={turn.prompt} />
              <div className="mt-3 flex items-center gap-2">
                <Badge tone={live ? "success" : "neutral"}>{live ? g.live : g.simulated}</Badge>
                <p className="text-xs text-neutral-500">{formatMsg(g.passedOnAttempt, { n: turn.attempts.length })}</p>
              </div>
            </>
          ) : (
            <div className="mt-3 flex items-center gap-2">
              <Badge tone="danger">{g.couldntValidate}</Badge>
              <p className="text-xs text-neutral-500">
                {turn.attempts.length === 1 ? g.noPassingResultOne : formatMsg(g.noPassingResultOther, { n: turn.attempts.length })}
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
                "rounded-[8px] border px-2.5 py-1 text-xs font-medium transition-colors",
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
            <div className="mt-3 flex items-center gap-2">
              <Badge tone={isLive ? "success" : "neutral"}>{isLive ? g.live : g.simulated}</Badge>
              <p className="text-xs text-neutral-500">{formatMsg(g.passedOnAttempt, { n: active.attempts.length })}</p>
            </div>
          ) : (
            <div className="mt-3 flex items-center gap-2">
              <Badge tone="danger">{g.couldntValidate}</Badge>
              <p className="text-xs text-neutral-500">
                {active.attempts.length === 1 ? g.noPassingResultOne : formatMsg(g.noPassingResultOther, { n: active.attempts.length })}
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
        <div className="max-w-[90%] rounded-[16px] rounded-bl-[4px] border border-neutral-100 bg-neutral-50 px-4 py-3.5">
          <MultiAngleResult angles={item.angles} prompt={item.prompt} />
        </div>
      </div>
    </div>
  );
}

function GenerateFormInner({
  characters,
  klingActive,
  elitePlanActive,
}: {
  characters: CharacterOption[];
  klingActive: boolean;
  elitePlanActive: boolean;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { t } = useLocale();
  const g = t.generate;

  const [characterId, setCharacterId] = useState(characters[0]?.id ?? "");
  const [contentType, setContentType] = useState<ContentType>("video");
  const [prompt, setPrompt] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [voiceMode, setVoiceMode] = useState(false);
  const [pendingAttachments, setPendingAttachments] = useState<PendingAttachment[]>([]);

  const [items, setItems] = useState<ChatItem[]>([]);

  const [livePrompt, setLivePrompt] = useState<string | null>(null);
  const [liveAttachments, setLiveAttachments] = useState<ChatAttachment[]>([]);
  const [liveTimeline, setLiveTimeline] = useState<VisibleItem[]>([]);
  const [liveIsLive, setLiveIsLive] = useState(false);
  const [liveResult, setLiveResult] = useState<{ succeeded: boolean; resultUrl: string | null; attempts: number } | null>(null);
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

  // Kling advanced video options — storyboard (start/end frame) and
  // multi-image reference both draw from the selected character's existing
  // reference photos rather than a new upload flow. Mutually exclusive with
  // each other and with multi-angle mode (see the effects below) to keep the
  // pipeline's branching in fal.ts unambiguous — only one "which endpoint"
  // decision per request.
  const [videoAdvancedMode, setVideoAdvancedMode] = useState<"none" | "storyboard" | "multiref">("none");
  const [advancedPanelOpen, setAdvancedPanelOpen] = useState(false);
  const [storyboardStartPath, setStoryboardStartPath] = useState<string | null>(null);
  const [storyboardEndPath, setStoryboardEndPath] = useState<string | null>(null);
  const [multiRefPaths, setMultiRefPaths] = useState<string[]>([]);

  // Dialogue — a spoken line the character says, lip-synced onto the
  // finished video. Available on every plan (unlike the Kling-only advanced
  // options above); only shown once the selected character has a voice
  // assigned in Character settings.
  const [dialogueText, setDialogueText] = useState("");

  const bottomRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const isAnimating = revealedCount > 0 && revealedCount < liveTimeline.length;
  const isUploading = pendingAttachments.some((a) => a.status === "uploading");
  const locked = submitting || pendingMultiAngle !== null;

  const currentCharacter = characters.find((c) => c.id === characterId);
  const referencePhotos = currentCharacter?.referencePhotos ?? [];
  const canUseAdvancedVideo =
    contentType === "video" && klingActive && elitePlanActive && referencePhotos.length > 0;

  useEffect(() => {
    const saved = window.localStorage.getItem(VOICE_MODE_STORAGE_KEY);
    if (saved === "1") setVoiceMode(true);
  }, []);

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
  }

  function toggleAngle(id: AngleId) {
    setSelectedAngles((prev) => (prev.includes(id) ? prev.filter((a) => a !== id) : [...prev, id]));
  }

  function toggleMultiAngleMode() {
    setMultiAngleMode((prev) => {
      const next = !prev;
      if (next) clearAdvancedVideo();
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
    setSubmitting(true);
    setError("");
    setLiveMultiAngle({ prompt: mPrompt, attachments, angleIds: selectedAngles });
    setPendingMultiAngle(null);

    const formData = new FormData();
    formData.set("prompt", mPrompt);
    formData.set("character_id", characterId);
    selectedAngles.forEach((id) => formData.append("angle", id));

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
      uploadChatAttachment(formData).then((result) => {
        setPendingAttachments((prev) =>
          prev.map((a) => {
            if (a.id !== id) return a;
            if (result.error !== null) return { ...a, status: "error", error: result.error };
            return { ...a, status: "ready", url: result.attachment!.url, path: result.attachment!.path };
          }),
        );
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

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [items.length, revealedCount, livePrompt, liveMultiAngle]);

  // Multi-angle is video-only — switching to Image quietly turns it off
  // (resetChat, triggered by the effect above on contentType change, clears
  // any in-progress confirm panel too).
  useEffect(() => {
    if (contentType !== "video") setMultiAngleMode(false);
  }, [contentType]);

  // A request forwarded here from the sidebar's global voice command arrives
  // as ?voice=<text> (or the special "new chat" marker) — pick it up once,
  // then strip it from the URL so refreshing doesn't replay it.
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

    const shouldSpeak = Boolean(opts?.speak || voiceMode);

    setError("");
    setSubmitting(true);
    setLivePrompt(submittedPrompt);
    setLiveAttachments(submittedAttachments);
    setPrompt("");
    setPendingAttachments([]);
    setLiveTimeline([]);
    setLiveResult(null);
    setRevealedCount(0);

    if (shouldSpeak) speak(g.speakWorkingOnIt);

    const formData = new FormData();
    formData.set("prompt", submittedPrompt);
    if (videoAdvancedMode === "multiref" && multiRefPaths.length >= 2) {
      formData.set("reference_photo_paths", JSON.stringify(multiRefPaths));
    } else if (videoAdvancedMode === "storyboard" && storyboardStartPath) {
      formData.set("storyboard_start_path", storyboardStartPath);
      if (storyboardEndPath) formData.set("storyboard_end_path", storyboardEndPath);
    }
    const submittedDialogue = contentType === "video" ? dialogueText.trim() : "";
    if (submittedDialogue) {
      formData.set("dialogue", submittedDialogue);
    }
    formData.set("character_id", characterId);
    formData.set("content_type", contentType);
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

    setLiveResult({
      succeeded: result.succeeded,
      resultUrl: result.resultUrl,
      attempts: result.attempts.length,
    });

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

  const hasAnyMessages = items.length > 0 || livePrompt !== null || liveMultiAngle !== null;

  return (
    <div className="flex flex-col overflow-hidden rounded-[18px] border border-neutral-100 bg-white shadow-[0_1px_2px_rgba(0,0,0,0.03),0_12px_28px_-12px_rgba(0,0,0,0.06)]">
      <div className="space-y-3 border-b border-neutral-100 p-5">
        <div className="flex items-center gap-2">
          <div className="flex flex-1 gap-1 rounded-[10px] bg-neutral-100 p-1">
            {(["video", "image"] as const).map((type) => (
              <button
                key={type}
                type="button"
                onClick={() => setContentType(type)}
                disabled={locked}
                className={cn(
                  "flex-1 rounded-[8px] py-1.5 text-sm capitalize transition-colors",
                  contentType === type
                    ? "bg-white text-neutral-900 shadow-sm"
                    : "text-neutral-500 hover:text-neutral-900",
                )}
              >
                {type === "video" ? g.video : g.image}
              </button>
            ))}
          </div>

          {hasAnyMessages && (
            <button
              type="button"
              onClick={resetChat}
              disabled={locked}
              className="flex-shrink-0 rounded-[10px] border border-neutral-200 px-3 py-2 text-xs font-medium text-neutral-600 transition-colors hover:border-neutral-300 hover:bg-neutral-50 disabled:opacity-50"
            >
              {g.newChat}
            </button>
          )}
        </div>

        {characters.length > 1 && (
          <select
            value={characterId}
            onChange={(e) => setCharacterId(e.target.value)}
            disabled={locked}
            className="w-full rounded-[10px] border border-neutral-200 bg-white px-3.5 py-2 text-sm text-neutral-900 outline-none focus:border-neutral-400"
          >
            {characters.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        )}
      </div>

      <div className="max-h-[60vh] min-h-[280px] flex-1 space-y-6 overflow-y-auto p-5">
        {!hasAnyMessages ? (
          <p className="py-10 text-center text-sm text-neutral-400">
            {g.noMessages}
          </p>
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
                  <div className="max-w-[90%] rounded-[16px] rounded-bl-[4px] border border-neutral-100 bg-neutral-50 px-4 py-3.5">
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
                  <div className="max-w-[90%] rounded-[16px] rounded-bl-[4px] border border-neutral-100 bg-neutral-50 px-4 py-3.5">
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
                          </>
                        ) : (
                          <div className="mt-3 flex items-center gap-2">
                            <Badge tone="danger">{g.couldntValidate}</Badge>
                            <p className="text-xs text-neutral-500">
                              {liveResult.attempts === 1 ? g.noPassingResultOne : formatMsg(g.noPassingResultOther, { n: liveResult.attempts })}
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

      <form onSubmit={handleSubmit} className="border-t border-neutral-100 p-4">
        <Label htmlFor="prompt" className="sr-only">
          {g.messageLabel}
        </Label>

        <div className="rounded-[20px] border border-neutral-200 bg-white transition-colors focus-within:border-neutral-400">
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
                          "flex flex-col items-center gap-1 rounded-[10px] border px-2 py-2.5 text-xs transition-colors",
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
                  className="rounded-[10px] px-3.5 py-2 text-sm text-neutral-500 transition-colors hover:bg-neutral-100"
                >
                  {g.cancel}
                </button>
                <button
                  type="button"
                  onClick={confirmMultiAngle}
                  disabled={selectedAngles.length === 0}
                  className="rounded-[10px] bg-neutral-900 px-4 py-2 text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-40"
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

              {advancedPanelOpen && canUseAdvancedVideo && (
                <div className="space-y-3 border-t border-neutral-100 px-3 py-3">
                  <div className="flex gap-1 rounded-[8px] bg-neutral-100 p-1">
                    {(["storyboard", "multiref"] as const).map((mode) => (
                      <button
                        key={mode}
                        type="button"
                        onClick={() => setVideoAdvancedMode(mode)}
                        className={cn(
                          "flex-1 rounded-[6px] py-1.5 text-xs font-medium transition-colors",
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
                                "relative aspect-square overflow-hidden rounded-[8px] border-2",
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
                                "relative aspect-square overflow-hidden rounded-[8px] border-2",
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
                                "relative aspect-square overflow-hidden rounded-[8px] border-2",
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
                      className="rounded-[8px] px-3 py-1.5 text-xs text-neutral-500 transition-colors hover:bg-neutral-100"
                    >
                      {g.cancel}
                    </button>
                    <button
                      type="button"
                      onClick={() => setAdvancedPanelOpen(false)}
                      className="rounded-[8px] bg-neutral-900 px-3 py-1.5 text-xs font-medium text-white transition-opacity hover:opacity-90"
                    >
                      {g.done}
                    </button>
                  </div>
                </div>
              )}

              <div className="flex items-center justify-between px-2 pb-2">
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    disabled={submitting}
                    title={g.attachTitle}
                    aria-label={g.attachTitle}
                    className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full text-neutral-500 transition-colors hover:bg-neutral-100 hover:text-neutral-900 disabled:opacity-50"
                  >
                    <PlusIcon className="h-4 w-4" />
                  </button>
                  <input
                    ref={fileInputRef}
                    type="file"
                    multiple
                    hidden
                    accept="image/*,video/*,.pdf,.txt,.doc,.docx"
                    onChange={handleFilesSelected}
                  />
                </div>

                <div className="flex items-center gap-1">
                  {contentType === "video" && (
                    <button
                      type="button"
                      onClick={toggleMultiAngleMode}
                      disabled={submitting}
                      title={multiAngleMode ? g.multiAngleOnTitle : g.multiAngleOffTitle}
                      aria-label={multiAngleMode ? g.multiAngleOnTitle : g.multiAngleOffTitle}
                      aria-pressed={multiAngleMode}
                      className={cn(
                        "flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full transition-colors disabled:opacity-50",
                        multiAngleMode
                          ? "bg-neutral-900 text-white"
                          : "text-neutral-500 hover:bg-neutral-100 hover:text-neutral-900",
                      )}
                    >
                      <AnglesIcon className="h-4 w-4" />
                    </button>
                  )}

                  {canUseAdvancedVideo && (
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
                        "flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full transition-colors disabled:opacity-50",
                        videoAdvancedMode !== "none"
                          ? "bg-neutral-900 text-white"
                          : "text-neutral-500 hover:bg-neutral-100 hover:text-neutral-900",
                      )}
                    >
                      <StackIcon className="h-4 w-4" />
                    </button>
                  )}

                  <button
                    type="button"
                    onClick={toggleVoiceMode}
                    disabled={submitting}
                    title={voiceMode ? g.voiceOnTitle : g.voiceOffTitle}
                    aria-label={voiceMode ? g.voiceOnTitle : g.voiceOffTitle}
                    aria-pressed={voiceMode}
                    className={cn(
                      "flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full transition-colors disabled:opacity-50",
                      voiceMode
                        ? "bg-neutral-900 text-white"
                        : "text-neutral-500 hover:bg-neutral-100 hover:text-neutral-900",
                    )}
                  >
                    <VoiceIcon className="h-4 w-4" />
                  </button>

                  <VoiceRecorderButton onTranscript={handleVoiceTranscript} disabled={submitting} size="md" />

                  <button
                    type="submit"
                    disabled={submitting || isUploading || (!prompt.trim() && pendingAttachments.length === 0)}
                    title={g.send}
                    aria-label={g.send}
                    className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-neutral-900 text-white transition-colors hover:bg-neutral-800 disabled:opacity-30"
                  >
                    <SendIcon className="h-4 w-4" />
                  </button>
                </div>
              </div>
            </>
          )}
        </div>

        {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
        <p className="mt-2 text-xs text-neutral-400">
          {pendingMultiAngle
            ? g.reviewAngles
            : submitting
              ? g.runningPipeline
              : isUploading
                ? g.uploading
                : g.enterToSend}
        </p>
        <p className="mt-1 text-xs text-neutral-400">{t.common.aiDisclaimer}</p>
      </form>
    </div>
  );
}
