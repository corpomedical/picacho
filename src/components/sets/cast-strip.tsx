"use client";

// The cast strip (R1, 2026-09-21): one row over the stage naming who and
// what the next still carries — the person, the things whose sheets ride
// in sheet order, the others with why not, and any photos left on nothing.
// A chip opens its card; it never moves the camera. Literal colours only
// (the Screening theme turns Tailwind's `white` near-black, 42b64bc).

import { useState } from "react";
import { formatMsg } from "@/lib/i18n/format";
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
const ITEM = "flex cursor-pointer items-center gap-2 rounded-[8px] px-2.5 py-1.5 text-left text-[12px] text-[#c6c9d1] hover:bg-[rgba(255,255,255,0.05)] hover:text-[#ecedf1]";

export function CastStrip({
  chips,
  loose,
  targets,
  hint,
  onOpen,
  onPutOn,
  onRemoveLoose,
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
  c: Cast;
  className: string;
}) {
  const [looseOpen, setLooseOpen] = useState(false);
  const [hintOpen, setHintOpen] = useState(false);
  return (
    <div role="group" aria-label={c.strip} data-cast-strip className={`${className} flex items-center gap-1.5`}>
      <div className="flex min-w-0 items-center gap-1.5 overflow-x-auto [scrollbar-width:none]">
        {chips.map((chip) => (
          <button
            key={chip.key}
            type="button"
            onClick={() => onOpen(chip.key)}
            title={chip.title}
            data-cast-chip={chip.key}
            data-el-state={chip.state}
            className={`${CHIP} ${chip.state === "rides" ? "border-[rgba(240,196,142,0.75)] text-[#f0cda6]" : "border-[rgba(255,255,255,0.1)] text-[#e3e5ea]"}`}
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
        ))}
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
      {loose.length > 0 && (
        <div className="relative flex-none">
          <button
            type="button"
            onClick={() => setLooseOpen((v) => !v)}
            aria-expanded={looseOpen}
            title={c.stLooseLong}
            data-cast-loose
            className={`${CHIP} border-dashed border-[rgba(214,217,224,0.4)] text-[#d6d9e0]`}
          >
            {/* eslint-disable-next-line @next/next/no-img-element -- a private media thumbnail, like the filmstrip's */}
            <img src={loose[0].url} alt="" className="h-5 w-5 flex-none rounded-[5px] object-cover opacity-70" />
            {loose.length === 1 ? c.looseOne : formatMsg(c.looseN, { n: loose.length })}
          </button>
          {looseOpen && (
            <div role="menu" aria-label={c.stLoose} className={MENU}>
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
      )}
      {hint && hintOpen && (
        <p className="absolute bottom-full left-0 mb-2 max-w-[320px] rounded-[10px] border border-[rgba(255,255,255,0.1)] bg-[rgba(0,0,0,0.78)] px-3 py-2 text-[11.5px] leading-snug text-[#d6d9e0]">
          {c.stripAddHint}
        </p>
      )}
    </div>
  );
}
