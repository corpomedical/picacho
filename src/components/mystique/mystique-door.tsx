"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { useLocale } from "@/lib/i18n/provider";
import { localizeServerText } from "@/lib/i18n/server-text";
import { formatMsg } from "@/lib/i18n/format";
import { isStaleDeployError, reloadForNewDeploy } from "@/lib/stale-deploy";
import { pollUntilSettled } from "@/lib/generations/poll-client";
import {
  discardRecastUpload,
  getRecastTakeMedia,
  inspectRecastClip,
  reserveRecastUpload,
  startRecastTakes,
  type RecastInspection,
} from "@/lib/recast/actions";
import type { RecastCharacter, RecastMotion, RecastTake } from "@/lib/recast/data";
import { RECAST_CLIP_TOO_BIG, RECAST_NOT_A_VIDEO, RECAST_UPLOAD_UNREADABLE } from "@/lib/recast/messages";
import {
  RECAST_BUCKET,
  RECAST_ENGINES,
  RECAST_JOB_MAX_SECONDS,
  RECAST_JOB_ORDER,
  RECAST_MAX_BYTES,
  recastContainerOf,
  recastEngineFor,
  recastEnginesOf,
  recastNeedsCharacter,
  type RecastEngine,
  type RecastJob,
} from "@/lib/recast/recast";
import { composeRecastBrief, recastCharacterToken } from "@/lib/recast/recast-brief";
import { clampRecastWindow, defaultRecastWindow, isWholeClip, recastWindowCredits, type RecastWindow } from "@/lib/recast/trim";
import { sampleClip } from "@/lib/recast/recast-client";
import type { RecastRead, RecastWarning } from "@/lib/recast/recast-read";
import { TakeViewer } from "@/components/mystique/take-viewer";

// The Mystique door (working title). Cut 2, 2026-09-18 — "Its still lacking.
// Nothing like the features of Genjitsu."
//
// What was missing was not engines, it was the SURFACE. Genjutsu's real
// product is a library you can use with no footage of your own, a machine
// that understands the clip, and a recipe you can see and change. So:
//
//   the performance   a file, OR one of your own finished videos — every
//                     take this account ever made is a performance someone
//                     else can now give. Theirs cannot do that.
//   the read          what is in the clip, as chips: who, how many cuts,
//                     what must survive, whether it will disappoint.
//   three jobs        into the clip · photo to life · restyle the world.
//   the cast          several at once; one press, one take each.
//   the brief         composed from all of it and SHOWN. Theirs is hidden.
//   the lock          the face judged end to end, and a miss not charged.
//
// NO MACHINERY ON THE WALL: t.mystique names no engine and no model. The
// jobs are said as what happens, the engines as Full and Lighter, and every
// price is read from the clip itself server-side — the number on the button
// is the number charged.

type Source =
  | { kind: "upload"; phase: "uploading" | "inspecting" | "ready"; url: string; path: string | null; name: string }
  | { kind: "take"; phase: "inspecting" | "ready"; url: string; takeId: string; name: string };

type Viewing = { take: RecastTake; media: { resultUrl: string; sourceUrl: string | null } | null };

const clock = (s: number) => `${Math.floor(s / 60)}:${(s % 60).toFixed(1).padStart(4, "0")}`;

const chip = "inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-black/60 px-3 py-[5px] text-xs font-medium text-white/90";
const label = "text-[10.5px] font-semibold uppercase tracking-[0.14em] text-[#6b6f7a]";
const soft = "rounded-2xl bg-white/[0.03] p-3.5 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.08)]";
const ghost =
  "cursor-pointer rounded-xl px-3.5 py-2 text-sm font-medium text-[#ecedf1] shadow-[inset_0_0_0_1px_rgba(255,255,255,0.14)] transition-colors hover:bg-white/[0.05] disabled:cursor-not-allowed disabled:opacity-40";
const pill = (on: boolean) =>
  `cursor-pointer rounded-full px-3.5 py-1.5 text-sm font-medium transition-shadow disabled:cursor-not-allowed disabled:opacity-45 ${
    on
      ? "bg-white/[0.06] text-[#ecedf1] shadow-[inset_0_0_0_1.5px_rgba(240,196,142,0.75)]"
      : "text-[#c6c9d1] shadow-[inset_0_0_0_1px_rgba(255,255,255,0.12)] hover:shadow-[inset_0_0_0_1px_rgba(255,255,255,0.24)]"
  }`;

export function MystiqueDoor({
  characters,
  motions,
  initialTakes,
  lockOn,
}: {
  characters: RecastCharacter[];
  motions: RecastMotion[];
  initialTakes: RecastTake[];
  lockOn: boolean;
}) {
  const { t } = useLocale();
  const m = t.mystique;
  const router = useRouter();

  const castable = useMemo(() => characters.filter((c) => c.photos.length > 0), [characters]);
  const [takes, setTakes] = useState(initialTakes);
  const [seenInitial, setSeenInitial] = useState(initialTakes);
  const [source, setSource] = useState<Source | null>(null);
  const [seen, setSeen] = useState<RecastInspection | null>(null);
  const [job, setJob] = useState<RecastJob>("scene");
  // Which stretch of the clip is performed (trim.ts). Every job takes every
  // clip through a window, so nobody is moved to a job they did not choose —
  // which is how the operator's first real take went wrong.
  const [clipWindow, setClipWindow] = useState<RecastWindow | null>(null);
  const previewRef = useRef<HTMLVideoElement | null>(null);
  const [tier, setTier] = useState<"full" | "lite">("full");
  const [castIds, setCastIds] = useState<string[]>(castable[0] ? [castable[0].id] : []);
  const [photoPath, setPhotoPath] = useState<string | null>(castable[0]?.photos[0]?.path ?? null);
  const [dropped, setDropped] = useState<Set<string>>(new Set());
  const [direction, setDirection] = useState("");
  const [showBrief, setShowBrief] = useState(false);
  const [rights, setRights] = useState(false);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState("");
  const [dragOver, setDragOver] = useState(false);
  const [viewing, setViewing] = useState<Viewing | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);
  // The newest pick wins: an upload or a read that lands late is dropped.
  const pickRef = useRef(0);
  const urlRef = useRef<string | null>(null);

  if (initialTakes !== seenInitial) {
    setSeenInitial(initialTakes);
    setTakes(initialTakes);
  }

  const renderingKey = takes
    .filter((x) => x.status === "generating")
    .map((x) => x.id)
    .join(",");
  useEffect(() => {
    if (!renderingKey) return;
    const ctrl = new AbortController();
    for (const id of renderingKey.split(",")) {
      void pollUntilSettled(id, { signal: ctrl.signal }).then(() => {
        if (!ctrl.signal.aborted) router.refresh();
      });
    }
    const slow = setInterval(() => router.refresh(), 30_000);
    return () => {
      ctrl.abort();
      clearInterval(slow);
    };
  }, [renderingKey, router]);

  useEffect(
    () => () => {
      if (urlRef.current) URL.revokeObjectURL(urlRef.current);
    },
    [],
  );

  const read: RecastRead | null = seen?.read ?? null;
  const ready = source?.phase === "ready" && seen !== null;
  const needsCast = recastNeedsCharacter(job);
  const engine: RecastEngine = recastEngineFor(job, tier);
  // Priced from the file's own numbers scaled to the window — the same call
  // the server charges with (trim.ts), so the button's number is the charge.
  const quoteOf = (e: RecastEngine) =>
    seen && clipWindow ? { engine: e, credits: recastWindowCredits(e, { seconds: seen.seconds, frames: seen.frames }, clipWindow) } : null;
  const quote = quoteOf(engine);
  const cast = castIds.map((id) => castable.find((c) => c.id === id)).filter((c): c is RecastCharacter => Boolean(c));
  const takeCount = needsCast ? Math.max(1, cast.length) : 1;
  const totalCredits = quote ? quote.credits * takeCount : null;
  const keeps = job === "scene" ? (read?.keeps ?? []).filter((k) => !dropped.has(k.what)) : [];
  const photo = cast[0]?.photos.find((p) => p.path === photoPath) ?? cast[0]?.photos[0] ?? null;
  const busy = starting || (source !== null && source.phase !== "ready");
  const canTake =
    ready && rights && !starting && quote !== null && clipWindow !== null && (needsCast ? cast.length > 0 : direction.trim().length > 0);

  // The same function the server composes with, so what is shown is what is
  // sent. Not memoised: it is string work over a handful of short fields,
  // and every input is rebuilt each render anyway.
  const brief = seen
    ? composeRecastBrief({
        job,
        read,
        seconds: seen.seconds,
        casting: cast[0]
          ? {
              tag: read?.people.find((p) => p.lead)?.tag ?? null,
              characterName: cast[0].name,
              // The same name the server gives the engine (actions.ts castingFor).
              ...(engine === "kling-edit" ? { token: recastCharacterToken(cast[0].photos.length) } : {}),
            }
          : null,
        keeps,
        direction,
      })
    : "";

  function setClip(next: Source | null) {
    if (urlRef.current && urlRef.current !== next?.url) URL.revokeObjectURL(urlRef.current);
    urlRef.current = next?.kind === "upload" ? next.url : null;
    setSource(next);
    if (next === null) {
      setSeen(null);
      setClipWindow(null);
    }
  }

  /** The read runs on frames sampled here, while the upload is still going. */
  async function inspect(mine: number, args: { path?: string; takeId?: string }, sampleFrom: File | string) {
    const sampled = await sampleClip(sampleFrom);
    if (mine !== pickRef.current) return null;
    const res = await inspectRecastClip({
      ...args,
      frames: sampled.ok ? sampled.clip.frames.join("\n") : "",
    });
    if (mine !== pickRef.current) return null;
    return res;
  }

  async function pickFile(file: File | undefined) {
    if (!file || starting) return;
    setError("");
    setRights(false);
    setDropped(new Set());
    const mine = ++pickRef.current;
    if (source?.kind === "upload" && source.path) void discardRecastUpload(source.path).catch(() => {});
    if (!recastContainerOf(file.type)) {
      setClip(null);
      setError(RECAST_NOT_A_VIDEO);
      return;
    }
    if (file.size > RECAST_MAX_BYTES) {
      setClip(null);
      setError(RECAST_CLIP_TOO_BIG);
      return;
    }
    const url = URL.createObjectURL(file);
    setClip({ kind: "upload", phase: "uploading", url, path: null, name: file.name });
    const fail = (message: string) => {
      if (mine !== pickRef.current) return;
      setClip(null);
      setError(message);
    };
    try {
      const reserved = await reserveRecastUpload({ size: file.size, type: file.type });
      if (mine !== pickRef.current) return;
      if (reserved.error !== null) return fail(reserved.error);
      const { error: uploadError } = await createClient()
        .storage.from(RECAST_BUCKET)
        .upload(reserved.path, file, { contentType: reserved.contentType });
      if (mine !== pickRef.current) {
        void discardRecastUpload(reserved.path).catch(() => {});
        return;
      }
      if (uploadError) return fail(RECAST_UPLOAD_UNREADABLE);
      setClip({ kind: "upload", phase: "inspecting", url, path: reserved.path, name: file.name });
      const res = await inspect(mine, { path: reserved.path }, file);
      if (res === null) return;
      if (res.error !== null) return fail(res.error);
      setSeen(res);
      setClip({ kind: "upload", phase: "ready", url, path: reserved.path, name: file.name });
      setClipWindow(defaultRecastWindow(res.seconds, job));
    } catch (err) {
      const stale = isStaleDeployError(err);
      fail(stale ? t.generate.refreshNeeded : t.generate.submitFailed);
      if (stale) reloadForNewDeploy({ delayMs: 1800 });
    }
  }

  async function pickMotion(motion: RecastMotion) {
    if (starting) return;
    setError("");
    setRights(false);
    setDropped(new Set());
    const mine = ++pickRef.current;
    if (source?.kind === "upload" && source.path) void discardRecastUpload(source.path).catch(() => {});
    setClip({ kind: "take", phase: "inspecting", url: motion.videoUrl, takeId: motion.takeId, name: motion.title });
    try {
      const res = await inspect(mine, { takeId: motion.takeId }, motion.videoUrl);
      if (res === null) return;
      if (res.error !== null) {
        setClip(null);
        setError(res.error);
        return;
      }
      setSeen(res);
      setClip({ kind: "take", phase: "ready", url: motion.videoUrl, takeId: motion.takeId, name: motion.title });
      setClipWindow(defaultRecastWindow(res.seconds, job));
    } catch {
      setClip(null);
      setError(t.generate.submitFailed);
    }
  }

  /** A clip too long for the job in hand moves to one that takes it. */
  /**
   * A job is only ever chosen by the person. Until 2026-09-18 a clip longer
   * than the job in hand moved the door to whichever job took it — which is
   * how a 28 s crowd scene landed in Photo to life and came back as a room of
   * cloned children. Now the job stays, and the window shrinks to fit it.
   */
  function chooseJob(next: RecastJob) {
    setJob(next);
    if (seen && clipWindow) setClipWindow(clampRecastWindow(clipWindow, seen.seconds, next));
  }

  /** The preview plays the chosen stretch and nothing else. */
  function holdPreviewInWindow() {
    const v = previewRef.current;
    if (!v || !clipWindow) return;
    if (v.currentTime < clipWindow.start - 0.05 || v.currentTime >= clipWindow.end) v.currentTime = clipWindow.start;
  }

  async function take() {
    if (!canTake || !seen || !source) return;
    setError("");
    setStarting(true);
    let res: Awaited<ReturnType<typeof startRecastTakes>>;
    try {
      res = await startRecastTakes({
        ...(source.kind === "upload" ? { path: source.path ?? undefined } : { takeId: source.takeId }),
        characterIds: needsCast ? cast.map((c) => c.id) : [],
        photoPath: photo?.path,
        engine,
        keeps: keeps.map((k) => k.what),
        direction,
        castTag: read?.people.find((p) => p.lead)?.tag,
        read,
        window: clipWindow ?? undefined,
        rights,
      });
    } catch (err) {
      const stale = isStaleDeployError(err);
      setError(stale ? t.generate.refreshNeeded : t.generate.submitFailed);
      if (stale) reloadForNewDeploy({ delayMs: 1800 });
      return;
    } finally {
      setStarting(false);
    }
    if (res.error !== null) {
      setError(res.error);
      return;
    }
    const now = new Date().toISOString();
    setTakes((prev) => [
      ...res.ids.map((id, i) => ({
        id,
        status: "generating" as const,
        characterName: needsCast ? (cast[i]?.name ?? null) : null,
        engine,
        seconds: Math.round(seen.seconds),
        credits: quote?.credits ?? null,
        score: null,
        posterUrl: null,
        createdAt: now,
        recipe: null,
      })),
      ...prev,
    ]);
    pickRef.current++;
    setClip(null);
    setRights(false);
    setDirection("");
    router.refresh();
  }

  async function watch(x: RecastTake) {
    setError("");
    setViewing({ take: x, media: null });
    try {
      const res = await getRecastTakeMedia(x.id);
      if (res.error !== null || !res.resultUrl) {
        setViewing(null);
        setError(res.error ?? t.generate.submitFailed);
        return;
      }
      setViewing((v) => (v?.take.id === x.id ? { take: x, media: { resultUrl: res.resultUrl!, sourceUrl: res.sourceUrl } } : v));
    } catch {
      setViewing(null);
      setError(t.generate.submitFailed);
    }
  }

  /** Recreate: a finished take's settings, back on the door. */
  function reuse(x: RecastTake) {
    if (!x.recipe) return;
    setJob(x.recipe.job);
    setTier(RECAST_ENGINES[x.recipe.engine].tier);
    setDirection(x.recipe.direction);
    setViewing(null);
    if (x.recipe.source.kind === "take") {
      const motion = motions.find((mo) => mo.takeId === (x.recipe!.source as { takeId: string }).takeId);
      if (motion) void pickMotion(motion);
    }
  }

  // A warning is only said where it is true. A crowd is a problem for the
  // job that keeps the clip's people (one of them is replaced) — for Photo to
  // life it is a far bigger one, said in its own box below; for Restyle it is
  // no problem at all, everyone is redrawn.
  const shownWarnings = (seen?.warnings ?? []).filter(
    (w) => w === "cuts" || (w === "no-head" && job !== "world") || ((w === "crowd" || w === "wide") && job === "scene"),
  );
  // Photo to life builds the whole picture from the character's photo. A
  // clip that shows a room or other people has all of that INVENTED — the
  // operator's first real take: a selfie asked to become a classroom.
  const motionWillInvent = job === "motion" && read !== null && (read.people.length > 1 || read.framing === "full" || read.framing === "wide");

  const warningText: Record<RecastWarning, string> = {
    cuts: m.warnCuts,
    "no-head": m.warnNoHead,
    crowd: m.warnCrowd,
    wide: m.warnWide,
  };
  const jobName = (j: RecastJob) => (j === "scene" ? m.modeScene : j === "motion" ? m.modeMotion : m.jobWorld);
  const jobLine = (j: RecastJob) => (j === "scene" ? m.modeSceneLine : j === "motion" ? m.modeMotionLine : m.jobWorldLine);
  const jobLimit = (j: RecastJob) => (j === "scene" ? m.sceneLimit : j === "motion" ? m.motionLimit : m.worldLimit);

  const buttonLabel = starting
    ? m.starting
    : totalCredits === null
      ? m.takeButton
      : takeCount > 1
        ? `${formatMsg(m.variantsNote, { n: takeCount })} · ${formatMsg(m.credits, { n: totalCredits })}`
        : totalCredits === 1
          ? m.takeButtonOne
          : formatMsg(m.takeButtonPriced, { n: totalCredits });

  return (
    <div className="mx-auto max-w-6xl">
      <div className="rounded-[28px] bg-[#0b0c10] px-6 pb-6 pt-7 text-[#c6c9d1] shadow-[0_0_0_1px_rgba(255,255,255,0.08),0_32px_72px_-28px_rgba(0,0,0,0.7)] sm:px-8">
        <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-2">
          <div>
            <h1 className="font-display text-3xl font-semibold tracking-tight text-[#ecedf1]">{m.headline}</h1>
            <p className="mt-2 max-w-xl text-sm text-[#9aa0ad]">{m.sub}</p>
          </div>
          <div className="space-y-0.5 text-xs text-[#6b6f7a] lg:text-right">
            <p>{m.priceLine}</p>
            <p>{m.meta}</p>
          </div>
        </div>

        {viewing ? (
          <div className="mt-5">
            {viewing.media ? (
              <TakeViewer
                job={viewing.take.engine ? RECAST_ENGINES[viewing.take.engine].job : "motion"}
                resultUrl={viewing.media.resultUrl}
                sourceUrl={viewing.media.sourceUrl}
                title={viewing.take.characterName ?? m.theTake}
                historyHref={`/app/history/${viewing.take.id}`}
                canReuse={viewing.take.recipe !== null}
                onReuse={() => reuse(viewing.take)}
                onClose={() => setViewing(null)}
              />
            ) : (
              <div className="flex min-h-[340px] items-center justify-center rounded-2xl bg-[#101116] text-sm text-[#6b6f7a] ring-1 ring-white/10">
                {m.loadingTake}
              </div>
            )}
          </div>
        ) : (
          <>
            {/* The screen: the performance left, who gives it right. */}
            <div className="relative mt-5 overflow-hidden rounded-2xl ring-1 ring-white/10">
              <div className="grid md:grid-cols-2">
                <div
                  role="button"
                  tabIndex={0}
                  aria-label={m.dropTitle}
                  onClick={() => fileRef.current?.click()}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") fileRef.current?.click();
                  }}
                  onDragOver={(e) => {
                    e.preventDefault();
                    setDragOver(true);
                  }}
                  onDragLeave={() => setDragOver(false)}
                  onDrop={(e) => {
                    e.preventDefault();
                    setDragOver(false);
                    void pickFile(e.dataTransfer.files?.[0]);
                  }}
                  className={`relative min-h-[300px] cursor-pointer bg-[#101116] outline-none transition-shadow md:min-h-[360px] ${
                    dragOver ? "shadow-[inset_0_0_0_2px_#e0a468]" : "focus-visible:shadow-[inset_0_0_0_2px_rgba(240,205,166,0.6)]"
                  }`}
                >
                  {source ? (
                    <>
                      <video
                        ref={previewRef}
                        src={source.url}
                        muted
                        loop
                        autoPlay
                        playsInline
                        onTimeUpdate={holdPreviewInWindow}
                        onLoadedMetadata={holdPreviewInWindow}
                        className="absolute inset-0 h-full w-full object-contain"
                      />
                      <span className={`absolute left-3.5 top-3 ${chip} tabular-nums`}>
                        {source.kind === "take" ? m.fromTake : m.yourClip}
                        {seen ? ` · ${formatMsg(m.clipMeta, { seconds: seen.seconds, width: seen.width, height: seen.height })}` : ""}
                      </span>
                      {source.phase !== "ready" && (
                        <span className={`absolute bottom-3 left-3.5 ${chip} motion-safe:animate-pulse`}>
                          {source.phase === "uploading" ? m.uploading : m.reading}
                        </span>
                      )}
                    </>
                  ) : (
                    <div className="absolute inset-0 flex flex-col items-center justify-center gap-2.5 p-6 text-center">
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="h-7 w-7 text-[#6b6f7a]" aria-hidden>
                        <rect x="3" y="5" width="18" height="14" rx="3" />
                        <path d="M10 9.5 15 12l-5 2.5z" fill="currentColor" stroke="none" />
                      </svg>
                      <p className="text-sm font-semibold text-[#ecedf1]">{m.dropTitle}</p>
                      <p className="text-xs text-[#6b6f7a]">{m.dropOr}</p>
                      <span className="rounded-xl px-3.5 py-1.5 text-sm font-medium text-[#ecedf1] shadow-[inset_0_0_0_1px_rgba(255,255,255,0.16)]">{m.pick}</span>
                      <p className="mt-2 max-w-xs text-xs text-[#6b6f7a]">{m.restLine}</p>
                    </div>
                  )}
                </div>
                <div className="relative min-h-[240px] bg-[#0e0f14] md:min-h-[360px]">
                  {needsCast && photo ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={photo.url} alt={cast[0]?.name ?? ""} className="absolute inset-0 h-full w-full object-contain" />
                  ) : needsCast ? (
                    <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 p-6 text-center">
                      <p className="max-w-xs text-sm text-[#9aa0ad]">{m.noCharacters}</p>
                      <Link href="/app/character/new" className="rounded-xl bg-[#ecedf1] px-4 py-2 text-sm font-semibold text-[#16171c]">
                        {m.createCharacter}
                      </Link>
                    </div>
                  ) : (
                    <div className="absolute inset-0 flex items-center justify-center p-8 text-center">
                      <p className="max-w-xs text-sm text-[#9aa0ad]">{m.jobWorldLine}</p>
                    </div>
                  )}
                  <span className={`absolute right-3.5 top-3 ${chip} border-transparent text-[#f0cda6] shadow-[inset_0_0_0_1.5px_rgba(240,196,142,0.75)]`}>
                    {needsCast && cast.length > 1
                      ? formatMsg(m.variantsNote, { n: cast.length })
                      : needsCast && cast[0]
                        ? `${m.theTake} · ${cast[0].name}`
                        : m.theTake}
                  </span>
                </div>
              </div>
              <div
                aria-hidden
                className={`absolute inset-y-0 left-1/2 hidden w-[2px] bg-gradient-to-b from-transparent via-[#f0cda6] to-transparent shadow-[0_0_18px_2px_rgba(240,196,142,0.55)] md:block ${
                  busy ? "motion-safe:animate-pulse" : ""
                }`}
              />
            </div>

            {/* The stretch to perform (trim.ts). Every job takes every clip
                through this, so a long clip keeps the job that suits it. */}
            {ready && seen && clipWindow && (
              <div className={`mt-3 ${soft}`}>
                <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                  <p className={label}>{m.trimLabel}</p>
                  <p className="text-xs tabular-nums text-[#9aa0ad]">
                    {formatMsg(m.trimMeta, {
                      from: clock(clipWindow.start),
                      to: clock(clipWindow.end),
                      length: (clipWindow.end - clipWindow.start).toFixed(1),
                      total: seen.seconds.toFixed(1),
                    })}
                  </p>
                </div>
                <div aria-hidden className="relative mt-2.5 h-2 overflow-hidden rounded-full bg-white/[0.06]">
                  <div
                    className="absolute inset-y-0 rounded-full bg-[#f0cda6]/75"
                    style={{
                      left: `${(clipWindow.start / seen.seconds) * 100}%`,
                      width: `${((clipWindow.end - clipWindow.start) / seen.seconds) * 100}%`,
                    }}
                  />
                </div>
                <div className="mt-3 grid gap-3 sm:grid-cols-2">
                  <label className="block">
                    <span className="text-xs text-[#9aa0ad]">{m.trimStart}</span>
                    <input
                      type="range"
                      min={0}
                      max={Math.max(0, seen.seconds - (clipWindow.end - clipWindow.start))}
                      step={0.1}
                      value={clipWindow.start}
                      disabled={starting || isWholeClip(clipWindow, seen.seconds)}
                      onChange={(e) => {
                        const start = Number(e.target.value);
                        const next = clampRecastWindow({ start, end: start + (clipWindow.end - clipWindow.start) }, seen.seconds, job);
                        setClipWindow(next);
                        if (previewRef.current) previewRef.current.currentTime = next.start;
                      }}
                      className="mt-1 w-full accent-[#f0cda6] disabled:opacity-40"
                    />
                  </label>
                  <label className="block">
                    <span className="text-xs text-[#9aa0ad]">{m.trimLength}</span>
                    <input
                      type="range"
                      min={Math.min(3, seen.seconds)}
                      max={Math.min(RECAST_JOB_MAX_SECONDS[job], seen.seconds)}
                      step={0.1}
                      value={clipWindow.end - clipWindow.start}
                      disabled={starting}
                      onChange={(e) => setClipWindow(clampRecastWindow({ start: clipWindow.start, end: clipWindow.start + Number(e.target.value) }, seen.seconds, job))}
                      className="mt-1 w-full accent-[#f0cda6] disabled:opacity-40"
                    />
                  </label>
                </div>
                {seen.seconds > RECAST_JOB_MAX_SECONDS[job] + 0.05 && (
                  <p className="mt-2 text-xs text-[#9aa0ad]">{formatMsg(m.trimWhy, { n: RECAST_JOB_MAX_SECONDS[job] })}</p>
                )}
              </div>
            )}

            {/* The motion library: every finished video of theirs, ready to be performed again. */}
            <div className="mt-4">
              <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                <p className={label}>{m.libraryLabel}</p>
                <p className="text-xs text-[#6b6f7a]">{m.libraryHint}</p>
              </div>
              {motions.length === 0 ? (
                <p className="mt-2 text-sm text-[#6b6f7a]">{m.libraryEmpty}</p>
              ) : (
                <div className="mt-2 flex gap-2.5 overflow-x-auto pb-1.5">
                  {motions.map((mo) => {
                    const on = source?.kind === "take" && source.takeId === mo.takeId;
                    return (
                      <button
                        key={mo.takeId}
                        type="button"
                        disabled={busy}
                        aria-pressed={on}
                        onClick={() => void pickMotion(mo)}
                        title={mo.title}
                        className={`group relative h-[74px] w-[124px] shrink-0 cursor-pointer overflow-hidden rounded-xl bg-[#101116] transition-shadow disabled:cursor-not-allowed disabled:opacity-40 ${
                          on ? "shadow-[0_0_0_2px_rgba(240,196,142,0.85)]" : "shadow-[inset_0_0_0_1px_rgba(255,255,255,0.1)] hover:shadow-[inset_0_0_0_1px_rgba(255,255,255,0.3)]"
                        }`}
                      >
                        {mo.posterUrl ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={mo.posterUrl} alt="" className="absolute inset-0 h-full w-full object-cover" />
                        ) : (
                          <span aria-hidden className="absolute inset-0 bg-[#14151a]" />
                        )}
                        <span className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/85 to-transparent px-2 pb-1.5 pt-4 text-left">
                          <span className="block truncate text-[11px] font-medium text-white/90">{mo.title}</span>
                          <span className="block text-[10px] tabular-nums text-white/55">{mo.seconds} s</span>
                        </span>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>

            {/* What the clip holds — the read, as chips. */}
            {source && (
              <div className={`mt-4 ${soft}`}>
                <p className={label}>{m.readLabel}</p>
                {!seen ? (
                  <p className="mt-2 text-sm text-[#9aa0ad] motion-safe:animate-pulse">{m.reading}</p>
                ) : !read ? (
                  <p className="mt-2 text-sm text-[#6b6f7a]">{m.readNoRead}</p>
                ) : (
                  <>
                    <p className="mt-1.5 text-sm text-[#ecedf1]">{read.motion}</p>
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      <span className={chip}>{read.people.length === 1 ? m.readOnePerson : formatMsg(m.readPeople, { n: read.people.length })}</span>
                      <span className={chip}>
                        {read.cuts.length === 0 ? m.readOneShot : formatMsg(m.readCuts, { at: read.cuts.map((c) => `${c}s`).join(", ") })}
                      </span>
                      {read.sound === "speech" && <span className={chip}>{m.readSpeech}</span>}
                    </div>
                    {/* Only the job that keeps the clip's own picture can keep
                        anything IN it: the other two build the frame from the
                        photo or redraw it from words, so a watch or a caption
                        in the source has nothing to survive into. */}
                    {read.keeps.length > 0 && job === "scene" && (
                      <>
                        <p className={`mt-3 ${label}`}>{m.keepsLabel}</p>
                        <div className="mt-1.5 flex flex-wrap gap-1.5">
                          {read.keeps.map((k) => {
                            const on = !dropped.has(k.what);
                            return (
                              <button
                                key={k.what}
                                type="button"
                                aria-pressed={on}
                                disabled={starting}
                                onClick={() =>
                                  setDropped((prev) => {
                                    const next = new Set(prev);
                                    if (on) next.add(k.what);
                                    else next.delete(k.what);
                                    return next;
                                  })
                                }
                                className={`${pill(on)} ${on ? "" : "line-through opacity-60"}`}
                              >
                                {on ? "✓ " : ""}
                                {k.what}
                              </button>
                            );
                          })}
                        </div>
                      </>
                    )}
                    {shownWarnings.length > 0 && (
                      <ul className="mt-3 space-y-1">
                        {shownWarnings.map((w) => (
                          <li key={w} className="text-xs text-[#d8b483]">
                            {warningText[w]}
                          </li>
                        ))}
                      </ul>
                    )}
                  </>
                )}
              </div>
            )}

            <div className="mt-4 grid gap-5 lg:grid-cols-[1.1fr_1fr]">
              <div>
                <p className={label}>{m.modeLabel}</p>
                <div className="mt-2 grid gap-2">
                  {RECAST_JOB_ORDER.map((j) => {
                    const on = job === j;
                    return (
                      <button
                        key={j}
                        type="button"
                        aria-pressed={on}
                        disabled={starting}
                        onClick={() => chooseJob(j)}
                        className={`cursor-pointer rounded-2xl p-3.5 text-left transition-shadow disabled:cursor-not-allowed disabled:opacity-45 ${
                          on
                            ? "bg-white/[0.06] shadow-[inset_0_0_0_1.5px_rgba(240,196,142,0.75)]"
                            : "bg-white/[0.03] shadow-[inset_0_0_0_1px_rgba(255,255,255,0.1)] hover:shadow-[inset_0_0_0_1px_rgba(255,255,255,0.22)]"
                        }`}
                      >
                        <span className="flex items-center justify-between gap-2">
                          <span className="text-sm font-semibold text-[#ecedf1]">{jobName(j)}</span>
                          <span className="text-[11px] tabular-nums text-[#6b6f7a]">{jobLimit(j)}</span>
                        </span>
                        <span className="mt-1 block text-xs leading-relaxed text-[#9aa0ad]">{jobLine(j)}</span>
                      </button>
                    );
                  })}
                </div>
                {motionWillInvent && (
                  <div className="mt-3 rounded-2xl bg-[#d8b483]/[0.08] p-3.5 shadow-[inset_0_0_0_1px_rgba(216,180,131,0.4)]">
                    <p className="text-sm leading-relaxed text-[#ecedf1]">{m.motionWarn}</p>
                    <button type="button" onClick={() => chooseJob("scene")} disabled={starting} className={`mt-2.5 ${ghost}`}>
                      {m.motionWarnSwitch}
                    </button>
                  </div>
                )}
                <p className={`mt-4 ${label}`}>{m.qualityLabel}</p>
                <div className="mt-2 flex flex-wrap gap-2">
                  {recastEnginesOf(job).map((e) => {
                    const spec = RECAST_ENGINES[e];
                    const q = quoteOf(e);
                    return (
                      <button
                        key={e}
                        type="button"
                        aria-pressed={e === engine}
                        disabled={starting}
                        onClick={() => setTier(spec.tier)}
                        className={pill(e === engine)}
                      >
                        {spec.tier === "full" ? m.tierFull : m.tierLite}
                        {q && <span className="ml-1.5 tabular-nums text-[#9aa0ad]">· {formatMsg(m.credits, { n: q.credits })}</span>}
                      </button>
                    );
                  })}
                </div>
              </div>

              <div>
                {needsCast && (
                  <>
                    <div className="flex flex-wrap items-baseline justify-between gap-x-4">
                      <p className={label}>{m.castLabel}</p>
                      <p className="text-xs text-[#6b6f7a]">{m.castMore}</p>
                    </div>
                    {castable.length === 0 ? (
                      <p className="mt-2 text-sm text-[#9aa0ad]">{m.noCharacters}</p>
                    ) : (
                      <div className="mt-2 flex flex-wrap gap-2">
                        {castable.map((c) => {
                          const on = castIds.includes(c.id);
                          return (
                            <button
                              key={c.id}
                              type="button"
                              aria-pressed={on}
                              disabled={starting}
                              onClick={() =>
                                setCastIds((prev) => {
                                  const next = prev.includes(c.id) ? prev.filter((x) => x !== c.id) : [...prev, c.id];
                                  if (next[0] !== prev[0]) setPhotoPath(castable.find((x) => x.id === next[0])?.photos[0]?.path ?? null);
                                  return next;
                                })
                              }
                              className={`flex cursor-pointer items-center gap-2 rounded-full py-1 pl-1 pr-3.5 text-sm font-medium transition-shadow ${
                                on
                                  ? "bg-white/[0.06] text-[#ecedf1] shadow-[inset_0_0_0_1.5px_rgba(240,196,142,0.75)]"
                                  : "text-[#c6c9d1] shadow-[inset_0_0_0_1px_rgba(255,255,255,0.12)] hover:shadow-[inset_0_0_0_1px_rgba(255,255,255,0.24)]"
                              }`}
                            >
                              {/* eslint-disable-next-line @next/next/no-img-element */}
                              <img src={c.photos[0].url} alt="" className="h-7 w-7 rounded-full object-cover" />
                              {c.name}
                            </button>
                          );
                        })}
                      </div>
                    )}
                    {cast[0] && cast[0].photos.length > 1 && (
                      <>
                        <p className={`mt-4 ${label}`}>{m.photoLabel}</p>
                        <div className="mt-2 flex flex-wrap gap-2">
                          {cast[0].photos.map((p) => {
                            const on = p.path === photo?.path;
                            return (
                              <button
                                key={p.path}
                                type="button"
                                aria-pressed={on}
                                aria-label={m.photoLabel}
                                disabled={starting}
                                onClick={() => setPhotoPath(p.path)}
                                className={`h-14 w-14 cursor-pointer overflow-hidden rounded-xl transition-shadow ${
                                  on ? "shadow-[0_0_0_2px_rgba(240,196,142,0.85)]" : "opacity-70 shadow-[0_0_0_1px_rgba(255,255,255,0.12)] hover:opacity-100"
                                }`}
                              >
                                {/* eslint-disable-next-line @next/next/no-img-element */}
                                <img src={p.url} alt="" className="h-full w-full object-cover" />
                              </button>
                            );
                          })}
                        </div>
                      </>
                    )}
                  </>
                )}
                <p className={`${needsCast ? "mt-4" : ""} ${label}`}>{needsCast ? m.directionOptional : m.directionLabel}</p>
                <textarea
                  value={direction}
                  onChange={(e) => setDirection(e.target.value.slice(0, 600))}
                  placeholder={needsCast ? m.directionPlaceholder : m.worldPlaceholder}
                  rows={needsCast ? 2 : 3}
                  disabled={starting}
                  className="mt-2 w-full resize-y rounded-xl bg-white/[0.04] px-3.5 py-2.5 text-sm text-[#ecedf1] shadow-[inset_0_0_0_1px_rgba(255,255,255,0.1)] outline-none transition-shadow placeholder:text-[#6b6f7a] focus:shadow-[inset_0_0_0_1px_rgba(240,205,166,0.6)] disabled:opacity-50"
                />
                {ready && (
                  <button type="button" onClick={() => setShowBrief((s) => !s)} className="mt-2 cursor-pointer text-xs font-medium text-[#9aa0ad] underline-offset-2 hover:underline">
                    {showBrief ? m.briefHide : m.briefShow}
                  </button>
                )}
              </div>
            </div>

            {/* The brief, word for word. Genjutsu never shows one. */}
            {ready && showBrief && (
              <div className={`mt-3 ${soft}`}>
                <pre className="max-h-64 overflow-auto whitespace-pre-wrap font-mono text-[11.5px] leading-relaxed text-[#c6c9d1]">{brief}</pre>
                <p className="mt-2 text-xs text-[#6b6f7a]">{m.briefNote}</p>
              </div>
            )}

            {lockOn && <p className="mt-4 text-xs text-[#9aa0ad]">{m.lockPromise}</p>}

            <div className="mt-3 flex flex-wrap items-center gap-3">
              <input
                ref={fileRef}
                type="file"
                accept="video/mp4,video/quicktime"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  e.target.value = "";
                  void pickFile(file);
                }}
              />
              <label className="flex min-w-0 flex-1 basis-72 cursor-pointer items-start gap-2.5 text-sm text-[#c6c9d1]">
                <input
                  type="checkbox"
                  checked={rights}
                  disabled={starting}
                  onChange={(e) => setRights(e.target.checked)}
                  className="mt-0.5 h-4 w-4 shrink-0 cursor-pointer accent-[#f0cda6]"
                />
                <span>{m.rights}</span>
              </label>
              {source && (
                <button type="button" onClick={() => fileRef.current?.click()} disabled={busy} className={ghost}>
                  {m.change}
                </button>
              )}
              <button
                type="button"
                onClick={() => void take()}
                disabled={!canTake}
                className="cursor-pointer rounded-xl bg-[#ecedf1] px-5 py-2.5 text-sm font-semibold tabular-nums text-[#16171c] transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
              >
                {buttonLabel}
              </button>
            </div>
          </>
        )}
        {error && <p className="mt-3 text-sm text-[#dc8290]">{localizeServerText(error, t)}</p>}

        {/* Your takes: ordinary renders, so History and Videos list them too. */}
        <div className="mt-7">
          <p className={label}>{m.takesLabel}</p>
          {takes.length === 0 ? (
            <p className="mt-3 text-sm text-[#6b6f7a]">{m.empty}</p>
          ) : (
            <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
              {takes.map((x) => {
                const missed = x.recipe?.lock === true && x.score !== null && x.score < 60;
                const meta =
                  x.status === "generating"
                    ? m.rendering
                    : x.status === "failed"
                      ? m.failed
                      : missed
                        ? m.lockMissed
                        : [
                            x.seconds !== null && x.credits !== null ? formatMsg(m.takeMeta, { seconds: x.seconds, credits: x.credits }) : null,
                            x.score !== null ? formatMsg(m.lockScore, { n: Math.round(x.score) }) : null,
                          ]
                            .filter(Boolean)
                            .join(" · ");
                const jobWord = x.engine ? jobName(RECAST_ENGINES[x.engine].job) : "";
                const card = (
                  <div className="overflow-hidden rounded-2xl bg-[#14151a] text-left shadow-[inset_0_0_0_1px_rgba(255,255,255,0.08)] transition-shadow group-hover:shadow-[inset_0_0_0_1px_rgba(240,205,166,0.5)]">
                    <div className="relative aspect-[16/9] bg-[#101116]">
                      {x.posterUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={x.posterUrl} alt="" className="absolute inset-0 h-full w-full object-cover" />
                      ) : (
                        <div
                          aria-hidden
                          className={`absolute inset-0 opacity-30 [background-image:linear-gradient(to_right,rgba(255,255,255,0.07)_1px,transparent_1px),linear-gradient(to_bottom,rgba(255,255,255,0.07)_1px,transparent_1px)] [background-size:24px_24px] ${
                            x.status === "generating" ? "motion-safe:animate-pulse" : ""
                          }`}
                        />
                      )}
                    </div>
                    <div className="px-3 py-2.5">
                      <p className="truncate text-[13px] font-semibold text-[#ecedf1]">{[x.characterName, jobWord].filter(Boolean).join(" · ") || m.theTake}</p>
                      <p className={`mt-0.5 truncate text-[11px] tabular-nums ${missed ? "text-[#d8b483]" : "text-[#6b6f7a]"}`}>{meta}</p>
                    </div>
                  </div>
                );
                if (x.status === "succeeded") {
                  return (
                    <button key={x.id} type="button" aria-label={m.watch} onClick={() => void watch(x)} className="group cursor-pointer">
                      {card}
                    </button>
                  );
                }
                return x.status === "failed" ? (
                  <Link key={x.id} href={`/app/history/${x.id}`} className="group">
                    {card}
                  </Link>
                ) : (
                  <div key={x.id} className="group">
                    {card}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
