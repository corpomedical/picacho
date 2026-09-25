"use client";

// Director's Cut (operator, 2026-09-24): raw footage in, a finished edit out.
//
// The page he picked from the boards: B, "The Bench" — bin and brief on the
// left, the monitor and the cut in the middle, the director's notes on the
// right, where a change is asked for. Until the first edit exists it opens
// as A's plain brief instead (an empty monitor and notes column look dead).
// On a phone the three columns stack: monitor, the cut, notes, then the bin.
//
// Colours are literal hex, as on the Mystique door: the Screening theme
// redefines Tailwind's `white` as near-black, so no `white` utilities here.

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { useLocale } from "@/lib/i18n/provider";
import { formatMsg } from "@/lib/i18n/format";
import { isStaleDeployError, reloadForNewDeploy } from "@/lib/stale-deploy";
import {
  getEdit,
  listEdits,
  prepareSong,
  reviseEdit,
  startEdit,
  submitEdit,
  type EditDetail,
  type EditSummary,
} from "@/lib/editor/actions";
import { ASPECT_HINTS, EDITOR_BUCKET, MAX_CLIPS, SONG_TYPES, type AspectHint } from "@/lib/editor/job";

const WORKING = new Set(["analyzing", "directing", "bundling", "rendering"]);
const POLL_MS = 4000;
const LENGTHS: (number | null)[] = [null, 15, 30, 60];
const ASPECTS = ASPECT_HINTS;

type Picked = { file: File; url: string; seconds: number | null };

export function DirectorsCut({ initialEdits, initialDetail = null }: { initialEdits: EditSummary[]; initialDetail?: EditDetail | null }) {
  const { t } = useLocale();
  const d = t.directorsCut;
  const [edits, setEdits] = useState(initialEdits);
  const [selectedId, setSelectedId] = useState<string | null>(initialDetail?.id ?? initialEdits[0]?.id ?? null);
  // The newest edit arrives with the page, so the bench opens whole.
  const [detail, setDetail] = useState<EditDetail | null>(initialDetail);
  const [error, setError] = useState<string | null>(null);

  const guard = useCallback(async <T,>(work: () => Promise<T>): Promise<T | null> => {
    try {
      return await work();
    } catch (err) {
      if (isStaleDeployError(err) && reloadForNewDeploy()) return null;
      setError(err instanceof Error ? err.message : String(err));
      return null;
    }
  }, []);

  const refresh = useCallback(
    async (id: string | null) => {
      const list = await guard(() => listEdits());
      if (list && !list.error) setEdits(list.edits);
      if (id) {
        const one = await guard(() => getEdit(id));
        if (one?.edit) setDetail(one.edit);
      }
    },
    [guard],
  );

  useEffect(() => {
    if (!selectedId) return;
    // Another edit picked: clear the old one rather than show it under the new name.
    setDetail((cur) => (cur?.id === selectedId ? cur : null));
    void refresh(selectedId);
  }, [selectedId, refresh]);

  // Poll while anything is still being made; stop when all is settled.
  const anyWorking = edits.some((e) => WORKING.has(e.stage)) || (detail !== null && WORKING.has(detail.stage));
  useEffect(() => {
    if (!anyWorking) return;
    const timer = setInterval(() => void refresh(selectedId), POLL_MS);
    return () => clearInterval(timer);
  }, [anyWorking, selectedId, refresh]);

  const onStarted = useCallback(
    async (editId: string) => {
      setSelectedId(editId);
      await refresh(editId);
    },
    [refresh],
  );

  // Inside the dark panel (the first visit) the header is literal light ink;
  // on the page's own ground (the bench) it takes the theme's ink, so a Light
  // choice does not leave it white on white (found in the harness, 2026-09-24).
  const header = (onDark: boolean) => (
    <div className="flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className={`font-display text-3xl font-semibold tracking-tight ${onDark ? "text-[#ecedf1]" : "text-atelier-ink"}`}>{d.title}</h1>
        <p className={`mt-1.5 max-w-xl text-sm ${onDark ? "text-[#9aa0ad]" : "text-atelier-muted"}`}>{d.lede}</p>
      </div>
      <span className={`font-mono text-xs ${onDark ? "text-[#6b6f7a]" : "text-atelier-muted"}`}>{d.testing}</span>
    </div>
  );

  // A: the first visit — just the brief.
  if (edits.length === 0) {
    return (
      <div className="mx-auto max-w-5xl scroll-mt-4">
        <section className="flex flex-col gap-6 rounded-[28px] bg-[#0b0c10] px-6 pb-6 pt-7 text-[#c6c9d1] shadow-[0_0_0_1px_rgba(255,255,255,0.08),0_32px_72px_-28px_rgba(0,0,0,0.7)] sm:px-8">
          {header(true)}
          <BriefForm wide onStarted={onStarted} guard={guard} />
          {error && <p className="text-sm text-[#f0a3a3]">{error}</p>}
        </section>
      </div>
    );
  }

  // B: the bench.
  return (
    <div data-directors-cut className="scroll-mt-4 text-[#c6c9d1]">
      {/* The bench's three columns need more than the app's 5xl content
          column: from lg up, only this page's column widens (keyed on its own
          marker, as Generate's is). Here rather than in globals.css so the
          page carries its own rule; the CSP allows inline style, as the
          app layout's font variables use. */}
      <style>{`@media (min-width:1024px){[data-app-content]:has(> [data-directors-cut]){max-width:1440px}}`}</style>
      <div className="mb-5 px-1">{header(false)}</div>
      <div className="grid gap-5 lg:grid-cols-[300px_minmax(0,1fr)_320px]">
        <section aria-label={d.bin} className="order-4 flex flex-col gap-4 rounded-[20px] bg-[#0b0c10] p-5 shadow-[0_0_0_1px_rgba(255,255,255,0.08)] lg:order-1">
          <BriefForm onStarted={onStarted} guard={guard} />
          <div className="flex flex-col gap-2 border-t border-[rgba(255,255,255,0.08)] pt-4">
            <span className="font-mono text-[11px] uppercase tracking-[0.08em] text-[#6b6f7a]">{d.edits}</span>
            <ul className="flex flex-col gap-1">
              {edits.map((e) => (
                <li key={e.id}>
                  <button
                    type="button"
                    onClick={() => setSelectedId(e.id)}
                    aria-current={e.id === selectedId ? "true" : undefined}
                    className={`flex min-h-11 w-full items-center justify-between gap-3 rounded-xl px-3 py-2 text-left text-sm ${
                      e.id === selectedId ? "bg-[rgba(224,164,104,0.12)] text-[#ecedf1]" : "text-[#9aa0ad] hover:bg-[rgba(255,255,255,0.04)]"
                    }`}
                  >
                    <span className="line-clamp-1">{e.brief || e.summary || e.clipNames.join(", ")}</span>
                    <StageDot stage={e.stage} />
                  </button>
                </li>
              ))}
            </ul>
          </div>
        </section>

        <section aria-label={d.theCut} className="order-1 flex min-w-0 flex-col gap-4 lg:order-2">
          <Screen key={`${detail?.id ?? "none"}:${detail?.outputs.length ?? 0}`} detail={detail} loading={selectedId !== null && detail === null} />
        </section>

        <section aria-label={d.notes} className="order-3 lg:order-3">
          <Notes detail={detail} guard={guard} onSent={() => refresh(selectedId)} />
        </section>
      </div>
      {error && <p className="mt-4 text-sm text-[#f0a3a3]">{error}</p>}
    </div>
  );
}

type Guard = <T>(work: () => Promise<T>) => Promise<T | null>;

// ---------------------------------------------------------------- the brief

function BriefForm({ wide = false, onStarted, guard }: { wide?: boolean; onStarted: (id: string) => Promise<void>; guard: Guard }) {
  const { t } = useLocale();
  const d = t.directorsCut;
  const [files, setFiles] = useState<Picked[]>([]);
  const [brief, setBrief] = useState("");
  const [aspect, setAspect] = useState<AspectHint>("auto");
  const [length, setLength] = useState<number | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const briefId = wide ? "dc-brief-wide" : "dc-brief";

  // A preview URL is let go when its clip is removed or sent, and all of
  // them when the form goes away.
  const live = useRef<Picked[]>([]);
  useEffect(() => {
    live.current = files;
  }, [files]);
  useEffect(() => () => live.current.forEach((f) => URL.revokeObjectURL(f.url)), []);

  function add(list: FileList | null) {
    if (!list) return;
    const room = MAX_CLIPS - files.length;
    const next = Array.from(list)
      .filter((f) => f.type.startsWith("video/") || f.type.startsWith("audio/"))
      .slice(0, Math.max(0, room))
      .map((file) => ({ file, url: URL.createObjectURL(file), seconds: null }));
    setFiles((cur) => [...cur, ...next]);
  }

  function remove(i: number) {
    URL.revokeObjectURL(files[i].url);
    setFiles((cur) => cur.filter((_, j) => j !== i));
  }

  async function cut() {
    if (files.length === 0 || busy) return;
    setProblem(null);
    setBusy(d.starting);
    const started = await guard(() =>
      startEdit({
        brief,
        aspect,
        targetSeconds: length,
        files: files.map((f) => ({ name: f.file.name, size: f.file.size, type: f.file.type })),
      }),
    );
    if (!started || started.error !== null) {
      setProblem(started?.error ?? null);
      setBusy(null);
      return;
    }
    const supabase = createClient();
    for (const [i, place] of started.uploads.entries()) {
      setBusy(formatMsg(d.uploading, { n: i + 1, total: started.uploads.length }));
      const { error } = await supabase.storage
        .from(EDITOR_BUCKET)
        .uploadToSignedUrl(place.path, place.token, files[i].file, { contentType: files[i].file.type });
      if (error) {
        setProblem(error.message);
        setBusy(null);
        return;
      }
    }
    const submitted = await guard(() => submitEdit(started.editId));
    setBusy(null);
    if (!submitted || submitted.error) {
      setProblem(submitted?.error ?? null);
      return;
    }
    files.forEach((f) => URL.revokeObjectURL(f.url));
    setFiles([]);
    setBrief("");
    await onStarted(started.editId);
  }

  const total = files.reduce((s, f) => s + (f.seconds ?? 0), 0);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-2.5">
        <span className="flex items-baseline justify-between font-mono text-[11px] uppercase tracking-[0.08em] text-[#6b6f7a]">
          {d.footage}
          {files.length > 0 && <span className="normal-case tracking-normal">{formatMsg(files.length === 1 ? d.clipOne : d.clipsOf, { n: files.length, time: clock(total) })}</span>}
        </span>
        <div className={wide ? "grid grid-cols-2 gap-3 sm:grid-cols-4" : "flex flex-col gap-2"}>
          {files.map((f, i) => (
            <div
              key={f.url}
              className={
                wide
                  ? "relative overflow-hidden rounded-[14px] bg-[#101116] ring-1 ring-[rgba(255,255,255,0.1)]"
                  : "relative flex items-center gap-3 rounded-xl bg-[#101116] p-2 ring-1 ring-[rgba(255,255,255,0.08)]"
              }
            >
              <video
                // Half a second in, so a clip that opens on black still shows what it is.
                src={`${f.url}#t=0.5`}
                muted
                playsInline
                preload="metadata"
                onLoadedMetadata={(ev) => {
                  const secs = ev.currentTarget.duration;
                  setFiles((cur) => cur.map((x, j) => (j === i ? { ...x, seconds: Number.isFinite(secs) ? secs : null } : x)));
                }}
                className={wide ? "aspect-video w-full bg-[#050608] object-cover" : "h-12 w-20 shrink-0 rounded-md bg-[#050608] object-cover"}
              />
              <div className={wide ? "flex justify-between gap-2 px-2.5 py-2 text-xs" : "min-w-0 flex-1 text-xs"}>
                <span className="line-clamp-1 text-[#c6c9d1]">{f.file.name}</span>
                <span className="font-mono text-[#6b6f7a]">{f.seconds === null ? "" : clock(f.seconds)}</span>
              </div>
              <button
                type="button"
                aria-label={formatMsg(d.remove, { name: f.file.name })}
                onClick={() => remove(i)}
                className="absolute right-1.5 top-1.5 flex h-7 w-7 items-center justify-center rounded-full bg-[rgba(7,8,11,0.7)] text-[#c6c9d1]"
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true">
                  <path d="M6 6l12 12M18 6 6 18" />
                </svg>
              </button>
            </div>
          ))}
          {files.length < MAX_CLIPS && (
            <button
              type="button"
              onClick={() => input.current?.click()}
              className={`flex items-center justify-center gap-2 rounded-[14px] border border-dashed border-[rgba(255,255,255,0.18)] text-sm text-[#9aa0ad] hover:border-[rgba(224,164,104,0.5)] hover:text-[#ecedf1] ${
                wide ? "min-h-[120px] flex-col px-4 text-center" : "min-h-11"
              }`}
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" aria-hidden="true">
                <path d="M12 5v14M5 12h14" />
              </svg>
              {d.addFootage}
              {wide && <span className="font-mono text-[11px] text-[#6b6f7a]">{d.addHint}</span>}
            </button>
          )}
        </div>
        <input
          ref={input}
          type="file"
          accept="video/mp4,video/quicktime,video/webm,audio/mpeg,audio/mp4,audio/x-m4a,audio/wav"
          multiple
          className="hidden"
          onChange={(e) => {
            add(e.currentTarget.files);
            e.currentTarget.value = "";
          }}
        />
      </div>

      <div className="flex flex-col gap-2.5">
        <label htmlFor={briefId} className="font-mono text-[11px] uppercase tracking-[0.08em] text-[#6b6f7a]">
          {d.briefLabel}
        </label>
        <textarea
          id={briefId}
          rows={wide ? 3 : 4}
          value={brief}
          maxLength={4000}
          onChange={(e) => setBrief(e.target.value)}
          placeholder={d.briefPlaceholder}
          className="resize-none rounded-[14px] border border-[rgba(255,255,255,0.1)] bg-[#101116] px-4 py-3 text-[15px] leading-relaxed text-[#ecedf1] placeholder:text-[#6b6f7a] focus:border-[rgba(224,164,104,0.6)] focus:outline-none"
        />
      </div>

      <div className={`flex flex-wrap items-center gap-x-5 gap-y-3 ${wide ? "" : "text-xs"}`}>
        <ChipGroup label={d.shape}>
          {ASPECTS.map((a) => (
            <Chip key={a} on={aspect === a} onClick={() => setAspect(a)}>
              {a === "auto" ? d.auto : a}
            </Chip>
          ))}
        </ChipGroup>
        <ChipGroup label={d.length}>
          {LENGTHS.map((n) => (
            <Chip key={String(n)} on={length === n} onClick={() => setLength(n)}>
              {n === null ? d.itsCall : formatMsg(d.seconds, { n })}
            </Chip>
          ))}
        </ChipGroup>
        <button
          type="button"
          onClick={cut}
          disabled={files.length === 0 || busy !== null}
          className={`min-h-11 rounded-full bg-[#e0a468] px-7 py-3 text-[15px] font-semibold text-[#1a0f07] transition-opacity disabled:opacity-40 ${
            wide ? "ml-auto" : "w-full"
          }`}
        >
          {busy ?? d.cutIt}
        </button>
      </div>
      {problem && <p className="text-sm text-[#f0a3a3]">{problem}</p>}
    </div>
  );
}

function ChipGroup({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div role="group" aria-label={label} className="flex flex-wrap items-center gap-1.5">
      <span className="mr-1 font-mono text-[11px] uppercase tracking-[0.08em] text-[#6b6f7a]">{label}</span>
      {children}
    </div>
  );
}

function Chip({ on, onClick, children }: { on: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={onClick}
      className={`min-h-9 rounded-full border px-3 font-mono text-xs ${
        on ? "border-[#e0a468] bg-[#e0a468] text-[#1a0f07]" : "border-[rgba(255,255,255,0.12)] text-[#c6c9d1] hover:border-[rgba(255,255,255,0.3)]"
      }`}
    >
      {children}
    </button>
  );
}

// ------------------------------------------------------------- the monitor

const STEPS = ["reading", "watching", "cutting"] as const;

/**
 * The middle column: the video(s) the editor delivered — tabs when it made
 * several (shorts from one pile) — or the steps while it works.
 */
function Screen({ detail, loading }: { detail: EditDetail | null; loading: boolean }) {
  const { t } = useLocale();
  const d = t.directorsCut;
  const [pick, setPick] = useState(0);
  const outputs = detail?.outputs ?? [];
  const working = detail !== null && detail.stage !== "done" && detail.stage !== "failed";
  const shown = !working && outputs.length > 0 ? outputs[Math.min(pick, outputs.length - 1)] : null;
  const latestTurn = outputs[0]?.turn ?? 0;
  const tabs = outputs.filter((o) => o.turn === latestTurn);
  const older = outputs.length - tabs.length;
  return (
    <>
      <div className="relative flex min-h-[420px] items-center justify-center rounded-[20px] bg-[#050608] p-4 shadow-[0_0_0_1px_rgba(255,255,255,0.08)] lg:min-h-[560px]">
        {shown?.url ? (
          <div className="flex w-full flex-col items-center gap-3">
            <div className="flex w-full flex-wrap items-baseline justify-between gap-2 px-1">
              <span className="font-mono text-xs text-[#9aa0ad]">
                {formatMsg(d.cut, { n: shown.turn })} · {shown.aspect}
                {shown.title ? ` · ${shown.title}` : ""}
              </span>
              <a href={shown.url} download className="text-[13px] text-[#e0a468] hover:text-[#f0bd86]">
                {d.download}
              </a>
            </div>
            <video
              key={shown.url}
              // Half a second in: an edit that opens on a fade shows black at 0.
              src={`${shown.url}#t=0.5`}
              controls
              playsInline
              preload="metadata"
              className={shown.aspect === "9:16" ? "max-h-[520px] w-auto max-w-full rounded-[14px]" : "max-h-[520px] w-full rounded-[14px]"}
            />
            {/* Inside the monitor, not on the page: the monitor is dark in both themes, the page isn't. */}
            {outputs.length > 1 && (
              <div role="tablist" aria-label={d.versions} className="flex flex-wrap justify-center gap-1.5">
                {outputs.map((o, i) => (
                  <button
                    key={`${o.turn}:${i}`}
                    type="button"
                    role="tab"
                    aria-selected={i === Math.min(pick, outputs.length - 1)}
                    onClick={() => setPick(i)}
                    className={`min-h-9 rounded-full border px-3 text-xs ${
                      i === Math.min(pick, outputs.length - 1)
                        ? "border-[#e0a468] bg-[#e0a468] text-[#1a0f07]"
                        : "border-[rgba(255,255,255,0.12)] text-[#c6c9d1] hover:border-[rgba(255,255,255,0.3)]"
                    } ${o.turn < latestTurn ? "opacity-60" : ""}`}
                  >
                    {o.title || formatMsg(d.cut, { n: o.turn })}
                    {older > 0 && ` · ${formatMsg(d.cut, { n: o.turn })}`}
                  </button>
                ))}
              </div>
            )}
          </div>
        ) : working ? (
          <Progress detail={detail} />
        ) : detail?.stage === "failed" ? (
          <div className="max-w-sm text-center">
            <p className="font-semibold text-[#ecedf1]">{d.phase.failed}</p>
            {detail.error && <p className="mt-2 text-sm text-[#9aa0ad]">{detail.error}</p>}
          </div>
        ) : loading ? null : (
          <p className="text-sm text-[#6b6f7a]">{d.empty}</p>
        )}
      </div>
      {shown?.url && <FrameStrip url={shown.url} seconds={shown.seconds} />}
    </>
  );
}

function Progress({ detail }: { detail: EditDetail }) {
  const { t } = useLocale();
  const d = t.directorsCut;
  const at = STEPS.indexOf(detail.phase as (typeof STEPS)[number]);
  return (
    <div className="flex max-w-md flex-col gap-4">
      <ol className="flex flex-col gap-2.5 text-sm">
        {STEPS.map((step, i) => (
          <li key={step} className={i < at ? "text-[#9aa0ad]" : i === at ? "text-[#ecedf1]" : "text-[#6b6f7a]"}>
            <span aria-hidden="true" className={`mr-2 inline-block w-3 ${i === at ? "animate-pulse text-[#e0a468]" : ""}`}>
              {i < at ? "✓" : i === at ? "●" : "○"}
            </span>
            {d.phase[step]}
            {step === "watching" && i === at && detail.clips.length > 1 && (
              <span className="ml-2 font-mono text-xs text-[#6b6f7a]">
                {detail.analyzed}/{detail.clips.length}
              </span>
            )}
          </li>
        ))}
      </ol>
      {/* The editor's own latest words while it works — what it is actually doing. */}
      {detail.phase === "cutting" && (detail.activity?.text || detail.activity?.code) && (
        <p className="line-clamp-3 rounded-[12px] bg-[#101116] px-3 py-2.5 font-serif text-sm leading-relaxed text-[#9aa0ad]">
          {detail.activity.text || d.activity[detail.activity.code!]}
        </p>
      )}
      <p className="font-mono text-[11px] text-[#6b6f7a]">{d.leave}</p>
    </div>
  );
}

// ------------------------------------------------------------- the frames

/** Eight frames spread across the finished video, drawn in the browser from the file itself. */
function FrameStrip({ url, seconds }: { url: string; seconds: number }) {
  const { t } = useLocale();
  const d = t.directorsCut;
  const count = 8;
  const times = useMemo(
    () => Array.from({ length: count }, (_, i) => Math.max(0.1, ((i + 0.5) / count) * Math.max(1, seconds))),
    [seconds],
  );
  const frames = useFrames(url, times);
  return (
    <div className="flex flex-col gap-3 rounded-[20px] bg-[#0b0c10] px-4 py-3.5 shadow-[0_0_0_1px_rgba(255,255,255,0.08)]">
      <div className="flex justify-between font-mono text-[11px] text-[#6b6f7a]">
        <span className="uppercase tracking-[0.08em]">{d.theCut}</span>
        <span>{clock(seconds)}</span>
      </div>
      <div className="grid h-16 grid-cols-8 gap-1 overflow-hidden rounded-md">
        {times.map((_, i) => (
          <div key={i} className="overflow-hidden rounded-[5px] bg-[#101116]">
            {frames[i] && (
              // eslint-disable-next-line @next/next/no-img-element -- a frame drawn in the browser from the finished video, not a remote image
              <img src={frames[i]!} alt="" className="h-full w-full object-cover" />
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * One small frame per time, drawn from the finished video in the browser —
 * the file is ours (/api/media, same origin), so the canvas stays readable.
 * Frames arrive one by one; a failure leaves that slot empty.
 */
function useFrames(url: string | null, times: number[]): (string | null)[] {
  const [frames, setFrames] = useState<(string | null)[]>([]);
  const key = `${url}|${times.join(",")}`;
  useEffect(() => {
    setFrames([]);
    if (!url || times.length === 0) return;
    let cancelled = false;
    const video = document.createElement("video");
    video.muted = true;
    video.preload = "auto";
    video.src = url;
    const canvas = document.createElement("canvas");
    const grab = (t: number) =>
      new Promise<string | null>((resolve) => {
        const done = () => {
          video.removeEventListener("seeked", done);
          try {
            // 480 px wide: the strip crops each frame to a wide, short block,
            // so a narrow (9:16) frame drawn small was stretched to a blur.
            const w = 480;
            canvas.width = w;
            canvas.height = Math.max(1, Math.round((video.videoHeight / Math.max(1, video.videoWidth)) * w));
            canvas.getContext("2d")?.drawImage(video, 0, 0, canvas.width, canvas.height);
            resolve(canvas.toDataURL("image/jpeg", 0.7));
          } catch {
            resolve(null);
          }
        };
        video.addEventListener("seeked", done);
        video.currentTime = t;
      });
    video.addEventListener(
      "loadeddata",
      async () => {
        for (const [i, t] of times.entries()) {
          if (cancelled) return;
          const frame = await grab(t);
          if (cancelled) return;
          setFrames((cur) => {
            const next = [...cur];
            next[i] = frame;
            return next;
          });
        }
      },
      { once: true },
    );
    return () => {
      cancelled = true;
      video.removeAttribute("src");
      video.load();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `key` stands for url + times
  }, [key]);
  return frames;
}

// ------------------------------------------------------------- the notes

function Notes({ detail, guard, onSent }: { detail: EditDetail | null; guard: Guard; onSent: () => Promise<void> }) {
  const { t } = useLocale();
  const d = t.directorsCut;
  const [text, setText] = useState("");
  // A song to re-cut to, sent with the change (the editor only uses music the customer brings).
  const [song, setSong] = useState<File | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const songInput = useRef<HTMLInputElement>(null);
  const canAsk = detail?.stage === "done";
  const lastIsYou = detail?.notes.at(-1)?.role === "you";

  async function send() {
    if (!detail || (!text.trim() && !song) || busy) return;
    setProblem(null);
    let offer: { name: string; size: number; type: string } | null = null;
    if (song) {
      setBusy(d.songUploading);
      offer = { name: song.name, size: song.size, type: song.type };
      const sent = offer;
      const place = await guard(() => prepareSong(detail.id, sent));
      if (!place || place.error !== null) {
        setProblem(place?.error ?? null);
        setBusy(null);
        return;
      }
      const { error } = await createClient().storage.from(EDITOR_BUCKET).uploadToSignedUrl(place.path, place.token, song, { contentType: song.type });
      if (error) {
        setProblem(error.message);
        setBusy(null);
        return;
      }
    }
    setBusy(d.sending);
    const res = await guard(() => reviseEdit(detail.id, text, offer));
    setBusy(null);
    if (res?.error) {
      setProblem(res.error);
      return;
    }
    setText("");
    setSong(null);
    await onSent();
  }

  return (
    <div className="flex h-full min-h-[320px] flex-col gap-3.5 rounded-[20px] bg-[#0b0c10] p-5 shadow-[0_0_0_1px_rgba(255,255,255,0.08)]">
      <span className="font-mono text-[11px] uppercase tracking-[0.08em] text-[#6b6f7a]">{d.notes}</span>
      <div className="flex flex-1 flex-col gap-3 overflow-y-auto">
        {(detail?.notes ?? []).map((n, i) =>
          n.role === "editor" ? (
            <p key={i} className="rounded-[14px] bg-[#101116] px-3.5 py-3 font-serif text-[15px] leading-relaxed text-[#c6c9d1]">
              {n.text}
            </p>
          ) : (
            <p key={i} className="flex max-w-[85%] flex-col gap-1 self-end rounded-[14px] bg-[rgba(224,164,104,0.14)] px-3.5 py-2.5 text-sm text-[#ecedf1]">
              {n.song && <span className="font-mono text-xs text-[#e0a468]">♪ {n.song}</span>}
              {n.text && <span>{n.text}</span>}
            </p>
          ),
        )}
        {detail && WORKING.has(detail.stage) && (lastIsYou || detail.notes.length === 0) && (
          <p className="font-mono text-xs text-[#e0a468]">
            <span aria-hidden="true" className="mr-1.5 animate-pulse">●</span>
            {d.phase[detail.phase as keyof typeof d.phase] ?? ""}
          </p>
        )}
      </div>
      {detail?.stage === "done" && (
        <Link href="/app/history" className="text-[13px] text-[#e0a468] hover:text-[#f0bd86]">
          {d.openHistory}
        </Link>
      )}
      {song && (
        <div className="flex min-h-9 items-center justify-between gap-2 rounded-full bg-[rgba(224,164,104,0.1)] pl-3.5 pr-1 font-mono text-xs text-[#e0a468]">
          <span className="line-clamp-1">♪ {song.name}</span>
          <button
            type="button"
            onClick={() => setSong(null)}
            disabled={busy !== null}
            aria-label={d.removeSong}
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[#c6c9d1] hover:bg-[rgba(255,255,255,0.08)]"
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true">
              <path d="M6 6l12 12M18 6 6 18" />
            </svg>
          </button>
        </div>
      )}
      {busy && <p className="font-mono text-xs text-[#9aa0ad]">{busy}</p>}
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          void send();
        }}
      >
        <button
          type="button"
          onClick={() => songInput.current?.click()}
          disabled={!canAsk || busy !== null}
          aria-label={d.addSong}
          title={d.addSong}
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-[rgba(255,255,255,0.12)] text-[#c6c9d1] hover:border-[rgba(224,164,104,0.5)] hover:text-[#ecedf1] disabled:opacity-40"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M9 18V5l11-2v13" />
            <circle cx="6" cy="18" r="3" />
            <circle cx="17" cy="16" r="3" />
          </svg>
        </button>
        <input
          ref={songInput}
          type="file"
          accept={SONG_TYPES.join(",")}
          className="hidden"
          onChange={(e) => {
            const f = e.currentTarget.files?.[0] ?? null;
            if (f) setSong(f);
            e.currentTarget.value = "";
          }}
        />
        <label htmlFor="dc-change" className="sr-only">
          {d.askChange}
        </label>
        <input
          id="dc-change"
          value={text}
          maxLength={2000}
          disabled={!canAsk || busy !== null}
          onChange={(e) => setText(e.target.value)}
          placeholder={song ? d.songNote : d.askChange}
          className="min-h-11 min-w-0 flex-1 rounded-full border border-[rgba(255,255,255,0.1)] bg-[#101116] px-4 text-sm text-[#ecedf1] placeholder:text-[#6b6f7a] focus:border-[rgba(224,164,104,0.6)] focus:outline-none disabled:opacity-50"
        />
        <button
          type="submit"
          aria-label={d.send}
          disabled={!canAsk || busy !== null || (!text.trim() && !song)}
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-[#e0a468] text-[#1a0f07] disabled:opacity-40"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
            <path d="M5 12h14M13 6l6 6-6 6" />
          </svg>
        </button>
      </form>
      {problem && <p className="text-sm text-[#f0a3a3]">{problem}</p>}
    </div>
  );
}

function StageDot({ stage }: { stage: string }) {
  const color = stage === "done" ? "#9aa0ad" : stage === "failed" ? "#f0a3a3" : "#e0a468";
  return <span aria-hidden="true" className={`h-2 w-2 shrink-0 rounded-full ${WORKING.has(stage) ? "animate-pulse" : ""}`} style={{ background: color }} />;
}

function clock(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}
