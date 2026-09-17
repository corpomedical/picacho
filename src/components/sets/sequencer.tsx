"use client";

// The sequencer (canvas page J, board J1; cut B, 2026-09-17): the timeline
// under the viewport while the film is open — a transport, a ruler, and a
// track each for the camera (its keyframes), the figure (where it stands
// at a beat's end), the sun (the hour a beat steps to), the key light and
// the takes (each beat's clip, or that it has none yet), with a playhead
// that follows the previz and the reel. Clicking the ruler scrubs the
// previz along the move, free. The numbers come from lib/sets/sequencer.ts;
// the film's data stays film.ts's.

import { useRef, type ReactNode } from "react";
import { formatMsg } from "@/lib/i18n/format";
import type { Messages } from "@/lib/i18n/messages/en";
import { FILM_MAX_BEATS, type SetFilm } from "@/lib/sets/film";
import { SET_TAKE_ENGINES, type SetTakeEngine } from "@/lib/sets/take";
import { SEQUENCER_TRACKS, beatSpans, filmClock, filmDuration, keyframeAt, rulerSeconds, sunHours, takeState, type SequencerTrack } from "@/lib/sets/sequencer";
import type { StandPose } from "@/lib/sets/set-spec";
import { timeLabel } from "@/lib/sets/time-of-day";

type Strings = Messages["sets"];

const TRACK_COLOUR: Record<SequencerTrack, string> = { camera: "#e0a468", figure: "#d8b37c", sun: "#f5d76e", light: "#a9c6df", takes: "#9aa0ad" };
const BTN = "flex h-7 cursor-pointer items-center whitespace-nowrap rounded-[6px] px-2.5 text-[11.5px] font-medium text-[#9aa0ad] hover:text-[#ecedf1] disabled:cursor-default disabled:text-[#6b6f7a]";
const TBTN = "flex h-7 w-7 cursor-pointer items-center justify-center rounded-[6px] text-[#c6c9d1] hover:bg-white/[0.06] hover:text-[#ecedf1] disabled:cursor-default disabled:text-[#6b6f7a]";
const LANE_H = 24;

export type SequencerProps = {
  s: Strings;
  film: SetFilm;
  /** The beat in hand (the dock's Film tab edits it). */
  selected: number | null;
  /** Where the playhead stands, seconds into the film. */
  playhead: number;
  /** The previz or the reel is running. */
  playing: boolean;
  ready: boolean;
  /** The beat rendering now, if any. */
  busy: { beat: number } | null;
  /** Each beat's clip status (the shot's), or null with no clip. */
  clipStatus: readonly (string | null)[];
  rigTime: number | null;
  /** The rig's sensor height for this format (rig.ts sensorHeightMm): the lens a keyframe reads. */
  sensorHeightMm: number;
  /** The key light's name when a plot is on; null for the set as built. */
  light: string | null;
  /** The start still: its tile words, and the menu that picks one (drawn by the page, under the tile). */
  startLabel: string | null;
  startImage: string | null;
  startMenu: ReactNode;
  startOpen: boolean;
  startDisabled: boolean;
  onStartMenu(): void;
  poseName(pose: StandPose): string;
  /** What else the figure bar says of a beat (cut D): the walk and the eye-line, or "". */
  figureNote?(index: number): string;
  onSelect(index: number): void;
  onSeek(seconds: number): void;
  onPlay(): void;
  onStop(): void;
  onToStart(): void;
  onToEnd(): void;
  onPlayTake(index: number): void;
  onAddKeyframe(): void;
  onShotList(): void;
  engine: SetTakeEngine;
  onEngine(engine: SetTakeEngine): void;
  engineDisabled: boolean;
  reelReady: boolean;
  onPlayFilm(): void;
  onDownload(): void;
  downloading: boolean;
  renderLabel: string;
  onRender(): void;
  renderDisabled: boolean;
  hint: string;
  note: string | null;
  error: string | null;
};

export function Sequencer(p: SequencerProps) {
  const { s, film } = p;
  const w = s.sequencer;
  const spans = beatSpans(film);
  const duration = Math.max(1, filmDuration(film));
  const pct = (t: number) => `${Math.min(100, Math.max(0, (t / duration) * 100))}%`;
  const lanesRef = useRef<HTMLDivElement>(null);
  const sel = p.selected !== null ? film.beats[p.selected] : null;
  const selSpan = p.selected !== null ? spans[p.selected] : null;
  const beatLine =
    film.beats.length === 0
      ? w.noBeats
      : sel && selSpan
        ? formatMsg(w.beatLine, { n: p.selected! + 1, m: film.beats.length, move: sel.move ? s.rig.moves[sel.move] : w.byHand, a: selSpan.start.toFixed(1), b: selSpan.end.toFixed(1) })
        : formatMsg(s.filmLength, { s: filmDuration(film), n: film.beats.length });
  const seek = (e: React.MouseEvent<HTMLDivElement>) => {
    const el = lanesRef.current;
    if (!el || film.beats.length === 0) return;
    const r = el.getBoundingClientRect();
    const t = ((e.clientX - r.left) / Math.max(1, r.width)) * duration;
    p.onSeek(Math.min(duration, Math.max(0, t)));
  };
  const sun = sunHours(film, p.rigTime);
  const trackName: Record<SequencerTrack, string> = w.tracks;

  return (
    <div data-sequencer className="flex flex-none flex-col border-t border-white/[0.07] bg-[#191a20] text-[#c6c9d1]">
      {/* the transport */}
      <div className="flex h-10 flex-none items-center gap-1.5 border-b border-white/[0.07] px-2.5">
        <button type="button" onClick={p.onToStart} disabled={!p.ready || film.beats.length === 0} className={TBTN} title={w.toStart} aria-label={w.toStart}>
          <svg viewBox="0 0 24 24" fill="currentColor" className="h-3.5 w-3.5" aria-hidden>
            <path d="M6 5h2v14H6zM20 5v14L9 12z" />
          </svg>
        </button>
        <button
          type="button"
          onClick={p.playing ? p.onStop : p.onPlay}
          disabled={!p.ready || film.beats.length === 0}
          className={`${TBTN} bg-[#ecedf1] text-[#1b1c20] hover:bg-white hover:text-[#1b1c20]`}
          title={p.playing ? w.pause : s.filmPlayMove}
          aria-label={p.playing ? w.pause : s.filmPlayMove}
          data-transport="play"
        >
          {p.playing ? (
            <svg viewBox="0 0 24 24" fill="currentColor" className="h-3.5 w-3.5" aria-hidden>
              <path d="M6 6h12v12H6z" />
            </svg>
          ) : (
            <svg viewBox="0 0 24 24" fill="currentColor" className="h-3.5 w-3.5" aria-hidden>
              <path d="M7 4l13 8-13 8z" />
            </svg>
          )}
        </button>
        <button type="button" onClick={p.onToEnd} disabled={!p.ready || film.beats.length === 0} className={TBTN} title={w.toEnd} aria-label={w.toEnd}>
          <svg viewBox="0 0 24 24" fill="currentColor" className="h-3.5 w-3.5" aria-hidden>
            <path d="M16 5h2v14h-2zM4 5v14l11-7z" />
          </svg>
        </button>
        <span className="ml-1 whitespace-nowrap text-[12px] tabular-nums text-[#ecedf1]" data-clock>
          {filmClock(p.playhead)} <span className="text-[#868b96]">/ {filmClock(filmDuration(film))}</span>
        </span>
        <span aria-hidden className="mx-1 h-5 w-px bg-white/[0.09]" />
        <span className="min-w-[140px] flex-1 truncate text-[11.5px] text-[#9aa0ad]" data-beat-line>
          {beatLine}
        </span>
        <span className="hidden whitespace-nowrap rounded-full bg-[rgba(224,164,104,0.13)] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.06em] text-[#e0a468] min-[1600px]:inline">{w.held}</span>
        {film.beats.length < FILM_MAX_BEATS && (
          <button type="button" onClick={p.onAddKeyframe} disabled={!p.ready || p.busy !== null} className={BTN}>
            + {s.filmKeyframe}
          </button>
        )}
        <span className="flex h-7 items-center gap-0.5 rounded-[6px] bg-white/[0.05] p-0.5 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.07)]">
          {(["omni", "veo"] as const).map((e) => (
            <button
              key={e}
              type="button"
              onClick={() => p.onEngine(e)}
              disabled={p.engineDisabled}
              title={e === "omni" ? formatMsg(s.takeEngineOmni, { s: SET_TAKE_ENGINES.omni.seconds }) : formatMsg(s.takeEngineVeo, { s: SET_TAKE_ENGINES.veo.seconds })}
              className={
                film.engine === e
                  ? "flex h-6 cursor-default items-center whitespace-nowrap rounded-[4px] bg-[#2a2b33] px-2 text-[11px] font-medium text-[#e0a468]"
                  : "flex h-6 cursor-pointer items-center whitespace-nowrap rounded-[4px] px-2 text-[11px] font-medium text-[#9aa0ad] hover:text-[#ecedf1] disabled:cursor-default disabled:text-[#6b6f7a]"
              }
            >
              {e === "omni" ? w.engineOmni : w.engineVeo} · {SET_TAKE_ENGINES[e].seconds} s
            </button>
          ))}
        </span>
        <button type="button" onClick={p.onShotList} className={BTN}>
          {formatMsg(w.shotList, { n: film.beats.length })}
        </button>
        {p.reelReady && (
          <button type="button" onClick={p.onPlayFilm} className={BTN}>
            ▶ {s.filmPlayFilm}
          </button>
        )}
        {p.reelReady && (
          <button type="button" onClick={p.onDownload} disabled={p.downloading} className={BTN}>
            {p.downloading ? s.filmDownloading : `↓ ${s.filmDownload}`}
          </button>
        )}
        <button
          type="button"
          onClick={p.onRender}
          disabled={p.renderDisabled}
          className="flex h-7 cursor-pointer items-center whitespace-nowrap rounded-[6px] bg-[#e0a468] px-3 text-[11.5px] font-semibold text-[#1b1c20] hover:opacity-90 disabled:cursor-default disabled:bg-[#2a2b33] disabled:text-[#9aa0ad]"
        >
          {p.renderLabel}
        </button>
      </div>

      {/* the lanes */}
      <div className="flex min-h-0 items-stretch">
        {/* the tracks' names, with the start still above them */}
        <div className="flex w-[168px] flex-none flex-col border-r border-white/[0.07]">
          <div className="relative flex h-6 items-center gap-2 px-2.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-[#868b96]">
            <button
              type="button"
              onClick={p.onStartMenu}
              disabled={p.startDisabled}
              aria-haspopup="listbox"
              aria-expanded={p.startOpen}
              title={s.filmStarts}
              className="flex h-5 max-w-full cursor-pointer items-center gap-1.5 rounded-[4px] bg-white/[0.05] px-1.5 text-[10px] font-semibold uppercase tracking-[0.06em] text-[#c6c9d1] hover:bg-white/[0.09] disabled:cursor-default disabled:text-[#6b6f7a]"
            >
              {p.startImage && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={p.startImage} alt="" className="h-4 w-4 rounded-[2px] object-cover" />
              )}
              <span className="min-w-0 truncate">{p.startLabel ?? s.filmStarts}</span>
            </button>
            {p.startOpen && p.startMenu}
          </div>
          {SEQUENCER_TRACKS.map((t) => (
            <div key={t} className="flex items-center gap-2 px-2.5 text-[11px] text-[#9aa0ad]" style={{ height: LANE_H }}>
              <i aria-hidden className="h-[7px] w-[7px] flex-none rounded-full" style={{ background: TRACK_COLOUR[t] }} />
              <span className="min-w-0 truncate">{trackName[t]}</span>
            </div>
          ))}
        </div>

        {/* the ruler and the lanes, with the playhead over them */}
        <div ref={lanesRef} className="relative min-w-0 flex-1 cursor-crosshair select-none" onClick={seek} title={w.seek} data-lanes>
          <div className="relative h-6 border-b border-white/[0.07] text-[10px] tabular-nums text-[#868b96]">
            {rulerSeconds(filmDuration(film)).map((sec) => (
              <span key={sec} className="absolute top-1" style={{ left: pct(sec), transform: "translateX(-50%)" }}>
                {sec}s
              </span>
            ))}
            {rulerSeconds(filmDuration(film)).map((sec) => (
              <i key={`t${sec}`} aria-hidden className="absolute bottom-0 h-1.5 w-px bg-white/[0.2]" style={{ left: pct(sec) }} />
            ))}
          </div>
          {/* the beats' bounds, faintly, through every lane */}
          {spans.map((sp) => (
            <i key={`b${sp.index}`} aria-hidden className="pointer-events-none absolute bottom-0 top-6 w-px bg-white/[0.06]" style={{ left: pct(sp.end) }} />
          ))}

          {/* camera: the keyframes */}
          <div className="relative" style={{ height: LANE_H }}>
            <i aria-hidden className="absolute left-0 right-0 top-1/2 h-px bg-[rgba(224,164,104,0.35)]" />
            {p.startLabel && (
              <span
                aria-hidden
                className="absolute top-1/2 h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rotate-45 rounded-[2px] bg-[#e0a468]"
                style={{ left: pct(0) }}
              />
            )}
            {spans.map((sp) => {
              const k = keyframeAt(film.beats[sp.index].end, p.sensorHeightMm);
              const on = p.selected === sp.index;
              return (
                <button
                  key={`k${sp.index}`}
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    p.onSelect(sp.index);
                  }}
                  title={formatMsg(w.keyframe, { n: sp.index + 2, lens: k.lensMm, m: k.heightM })}
                  aria-label={formatMsg(w.keyframe, { n: sp.index + 2, lens: k.lensMm, m: k.heightM })}
                  data-keyframe={sp.index}
                  className="absolute top-1/2 z-[1] flex -translate-x-1/2 -translate-y-1/2 cursor-pointer items-center gap-1.5"
                  style={{ left: pct(sp.end) }}
                >
                  <span aria-hidden className={`block h-2.5 w-2.5 rotate-45 rounded-[2px] ${on ? "bg-[#f0cda6] shadow-[0_0_0_3px_rgba(224,164,104,0.3)]" : "bg-[#e0a468]"}`} />
                </button>
              );
            })}
            {sel && selSpan && (
              <span
                className="pointer-events-none absolute top-1/2 -translate-y-1/2 whitespace-nowrap text-[10px] text-[#f0cda6]"
                style={{ left: `calc(${pct(selSpan.start)} + 8px)` }}
              >
                {formatMsg(w.keyframe, {
                  n: selSpan.index + 2,
                  lens: keyframeAt(sel.end, p.sensorHeightMm).lensMm,
                  m: keyframeAt(sel.end, p.sensorHeightMm).heightM,
                })}
              </span>
            )}
          </div>

          {/* figure: where it stands at a beat's end */}
          <div className="relative" style={{ height: LANE_H }}>
            {spans.map((sp) => {
              const f = film.beats[sp.index].figure;
              if (!f) return null;
              return (
                <button
                  key={`f${sp.index}`}
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    p.onSelect(sp.index);
                  }}
                  className="absolute top-[3px] flex h-[18px] cursor-pointer items-center overflow-hidden whitespace-nowrap rounded-[4px] px-1.5 text-[10px] text-[#ecedf1]"
                  style={{ left: pct(sp.start), width: pct(sp.end - sp.start), background: "rgba(216,179,124,0.22)", boxShadow: "inset 0 0 0 1px rgba(216,179,124,0.4)" }}
                >
                  {formatMsg(w.figureBar, { pose: p.poseName(f.pose), x: f.x.toFixed(1), z: f.z.toFixed(1) })}
                  {p.figureNote?.(sp.index) ?? ""}
                </button>
              );
            })}
          </div>

          {/* sun: the hour a beat steps to */}
          <div className="relative" style={{ height: LANE_H }}>
            {sun.map((h) => {
              const sp = spans[h.index];
              return (
                <button
                  key={`s${h.index}`}
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    p.onSelect(h.index);
                  }}
                  className="absolute top-[3px] flex h-[18px] cursor-pointer items-center overflow-hidden whitespace-nowrap rounded-[4px] px-1.5 text-[10px] text-[#ecedf1]"
                  style={{ left: pct(sp.start), width: pct(sp.end - sp.start), background: "linear-gradient(90deg, rgba(245,215,110,0.35), rgba(224,120,80,0.45))" }}
                >
                  {formatMsg(w.sunBar, { a: h.from !== null ? timeLabel(h.from) : s.filmHourAsBuilt, b: timeLabel(h.to) })}
                </button>
              );
            })}
          </div>

          {/* key light: the plot, over the whole film */}
          <div className="relative" style={{ height: LANE_H }}>
            {p.light ? (
              <span
                className="absolute top-[3px] flex h-[18px] items-center overflow-hidden whitespace-nowrap rounded-[4px] px-1.5 text-[10px] text-[#ecedf1]"
                style={{ left: pct(0), width: pct(duration), background: "rgba(169,198,223,0.2)", boxShadow: "inset 0 0 0 1px rgba(169,198,223,0.4)" }}
              >
                {p.light}
              </span>
            ) : (
              <span className="absolute left-2 top-1/2 -translate-y-1/2 text-[10px] text-[#868b96]">{w.lightAsBuilt}</span>
            )}
          </div>

          {/* takes: each beat's clip */}
          <div className="relative" style={{ height: LANE_H }}>
            {spans.map((sp) => {
              const state = takeState(p.clipStatus[sp.index] ?? null, p.busy?.beat === sp.index);
              const label =
                state === "done"
                  ? formatMsg(w.takeDone, { n: sp.index + 1 })
                  : state === "rendering"
                    ? formatMsg(w.takeRendering, { n: sp.index + 1 })
                    : state === "failed"
                      ? formatMsg(w.takeFailed, { n: sp.index + 1 })
                      : formatMsg(w.takeNotShot, { n: sp.index + 1, engine: film.engine === "omni" ? w.engineOmni : w.engineVeo });
              const style =
                state === "done"
                  ? { background: "#2a2b33", boxShadow: "inset 0 0 0 1px rgba(255,255,255,0.15)", color: "#ecedf1" }
                  : state === "rendering"
                    ? { background: "rgba(224,164,104,0.14)", boxShadow: "inset 0 0 0 1px rgba(224,164,104,0.35)", color: "#f0cda6" }
                    : state === "failed"
                      ? { background: "rgba(224,90,90,0.14)", boxShadow: "inset 0 0 0 1px rgba(224,90,90,0.4)", color: "#f0a0a0" }
                      : { background: "rgba(255,255,255,0.04)", boxShadow: "inset 0 0 0 1px rgba(255,255,255,0.1)", color: "#9aa0ad" };
              return (
                <button
                  key={`t${sp.index}`}
                  type="button"
                  data-take={state}
                  onClick={(e) => {
                    e.stopPropagation();
                    if (state === "done") p.onPlayTake(sp.index);
                    else p.onSelect(sp.index);
                  }}
                  className="absolute top-[3px] flex h-[18px] cursor-pointer items-center overflow-hidden whitespace-nowrap rounded-[4px] px-1.5 text-[10px]"
                  style={{ left: pct(sp.start), width: pct(sp.end - sp.start), ...style }}
                >
                  {label}
                </button>
              );
            })}
          </div>

          {/* the playhead */}
          {film.beats.length > 0 && (
            <i aria-hidden data-playhead className="pointer-events-none absolute bottom-0 top-0 z-[2] w-px bg-[#ecedf1]" style={{ left: pct(p.playhead) }}>
              <span className="absolute -left-[5px] top-0 h-0 w-0 border-x-[5px] border-t-[6px] border-x-transparent border-t-[#ecedf1]" />
            </i>
          )}
        </div>
      </div>

      {(p.note || p.error || p.hint) && (
        <div className="flex h-6 flex-none items-center gap-3 border-t border-white/[0.07] px-2.5 text-[10.5px] text-[#868b96]">
          {p.error ? <span className="min-w-0 truncate text-red-400">{p.error}</span> : p.note ? <span className="min-w-0 truncate">{p.note}</span> : <span className="min-w-0 truncate">{p.hint}</span>}
        </div>
      )}
    </div>
  );
}
