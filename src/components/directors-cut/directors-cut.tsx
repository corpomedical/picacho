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
  reviseEdit,
  startEdit,
  submitEdit,
  type EditDetail,
  type EditSummary,
} from "@/lib/editor/actions";
import { EDITOR_BUCKET, MAX_CLIPS } from "@/lib/editor/job";
import type { Aspect } from "@/lib/editor/plan";

const WORKING = new Set(["analyzing", "directing", "bundling", "rendering"]);
const POLL_MS = 4000;
const LENGTHS: (number | null)[] = [null, 15, 30, 60];
const ASPECTS: Aspect[] = ["16:9", "9:16", "1:1"];

type Picked = { file: File; url: string; seconds: number | null };

export function DirectorsCut({ initialEdits }: { initialEdits: EditSummary[] }) {
  const { t } = useLocale();
  const d = t.directorsCut;
  const [edits, setEdits] = useState(initialEdits);
  const [selectedId, setSelectedId] = useState<string | null>(initialEdits[0]?.id ?? null);
  const [detail, setDetail] = useState<EditDetail | null>(null);
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
    setDetail(null);
    if (selectedId) void refresh(selectedId);
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

  const header = (
    <div className="flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="font-display text-3xl font-semibold tracking-tight text-[#ecedf1]">{d.title}</h1>
        <p className="mt-1.5 max-w-xl text-sm text-[#9aa0ad]">{d.lede}</p>
      </div>
      <span className="font-mono text-xs text-[#6b6f7a]">{d.testing}</span>
    </div>
  );

  // A: the first visit — just the brief.
  if (edits.length === 0) {
    return (
      <div className="mx-auto max-w-5xl scroll-mt-4">
        <section className="flex flex-col gap-6 rounded-[28px] bg-[#0b0c10] px-6 pb-6 pt-7 text-[#c6c9d1] shadow-[0_0_0_1px_rgba(255,255,255,0.08),0_32px_72px_-28px_rgba(0,0,0,0.7)] sm:px-8">
          {header}
          <BriefForm wide onStarted={onStarted} guard={guard} />
          {error && <p className="text-sm text-[#f0a3a3]">{error}</p>}
        </section>
      </div>
    );
  }

  // B: the bench.
  return (
    <div data-directors-cut className="scroll-mt-4 text-[#c6c9d1]">
      <div className="mb-5 px-1">{header}</div>
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
          <Monitor detail={detail} />
          {detail?.cut && <CutStrip detail={detail} />}
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
  const [aspect, setAspect] = useState<Aspect>("9:16");
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
          {files.length > 0 && <span className="normal-case tracking-normal">{formatMsg(d.clipsOf, { n: files.length, time: clock(total) })}</span>}
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
                src={f.url}
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
                wide ? "min-h-[120px] flex-col" : "min-h-11"
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
              {a}
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

const STEPS = ["reading", "watching", "cutting", "checking", "rendering"] as const;

function Monitor({ detail }: { detail: EditDetail | null }) {
  const { t } = useLocale();
  const d = t.directorsCut;
  const portrait = detail?.aspect === "9:16";
  return (
    <div className="relative flex min-h-[420px] items-center justify-center rounded-[20px] bg-[#050608] p-4 shadow-[0_0_0_1px_rgba(255,255,255,0.08)] lg:min-h-[560px]">
      {detail?.resultUrl && detail.stage === "done" ? (
        <>
          <video
            key={detail.resultUrl}
            src={detail.resultUrl}
            controls
            playsInline
            preload="metadata"
            className={portrait ? "max-h-[540px] w-auto rounded-[14px]" : "max-h-[540px] w-full rounded-[14px]"}
          />
          <span className="absolute left-4 top-3 font-mono text-xs text-[#9aa0ad]">
            {formatMsg(d.cut, { n: detail.cutNumber })} · {detail.aspect}
          </span>
          <a href={detail.resultUrl} download className="absolute right-4 top-3 text-[13px] text-[#e0a468] hover:text-[#f0bd86]">
            {d.download}
          </a>
        </>
      ) : detail && detail.stage !== "done" ? (
        <Progress detail={detail} />
      ) : (
        <p className="text-sm text-[#6b6f7a]">{d.empty}</p>
      )}
    </div>
  );
}

function Progress({ detail }: { detail: EditDetail }) {
  const { t } = useLocale();
  const d = t.directorsCut;
  if (detail.stage === "failed") {
    return (
      <div className="max-w-sm text-center">
        <p className="font-semibold text-[#ecedf1]">{d.phase.failed}</p>
        {detail.error && <p className="mt-2 text-sm text-[#9aa0ad]">{detail.error}</p>}
      </div>
    );
  }
  const at = STEPS.indexOf(detail.phase as (typeof STEPS)[number]);
  return (
    <div className="flex flex-col gap-4">
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
      <p className="font-mono text-[11px] text-[#6b6f7a]">{d.leave}</p>
    </div>
  );
}

// --------------------------------------------------------------- the cut

function CutStrip({ detail }: { detail: EditDetail }) {
  const { t } = useLocale();
  const d = t.directorsCut;
  const cut = detail.cut!;
  const total = cut.shots.reduce((s, x) => s + x.seconds, 0);
  // Each shot's middle, in the finished video's own time.
  const mids = useMemo(
    () => cut.shots.map((s, i) => cut.shots.slice(0, i).reduce((sum, x) => sum + x.seconds, 0) + s.seconds / 2),
    [cut.shots],
  );
  const frames = useFrames(detail.stage === "done" ? detail.resultUrl : null, mids);
  const whole = cut.shots.map((s, i) => (s.fit === "contain" ? i + 1 : 0)).filter(Boolean);

  return (
    <div className="flex flex-col gap-3 rounded-[20px] bg-[#0b0c10] px-4 py-3.5 shadow-[0_0_0_1px_rgba(255,255,255,0.08)]">
      <div className="flex justify-between font-mono text-[11px] text-[#6b6f7a]">
        <span className="uppercase tracking-[0.08em]">
          {d.theCut} · {formatMsg(d.shotCount, { n: cut.shots.length })}
        </span>
        <span>{clock(total)}</span>
      </div>
      <div className="flex h-16 gap-1 overflow-hidden rounded-md">
        {cut.shots.map((s, i) => (
          <div
            key={i}
            title={`${detail.clips[s.clip]?.name ?? ""} · ${s.seconds.toFixed(1)} s`}
            style={{ flexGrow: s.seconds, flexBasis: 0 }}
            className="min-w-[10px] overflow-hidden rounded-[5px] bg-[#101116]"
          >
            {frames[i] ? (
              // eslint-disable-next-line @next/next/no-img-element -- a frame drawn in the browser from the finished video, not a remote image
              <img src={frames[i]!} alt="" className="h-full w-full object-cover" />
            ) : (
              <span className="flex h-full items-end p-1 font-mono text-[10px] text-[#6b6f7a]">{s.clip + 1}</span>
            )}
          </div>
        ))}
      </div>
      <div className="flex flex-wrap gap-1.5 font-mono text-[11px]">
        {cut.captions !== "off" && <span className="rounded-md bg-[rgba(224,164,104,0.14)] px-2 py-1 text-[#e0a468]">{d.chipCaptions}</span>}
        {whole.length > 0 && (
          <span className="rounded-md bg-[rgba(255,255,255,0.06)] px-2 py-1 text-[#9aa0ad]">{formatMsg(d.chipWhole, { list: whole.join(", ") })}</span>
        )}
        {cut.music && <span className="rounded-md bg-[rgba(255,255,255,0.06)] px-2 py-1 text-[#9aa0ad]">{d.chipMusic}</span>}
        {cut.texts.length > 0 && (
          <span className="rounded-md bg-[rgba(255,255,255,0.06)] px-2 py-1 text-[#9aa0ad]">{formatMsg(d.chipText, { n: cut.texts.length })}</span>
        )}
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
            const h = 96;
            canvas.height = h;
            canvas.width = Math.max(1, Math.round((video.videoWidth / Math.max(1, video.videoHeight)) * h));
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
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const canAsk = detail?.stage === "done";
  const lastIsYou = detail?.notes.at(-1)?.role === "you";

  async function send() {
    if (!detail || !text.trim() || busy) return;
    setBusy(true);
    setProblem(null);
    const res = await guard(() => reviseEdit(detail.id, text));
    setBusy(false);
    if (res?.error) {
      setProblem(res.error);
      return;
    }
    setText("");
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
            <p key={i} className="max-w-[85%] self-end rounded-[14px] bg-[rgba(224,164,104,0.14)] px-3.5 py-2.5 text-sm text-[#ecedf1]">
              {n.text}
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
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          void send();
        }}
      >
        <label htmlFor="dc-change" className="sr-only">
          {d.askChange}
        </label>
        <input
          id="dc-change"
          value={text}
          maxLength={2000}
          disabled={!canAsk || busy}
          onChange={(e) => setText(e.target.value)}
          placeholder={d.askChange}
          className="min-h-11 min-w-0 flex-1 rounded-full border border-[rgba(255,255,255,0.1)] bg-[#101116] px-4 text-sm text-[#ecedf1] placeholder:text-[#6b6f7a] focus:border-[rgba(224,164,104,0.6)] focus:outline-none disabled:opacity-50"
        />
        <button
          type="submit"
          aria-label={d.send}
          disabled={!canAsk || busy || !text.trim()}
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
