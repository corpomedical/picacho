"use client";

import { useRef, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import { formatMsg } from "@/lib/i18n/format";
import type { Messages } from "@/lib/i18n/messages/en";
import { LENSES_MM, nearestLens } from "@/lib/sets/build-scene";
import {
  RIG_ERAS,
  RIG_FORMAT_ORDER,
  RIG_GENRE_SUGGESTS,
  RIG_GENRES,
  RIG_LENSES,
  RIG_LIGHTS,
  RIG_PALETTES,
  RIG_STOCKS,
  RIG_STOPS,
  depthOfField,
  focalMm,
  formatFrame,
  lookStill,
  type RigFormat,
  type RigGenre,
  type RigLens,
  type RigLightScheme,
  type RigLook,
  type RigStock,
  type RigStop,
  type SetRig,
} from "@/lib/sets/rig";
import { moveKeyLight, schemeDefaults, schemeHasSun } from "@/lib/sets/light-schemes";
import { FILM_MOVES, FILM_TEXTURES, type FilmMove, type FilmTexture } from "@/lib/sets/moves";

// The rig (Helios Cinema, 2026-09-15, drawn as canvas page I): the camera
// department, docked left of the stage — Blender's tool panel to the
// conversation's side panel, the stage between. One column of sections,
// each labelled with where its choice lands: HELD BY THE STAGE (the frame,
// the lens's field of view, a move's two ends) or CHECKED AFTER (the looks
// the words carry, read back from every still by the rig check). Every
// choice shows on the stage before a credit moves: the frame lines, the
// field of view, the depth of field, the light, the grade.

type Strings = Messages["sets"];

/** The move section, in Film: the selected beat's move and textures. */
export type RigFilmContext = {
  /** The selected beat's number (from 1), or null when none is selected. */
  beat: number | null;
  move: FilmMove | null;
  textures: FilmTexture[];
  onMove: (move: FilmMove) => void;
  onTexture: (texture: FilmTexture) => void;
};

const PANEL_BG = "border border-white/[0.11] bg-[rgba(25,26,32,0.96)] shadow-[0_24px_56px_-16px_rgba(0,0,0,0.6)]";

type TagStrings = { held: string; checked: string };

function Section({
  title,
  tag,
  tags,
  children,
  right,
}: {
  title: string;
  tag?: "held" | "checked";
  tags: TagStrings;
  children: ReactNode;
  right?: ReactNode;
}) {
  return (
    <section className="border-b border-white/[0.07] px-3.5 pb-3.5 pt-3">
      <div className="mb-2.5 flex h-[18px] items-center justify-between gap-2">
        <h3 className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[#9aa0ad]">{title}</h3>
        {right}
        {tag && <Tag kind={tag} tags={tags} />}
      </div>
      {children}
    </section>
  );
}

function Tag({ kind, tags }: { kind: "held" | "checked"; tags: TagStrings }) {
  return kind === "held" ? (
    <span className="inline-flex h-[18px] items-center gap-1 whitespace-nowrap rounded-full bg-[rgba(224,164,104,0.08)] pl-1.5 pr-2 text-[10px] font-medium text-[#e3c9a6] shadow-[inset_0_0_0_1px_rgba(224,164,104,0.25)]">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinejoin="round" className="h-2.5 w-2.5" aria-hidden>
        <path d="M21 8v8l-9 5-9-5V8l9-5z" />
        <path d="M3 8l9 5 9-5M12 13v8" />
      </svg>
      {tags.held}
    </span>
  ) : (
    <span className="inline-flex h-[18px] items-center gap-1 whitespace-nowrap rounded-full bg-white/[0.05] pl-1.5 pr-2 text-[10px] font-medium text-[#9aa0ad] shadow-[inset_0_0_0_1px_rgba(255,255,255,0.08)]">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" className="h-2.5 w-2.5" aria-hidden>
        <circle cx="12" cy="12" r="9" />
        <path d="m8 12.5 2.8 2.7L16 9.5" />
      </svg>
      {tags.checked}
    </span>
  );
}

/** A tile: its little picture, its name; pressed when chosen. `untested` names an unproven look (rig.ts, THE PROOF). */
function Tile({
  on,
  onPick,
  label,
  children,
  dot,
  untested,
}: {
  on: boolean;
  onPick: () => void;
  label: string;
  children: ReactNode;
  dot?: boolean;
  untested?: string;
}) {
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={onPick}
      className={`relative cursor-pointer rounded-[8px] px-1 pb-1.5 pt-1 text-center text-[10.5px] leading-[13px] transition-colors ${
        on
          ? "bg-[rgba(224,164,104,0.1)] text-[#f0cda6] shadow-[inset_0_0_0_1.5px_#e0a468]"
          : "bg-white/[0.03] text-[#9aa0ad] shadow-[inset_0_0_0_1px_rgba(255,255,255,0.07)] hover:bg-white/[0.06] hover:text-[#ecedf1]"
      }`}
    >
      {dot && <span aria-hidden className="absolute right-1.5 top-1.5 z-[1] h-[5px] w-[5px] rounded-full bg-[#e0a468]" />}
      {untested && (
        <span className="absolute left-1.5 top-1.5 z-[1] rounded-[3px] bg-black/65 px-1 text-[8.5px] font-semibold uppercase leading-[13px] tracking-[0.06em] text-[#e0a468]">
          {untested}
        </span>
      )}
      <span className="mb-1 block overflow-hidden rounded-[5px]">{children}</span>
      <span className="block truncate">{label}</span>
    </button>
  );
}

/** A proven look's picture: its own proof still (rig.ts lookStill), the real frame it made on Eva at the race track. */
function Still({ src }: { src: string }) {
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={src} alt="" loading="lazy" className="block aspect-[12/5] w-full object-cover" />;
}

/** The pictures' shared paint, drawn once per panel (ids are the document's). */
function RigDefs() {
  return (
    <svg width="0" height="0" className="absolute" aria-hidden>
      <defs>
        <linearGradient id="rigpsky" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#2a2d3c" />
          <stop offset="0.6" stopColor="#7a5a55" />
          <stop offset="1" stopColor="#d6975d" />
        </linearGradient>
        <radialGradient id="rigpsun">
          <stop offset="0" stopColor="#ffe7bf" stopOpacity="1" />
          <stop offset="0.35" stopColor="#f0a860" stopOpacity="0.55" />
          <stop offset="1" stopColor="#f0a860" stopOpacity="0" />
        </radialGradient>
        <filter id="rigpgrain" x="0" y="0" width="100%" height="100%">
          <feTurbulence type="fractalNoise" baseFrequency="1.3" numOctaves="2" stitchTiles="stitch" />
          <feColorMatrix type="saturate" values="0" />
        </filter>
        <filter id="rigpsoft" x="-20%" y="-200%" width="140%" height="500%">
          <feGaussianBlur stdDeviation="0.7" />
        </filter>
        <filter id="rigpsoft2" x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="2.4" />
        </filter>
        <marker id="rigah" viewBox="0 0 6 6" refX="5" refY="3" markerWidth="5" markerHeight="5" orient="auto">
          <path d="M0 0L6 3L0 6z" fill="#9aa0ad" />
        </marker>
        <marker id="rigaho" viewBox="0 0 6 6" refX="5" refY="3" markerWidth="5" markerHeight="5" orient="auto">
          <path d="M0 0L6 3L0 6z" fill="#e0a468" />
        </marker>
        <pattern id="rigplotgrid" width="18" height="18" patternUnits="userSpaceOnUse">
          <path d="M18 0H0V18" fill="none" stroke="rgba(255,255,255,0.045)" />
        </pattern>
      </defs>
    </svg>
  );
}

/** The little scene every look is drawn on: the same place, so the looks compare. */
function Proof({ children }: { children?: ReactNode }) {
  return (
    <svg viewBox="0 0 68 36" className="block h-9 w-full" aria-hidden>
      <rect width="68" height="19" fill="url(#rigpsky)" />
      <rect y="19" width="68" height="17" fill="#2a2d31" />
      <path d="M24 36 L30 19 L46 19 L60 36 Z" fill="#3b393c" />
      <circle cx="40" cy="16" r="8" fill="url(#rigpsun)" />
      <circle cx="40" cy="16" r="1.7" fill="#fff3dc" />
      <rect x="45" y="11" width="23" height="8" fill="#37333f" />
      <g fill="#f2b56c">
        <rect x="47" y="13.5" width="2" height="1.6" />
        <rect x="53" y="13.5" width="2" height="1.6" />
        <rect x="59" y="13.5" width="2" height="1.6" />
        <rect x="65" y="13.5" width="2" height="1.6" />
      </g>
      <rect x="47" y="17.5" width="12" height="3.6" rx="1.2" fill="#6a2522" />
      <g fill="#191b1f">
        <circle cx="33" cy="12.4" r="3" />
        <path d="M28.4 36 C 28.4 25, 30 18, 33 17.6 C 36 18, 37.6 25, 37.6 36 Z" />
      </g>
      <path d="M35.6 10.2 A3 3 0 0 1 35.7 14.8" stroke="#f3bd7c" strokeWidth="0.9" fill="none" />
      {children}
    </svg>
  );
}

/** Whether any look is still unproven (rig.ts, THE PROOF): the footer explains the Untested tag only while one carries it. */
const LOOK_LISTS: readonly (readonly RigLook[])[] = [RIG_STOCKS, RIG_LENSES, RIG_ERAS, RIG_PALETTES, RIG_LIGHTS];
const ANY_UNTESTED = LOOK_LISTS.some((list) => list.some((l) => !l.proven));

const STOCK_ART: Record<RigStock, ReactNode> = {
  digital: <rect width="68" height="36" fill="#6a9bd6" opacity="0.1" />,
  film35: (
    <>
      <rect width="68" height="36" fill="#e0a468" opacity="0.08" />
      <rect width="68" height="36" filter="url(#rigpgrain)" opacity="0.2" />
    </>
  ),
  film16: (
    <>
      <rect width="68" height="36" fill="#ffffff" opacity="0.09" />
      <rect width="68" height="36" filter="url(#rigpgrain)" opacity="0.42" />
    </>
  ),
  homevideo: (
    <>
      <rect width="68" height="36" fill="#ff6a6a" opacity="0.07" />
      <rect width="10" height="36" fill="#000" />
      <rect x="58" width="10" height="36" fill="#000" />
    </>
  ),
};

const LENS_ART: Record<RigLens, ReactNode> = {
  clean: (
    <g fill="#ffd9a0" opacity="0.8">
      <circle cx="49" cy="12.5" r="1.3" />
      <circle cx="55" cy="13.4" r="1.1" />
      <circle cx="61" cy="12.2" r="1.3" />
    </g>
  ),
  anamorphic: (
    <>
      <g fill="#ffd9a0" opacity="0.8">
        <ellipse cx="49" cy="12.5" rx="0.9" ry="2" />
        <ellipse cx="55" cy="13.4" rx="0.9" ry="2" />
        <ellipse cx="61" cy="12.2" rx="0.9" ry="2" />
      </g>
      <rect x="0" y="15.4" width="68" height="1.2" fill="#8fbfff" opacity="0.85" filter="url(#rigpsoft)" />
    </>
  ),
  vintage: (
    <>
      <rect width="68" height="36" fill="#ffffff" opacity="0.1" />
      <circle cx="40" cy="16" r="13" fill="#ffd9a0" opacity="0.3" filter="url(#rigpsoft2)" />
    </>
  ),
  halation: <circle cx="40" cy="16" r="4.5" fill="none" stroke="#ff5a3c" strokeWidth="2.2" opacity="0.7" filter="url(#rigpsoft)" />,
};

/** A light plot glyph: the figure, the camera below, where the scheme puts its light. */
function PlotGlyph({ scheme }: { scheme: RigLightScheme | null }) {
  const cam = <polygon points="40,43 48,43 46.5,37 41.5,37" fill="#6b6f7a" />;
  const fig = (fill = "#c6c9d1") => <circle cx="44" cy="22" r="4.5" fill={fill} />;
  let art: ReactNode;
  switch (scheme) {
    case "contre-jour":
      art = (
        <>
          <circle cx="44" cy="5" r="3.5" fill="#e0a468" />
          <path d="M44 10 L44 16" stroke="#e0a468" strokeWidth="1.2" strokeDasharray="2 2" />
          {fig("#6b6f7a")}
          <path d="M40 20 A4.5 4.5 0 0 1 48 20" stroke="#ffd9a2" strokeWidth="1.6" fill="none" />
        </>
      );
      break;
    case "golden-hour":
      art = (
        <>
          <circle cx="76" cy="9" r="3.5" fill="#e8a15a" />
          <path d="M72 11 L50 20" stroke="#e8a15a" strokeWidth="1.2" strokeDasharray="2 2" />
          <path d="M44 22 L22 36" stroke="rgba(0,0,0,0.7)" strokeWidth="3.5" strokeLinecap="round" />
          {fig()}
        </>
      );
      break;
    case "window":
      art = (
        <>
          <rect x="5" y="9" width="5" height="26" rx="1" fill="#cfd8e3" opacity="0.85" />
          <g stroke="rgba(207,216,227,0.35)" strokeWidth="1.2">
            <line x1="10" y1="14" x2="38" y2="21" />
            <line x1="10" y1="22" x2="38" y2="22" />
            <line x1="10" y1="30" x2="38" y2="23" />
          </g>
          {fig()}
        </>
      );
      break;
    case "overhead":
      art = (
        <>
          <circle cx="44" cy="22" r="12" fill="none" stroke="#d9c9a8" strokeWidth="1" strokeDasharray="2 2" />
          {fig("#ecedf1")}
          <circle cx="44" cy="22" r="1.6" fill="#fff3dc" />
        </>
      );
      break;
    case "practicals":
      art = (
        <>
          <g fill="#f2b56c">
            <circle cx="18" cy="10" r="6" opacity="0.2" />
            <circle cx="18" cy="10" r="2" />
            <circle cx="70" cy="12" r="6" opacity="0.2" />
            <circle cx="70" cy="12" r="2" />
            <circle cx="66" cy="33" r="6" opacity="0.2" />
            <circle cx="66" cy="33" r="2" />
          </g>
          {fig()}
        </>
      );
      break;
    case "soft-cross":
      art = (
        <>
          <rect x="6" y="5" width="14" height="6" rx="2" fill="#d9d4cc" opacity="0.8" transform="rotate(20 13 8)" />
          <rect x="68" y="5" width="14" height="6" rx="2" fill="#d9d4cc" opacity="0.8" transform="rotate(-20 75 8)" />
          <g stroke="rgba(217,212,204,0.35)" strokeWidth="1.2">
            <line x1="16" y1="11" x2="40" y2="21" />
            <line x1="72" y1="11" x2="48" y2="21" />
          </g>
          {fig()}
        </>
      );
      break;
    case "silhouette":
      art = (
        <>
          <rect x="16" y="3" width="56" height="9" rx="2" fill="#f3e3c8" />
          <circle cx="44" cy="22" r="4.5" fill="#0e0f12" stroke="#f3e3c8" strokeWidth="0.8" />
        </>
      );
      break;
    case "hard-noon":
      art = (
        <>
          <circle cx="52" cy="6" r="3" fill="#ffffff" />
          <ellipse cx="41" cy="26.5" rx="4.5" ry="2" fill="rgba(0,0,0,0.7)" />
          {fig("#ecedf1")}
        </>
      );
      break;
    case "moonlight":
      art = (
        <>
          <path d="M75 3 A5 5 0 1 0 75 13 A4 4 0 1 1 75 3 Z" fill="#aebdd6" />
          <path d="M70 10 L49 20" stroke="#aebdd6" strokeWidth="1.2" strokeDasharray="2 2" />
          {fig("#8d9ab0")}
        </>
      );
      break;
    default:
      art = (
        <>
          <g fill="#9aa0ad" opacity="0.5">
            <circle cx="20" cy="9" r="2" />
            <circle cx="68" cy="9" r="2" />
          </g>
          {fig()}
        </>
      );
  }
  return (
    <svg viewBox="0 0 88 44" className="block h-10 w-full bg-[#141519]" aria-hidden>
      {art}
      {cam}
    </svg>
  );
}

const MOVE_ART: Record<FilmMove, (arrow: string) => ReactNode> = {
  "push-in": (m) => <line x1="20" y1="18" x2="48" y2="18" markerEnd={m} />,
  "pull-out": (m) => <line x1="28" y1="18" x2="8" y2="18" markerEnd={m} />,
  hold: () => (
    <>
      <line x1="36" y1="13" x2="36" y2="23" />
      <line x1="40" y1="13" x2="40" y2="23" />
    </>
  ),
  "arc-left": (m) => <path d="M47 28.4 A26 12 0 0 1 47 7.6" fill="none" markerEnd={m} />,
  "arc-right": (m) => <path d="M47 7.6 A26 12 0 0 0 47 28.4" fill="none" markerEnd={m} />,
  "orbit-90": (m) => <path d="M34 18 A26 12 0 0 1 60 6" fill="none" markerEnd={m} />,
  "crane-up": (m) => <path d="M20 22 Q 18 10 32 6" fill="none" markerEnd={m} />,
  "crane-down": (m) => <path d="M26 6 Q 18 18 26 28" fill="none" markerEnd={m} />,
  "rise-reveal": (m) => <line x1="31" y1="22" x2="12" y2="7" markerEnd={m} />,
  "truck-left": (m) => <line x1="27" y1="12" x2="27" y2="3" markerEnd={m} />,
  "truck-right": (m) => <line x1="27" y1="24" x2="27" y2="33" markerEnd={m} />,
  "tilt-up": (m) => <path d="M30 26 A9 9 0 0 0 29 13" fill="none" markerEnd={m} />,
  "low-hero": (m) => <line x1="24" y1="29" x2="38" y2="27" markerEnd={m} />,
  "dolly-zoom": (m) => (
    <>
      <line x1="42" y1="18" x2="60" y2="9" strokeDasharray="2 2" opacity="0.5" />
      <line x1="42" y1="18" x2="60" y2="27" strokeDasharray="2 2" opacity="0.5" />
      <line x1="10" y1="18" x2="60" y2="9" />
      <line x1="10" y1="18" x2="60" y2="27" />
      <line x1="38" y1="18" x2="18" y2="18" markerEnd={m} />
    </>
  ),
};

/** Side-view moves draw the ground and a standing figure; the rest are seen from above. */
const SIDE_VIEW = new Set<FilmMove>(["crane-up", "crane-down", "rise-reveal", "tilt-up", "low-hero"]);

function MoveGlyph({ move, on }: { move: FilmMove; on: boolean }) {
  const ink = on ? "#e0a468" : "#9aa0ad";
  return (
    <svg viewBox="0 0 88 36" className="block h-9 w-full bg-[#141519]" aria-hidden>
      {SIDE_VIEW.has(move) ? (
        <>
          <line x1="4" y1="32" x2="84" y2="32" stroke="#565a64" />
          <line x1="60" y1="32" x2="60" y2="21" stroke="#c6c9d1" strokeWidth="2" />
          <circle cx="60" cy="17.5" r="3" fill="#c6c9d1" />
        </>
      ) : (
        <circle cx="60" cy="18" r="4" fill={on ? "#ecedf1" : "#c6c9d1"} />
      )}
      <g stroke={ink} strokeWidth="1.4">
        {MOVE_ART[move](on ? "url(#rigaho)" : "url(#rigah)")}
      </g>
    </svg>
  );
}

/** A lens barrel's ring: the chosen value under the index, its neighbours rolling away. */
function Ring<T extends number>({
  values,
  value,
  onPick,
  label,
  format,
}: {
  values: readonly T[];
  value: T | null;
  onPick: (v: T) => void;
  label: string;
  format: (v: T) => string;
}) {
  const at = value === null ? -1 : values.indexOf(value);
  const centre = at < 0 ? (values.length - 1) / 2 : at;
  return (
    <div
      role="radiogroup"
      aria-label={label}
      className="relative h-8 overflow-hidden rounded-[6px] bg-[linear-gradient(180deg,#2c2d34_0%,#1c1d23_100%)] shadow-[inset_0_0_0_1px_rgba(255,255,255,0.08)]"
    >
      <span
        aria-hidden
        className="absolute inset-x-0 top-0 h-1.5 [background-image:repeating-linear-gradient(90deg,rgba(255,255,255,0.2)_0_1px,transparent_1px_11.5px)]"
      />
      <span
        aria-hidden
        className="absolute inset-x-0 bottom-0 h-[7px] [background-image:repeating-linear-gradient(90deg,rgba(0,0,0,0.45)_0_2px,rgba(255,255,255,0.06)_2px_4px)]"
      />
      {values.map((v, i) => (
        <button
          key={v}
          type="button"
          role="radio"
          aria-checked={i === at}
          onClick={() => onPick(v)}
          style={{ left: `calc(50% + ${(i - centre) * 46}px)` }}
          className={`absolute top-[5px] -translate-x-1/2 cursor-pointer px-1.5 text-[11px] font-semibold tabular-nums transition-[left,color] duration-200 ${
            i === at ? "text-[#f0cda6]" : "text-[#6b6f7a] hover:text-[#ecedf1]"
          }`}
        >
          {format(v)}
        </button>
      ))}
      {at >= 0 && (
        <span
          aria-hidden
          className="absolute left-1/2 top-0 -ml-[5px] h-0 w-0 border-x-[5px] border-t-[6px] border-x-transparent border-t-[#e0a468]"
        />
      )}
    </div>
  );
}

/** Distances on a lens's own scale: log, from 0.7 m to 40 m, then infinity. */
function dofX(d: number): number {
  if (!Number.isFinite(d)) return 290;
  const lo = Math.log10(0.7);
  const hi = Math.log10(40);
  const v = Math.min(40, Math.max(0.7, d));
  return 8 + ((Math.log10(v) - lo) / (hi - lo)) * 270;
}

function DofBar({ near, far, at, label }: { near: number; far: number; at: number; label: string }) {
  const n = dofX(near);
  const f = Math.min(290, dofX(far));
  const ticks: [number, string][] = [
    [1, "1 m"],
    [2, "2"],
    [3, "3"],
    [5, "5"],
    [10, "10"],
    [20, "20"],
  ];
  return (
    <svg viewBox="0 0 298 44" className="mt-1.5 block w-full" aria-hidden>
      <line x1="8" y1="24" x2="290" y2="24" stroke="rgba(255,255,255,0.14)" />
      <rect x={n} y="17" width={Math.max(2, f - n)} height="14" rx="2" fill="rgba(224,164,104,0.22)" stroke="#e0a468" />
      {ticks.map(([d, t]) => (
        <g key={d}>
          <line x1={dofX(d)} y1="21" x2={dofX(d)} y2="27" stroke="rgba(255,255,255,0.3)" />
          <text x={dofX(d)} y="41" textAnchor="middle" fontSize="9.5" fill="#6b6f7a">
            {t}
          </text>
        </g>
      ))}
      <line x1="290" y1="21" x2="290" y2="27" stroke="rgba(255,255,255,0.3)" />
      <text x="290" y="41" textAnchor="middle" fontSize="9.5" fill="#6b6f7a">
        ∞
      </text>
      <circle cx={dofX(at)} cy="24" r="3.5" fill="#ecedf1" />
      <text x={dofX(at)} y="11" textAnchor="middle" fontSize="9.5" fontWeight="600" fill="#ecedf1">
        {label}
      </text>
    </svg>
  );
}

/**
 * The light plot: the set from above round the figure, the camera at the
 * foot looking up at it, the key light on its ring — drag it round the
 * figure. Drawn camera-relative (the camera is always at the foot), while
 * the rig keeps the light's WORLD bearing, so orbiting never moves the sun.
 */
function LightPlot({
  azimuthDeg,
  cameraBearingDeg,
  onAzimuth,
  s,
}: {
  azimuthDeg: number;
  cameraBearingDeg: number;
  onAzimuth: (deg: number) => void;
  s: Strings["rig"];
}) {
  const ref = useRef<SVGSVGElement | null>(null);
  const cx = 149;
  const cy = 72;
  const R = 58;
  const rel = ((azimuthDeg - cameraBearingDeg) * Math.PI) / 180;
  const lx = cx + Math.sin(rel) * R;
  const ly = cy + Math.cos(rel) * R;
  const drag = (e: ReactPointerEvent<SVGSVGElement>) => {
    const svg = ref.current;
    if (!svg) return;
    const r = svg.getBoundingClientRect();
    const x = ((e.clientX - r.left) / r.width) * 298 - cx;
    const y = ((e.clientY - r.top) / r.height) * 150 - cy;
    if (Math.hypot(x, y) < 6) return;
    onAzimuth(cameraBearingDeg + (Math.atan2(x, y) * 180) / Math.PI);
  };
  return (
    <svg
      ref={ref}
      viewBox="0 0 298 150"
      className="mt-2.5 block w-full cursor-grab touch-none rounded-[10px] bg-[#141519] active:cursor-grabbing"
      role="slider"
      aria-label={s.lightDrag}
      aria-valuenow={Math.round(((azimuthDeg % 360) + 360) % 360)}
      aria-valuemin={0}
      aria-valuemax={359}
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === "ArrowLeft") onAzimuth(azimuthDeg - 5);
        if (e.key === "ArrowRight") onAzimuth(azimuthDeg + 5);
      }}
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture(e.pointerId);
        drag(e);
      }}
      onPointerMove={(e) => {
        if (e.buttons) drag(e);
      }}
    >
      <rect width="298" height="150" fill="url(#rigplotgrid)" />
      <polygon points={`${cx},${cy + 62} ${cx - 34},${cy - 20} ${cx + 34},${cy - 20}`} fill="rgba(255,255,255,0.05)" stroke="rgba(255,255,255,0.14)" />
      <circle cx={cx} cy={cy} r={R} fill="none" stroke="rgba(224,164,104,0.3)" strokeDasharray="3 4" />
      <line x1={lx} y1={ly} x2={cx} y2={cy} stroke="#e0a468" strokeWidth="1.2" strokeDasharray="3 3" />
      <circle cx={cx} cy={cy} r="6" fill="#ecedf1" />
      <rect x={cx - 5} y={cy + 60} width="10" height="7" rx="1.5" fill="#9aa0ad" />
      <circle cx={lx} cy={ly} r="6.5" fill="#e0a468" />
      <circle cx={lx} cy={ly} r="10" fill="none" stroke="#e0a468" strokeWidth="1.2" />
      <text x={cx + 10} y={cy + 4} fontSize="9.5" fill="#9aa0ad">
        {s.plotFigure}
      </text>
      <text x={cx + 10} y={cy + 67} fontSize="9.5" fill="#9aa0ad">
        {s.plotCamera}
      </text>
    </svg>
  );
}

export function RigPanel({
  rig,
  onChange,
  s,
  locale,
  fovDeg,
  onLens,
  distanceM,
  figureName,
  cameraBearingDeg,
  film,
  onClose,
}: {
  rig: SetRig;
  onChange: (next: SetRig) => void;
  s: Strings;
  locale: string;
  /** The stage lens's field of view over the render frame, now. */
  fovDeg: number;
  onLens: (mm: number) => void;
  /** Camera to the figure's eyes, metres, now. */
  distanceM: number;
  figureName: string;
  /** Bearing from the figure to the camera, degrees, now. */
  cameraBearingDeg: number;
  film: RigFilmContext | null;
  onClose: () => void;
}) {
  const r = s.rig;
  const tags: TagStrings = { held: r.held, checked: r.checked };
  const set = (patch: Partial<SetRig>) => onChange({ ...rig, ...patch });
  const toggle = <K extends keyof SetRig>(key: K, value: SetRig[K]) => set({ [key]: rig[key] === value ? null : value } as Partial<SetRig>);
  const nf = new Intl.NumberFormat(locale, { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  const frame = formatFrame(rig.format);
  const focal = focalMm(fovDeg, frame.renderAspect >= 1 ? 24 : 36);
  const dof = rig.stop !== null && distanceM > 0 ? depthOfField(focal, rig.stop, distanceM) : null;
  const suggestion = rig.genre ? RIG_GENRE_SUGGESTS[rig.genre] : null;
  const suggestionInUse = Boolean(suggestion && rig.light?.scheme === suggestion.light && rig.palette === suggestion.palette);
  const lightLine = rig.light ? null : r.asBuiltLine;

  const pickScheme = (scheme: RigLightScheme | null) => {
    if (!scheme) return set({ light: null });
    // Picking the scheme it already has re-aims it to the camera as it stands.
    set({ light: schemeDefaults(scheme, cameraBearingDeg) });
  };

  return (
    <aside
      aria-label={r.title}
      className={`z-30 flex min-h-0 flex-col overflow-hidden rounded-[16px] ${PANEL_BG} max-md:fixed max-md:inset-x-2 max-md:bottom-2 max-md:top-16 max-md:z-40 md:absolute md:bottom-3.5 md:left-3.5 md:top-3.5 md:w-[328px]`}
    >
      <div className="flex items-center justify-between border-b border-white/[0.07] px-4 py-3">
        <span className="text-[11px] font-medium uppercase tracking-widest text-[#9aa0ad]">{r.title}</span>
        <span className="flex items-center gap-2">
          <span className="text-[11px] text-[#6b6f7a]">{r.saved}</span>
          <button
            type="button"
            onClick={onClose}
            title={r.hide}
            aria-label={r.hide}
            className="flex h-6 w-6 cursor-pointer items-center justify-center rounded text-[#6b6f7a] hover:text-[#ecedf1]"
          >
            ‹
          </button>
        </span>
      </div>

      <RigDefs />
      <div className="min-h-0 flex-1 overflow-y-auto">
        {film && (
          <Section tags={tags} title={film.beat ? formatMsg(r.move, { n: film.beat }) : r.moveTitle} tag="held">
            {film.beat === null && <p className="mb-2 text-[11.5px] leading-4 text-[#9aa0ad]">{r.movePick}</p>}
            {rig.genre && (
              <p className="mb-2 flex items-center gap-1.5 text-[11.5px] leading-4 text-[#9aa0ad]">
                <span aria-hidden className="h-[5px] w-[5px] rounded-full bg-[#e0a468]" />
                {formatMsg(r.suggested, { genre: r.genres[rig.genre] })}
              </p>
            )}
            <div className="grid grid-cols-3 gap-1.5">
              {FILM_MOVES.map((m) => (
                <Tile key={m} on={film.move === m} onPick={() => film.onMove(m)} label={r.moves[m]} dot={Boolean(suggestion?.moves.includes(m))}>
                  <MoveGlyph move={m} on={film.move === m} />
                </Tile>
              ))}
            </div>
            {film.move && (
              <p className="mt-2 text-[11.5px] leading-4 text-[#9aa0ad]">
                <span className="text-[#ecedf1]">{r.moves[film.move]}</span> — {r.moveLines[film.move]}
              </p>
            )}
            {film.beat !== null && (
              <>
                <div className="mt-3 flex items-center justify-between">
                  <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[#9aa0ad]">{r.onTop}</span>
                  <Tag kind="checked" tags={tags} />
                </div>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {FILM_TEXTURES.map((tx) => {
                    const on = film.textures.includes(tx);
                    return (
                      <button
                        key={tx}
                        type="button"
                        aria-pressed={on}
                        onClick={() => film.onTexture(tx)}
                        className={`flex h-8 cursor-pointer items-center rounded-full px-3 text-xs font-medium transition-colors ${
                          on
                            ? "bg-[rgba(224,164,104,0.15)] text-[#f0cda6] shadow-[inset_0_0_0_1px_rgba(240,196,142,0.5)]"
                            : "bg-white/[0.06] text-[#9aa0ad] hover:bg-white/[0.1] hover:text-[#ecedf1]"
                        }`}
                      >
                        {r.textures[tx]}
                      </button>
                    );
                  })}
                </div>
              </>
            )}
          </Section>
        )}

        <Section tags={tags} title={r.story}>
          <div className="flex gap-1.5">
            <label className="flex h-8 min-w-0 flex-1 items-center gap-1.5 rounded-[8px] bg-[#141519] px-2.5 text-xs text-[#ecedf1] shadow-[inset_0_0_0_1px_rgba(255,255,255,0.08)]">
              <span className="text-[11px] font-medium text-[#6b6f7a]">{r.genre}</span>
              <select
                value={rig.genre ?? ""}
                onChange={(e) => set({ genre: (e.target.value || null) as RigGenre | null })}
                className="min-w-0 flex-1 cursor-pointer appearance-none bg-transparent text-xs text-[#ecedf1] outline-none"
              >
                <option value="">{r.none}</option>
                {RIG_GENRES.map((g) => (
                  <option key={g} value={g}>
                    {r.genres[g]}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex h-8 min-w-0 flex-1 items-center gap-1.5 rounded-[8px] bg-[#141519] px-2.5 text-xs text-[#ecedf1] shadow-[inset_0_0_0_1px_rgba(255,255,255,0.08)]">
              <span className="text-[11px] font-medium text-[#6b6f7a]">{r.era}</span>
              <select
                value={rig.era ?? ""}
                onChange={(e) => set({ era: (e.target.value || null) as SetRig["era"] })}
                className="min-w-0 flex-1 cursor-pointer appearance-none bg-transparent text-xs text-[#ecedf1] outline-none"
              >
                <option value="">{r.today}</option>
                {RIG_ERAS.map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.proven ? r.eras[e.id] : `${r.eras[e.id]} · ${r.untestedTag}`}
                  </option>
                ))}
              </select>
            </label>
          </div>
          {suggestion && rig.genre && (
            <p className="mt-2 text-[11.5px] leading-4 text-[#9aa0ad]">
              {formatMsg(r.suggests, { genre: r.genres[rig.genre], light: r.lights[suggestion.light], palette: r.palettes[suggestion.palette] })}{" "}
              {suggestionInUse ? (
                <span className="font-medium text-[#6b6f7a]">{r.inUse}</span>
              ) : (
                <button
                  type="button"
                  onClick={() => set({ light: schemeDefaults(suggestion.light, cameraBearingDeg), palette: suggestion.palette })}
                  className="cursor-pointer font-medium text-[#e0a468] hover:underline"
                >
                  {r.useThese}
                </button>
              )}
            </p>
          )}
        </Section>

        <Section tags={tags} title={r.frame} tag="held">
          <div className="flex gap-1.5" role="radiogroup" aria-label={r.frame}>
            {RIG_FORMAT_ORDER.map((f: RigFormat) => {
              const ff = formatFrame(f);
              const on = rig.format === f;
              const h = ff.bandAspect >= 1 ? 15 : 22;
              return (
                <button
                  key={f}
                  type="button"
                  role="radio"
                  aria-checked={on}
                  onClick={() => set({ format: f })}
                  className={`flex h-[50px] min-w-0 flex-1 cursor-pointer flex-col items-center justify-center gap-1.5 rounded-[8px] text-[10px] leading-3 transition-colors ${
                    on
                      ? "bg-[rgba(224,164,104,0.1)] text-[#f0cda6] shadow-[inset_0_0_0_1.5px_#e0a468]"
                      : "bg-white/[0.03] text-[#9aa0ad] shadow-[inset_0_0_0_1px_rgba(255,255,255,0.07)] hover:text-[#ecedf1]"
                  }`}
                >
                  <span
                    aria-hidden
                    className={`block rounded-[2px] border-[1.5px] ${on ? "border-[#e0a468]" : "border-[#6b6f7a]"}`}
                    style={{ height: h, width: Math.round(h * ff.bandAspect) }}
                  />
                  <span className="whitespace-nowrap">{r.formats[f]}</span>
                </button>
              );
            })}
          </div>
          {frame.cut && <p className="mt-2 text-[11.5px] leading-4 text-[#9aa0ad]">{r.formatNote}</p>}
          <div className="mb-1.5 mt-3 flex items-baseline justify-between text-[11px] text-[#9aa0ad]">
            <span>{r.focal}</span>
            <span className="text-xs font-medium tabular-nums text-[#ecedf1]">{formatMsg(s.lensMm, { mm: nearestLens(fovDeg) })}</span>
          </div>
          <Ring values={LENSES_MM} value={nearestLens(fovDeg)} onPick={onLens} label={r.focal} format={(v) => String(v)} />
        </Section>

        <Section tags={tags} title={r.stock} tag="checked">
          <div className="grid grid-cols-4 gap-1.5">
            {RIG_STOCKS.map((st) => {
              const still = lookStill("stock", st.id);
              return (
                <Tile
                  key={st.id}
                  on={rig.stock === st.id}
                  onPick={() => toggle("stock", st.id)}
                  label={r.stocks[st.id]}
                  untested={st.proven ? undefined : r.untestedTag}
                >
                  {still ? <Still src={still} /> : <Proof>{STOCK_ART[st.id]}</Proof>}
                </Tile>
              );
            })}
          </div>
          <p className="mt-2 text-[11.5px] leading-4 text-[#9aa0ad]">
            {rig.stock ? (
              <>
                <span className="text-[#ecedf1]">{r.stocks[rig.stock]}</span> — {r.stockLines[rig.stock]}
              </>
            ) : (
              r.offLine
            )}
          </p>
        </Section>

        <Section tags={tags} title={r.lens} tag="checked">
          <div className="grid grid-cols-4 gap-1.5">
            {RIG_LENSES.map((l) => {
              const still = lookStill("lens", l.id);
              return (
                <Tile
                  key={l.id}
                  on={rig.lens === l.id}
                  onPick={() => toggle("lens", l.id)}
                  label={r.lenses[l.id]}
                  untested={l.proven ? undefined : r.untestedTag}
                >
                  {still ? <Still src={still} /> : <Proof>{LENS_ART[l.id]}</Proof>}
                </Tile>
              );
            })}
          </div>
          <p className="mt-2 text-[11.5px] leading-4 text-[#9aa0ad]">
            {rig.lens ? (
              <>
                <span className="text-[#ecedf1]">{r.lenses[rig.lens]}</span> — {r.lensLines[rig.lens]}
              </>
            ) : (
              r.offLine
            )}
          </p>
        </Section>

        <Section
          tags={tags}
          title={r.focus}
          tag="checked"
          right={
            rig.stop !== null ? (
              <button type="button" onClick={() => set({ stop: null })} className="ml-auto mr-2 cursor-pointer text-[11px] font-medium text-[#6b6f7a] hover:text-[#ecedf1]">
                {r.off}
              </button>
            ) : null
          }
        >
          <div className="mb-1.5 flex items-baseline justify-between text-[11px] text-[#9aa0ad]">
            <span>{r.stop}</span>
            <span className="text-xs font-medium tabular-nums text-[#ecedf1]">{rig.stop !== null ? `f/${rig.stop}` : r.off}</span>
          </div>
          <Ring<RigStop> values={RIG_STOPS} value={rig.stop} onPick={(v) => set({ stop: v })} label={r.stop} format={(v) => String(v)} />
          {dof ? (
            <>
              <DofBar near={dof.nearM} far={dof.farM} at={distanceM} label={nf.format(distanceM)} />
              <p className="mt-1 text-[11.5px] leading-4 text-[#9aa0ad]">
                {Number.isFinite(dof.farM)
                  ? formatMsg(r.focusLine, { name: figureName, d: nf.format(distanceM), near: nf.format(dof.nearM), far: nf.format(dof.farM) })
                  : formatMsg(r.focusDeep, { name: figureName, d: nf.format(distanceM), near: nf.format(dof.nearM) })}
              </p>
            </>
          ) : (
            <p className="mt-2 text-[11.5px] leading-4 text-[#9aa0ad]">{r.focusOff}</p>
          )}
        </Section>

        <Section
          tags={tags}
          title={r.light}
          tag="checked"
          right={
            rig.light !== null ? (
              <button type="button" onClick={() => pickScheme(null)} className="ml-auto mr-2 cursor-pointer text-[11px] font-medium text-[#6b6f7a] hover:text-[#ecedf1]">
                {r.asBuilt}
              </button>
            ) : null
          }
        >
          <div className="grid grid-cols-3 gap-1.5">
            {RIG_LIGHTS.map((l) => {
              const still = lookStill("light", l.id);
              return (
                <Tile
                  key={l.id}
                  on={rig.light?.scheme === l.id}
                  onPick={() => pickScheme(l.id)}
                  label={r.lights[l.id]}
                  dot={suggestion?.light === l.id}
                  untested={l.proven ? undefined : r.untestedTag}
                >
                  {still ? <Still src={still} /> : <PlotGlyph scheme={l.id} />}
                </Tile>
              );
            })}
          </div>
          {rig.light ? (
            <>
              <LightPlot
                azimuthDeg={rig.light.azimuthDeg}
                cameraBearingDeg={cameraBearingDeg}
                onAzimuth={(deg) => rig.light && set({ light: moveKeyLight(rig.light, deg, rig.light.elevationDeg) })}
                s={r}
              />
              <div className="mt-2 flex flex-wrap items-center gap-2">
                {schemeHasSun(rig.light.scheme) && (
                  <label className="flex min-w-0 flex-1 items-center gap-2 text-[11px] text-[#9aa0ad]">
                    <span className="whitespace-nowrap tabular-nums">{formatMsg(r.lightHeight, { deg: Math.round(rig.light.elevationDeg) })}</span>
                    <input
                      type="range"
                      min={1}
                      max={85}
                      value={Math.round(rig.light.elevationDeg)}
                      onChange={(e) => rig.light && set({ light: moveKeyLight(rig.light, rig.light.azimuthDeg, Number(e.target.value)) })}
                      className="min-w-0 flex-1 accent-[#e0a468]"
                      aria-label={formatMsg(r.lightHeight, { deg: Math.round(rig.light.elevationDeg) })}
                    />
                  </label>
                )}
                <button
                  type="button"
                  onClick={() => rig.light && pickScheme(rig.light.scheme)}
                  className="cursor-pointer whitespace-nowrap text-[11px] font-medium text-[#e0a468] hover:underline"
                >
                  {r.lightReaim}
                </button>
              </div>
            </>
          ) : (
            <p className="mt-2 text-[11.5px] leading-4 text-[#9aa0ad]">{lightLine}</p>
          )}
        </Section>

        <Section
          tags={tags}
          title={r.palette}
          tag="checked"
          right={
            <label className="ml-auto mr-2 flex cursor-pointer items-center gap-1.5 text-[11px] text-[#9aa0ad]">
              {r.gradeStage}
              <input
                type="checkbox"
                checked={rig.gradeStage}
                onChange={(e) => set({ gradeStage: e.target.checked })}
                className="h-3.5 w-3.5 cursor-pointer accent-[#e0a468]"
              />
            </label>
          }
        >
          <div className="grid grid-cols-3 gap-1.5">
            {RIG_PALETTES.map((p) => {
              const still = lookStill("palette", p.id);
              return (
                <Tile
                  key={p.id}
                  on={rig.palette === p.id}
                  onPick={() => toggle("palette", p.id)}
                  label={r.palettes[p.id]}
                  dot={suggestion?.palette === p.id}
                  untested={p.proven ? undefined : r.untestedTag}
                >
                  {still && <Still src={still} />}
                  {/* The palette's own colours stay under its still: most grades are subtle on a sunlit frame, the swatch says which is which. */}
                  <span className={`flex ${still ? "h-[5px]" : "h-[26px]"}`}>
                    {p.swatch.map((c) => (
                      <i key={c} className="flex-1" style={{ background: c }} />
                    ))}
                  </span>
                </Tile>
              );
            })}
          </div>
          <p className="mt-2 text-[11.5px] leading-4 text-[#9aa0ad]">
            {rig.palette ? (
              <>
                <span className="text-[#ecedf1]">{r.palettes[rig.palette]}</span> — {r.paletteLines[rig.palette]}
              </>
            ) : (
              r.offLine
            )}
          </p>
        </Section>

        {ANY_UNTESTED && <p className="px-3.5 py-3 text-[11px] leading-[15px] text-[#6b6f7a]">{r.untested}</p>}
      </div>
    </aside>
  );
}
