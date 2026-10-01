"use client";

// The Edit Bay — board A, the operator's pick (2026-09-25): the project Opus
// made, open like a professional editor. Footage and sounds on the left, the
// program monitor in the middle, Opus (Director) and the clip inspector on
// the right, and a full-width multi-track timeline underneath. Opus makes the
// first cut; you trim, move, split and re-level it here; every change saves
// itself and the monitor plays the working copy.
//
// Dressed as "The Suite" (redesign board A, operator 2026-10-02: "Go with A,
// build it"): one bar across the top with the edit's name, its cut and the
// save state, an Edit · Score · Deliver switch, Export as the one amber key;
// the footage as pictures; and on a phone its own column — the monitor, then
// Timeline · Opus · Media · Score, with the box to ask Opus at the foot.

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useLocale } from "@/lib/i18n/provider";
import { checkExport, exportProject, type EditDetail, type EditSummary } from "@/lib/editor/actions";
import { splitClip, type TimelineClip, type TimelineModel } from "@/lib/editor/timeline";
import { useWideAt } from "@/components/sets/studio-frame";
import { useProject } from "./use-project";
import { frameKey, useMediaPreviews, type Previews } from "./media-previews";
import { Icon, Monitor, timecode, type MonitorHandle } from "./monitor";
import { ScorePanel } from "./score-panel";
import { isTake } from "@/lib/editor/composer";
import { HEADER_W, HEADER_W_COMPACT, TimelineView } from "./timeline-view";

const MIN_PPS = 8;
const MAX_PPS = 160;
const WIDE = "(min-width: 1024px)";

/** Which part of Opus's panel to draw: all of it, only the conversation, or only the box to ask. */
export type DirectorPart = "all" | "thread" | "composer";
type Mode = "edit" | "score" | "deliver";

export function EditBay({
  edits,
  selectedId,
  onSelectEdit,
  detail,
  onRefresh,
  offMusic = [],
  director,
  newEdit,
  fallback,
  working = null,
}: {
  edits: EditSummary[];
  selectedId: string | null;
  onSelectEdit: (id: string) => void;
  detail: EditDetail | null;
  /** Re-read the edit (a finished export adds a video to it). */
  onRefresh: () => Promise<void>;
  /** Music engines taken off the menu on Admin → Models. */
  offMusic?: string[];
  /** Opus's notes and "ask for a change", whole or in parts. */
  director: (part: DirectorPart) => ReactNode;
  /** The brief for a new edit, drawn in place of the bay; it calls `close` to come back, or once the edit has started. */
  newEdit: (close: () => void) => ReactNode;
  /** The plain monitor (progress while Opus works, or a video with no project). */
  fallback: ReactNode;
  /** True while Opus is still making this edit: the bay shows the footage being watched and an empty timeline. */
  working?: boolean | null;
}) {
  const { t } = useLocale();
  const d = t.directorsCut;
  const b = d.bay;
  const wide = useWideAt(WIDE);
  const [showNew, setShowNew] = useState(false);
  const [mode, setMode] = useState<Mode>("edit");
  const [rightTab, setRightTab] = useState<RightTab>("director");
  const [saving, setSaving] = useState<SaveState>("idle");

  // Every cut of this edit (Cut 1, Cut 2 after a change…): the newest opens; the pill picks another.
  const turns = useMemo(() => [...new Set((detail?.outputs ?? []).map((o) => o.turn))].sort((a, b2) => b2 - a), [detail]);
  const latestTurn = turns[0] ?? 0;
  const [turn, setTurn] = useState(latestTurn);
  useEffect(() => setTurn(latestTurn), [detail?.id, latestTurn]);
  const [pick, setPick] = useState(0);
  const videos = useMemo(() => (detail?.outputs ?? []).filter((o) => o.turn === turn), [detail, turn]);
  const video = videos[Math.min(pick, Math.max(0, videos.length - 1))] ?? null;
  const editable = detail?.stage === "done" && video?.editable === true;
  useEffect(() => setPick(0), [detail?.id, turn]);

  // Export: save the working copy, send it to render, follow the render until
  // it lands in History (a render in flight survives a reload: it is on the edit).
  const project = useRef<{ saveNow: () => Promise<void> } | null>(null);
  const [sending, setSending] = useState(false);
  const [exportNote, setExportNote] = useState<string | null>(null);
  const rendering = detail?.exports.find((x) => x.source === video?.generationId && x.status === "rendering") ?? null;
  const detailId = detail?.id ?? null;
  const renderingId = rendering?.id ?? null;
  async function doExport() {
    if (!detail || !video || sending) return;
    setSending(true);
    setExportNote(null);
    try {
      await project.current?.saveNow();
      const res = await exportProject(detail.id, video.generationId);
      if (res.error !== null) setExportNote(res.error);
      else await onRefresh();
    } catch {
      setExportNote(b.exportFailed);
    } finally {
      setSending(false);
    }
  }
  useEffect(() => {
    if (!detailId || !renderingId) return;
    const timer = setInterval(async () => {
      try {
        const res = await checkExport(detailId, renderingId);
        if (res.status === "done" || res.status === "failed") {
          setExportNote(res.status === "done" ? b.exported : b.exportFailed);
          await onRefresh();
        }
      } catch {
        // A dropped poll is retried on the next tick.
      }
    }, 5000);
    return () => clearInterval(timer);
  }, [detailId, renderingId, onRefresh, b.exported, b.exportFailed]);

  const busy = sending || rendering !== null;
  const spec = video ? `${video.aspect} · ${video.aspect === "16:9" || video.aspect === "9:16" ? "1080p" : "1080 × 1080"}` : "";
  const name = video?.title || detail?.brief || "";
  const savedLabel = saving === "pending" || saving === "saving" ? b.saving : saving === "saved" ? b.saved : saving === "failed" ? b.saveFailed : "";

  const exportButton = editable && (
    <button
      type="button"
      onClick={() => void doExport()}
      disabled={busy}
      className="flex h-[34px] shrink-0 items-center gap-2 rounded-[9px] bg-[#e0a468] px-3.5 text-[13px] font-bold text-[#1a0f07] disabled:opacity-60"
    >
      {busy ? (
        <span className="h-3 w-3 animate-spin rounded-full border-2 border-[#1a0f07] border-t-transparent" aria-hidden="true" />
      ) : (
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M12 3v12M7 10l5 5 5-5M5 21h14" />
        </svg>
      )}
      {busy ? (wide ? b.exporting : b.export) : b.export}
      {wide && !busy && <span className="font-mono text-[11px] font-medium opacity-70">{spec}</span>}
    </button>
  );

  return (
    <div
      data-directors-cut
      className="flex h-[calc(100dvh-7rem)] min-h-[640px] flex-col overflow-hidden rounded-[16px] bg-[#0b0c0f] text-[#a4a9b4] shadow-[0_0_0_1px_rgba(255,255,255,0.08)] lg:min-h-[720px]"
    >
      <style>{`@media (min-width:1024px){[data-app-content]:has(> [data-directors-cut]){max-width:1480px}}`}</style>

      {showNew ? (
        newEdit(() => setShowNew(false))
      ) : (
        <>
          {/* The bar across the top */}
          <div className="flex h-[52px] shrink-0 items-center gap-2.5 border-b border-[rgba(255,255,255,0.06)] bg-[#0e0f13] px-3 lg:gap-3.5 lg:px-4">
            <span className="hidden lg:contents">
              <Mark />
            </span>
            <span className="hidden text-[13px] font-semibold lg:inline">{d.title}</span>
            <span className="hidden text-[#3a3e47] lg:inline">/</span>
            <div className="flex min-w-0 flex-col lg:flex-row lg:items-center lg:gap-2.5">
              {/* The edit's name; a native picker sits over it for choosing another edit. */}
              <label className="relative flex min-w-0 max-w-[340px] cursor-pointer items-center gap-1.5 rounded-lg text-[14px] font-semibold text-[#eceef2] lg:h-8 lg:px-2 lg:hover:bg-[rgba(255,255,255,0.04)]">
                <span className="truncate">{name}</span>
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#6c717c" strokeWidth="2.4" strokeLinecap="round" className="shrink-0" aria-hidden="true">
                  <path d="M6 9l6 6 6-6" />
                </svg>
                <span className="sr-only">{b.yourEdits}</span>
                <select value={selectedId ?? ""} onChange={(e) => onSelectEdit(e.target.value)} className="absolute inset-0 cursor-pointer opacity-0">
                  {edits.map((e) => (
                    <option key={e.id} value={e.id}>
                      {(e.brief || e.summary || e.clipNames.join(", ")).slice(0, 60)}
                    </option>
                  ))}
                </select>
              </label>
              {!wide && turn > 0 && (
                <span className="font-mono text-[10.5px] text-[#6c717c]">
                  {d.cut.replace("{n}", String(turn))}
                  {editable && savedLabel ? ` · ${savedLabel}` : ""}
                </span>
              )}
              <div className="hidden items-center gap-2 lg:flex">
                {working && detail && (
                  <span className="flex h-6 items-center gap-[7px] rounded-xl bg-[rgba(224,164,104,0.12)] px-2.5 text-[12px] text-[#e0a468]">
                    <span className="h-1.5 w-1.5 rounded-full bg-[#e0a468] shadow-[0_0_0_3px_rgba(224,164,104,0.25)]" aria-hidden="true" />
                    {d.phase[detail.phase as keyof typeof d.phase] ?? d.phase.cutting}
                  </span>
                )}
                {turn > 0 && (
                  <label className="relative flex h-[22px] items-center gap-1 rounded-md bg-[rgba(224,164,104,0.12)] px-2 font-mono text-[11px] uppercase text-[#e0a468]">
                    {d.cut.replace("{n}", String(turn))}
                    {turns.length > 1 && (
                      <>
                        <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.8" strokeLinecap="round" aria-hidden="true">
                          <path d="M6 9l6 6 6-6" />
                        </svg>
                        <select aria-label={b.cuts} value={turn} onChange={(e) => setTurn(Number(e.target.value))} className="absolute inset-0 cursor-pointer opacity-0">
                          {turns.map((n) => (
                            <option key={n} value={n}>
                              {d.cut.replace("{n}", String(n))}
                            </option>
                          ))}
                        </select>
                      </>
                    )}
                  </label>
                )}
                {editable && savedLabel && (
                  <span className="flex items-center gap-1.5 text-[11px] text-[#6c717c] lg:text-[12px]" aria-live="polite">
                    {saving === "saved" && (
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#4fb6a0" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                        <path d="M5 12l5 5L20 7" />
                      </svg>
                    )}
                    {savedLabel}
                  </span>
                )}
              </div>
            </div>
            {videos.length > 1 && wide && (
              <div role="tablist" aria-label={d.versions} className="flex gap-1">
                {videos.map((v, i) => (
                  <button
                    key={v.generationId}
                    type="button"
                    role="tab"
                    aria-selected={i === pick}
                    onClick={() => setPick(i)}
                    className={`h-8 max-w-[160px] truncate rounded-lg px-2.5 text-[12px] ${i === pick ? "bg-[rgba(255,255,255,0.08)] text-[#eceef2]" : "text-[#8b909b] hover:text-[#eceef2]"}`}
                  >
                    {v.title || d.cut.replace("{n}", String(v.turn))}
                  </button>
                ))}
              </div>
            )}
            <div className="flex-1" />
            {editable && wide && (
              <div role="tablist" className="flex items-center gap-1 rounded-[10px] border border-[rgba(255,255,255,0.05)] bg-[#15171c] p-[3px]">
                {(
                  [
                    ["edit", b.edit],
                    ["score", b.score],
                    ["deliver", b.deliver],
                  ] as [Mode, string][]
                ).map(([k, label]) => (
                  <button
                    key={k}
                    type="button"
                    role="tab"
                    aria-selected={mode === k}
                    onClick={() => setMode(k)}
                    className={`h-7 rounded-[7px] px-3.5 text-[12.5px] ${mode === k ? "bg-[#23262d] font-semibold text-[#eceef2]" : "text-[#8b909b] hover:text-[#eceef2]"}`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            )}
            <div className="flex-1" />
            {exportNote && wide && (
              <span className="max-w-[240px] truncate text-[12px] text-[#a4a9b4]" role="status">
                {exportNote}
              </span>
            )}
            {!editable && video?.url && (
              <a href={video.url} download className="shrink-0 text-[13px] text-[#e0a468] hover:text-[#f0bd86]">
                {d.download}
              </a>
            )}
            <button
              type="button"
              onClick={() => setShowNew(true)}
              aria-label={b.newEdit}
              className="flex h-[34px] shrink-0 items-center gap-1.5 rounded-[9px] border border-[rgba(255,255,255,0.09)] px-2.5 text-[12.5px] text-[#d6d9df] hover:border-[rgba(224,164,104,0.5)] lg:px-3"
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true">
                <path d="M12 5v14M5 12h14" />
              </svg>
              <span className="hidden lg:inline">{b.newEdit}</span>
            </button>
            {exportButton}
          </div>

          {editable && detail && video ? (
            <ProjectBay
              key={`${detail.id}:${video.generationId}`}
              wide={wide}
              detail={detail}
              generationId={video.generationId}
              aspect={video.aspect}
              seconds={video.seconds}
              downloadUrl={video.url}
              director={director}
              apiRef={project}
              mode={mode}
              setMode={setMode}
              rightTab={rightTab}
              setRightTab={setRightTab}
              onRefresh={onRefresh}
              offMusic={offMusic}
              onSaving={setSaving}
              exportButton={exportButton}
              exportNote={exportNote}
            />
          ) : wide ? (
            <>
              <div className="grid min-h-0 flex-1 grid-cols-[272px_minmax(0,1fr)_344px]">
                <FootageList detail={detail} working={working === true} />
                <div className="flex min-h-0 flex-col overflow-y-auto bg-[#060709] p-4">
                  {fallback}
                  {detail?.stage === "done" && video && !video.editable && (
                    <p className="mx-auto mt-4 max-w-md text-center text-[13px] leading-relaxed text-[#a4a9b4]">{b.notEditable}</p>
                  )}
                </div>
                <div className="flex min-h-0 flex-col border-l border-[rgba(255,255,255,0.06)] bg-[#0e0f13]">
                  <PanelTabs value="director" onChange={() => undefined} items={[["director", b.director]]} dot={working ? "#e0a468" : "#4fb6a0"} />
                  <div className="min-h-0 flex-1">{director("all")}</div>
                </div>
              </div>
              {working && <GhostTimeline label={d.landsHere} />}
            </>
          ) : (
            <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
              <div className="bg-[#060709] p-3">{fallback}</div>
              {detail?.stage === "done" && video && !video.editable && (
                <p className="mx-auto mt-3 max-w-md px-4 text-center text-[13px] leading-relaxed text-[#a4a9b4]">{b.notEditable}</p>
              )}
              <div className="min-h-[320px] border-t border-[rgba(255,255,255,0.06)] bg-[#0e0f13]">{director("all")}</div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

type RightTab = "director" | "inspect";
type SaveState = "idle" | "pending" | "saving" | "saved" | "failed";
type PhoneTab = "timeline" | "director" | "media" | "score";

function Mark() {
  return (
    <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-[7px] bg-[#e0a468] text-[#1a0f07]" aria-hidden="true">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
        <rect x="3" y="4" width="18" height="16" rx="2" />
        <path d="M7 4v16M17 4v16M3 9h4M3 15h4M17 9h4M17 15h4" />
      </svg>
    </span>
  );
}

function ProjectBay({
  wide,
  detail,
  generationId,
  aspect,
  seconds,
  downloadUrl,
  director,
  apiRef,
  mode,
  setMode,
  rightTab,
  setRightTab,
  onRefresh,
  offMusic,
  onSaving,
  exportButton,
  exportNote,
}: {
  wide: boolean;
  detail: EditDetail;
  generationId: string;
  aspect: string;
  seconds: number;
  downloadUrl: string | null;
  director: (part: DirectorPart) => ReactNode;
  /** Lets the top bar save the working copy before Export. */
  apiRef: React.MutableRefObject<{ saveNow: () => Promise<void> } | null>;
  mode: Mode;
  setMode: (m: Mode) => void;
  rightTab: RightTab;
  setRightTab: (t: RightTab) => void;
  onRefresh: () => Promise<void>;
  offMusic: string[];
  onSaving: (s: SaveState) => void;
  exportButton: ReactNode;
  exportNote: string | null;
}) {
  const { t } = useLocale();
  const d = t.directorsCut;
  const b = d.bay;
  const clipNames = useMemo(() => detail.clips.map((c) => c.name), [detail.clips]);
  const project = useProject(detail.id, generationId, clipNames);
  useEffect(() => {
    apiRef.current = { saveNow: project.saveNow };
    return () => {
      apiRef.current = null;
    };
  }, [apiRef, project.saveNow]);
  const ready = project.state.status === "ready" ? project.state : null;
  const saving = ready?.saving ?? "idle";
  useEffect(() => onSaving(saving), [saving, onSaving]);
  const previews = useMediaPreviews(ready?.base ?? null, ready?.model ?? null);
  const monitor = useRef<MonitorHandle | null>(null);
  const timelineBox = useRef<HTMLDivElement>(null);
  const [time, setTime] = useState(0);
  const [selected, setSelected] = useState<string | null>(null);
  const [tool, setTool] = useState<"select" | "razor">("select");
  const [snapping, setSnapping] = useState(true);
  const [pps, setPps] = useState(40);
  const [phoneTab, setPhoneTab] = useState<PhoneTab>("timeline");
  const [showVolume, setShowVolume] = useState(false);

  const model = ready?.model ?? null;
  const clips = useMemo(() => model?.lanes.flatMap((l) => l.clips) ?? [], [model]);
  const selectedClip = clips.find((c) => c.id === selected) ?? null;
  const takes = useMemo(() => detail.takes.filter((x) => x.source === generationId), [detail.takes, generationId]);
  const cutPoints = useMemo(() => (model?.lanes.find((l) => l.key === "story")?.clips ?? []).map((c) => c.start).filter((s) => s > 0), [model]);
  const headerW = wide ? HEADER_W : HEADER_W_COMPACT;

  // Fit the whole video in the timeline's width when it first opens.
  const fitted = useRef(false);
  const fit = useCallback(() => {
    const w = (timelineBox.current?.clientWidth ?? 1000) - headerW - (wide ? 40 : 16);
    if (model && model.duration > 0) setPps(Math.max(MIN_PPS, Math.min(MAX_PPS, w / model.duration)));
  }, [model, headerW, wide]);
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

  const pickClip = useCallback((c: TimelineClip) => {
    setSelected(c.id);
    monitor.current?.seek(c.start);
  }, []);
  const hasVolume = selectedClip !== null && selectedClip.volume !== null && (selectedClip.kind === "audio" || selectedClip.kind === "video");
  const canSplit = selectedClip !== null && (selectedClip.kind === "video" || selectedClip.kind === "audio") && time > selectedClip.start + 0.1 && time < selectedClip.end - 0.1;
  const deleteSelected = () => {
    if (!selectedClip) return;
    project.remove([selectedClip.id]);
    setSelected(null);
  };

  const monitorEl = ready ? (
    <Monitor
      base={ready.base}
      version={ready.previewVersion}
      aspect={aspect}
      duration={ready.model.duration}
      onTime={onTime}
      handleRef={monitor}
      cutPoints={cutPoints}
      compact={!wide}
      labels={{ play: b.play, pause: b.pause, prevCut: b.prevCut, nextCut: b.nextCut, loop: b.loop, fullscreen: b.fullscreen, program: b.program, safeArea: b.safeArea }}
    />
  ) : (
    <div className="flex h-full items-center justify-center p-6 text-center text-[13px] text-[#a4a9b4]">{project.state.status === "error" ? project.state.message : b.opening}</div>
  );

  const score = ready ? (
    <ScorePanel
      editId={detail.id}
      generationId={generationId}
      base={ready.base}
      duration={ready.model.duration}
      cuts={cutPoints}
      takes={takes}
      inUse={clips.find((c) => isTake(c.src))?.src ?? null}
      onComposed={onRefresh}
      offMusic={offMusic}
      onUse={(take) => {
        setSelected(project.placeMusic(take));
      }}
    />
  ) : (
    <p className="p-5 text-[13px] text-[#a4a9b4]">{b.opening}</p>
  );

  const timeline = model ? (
    <TimelineView
      model={model}
      time={time}
      pps={pps}
      tool={tool}
      snapping={snapping}
      selected={selected}
      previews={previews}
      compact={!wide}
      onSeek={(v) => monitor.current?.seek(v)}
      onSelect={(id) => {
        setSelected(id);
        if (id && wide) {
          setMode("edit");
          setRightTab("inspect");
        }
      }}
      onEdits={project.applyTimings}
      onSplit={doSplit}
      labels={{ lanes: b.lanes, composeHint: b.musicHint }}
    />
  ) : (
    <div className="flex flex-1 items-center justify-center text-[13px] text-[#6c717c]">{project.state.status === "error" ? "" : b.opening}</div>
  );

  const toolbar = (
    <div className="flex h-10 shrink-0 items-center gap-1.5 border-b border-[rgba(255,255,255,0.05)] px-3">
      <div className="flex gap-0.5 rounded-lg bg-[#15171c] p-0.5">
        <ToolButton label={b.select} on={tool === "select"} onClick={() => setTool("select")} path="M5 3l14 8-6 2-2 6z" />
        <ToolButton label={b.razor} on={tool === "razor"} onClick={() => setTool("razor")} path="M6 3a3 3 0 1 0 0 6 3 3 0 0 0 0-6zM6 15a3 3 0 1 0 0 6 3 3 0 0 0 0-6zM20 4 8.1 15.9M14.5 14.5 20 20M8.1 8.1 12 12" />
      </div>
      <ToolButton label={b.snapping} on={snapping} accent onClick={() => setSnapping((s) => !s)} path="M6 3v8a6 6 0 0 0 12 0V3M6 7h4M14 7h4" />
      <span className="mx-1 h-[18px] w-px bg-[rgba(255,255,255,0.07)]" />
      <ToolButton label={b.undo} on={false} disabled={!ready?.canUndo} onClick={project.undo} path="M9 14 4 9l5-5M4 9h11a5 5 0 0 1 0 10h-3" />
      <ToolButton label={b.redo} on={false} disabled={!ready?.canRedo} onClick={project.redo} path="M15 14l5-5-5-5M20 9H9a5 5 0 0 0 0 10h3" />
      <div className="flex-1" />
      <ToolButton label={b.zoomOut} on={false} onClick={() => setPps((p) => Math.max(MIN_PPS, p / 1.4))} path="M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zM8 11h6M20 20l-4-4" />
      <input
        type="range"
        aria-label={b.zoom}
        min={Math.log(MIN_PPS)}
        max={Math.log(MAX_PPS)}
        step={0.01}
        value={Math.log(pps)}
        onChange={(e) => setPps(Math.exp(Number(e.target.value)))}
        className="w-28 accent-[#eceef2]"
      />
      <ToolButton label={b.zoomIn} on={false} onClick={() => setPps((p) => Math.min(MAX_PPS, p * 1.4))} path="M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zM8 11h6M11 8v6M20 20l-4-4" />
      <button type="button" onClick={fit} className="ml-1 h-7 rounded-md border border-[rgba(255,255,255,0.08)] px-2.5 font-mono text-[11px] text-[#a4a9b4] hover:text-[#eceef2]">
        {b.fit}
      </button>
    </div>
  );

  // ---- a phone: monitor, then one of Timeline · Opus · Media · Score, and the box to ask Opus.
  if (!wide) {
    return (
      <div className="flex min-h-0 flex-1 flex-col">
        <div className="h-[38%] min-h-[240px] shrink-0">{monitorEl}</div>
        <PanelTabs
          value={phoneTab}
          onChange={(v) => setPhoneTab(v as PhoneTab)}
          items={[
            ["timeline", b.timeline],
            ["director", b.director],
            ["media", b.media],
            ["score", b.score],
          ]}
        />
        <div ref={timelineBox} className="flex min-h-0 flex-1 flex-col overflow-y-auto">
          {phoneTab === "timeline" && (
            <>
              {timeline}
              {showVolume && hasVolume && selectedClip && (
                <VolumeRow key={selectedClip.id} clip={selectedClip} label={b.volume} onVolume={(v) => project.setVolume(selectedClip.id, v)} />
              )}
              <div className="mt-auto grid shrink-0 grid-cols-4 border-t border-[rgba(255,255,255,0.05)] px-2 py-1.5">
                <ActionButton label={b.splitHere} short={b.split} disabled={!canSplit} onClick={() => selectedClip && doSplit(selectedClip, time)} path="M6 3a3 3 0 1 0 0 6 3 3 0 0 0 0-6zM6 15a3 3 0 1 0 0 6 3 3 0 0 0 0-6zM20 4 8.1 15.9M14.5 14.5 20 20M8.1 8.1 12 12" />
                <ActionButton label={b.volume} short={b.volume} disabled={!hasVolume} onClick={() => setShowVolume((v) => !v)} path="M11 5 6 9H2v6h4l5 4zM15.5 8.5a5 5 0 0 1 0 7M19 5a10 10 0 0 1 0 14" />
                <ActionButton label={b.undo} short={b.undo.replace(/\s*\(.+\)$/, "")} disabled={!ready?.canUndo} onClick={project.undo} path="M9 14 4 9l5-5M4 9h11a5 5 0 0 1 0 10h-3" />
                <ActionButton label={b.delete} short={b.delete} disabled={!selectedClip} onClick={deleteSelected} path="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3" />
              </div>
            </>
          )}
          {phoneTab === "director" && director("thread")}
          {phoneTab === "media" && <MediaBin detail={detail} model={model} previews={previews} selected={selected} onPick={pickClip} columns={3} />}
          {phoneTab === "score" && score}
        </div>
        {phoneTab !== "score" && <div className="shrink-0 border-t border-[rgba(255,255,255,0.06)] bg-[#0b0c0f]">{director("composer")}</div>}
      </div>
    );
  }

  // ---- a computer: bin · monitor · panel, the timeline underneath.
  return (
    <>
      <div className="grid min-h-0 flex-1 grid-cols-[272px_minmax(0,1fr)_344px]">
        <div className="flex min-h-0 flex-col border-r border-[rgba(255,255,255,0.06)] bg-[#0e0f13]">
          <MediaBin detail={detail} model={model} previews={previews} selected={selected} onPick={pickClip} columns={2} />
        </div>
        <div className="min-h-[280px] min-w-0">{monitorEl}</div>
        <div className="flex min-h-0 flex-col border-l border-[rgba(255,255,255,0.06)] bg-[#0e0f13]">
          {mode === "edit" ? (
            <>
              <PanelTabs
                value={rightTab}
                onChange={(v) => setRightTab(v as RightTab)}
                items={[
                  ["director", b.director],
                  ["inspect", b.inspect],
                ]}
                dot="#4fb6a0"
              />
              <div className="min-h-0 flex-1 overflow-y-auto">
                {rightTab === "director" ? (
                  director("all")
                ) : selectedClip ? (
                  <Inspector clip={selectedClip} onVolume={(v) => project.setVolume(selectedClip.id, v)} onSplit={() => doSplit(selectedClip, time)} onDelete={deleteSelected} canSplit={canSplit} />
                ) : (
                  <p className="p-5 text-[13px] leading-relaxed text-[#a4a9b4]">{b.nothingSelected}</p>
                )}
              </div>
            </>
          ) : mode === "score" ? (
            <>
              <PanelTabs value="score" onChange={() => undefined} items={[["score", b.score]]} />
              <div className="min-h-0 flex-1 overflow-y-auto">{score}</div>
            </>
          ) : (
            <>
              <PanelTabs value="deliver" onChange={() => undefined} items={[["deliver", b.deliver]]} />
              <div className="min-h-0 flex-1 overflow-y-auto">
                <Deliver aspect={aspect} seconds={model?.duration ?? seconds} downloadUrl={downloadUrl} exportButton={exportButton} exportNote={exportNote} />
              </div>
            </>
          )}
        </div>
      </div>

      <div ref={timelineBox} className="flex h-[330px] shrink-0 flex-col border-t border-[rgba(255,255,255,0.07)] bg-[#0b0c0f]">
        {toolbar}
        {timeline}
      </div>
    </>
  );
}

// ------------------------------------------------------------- the bin

/** The footage as pictures (two to a row), then the sounds and the titles, each a tab with its count. */
function MediaBin({
  detail,
  model,
  previews,
  selected,
  onPick,
  columns,
}: {
  detail: EditDetail;
  model: TimelineModel | null;
  previews: Previews;
  selected: string | null;
  onPick: (c: TimelineClip) => void;
  columns: 2 | 3;
}) {
  const { t } = useLocale();
  const b = t.directorsCut.bay;
  const [tab, setTab] = useState<"footage" | "sound" | "titles">("footage");
  const clips = useMemo(() => model?.lanes.flatMap((l) => l.clips) ?? [], [model]);
  const story = useMemo(() => model?.lanes.find((l) => l.key === "story")?.clips ?? [], [model]);
  const sounds = clips.filter((c) => c.kind === "audio");
  const titles = clips.filter((c) => c.kind === "text");
  const count = (n: number) => <span className="ml-1 font-mono font-normal text-[#565a64]">{n}</span>;
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div role="tablist" className="flex h-10 shrink-0 items-center gap-[18px] border-b border-[rgba(255,255,255,0.05)] px-4">
        {(
          [
            ["footage", b.footage, detail.clips.length],
            ["sound", b.sound, sounds.length],
            ["titles", b.titles, titles.length],
          ] as const
        ).map(([k, label, n]) => (
          <button
            key={k}
            type="button"
            role="tab"
            aria-selected={tab === k}
            onClick={() => setTab(k)}
            className={`h-10 text-[12.5px] ${tab === k ? "font-semibold text-[#eceef2] shadow-[inset_0_-2px_0_#e0a468]" : "text-[#8b909b] hover:text-[#eceef2]"}`}
          >
            {label}
            {count(n)}
          </button>
        ))}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-3.5">
        {tab === "footage" && (
          <>
            <ul className={`grid gap-x-2.5 gap-y-3 ${columns === 3 ? "grid-cols-3" : "grid-cols-2"}`}>
              {detail.clips.map((c, i) => {
                const first = story.find((x) => x.footage === i) ?? clips.find((x) => x.footage === i) ?? null;
                const poster = first?.src ? posterOf(previews, first) : null;
                const isSelected = first !== null && clips.some((x) => x.footage === i && x.id === selected);
                return (
                  <li key={i}>
                    <button type="button" disabled={!first} onClick={() => first && onPick(first)} className="flex w-full flex-col gap-1.5 text-left disabled:cursor-default">
                      <span
                        className={`relative block h-[92px] w-full overflow-hidden rounded-lg bg-[#15171c] ${
                          isSelected ? "shadow-[0_0_0_2px_#7aa2d6]" : "shadow-[0_0_0_1px_rgba(255,255,255,0.06)]"
                        } ${first ? "" : "opacity-45"}`}
                        style={poster ? { backgroundImage: `url(${poster})`, backgroundSize: "cover", backgroundPosition: "center" } : undefined}
                      >
                        {!poster && (
                          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#3a3e47" strokeWidth="1.8" strokeLinecap="round" className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2" aria-hidden="true">
                            <rect x="3" y="4" width="18" height="16" rx="2" />
                            <path d="M7 4v16M17 4v16" />
                          </svg>
                        )}
                      </span>
                      <span className="flex justify-between gap-2 text-[11.5px]">
                        <span className={`truncate ${first ? "text-[#d6d9df]" : "text-[#6c717c]"}`}>{c.name.replace(/\.[a-z0-9]+$/i, "")}</span>
                        <span className="font-mono text-[#6c717c]">{c.duration !== null ? clock(c.duration) : ""}</span>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </>
        )}
        {tab === "sound" && <ClipList clips={sounds} empty={b.noSound} onPick={onPick} selected={selected} />}
        {tab === "titles" && <ClipList clips={titles} empty={b.noTitles} onPick={onPick} selected={selected} />}
      </div>
    </div>
  );
}

/** The frame the timeline already drew for a shot (its first sample), if it has landed. */
function posterOf(previews: Previews, c: TimelineClip): string | null {
  if (!c.src) return null;
  const len = c.end - c.start;
  const at = len > 4 ? c.mediaStart + len * 0.25 : c.mediaStart + len / 2;
  return previews.frames[frameKey(c.src, at)] ?? null;
}

/** While Opus works, or for a video made before the timeline: the footage by name, ticked once watched. */
function FootageList({ detail, working }: { detail: EditDetail | null; working: boolean }) {
  const { t } = useLocale();
  const d = t.directorsCut;
  const clips = detail?.clips ?? [];
  return (
    <div className="flex min-h-0 flex-col border-r border-[rgba(255,255,255,0.06)] bg-[#0e0f13]">
      <div className="flex h-10 shrink-0 items-center justify-between border-b border-[rgba(255,255,255,0.05)] px-4">
        <span className="text-[12.5px] font-semibold text-[#eceef2]">{d.bay.footage}</span>
        {working && clips.length > 0 && (
          <span className="font-mono text-[11px] text-[#6c717c]">{d.watched.replace("{n}", String(detail?.analyzed ?? 0)).replace("{total}", String(clips.length))}</span>
        )}
      </div>
      <ul className="min-h-0 flex-1 overflow-y-auto p-3">
        {clips.map((c, i) => (
          <li key={i} className="flex items-center gap-2.5 rounded-lg px-2 py-2 text-[12px]">
            <span className="min-w-0 flex-1 truncate text-[#d6d9df]">{c.name}</span>
            <span className="font-mono text-[11px] text-[#6c717c]">{c.duration !== null ? clock(c.duration) : ""}</span>
            {working && i < (detail?.analyzed ?? 0) && (
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#4fb6a0" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M5 12l5 5L20 7" />
              </svg>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

/** The timeline's tracks, empty, while Opus makes the cut that will fill them. */
function GhostTimeline({ label }: { label: string }) {
  const { t } = useLocale();
  const lanes = t.directorsCut.bay.lanes as Record<string, string>;
  const rows: [string, string, string, number][] = [
    ["V2", lanes.titles ?? "Titles", "#e0a468", 38],
    ["V1", lanes.story ?? "Story", "#7aa2d6", 82],
    ["A1", lanes.music ?? "Music", "#4fb6a0", 62],
    ["A2", lanes.effects ?? "Effects", "#b392f0", 40],
  ];
  return (
    <div className="relative flex h-[290px] shrink-0 flex-col border-t border-[rgba(255,255,255,0.07)]">
      <div className="h-10 shrink-0 border-b border-[rgba(255,255,255,0.05)]" />
      {rows.map(([code, name, color, h]) => (
        <div key={code} className="flex border-b border-[rgba(255,255,255,0.035)]" style={{ height: h }}>
          <div className="flex items-center gap-2.5 border-r border-[rgba(255,255,255,0.05)] bg-[#0e0f13] px-3" style={{ width: HEADER_W }}>
            <span className="w-[3px] rounded-sm opacity-40" style={{ background: color, height: Math.min(44, h - 18) }} />
            <span className="w-[18px] font-mono text-[10.5px] text-[#565a64]">{code}</span>
            <span className="text-[12px] text-[#6c717c]">{name}</span>
          </div>
        </div>
      ))}
      <div className="absolute inset-y-0 right-0 flex items-center justify-center text-[13px] text-[#565a64]" style={{ left: HEADER_W }}>
        {label}
      </div>
    </div>
  );
}

// ------------------------------------------------------------- the panels

function PanelTabs({ value, onChange, items, dot }: { value: string; onChange: (v: string) => void; items: [string, string][]; dot?: string }) {
  return (
    <div role="tablist" className="flex h-10 shrink-0 items-center gap-[18px] border-b border-[rgba(255,255,255,0.05)] px-4">
      {items.map(([k, label]) => (
        <button
          key={k}
          type="button"
          role="tab"
          aria-selected={value === k}
          onClick={() => onChange(k)}
          className={`flex h-10 items-center gap-[7px] text-[12.5px] ${value === k ? "font-semibold text-[#eceef2] shadow-[inset_0_-2px_0_#e0a468]" : "text-[#8b909b] hover:text-[#eceef2]"}`}
        >
          {k === "director" && dot && <span className="h-[7px] w-[7px] rounded-full" style={{ background: dot }} aria-hidden="true" />}
          {label}
        </button>
      ))}
    </div>
  );
}

/** Deliver: what Export makes, and the key that makes it. */
function Deliver({ aspect, seconds, downloadUrl, exportButton, exportNote }: { aspect: string; seconds: number; downloadUrl: string | null; exportButton: ReactNode; exportNote: string | null }) {
  const { t } = useLocale();
  const d = t.directorsCut;
  const b = d.bay;
  const size = aspect === "9:16" ? "1080 × 1920" : aspect === "1:1" ? "1080 × 1080" : "1920 × 1080";
  const rows: [string, string][] = [
    [d.shape, aspect],
    [b.size, size],
    [b.length, `${seconds.toFixed(1)} s`],
  ];
  return (
    <div className="flex flex-col gap-5 p-4">
      <dl className="overflow-hidden rounded-xl bg-[#15171c] shadow-[0_0_0_1px_rgba(255,255,255,0.05)]">
        {rows.map(([k, v], i) => (
          <div key={k} className={`flex items-center justify-between px-3.5 py-2.5 text-[12.5px] ${i > 0 ? "border-t border-[rgba(255,255,255,0.04)]" : ""}`}>
            <dt className="text-[#a4a9b4]">{k}</dt>
            <dd className="font-mono text-[#eceef2]">{v}</dd>
          </div>
        ))}
      </dl>
      <div className="flex flex-col gap-2.5 [&>button]:h-11 [&>button]:justify-center">{exportButton}</div>
      {exportNote && (
        <p className="text-[12.5px] text-[#a4a9b4]" role="status">
          {exportNote}
        </p>
      )}
      <p className="text-[12px] leading-relaxed text-[#6c717c]">{b.deliverHint}</p>
      {downloadUrl && (
        <a href={downloadUrl} download className="text-[13px] text-[#e0a468] hover:text-[#f0bd86]">
          {d.download}
        </a>
      )}
    </div>
  );
}

function ToolButton({ label, on, onClick, path, disabled = false, accent = false }: { label: string; on: boolean; onClick: () => void; path: string; disabled?: boolean; accent?: boolean }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      aria-pressed={on}
      disabled={disabled}
      onClick={onClick}
      className={`flex h-7 w-[30px] items-center justify-center rounded-md disabled:opacity-35 ${
        on ? (accent ? "text-[#e0a468]" : "bg-[#262930] text-[#eceef2]") : "text-[#8b909b] hover:text-[#eceef2]"
      }`}
    >
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d={path} />
      </svg>
    </button>
  );
}

function ActionButton({ label, short, onClick, path, disabled }: { label: string; short: string; onClick: () => void; path: string; disabled: boolean }) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      disabled={disabled}
      className="flex h-[52px] flex-col items-center justify-center gap-1 text-center text-[11px] leading-tight text-[#d6d9df] disabled:opacity-35"
    >
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d={path} />
      </svg>
      {short}
    </button>
  );
}

function VolumeRow({ clip, label, onVolume }: { clip: TimelineClip; label: string; onVolume: (v: number) => void }) {
  const [vol, setVol] = useState(clip.volume ?? 1);
  return (
    <label className="flex shrink-0 items-center gap-3 border-t border-[rgba(255,255,255,0.05)] px-4 py-2 text-[12px] text-[#a4a9b4]">
      <span>{label}</span>
      <input
        type="range"
        min={0}
        max={1}
        step={0.01}
        value={vol}
        onChange={(e) => setVol(Number(e.target.value))}
        onPointerUp={() => onVolume(vol)}
        onKeyUp={() => onVolume(vol)}
        className="min-w-0 flex-1 accent-[#e0a468]"
      />
      <span className="w-10 text-right font-mono text-[#eceef2]">{Math.round(vol * 100)}%</span>
    </label>
  );
}

function ClipList({ clips, empty, onPick, selected }: { clips: TimelineClip[]; empty: string; onPick: (c: TimelineClip) => void; selected: string | null }) {
  if (clips.length === 0) return <p className="px-1 text-[12px] leading-relaxed text-[#6c717c]">{empty}</p>;
  return (
    <ul className="flex flex-col gap-1.5">
      {clips.map((c) => (
        <li key={c.id}>
          <button
            type="button"
            onClick={() => onPick(c)}
            className={`flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left ${selected === c.id ? "bg-[rgba(224,164,104,0.12)]" : "bg-[#15171c] hover:bg-[#1a1d23]"}`}
          >
            <span className="min-w-0 flex-1 truncate text-[12px] text-[#eceef2]">{c.label}</span>
            <span className="font-mono text-[10.5px] text-[#6c717c]">{timecode(c.start).slice(0, 5)}</span>
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
        <p className="text-[12px] text-[#6c717c]">{b.lanes[clip.lane] ?? clip.lane}</p>
        <p className="mt-1 break-words text-[15px] font-semibold text-[#eceef2]">{clip.label}</p>
      </div>
      <dl className="overflow-hidden rounded-xl bg-[#15171c] text-[12.5px] shadow-[0_0_0_1px_rgba(255,255,255,0.05)]">
        {rows.map(([k, v], i) => (
          <div key={k} className={`flex justify-between px-3.5 py-2.5 ${i > 0 ? "border-t border-[rgba(255,255,255,0.04)]" : ""}`}>
            <dt className="text-[#a4a9b4]">{k}</dt>
            <dd className="font-mono tabular-nums text-[#eceef2]">{v}</dd>
          </div>
        ))}
      </dl>
      {clip.volume !== null && (clip.kind === "audio" || clip.kind === "video") && (
        <div className="flex flex-col gap-1.5">
          <label htmlFor="bay-volume" className="flex justify-between text-[12px] text-[#a4a9b4]">
            <span>{b.volume}</span>
            <span className="font-mono text-[#eceef2]">{Math.round(vol * 100)}%</span>
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
        <button type="button" onClick={onSplit} disabled={!canSplit} className="h-9 flex-1 rounded-lg border border-[rgba(255,255,255,0.1)] text-[12px] text-[#eceef2] disabled:opacity-40">
          {b.splitHere}
        </button>
        <button type="button" onClick={onDelete} className="h-9 flex-1 rounded-lg border border-[rgba(240,122,107,0.45)] text-[12px] text-[#f0a3a3]">
          {b.delete}
        </button>
      </div>
      <p className="text-[11px] leading-relaxed text-[#6c717c]">{b.keysHint}</p>
    </div>
  );
}

function clock(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

export { Icon };
