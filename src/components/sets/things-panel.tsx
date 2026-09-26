"use client";

// "In this set" (the new layout, 2026-09-24, "I want the UI to be simpler and
// friendlier while also being professional"): the list down the left of the
// Helios screen, the way a model workspace keeps its assets — the people,
// then the things, each saying at a glance what it is drawn as (a 3D model,
// its photos, or plain blocks), then the place itself. A row opens that
// thing's card on the right; it never moves the camera. Literal colours
// only (the Screening theme turns Tailwind's `white` near-black, 42b64bc).

import type { Messages } from "@/lib/i18n/messages/en";
import { formatMsg } from "@/lib/i18n/format";

type Words = Messages["sets"]["simple"];

/** One row: a person or a thing, and what it is drawn as. */
export type PanelRow = {
  key: string;
  name: string;
  thumb: string | null;
  round?: boolean;
  /** What it is drawn as, for the line under its name. */
  state: "model" | "loading" | "photos" | "blocks" | "person" | "nobody";
  photos?: number;
};

const ROW =
  "flex w-full cursor-pointer items-center gap-3 rounded-[12px] border px-2.5 py-2 text-left transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#e0a468]";

/** What a row says it is drawn as, and in which ink: the list's and the strip's one rule. */
function rowLine(r: PanelRow, w: Words): { text: string; tone: string } {
  return r.state === "model"
    ? { text: w.rowModel, tone: "text-[#8fcf9a]" }
    : r.state === "loading"
      ? { text: w.rowLoading, tone: "text-[#e0a468]" }
      : r.state === "photos"
        ? { text: r.photos === 1 ? w.rowOnePhoto : formatMsg(w.rowPhotos, { n: r.photos ?? 0 }), tone: "text-[#c6c9d1]" }
        : r.state === "person"
          ? { text: w.rowPlays, tone: "text-[#c6c9d1]" }
          : r.state === "nobody"
            ? { text: w.rowNobody, tone: "text-[#9aa0ad]" }
            : { text: w.rowBlocks, tone: "text-[#9aa0ad]" };
}

/**
 * "In this set" on a phone: the same rows as one strip that swipes, over the
 * foot of the stage in the Set step, where the three columns do not fit. A
 * chip opens its thing's card, the sheet a phone already has.
 */
export function ThingsStrip({ rows, selected, onOpen, w }: { rows: readonly PanelRow[]; selected: string | null; onOpen: (key: string) => void; w: Words }) {
  return (
    <nav aria-label={w.inSet} data-things-strip className="flex max-w-full items-center gap-1.5 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
      {rows.map((r) => {
        const on = r.key === selected;
        const l = rowLine(r, w);
        return (
          <button
            key={r.key}
            type="button"
            onClick={() => onOpen(r.key)}
            aria-pressed={on}
            data-panel-row={r.key}
            data-panel-state={r.state}
            className={`flex h-11 flex-none cursor-pointer items-center gap-2 rounded-full border bg-[rgba(0,0,0,0.62)] pl-1 pr-3 backdrop-blur ${
              on ? "border-[rgba(240,196,142,0.75)]" : "border-[rgba(255,255,255,0.1)]"
            }`}
          >
            {r.thumb ? (
              // eslint-disable-next-line @next/next/no-img-element -- a private media thumbnail, like the filmstrip's
              <img src={r.thumb} alt="" className={`h-8 w-8 flex-none object-cover ${r.round ? "rounded-full" : "rounded-[8px]"}`} />
            ) : (
              <span aria-hidden className={`flex h-8 w-8 flex-none items-center justify-center bg-[#2a2c33] text-[12px] font-bold text-[#c6c9d1] ${r.round ? "rounded-full" : "rounded-[8px]"}`}>
                {r.name.slice(0, 1).toUpperCase()}
              </span>
            )}
            <span className="flex flex-col items-start leading-tight">
              <span className="whitespace-nowrap text-[12.5px] font-semibold text-[#ecedf1]">{r.name}</span>
              <span className={`whitespace-nowrap text-[11px] ${l.tone}`}>{l.text}</span>
            </span>
          </button>
        );
      })}
    </nav>
  );
}

export function ThingsPanel({
  people,
  things,
  selected,
  onOpen,
  onPlace,
  placeLine,
  models,
  w,
}: {
  people: readonly PanelRow[];
  things: readonly PanelRow[];
  /** The row whose card is open. */
  selected: string | null;
  onOpen: (key: string) => void;
  /** Change the place: Astra, in the Set step's panel. */
  onPlace: () => void;
  placeLine: string;
  /**
   * Whether a thing can take a 3D model here (data.ts modelsOn, admins
   * only): the list's lines then say "photos or a model"; otherwise
   * photos alone, so nobody is told of a model they cannot add.
   */
  models: boolean;
  w: Words;
}) {
  const line = (r: PanelRow) => rowLine(r, w);
  const row = (r: PanelRow) => {
    const on = r.key === selected;
    const l = line(r);
    return (
      <button
        key={r.key}
        type="button"
        onClick={() => onOpen(r.key)}
        aria-pressed={on}
        data-panel-row={r.key}
        data-panel-state={r.state}
        className={`${ROW} ${on ? "border-[rgba(240,196,142,0.6)] bg-[rgba(224,164,104,0.1)]" : "border-transparent hover:bg-[rgba(255,255,255,0.04)]"}`}
      >
        {r.thumb ? (
          // eslint-disable-next-line @next/next/no-img-element -- a private media thumbnail, like the filmstrip's
          <img src={r.thumb} alt="" className={`h-10 w-10 flex-none object-cover ${r.round ? "rounded-full" : "rounded-[9px]"}`} />
        ) : (
          <span aria-hidden className={`flex h-10 w-10 flex-none items-center justify-center bg-[#2a2c33] text-[13px] font-bold text-[#c6c9d1] ${r.round ? "rounded-full" : "rounded-[9px]"}`}>
            {r.name.slice(0, 1).toUpperCase()}
          </span>
        )}
        <span className="flex min-w-0 flex-col gap-0.5">
          <span className="truncate text-[14px] font-semibold text-[#ecedf1]">{r.name}</span>
          <span className={`truncate text-[12px] ${l.tone}`}>{l.text}</span>
        </span>
      </button>
    );
  };
  return (
    <nav
      aria-label={w.inSet}
      data-things-panel
      className="flex w-[272px] flex-none flex-col gap-5 overflow-y-auto border-r border-[rgba(255,255,255,0.07)] bg-[#15161b] px-3 py-4"
    >
      <div className="flex flex-col gap-1.5">
        <h2 className="px-1.5 text-[11px] font-semibold uppercase tracking-[0.1em] text-[#9aa0ad]">{w.people}</h2>
        {people.map(row)}
      </div>
      <div className="flex flex-col gap-1.5">
        <h2 className="px-1.5 text-[11px] font-semibold uppercase tracking-[0.1em] text-[#9aa0ad]">{w.things}</h2>
        {things.length ? things.map(row) : <p className="px-1.5 text-[12px] leading-snug text-[#9aa0ad]">{models ? w.noThings : w.noThingsPhotos}</p>}
        <p className="px-1.5 pt-1 text-[11.5px] leading-snug text-[#9aa0ad]">{models ? w.thingsHint : w.thingsHintPhotos}</p>
      </div>
      <div className="flex-1" />
      <div className="flex flex-col gap-1.5 rounded-[12px] bg-[#1d1e24] p-3.5" data-panel-place>
        <h2 className="text-[14px] font-semibold text-[#ecedf1]">{w.place}</h2>
        <p className="text-[12.5px] leading-snug text-[#c6c9d1]">{placeLine}</p>
        <button type="button" onClick={onPlace} className="self-start text-[12.5px] font-semibold text-[#f0cda6] hover:text-[#ffe2c2]">
          {w.placeChange}
        </button>
      </div>
    </nav>
  );
}
