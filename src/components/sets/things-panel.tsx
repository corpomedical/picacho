"use client";

// "In this set" (the new layout, 2026-09-24, "I want the UI to be simpler and
// friendlier while also being professional"): the list down the left of the
// Helios screen, the way a model workspace keeps its assets — the people,
// then the things, each saying at a glance what it is drawn as (a 3D model,
// its photos, or plain blocks), then the place itself. A row opens that
// thing's card on the right; it never moves the camera. Literal colours
// only (the Screening theme turns Tailwind's `white` near-black, 42b64bc).
//
// It says what the Classic cast strip says (Helios Cut 3, step 14), which
// this layout never draws: whether a thing's photos ride the next still or
// why not, when the person's character needs an answer, and any photos left
// on nothing, with the strip's own menu to put them back.

import type { Messages } from "@/lib/i18n/messages/en";
import type { ElementPhoto } from "@/lib/sets/elements";
import { formatMsg } from "../../lib/i18n/format";
import { LOOSE_MENU_BELOW, LoosePhotos } from "./cast-strip";

type Words = Messages["sets"]["simple"];
type Cast = Messages["sets"]["cast"];

/** Photos on nothing and where they can go: the cast strip's own menu (cast-strip.tsx LoosePhotos). */
export type LooseBundle = {
  loose: readonly ElementPhoto[];
  targets: readonly { key: string; name: string }[];
  onPutOn: (refId: string, key: string) => void;
  onRemoveLoose: (refId: string) => void;
};

/** One row: a person or a thing, and what it is drawn as. */
export type PanelRow = {
  key: string;
  name: string;
  thumb: string | null;
  round?: boolean;
  /** What it is drawn as, for the line under its name; "answer" is a person whose character needs the person's answer first. */
  state: "model" | "loading" | "photos" | "blocks" | "person" | "answer" | "nobody";
  photos?: number;
  /** The cast strip's word for a thing with photos: they ride the next still, or why not ("Not in this frame"). */
  word?: string;
  /** Its photos ride the next still: the word is said in the strip's ochre. */
  rides?: boolean;
  /** The whole sentence, for the row's title (the strip's chip title). */
  title?: string;
};

const ROW =
  "flex w-full cursor-pointer items-center gap-3 rounded-[12px] border px-2.5 py-2 text-left transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#e0a468]";

/** What a row says it is drawn as, and in which ink: the list's and the strip's one rule. */
export function rowLine(r: PanelRow, w: Words, c: Cast): { text: string; tone: string } {
  const drawn =
    r.state === "model"
      ? { text: w.rowModel, tone: "text-[#8fcf9a]" }
      : r.state === "loading"
        ? { text: w.rowLoading, tone: "text-[#e0a468]" }
        : r.state === "photos"
          ? { text: r.photos === 1 ? w.rowOnePhoto : formatMsg(w.rowPhotos, { n: r.photos ?? 0 }), tone: "text-[#c6c9d1]" }
          : r.state === "person"
            ? { text: w.rowPlays, tone: "text-[#c6c9d1]" }
            : r.state === "answer"
              ? { text: c.needsAnswer, tone: "text-[#e0a468]" }
              : r.state === "nobody"
                ? { text: w.rowNobody, tone: "text-[#9aa0ad]" }
                : { text: w.rowBlocks, tone: "text-[#9aa0ad]" };
  // The strip's word after it: riding in its ochre, why not in the line's own ink.
  return r.word ? { text: `${drawn.text} · ${r.word}`, tone: r.rides ? "text-[#f0cda6]" : drawn.tone } : drawn;
}

/** How many photos are on nothing, the strip's own words. */
const looseCount = (n: number, c: Cast) => (n === 1 ? c.looseOne : formatMsg(c.looseN, { n }));

/**
 * "In this set" on a phone: the same rows as one strip that swipes, over the
 * foot of the stage in the Set step, where the three columns do not fit. A
 * chip opens its thing's card, the sheet a phone already has.
 */
export function ThingsStrip({
  rows,
  selected,
  onOpen,
  loose,
  w,
  c,
}: {
  rows: readonly PanelRow[];
  selected: string | null;
  onOpen: (key: string) => void;
  /** Photos on nothing: a chip after the row, outside its scroll so the menu opening upward is not cut off. */
  loose?: LooseBundle;
  w: Words;
  c: Cast;
}) {
  const strip = (
    <nav aria-label={w.inSet} data-things-strip className="flex min-w-0 max-w-full items-center gap-1.5 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
      {rows.map((r) => {
        const on = r.key === selected;
        const l = rowLine(r, w, c);
        return (
          <button
            key={r.key}
            type="button"
            onClick={() => onOpen(r.key)}
            aria-pressed={on}
            title={r.title}
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
  if (!loose || loose.loose.length === 0) return strip;
  return (
    <div className="flex max-w-full items-center gap-1.5">
      {strip}
      <LoosePhotos
        {...loose}
        c={c}
        buttonClassName="flex h-11 flex-none cursor-pointer items-center gap-2 rounded-full border border-dashed border-[rgba(214,217,224,0.4)] bg-[rgba(0,0,0,0.62)] pl-1 pr-3 backdrop-blur"
      >
        {/* eslint-disable-next-line @next/next/no-img-element -- a private media thumbnail, like the filmstrip's */}
        <img src={loose.loose[0].url} alt="" className="h-8 w-8 flex-none rounded-[8px] object-cover opacity-70" />
        <span className="flex flex-col items-start leading-tight">
          <span className="whitespace-nowrap text-[12.5px] font-semibold text-[#ecedf1]">{w.loose}</span>
          <span className="whitespace-nowrap text-[11px] text-[#e0a468]">{looseCount(loose.loose.length, c)}</span>
        </span>
      </LoosePhotos>
    </div>
  );
}

export function ThingsPanel({
  people,
  things,
  selected,
  onOpen,
  onPlace,
  onEdit,
  placeLine,
  models,
  loose,
  w,
  c,
}: {
  people: readonly PanelRow[];
  things: readonly PanelRow[];
  /** The row whose card is open. */
  selected: string | null;
  onOpen: (key: string) => void;
  /** Change the place: Astra, in the Set step's panel. */
  onPlace: () => void;
  /**
   * Edit the place by hand: the Build editor (?build=1). Given, "Edit it
   * yourself" sits beside "Change it with Astra"; the page gives it only
   * while Advanced is on (Helios Cut 3, step 17). The list is drawn from
   * 1180 px up, well clear of the editor's own 640 px floor.
   */
  onEdit?: () => void;
  placeLine: string;
  /**
   * Whether a thing can take a 3D model here (data.ts modelsOn, admins
   * only): the list's lines then say "photos or a model"; otherwise
   * photos alone, so nobody is told of a model they cannot add.
   */
  models: boolean;
  /** Photos on nothing: a row under the things, whose menu puts each back on one. */
  loose?: LooseBundle;
  w: Words;
  c: Cast;
}) {
  const line = (r: PanelRow) => rowLine(r, w, c);
  const row = (r: PanelRow) => {
    const on = r.key === selected;
    const l = line(r);
    return (
      <button
        key={r.key}
        type="button"
        onClick={() => onOpen(r.key)}
        aria-pressed={on}
        title={r.title}
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
        {loose && loose.loose.length > 0 && (
          // The list scrolls, so the menu opens downward, into it.
          <LoosePhotos {...loose} c={c} className="relative" buttonClassName={`${ROW} border-dashed border-[rgba(214,217,224,0.3)] hover:bg-[rgba(255,255,255,0.04)]`} menuClassName={LOOSE_MENU_BELOW}>
            {/* eslint-disable-next-line @next/next/no-img-element -- a private media thumbnail, like the filmstrip's */}
            <img src={loose.loose[0].url} alt="" className="h-10 w-10 flex-none rounded-[9px] object-cover opacity-70" />
            <span className="flex min-w-0 flex-col gap-0.5">
              <span className="truncate text-[14px] font-semibold text-[#ecedf1]">{w.loose}</span>
              <span className="truncate text-[12px] text-[#e0a468]">{looseCount(loose.loose.length, c)}</span>
            </span>
          </LoosePhotos>
        )}
        <p className="px-1.5 pt-1 text-[11.5px] leading-snug text-[#9aa0ad]">{models ? w.thingsHint : w.thingsHintPhotos}</p>
      </div>
      <div className="flex-1" />
      <div className="flex flex-col gap-1.5 rounded-[12px] bg-[#1d1e24] p-3.5" data-panel-place>
        <h2 className="text-[14px] font-semibold text-[#ecedf1]">{w.place}</h2>
        <p className="text-[12.5px] leading-snug text-[#c6c9d1]">{placeLine}</p>
        {onEdit ? (
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
            <button type="button" onClick={onPlace} className="self-start text-[12.5px] font-semibold text-[#f0cda6] hover:text-[#ffe2c2]">
              {w.placeChange}
            </button>
            <button type="button" onClick={onEdit} className="text-[12.5px] font-semibold text-[#d6d9e0] hover:text-[#ecedf1]" data-panel-edit>
              {w.placeEdit}
            </button>
          </div>
        ) : (
          <button type="button" onClick={onPlace} className="self-start text-[12.5px] font-semibold text-[#f0cda6] hover:text-[#ffe2c2]">
            {w.placeChange}
          </button>
        )}
      </div>
    </nav>
  );
}
