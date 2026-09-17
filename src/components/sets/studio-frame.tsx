"use client";

// The studio's frame (canvas page J, board J1; cut A, 2026-09-17): the
// same frame around every mode of a set's page — a bar across the top, the
// nine-tool rail on the left, the dock on the right, a status bar along
// the foot — so Build, Shoot and Film read as one page with modes, the way
// every pro tool's page does. The two pages (set-view.tsx, set-editor.tsx)
// fill the slots; the tables come from lib/sets/studio.ts.

import Link from "next/link";
import { useSyncExternalStore, type ReactNode } from "react";
import { VIEW_MODES, type ViewMode } from "@/lib/sets/view-modes";
import { RAIL_TOOLS, railToolsFor, type DockTab, type RailTool, type RailToolNote, type StudioMode } from "@/lib/sets/studio";

export const STUDIO_BAR_BG = "bg-[#191a20]";
export const STUDIO_PANEL_BG = "bg-[#1f2026]";
export const STUDIO_HAIR = "border-white/[0.07]";

const SEG = "flex h-7 flex-none items-center gap-0.5 rounded-[6px] bg-white/[0.05] p-0.5 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.07)]";
const SEG_ON = "flex h-6 cursor-default items-center rounded-[4px] bg-[#2a2b33] px-2.5 text-[12px] font-medium text-[#e0a468] shadow-[0_1px_2px_rgba(0,0,0,0.3)] 2xl:px-3.5";
const SEG_OFF = "flex h-6 cursor-pointer items-center rounded-[4px] px-2.5 text-[12px] font-medium text-[#9aa0ad] hover:text-[#ecedf1] 2xl:px-3.5";
const VIEW_ON = "flex h-6 cursor-default items-center rounded-[4px] bg-[#2a2b33] px-2.5 text-[11.5px] font-medium text-[#e0a468] shadow-[0_1px_2px_rgba(0,0,0,0.3)]";
const VIEW_OFF = "flex h-6 cursor-pointer items-center rounded-[4px] px-2.5 text-[11.5px] font-medium text-[#9aa0ad] hover:text-[#ecedf1]";
const TOOL_BTN = "flex h-8 w-8 cursor-pointer items-center justify-center rounded-[6px] text-[#9aa0ad] hover:text-[#ecedf1]";
const TOOL_ON = "flex h-8 w-8 cursor-pointer items-center justify-center rounded-[6px] bg-[rgba(224,164,104,0.13)] text-[#e0a468]";
const TOOL_OFF = "flex h-8 w-8 cursor-default items-center justify-center rounded-[6px] text-[#9aa0ad] opacity-35";

/** The rail's icons, one a tool, drawn as the editor draws its own. */
export const RAIL_ICONS: Record<RailTool, string> = {
  select: "M5 3l14 8-6.5 1.5L9 19z",
  move: "M12 2v20M2 12h20|m9 5 3-3 3 3M9 19l3 3 3-3M5 9 2 12l3 3M19 9l3 3-3 3",
  turn: "M21 12a9 9 0 1 1-3-6.7|M21 3v5h-5",
  size: "M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7",
  camera: "m22 8-6 3 6 3z|M2 6h14v12H2z",
  light: "M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M4.9 19.1 7 17M17 7l2.1-2.1|M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8z",
  mark: "M12 4.5a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7z|M6 20a6 6 0 0 1 12 0",
  measure: "M3 17l14-14 4 4L7 21H3z|M14 6l4 4|M11 9l2 2|M8 12l2 2",
  kit: "M12 3l9 5-9 5-9-5z|M3 13l9 5 9-5|M3 18l9 5 9-5",
};

export function StudioSvg({ d, className, box = "0 0 24 24" }: { d: string; className?: string; box?: string }) {
  return (
    <svg viewBox={box} fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" className={className ?? "h-[17px] w-[17px]"} aria-hidden>
      {d.split("|").map((p) => (
        <path key={p} d={p} />
      ))}
    </svg>
  );
}

/**
 * Whether the page has the width for the frame (768 px and up). Below it a
 * phone keeps its own layout: the bar, the stage, the conversation under
 * it. Read once for the server (wide), then from the window.
 */
const WIDE = "(min-width: 768px)";
const subscribeWide = (cb: () => void) => {
  const m = window.matchMedia(WIDE);
  m.addEventListener("change", cb);
  return () => m.removeEventListener("change", cb);
};
export function useWide(): boolean {
  return useSyncExternalStore(
    subscribeWide,
    () => window.matchMedia(WIDE).matches,
    () => true,
  );
}

export type StudioModeLink = { label: string; href?: string; onClick?: () => void };

/**
 * The bar across the top, as drawn: where you are, the set's name, the
 * modes, the view modes, Find anything, then whatever the page adds
 * (history, a rendering count, the primary action). Below a tablet's width
 * it keeps the arrow, the switch and the primary action; the words that
 * name the others are kept for screen readers and wider screens.
 */
export function StudioBar({
  back,
  title,
  meta,
  mode,
  modes,
  view,
  find,
  rendering,
  children,
  primary,
}: {
  back: { href: string; label: string };
  title: string;
  meta?: string | null;
  mode: StudioMode;
  /** Build, Shoot, Film: a link (a page of its own) or a switch on this page. */
  modes: Record<StudioMode, StudioModeLink>;
  /** The viewport's modes, when the page draws them. */
  view?: { mode: ViewMode; onChange: (mode: ViewMode) => void; names: Record<ViewMode, string> } | null;
  /** Find anything: opens the commands. */
  find?: { label: string; kbd: string; onOpen: () => void } | null;
  /** What is rendering right now, said next to the primary action. */
  rendering?: { label: string } | null;
  /** The page's own controls, right of Find. */
  children?: ReactNode;
  /** The primary action: Shoot, or Done in Build. */
  primary?: ReactNode;
}) {
  const modeButton = (id: StudioMode) => {
    const m = modes[id];
    const on = id === mode;
    // Build from 640 px, where the editor fits (set-editor.tsx says so below it).
    const width = id === "build" ? "hidden sm:flex" : "flex";
    if (on) {
      return (
        <span key={id} aria-current="page" className={`${SEG_ON.replace("flex ", `${width} `)}`}>
          {m.label}
        </span>
      );
    }
    if (m.href) {
      return (
        <Link key={id} href={m.href} className={SEG_OFF.replace("flex ", `${width} `)}>
          {m.label}
        </Link>
      );
    }
    return (
      <button key={id} type="button" onClick={m.onClick} className={SEG_OFF.replace("flex ", `${width} `)}>
        {m.label}
      </button>
    );
  };
  return (
    <div className={`flex h-12 flex-none items-center gap-2 border-b ${STUDIO_HAIR} ${STUDIO_BAR_BG} px-3.5 md:gap-3`}>
      <Link href={back.href} aria-label={back.label} className="whitespace-nowrap text-xs font-medium text-[#9aa0ad] hover:text-[#ecedf1]">
        ←<span className="hidden md:inline"> {back.label}</span>
      </Link>
      <span aria-hidden className="hidden h-5 w-px bg-white/[0.09] md:block" />
      {/* The set's name: a truncating block from a tablet's width, only for screen readers below it. */}
      <h1 className="hidden min-w-[80px] max-w-[280px] shrink truncate font-display text-[14px] font-semibold text-[#ecedf1] md:block">{title}</h1>
      <span className="sr-only md:hidden">{title}</span>
      {meta && <span className="hidden whitespace-nowrap text-[11px] tabular-nums text-[#6b6f7a] xl:inline">{meta}</span>}
      <span className="flex-1" />
      <span className={SEG}>
        {modeButton("build")}
        {modeButton("shoot")}
        {modeButton("film")}
        {modeButton("cut")}
      </span>
      {view && (
        <span role="radiogroup" aria-label={view.names.lit} className={`${SEG} ml-1 hidden min-[1440px]:flex`}>
          {VIEW_MODES.map((m, i) => (
            <button
              key={m}
              type="button"
              role="radio"
              aria-checked={view.mode === m}
              onClick={() => view.onChange(m)}
              title={`${view.names[m]} · ${i + 1}`}
              className={view.mode === m ? VIEW_ON : VIEW_OFF}
            >
              {view.names[m]}
            </button>
          ))}
        </span>
      )}
      <span className="flex-1" />
      {find && (
        <button
          type="button"
          onClick={find.onOpen}
          title={find.label}
          aria-label={find.label}
          className="hidden h-8 min-w-[96px] basis-[200px] shrink-[4] grow-0 cursor-pointer items-center gap-2 rounded-[7px] bg-[#111217] px-2.5 text-[12px] text-[#6b6f7a] shadow-[inset_0_0_0_1px_rgba(255,255,255,0.08)] hover:text-[#ecedf1] xl:flex"
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
            <circle cx="11" cy="11" r="7" />
            <path d="m20 20-3.5-3.5" />
          </svg>
          <span className="min-w-0 flex-1 truncate text-left">{find.label}</span>
          <kbd className="rounded-[4px] bg-white/[0.06] px-1.5 py-0.5 font-sans text-[10px] font-semibold">{find.kbd}</kbd>
        </button>
      )}
      {children}
      {rendering && (
        <span className="hidden h-8 items-center gap-2 whitespace-nowrap rounded-[6px] px-2 text-xs font-medium text-[#9aa0ad] md:flex">
          <span aria-hidden className="h-[7px] w-[7px] rounded-full bg-[#e0a468] shadow-[0_0_0_3px_rgba(224,164,104,0.2)]" />
          {rendering.label}
        </span>
      )}
      {/* The primary action waits for a tablet's width: on a phone the composer's own button shoots. */}
      {primary && <span className="hidden md:contents">{primary}</span>}
    </div>
  );
}

/**
 * The rail: nine tools on single keys, in the three drawn groups. A tool
 * stays picked; an action fires once; a tool that is off here is still
 * drawn, dimmed, with the note that says where it is. The page can add its
 * own button under them (Build's Add).
 */
export function StudioRail({
  mode,
  tool,
  onTool,
  names,
  notes,
  children,
}: {
  mode: StudioMode;
  tool: RailTool | null;
  onTool: (tool: RailTool) => void;
  names: Record<RailTool, string>;
  notes: Record<RailToolNote, string>;
  children?: ReactNode;
}) {
  const tools = railToolsFor(mode);
  return (
    <div className={`relative flex w-12 flex-none flex-col items-center gap-1 border-r ${STUDIO_HAIR} ${STUDIO_PANEL_BG} py-2.5`}>
      {tools.map((t, i) => {
        const first = i === 0 || tools[i - 1].group !== t.group;
        const title = t.use === "off" ? `${names[t.id]} · ${t.key} — ${notes[t.note ?? "build"]}` : `${names[t.id]} · ${t.key}`;
        return (
          <span key={t.id} className="contents">
            {first && i > 0 && <span aria-hidden className="my-1 h-px w-6 bg-white/[0.08]" />}
            <button
              type="button"
              onClick={t.use === "off" ? undefined : () => onTool(t.id)}
              disabled={t.use === "off"}
              aria-pressed={t.use === "tool" ? tool === t.id : undefined}
              aria-label={names[t.id]}
              title={title}
              data-tool={t.id}
              className={t.use === "off" ? TOOL_OFF : t.use === "tool" && tool === t.id ? TOOL_ON : TOOL_BTN}
            >
              <StudioSvg d={RAIL_ICONS[t.id]} />
            </button>
          </span>
        );
      })}
      {children}
    </div>
  );
}

/** The rail's tools in drawn order, for a page that wants the list without the rail (the phone's menus, a test). */
export const RAIL_TOOL_IDS: readonly RailTool[] = RAIL_TOOLS.map((t) => t.id);

/**
 * The dock on the right: a tab bar (Scene · Camera · Light · Look · Film ·
 * History · Astra, as the mode has them), the tab's content, and a foot
 * that stays whatever the tab — where the shoot keeps its composer.
 */
export function StudioDock({
  label,
  tabs,
  names,
  tab,
  onTab,
  children,
  foot,
}: {
  label: string;
  tabs: readonly DockTab[];
  names: Record<DockTab, string>;
  tab: DockTab;
  onTab: (tab: DockTab) => void;
  children: ReactNode;
  foot?: ReactNode;
}) {
  return (
    <aside aria-label={label} className={`flex w-[340px] flex-none flex-col border-l ${STUDIO_HAIR} ${STUDIO_PANEL_BG} min-h-0`}>
      <div role="tablist" aria-label={label} className={`flex flex-none items-stretch border-b ${STUDIO_HAIR} px-1`}>
        {tabs.map((t) => (
          <button
            key={t}
            type="button"
            role="tab"
            aria-selected={tab === t}
            data-tab={t}
            onClick={() => onTab(t)}
            className={`flex h-9 min-w-0 flex-1 cursor-pointer items-center justify-center truncate border-b-2 px-1 text-[11px] font-medium ${
              tab === t ? "border-[#e0a468] text-[#f0cda6]" : "border-transparent text-[#6b6f7a] hover:text-[#ecedf1]"
            }`}
          >
            {names[t]}
          </button>
        ))}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
      {foot && <div className={`flex-none border-t ${STUDIO_HAIR}`}>{foot}</div>}
    </aside>
  );
}

/** The status bar along the foot: what the stage holds, what is checked after, what the lab makes, and the page's own facts. */
export function StudioStatus({ children }: { children: ReactNode }) {
  return <div className={`relative flex h-6 flex-none items-center gap-4 border-t ${STUDIO_HAIR} ${STUDIO_BAR_BG} px-3.5 text-[11px] text-[#6b6f7a]`}>{children}</div>;
}

/** One of the status bar's lists: "Held by the stage: frame · lens · stop". */
export function StatusList({ label, items, none, className }: { label: string; items: readonly string[]; none: string; className?: string }) {
  return (
    <span className={`whitespace-nowrap ${className ?? ""}`}>
      <b className="font-semibold text-[#9aa0ad]">{label}:</b> {items.length ? items.join(" · ") : none}
    </span>
  );
}
