"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useLocale } from "@/lib/i18n/provider";
import { localizeServerText } from "@/lib/i18n/server-text";
import { formatMsg } from "@/lib/i18n/format";
import { isStaleDeployError, reloadForNewDeploy } from "@/lib/stale-deploy";
import { pollSetBuild } from "@/lib/sets/actions";
import { submitSetRecceBuild } from "@/lib/sets/recce-actions";
import { prepareClip, type PreparedClip } from "@/lib/sets/recce-client";
import { SET_PHOTO_NOTES_MAX_CHARS } from "@/lib/sets/set-config";
import type { SetSummary } from "@/lib/sets/types";

// The theatre (board K door A): the reading is the hero. One screen —
// footage on the left, the place it becomes on the right, the scan line
// between. At rest the right half shows a real read of ours (the salon
// plan, public/recce-plan.svg, drawn from the spec the palace clip came
// back as), so the door demonstrates itself before a clip lands.
//
// NO MACHINERY ON THE WALL: this page never says set, build or Astra —
// t.recce holds its words. A read IS a set underneath, so a finished card
// opens the studio at /app/sets/<id>, and the server treats the build,
// the retry, the finisher and the delete exactly as Helios does.
//
// The clip never leaves the device (recce-client.ts samples the frames);
// the frames travel as one string (the action codec refuses a large
// array of large strings).

const POLL_MS = 5000;

export type RecceReadCard = SetSummary & { seconds: number };

export function RecceDoor({ initialReads, finisherOn }: { initialReads: RecceReadCard[]; finisherOn: boolean }) {
  const { t } = useLocale();
  const r = t.recce;
  const router = useRouter();

  const [reads, setReads] = useState(initialReads);
  const [seenInitial, setSeenInitial] = useState(initialReads);
  const [clip, setClip] = useState<PreparedClip | null>(null);
  const [preparing, setPreparing] = useState(false);
  const [starting, setStarting] = useState(false);
  const [notes, setNotes] = useState("");
  const [error, setError] = useState("");
  const [dragOver, setDragOver] = useState(false);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // A refresh brings the server's truth (titles, thumbnails); adjusted
  // during render so the stale list never paints first (sets-home.tsx).
  if (initialReads !== seenInitial) {
    setSeenInitial(initialReads);
    setReads(initialReads);
  }

  // One tick for the oldest building read; the server settles it and a
  // refresh redraws every card. The finisher covers a closed page.
  useEffect(() => {
    const building = reads.find((x) => x.status === "building");
    if (!building) return;
    let alive = true;
    const tick = async () => {
      try {
        const res = await pollSetBuild(building.id);
        if (!alive) return;
        // An access error means nothing here can be collected any more.
        if (res.error !== null) return;
        if (res.state !== "building") {
          router.refresh();
          return;
        }
      } catch {
        // The wire; the next tick answers.
      }
      if (alive) timerRef.current = setTimeout(() => void tick(), POLL_MS);
    };
    timerRef.current = setTimeout(() => void tick(), POLL_MS);
    return () => {
      alive = false;
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [reads, router]);

  async function pickClip(file: File | undefined) {
    if (!file) return;
    setError("");
    setClip(null);
    setPreparing(true);
    try {
      const res = await prepareClip(file);
      if (res.ok) setClip(res.clip);
      else setError(res.error);
    } finally {
      setPreparing(false);
    }
  }

  async function read() {
    if (starting || preparing || !clip) return;
    setError("");
    setStarting(true);
    let res: Awaited<ReturnType<typeof submitSetRecceBuild>>;
    try {
      res = await submitSetRecceBuild({ frames: clip.frames.join("\n"), seconds: clip.seconds, notes });
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
    setReads((prev) => [
      {
        id: res.id,
        title: "",
        brief: notes.trim(),
        status: "building",
        createdAt: new Date().toISOString(),
        thumbUrl: null,
        failure: null,
        fromPhoto: true,
        shots: 0,
        lastShotAt: null,
        seconds: clip.seconds,
      },
      ...prev,
    ]);
    setClip(null);
    setNotes("");
    router.refresh();
  }

  const chip = "inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-black/60 px-3 py-[5px] text-xs font-medium text-white/90";

  return (
    <div className="mx-auto max-w-6xl">
      <div className="rounded-[28px] bg-[#0b0c10] px-6 pb-6 pt-7 text-[#c6c9d1] shadow-[0_0_0_1px_rgba(255,255,255,0.08),0_32px_72px_-28px_rgba(0,0,0,0.7)] sm:px-8">
        {/* The promise, and the honest lines beside it. */}
        <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-2">
          <div>
            <h1 className="font-display text-3xl font-semibold tracking-tight text-[#ecedf1]">{r.headline}</h1>
            <p className="mt-2 max-w-xl text-sm text-[#9aa0ad]">{r.sub}</p>
          </div>
          <div className="space-y-0.5 text-right text-xs text-[#6b6f7a]">
            <p>{r.priceLine}</p>
            <p>{finisherOn ? r.metaFinishes : r.meta}</p>
          </div>
        </div>

        {/* The screen: footage left, the place right, the scan line between. */}
        <div className="relative mt-5 overflow-hidden rounded-2xl ring-1 ring-white/10">
          <div className="grid md:grid-cols-[57%_43%]">
            <div
              role="button"
              tabIndex={0}
              aria-label={r.dropTitle}
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
              className={`relative min-h-[280px] cursor-pointer bg-[#101116] outline-none transition-shadow md:min-h-[340px] ${
                dragOver ? "shadow-[inset_0_0_0_2px_#e0a468]" : "focus-visible:shadow-[inset_0_0_0_2px_rgba(240,205,166,0.6)]"
              }`}
            >
              {clip ? (
                <>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={clip.frames[0]} alt={r.yourClip} className="absolute inset-0 h-full w-full object-cover" />
                  <span className={`absolute left-3.5 top-3 ${chip} tabular-nums`}>
                    {r.yourClip} · {formatMsg(t.sets.clipMeta, { n: clip.frames.length, seconds: clip.seconds })}
                  </span>
                </>
              ) : (
                <div className="absolute inset-0 flex flex-col items-center justify-center gap-2.5 p-6 text-center">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="h-7 w-7 text-[#6b6f7a]" aria-hidden>
                    <rect x="3" y="5" width="18" height="14" rx="3" />
                    <path d="M10 9.5 15 12l-5 2.5z" fill="currentColor" stroke="none" />
                  </svg>
                  <p className="text-sm font-semibold text-[#ecedf1]">{preparing ? t.sets.clipPreparing : r.dropTitle}</p>
                  {!preparing && (
                    <>
                      <p className="text-xs text-[#6b6f7a]">{r.dropOr}</p>
                      <span className="rounded-xl px-3.5 py-1.5 text-sm font-medium text-[#ecedf1] shadow-[inset_0_0_0_1px_rgba(255,255,255,0.16)]">
                        {t.sets.clipPick}
                      </span>
                    </>
                  )}
                </div>
              )}
              {/* What the reading finds: the demo's findings at rest, the clip's own count once one lands. */}
              <div className="absolute bottom-3 left-3.5 flex max-w-[85%] flex-wrap gap-1.5">
                {clip ? (
                  <span className={chip}>{r.privacyLine}</span>
                ) : (
                  <>
                    <span className={chip}>{r.demoChipPlace}</span>
                    <span className={chip}>{r.demoChipPerson}</span>
                    <span className={chip}>{r.demoChipCamera}</span>
                  </>
                )}
              </div>
            </div>
            <div className="relative hidden bg-[#0e0f14] md:block">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/recce-plan.svg" alt={r.demoLabel} className="absolute inset-x-4 bottom-12 top-4 mx-auto h-[calc(100%-4rem)] w-auto" />
              <span className={`absolute right-3.5 top-3 ${chip} border-transparent text-[#f0cda6] shadow-[inset_0_0_0_1.5px_rgba(240,196,142,0.75)]`}>
                {r.demoLabel}
              </span>
              <span className="absolute bottom-3 right-3.5 text-[11px] tabular-nums text-[#6b6f7a]">{r.demoStatus}</span>
            </div>
          </div>
          {/* The scan line; it breathes while a read is being sent. */}
          <div
            aria-hidden
            className={`absolute inset-y-0 left-[57%] hidden w-[2px] bg-gradient-to-b from-transparent via-[#f0cda6] to-transparent shadow-[0_0_18px_2px_rgba(240,196,142,0.55)] md:block ${
              starting ? "motion-safe:animate-pulse" : ""
            }`}
          />
        </div>

        {/* The words, and the one button. */}
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <input
            ref={fileRef}
            type="file"
            accept="video/mp4,video/quicktime,video/webm"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              // Cleared, so choosing the same file again still counts as a choice.
              e.target.value = "";
              void pickClip(file);
            }}
          />
          <label className="min-w-0 flex-1 basis-64">
            <span className="sr-only">{r.notesLabel}</span>
            <input
              value={notes}
              onChange={(e) => setNotes(e.target.value.slice(0, SET_PHOTO_NOTES_MAX_CHARS))}
              placeholder={r.notesLabel}
              disabled={starting}
              className="w-full rounded-xl bg-white/[0.04] px-3.5 py-2.5 text-sm text-[#ecedf1] shadow-[inset_0_0_0_1px_rgba(255,255,255,0.1)] outline-none transition-shadow placeholder:text-[#6b6f7a] focus:shadow-[inset_0_0_0_1px_rgba(240,205,166,0.6)] disabled:opacity-50"
            />
          </label>
          {clip && (
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              disabled={preparing || starting}
              className="cursor-pointer rounded-xl px-3.5 py-2.5 text-sm font-medium text-[#ecedf1] shadow-[inset_0_0_0_1px_rgba(255,255,255,0.14)] transition-colors hover:bg-white/[0.05] disabled:opacity-40"
            >
              {t.sets.clipChange}
            </button>
          )}
          <button
            type="button"
            onClick={() => void read()}
            disabled={!clip || preparing || starting}
            className="cursor-pointer rounded-xl bg-[#ecedf1] px-5 py-2.5 text-sm font-semibold text-[#16171c] transition-opacity hover:opacity-90 disabled:opacity-40"
          >
            {starting ? t.sets.clipChecking : r.readButton}
          </button>
        </div>
        {error && <p className="mt-3 text-sm text-[#dc8290]">{localizeServerText(error, t)}</p>}

        {/* Your reads: the same rows the studio lists, filtered to reads. */}
        <div className="mt-7">
          <p className="text-[10.5px] font-semibold uppercase tracking-[0.14em] text-[#6b6f7a]">{r.readsLabel}</p>
          {reads.length === 0 ? (
            <p className="mt-3 text-sm text-[#6b6f7a]">{r.empty}</p>
          ) : (
            <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
              {reads.map((x) => {
                const meta =
                  x.status === "building"
                    ? r.readingNow
                    : x.status === "failed"
                      ? x.failure
                        ? localizeServerText(x.failure, t)
                        : t.sets.statusFailed
                      : `${formatMsg(r.readMeta, { seconds: x.seconds })} · ${formatMsg(t.sets.statsStills, { n: x.shots })}`;
                const card = (
                  <div className="overflow-hidden rounded-2xl bg-[#14151a] shadow-[inset_0_0_0_1px_rgba(255,255,255,0.08)] transition-shadow group-hover:shadow-[inset_0_0_0_1px_rgba(240,205,166,0.5)]">
                    <div className="relative aspect-[16/9] bg-[#101116]">
                      {x.thumbUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={x.thumbUrl} alt="" className="absolute inset-0 h-full w-full object-cover" />
                      ) : (
                        <div
                          aria-hidden
                          className="absolute inset-0 opacity-30 [background-image:linear-gradient(to_right,rgba(255,255,255,0.07)_1px,transparent_1px),linear-gradient(to_bottom,rgba(255,255,255,0.07)_1px,transparent_1px)] [background-size:24px_24px]"
                        />
                      )}
                    </div>
                    <div className="px-3 py-2.5">
                      <p className="truncate text-[13px] font-semibold text-[#ecedf1]">{x.title || x.brief || r.readsLabel}</p>
                      <p className="mt-0.5 truncate text-[11px] tabular-nums text-[#6b6f7a]">{meta}</p>
                    </div>
                  </div>
                );
                return x.status === "ready" ? (
                  <Link key={x.id} href={`/app/sets/${x.id}`} aria-label={r.open} className="group">
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
