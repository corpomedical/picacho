"use client";

// A thing's card (R1, 2026-09-21): what a tap on the stage opens. A car or
// an object shows its reference photos — up to four, the first its front —
// with a tile to add one (a file, a drop, a paste), and a line that says
// what the next still does with them. The figure shows who plays it; a wall
// or the track says it is the set itself. In the dock's Scene tab on a
// computer, a sheet over the stage on a phone. Literal colours only: the
// Screening theme turns Tailwind's `white` near-black (42b64bc).

import { useEffect, useRef } from "react";
import { formatMsg } from "@/lib/i18n/format";
import type { Messages } from "@/lib/i18n/messages/en";
import type { ElementPhoto } from "@/lib/sets/elements";
import { ELEMENT_PHOTOS_MAX } from "@/lib/sets/elements";

type Cast = Messages["sets"]["cast"];

export type CardElement =
  | { kind: "car" | "vehicle" | "object"; key: string; name: string; tyres: number }
  | { kind: "figure"; key: string; name: string }
  | { kind: "structure"; key: null; name: string };

export function ElementCard({
  element,
  photos,
  extra,
  status,
  followed,
  person,
  phase,
  error,
  onAdd,
  onRemove,
  onClose,
  onShowIt,
  move,
  c,
  variant,
}: {
  element: CardElement;
  /** The photos that ride, front first (elements.ts HeldPhotos.photos). */
  photos: readonly ElementPhoto[];
  /** Any past the four: shown, never sent. */
  extra: readonly ElementPhoto[];
  /** The card's line about the next still, already in words; null when the thing has no photos. */
  status: string | null;
  /** Said when the photos found this thing after the set changed. */
  followed: string | null;
  /** Who plays the figure: their name and first photo; null when no character is picked. */
  person: { name: string; thumbUrl: string | null } | null;
  phase: "idle" | "preparing" | "checking";
  error: string | null;
  onAdd: (file: File) => void;
  onRemove: (refId: string) => void;
  onClose: () => void;
  /** Frames the thing when it is out of the frame; null when it is in it. */
  onShowIt: (() => void) | null;
  /** Its place in the strip's order, for a finger that can't drag the strip: null ends are the list's ends. */
  move: { earlier: (() => void) | null; later: (() => void) | null } | null;
  c: Cast;
  variant: "dock" | "sheet";
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const thing = element.kind === "car" || element.kind === "vehicle" || element.kind === "object";
  const full = photos.length >= ELEMENT_PHOTOS_MAX;
  const busy = phase !== "idle";

  // A pasted picture goes on the open thing (a computer's clipboard).
  useEffect(() => {
    if (!thing || variant !== "dock") return;
    const onPaste = (e: ClipboardEvent) => {
      const el = document.activeElement as HTMLElement | null;
      if (el && (el.tagName === "TEXTAREA" || el.tagName === "INPUT" || el.isContentEditable)) return;
      const file = [...(e.clipboardData?.files ?? [])].find((f) => f.type.startsWith("image/"));
      if (!file || full || busy) return;
      e.preventDefault();
      onAdd(file);
    };
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  }, [thing, variant, full, busy, onAdd]);

  const frame =
    variant === "sheet"
      ? "fixed inset-x-2 bottom-2 z-40 max-h-[70%] overflow-y-auto rounded-[16px] border border-[rgba(255,255,255,0.11)] bg-[#191a20] shadow-[0_24px_56px_-16px_rgba(0,0,0,0.6)]"
      : "border-b border-[rgba(255,255,255,0.07)]";

  return (
    <section
      aria-label={element.name}
      data-element-card
      data-element-kind={element.kind}
      className={`${frame} flex flex-col gap-2.5 p-3`}
      onDragOver={(e) => {
        if (thing && !full && !busy) e.preventDefault();
      }}
      onDrop={(e) => {
        if (!thing || full || busy) return;
        const file = [...e.dataTransfer.files].find((f) => f.type.startsWith("image/"));
        if (!file) return;
        e.preventDefault();
        onAdd(file);
      }}
    >
      <div className="flex items-center gap-2">
        <h3 className="min-w-0 flex-1 truncate text-[13px] font-semibold text-[#ecedf1]">
          {element.kind === "structure" ? c.structureTitle : element.name}
        </h3>
        {onShowIt && (
          <button
            type="button"
            onClick={onShowIt}
            className="h-6 cursor-pointer rounded-full border border-[rgba(255,255,255,0.12)] px-2.5 text-[11px] text-[#d6d9e0] hover:bg-[rgba(255,255,255,0.06)]"
          >
            {c.showIt}
          </button>
        )}
        <button
          type="button"
          onClick={onClose}
          aria-label={c.close}
          title={c.close}
          className="flex h-6 w-6 cursor-pointer items-center justify-center rounded-full text-sm text-[#d6d9e0] hover:text-[#ecedf1]"
        >
          ×
        </button>
      </div>

      {element.kind === "structure" && <p className="text-[12px] leading-snug text-[#c6c9d1]">{c.structureLine}</p>}

      {element.kind === "figure" && (
        <div className="flex items-center gap-2.5">
          {person?.thumbUrl ? (
            // eslint-disable-next-line @next/next/no-img-element -- a private media thumbnail, like the filmstrip's
            <img src={person.thumbUrl} alt="" className="h-12 w-12 flex-none rounded-full object-cover" />
          ) : (
            <span className="h-12 w-12 flex-none rounded-full bg-[#2a2c33]" aria-hidden />
          )}
          <p className="text-[12px] leading-snug text-[#c6c9d1]" data-el-status>
            {person ? formatMsg(c.personLine, { name: person.name }) : c.personNone}
          </p>
        </div>
      )}

      {thing && (
        <>
          <p className="text-[10px] font-semibold uppercase tracking-[0.07em] text-[#9aa0ad]">{c.photosLabel}</p>
          <div className="flex flex-wrap gap-2">
            {photos.map((p, i) => (
              <div key={p.refId} className="relative h-16 w-16 flex-none" data-el-photo>
                {/* eslint-disable-next-line @next/next/no-img-element -- a private media thumbnail, like the filmstrip's */}
                <img src={p.url} alt="" className="h-full w-full rounded-[8px] object-cover shadow-[inset_0_0_0_1px_rgba(255,255,255,0.1)]" />
                {i === 0 && (
                  <span className="absolute bottom-1 left-1 rounded-full bg-[rgba(0,0,0,0.72)] px-1.5 text-[9.5px] font-semibold leading-[14px] text-[#f0cda6]">{c.front}</span>
                )}
                <button
                  type="button"
                  onClick={() => onRemove(p.refId)}
                  disabled={busy}
                  aria-label={formatMsg(c.photoRemove, { n: i + 1 })}
                  title={formatMsg(c.photoRemove, { n: i + 1 })}
                  data-el-photo-remove
                  className="absolute -right-1.5 -top-1.5 flex h-5 w-5 cursor-pointer items-center justify-center rounded-full border border-[rgba(255,255,255,0.15)] bg-[#1d1e24] text-[12px] leading-none text-[#d6d9e0] hover:text-[#ecedf1] disabled:cursor-default disabled:opacity-60"
                >
                  ×
                </button>
              </div>
            ))}
            {extra.map((p) => (
              <div key={p.refId} className="relative h-16 w-16 flex-none opacity-50" title={c.stExtraLong} data-el-photo-extra>
                {/* eslint-disable-next-line @next/next/no-img-element -- a private media thumbnail, like the filmstrip's */}
                <img src={p.url} alt="" className="h-full w-full rounded-[8px] object-cover" />
                <span className="absolute bottom-1 left-1 rounded-full bg-[rgba(0,0,0,0.72)] px-1.5 text-[9.5px] leading-[14px] text-[#d6d9e0]">{c.stExtra}</span>
                <button
                  type="button"
                  onClick={() => onRemove(p.refId)}
                  disabled={busy}
                  aria-label={c.remove}
                  title={c.remove}
                  className="absolute -right-1.5 -top-1.5 flex h-5 w-5 cursor-pointer items-center justify-center rounded-full border border-[rgba(255,255,255,0.15)] bg-[#1d1e24] text-[12px] leading-none text-[#d6d9e0] hover:text-[#ecedf1]"
                >
                  ×
                </button>
              </div>
            ))}
            {!full && (
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                disabled={busy}
                data-el-add
                className="flex h-16 w-16 flex-none cursor-pointer items-center justify-center rounded-[8px] border border-dashed border-[rgba(214,217,224,0.35)] px-1 text-center text-[11px] leading-tight text-[#d6d9e0] hover:bg-[rgba(255,255,255,0.05)] disabled:cursor-default disabled:opacity-70"
              >
                {phase === "preparing" ? c.preparing : phase === "checking" ? c.checking : c.addPhoto}
              </button>
            )}
          </div>
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            hidden
            data-el-file
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = "";
              if (file) onAdd(file);
            }}
          />
          {error && <p className="text-[12px] leading-snug text-[#f08c8c]">{error}</p>}
          {full && <p className="text-[11px] leading-snug text-[#9aa0ad]">{c.full}</p>}
          {followed && <p className="text-[11px] leading-snug text-[#9aa0ad]">{followed}</p>}
          <p className="text-[11px] leading-snug text-[#c6c9d1]" data-el-status>
            {status ?? c.photoHint}
          </p>
          {element.tyres > 6 && <p className="text-[11px] leading-snug text-[#9aa0ad]">{c.merged}</p>}
          {move && (move.earlier || move.later) && (
            <div className="flex items-center gap-1.5" data-el-move>
              <button
                type="button"
                onClick={move.earlier ?? undefined}
                disabled={!move.earlier}
                className="h-7 cursor-pointer rounded-full border border-[rgba(255,255,255,0.12)] px-2.5 text-[11px] text-[#d6d9e0] hover:bg-[rgba(255,255,255,0.06)] disabled:cursor-default disabled:opacity-40"
              >
                ↑ {formatMsg(c.moveEarlier, { name: element.name })}
              </button>
              <button
                type="button"
                onClick={move.later ?? undefined}
                disabled={!move.later}
                className="h-7 cursor-pointer rounded-full border border-[rgba(255,255,255,0.12)] px-2.5 text-[11px] text-[#d6d9e0] hover:bg-[rgba(255,255,255,0.06)] disabled:cursor-default disabled:opacity-40"
              >
                ↓ {formatMsg(c.moveLater, { name: element.name })}
              </button>
            </div>
          )}
        </>
      )}
    </section>
  );
}
