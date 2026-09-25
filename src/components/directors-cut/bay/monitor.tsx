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
  labels,
}: {
  base: string;
  version: number;
  aspect: string;
  duration: number;
  onTime: (t: number) => void;
  handleRef: React.MutableRefObject<MonitorHandle | null>;
  cutPoints: number[];
  labels: { play: string; pause: string; prevCut: string; nextCut: string; loop: string; fullscreen: string; program: string };
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
    <div className="flex h-full min-h-0 flex-col items-center bg-[#040506] px-4 pb-2 pt-4">
      <div className="flex min-h-0 w-full flex-1 items-center justify-center">
        <div ref={frame} className="relative h-full max-h-full overflow-hidden rounded-[4px] bg-black shadow-[0_0_0_1px_rgba(255,255,255,0.06)]" style={{ aspectRatio: `${w} / ${h}`, maxWidth: "100%" }}>
          <div ref={host} className="absolute inset-0" />
          <span className="pointer-events-none absolute left-2.5 top-2 rounded-[5px] bg-[rgba(7,8,11,0.7)] px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-[0.08em] text-[#9aa0ad]">
            {labels.program}
          </span>
          {!ready && <div className="absolute inset-0 animate-pulse bg-[rgba(255,255,255,0.02)]" aria-hidden="true" />}
        </div>
      </div>
      <div className="mt-2 flex h-11 w-full max-w-[720px] items-center gap-1.5">
        <span className="whitespace-nowrap font-mono text-[12px] tabular-nums text-[#ecedf1]">
          {timecode(time)} <span className="text-[#6b6f7a]">/ {timecode(duration)}</span>
        </span>
        <div className="flex-1" />
        <IconButton label={labels.prevCut} onClick={() => jump(-1)} icon="back" />
        <button
          type="button"
          aria-label={playing ? labels.pause : labels.play}
          onClick={() => handleRef.current?.toggle()}
          className="flex h-10 w-10 items-center justify-center rounded-full bg-[#ecedf1] text-[#0b0c10]"
        >
          {playing ? <Icon name="pause" size={16} /> : <Icon name="play" size={16} />}
        </button>
        <IconButton label={labels.nextCut} onClick={() => jump(1)} icon="fwd" />
        <div className="flex-1" />
        <IconButton label={labels.loop} onClick={() => setLoop((l) => !l)} icon="loop" on={loop} />
        <IconButton label={labels.fullscreen} onClick={() => void frame.current?.requestFullscreen?.()} icon="full" />
      </div>
    </div>
  );
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
      className={`flex h-8 w-8 items-center justify-center rounded-lg ${on ? "bg-[rgba(224,164,104,0.14)] text-[#e0a468]" : "text-[#9aa0ad] hover:text-[#ecedf1]"}`}
    >
      <Icon name={icon} />
    </button>
  );
}
