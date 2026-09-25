"use client";

// The Edit Bay — board A, the operator's pick (2026-09-25): the project Opus
// made, open like a professional editor. Footage and sounds on the left, the
// program monitor in the middle, Opus (Director) and the clip inspector on
// the right, and a full-width multi-track timeline underneath. Opus makes the
// first cut; you trim, move, split and re-level it here; every change saves
// itself and the monitor plays the working copy.

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useLocale } from "@/lib/i18n/provider";
import type { EditDetail, EditSummary } from "@/lib/editor/actions";
import { splitClip, type TimelineClip } from "@/lib/editor/timeline";
import { useProject } from "./use-project";
import { useMediaPreviews } from "./media-previews";
import { Icon, Monitor, timecode, type MonitorHandle } from "./monitor";
import { TimelineView } from "./timeline-view";

const MIN_PPS = 8;
const MAX_PPS = 160;

export function EditBay({
  edits,
  selectedId,
  onSelectEdit,
  detail,
  director,
  newEdit,
  fallback,
}: {
  edits: EditSummary[];
  selectedId: string | null;
  onSelectEdit: (id: string) => void;
  detail: EditDetail | null;
  /** The Director tab: Opus's notes and "ask for a change". */
  director: ReactNode;
  /** The brief form, for a new edit; it calls `close` once the edit has started. */
  newEdit: (close: () => void) => ReactNode;
  /** The plain monitor (progress while Opus works, or a video with no project). */
  fallback: ReactNode;
}) {
  const { t } = useLocale();
  const d = t.directorsCut;
  const b = d.bay;
  const [pick, setPick] = useState(0);
  const [showNew, setShowNew] = useState(false);
  const [rightTab, setRightTab] = useState<"director" | "inspect">("director");

  const latestTurn = detail?.outputs[0]?.turn ?? 0;
  const videos = useMemo(() => (detail?.outputs ?? []).filter((o) => o.turn === latestTurn), [detail, latestTurn]);
  const video = videos[Math.min(pick, Math.max(0, videos.length - 1))] ?? null;
  const editable = detail?.stage === "done" && video?.editable === true;

  useEffect(() => setPick(0), [detail?.id, latestTurn]);

  return (
    <div data-directors-cut className="flex h-[calc(100dvh-7rem)] min-h-[720px] flex-col overflow-hidden rounded-[16px] bg-[#07080b] text-[#c6c9d1] shadow-[0_0_0_1px_rgba(255,255,255,0.08)]">
      <style>{`@media (min-width:1024px){[data-app-content]:has(> [data-directors-cut]){max-width:1480px}}`}</style>
      {/* Top bar */}
      <div className="flex h-12 shrink-0 items-center gap-3 border-b border-[rgba(255,255,255,0.07)] bg-[#0d0e13] px-4">
        <span className="flex h-[22px] w-[22px] items-center justify-center rounded-md bg-[#e0a468] text-[#1a0f07]" aria-hidden="true">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
            <rect x="3" y="4" width="18" height="16" rx="2" />
            <path d="M7 4v16M17 4v16M3 9h4M3 15h4M17 9h4M17 15h4" />
          </svg>
        </span>
        <span className="font-display text-[15px] font-bold tracking-tight text-[#ecedf1]">{d.title}</span>
        <span className="h-5 w-px bg-[rgba(255,255,255,0.07)]" />
        <label className="sr-only" htmlFor="bay-edit">
          {b.yourEdits}
        </label>
        <select
          id="bay-edit"
          value={selectedId ?? ""}
          onChange={(e) => onSelectEdit(e.target.value)}
          className="h-8 max-w-[280px] truncate rounded-lg border border-[rgba(255,255,255,0.08)] bg-[#13151b] px-2 text-[13px] text-[#ecedf1]"
        >
          {edits.map((e) => (
            <option key={e.id} value={e.id}>
              {(e.brief || e.summary || e.clipNames.join(", ")).slice(0, 60)}
            </option>
          ))}
        </select>
        {videos.length > 1 && (
          <div role="tablist" aria-label={d.versions} className="flex gap-1">
            {videos.map((v, i) => (
              <button
                key={v.generationId}
                type="button"
                role="tab"
                aria-selected={i === pick}
                onClick={() => setPick(i)}
                className={`h-8 max-w-[180px] truncate rounded-lg px-2.5 text-[12px] ${i === pick ? "bg-[rgba(224,164,104,0.16)] text-[#ecedf1]" : "text-[#9aa0ad] hover:text-[#ecedf1]"}`}
              >
                {v.title || formatCut(d.cut, v.turn)}
              </button>
            ))}
          </div>
        )}
        <div className="flex-1" />
        {video?.url && (
          <a href={video.url} download className="text-[13px] text-[#e0a468] hover:text-[#f0bd86]">
            {d.download}
          </a>
        )}
        <button
          type="button"
          onClick={() => setShowNew(true)}
          className="flex h-8 items-center gap-1.5 rounded-lg border border-[rgba(255,255,255,0.1)] px-3 text-[13px] text-[#ecedf1] hover:border-[rgba(224,164,104,0.5)]"
        >
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true">
            <path d="M12 5v14M5 12h14" />
          </svg>
          {b.newEdit}
        </button>
      </div>

      {editable && detail && video ? (
        <ProjectBay
          key={`${detail.id}:${video.generationId}`}
          detail={detail}
          generationId={video.generationId}
          aspect={video.aspect}
          director={director}
          rightTab={rightTab}
          setRightTab={setRightTab}
        />
      ) : (
        <div className="grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-[minmax(0,1fr)_340px]">
          <div className="flex min-h-0 flex-col overflow-y-auto p-4">
            {fallback}
            {detail?.stage === "done" && video && !video.editable && (
              <p className="mx-auto mt-4 max-w-md text-center text-[13px] leading-relaxed text-[#9aa0ad]">{b.notEditable}</p>
            )}
          </div>
          <div className="min-h-0 border-l border-[rgba(255,255,255,0.07)] bg-[#0d0e13]">{director}</div>
        </div>
      )}

      {showNew && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-[rgba(4,5,6,0.72)] p-4" role="dialog" aria-modal="true" aria-label={b.newEdit}>
          <div className="relative max-h-[90dvh] w-full max-w-3xl overflow-y-auto rounded-[20px] bg-[#0b0c10] p-6 shadow-[0_0_0_1px_rgba(255,255,255,0.1)]">
            <button
              type="button"
              aria-label={b.close}
              onClick={() => setShowNew(false)}
              className="absolute right-3 top-3 flex h-9 w-9 items-center justify-center rounded-full text-[#9aa0ad] hover:bg-[rgba(255,255,255,0.06)]"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true">
                <path d="M6 6l12 12M18 6 6 18" />
              </svg>
            </button>
            {newEdit(() => setShowNew(false))}
          </div>
        </div>
      )}
    </div>
  );
}

function formatCut(template: string, n: number) {
  return template.replace("{n}", String(n));
}

function ProjectBay({
  detail,
  generationId,
  aspect,
  director,
  rightTab,
  setRightTab,
}: {
  detail: EditDetail;
  generationId: string;
  aspect: string;
  director: ReactNode;
  rightTab: "director" | "inspect";
  setRightTab: (t: "director" | "inspect") => void;
}) {
  const { t } = useLocale();
  const d = t.directorsCut;
  const b = d.bay;
  const clipNames = useMemo(() => detail.clips.map((c) => c.name), [detail.clips]);
  const project = useProject(detail.id, generationId, clipNames);
  const ready = project.state.status === "ready" ? project.state : null;
  const previews = useMediaPreviews(ready?.base ?? null, ready?.model ?? null);
  const monitor = useRef<MonitorHandle | null>(null);
  const timelineBox = useRef<HTMLDivElement>(null);
  const [time, setTime] = useState(0);
  const [selected, setSelected] = useState<string | null>(null);
  const [tool, setTool] = useState<"select" | "razor">("select");
  const [snapping, setSnapping] = useState(true);
  const [pps, setPps] = useState(40);
  const [leftTab, setLeftTab] = useState<"footage" | "sound" | "titles">("footage");

  const model = ready?.model ?? null;
  const clips = useMemo(() => model?.lanes.flatMap((l) => l.clips) ?? [], [model]);
  const selectedClip = clips.find((c) => c.id === selected) ?? null;
  const cutPoints = useMemo(() => (model?.lanes.find((l) => l.key === "story")?.clips ?? []).map((c) => c.start).filter((s) => s > 0), [model]);

  // Fit the whole video in the timeline's width when it first opens.
  const fitted = useRef(false);
  const fit = useCallback(() => {
    const w = (timelineBox.current?.clientWidth ?? 1000) - 172 - 40;
    if (model && model.duration > 0) setPps(Math.max(MIN_PPS, Math.min(MAX_PPS, w / model.duration)));
  }, [model]);
  useEffect(() => {
    if (model && !fitted.current) {
      fitted.current = true;
      fit();
    }
  }, [model, fit]);

  const doSplit = useCallback(
    (clip: TimelineClip, at: number) => {
      const el = project.element(clip.id);
      if (!el) return;
      const out = splitClip(clip, at, { tag: el.tag, attributes: el.attributes, classNames: el.classNames }, `cut-${Math.random().toString(36).slice(2, 8)}`);
      if (out) project.split(out.first, out.secondHtml, project.parentOf(clip.id));
    },
    [project],
  );

  const onTime = useCallback((v: number) => setTime(v), []);

  // Keyboard: space plays, V/B pick the tool, S splits at the playhead, Delete removes, ⌘Z / ⇧⌘Z.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || (e.target as HTMLElement | null)?.isContentEditable) return;
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key.toLowerCase() === "z") {
        e.preventDefault();
        if (e.shiftKey) project.redo();
        else project.undo();
      } else if (e.key === " ") {
        e.preventDefault();
        monitor.current?.toggle();
      } else if (e.key === "v") setTool("select");
      else if (e.key === "b") setTool("razor");
      else if (e.key === "s" && selectedClip) doSplit(selectedClip, time);
      else if ((e.key === "Delete" || e.key === "Backspace") && selected) {
        project.remove([selected]);
        setSelected(null);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [project, selected, selectedClip, time, doSplit]);

  const saving = ready?.saving ?? "idle";
  const soundClips = clips.filter((c) => c.kind === "audio");
  const titleClips = clips.filter((c) => c.kind === "text");

  return (
    <>
      <div className="grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-[260px_minmax(0,1fr)_320px]">
        {/* Left: footage, sounds, titles */}
        <div className="hidden min-h-0 flex-col border-r border-[rgba(255,255,255,0.07)] bg-[#0d0e13] lg:flex">
          <Tabs value={leftTab} onChange={(v) => setLeftTab(v as typeof leftTab)} items={[["footage", b.footage], ["sound", b.sound], ["titles", b.titles]]} />
          <div className="min-h-0 flex-1 overflow-y-auto p-3">
            {leftTab === "footage" && (
              <ul className="flex flex-col gap-2">
                {detail.clips.map((c, i) => {
                  const used = clips.some((x) => x.footage === i);
                  return (
                    <li key={i} className="flex items-center gap-2.5 rounded-lg bg-[#13151b] px-2.5 py-2">
                      <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: used ? "#7aa2d6" : "rgba(255,255,255,0.12)" }} aria-hidden="true" />
                      <span className="min-w-0 flex-1 truncate text-[12px] text-[#ecedf1]">{c.name}</span>
                      <span className="font-mono text-[11px] text-[#6b6f7a]">{c.duration !== null ? timecode(c.duration).slice(0, 5) : ""}</span>
                    </li>
                  );
                })}
                <li className="px-1 pt-1 text-[11px] leading-relaxed text-[#6b6f7a]">{b.usedHint}</li>
              </ul>
            )}
            {leftTab === "sound" && <ClipList clips={soundClips} empty={b.noSound} onPick={(c) => (setSelected(c.id), monitor.current?.seek(c.start))} selected={selected} />}
            {leftTab === "titles" && <ClipList clips={titleClips} empty={b.noTitles} onPick={(c) => (setSelected(c.id), monitor.current?.seek(c.start))} selected={selected} />}
          </div>
        </div>

        {/* Program monitor */}
        <div className="min-h-[280px]">
          {ready ? (
            <Monitor
              base={ready.base}
              version={ready.previewVersion}
              aspect={aspect}
              duration={ready.model.duration}
              onTime={onTime}
              handleRef={monitor}
              cutPoints={cutPoints}
              labels={{ play: b.play, pause: b.pause, prevCut: b.prevCut, nextCut: b.nextCut, loop: b.loop, fullscreen: b.fullscreen, program: b.program }}
            />
          ) : (
            <div className="flex h-full items-center justify-center p-6 text-center text-[13px] text-[#9aa0ad]">
              {project.state.status === "error" ? project.state.message : b.opening}
            </div>
          )}
        </div>

        {/* Right: Director / Inspect */}
        <div className="flex min-h-0 flex-col border-l border-[rgba(255,255,255,0.07)] bg-[#0d0e13]">
          <Tabs value={rightTab} onChange={(v) => setRightTab(v as "director" | "inspect")} items={[["director", b.director], ["inspect", b.inspect]]} />
          <div className="min-h-0 flex-1 overflow-y-auto">
            {rightTab === "director" ? (
              director
            ) : selectedClip ? (
              <Inspector
                clip={selectedClip}
                onVolume={(v) => project.setVolume(selectedClip.id, v)}
                onSplit={() => doSplit(selectedClip, time)}
                onDelete={() => {
                  project.remove([selectedClip.id]);
                  setSelected(null);
                }}
                canSplit={(selectedClip.kind === "video" || selectedClip.kind === "audio") && time > selectedClip.start + 0.1 && time < selectedClip.end - 0.1}
              />
            ) : (
              <p className="p-5 text-[13px] leading-relaxed text-[#9aa0ad]">{b.nothingSelected}</p>
            )}
          </div>
        </div>
      </div>

      {/* Timeline */}
      <div ref={timelineBox} className="flex h-[330px] shrink-0 flex-col border-t border-[rgba(255,255,255,0.07)] bg-[#07080b]">
        <div className="flex h-10 shrink-0 items-center gap-1 border-b border-[rgba(255,255,255,0.07)] bg-[#0d0e13] px-3">
          <ToolButton label={b.select} on={tool === "select"} onClick={() => setTool("select")} path="M5 3l6.5 17 2.5-7.5L21.5 10z" />
          <ToolButton label={b.razor} on={tool === "razor"} onClick={() => setTool("razor")} path="M6 3a3 3 0 1 0 0 6 3 3 0 0 0 0-6zM6 15a3 3 0 1 0 0 6 3 3 0 0 0 0-6zM20 4 8.1 15.9M14.5 14.5 20 20M8.1 8.1 12 12" />
          <span className="mx-1.5 h-[18px] w-px bg-[rgba(255,255,255,0.07)]" />
          <ToolButton label={b.snapping} on={snapping} onClick={() => setSnapping((s) => !s)} path="M5 4h4v7a3 3 0 0 0 6 0V4h4v7a7 7 0 0 1-14 0zM5 8h4M15 8h4" />
          <span className="mx-1.5 h-[18px] w-px bg-[rgba(255,255,255,0.07)]" />
          <ToolButton label={b.undo} on={false} disabled={!ready?.canUndo} onClick={project.undo} path="M9 14 4 9l5-5M4 9h10.5a5.5 5.5 0 0 1 0 11H11" />
          <ToolButton label={b.redo} on={false} disabled={!ready?.canRedo} onClick={project.redo} path="M15 14l5-5-5-5M20 9H9.5a5.5 5.5 0 0 0 0 11H13" />
          <div className="flex flex-1 justify-center font-mono text-[11px] text-[#6b6f7a]" aria-live="polite">
            {saving === "pending" || saving === "saving" ? b.saving : saving === "saved" ? b.saved : saving === "failed" ? b.saveFailed : ""}
          </div>
          <ToolButton label={b.zoomOut} on={false} onClick={() => setPps((p) => Math.max(MIN_PPS, p / 1.4))} path="M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zM8 11h6M20 20l-4-4" />
          <input
            type="range"
            aria-label={b.zoom}
            min={Math.log(MIN_PPS)}
            max={Math.log(MAX_PPS)}
            step={0.01}
            value={Math.log(pps)}
            onChange={(e) => setPps(Math.exp(Number(e.target.value)))}
            className="w-28 accent-[#c6c9d1]"
          />
          <ToolButton label={b.zoomIn} on={false} onClick={() => setPps((p) => Math.min(MAX_PPS, p * 1.4))} path="M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zM8 11h6M11 8v6M20 20l-4-4" />
          <button type="button" onClick={fit} className="ml-1 h-7 rounded-md border border-[rgba(255,255,255,0.08)] px-2.5 font-mono text-[11px] text-[#9aa0ad] hover:text-[#ecedf1]">
            {b.fit}
          </button>
        </div>
        {model ? (
          <TimelineView
            model={model}
            time={time}
            pps={pps}
            tool={tool}
            snapping={snapping}
            selected={selected}
            previews={previews}
            onSeek={(v) => monitor.current?.seek(v)}
            onSelect={(id) => {
              setSelected(id);
              if (id) setRightTab("inspect");
            }}
            onEdits={project.applyTimings}
            onSplit={doSplit}
            labels={{ lanes: b.lanes, composeHint: b.musicHint }}
          />
        ) : (
          <div className="flex flex-1 items-center justify-center text-[13px] text-[#6b6f7a]">{project.state.status === "error" ? "" : b.opening}</div>
        )}
      </div>
    </>
  );
}

function Tabs({ value, onChange, items }: { value: string; onChange: (v: string) => void; items: [string, string][] }) {
  return (
    <div role="tablist" className="flex shrink-0 gap-1 border-b border-[rgba(255,255,255,0.07)] px-2.5 pt-2">
      {items.map(([k, label]) => (
        <button
          key={k}
          type="button"
          role="tab"
          aria-selected={value === k}
          onClick={() => onChange(k)}
          className={`h-8 border-b-2 px-3 text-[13px] ${value === k ? "border-[#e0a468] font-semibold text-[#ecedf1]" : "border-transparent text-[#9aa0ad] hover:text-[#ecedf1]"}`}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

function ToolButton({ label, on, onClick, path, disabled = false }: { label: string; on: boolean; onClick: () => void; path: string; disabled?: boolean }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      aria-pressed={on}
      disabled={disabled}
      onClick={onClick}
      className={`flex h-8 w-8 items-center justify-center rounded-lg border disabled:opacity-35 ${on ? "border-[rgba(224,164,104,0.45)] bg-[rgba(224,164,104,0.14)] text-[#e0a468]" : "border-transparent text-[#9aa0ad] hover:text-[#ecedf1]"}`}
    >
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d={path} />
      </svg>
    </button>
  );
}

function ClipList({ clips, empty, onPick, selected }: { clips: TimelineClip[]; empty: string; onPick: (c: TimelineClip) => void; selected: string | null }) {
  if (clips.length === 0) return <p className="px-1 text-[12px] leading-relaxed text-[#6b6f7a]">{empty}</p>;
  return (
    <ul className="flex flex-col gap-1.5">
      {clips.map((c) => (
        <li key={c.id}>
          <button
            type="button"
            onClick={() => onPick(c)}
            className={`flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left ${selected === c.id ? "bg-[rgba(224,164,104,0.12)]" : "bg-[#13151b] hover:bg-[#171a21]"}`}
          >
            <span className="min-w-0 flex-1 truncate text-[12px] text-[#ecedf1]">{c.label}</span>
            <span className="font-mono text-[10px] text-[#6b6f7a]">{timecode(c.start).slice(0, 5)}</span>
          </button>
        </li>
      ))}
    </ul>
  );
}

function Inspector({
  clip,
  onVolume,
  onSplit,
  onDelete,
  canSplit,
}: {
  clip: TimelineClip;
  onVolume: (v: number) => void;
  onSplit: () => void;
  onDelete: () => void;
  canSplit: boolean;
}) {
  const { t } = useLocale();
  const b = t.directorsCut.bay;
  const [vol, setVol] = useState(clip.volume ?? 1);
  useEffect(() => setVol(clip.volume ?? 1), [clip.id, clip.volume]);
  const rows: [string, string][] = [
    [b.start, timecode(clip.start)],
    [b.end, timecode(clip.end)],
    [b.length, `${(clip.end - clip.start).toFixed(2)} s`],
  ];
  if (clip.kind === "video" || clip.kind === "audio") rows.push([b.fromSource, `${clip.mediaStart.toFixed(2)} s`]);
  return (
    <div className="flex flex-col gap-4 p-4">
      <div>
        <p className="font-mono text-[11px] uppercase tracking-[0.08em] text-[#6b6f7a]">{b.lanes[clip.lane] ?? clip.lane}</p>
        <p className="mt-1 break-words text-[14px] text-[#ecedf1]">{clip.label}</p>
      </div>
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-[12px]">
        {rows.map(([k, v]) => (
          <div key={k} className="contents">
            <dt className="text-[#9aa0ad]">{k}</dt>
            <dd className="text-right font-mono text-[#ecedf1] tabular-nums">{v}</dd>
          </div>
        ))}
      </dl>
      {clip.volume !== null && (clip.kind === "audio" || clip.kind === "video") && (
        <div className="flex flex-col gap-1.5">
          <label htmlFor="bay-volume" className="flex justify-between text-[12px] text-[#9aa0ad]">
            <span>{b.volume}</span>
            <span className="font-mono text-[#ecedf1]">{Math.round(vol * 100)}%</span>
          </label>
          <input
            id="bay-volume"
            type="range"
            min={0}
            max={1}
            step={0.01}
            value={vol}
            onChange={(e) => setVol(Number(e.target.value))}
            onPointerUp={() => onVolume(vol)}
            onKeyUp={() => onVolume(vol)}
            className="accent-[#e0a468]"
          />
        </div>
      )}
      <div className="flex gap-2">
        <button
          type="button"
          onClick={onSplit}
          disabled={!canSplit}
          className="h-9 flex-1 rounded-lg border border-[rgba(255,255,255,0.1)] text-[12px] text-[#ecedf1] disabled:opacity-40"
        >
          {b.splitHere}
        </button>
        <button type="button" onClick={onDelete} className="h-9 flex-1 rounded-lg border border-[rgba(240,122,107,0.45)] text-[12px] text-[#f0a3a3]">
          {b.delete}
        </button>
      </div>
      <p className="text-[11px] leading-relaxed text-[#6b6f7a]">{b.keysHint}</p>
    </div>
  );
}

export { Icon };
