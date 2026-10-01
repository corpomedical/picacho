"use client";

// The Edit Bay's program monitor: the project playing in HyperFrames' own
// player, sealed in a sandbox with an opaque origin (sandbox-origin="opaque":
// the project's scripts cannot reach picacho.ai), driven by our own transport.
// A saved change bumps `version`; the player reloads the working copy and
// comes back to the same moment.

import { useEffect, useRef, useState } from "react";

type PlayerEl = HTMLElement & {
  play(): void;
  pause(): void;
  seek(t: number): void;
  readonly currentTime: number;
  readonly duration: number;
  readonly paused: boolean;
  loop: boolean;
};

export type MonitorHandle = { seek(t: number): void; toggle(): void };

export function Monitor({
  base,
  version,
  aspect,
  duration,
  onTime,
  handleRef,
  cutPoints,
  compact = false,
  labels,
}: {
  base: string;
  version: number;
  aspect: string;
  duration: number;
  onTime: (t: number) => void;
  handleRef: React.MutableRefObject<MonitorHandle | null>;
  cutPoints: number[];
  /** A phone: no header, a shorter transport. */
  compact?: boolean;
  labels: { play: string; pause: string; prevCut: string; nextCut: string; loop: string; fullscreen: string; program: string; safeArea: string };
}) {
  const player = useRef<PlayerEl | null>(null);
  const frame = useRef<HTMLDivElement>(null);
  const host = useRef<HTMLDivElement>(null);
  const resumeAt = useRef(0);
  const [ready, setReady] = useState(false);
  const [time, setTime] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [loop, setLoop] = useState(false);
  const [defined, setDefined] = useState(false);
  // The title-safe frame, drawn over the picture only (never rendered into the video).
  const [safe, setSafe] = useState(true);

  useEffect(() => {
    let alive = true;
    void import("@hyperframes/player").then(() => alive && setDefined(true));
    return () => {
      alive = false;
    };
  }, []);

  const [w, h] = aspect === "9:16" ? [9, 16] : aspect === "1:1" ? [1, 1] : [16, 9];
  const src = `${base}index.html?draft=1&v=${version}`;

  // Each version is a new player element, made here (not in render): it comes
  // back to resumeAt, the last moment the old one reported.
  useEffect(() => {
    const hostEl = host.current;
    if (!defined || !hostEl) return;
    const p = document.createElement("hyperframes-player") as PlayerEl;
    p.setAttribute("src", src);
    p.setAttribute("sandbox-origin", "opaque");
    p.setAttribute("width", String(w === 16 ? 1920 : 1080));
    p.setAttribute("height", String(h === 16 ? 1920 : 1080));
    p.style.cssText = "display:block;width:100%;height:100%";
    // Always seek once ready — even to 0: the runtime lays out which clips
    // show only on a seek, so an unseeked first frame shows every caption at once.
    const onReady = () => {
      setReady(true);
      p.seek(Math.min(resumeAt.current, Math.max(0, p.duration - 0.05)));
    };
    const onUpdate = (e: Event) => {
      const t = (e as CustomEvent<{ currentTime: number }>).detail?.currentTime ?? p.currentTime;
      resumeAt.current = t;
      setTime(t);
      onTime(t);
    };
    const onPlay = () => setPlaying(true);
    const onPause = () => setPlaying(false);
    p.addEventListener("ready", onReady);
    p.addEventListener("timeupdate", onUpdate);
    p.addEventListener("play", onPlay);
    p.addEventListener("pause", onPause);
    p.addEventListener("ended", onPause);
    hostEl.appendChild(p);
    player.current = p;
    return () => {
      p.removeEventListener("ready", onReady);
      p.removeEventListener("timeupdate", onUpdate);
      p.removeEventListener("play", onPlay);
      p.removeEventListener("pause", onPause);
      p.removeEventListener("ended", onPause);
      p.remove();
      if (player.current === p) player.current = null;
      setReady(false);
    };
  }, [defined, src, w, h, onTime]);

  useEffect(() => {
    if (player.current) player.current.loop = loop;
  }, [loop, ready]);

  // The bay's handle on the transport (the timeline seeks through it), kept current after each render.
  useEffect(() => {
    handleRef.current = {
      seek: (t: number) => {
        const at = Math.max(0, Math.min(t, duration));
        player.current?.seek(at);
        resumeAt.current = at;
        setTime(at);
        onTime(at);
      },
      toggle: () => {
        const p = player.current;
        if (!p) return;
        if (p.paused) p.play();
        else p.pause();
      },
    };
  });

  const jump = (dir: -1 | 1) => {
    const pts = [0, ...cutPoints, duration].sort((a, b) => a - b);
    const next = dir === 1 ? pts.find((p) => p > time + 0.05) : [...pts].reverse().find((p) => p < time - 0.05);
    if (next !== undefined) handleRef.current?.seek(next);
  };

  return (
    <div className="flex h-full min-h-0 flex-col bg-[#060709]">
      {!compact && (
        <div className="flex h-10 shrink-0 items-center justify-between px-4 font-mono text-[11px] text-[#6c717c]">
          <span className="uppercase tracking-[0.08em]">{labels.program}</span>
          <span>
            {aspect} · {w === 16 ? 1920 : 1080} × {h === 16 ? 1920 : 1080}
          </span>
        </div>
      )}
      <div className={`flex min-h-0 w-full flex-1 items-center justify-center ${compact ? "px-3 pt-3" : "px-4"}`}>
        <div
          ref={frame}
          className="relative h-full max-h-full overflow-hidden rounded-[6px] bg-black shadow-[0_0_0_1px_rgba(255,255,255,0.08),0_30px_60px_-20px_rgba(0,0,0,0.9)]"
          style={{ aspectRatio: `${w} / ${h}`, maxWidth: "100%" }}
        >
          <div ref={host} className="absolute inset-0" />
          {safe && <div className="pointer-events-none absolute inset-[7%] rounded-[2px] border border-dashed border-[rgba(255,255,255,0.16)]" aria-hidden="true" />}
          {!ready && <div className="absolute inset-0 animate-pulse bg-[rgba(255,255,255,0.02)]" aria-hidden="true" />}
        </div>
      </div>
      <div className={`flex w-full shrink-0 items-center gap-1.5 ${compact ? "h-[52px] px-3" : "mt-1 h-[60px] border-t border-[rgba(255,255,255,0.04)] px-4"}`}>
        <span className={`whitespace-nowrap font-mono tabular-nums text-[#eceef2] ${compact ? "text-[13px]" : "text-[17px] tracking-[0.02em]"}`}>
          {compact ? shortTime(time) : longTimecode(time)}
          <span className={`ml-2 text-[#565a64] ${compact ? "text-[11px]" : "text-[12px]"}`}>/ {compact ? shortTime(duration) : longTimecode(duration)}</span>
        </span>
        <div className="flex-1" />
        <IconButton label={labels.prevCut} onClick={() => jump(-1)} icon="back" />
        <button
          type="button"
          aria-label={playing ? labels.pause : labels.play}
          onClick={() => handleRef.current?.toggle()}
          className="flex h-[42px] w-[42px] items-center justify-center rounded-full bg-[#eceef2] text-[#0b0c0f]"
        >
          {playing ? <Icon name="pause" size={16} /> : <Icon name="play" size={16} />}
        </button>
        <IconButton label={labels.nextCut} onClick={() => jump(1)} icon="fwd" />
        <div className="flex-1" />
        {!compact && <IconButton label={labels.safeArea} onClick={() => setSafe((v) => !v)} icon="safe" on={safe} />}
        {!compact && <IconButton label={labels.loop} onClick={() => setLoop((l) => !l)} icon="loop" on={loop} />}
        <IconButton label={labels.fullscreen} onClick={() => void frame.current?.requestFullscreen?.()} icon="full" />
      </div>
    </div>
  );
}

/** A phone's short clock: 0:04.6. */
function shortTime(t: number): string {
  const s = Math.max(0, t);
  return `${Math.floor(s / 60)}:${(s % 60).toFixed(1).padStart(4, "0")}`;
}

/** Hours:minutes:seconds:frames at 30 fps, as an editor's timecode reads. */
export function longTimecode(t: number): string {
  const s = Math.max(0, t);
  const hr = Math.floor(s / 3600);
  return `${String(hr).padStart(2, "0")}:${timecode(s - hr * 3600)}`;
}

export function timecode(t: number): string {
  const s = Math.max(0, t);
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  const fr = Math.min(29, Math.floor((s % 1) * 30));
  return `${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}:${String(fr).padStart(2, "0")}`;
}

const PATHS: Record<string, string> = {
  play: "M7 5l12 7-12 7z",
  pause: "M7 5h4v14H7zM13 5h4v14h-4z",
  back: "M18 6L9 12l9 6V6zM6 6v12",
  fwd: "M6 6l9 6-9 6V6zM18 6v12",
  loop: "M17 2l4 4-4 4M3 11v-1a4 4 0 0 1 4-4h14M7 22l-4-4 4-4M21 13v1a4 4 0 0 1-4 4H3",
  full: "M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5",
  safe: "M3 5h18v14H3zM7 9h10v6H7z",
};

export function Icon({ name, size = 16 }: { name: keyof typeof PATHS | string; size?: number }) {
  const filled = name === "play" || name === "pause";
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill={filled ? "currentColor" : "none"} stroke={filled ? "none" : "currentColor"} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={PATHS[name] ?? ""} />
    </svg>
  );
}

function IconButton({ label, onClick, icon, on = false }: { label: string; onClick: () => void; icon: string; on?: boolean }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      aria-pressed={on}
      onClick={onClick}
      className={`flex h-9 w-9 items-center justify-center rounded-lg ${on ? "text-[#e0a468]" : "text-[#8b909b] hover:text-[#eceef2]"}`}
    >
      <Icon name={icon} />
    </button>
  );
}
