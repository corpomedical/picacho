"use client";

import Link from "next/link";
import type { CSSProperties, ReactNode } from "react";
import type { VoicePhase } from "./use-hands-free";
import styles from "./producer-lamp.module.css";

// The wheel (2026-09-25, operator: "a wheel that appears from behind the light
// bulb. The wheel has icons that enable speech and other options" and "a
// lighted wheel that fills depending on the usage. When the wheel is fully
// lit, then the user know that the limit has reached").
//
// A dial centred on the bulb, opening into the corner the bulb sits in: its
// controls ride the quarter that faces the page (left through up), and the
// same quarter's rim is the allowance meter, lit from the left end towards
// the top as the month's assistant units are used. Fully lit means the
// allowance is spent. The dial grows out from behind the bulb when the sheet
// opens and folds back into it when the sheet closes.

export const WHEEL_R = 128; // the disc
const ICON_R = 98; // where the controls sit
const RIM_R = 123; // the meter
const START = 180; // degrees: left of the bulb…
const SWEEP = 90; // …round to straight above it

function polar(r: number, deg: number) {
  const a = (deg * Math.PI) / 180;
  return { x: r * Math.cos(a), y: r * Math.sin(a) };
}

function arc(r: number, fromDeg: number, toDeg: number): string {
  const a = polar(r, fromDeg);
  const b = polar(r, toDeg);
  const large = toDeg - fromDeg > 180 ? 1 : 0;
  return `M ${a.x + WHEEL_R} ${a.y + WHEEL_R} A ${r} ${r} 0 ${large} 1 ${b.x + WHEEL_R} ${b.y + WHEEL_R}`;
}

export type WheelProps = {
  cx: number;
  cy: number;
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

export function Wheel(p: WheelProps) {
  const pct = p.cap > 0 ? Math.min(1, Math.max(0, p.used / p.cap)) : 1;
  const full = pct >= 1;
  const talking = p.phase !== "off";
  const usageLabel = full
    ? "Allowance used up for this period"
    : `${p.used.toLocaleString()} of ${p.cap.toLocaleString()} assistant units used this period`;

  const controls: {
    key: string;
    label: string;
    on?: boolean;
    disabled?: boolean;
    onClick?: () => void;
    href?: string;
    icon: ReactNode;
    badge?: number;
  }[] = [
    {
      key: "talk",
      label: !p.voiceAvailable ? "Voice isn't available here" : talking ? "Stop talking" : "Talk hands-free",
      on: talking,
      disabled: !p.voiceAvailable,
      onClick: p.onTalk,
      icon: <MicIcon />,
    },
    {
      key: "aloud",
      label: p.readAloud ? "Stop reading answers aloud" : "Read answers aloud",
      on: p.readAloud,
      disabled: !p.voiceAvailable,
      onClick: p.onReadAloud,
      icon: <SpeakerIcon muted={!p.readAloud} />,
    },
    { key: "notes", label: "Notes", on: p.notesOpen, onClick: p.onNotes, icon: <NotesIcon />, badge: p.notesCount },
    { key: "fresh", label: "Start fresh", disabled: !p.canFresh, onClick: p.onFresh, icon: <FreshIcon /> },
    { key: "name", label: "Name and settings", href: "/app/settings?tab=preferences", icon: <SlidersIcon /> },
  ];

  const labelAt = polar(RIM_R + 14, START + 4);

  return (
    <div
      className={styles.wheel}
      style={{ left: p.cx - WHEEL_R, top: p.cy - WHEEL_R, width: WHEEL_R * 2, height: WHEEL_R * 2 }}
    >
      <div className={styles.disc} aria-hidden="true" />
      <svg className={styles.rim} width={WHEEL_R * 2} height={WHEEL_R * 2} role="img" aria-label={usageLabel}>
        <title>{usageLabel}</title>
        <path d={arc(RIM_R, START, START + SWEEP)} className={styles.rimTrack} />
        {pct > 0 && (
          <path
            d={arc(RIM_R, START, START + Math.max(0.5, SWEEP * pct))}
            className={full ? `${styles.rimFill} ${styles.rimFull}` : styles.rimFill}
          />
        )}
      </svg>
      <span
        className={styles.usageLabel}
        style={{ left: labelAt.x + WHEEL_R, top: labelAt.y + WHEEL_R } as CSSProperties}
        aria-hidden="true"
      >
        {full ? "Limit reached" : `${Math.round(pct * 100)}%`}
      </span>
      {controls.map((c, i) => {
        const at = polar(ICON_R, START + (SWEEP / (controls.length - 1)) * i);
        const style = {
          left: at.x + WHEEL_R,
          top: at.y + WHEEL_R,
          "--dx": `${-at.x}px`,
          "--dy": `${-at.y}px`,
          "--delay": `${40 + i * 35}ms`,
          ...(c.key === "talk" && talking ? { "--level": String(p.level) } : {}),
        } as CSSProperties;
        const cls = [styles.control, c.on ? styles.controlOn : "", c.key === "talk" && talking ? styles.controlLive : ""]
          .filter(Boolean)
          .join(" ");
        const inner = (
          <>
            {c.icon}
            {c.badge ? <span className={styles.controlBadge}>{c.badge}</span> : null}
          </>
        );
        return c.href ? (
          <Link key={c.key} href={c.href} className={cls} style={style} aria-label={c.label} title={c.label}>
            {inner}
          </Link>
        ) : (
          <button
            key={c.key}
            type="button"
            data-producer-spot={c.key === "notes" ? "notes" : undefined}
            className={cls}
            style={style}
            aria-label={c.label}
            aria-pressed={c.on}
            title={c.label}
            disabled={c.disabled}
            onClick={c.onClick}
          >
            {inner}
          </button>
        );
      })}
    </div>
  );
}

const svg = { viewBox: "0 0 16 16", fill: "none", stroke: "currentColor", strokeWidth: 1.5, strokeLinecap: "round", strokeLinejoin: "round" } as const;

function MicIcon() {
  return (
    <svg {...svg} width="16" height="16" aria-hidden="true">
      <rect x="6" y="1.75" width="4" height="8" rx="2" />
      <path d="M3.5 7.5a4.5 4.5 0 0 0 9 0M8 12v2.25" />
    </svg>
  );
}

function SpeakerIcon({ muted }: { muted: boolean }) {
  return (
    <svg {...svg} width="16" height="16" aria-hidden="true">
      <path d="M2.5 6h2.25L8 3.25v9.5L4.75 10H2.5z" />
      {muted ? <path d="M11 6.25l3 3.5M14 6.25l-3 3.5" /> : <path d="M10.75 5.75a3 3 0 0 1 0 4.5M12.5 4a5.5 5.5 0 0 1 0 8" />}
    </svg>
  );
}

function NotesIcon() {
  return (
    <svg {...svg} width="16" height="16" aria-hidden="true">
      <path d="M4 2h6.5L13 4.5V14H4z" />
      <path d="M6.25 7h4.5M6.25 9.5h4.5M6.25 12h2.5" />
    </svg>
  );
}

function FreshIcon() {
  return (
    <svg {...svg} width="16" height="16" aria-hidden="true">
      <path d="M3.25 8A4.75 4.75 0 1 0 5 4.3" />
      <path d="M3 1.75V5h3.25" />
    </svg>
  );
}

function SlidersIcon() {
  return (
    <svg {...svg} width="16" height="16" aria-hidden="true">
      <path d="M2.5 5h11M2.5 11h11" />
      <circle cx="6" cy="5" r="1.6" fill="currentColor" stroke="none" />
      <circle cx="10.5" cy="11" r="1.6" fill="currentColor" stroke="none" />
    </svg>
  );
}
