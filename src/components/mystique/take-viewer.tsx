"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { useLocale } from "@/lib/i18n/provider";
import type { RecastJob } from "@/lib/recast/recast";

// The before/after viewer. Two films, one clock: the TAKE is the master
// (it carries the sound and the loop); the person's own clip follows it,
// muted, and is pulled back whenever it drifts.
//
//   scene   the take stands in the clip's own frame, so the two are laid
//           over each other and a line wipes between them — the clip left
//           of the line, the take right of it.
//   motion  the take wears the PHOTO's frame, not the clip's; a wipe would
//           compare two unrelated pictures, so they sit side by side.
//
// A take whose clip is no longer stored plays alone, and says so.

const DRIFT_S = 0.2;
const chip = "rounded-full border border-white/10 bg-black/60 px-3 py-[5px] text-xs font-medium text-white/90";

export function TakeViewer({
  job,
  resultUrl,
  sourceUrl,
  title,
  historyHref,
  canReuse,
  onReuse,
  onClose,
}: {
  job: RecastJob;
  resultUrl: string;
  sourceUrl: string | null;
  title: string;
  historyHref: string;
  /** This take remembers how it was made, so it can be run again. */
  canReuse: boolean;
  onReuse: () => void;
  onClose: () => void;
}) {
  const { t } = useLocale();
  const m = t.mystique;
  const takeRef = useRef<HTMLVideoElement | null>(null);
  const clipRef = useRef<HTMLVideoElement | null>(null);
  const stageRef = useRef<HTMLDivElement | null>(null);
  const [playing, setPlaying] = useState(false);
  const [muted, setMuted] = useState(false);
  const [split, setSplit] = useState(50);
  const [aspect, setAspect] = useState<number | null>(null);
  // Only the job that keeps the clip's own frame can be wiped between: the
  // others hand back a different picture, and a wipe would be comparing two
  // unrelated ones.
  const wipe = job === "scene" && sourceUrl !== null;

  function follow() {
    const take = takeRef.current;
    const clip = clipRef.current;
    if (!take || !clip) return;
    if (Math.abs(clip.currentTime - take.currentTime) > DRIFT_S) clip.currentTime = take.currentTime;
    if (take.paused !== clip.paused) {
      if (take.paused) clip.pause();
      else void clip.play().catch(() => {});
    }
  }

  async function start() {
    const take = takeRef.current;
    if (!take) return;
    try {
      await take.play();
    } catch {
      // Sound refused without a gesture: play silent rather than not at all.
      take.muted = true;
      setMuted(true);
      await take.play().catch(() => {});
    }
  }

  function toggle() {
    const take = takeRef.current;
    if (!take) return;
    if (take.paused) void start();
    else take.pause();
  }

  function moveTo(clientX: number) {
    const box = stageRef.current?.getBoundingClientRect();
    if (!box || box.width === 0) return;
    setSplit(Math.min(100, Math.max(0, ((clientX - box.left) / box.width) * 100)));
  }

  // The take's own shape sizes the stage, and knowing it starts the film.
  // Asked of the element as well as the event: a video can have its
  // metadata before React is listening (a cached file, a server-drawn
  // page), and then the event never comes.
  const begun = useRef(false);
  function begin(v: HTMLVideoElement) {
    if (begun.current || !v.videoWidth || !v.videoHeight) return;
    begun.current = true;
    setAspect(v.videoWidth / v.videoHeight);
    void start();
  }

  const takeVideo = (
    <video
      ref={(el) => {
        takeRef.current = el;
        if (el && el.readyState >= 1) begin(el);
      }}
      src={resultUrl}
      loop
      playsInline
      muted={muted}
      onLoadedMetadata={(e) => begin(e.currentTarget)}
      onPlay={() => {
        setPlaying(true);
        follow();
      }}
      onPause={() => {
        setPlaying(false);
        follow();
      }}
      onSeeked={follow}
      onTimeUpdate={follow}
      className={wipe ? "absolute inset-0 h-full w-full object-contain" : "h-full max-h-[70vh] w-full object-contain"}
    />
  );
  const clipVideo = sourceUrl ? (
    <video
      ref={clipRef}
      src={sourceUrl}
      muted
      loop
      playsInline
      onLoadedMetadata={follow}
      className={wipe ? "absolute inset-0 h-full w-full object-contain" : "h-full max-h-[70vh] w-full object-contain"}
    />
  ) : null;

  const button =
    "cursor-pointer rounded-xl px-3.5 py-2 text-sm font-medium text-[#ecedf1] shadow-[inset_0_0_0_1px_rgba(255,255,255,0.14)] transition-colors hover:bg-white/[0.05]";

  return (
    <div>
      {wipe ? (
        <div
          ref={stageRef}
          data-take-wipe
          onPointerDown={(e) => {
            e.currentTarget.setPointerCapture(e.pointerId);
            moveTo(e.clientX);
          }}
          onPointerMove={(e) => {
            if (e.currentTarget.hasPointerCapture(e.pointerId)) moveTo(e.clientX);
          }}
          className="relative mx-auto max-h-[70vh] w-full cursor-ew-resize touch-none select-none overflow-hidden rounded-2xl bg-black ring-1 ring-white/10"
          style={{ aspectRatio: aspect ?? 16 / 9, maxWidth: aspect ? `calc(70vh * ${aspect})` : undefined }}
        >
          {takeVideo}
          {/* The clip lies over the take and is cut away right of the line. */}
          <div className="absolute inset-0" style={{ clipPath: `inset(0 ${100 - split}% 0 0)` }}>
            {clipVideo}
          </div>
          <span className={`pointer-events-none absolute left-3 top-3 ${chip}`}>{m.yourClip}</span>
          <span className={`pointer-events-none absolute right-3 top-3 ${chip} border-transparent text-[#f0cda6] shadow-[inset_0_0_0_1.5px_rgba(240,196,142,0.75)]`}>
            {title}
          </span>
          <div
            role="slider"
            tabIndex={0}
            aria-label={m.wipeHandle}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(split)}
            onKeyDown={(e) => {
              if (e.key === "ArrowLeft") setSplit((s) => Math.max(0, s - 4));
              if (e.key === "ArrowRight") setSplit((s) => Math.min(100, s + 4));
            }}
            // A dark hairline under the glow: the line must read on a white room too.
            className="absolute inset-y-0 w-[2px] -translate-x-1/2 bg-[#f0cda6] shadow-[0_0_0_1px_rgba(0,0,0,0.35),0_0_18px_2px_rgba(240,196,142,0.55)] outline-none"
            style={{ left: `${split}%` }}
          >
            <span className="absolute left-1/2 top-1/2 flex h-9 w-9 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-[#f0cda6] text-[#16171c] shadow-[0_4px_18px_rgba(0,0,0,0.5)]">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-4 w-4" aria-hidden>
                <path d="m9 7-5 5 5 5M15 7l5 5-5 5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </span>
          </div>
        </div>
      ) : (
        <div className={`grid items-center gap-3 ${clipVideo ? "sm:grid-cols-2" : ""}`}>
          {clipVideo && (
            <div className="relative overflow-hidden rounded-2xl bg-black ring-1 ring-white/10">
              {clipVideo}
              <span className={`pointer-events-none absolute left-3 top-3 ${chip}`}>{m.yourClip}</span>
            </div>
          )}
          <div className="relative overflow-hidden rounded-2xl bg-black ring-1 ring-white/10">
            {takeVideo}
            <span className={`pointer-events-none absolute right-3 top-3 ${chip} border-transparent text-[#f0cda6] shadow-[inset_0_0_0_1.5px_rgba(240,196,142,0.75)]`}>
              {title}
            </span>
          </div>
        </div>
      )}

      <div className="mt-4 flex flex-wrap items-center gap-2.5">
        <button type="button" onClick={toggle} className={button}>
          {playing ? m.pause : m.play}
        </button>
        <button
          type="button"
          onClick={() => {
            const next = !muted;
            setMuted(next);
            if (takeRef.current) takeRef.current.muted = next;
          }}
          className={button}
          aria-pressed={!muted}
        >
          {muted ? m.soundOff : m.soundOn}
        </button>
        <p className="min-w-0 flex-1 basis-48 text-xs text-[#6b6f7a]">{sourceUrl === null ? m.sourceGone : wipe ? m.wipeHint : ""}</p>
        {canReuse && (
          <button type="button" onClick={onReuse} className={button}>
            {m.recreate}
          </button>
        )}
        <a href={resultUrl} download className={button}>
          {m.download}
        </a>
        <Link href={historyHref} className={button}>
          {m.history}
        </Link>
        <button type="button" onClick={onClose} className="cursor-pointer rounded-xl bg-[#ecedf1] px-4 py-2 text-sm font-semibold text-[#16171c] transition-opacity hover:opacity-90">
          {m.close}
        </button>
      </div>
    </div>
  );
}
