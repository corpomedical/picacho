"use client";

// The Edit Bay's timeline (board A): a ruler, one track per kind (titles,
// story, clip sound, music, effects…), each clip drawn with what it is — a
// frame from the shot, the waveform of the sound — and a playhead. Drag a
// clip to move it, drag an edge to trim it, the razor cuts one in two; every
// drag snaps to the other clips' edges, the playhead and zero.

import { useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { moveClip, snap, trimEnd, trimStart, type LaneKey, type TimelineClip, type TimelineModel, type TimingEdit } from "@/lib/editor/timeline";
import { frameKey, PEAKS_PER_SECOND, type Previews } from "./media-previews";

export const HEADER_W = 172;

const HEIGHT: Record<LaneKey, number> = { graphics: 30, titles: 34, story: 76, backdrop: 0, "clip-sound": 50, music: 56, effects: 40, voice: 46 };
const COLOR: Record<LaneKey, { solid: string; rgb: string }> = {
  graphics: { solid: "#d58ab5", rgb: "213,138,181" },
  titles: { solid: "#e0a468", rgb: "224,164,104" },
  story: { solid: "#7aa2d6", rgb: "122,162,214" },
  backdrop: { solid: "#7aa2d6", rgb: "122,162,214" },
  "clip-sound": { solid: "#7d93b4", rgb: "125,147,180" },
  music: { solid: "#4fb6a0", rgb: "79,182,160" },
  effects: { solid: "#b392f0", rgb: "179,146,240" },
  voice: { solid: "#e6c86e", rgb: "230,200,110" },
};

type Drag = { id: string; mode: "move" | "start" | "end"; x0: number; clip: TimelineClip; start: number; end: number; guide: number | null };

export function TimelineView({
  model,
  time,
  pps,
  tool,
  snapping,
  selected,
  previews,
  onSeek,
  onSelect,
  onEdits,
  onSplit,
  labels,
}: {
  model: TimelineModel;
  time: number;
  pps: number;
  tool: "select" | "razor";
  snapping: boolean;
  selected: string | null;
  previews: Previews;
  onSeek: (t: number) => void;
  onSelect: (id: string | null) => void;
  onEdits: (edits: TimingEdit[]) => void;
  onSplit: (clip: TimelineClip, at: number) => void;
  labels: { lanes: Record<string, string>; composeHint: string };
}) {
  const scroller = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<Drag | null>(null);
  const [hoverT, setHoverT] = useState<number | null>(null);
  const [scrubbing, setScrubbing] = useState(false);

  const width = Math.max(1, model.duration) * pps + 120;
  const lanes = model.lanes;
  const total = lanes.reduce((n, l) => n + HEIGHT[l.key], 0);

  const edges = useMemo(() => {
    const pts = new Set<number>([0, model.duration]);
    for (const l of lanes) for (const c of l.clips) pts.add(c.start).add(c.end);
    return [...pts];
  }, [lanes, model.duration]);

  const timeAt = (clientX: number) => {
    const box = scroller.current?.getBoundingClientRect();
    const left = (box?.left ?? 0) - (scroller.current?.scrollLeft ?? 0);
    return Math.max(0, Math.min(model.duration, (clientX - left) / pps));
  };

  const snapPoints = (exclude: string) => [...edges.filter((p) => !lanes.some((l) => l.clips.some((c) => c.id === exclude && (c.start === p || c.end === p)))), time];
  const tolerance = 8 / pps;

  function beginDrag(e: ReactPointerEvent, clip: TimelineClip, mode: Drag["mode"]) {
    e.stopPropagation();
    onSelect(clip.id);
    if (tool === "razor") {
      const at = snapping ? snap(timeAt(e.clientX), [time, ...edges], tolerance) : timeAt(e.clientX);
      onSplit(clip, at);
      return;
    }
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    setDrag({ id: clip.id, mode, x0: e.clientX, clip, start: clip.start, end: clip.end, guide: null });
  }

  function moveDrag(e: ReactPointerEvent) {
    if (!drag) return;
    const dt = (e.clientX - drag.x0) / pps;
    const pts = snapping ? snapPoints(drag.id) : [];
    const c = drag.clip;
    if (drag.mode === "move") {
      let s = Math.max(0, c.start + dt);
      let guide: number | null = null;
      const sStart = snap(s, pts, tolerance);
      const sEnd = snap(s + (c.end - c.start), pts, tolerance);
      if (sStart !== s) {
        guide = sStart;
        s = sStart;
      } else if (sEnd !== s + (c.end - c.start)) {
        guide = sEnd;
        s = sEnd - (c.end - c.start);
      }
      setDrag({ ...drag, start: s, end: s + (c.end - c.start), guide });
    } else if (drag.mode === "start") {
      const raw = c.start + dt;
      const s = snap(raw, pts, tolerance);
      const edit = trimStart(c, s);
      setDrag({ ...drag, start: edit.start ?? c.start, guide: s !== raw ? s : null });
    } else {
      const raw = c.end + dt;
      const s = snap(raw, pts, tolerance);
      const edit = trimEnd(c, s);
      setDrag({ ...drag, end: c.start + (edit.duration ?? c.end - c.start), guide: s !== raw ? s : null });
    }
  }

  function endDrag() {
    if (!drag) return;
    const c = drag.clip;
    const moved = Math.abs(drag.start - c.start) > 0.001 || Math.abs(drag.end - c.end) > 0.001;
    if (moved) {
      const edit =
        drag.mode === "move" ? moveClip(c, drag.start) : drag.mode === "start" ? trimStart(c, drag.start) : trimEnd(c, drag.end);
      onEdits([edit]);
    }
    setDrag(null);
  }

  const ticks = useMemo(() => {
    const every = pps >= 60 ? 1 : pps >= 25 ? 1 : 2;
    const label = pps >= 60 ? 2 : 5;
    const out: { t: number; major: boolean }[] = [];
    for (let t = 0; t <= model.duration + 0.001; t += every) out.push({ t, major: Math.round(t) % label === 0 });
    return out;
  }, [pps, model.duration]);

  return (
    <div className="flex min-h-0 flex-1 select-none">
      <div className="shrink-0 border-r border-[rgba(255,255,255,0.07)] bg-[#0d0e13]" style={{ width: HEADER_W }}>
        <div className="h-[26px] border-b border-[rgba(255,255,255,0.07)]" />
        {lanes.map((l) => (
          <div key={l.key} className="flex items-center gap-2 border-b border-[rgba(255,255,255,0.07)] px-3" style={{ height: HEIGHT[l.key] }}>
            <span className="h-[70%] max-h-[30px] w-1 rounded-sm" style={{ background: COLOR[l.key].solid }} />
            <span className="w-6 font-mono text-[11px] text-[#9aa0ad]">{l.code}</span>
            <span className="truncate text-[12px] text-[#c6c9d1]">{labels.lanes[l.key] ?? l.name}</span>
          </div>
        ))}
      </div>
      <div
        ref={scroller}
        className={`relative min-w-0 flex-1 overflow-x-auto overflow-y-hidden ${tool === "razor" ? "cursor-crosshair" : ""}`}
        onPointerMove={(e) => {
          if (scrubbing) onSeek(timeAt(e.clientX));
          setHoverT(timeAt(e.clientX));
        }}
        onPointerLeave={() => setHoverT(null)}
        onPointerUp={() => setScrubbing(false)}
      >
        <div className="relative" style={{ width, height: 26 + total }}>
          {/* Ruler: click or drag to move the playhead. */}
          <div
            className="absolute left-0 top-0 h-[26px] border-b border-[rgba(255,255,255,0.07)] bg-[#0d0e13]"
            style={{ width }}
            onPointerDown={(e) => {
              (e.target as HTMLElement).setPointerCapture(e.pointerId);
              setScrubbing(true);
              onSeek(timeAt(e.clientX));
            }}
            onPointerMove={(e) => scrubbing && onSeek(timeAt(e.clientX))}
            onPointerUp={() => setScrubbing(false)}
          >
            {ticks.map(({ t, major }) => (
              <div key={t} className="absolute bottom-0" style={{ left: t * pps }}>
                <div className="w-px" style={{ height: major ? 10 : 5, background: major ? "#3a3e48" : "#262930" }} />
                {major && <span className="absolute left-1 top-[-13px] font-mono text-[10px] text-[#6b6f7a]">{`0:${String(Math.round(t)).padStart(2, "0")}`}</span>}
              </div>
            ))}
          </div>

          {lanes.map((l, li) => {
            const top = 26 + lanes.slice(0, li).reduce((n, x) => n + HEIGHT[x.key], 0);
            const h = HEIGHT[l.key];
            return (
              <div
                key={l.key}
                className="absolute left-0 border-b border-[rgba(255,255,255,0.07)]"
                style={{ top, height: h, width }}
                onPointerDown={(e) => {
                  onSelect(null);
                  onSeek(timeAt(e.clientX));
                }}
              >
                {l.key === "music" && l.clips.length === 0 && (
                  <div className="absolute inset-y-1 left-0 flex items-center justify-center rounded-md border border-dashed border-[rgba(79,182,160,0.45)] text-[12px] text-[#4fb6a0]" style={{ width: model.duration * pps }}>
                    {labels.composeHint}
                  </div>
                )}
                {l.clips.map((c) => {
                  const live = drag?.id === c.id ? drag : null;
                  const start = live ? live.start : c.start;
                  const end = live ? live.end : c.end;
                  return (
                    <ClipBlock
                      key={c.id}
                      clip={c}
                      laneKey={l.key}
                      left={start * pps}
                      w={Math.max(4, (end - start) * pps)}
                      h={h}
                      selected={selected === c.id}
                      previews={previews}
                      mediaStart={live && live.mode === "start" ? c.mediaStart + (live.start - c.start) : c.mediaStart}
                      onDown={beginDrag}
                      onMove={moveDrag}
                      onUp={endDrag}
                    />
                  );
                })}
              </div>
            );
          })}

          {/* Snap guide while dragging. */}
          {drag?.guide !== null && drag?.guide !== undefined && (
            <div className="pointer-events-none absolute top-0 w-px bg-[#f5d76e]" style={{ left: drag.guide * pps, height: 26 + total }} />
          )}
          {/* Razor preview line. */}
          {tool === "razor" && hoverT !== null && (
            <div className="pointer-events-none absolute top-[26px] w-px bg-[rgba(240,122,107,0.9)]" style={{ left: hoverT * pps, height: total }} />
          )}
          {/* Playhead. */}
          <div className="pointer-events-none absolute top-0" style={{ left: time * pps - 5, height: 26 + total }}>
            <svg width="11" height="12" viewBox="0 0 11 12" className="absolute left-0 top-0" aria-hidden="true">
              <path d="M0 0h11v7l-5.5 5L0 7z" fill="#e0a468" />
            </svg>
            <div className="absolute left-[5px] top-[10px] w-px bg-[#e0a468]" style={{ height: 26 + total - 10 }} />
          </div>
        </div>
      </div>
    </div>
  );
}

function ClipBlock({
  clip,
  laneKey,
  left,
  w,
  h,
  selected,
  previews,
  mediaStart,
  onDown,
  onMove,
  onUp,
}: {
  clip: TimelineClip;
  laneKey: LaneKey;
  left: number;
  w: number;
  h: number;
  selected: boolean;
  previews: Previews;
  mediaStart: number;
  onDown: (e: ReactPointerEvent, clip: TimelineClip, mode: "move" | "start" | "end") => void;
  onMove: (e: ReactPointerEvent) => void;
  onUp: () => void;
}) {
  const color = COLOR[laneKey];
  const len = clip.end - clip.start;
  const frames =
    laneKey === "story" && clip.src
      ? (len > 4 ? [mediaStart + len * 0.25, mediaStart + len * 0.75] : [mediaStart + len / 2]).map((t) => previews.frames[frameKey(clip.src!, t)]).filter(Boolean)
      : [];
  // Waveforms on sound tracks only: a shot shares its file with its own sound on A1.
  const peaks = clip.src && laneKey !== "story" ? previews.peaks[clip.src] : undefined;
  const bars = peaks ? waveformPath(peaks, mediaStart, len, w, h - 20) : null;
  const volumeY = clip.volume !== null && (clip.kind === "audio" || laneKey === "clip-sound") ? 14 + (1 - clip.volume) * (h - 24) : null;
  const handle = "absolute top-0 z-10 h-full w-[7px] cursor-ew-resize";
  return (
    <div
      className="absolute top-1 overflow-hidden rounded-[6px]"
      style={{
        left,
        width: w,
        height: h - 8,
        background: laneKey === "story" ? "#1a1d24" : `rgba(${color.rgb},0.14)`,
        boxShadow: `inset 0 0 0 1px rgba(${color.rgb},${laneKey === "story" ? 0.25 : 0.55})${selected ? ", 0 0 0 2px #e0a468" : ""}`,
      }}
      onPointerDown={(e) => onDown(e, clip, "move")}
      onPointerMove={onMove}
      onPointerUp={onUp}
      role="button"
      aria-label={clip.label}
      aria-pressed={selected}
      tabIndex={-1}
    >
      {frames.length > 0 && (
        <div className="absolute inset-0 flex">
          {frames.map((src, i) => (
            <div key={i} className="h-full flex-1" style={{ backgroundImage: `url(${src})`, backgroundSize: "auto 100%", backgroundRepeat: "repeat-x" }} />
          ))}
        </div>
      )}
      {bars && (
        <svg className="absolute left-0" style={{ top: 14 }} width={w} height={h - 20} aria-hidden="true">
          <path d={bars} fill={color.solid} opacity={0.9} />
        </svg>
      )}
      {volumeY !== null && <div className="pointer-events-none absolute left-0 right-0 h-px bg-[#f4e3cf]" style={{ top: volumeY }} />}
      {w > 30 && (
        <span
          className="pointer-events-none absolute left-1 top-1 max-w-[calc(100%-8px)] truncate rounded-[4px] px-1.5 text-[10px]"
          style={{ background: laneKey === "story" ? "rgba(7,8,11,0.72)" : "transparent", color: laneKey === "story" ? "#ecedf1" : color.solid }}
        >
          {laneKey === "titles" ? `T  ${clip.label}` : clip.label}
        </span>
      )}
      <div className={`${handle} left-0`} onPointerDown={(e) => onDown(e, clip, "start")} onPointerMove={onMove} onPointerUp={onUp} />
      <div className={`${handle} right-0`} onPointerDown={(e) => onDown(e, clip, "end")} onPointerMove={onMove} onPointerUp={onUp} />
    </div>
  );
}

/** Mirrored bars for the part of the source a clip plays, fitted to its width. */
export function waveformPath(peaks: number[], mediaStart: number, seconds: number, width: number, height: number): string {
  const from = Math.max(0, Math.floor(mediaStart * PEAKS_PER_SECOND));
  const to = Math.min(peaks.length, Math.ceil((mediaStart + seconds) * PEAKS_PER_SECOND));
  const slice = peaks.slice(from, to);
  if (slice.length === 0 || width < 2) return "";
  const barW = 3;
  const n = Math.max(1, Math.floor(width / barW));
  let d = "";
  for (let i = 0; i < n; i++) {
    const a = Math.floor((i * slice.length) / n);
    const b = Math.max(a + 1, Math.floor(((i + 1) * slice.length) / n));
    let p = 0;
    for (let j = a; j < b && j < slice.length; j++) p = Math.max(p, slice[j]);
    const bh = Math.max(1, p * height);
    d += `M${i * barW} ${((height - bh) / 2).toFixed(1)}h2v${bh.toFixed(1)}h-2z`;
  }
  return d;
}
