"use client";

import Link from "next/link";
import type { CSSProperties, ReactNode } from "react";
import type { VoicePhase } from "./use-hands-free";
import { usageFraction, wheelGeometry, type WheelStyle } from "./wheel-style";
import styles from "./wheel.module.css";

// The wheel that opens out of the lamp (2026-09-25, operator: "a wheel that
// appears from behind the light bulb. The wheel has icons that enable speech
// and other options" and "a lighted wheel that fills depending on the usage.
// When the wheel is fully lit, then the user know that the limit has
// reached"). Redrawn 2026-09-27 ("I want an animated wheel that pops out but
// in a different way and shape", then Filament picked, "and add blossom. Let
// there be 2 options for the user to pick from"); wheel-style.ts has both.
//
// Centred on the lamp in its corner, opening into the quarter that faces the
// page (left round to straight up). Filament: a thin arc of light; a spark
// runs along it and each control lights as it passes, named beside it; an
// inner arc is the allowance meter. Blossom: five petals open out of the
// bulb; a ring round the bulb is the meter. Fully lit = the allowance is
// spent. It grows out of the lamp when the chat opens and folds back into it
// when the chat closes (`closing`).

export type WheelProps = {
  style: WheelStyle;
  cx: number;
  cy: number;
  phone: boolean;
  /** Folding back into the lamp; the parent unmounts it a moment later. */
  closing?: boolean;
  /** Drawn inside a box (Settings' preview) rather than over the page. */
  contained?: boolean;
  /** A picture only (Settings' preview): the controls can't be pressed. */
  demo?: boolean;
  used: number;
  cap: number;
  phase: VoicePhase;
  level: number;
  readAloud: boolean;
  notesOpen: boolean;
  notesCount: number;
  voiceAvailable: boolean;
  onTalk: () => void;
  onReadAloud: () => void;
  onNotes: () => void;
  onFresh: () => void;
  canFresh: boolean;
};

type Control = {
  key: string;
  /** Said to screen readers and shown when pointed at. */
  label: string;
  /** Written beside it (Filament). */
  name: string;
  tag?: string;
  on?: boolean;
  hot?: boolean;
  live?: boolean;
  disabled?: boolean;
  onClick?: () => void;
  href?: string;
  icon: ReactNode;
  badge?: number;
};

function controlsFor(p: WheelProps): Control[] {
  const talking = p.phase !== "off";
  return [
    {
      key: "talk",
      label: !p.voiceAvailable ? "Voice isn't available here" : talking ? "Stop talking" : "Talk hands-free",
      name: talking ? "End talk" : "Talk",
      hot: p.voiceAvailable,
      live: talking,
      disabled: !p.voiceAvailable,
      onClick: p.onTalk,
      icon: <WaveIcon />,
    },
    {
      key: "aloud",
      label: p.readAloud ? "Stop reading answers aloud" : "Read answers aloud",
      name: "Read aloud",
      tag: p.readAloud ? "on" : "off",
      on: p.readAloud,
      disabled: !p.voiceAvailable,
      onClick: p.onReadAloud,
      icon: <SpeakerIcon muted={!p.readAloud} />,
    },
    { key: "notes", label: "Notes", name: "Notes", on: p.notesOpen, onClick: p.onNotes, icon: <NotesIcon />, badge: p.notesCount },
    { key: "fresh", label: "Start fresh", name: "Start fresh", disabled: !p.canFresh, onClick: p.onFresh, icon: <FreshIcon /> },
    { key: "name", label: "Name and voice", name: "Name and voice", href: "/app/settings?tab=preferences", icon: <SlidersIcon /> },
  ];
}

const rad = (d: number) => (d * Math.PI) / 180;

export function Wheel(p: WheelProps) {
  const g = wheelGeometry(p.style, p.phone);
  // The box the wheel is drawn in, centred on the lamp; wide enough for the
  // names to the left of Filament's arc.
  const half = g.reach + 150;
  const size = half * 2;
  const pct = usageFraction(p.used, p.cap);
  const full = pct >= 1;
  const usageLabel = full
    ? "Allowance used up for this period"
    : `${p.used.toLocaleString()} of ${p.cap.toLocaleString()} assistant units used this period`;
  const usageText = full ? (
    <b>Limit reached</b>
  ) : (
    <>
      <b>{Math.round(pct * 100)}%</b> this month
    </>
  );
  const box: CSSProperties = {
    left: p.cx - half,
    top: p.cy - half,
    width: size,
    height: size,
    position: p.contained ? "absolute" : "fixed",
    "--pct": String(pct * 100),
    "--level": String(p.level),
  } as CSSProperties;
  const cls = [styles.wheel, p.style === "blossom" ? styles.blossom : styles.filament, p.closing ? styles.closing : "", full ? styles.full : ""]
    .filter(Boolean)
    .join(" ");
  const controls = controlsFor(p);
  return (
    <div className={cls} style={box} data-producer-wheel={p.style}>
      {p.style === "blossom" ? (
        <Blossom p={p} half={half} size={size} radius={g.radius} petalWidth={g.petalWidth} controls={controls} usageLabel={usageLabel} usageText={usageText} demo={p.demo} />
      ) : (
        <Filament half={half} size={size} radius={g.radius} controls={controls} usageLabel={usageLabel} usageText={usageText} demo={p.demo} />
      )}
    </div>
  );
}

type Drawn = {
  half: number;
  size: number;
  radius: number;
  controls: Control[];
  usageLabel: string;
  usageText: ReactNode;
  demo?: boolean;
};

function arc(cx: number, cy: number, r: number, fromDeg: number, toDeg: number): string {
  const a = [cx + r * Math.cos(rad(fromDeg)), cy + r * Math.sin(rad(fromDeg))];
  const b = [cx + r * Math.cos(rad(toDeg)), cy + r * Math.sin(rad(toDeg))];
  return `M ${a[0].toFixed(2)} ${a[1].toFixed(2)} A ${r} ${r} 0 ${toDeg - fromDeg > 180 ? 1 : 0} 1 ${b[0].toFixed(2)} ${b[1].toFixed(2)}`;
}

const START = 180; // left of the lamp…
const SWEEP = 90; // …round to straight above it

function Filament({ half, size, radius, controls, usageLabel, usageText, demo }: Drawn) {
  const inner = radius - 30;
  const at = (i: number) => {
    const a = START + (SWEEP / (controls.length - 1)) * i;
    return { a, x: half + radius * Math.cos(rad(a)), y: half + radius * Math.sin(rad(a)) };
  };
  const first = at(0);
  return (
    <>
      <svg className={styles.filSvg} width={size} height={size} role="img" aria-label={usageLabel}>
        <title>{usageLabel}</title>
        <path className={styles.filTrack} d={arc(half, half, radius, START - 8, START + SWEEP + 8)} pathLength={100} />
        <path className={styles.filUse} d={arc(half, half, inner, START, START + SWEEP)} />
        <path className={styles.filFill} d={arc(half, half, inner, START, START + SWEEP)} pathLength={100} />
        <path className={styles.filSpark} d={arc(half, half, radius, START - 8, START + SWEEP + 8)} pathLength={100} />
      </svg>
      <span className={styles.usageText} style={{ right: size - first.x + 28, top: first.y + 13 }} aria-hidden="true">
        {usageText}
      </span>
      {controls.map((c, i) => {
        const { x, y } = at(i);
        const top = i === controls.length - 1;
        const timing = {
          "--in": `${90 + i * 85}ms`,
          "--out": `${(controls.length - 1 - i) * 30}ms`,
        } as CSSProperties;
        return (
          <span key={c.key}>
            <ControlButton
              c={c}
              demo={demo}
              className={styles.bead}
              style={{ left: x, top: y, "--hx": `${half - x}px`, "--hy": `${half - y}px`, ...timing } as CSSProperties}
            >
              {c.icon}
              {c.badge ? <span className={styles.badge}>{c.badge}</span> : null}
            </ControlButton>
            <span
              className={top ? `${styles.name} ${styles.nameUp}` : styles.name}
              style={{ right: top ? size - x - 21 : size - x + 28, top: top ? y - 47 : y - 9, ...timing }}
              aria-hidden="true"
            >
              {c.name}
              {c.tag ? <em> {c.tag}</em> : null}
            </span>
          </span>
        );
      })}
    </>
  );
}

// Left of the lamp round to straight up: its own edge and, in the app, the
// tab bar are below and right of it.
const PETALS = [170, 195, 220, 245, 270];

function Blossom({ p, half, size, radius, petalWidth, controls, usageLabel, usageText, demo }: Drawn & { p: WheelProps; petalWidth: number }) {
  const ring = 31;
  return (
    <>
      <svg className={styles.ringSvg} width={size} height={size} role="img" aria-label={usageLabel}>
        <title>{usageLabel}</title>
        <circle className={styles.ringTrack} cx={half} cy={half} r={ring} />
        <circle
          className={styles.ringFill}
          cx={half}
          cy={half}
          r={ring}
          pathLength={100}
          transform={`rotate(-90 ${half} ${half})`}
        />
      </svg>
      <span
        className={`${styles.usageText} ${styles.usageStack}`}
        // Left of the flower, level with its middle petals: clear of the screen's edge.
        style={{ right: size - (half - radius - petalWidth / 2 - 6), top: half - radius * 0.62 }}
        aria-hidden="true"
      >
        {usageText}
      </span>
      {controls.map((c, i) => {
        const rot = PETALS[i] - 270;
        return (
          <span
            key={c.key}
            className={styles.arm}
            style={{ left: half - petalWidth / 2, top: half - radius, width: petalWidth, height: radius, transform: `rotate(${rot}deg)` }}
          >
            <ControlButton
              c={c}
              demo={demo}
              className={styles.petal}
              style={{ "--in": `${i * 55}ms`, "--out": `${(controls.length - 1 - i) * 30}ms` } as CSSProperties}
            >
              <span className={styles.petalIcon} style={{ transform: `rotate(${-rot}deg)` }}>
                {c.icon}
                {c.badge ? <span className={styles.badge}>{c.badge}</span> : null}
              </span>
            </ControlButton>
          </span>
        );
      })}
      {p.phase !== "off" && <span className={styles.bloomLive} style={{ left: half, top: half }} aria-hidden="true" />}
    </>
  );
}

function ControlButton({
  c,
  demo,
  className,
  style,
  children,
}: {
  c: Control;
  demo?: boolean;
  className: string;
  style: CSSProperties;
  children: ReactNode;
}) {
  const cls = [className, c.hot ? styles.hot : "", c.on ? styles.on : "", c.live ? styles.live : ""].filter(Boolean).join(" ");
  if (demo) {
    return (
      <span className={cls} style={style}>
        {children}
      </span>
    );
  }
  return c.href ? (
    <Link href={c.href} className={cls} style={style} aria-label={c.label} title={c.label}>
      {children}
    </Link>
  ) : (
    <button
      type="button"
      data-producer-spot={c.key === "notes" ? "notes" : undefined}
      className={cls}
      style={style}
      aria-label={c.label}
      aria-pressed={c.key === "talk" || c.key === "aloud" || c.key === "notes" ? !!(c.live || c.on) : undefined}
      title={c.label}
      disabled={c.disabled}
      onClick={c.onClick}
    >
      {children}
    </button>
  );
}

const svg = { viewBox: "0 0 16 16", fill: "none", stroke: "currentColor", strokeWidth: 1.6, strokeLinecap: "round", strokeLinejoin: "round" } as const;

function WaveIcon() {
  return (
    <svg {...svg} strokeWidth={1.9} width="17" height="17" aria-hidden="true">
      <path d="M2.5 7v2M5 5v6M8 2.5v11M11 5v6M13.5 7v2" />
    </svg>
  );
}

function SpeakerIcon({ muted }: { muted: boolean }) {
  return (
    <svg {...svg} width="17" height="17" aria-hidden="true">
      <path d="M2.5 6h2.25L8 3.25v9.5L4.75 10H2.5z" />
      {muted ? <path d="M11 6.25l3 3.5M14 6.25l-3 3.5" /> : <path d="M10.75 5.75a3 3 0 0 1 0 4.5M12.5 4a5.5 5.5 0 0 1 0 8" />}
    </svg>
  );
}

function NotesIcon() {
  return (
    <svg {...svg} width="17" height="17" aria-hidden="true">
      <path d="M4 2h6.5L13 4.5V14H4z" />
      <path d="M6.25 7h4.5M6.25 9.5h4.5M6.25 12h2.5" />
    </svg>
  );
}

function FreshIcon() {
  return (
    <svg {...svg} width="17" height="17" aria-hidden="true">
      <path d="M3.25 8A4.75 4.75 0 1 0 5 4.3" />
      <path d="M3 1.75V5h3.25" />
    </svg>
  );
}

function SlidersIcon() {
  return (
    <svg {...svg} width="17" height="17" aria-hidden="true">
      <path d="M2.5 5h11M2.5 11h11" />
      <circle cx="6" cy="5" r="1.6" fill="currentColor" stroke="none" />
      <circle cx="10.5" cy="11" r="1.6" fill="currentColor" stroke="none" />
    </svg>
  );
}
