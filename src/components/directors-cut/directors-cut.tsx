"use client";

// Director's Cut (operator, 2026-09-24): raw footage in, a finished edit out.
//
// Until the first edit exists it opens as the plain brief. After that it is
// the Edit Bay (bay/edit-bay.tsx — board A, his pick 2026-09-25, replacing
// the bench he called "trash"): Opus's cut on a real multi-track timeline,
// the brief for a new edit in place of it, the director's notes in its
// right-hand Opus tab.
//
// Dressed as "The Suite" (redesign board A, operator 2026-10-02: "Go with A,
// build it"): the brief is a page of its own in the suite's chrome — the
// footage as tall pictures, the song on its own row, one slab to write in —
// and while Opus works the bay shows the steps, what it is doing now and how
// long it has been at it.
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
import { EditBay, type DirectorPart } from "./bay/edit-bay";

const WORKING = new Set(["analyzing", "directing", "bundling", "rendering"]);
const POLL_MS = 4000;
const LENGTHS: (number | null)[] = [null, 15, 30, 60];
const ASPECTS = ASPECT_HINTS;

type Picked = { file: File; url: string; seconds: number | null };

export function DirectorsCut({
  initialEdits,
  initialDetail = null,
  offMusic = [],
}: {
  initialEdits: EditSummary[];
  initialDetail?: EditDetail | null;
  /** Music engines taken off the menu on Admin → Models. */
  offMusic?: string[];
}) {
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

  const onRefresh = useCallback(() => refresh(selectedId), [refresh, selectedId]);
  const startedAt = edits.find((e) => e.id === selectedId)?.created_at ?? null;
  const working = detail !== null && WORKING.has(detail.stage);

  // A: the first visit — just the brief, in the suite's own frame.
  if (edits.length === 0) {
    return (
      <div className="scroll-mt-4">
        <div className="overflow-hidden rounded-[16px] bg-[#0b0c0f] text-[#a4a9b4] shadow-[0_0_0_1px_rgba(255,255,255,0.08)]">
          <StartPage guard={guard} onStarted={onStarted} />
          {error && <p className="px-6 pb-6 text-sm text-[#f0a3a3]">{error}</p>}
        </div>
      </div>
    );
  }

  // B: the Edit Bay — Opus's cut on a real timeline; a new edit's brief takes its place.
  return (
    <div className="scroll-mt-4">
      <EditBay
        edits={edits}
        selectedId={selectedId}
        onSelectEdit={setSelectedId}
        detail={detail}
        onRefresh={onRefresh}
        offMusic={offMusic}
        working={working}
        director={(part) => <Notes part={part} detail={detail} guard={guard} onSent={onRefresh} />}
        newEdit={(close) => (
          <div className="min-h-0 flex-1 overflow-y-auto">
            <StartPage
              guard={guard}
              onBack={close}
              onStarted={async (id) => {
                close();
                await onStarted(id);
              }}
            />
          </div>
        )}
        fallback={<Screen key={`${detail?.id ?? "none"}:${detail?.outputs.length ?? 0}`} detail={detail} loading={selectedId !== null && detail === null} startedAt={startedAt} />}
      />
      {error && <p className="mt-4 text-sm text-[#f0a3a3]">{error}</p>}
    </div>
  );
}

type Guard = <T>(work: () => Promise<T>) => Promise<T | null>;

// ---------------------------------------------------------------- the brief

/** The page for a new edit: the suite's bar, the question, the footage, the slab to write in. */
function StartPage({ guard, onStarted, onBack }: { guard: Guard; onStarted: (id: string) => Promise<void>; onBack?: () => void }) {
  const { t } = useLocale();
  const d = t.directorsCut;
  return (
    <>
      <div className="flex h-[52px] items-center gap-2.5 border-b border-[rgba(255,255,255,0.06)] bg-[#0e0f13] px-3 lg:px-4">
        {onBack && (
          <button
            type="button"
            onClick={onBack}
            aria-label={d.bay.backToEdit}
            title={d.bay.backToEdit}
            className="flex h-9 w-9 items-center justify-center rounded-lg text-[#d6d9df] hover:bg-[rgba(255,255,255,0.05)]"
          >
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M15 18l-6-6 6-6" />
            </svg>
          </button>
        )}
        <span className="flex h-6 w-6 items-center justify-center rounded-[7px] bg-[#e0a468] text-[#1a0f07]" aria-hidden="true">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
            <rect x="3" y="4" width="18" height="16" rx="2" />
            <path d="M7 4v16M17 4v16M3 9h4M3 15h4M17 9h4M17 15h4" />
          </svg>
        </span>
        <span className="text-[13px] font-semibold">{d.title}</span>
        <span className="text-[#3a3e47]">/</span>
        <span className="text-[14px] font-semibold text-[#eceef2]">{d.bay.newEdit}</span>
      </div>
      <div className="mx-auto flex w-full max-w-[1040px] flex-col gap-7 px-4 pb-10 pt-8 lg:px-0 lg:pt-14">
        <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
          <div>
            <h1 className="font-display text-[30px] font-semibold leading-[1.05] tracking-[-0.015em] text-[#eceef2] lg:text-[40px]">{d.startTitle}</h1>
            <p className="mt-3 max-w-[620px] text-[15px] leading-relaxed text-[#8b909b]">{d.lede}</p>
          </div>
          <span className="font-mono text-[11.5px] text-[#6c717c]">{d.testing}</span>
        </div>
        <BriefForm guard={guard} onStarted={onStarted} />
      </div>
    </>
  );
}

function BriefForm({ onStarted, guard }: { onStarted: (id: string) => Promise<void>; guard: Guard }) {
  const { t } = useLocale();
  const d = t.directorsCut;
  const [files, setFiles] = useState<Picked[]>([]);
  const [brief, setBrief] = useState("");
  const [aspect, setAspect] = useState<AspectHint>("auto");
  const [length, setLength] = useState<number | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);

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

  const setSeconds = (i: number, secs: number) => setFiles((cur) => cur.map((x, j) => (j === i ? { ...x, seconds: Number.isFinite(secs) ? secs : null } : x)));

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

  // Pictures in the grid, songs on rows of their own; each keeps its place in `files` (upload order).
  const shots = files.map((f, i) => ({ f, i })).filter(({ f }) => !f.file.type.startsWith("audio/"));
  const songs = files.map((f, i) => ({ f, i })).filter(({ f }) => f.file.type.startsWith("audio/"));
  const total = shots.reduce((s, { f }) => s + (f.seconds ?? 0), 0);
  const counted = [
    shots.length > 0 ? formatMsg(shots.length === 1 ? d.clipOne : d.clipsOf, { n: shots.length, time: clock(total) }) : null,
    songs.length > 0 ? formatMsg(songs.length === 1 ? d.songOne : d.songsOf, { n: songs.length }) : null,
  ]
    .filter(Boolean)
    .join(" · ");
  const removeButton = (i: number, name: string, small = false) => (
    <button
      type="button"
      aria-label={formatMsg(d.remove, { name })}
      onClick={() => remove(i)}
      className={`flex items-center justify-center rounded-full text-[#d6d9df] ${small ? "h-8 w-8 hover:bg-[rgba(255,255,255,0.06)]" : "absolute right-1.5 top-1.5 h-7 w-7 bg-[rgba(7,8,11,0.7)]"}`}
    >
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true">
        <path d="M6 6l12 12M18 6 6 18" />
      </svg>
    </button>
  );

  return (
    <div className="flex flex-col gap-7">
      <div className="flex flex-col gap-3">
        <div className="flex items-baseline justify-between">
          <span className="text-[13px] font-semibold text-[#d6d9df]">{d.footage}</span>
          {counted && <span className="font-mono text-[11.5px] text-[#6c717c]">{counted}</span>}
        </div>
        <div className="grid grid-cols-3 gap-3 sm:grid-cols-5 lg:grid-cols-7">
          {shots.map(({ f, i }) => (
            <div key={f.url} className="flex min-w-0 flex-col gap-[7px]">
              <div className="relative overflow-hidden rounded-[10px] bg-[#050608] shadow-[0_0_0_1px_rgba(255,255,255,0.07)]">
                <video
                  // Half a second in, so a clip that opens on black still shows what it is.
                  src={`${f.url}#t=0.5`}
                  muted
                  playsInline
                  preload="metadata"
                  onLoadedMetadata={(ev) => setSeconds(i, ev.currentTarget.duration)}
                  className="aspect-[9/16] w-full object-cover"
                />
                {removeButton(i, f.file.name)}
              </div>
              <div className="flex justify-between gap-2 text-[12px]">
                <span className="truncate text-[#d6d9df]">{f.file.name.replace(/\.[a-z0-9]+$/i, "")}</span>
                <span className="font-mono text-[#6c717c]">{f.seconds === null ? "" : clock(f.seconds)}</span>
              </div>
            </div>
          ))}
          {files.length < MAX_CLIPS && (
            <button
              type="button"
              onClick={() => input.current?.click()}
              className="flex aspect-[9/16] flex-col items-center justify-center gap-2.5 rounded-[10px] border border-dashed border-[rgba(255,255,255,0.16)] px-3 text-center text-[12.5px] text-[#a4a9b4] hover:border-[rgba(224,164,104,0.5)] hover:text-[#eceef2]"
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
                <path d="M12 5v14M5 12h14" />
              </svg>
              {d.addFootage}
              <span className="font-mono text-[10.5px] leading-normal text-[#6c717c]">{d.addHint}</span>
            </button>
          )}
        </div>
        {songs.map(({ f, i }) => (
          <div key={f.url} className="flex h-12 items-center gap-3.5 rounded-[10px] bg-[#111317] pl-3.5 pr-1.5 shadow-[0_0_0_1px_rgba(255,255,255,0.05)]">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#4fb6a0" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M9 18V5l11-2v13" />
              <circle cx="6" cy="18" r="3" />
              <circle cx="17" cy="16" r="3" />
            </svg>
            <span className="min-w-0 truncate text-[13px] text-[#eceef2]">{f.file.name}</span>
            <span className="font-mono text-[11.5px] text-[#6c717c]">{f.seconds === null ? "" : clock(f.seconds)}</span>
            {/* A hidden player reads the song's length. */}
            <audio src={f.url} preload="metadata" onLoadedMetadata={(ev) => setSeconds(i, ev.currentTarget.duration)} className="hidden" />
            <span className="flex-1" />
            <span className="hidden text-[12px] text-[#8fd6c4] sm:inline">{d.cutToBeat}</span>
            {removeButton(i, f.file.name, true)}
          </div>
        ))}
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

      <div className="flex flex-col gap-4 rounded-2xl bg-[linear-gradient(180deg,#15171c,#111317)] px-4 pb-3.5 pt-[18px] shadow-[0_0_0_1px_rgba(255,255,255,0.07),0_24px_60px_-30px_rgba(0,0,0,0.9)] sm:pl-5 sm:pr-[18px]">
        <label htmlFor="dc-brief" className="text-[13px] font-semibold text-[#d6d9df]">
          {d.briefLabel}
        </label>
        <textarea
          id="dc-brief"
          rows={2}
          value={brief}
          maxLength={4000}
          onChange={(e) => setBrief(e.target.value)}
          placeholder={d.briefPlaceholder}
          className="resize-none border-0 bg-transparent p-0 text-[17px] leading-normal text-[#eceef2] outline-none placeholder:text-[#565a64] lg:text-[18px]"
        />
        <div className="flex flex-wrap items-center gap-x-5 gap-y-3">
          <Segmented label={d.shape}>
            {ASPECTS.map((a) => (
              <SegmentButton key={a} on={aspect === a} onClick={() => setAspect(a)}>
                {a !== "auto" && <ShapeIcon aspect={a} />}
                {a === "auto" ? d.auto : a}
              </SegmentButton>
            ))}
          </Segmented>
          <Segmented label={d.length}>
            {LENGTHS.map((n) => (
              <SegmentButton key={String(n)} on={length === n} onClick={() => setLength(n)}>
                {n === null ? d.itsCall : formatMsg(d.seconds, { n })}
              </SegmentButton>
            ))}
          </Segmented>
          <button
            type="button"
            onClick={cut}
            disabled={files.length === 0 || busy !== null}
            className="flex h-[46px] w-full items-center justify-center gap-2.5 rounded-xl bg-[#e0a468] px-[26px] text-[15px] font-bold text-[#1a0f07] shadow-[0_10px_30px_-12px_rgba(224,164,104,0.6)] transition-opacity disabled:opacity-40 disabled:shadow-none sm:ml-auto sm:w-auto"
          >
            {!busy && (
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true">
                <circle cx="6" cy="6" r="3" />
                <circle cx="6" cy="18" r="3" />
                <path d="M20 4L8.1 15.9M14.5 14.5L20 20M8.1 8.1L12 12" />
              </svg>
            )}
            {busy ?? d.cutIt}
          </button>
        </div>
      </div>
      <p className="-mt-3.5 text-right font-mono text-[11.5px] text-[#6c717c]">{d.leave}</p>
      {problem && <p className="text-sm text-[#f0a3a3]">{problem}</p>}
    </div>
  );
}

function Segmented({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div role="group" aria-label={label} className="flex items-center gap-2.5">
      <span className="text-[12px] text-[#6c717c]">{label}</span>
      <div className="flex flex-wrap gap-0.5 rounded-[9px] bg-[#0b0c0f] p-[3px]">{children}</div>
    </div>
  );
}

function SegmentButton({ on, onClick, children }: { on: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={onClick}
      className={`flex h-[34px] items-center gap-1.5 rounded-[7px] px-2.5 text-[12px] sm:h-[30px] ${on ? "bg-[#262930] text-[#eceef2]" : "text-[#8b909b] hover:text-[#eceef2]"}`}
    >
      {children}
    </button>
  );
}

function ShapeIcon({ aspect }: { aspect: string }) {
  const [w, h] = aspect === "9:16" ? [7, 12] : aspect === "16:9" ? [13, 7] : [9, 9];
  return <span className="rounded-[2px] border-[1.5px] border-current" style={{ width: w, height: h }} aria-hidden="true" />;
}

// ------------------------------------------------------------- the monitor

const STEPS = ["reading", "watching", "cutting"] as const;

/**
 * The middle column: the video(s) the editor delivered — tabs when it made
 * several (shorts from one pile) — or the steps while it works.
 */
function Screen({ detail, loading, startedAt }: { detail: EditDetail | null; loading: boolean; startedAt: string | null }) {
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
      <div className="relative flex min-h-[420px] flex-1 items-center justify-center rounded-[14px] bg-[#060709] p-4 lg:min-h-[440px]">
        {shown?.url ? (
          <div className="flex w-full flex-col items-center gap-3">
            <div className="flex w-full flex-wrap items-baseline justify-between gap-2 px-1">
              <span className="font-mono text-xs text-[#8b909b]">
                {formatMsg(d.cut, { n: shown.turn })} · {shown.aspect}
                {shown.title ? ` · ${shown.title}` : ""}
              </span>
            </div>
            <video
              key={shown.url}
              // Half a second in: an edit that opens on a fade shows black at 0.
              src={`${shown.url}#t=0.5`}
              controls
              playsInline
              preload="metadata"
              className={shown.aspect === "9:16" ? "max-h-[520px] w-auto max-w-full rounded-[8px]" : "max-h-[520px] w-full rounded-[8px]"}
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
                    className={`min-h-9 rounded-lg px-3 text-xs ${
                      i === Math.min(pick, outputs.length - 1) ? "bg-[#23262d] text-[#eceef2]" : "text-[#8b909b] hover:text-[#eceef2]"
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
          <Progress detail={detail} startedAt={startedAt} />
        ) : detail?.stage === "failed" ? (
          <div className="max-w-sm text-center">
            <p className="font-semibold text-[#eceef2]">{d.phase.failed}</p>
            {detail.error && <p className="mt-2 text-sm text-[#a4a9b4]">{detail.error}</p>}
          </div>
        ) : loading ? null : (
          <p className="text-sm text-[#6c717c]">{d.empty}</p>
        )}
      </div>
      {shown?.url && <FrameStrip url={shown.url} seconds={shown.seconds} />}
    </>
  );
}

/**
 * While Opus works: the three steps across, what it is doing now in its own
 * words, how long it has been at it, and the moments seen while this page
 * was open (only those: the page keeps no history of them).
 */
function Progress({ detail, startedAt }: { detail: EditDetail; startedAt: string | null }) {
  const { t } = useLocale();
  const d = t.directorsCut;
  const at = STEPS.indexOf(detail.phase as (typeof STEPS)[number]);
  const now = useNow(1000);
  const since = startedAt ? Date.parse(startedAt) : NaN;
  const elapsed = Number.isFinite(since) ? Math.max(0, (now - since) / 1000) : null;
  const doing = detail.phase === "cutting" ? detail.activity?.text || (detail.activity?.code ? d.activity[detail.activity.code] : null) : null;
  const headline = doing ?? (at >= 0 ? d.phase[STEPS[at]] : d.phase.reading);

  // A line each time what it is doing changes, stamped with the time since the edit started.
  const [seen, setSeen] = useState<{ at: number | null; text: string }[]>([]);
  useEffect(() => {
    if (!doing) return;
    setSeen((cur) => (cur.at(-1)?.text === doing ? cur : [...cur.slice(-4), { at: elapsed, text: doing }]));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- a new line only when the words change
  }, [doing]);

  return (
    <div className="flex w-full max-w-[720px] flex-col items-center gap-8 py-6">
      <ol className="flex flex-wrap items-center justify-center gap-x-3.5 gap-y-2 text-[13px] lg:flex-nowrap lg:whitespace-nowrap">
        {STEPS.map((step, i) => (
          <li key={step} className="flex items-center gap-3.5">
            {i > 0 && <span className="hidden h-px w-9 bg-[rgba(255,255,255,0.12)] sm:block" aria-hidden="true" />}
            <span className={`flex items-center gap-2 ${i === at ? "font-semibold text-[#eceef2]" : "text-[#8b909b]"}`}>
              {i < at ? (
                <span className="flex h-5 w-5 items-center justify-center rounded-full bg-[rgba(79,182,160,0.15)]" aria-hidden="true">
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="#4fb6a0" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M5 12l5 5L20 7" />
                  </svg>
                </span>
              ) : i === at ? (
                <span className="flex h-5 w-5 items-center justify-center rounded-full shadow-[inset_0_0_0_2px_#e0a468]" aria-hidden="true">
                  <span className="h-2 w-2 animate-pulse rounded-full bg-[#e0a468]" />
                </span>
              ) : (
                <span className="h-5 w-5 rounded-full shadow-[inset_0_0_0_1.5px_rgba(255,255,255,0.15)]" aria-hidden="true" />
              )}
              {d.phase[step]}
              {step === "watching" && i === at && detail.clips.length > 1 && (
                <span className="font-mono text-xs font-normal text-[#6c717c]">
                  {detail.analyzed}/{detail.clips.length}
                </span>
              )}
            </span>
          </li>
        ))}
      </ol>
      <div className="flex flex-col items-center gap-3.5 text-center">
        <p className="line-clamp-3 font-serif text-[24px] leading-snug text-[#eceef2] lg:text-[30px]">{headline}</p>
        {/* No percentage: nobody knows how far along a cut is, so the bar only says it is moving. */}
        <div className="h-[3px] w-[300px] max-w-full overflow-hidden rounded-sm bg-[#1c1e24]" aria-hidden="true">
          <div className="h-full w-24 animate-[dc-sweep_1.8s_ease-in-out_infinite] rounded-sm bg-[linear-gradient(90deg,rgba(224,164,104,0),#e0a468,rgba(224,164,104,0))]" />
        </div>
        <style>{`@keyframes dc-sweep{0%{transform:translateX(-100px)}100%{transform:translateX(300px)}}`}</style>
        {elapsed !== null && <span className="font-mono text-xs text-[#6c717c]">{formatMsg(d.soFar, { time: clock(elapsed) })}</span>}
      </div>
      {/* Only once there is more than the headline already says. */}
      {seen.length > 1 && (
        <ol className="w-full max-w-[420px] overflow-hidden rounded-xl bg-[#0e0f13] shadow-[0_0_0_1px_rgba(255,255,255,0.05)]">
          {seen.map((s, i) => (
            <li key={i} className={`flex gap-3 px-3.5 py-2.5 text-[12.5px] ${i > 0 ? "border-t border-[rgba(255,255,255,0.04)]" : ""}`}>
              <span className={`w-11 shrink-0 font-mono ${i === seen.length - 1 ? "text-[#e0a468]" : "text-[#565a64]"}`}>{s.at !== null ? clock(s.at) : ""}</span>
              <span className={`min-w-0 truncate ${i === seen.length - 1 ? "text-[#eceef2]" : "text-[#8b909b]"}`}>{s.text}</span>
            </li>
          ))}
        </ol>
      )}
      <p className="font-mono text-[11px] text-[#6c717c]">{d.leave}</p>
    </div>
  );
}

function useNow(every: number): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), every);
    return () => clearInterval(timer);
  }, [every]);
  return now;
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
    <div className="mt-3 flex flex-col gap-3 rounded-[14px] bg-[#0e0f13] px-4 py-3.5 shadow-[0_0_0_1px_rgba(255,255,255,0.06)]">
      <div className="flex justify-between font-mono text-[11px] text-[#6c717c]">
        <span className="uppercase tracking-[0.08em]">{d.theCut}</span>
        <span>{clock(seconds)}</span>
      </div>
      <div className="grid h-16 grid-cols-8 gap-1 overflow-hidden rounded-md">
        {times.map((_, i) => (
          <div key={i} className="overflow-hidden rounded-[5px] bg-[#15171c]">
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

/**
 * Opus's panel: the conversation (your brief and changes on the right, its
 * notes in its own serif voice) and the box to ask for a change, with a song
 * if the change wants one. A phone draws the two parts apart — the
 * conversation in its tab, the box at the foot of the bay.
 */
function Notes({ detail, guard, onSent, part = "all" }: { detail: EditDetail | null; guard: Guard; onSent: () => Promise<void>; part?: DirectorPart }) {
  const { t } = useLocale();
  const d = t.directorsCut;
  const working = detail !== null && WORKING.has(detail.stage);
  const lastIsYou = detail?.notes.at(-1)?.role === "you";
  // Opens on the newest words, like any conversation, and follows each new note.
  const scroller = useRef<HTMLDivElement>(null);
  const count = detail?.notes.length ?? 0;
  useEffect(() => {
    const el = scroller.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [count, detail?.id]);
  const thread = (
    <div ref={scroller} className="flex flex-1 flex-col gap-3.5 overflow-y-auto p-4">
      {(detail?.notes ?? []).map((n, i) =>
        n.role === "editor" ? (
          <p key={i} className="font-serif text-[15px] leading-[1.55] text-[#cfd2d8]">
            {n.text}
          </p>
        ) : (
          <p key={i} className="flex max-w-[84%] flex-col gap-1 self-end rounded-[12px_12px_4px_12px] bg-[#1c1e24] px-[13px] py-2.5 text-[13px] leading-[1.45] text-[#eceef2]">
            {n.song && <span className="font-mono text-xs text-[#e0a468]">♪ {n.song}</span>}
            {n.text && <span>{n.text}</span>}
          </p>
        ),
      )}
      {working && (lastIsYou || detail.notes.length === 0) && (
        <p className="font-mono text-xs text-[#e0a468]">
          <span aria-hidden="true" className="mr-1.5 animate-pulse">
            ●
          </span>
          {d.phase[detail.phase as keyof typeof d.phase] ?? ""}
        </p>
      )}
      {detail?.stage === "done" && (
        <Link href="/app/history" className="text-[13px] text-[#e0a468] hover:text-[#f0bd86]">
          {d.openHistory}
        </Link>
      )}
    </div>
  );
  if (part === "thread") return thread;
  if (part === "composer")
    return (
      <div className="px-3 pb-3 pt-2.5">
        <Composer detail={detail} guard={guard} onSent={onSent} row />
      </div>
    );
  const composer = <Composer detail={detail} guard={guard} onSent={onSent} />;
  return (
    <div className="flex h-full min-h-0 flex-col">
      {thread}
      <div className="px-3.5 pb-3.5">{composer}</div>
    </div>
  );
}

/** The box to ask for a change; `row` lays it out on one line (a phone's foot). */
function Composer({ detail, guard, onSent, row = false }: { detail: EditDetail | null; guard: Guard; onSent: () => Promise<void>; row?: boolean }) {
  const { t } = useLocale();
  const d = t.directorsCut;
  const [text, setText] = useState("");
  // A song to re-cut to, sent with the change (the editor only uses music the customer brings).
  const [song, setSong] = useState<File | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const songInput = useRef<HTMLInputElement>(null);
  const canAsk = detail?.stage === "done";
  const working = detail !== null && WORKING.has(detail.stage);

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

  if (working) {
    return <div className="rounded-[14px] bg-[#121418] px-3.5 py-3 text-[13px] text-[#6c717c] shadow-[0_0_0_1px_rgba(255,255,255,0.05)]">{d.askLater}</div>;
  }

  const field = (
    <>
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
        className={`min-w-0 border-0 bg-transparent text-[#eceef2] outline-none placeholder:text-[#6c717c] disabled:opacity-50 ${row ? "flex-1 text-[14.5px]" : "py-0.5 text-[13.5px]"}`}
      />
    </>
  );
  const songButtons = (
    <>
      <button
        type="button"
        onClick={() => songInput.current?.click()}
        disabled={!canAsk || busy !== null}
        aria-label={d.addSong}
        title={d.addSong}
        className={`flex shrink-0 items-center gap-1.5 rounded-lg text-xs text-[#a4a9b4] hover:text-[#eceef2] disabled:opacity-40 ${
          row ? "h-10 min-w-10 justify-center px-2.5" : "h-[30px] border border-[rgba(255,255,255,0.08)] px-2.5 hover:border-[rgba(224,164,104,0.5)]"
        }`}
      >
        <svg width={row ? 16 : 13} height={row ? 16 : 13} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M9 18V5l11-2v13" />
          <circle cx="6" cy="18" r="3" />
          <circle cx="17" cy="16" r="3" />
        </svg>
        {song && <span className={`truncate text-[#e0a468] ${row ? "max-w-[90px]" : "max-w-[150px]"}`}>{song.name}</span>}
      </button>
      {song && (
        <button
          type="button"
          onClick={() => setSong(null)}
          disabled={busy !== null}
          aria-label={d.removeSong}
          className={`flex shrink-0 items-center justify-center rounded-lg text-[#a4a9b4] hover:bg-[rgba(255,255,255,0.06)] ${row ? "h-10 w-8" : "h-[30px] w-[30px]"}`}
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true">
            <path d="M6 6l12 12M18 6 6 18" />
          </svg>
        </button>
      )}
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
    </>
  );
  const sendButton = (
    <button
      type="submit"
      aria-label={d.send}
      disabled={!canAsk || busy !== null || (!text.trim() && !song)}
      className={`flex shrink-0 items-center justify-center bg-[#e0a468] text-[#1a0f07] disabled:opacity-40 ${row ? "h-10 w-10 rounded-xl" : "h-8 w-8 rounded-[9px]"}`}
    >
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden="true">
        <path d="M12 19V5M6 11l6-6 6 6" />
      </svg>
    </button>
  );
  const box = "bg-[#15171c] shadow-[0_0_0_1px_rgba(255,255,255,0.07)] focus-within:shadow-[0_0_0_1px_rgba(224,164,104,0.5)]";
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    void send();
  };

  return (
    <div className="flex flex-col gap-2">
      {row ? (
        <form className={`flex h-[52px] items-center gap-1 rounded-2xl px-1.5 ${box}`} onSubmit={submit}>
          {songButtons}
          {field}
          {sendButton}
        </form>
      ) : (
        <form className={`flex flex-col gap-2.5 rounded-[14px] py-2.5 pl-3.5 pr-2.5 ${box}`} onSubmit={submit}>
          {field}
          <div className="flex items-center gap-1.5">
            {songButtons}
            <span className="flex-1" />
            {busy && <span className="truncate font-mono text-[11px] text-[#a4a9b4]">{busy}</span>}
            {sendButton}
          </div>
        </form>
      )}
      {row && busy && <p className="truncate px-1 font-mono text-[11px] text-[#a4a9b4]">{busy}</p>}
      {problem && <p className="text-sm text-[#f0a3a3]">{problem}</p>}
    </div>
  );
}

function clock(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}
