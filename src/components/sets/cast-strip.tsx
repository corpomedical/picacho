"use client";

// The cast strip (R1, 2026-09-21): one row over the stage naming who and
// what the next still carries — the person, the things whose sheets ride
// in sheet order, the others with why not, and any photos left on nothing.
// A chip opens its card; it never moves the camera. A thing's chip can be
// dragged along the row (a mouse or a pen, past 6 px) or moved with
// Alt+← / Alt+→: the first ride when a still is full. A finger scrolls the
// row, so on a phone the card's Move buttons do it. Literal colours only
// (the Screening theme turns Tailwind's `white` near-black, 42b64bc).

import { useRef, useState, type ReactNode } from "react";
import { formatMsg } from "../../lib/i18n/format";
import type { Messages } from "@/lib/i18n/messages/en";
import type { ElementPhoto } from "@/lib/sets/elements";

type Cast = Messages["sets"]["cast"];

export type CastChip = {
  key: string;
  name: string;
  thumb: string | null;
  /** The status word after the name; empty for the person. */
  word: string;
  /** The whole sentence, for the chip's title. */
  title: string;
  state: "rides" | "idle" | "person";
  round?: boolean;
};

const CHIP =
  "inline-flex h-8 flex-none cursor-pointer items-center gap-1.5 whitespace-nowrap rounded-full border bg-[rgba(0,0,0,0.62)] pl-1 pr-3 text-[11.5px] font-medium backdrop-blur transition-colors hover:bg-[rgba(0,0,0,0.8)]";
const MENU =
  "absolute bottom-full left-0 z-40 mb-2 flex max-h-80 min-w-[13rem] flex-col gap-0.5 overflow-y-auto rounded-[12px] border border-[rgba(255,255,255,0.11)] bg-[#1d1e24] p-1.5 shadow-[0_24px_48px_-12px_rgba(0,0,0,0.6)]";
/** How far a mouse or pen travels on a chip before it is a drag, not a click (stage-pick.ts's mouse slop, a little more). */
const DRAG_SLOP_PX = 6;
const ITEM = "flex cursor-pointer items-center gap-2 rounded-[8px] px-2.5 py-1.5 text-left text-[12px] text-[#c6c9d1] hover:bg-[rgba(255,255,255,0.05)] hover:text-[#ecedf1]";
/** The loose photos' menu opening downward: for a list that scrolls, where one opening upward would be cut off at its top. */
export const LOOSE_MENU_BELOW = MENU.replace("bottom-full", "top-full").replace("mb-2", "mt-2");
/** The loose photos' menu hung from the chip's right edge: for a phone's strip, whose chip sits at the screen's right, where one opening rightward ran off the screen (review of Cut 3). */
export const LOOSE_MENU_RIGHT = MENU.replace("left-0", "right-0");

/**
 * Photos on nothing (their thing changed or left the set, or they came from
 * before R1): the button that counts them and the menu that puts each back
 * on a thing or removes it. The strip draws it as its dashed chip; the new
 * layout's list and phone strip (things-panel.tsx, Helios Cut 3, step 14)
 * draw their own button round the same menu.
 */
export function LoosePhotos({
  loose,
  targets,
  onPutOn,
  onRemoveLoose,
  c,
  className = "relative flex-none",
  buttonClassName = `${CHIP} border-dashed border-[rgba(214,217,224,0.4)] text-[#d6d9e0]`,
  menuClassName = MENU,
  children,
}: {
  loose: readonly ElementPhoto[];
  /** The things a loose photo can be put on. */
  targets: readonly { key: string; name: string }[];
  onPutOn: (refId: string, key: string) => void;
  onRemoveLoose: (refId: string) => void;
  c: Cast;
  className?: string;
  buttonClassName?: string;
  menuClassName?: string;
  /** What the button shows; the strip's photo and count when absent. */
  children?: ReactNode;
}) {
  const [looseOpen, setLooseOpen] = useState(false);
  if (loose.length === 0) return null;
  return (
    <div className={className}>
      <button
        type="button"
        onClick={() => setLooseOpen((v) => !v)}
        aria-expanded={looseOpen}
        title={c.stLooseLong}
        data-cast-loose
        className={buttonClassName}
      >
        {children ?? (
          <>
            {/* eslint-disable-next-line @next/next/no-img-element -- a private media thumbnail, like the filmstrip's */}
            <img src={loose[0].url} alt="" className="h-5 w-5 flex-none rounded-[5px] object-cover opacity-70" />
            {loose.length === 1 ? c.looseOne : formatMsg(c.looseN, { n: loose.length })}
          </>
        )}
      </button>
      {looseOpen && (
        <div role="menu" aria-label={c.stLoose} className={menuClassName}>
          {loose.map((p) => (
            <div key={p.refId} className="flex flex-col gap-0.5 border-b border-[rgba(255,255,255,0.06)] pb-1 last:border-b-0">
              {/* eslint-disable-next-line @next/next/no-img-element -- a private media thumbnail, like the filmstrip's */}
              <img src={p.url} alt="" className="m-1 h-12 w-12 rounded-[6px] object-cover" />
              {targets.map((t) => (
                <button
                  key={t.key}
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setLooseOpen(false);
                    onPutOn(p.refId, t.key);
                  }}
                  className={ITEM}
                >
                  {formatMsg(c.putOn, { name: t.name })}
                </button>
              ))}
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  setLooseOpen(false);
                  onRemoveLoose(p.refId);
                }}
                className={`${ITEM} text-[#f08c8c] hover:text-[#f5a3a3]`}
              >
                {c.remove}
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function CastStrip({
  chips,
  loose,
  targets,
  hint,
  onOpen,
  onPutOn,
  onRemoveLoose,
  onReorder,
  c,
  className,
}: {
  chips: readonly CastChip[];
  /** Photos on nothing: their thing changed or left the set, or they came from before R1. */
  loose: readonly ElementPhoto[];
  /** The things a loose photo can be put on. */
  targets: readonly { key: string; name: string }[];
  /** No thing has photos yet: show the ghost chip that says how. */
  hint: boolean;
  onOpen: (key: string) => void;
  onPutOn: (refId: string, key: string) => void;
  onRemoveLoose: (refId: string) => void;
  /** Put a thing at a place among the things' chips. */
  onReorder: (key: string, to: number) => void;
  c: Cast;
  className: string;
}) {
  const [hintOpen, setHintOpen] = useState(false);
  const rowRef = useRef<HTMLDivElement>(null);
  const drag = useRef<{ key: string; id: number; x: number; live: boolean } | null>(null);
  const dragged = useRef(false);
  const [dragKey, setDragKey] = useState<string | null>(null);
  const [dropAt, setDropAt] = useState<number | null>(null);
  const things = chips.filter((ch) => ch.state !== "person").map((ch) => ch.key);
  /** Where among the things' chips a pointer at x would drop, counting the one being dragged. */
  const indexAt = (x: number) => {
    let i = 0;
    for (const el of rowRef.current?.querySelectorAll<HTMLElement>("[data-cast-thing]") ?? []) {
      const r = el.getBoundingClientRect();
      if (x > r.left + r.width / 2) i++;
    }
    return i;
  };
  const endDrag = () => {
    drag.current = null;
    setDragKey(null);
    setDropAt(null);
  };
  return (
    <div role="group" aria-label={c.strip} data-cast-strip className={`${className} flex items-center gap-1.5`}>
      <div ref={rowRef} className="flex min-w-0 items-center gap-1.5 overflow-x-auto [scrollbar-width:none]">
        {chips.map((chip) => {
          const thing = chip.state !== "person";
          const at = things.indexOf(chip.key);
          return (
          <button
            key={chip.key}
            type="button"
            onClick={() => {
              // The click that ends a drag opens nothing.
              if (dragged.current) {
                dragged.current = false;
                return;
              }
              onOpen(chip.key);
            }}
            onPointerDown={(e) => {
              if (!thing || e.button !== 0 || e.pointerType === "touch") return;
              drag.current = { key: chip.key, id: e.pointerId, x: e.clientX, live: false };
            }}
            onPointerMove={(e) => {
              const d = drag.current;
              if (!d || d.id !== e.pointerId) return;
              if (!d.live) {
                if (Math.abs(e.clientX - d.x) <= DRAG_SLOP_PX) return;
                d.live = true;
                setDragKey(d.key);
                e.currentTarget.setPointerCapture(e.pointerId);
              }
              setDropAt(indexAt(e.clientX));
            }}
            onPointerUp={(e) => {
              const d = drag.current;
              if (!d || d.id !== e.pointerId) return;
              if (d.live) {
                dragged.current = true;
                const from = things.indexOf(d.key);
                const raw = indexAt(e.clientX);
                onReorder(d.key, raw > from ? raw - 1 : raw);
              }
              endDrag();
            }}
            onPointerCancel={endDrag}
            onKeyDown={(e) => {
              if (!thing || !e.altKey || (e.key !== "ArrowLeft" && e.key !== "ArrowRight")) return;
              e.preventDefault();
              onReorder(chip.key, e.key === "ArrowLeft" ? at - 1 : at + 1);
            }}
            title={thing ? `${chip.title} ${c.dragHint}` : chip.title}
            data-cast-chip={chip.key}
            {...(thing ? { "data-cast-thing": "" } : {})}
            data-el-state={chip.state}
            className={`${CHIP} ${chip.state === "rides" ? "border-[rgba(240,196,142,0.75)] text-[#f0cda6]" : "border-[rgba(255,255,255,0.1)] text-[#e3e5ea]"} ${
              dragKey === chip.key ? "opacity-60" : ""
            } ${dragKey && dropAt === at && dragKey !== chip.key ? "shadow-[-3px_0_0_#f0cda6]" : ""}`}
          >
            {chip.thumb ? (
              // eslint-disable-next-line @next/next/no-img-element -- a private media thumbnail, like the filmstrip's
              <img src={chip.thumb} alt="" className={`h-5 w-5 flex-none object-cover ${chip.round ? "rounded-full" : "rounded-[5px]"}`} />
            ) : (
              <span className={`h-5 w-5 flex-none bg-[#2a2c33] ${chip.round ? "rounded-full" : "rounded-[5px]"}`} aria-hidden />
            )}
            <span>{chip.name}</span>
            {chip.word && <span className={chip.state === "rides" ? "text-[#f0cda6]" : "text-[#9aa0ad]"}>· {chip.word}</span>}
          </button>
          );
        })}
        {hint && (
          <button
            type="button"
            onClick={() => setHintOpen((v) => !v)}
            aria-expanded={hintOpen}
            title={c.stripAddHint}
            data-cast-empty
            className={`${CHIP} border-dashed border-[rgba(214,217,224,0.4)] pl-3 text-[#d6d9e0]`}
          >
            {c.stripAdd}
          </button>
        )}
      </div>
      {loose.length > 0 && <LoosePhotos loose={loose} targets={targets} onPutOn={onPutOn} onRemoveLoose={onRemoveLoose} c={c} />}
      {hint && hintOpen && (
        <p className="absolute bottom-full left-0 mb-2 max-w-[320px] rounded-[10px] border border-[rgba(255,255,255,0.1)] bg-[rgba(0,0,0,0.78)] px-3 py-2 text-[11.5px] leading-snug text-[#d6d9e0]">
          {c.stripAddHint}
        </p>
      )}
    </div>
  );
}
