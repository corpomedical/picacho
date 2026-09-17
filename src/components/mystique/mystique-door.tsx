"use client";

import { useEffect, useRef, useState } from "react";
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
  inspectRecastUpload,
  reserveRecastUpload,
  startRecastTake,
  type RecastQuote,
} from "@/lib/recast/actions";
import type { RecastCharacter, RecastTake } from "@/lib/recast/data";
import { RECAST_CLIP_TOO_BIG, RECAST_NOT_A_VIDEO, RECAST_UPLOAD_UNREADABLE } from "@/lib/recast/messages";
import {
  RECAST_BUCKET,
  RECAST_ENGINES,
  RECAST_MAX_BYTES,
  RECAST_MODE_ORDER,
  recastContainerOf,
  recastEnginesOf,
  type RecastEngine,
  type RecastMode,
} from "@/lib/recast/recast";
import { TakeViewer } from "@/components/mystique/take-viewer";

// The Mystique door (working title): the theatre again, doing the job it
// suits best. The person's clip plays on the left, who will perform it
// stands on the right, the scan line between — and a finished take opens
// in the same screen as a before/after.
//
// NO MACHINERY ON THE WALL: t.mystique names no engine and no model. The
// two jobs are said as what happens ("Into the clip" / "Photo to life"),
// their two engines as Full / Lighter, each with its price read from the
// uploaded file itself (inspectRecastUpload) — never from the browser's
// guess, so the number on the button is the number charged.
//
// The clip UPLOADS here (unlike the Recce): the engine needs the footage.
// Browser → storage directly, the upscaler's shape; the server reads the
// file again before any money moves.

type Clip =
  | { phase: "uploading" | "inspecting"; url: string; path: string | null }
  | { phase: "ready"; url: string; path: string; seconds: number; width: number; height: number; quotes: RecastQuote[] };

type Viewing = { take: RecastTake; media: { resultUrl: string; sourceUrl: string | null } | null };

const chip = "inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-black/60 px-3 py-[5px] text-xs font-medium text-white/90";
const label = "text-[10.5px] font-semibold uppercase tracking-[0.14em] text-[#6b6f7a]";

export function MystiqueDoor({ characters, initialTakes }: { characters: RecastCharacter[]; initialTakes: RecastTake[] }) {
  const { t } = useLocale();
  const m = t.mystique;
  const router = useRouter();

  const castable = characters.filter((c) => c.photos.length > 0);
  const [takes, setTakes] = useState(initialTakes);
  const [seenInitial, setSeenInitial] = useState(initialTakes);
  const [clip, setClip] = useState<Clip | null>(null);
  const [mode, setMode] = useState<RecastMode>("scene");
  const [tier, setTier] = useState<"full" | "lite">("full");
  const [characterId, setCharacterId] = useState<string | null>(castable[0]?.id ?? null);
  const [photoPath, setPhotoPath] = useState<string | null>(castable[0]?.photos[0]?.path ?? null);
  const [rights, setRights] = useState(false);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState("");
  const [dragOver, setDragOver] = useState(false);
  const [viewing, setViewing] = useState<Viewing | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);
  // The newest pick wins: an upload or a read that lands late is dropped.
  const pickRef = useRef(0);

  // A refresh brings the server's truth; adjusted during render so the
  // stale list never paints first (the Recce door's pattern).
  if (initialTakes !== seenInitial) {
    setSeenInitial(initialTakes);
    setTakes(initialTakes);
  }

  // Every rendering take is polled — the poll is also what collects it
  // where no webhook can reach (local development). Keyed on the ids, so a
  // refresh that changes nothing restarts nothing.
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
    // A poll that gave up must not leave the card spinning forever.
    const slow = setInterval(() => router.refresh(), 30_000);
    return () => {
      ctrl.abort();
      clearInterval(slow);
    };
  }, [renderingKey, router]);

  const character = castable.find((c) => c.id === characterId) ?? null;
  const photo = character?.photos.find((p) => p.path === photoPath) ?? character?.photos[0] ?? null;
  const ready = clip?.phase === "ready" ? clip : null;
  const quoteOf = (engine: RecastEngine) => ready?.quotes.find((q) => q.engine === engine) ?? null;
  const modeFits = (md: RecastMode) => !ready || recastEnginesOf(md).some((e) => quoteOf(e)?.fits);
  const engine = recastEnginesOf(mode).find((e) => RECAST_ENGINES[e].tier === tier) ?? recastEnginesOf(mode)[0];
  const quote = quoteOf(engine);
  const busy = starting || (clip !== null && clip.phase !== "ready");

  // The local preview's object URL: released when the clip changes or the page goes.
  const urlRef = useRef<string | null>(null);
  function dropClip(next: Clip | null) {
    if (urlRef.current && urlRef.current !== next?.url) URL.revokeObjectURL(urlRef.current);
    urlRef.current = next?.url ?? null;
    setClip(next);
  }
  useEffect(
    () => () => {
      if (urlRef.current) URL.revokeObjectURL(urlRef.current);
    },
    [],
  );

  async function pickClip(file: File | undefined) {
    if (!file || starting) return;
    setError("");
    // The tick is about one clip; a new clip asks again.
    setRights(false);
    const mine = ++pickRef.current;
    // The clip being replaced never became a take: it goes.
    if (clip?.path) void discardRecastUpload(clip.path).catch(() => {});
    if (!recastContainerOf(file.type)) {
      dropClip(null);
      setError(RECAST_NOT_A_VIDEO);
      return;
    }
    if (file.size > RECAST_MAX_BYTES) {
      dropClip(null);
      setError(RECAST_CLIP_TOO_BIG);
      return;
    }
    const url = URL.createObjectURL(file);
    dropClip({ phase: "uploading", url, path: null });
    const fail = (message: string) => {
      if (mine !== pickRef.current) return;
      dropClip(null);
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
      dropClip({ phase: "inspecting", url, path: reserved.path });
      const seen = await inspectRecastUpload(reserved.path);
      if (mine !== pickRef.current) return;
      if (seen.error !== null) return fail(seen.error);
      dropClip({ phase: "ready", url, path: reserved.path, seconds: seen.seconds, width: seen.width, height: seen.height, quotes: seen.quotes });
      // A clip too long for the clip's own world still suits the photo's.
      const sceneFits = seen.quotes.some((q) => RECAST_ENGINES[q.engine].mode === "scene" && q.fits);
      if (!sceneFits) setMode("motion");
    } catch (err) {
      const stale = isStaleDeployError(err);
      fail(stale ? t.generate.refreshNeeded : t.generate.submitFailed);
      if (stale) reloadForNewDeploy({ delayMs: 1800 });
    }
  }

  async function take() {
    if (!ready || !character || !photo || !rights || starting || !quote?.fits) return;
    setError("");
    setStarting(true);
    let res: Awaited<ReturnType<typeof startRecastTake>>;
    try {
      res = await startRecastTake({ path: ready.path, characterId: character.id, photoPath: photo.path, engine, rights });
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
    setTakes((prev) => [
      {
        id: res.id,
        status: "generating",
        characterName: character.name,
        engine,
        seconds: Math.round(ready.seconds),
        credits: quote.credits,
        score: null,
        posterUrl: null,
        createdAt: new Date().toISOString(),
      },
      ...prev,
    ]);
    // The clip now belongs to the take; the door is ready for the next.
    pickRef.current++;
    dropClip(null);
    setRights(false);
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

  const takeLabel = !quote ? m.takeButton : quote.credits === 1 ? m.takeButtonOne : formatMsg(m.takeButtonPriced, { n: quote.credits });

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
                mode={viewing.take.engine ? RECAST_ENGINES[viewing.take.engine].mode : "motion"}
                resultUrl={viewing.media.resultUrl}
                sourceUrl={viewing.media.sourceUrl}
                title={viewing.take.characterName ?? m.theTake}
                historyHref={`/app/history/${viewing.take.id}`}
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
            {/* The screen: the clip left, who performs it right, the scan line between. */}
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
                    void pickClip(e.dataTransfer.files?.[0]);
                  }}
                  className={`relative min-h-[300px] cursor-pointer bg-[#101116] outline-none transition-shadow md:min-h-[380px] ${
                    dragOver ? "shadow-[inset_0_0_0_2px_#e0a468]" : "focus-visible:shadow-[inset_0_0_0_2px_rgba(240,205,166,0.6)]"
                  }`}
                >
                  {clip ? (
                    <>
                      <video src={clip.url} muted loop autoPlay playsInline className="absolute inset-0 h-full w-full object-contain" />
                      <span className={`absolute left-3.5 top-3 ${chip} tabular-nums`}>
                        {m.yourClip}
                        {ready ? ` · ${formatMsg(m.clipMeta, { seconds: ready.seconds, width: ready.width, height: ready.height })}` : ""}
                      </span>
                      {!ready && (
                        <span className={`absolute bottom-3 left-3.5 ${chip} motion-safe:animate-pulse`}>
                          {clip.phase === "uploading" ? m.uploading : m.inspecting}
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
                <div className="relative min-h-[240px] bg-[#0e0f14] md:min-h-[380px]">
                  {photo ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={photo.url} alt={character?.name ?? ""} className="absolute inset-0 h-full w-full object-contain" />
                  ) : (
                    <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 p-6 text-center">
                      <p className="max-w-xs text-sm text-[#9aa0ad]">{m.noCharacters}</p>
                      <Link href="/app/character/new" className="rounded-xl bg-[#ecedf1] px-4 py-2 text-sm font-semibold text-[#16171c]">
                        {m.createCharacter}
                      </Link>
                    </div>
                  )}
                  <span className={`absolute right-3.5 top-3 ${chip} border-transparent text-[#f0cda6] shadow-[inset_0_0_0_1.5px_rgba(240,196,142,0.75)]`}>
                    {character ? `${m.theTake} · ${character.name}` : m.theTake}
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

            {/* What should happen: the two jobs, said as what happens. */}
            <div className="mt-5 grid gap-5 lg:grid-cols-[1.15fr_1fr]">
              <div>
                <p className={label}>{m.modeLabel}</p>
                <div className="mt-2 grid gap-2 sm:grid-cols-2">
                  {RECAST_MODE_ORDER.map((md) => {
                    const fits = modeFits(md);
                    const on = mode === md;
                    return (
                      <button
                        key={md}
                        type="button"
                        aria-pressed={on}
                        disabled={!fits || starting}
                        onClick={() => setMode(md)}
                        className={`cursor-pointer rounded-2xl p-3.5 text-left transition-shadow disabled:cursor-not-allowed disabled:opacity-45 ${
                          on
                            ? "bg-white/[0.06] shadow-[inset_0_0_0_1.5px_rgba(240,196,142,0.75)]"
                            : "bg-white/[0.03] shadow-[inset_0_0_0_1px_rgba(255,255,255,0.1)] hover:shadow-[inset_0_0_0_1px_rgba(255,255,255,0.22)]"
                        }`}
                      >
                        <span className="flex items-center justify-between gap-2">
                          <span className="text-sm font-semibold text-[#ecedf1]">{md === "scene" ? m.modeScene : m.modeMotion}</span>
                          {md === "scene" && <span className="text-[11px] tabular-nums text-[#6b6f7a]">{m.sceneLimit}</span>}
                        </span>
                        <span className="mt-1 block text-xs leading-relaxed text-[#9aa0ad]">{md === "scene" ? m.modeSceneLine : m.modeMotionLine}</span>
                      </button>
                    );
                  })}
                </div>
                <p className={`mt-4 ${label}`}>{m.qualityLabel}</p>
                <div className="mt-2 flex flex-wrap gap-2">
                  {recastEnginesOf(mode).map((e) => {
                    const spec = RECAST_ENGINES[e];
                    const q = quoteOf(e);
                    const on = e === engine;
                    return (
                      <button
                        key={e}
                        type="button"
                        aria-pressed={on}
                        disabled={starting || (q !== null && !q.fits)}
                        onClick={() => setTier(spec.tier)}
                        className={`cursor-pointer rounded-full px-3.5 py-1.5 text-sm font-medium transition-shadow disabled:cursor-not-allowed disabled:opacity-45 ${
                          on
                            ? "bg-white/[0.06] text-[#ecedf1] shadow-[inset_0_0_0_1.5px_rgba(240,196,142,0.75)]"
                            : "text-[#c6c9d1] shadow-[inset_0_0_0_1px_rgba(255,255,255,0.12)] hover:shadow-[inset_0_0_0_1px_rgba(255,255,255,0.24)]"
                        }`}
                      >
                        {spec.tier === "full" ? m.tierFull : m.tierLite}
                        {q && <span className="ml-1.5 tabular-nums text-[#9aa0ad]">· {formatMsg(m.credits, { n: q.credits })}</span>}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Who performs it, and — where the photo is the frame — which photo. */}
              <div>
                <p className={label}>{m.castLabel}</p>
                {castable.length === 0 ? (
                  <p className="mt-2 text-sm text-[#9aa0ad]">{m.noCharacters}</p>
                ) : (
                  <div className="mt-2 flex flex-wrap gap-2">
                    {castable.map((c) => {
                      const on = c.id === character?.id;
                      return (
                        <button
                          key={c.id}
                          type="button"
                          aria-pressed={on}
                          disabled={starting}
                          onClick={() => {
                            setCharacterId(c.id);
                            setPhotoPath(c.photos[0]?.path ?? null);
                          }}
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
                {character && character.photos.length > 1 && (
                  <>
                    <p className={`mt-4 ${label}`}>{m.photoLabel}</p>
                    <div className="mt-2 flex flex-wrap gap-2">
                      {character.photos.map((p) => {
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
              </div>
            </div>

            {/* The tick, and the one button. */}
            <div className="mt-5 flex flex-wrap items-center gap-3">
              <input
                ref={fileRef}
                type="file"
                accept="video/mp4,video/quicktime"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  // Cleared, so choosing the same file again still counts as a choice.
                  e.target.value = "";
                  void pickClip(file);
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
              {clip && (
                <button
                  type="button"
                  onClick={() => fileRef.current?.click()}
                  disabled={busy}
                  className="cursor-pointer rounded-xl px-3.5 py-2.5 text-sm font-medium text-[#ecedf1] shadow-[inset_0_0_0_1px_rgba(255,255,255,0.14)] transition-colors hover:bg-white/[0.05] disabled:opacity-40"
                >
                  {m.change}
                </button>
              )}
              <button
                type="button"
                onClick={() => void take()}
                disabled={!ready || !character || !rights || starting || !quote?.fits}
                className="cursor-pointer rounded-xl bg-[#ecedf1] px-5 py-2.5 text-sm font-semibold tabular-nums text-[#16171c] transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
              >
                {starting ? m.starting : takeLabel}
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
                const meta =
                  x.status === "generating"
                    ? m.rendering
                    : x.status === "failed"
                      ? m.failed
                      : [
                          x.seconds !== null && x.credits !== null ? formatMsg(m.takeMeta, { seconds: x.seconds, credits: x.credits }) : null,
                          x.score !== null ? formatMsg(m.score, { n: Math.round(x.score) }) : null,
                        ]
                          .filter(Boolean)
                          .join(" · ");
                const modeName = x.engine ? (RECAST_ENGINES[x.engine].mode === "scene" ? m.modeScene : m.modeMotion) : "";
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
                      <p className="truncate text-[13px] font-semibold text-[#ecedf1]">{[x.characterName, modeName].filter(Boolean).join(" · ") || m.theTake}</p>
                      <p className="mt-0.5 truncate text-[11px] tabular-nums text-[#6b6f7a]">{meta}</p>
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
