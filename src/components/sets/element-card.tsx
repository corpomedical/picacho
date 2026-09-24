"use client";

// A thing's card (R1, 2026-09-21): what a tap on the stage opens. A car or
// an object shows its reference photos — up to four, the first its front —
// with a tile to add one (a file, a drop, a paste), and a line that says
// what the next still does with them. The figure shows who plays it; a wall
// or the track says it is the set itself. In the dock's Scene tab on a
// computer, a sheet over the stage on a phone. Literal colours only: the
// Screening theme turns Tailwind's `white` near-black (42b64bc).

import { useEffect, useRef, type ReactNode } from "react";
import { formatMsg } from "@/lib/i18n/format";
import type { Messages } from "@/lib/i18n/messages/en";
import type { ElementPhoto } from "@/lib/sets/elements";
import { ELEMENT_PHOTOS_MAX } from "@/lib/sets/elements";

type Cast = Messages["sets"]["cast"];

/** A chip on the card's drive row: lit while it is waiting for a tap on the ground. */
const DRIVE_CHIP = (on: boolean) =>
  `h-7 cursor-pointer rounded-full border px-2.5 text-[11px] ${
    on ? "border-[rgba(240,196,142,0.75)] bg-[rgba(224,164,104,0.12)] text-[#f0cda6]" : "border-[rgba(255,255,255,0.12)] text-[#d6d9e0] hover:bg-[rgba(255,255,255,0.06)]"
  }`;

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
  drive,
  model = null,
  rebuild = null,
  casting,
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
  /**
   * Where this thing goes in the beat being written (movers.ts,
   * 2026-09-23): the film's own track for a thing that MOVES. Null outside
   * a film, or with no beat picked. `can` false says the set cannot move
   * this one on its own (a block drawn many times over).
   */
  drive: {
    beat: number;
    can: boolean;
    /** Its move in words, or null when the beat leaves it where it is. */
    words: string | null;
    laying: "where" | "way" | null;
    onLay: () => void;
    onWay: () => void;
    onTurn: () => void;
    onClear: () => void;
  } | null;
  /**
   * A model file on this thing (thing-model.ts, 2026-09-24): the stage draws
   * it in place of the blocks. Null where it is not offered (admins only,
   * while our own model builder is proved).
   */
  model?: {
    name: string | null;
    state: "loading" | "ready" | "failed" | null;
    flipped: boolean;
    /** Whether it is kept with the set: being saved, saved, or only on this page. */
    kept?: "saving" | "saved" | "unsaved" | null;
    /** Why it could not be kept, already in words. */
    note?: string | null;
    onFile: (file: File) => void;
    onFlip: () => void;
    onRemove: () => void;
    /** Sides of the model its drawings paint (blueprint-paint.ts, 2026-09-24): 0 or missing when none fit. */
    painted?: number;
    /** Built here from its front photo (thing-build.ts, 2026-09-24): offered when it has one. */
    build?: { can: boolean; building: boolean; onBuild: () => void } | null;
  } | null;
  /**
   * Its blocks rebuilt from its photos by Astra (thing-rebuild.ts,
   * 2026-09-24). Null where it is not offered (admins only until the first
   * live rebuild is proved).
   */
  rebuild?: {
    /** Photos on the thing now: none, and the row says to add one. */
    photos: number;
    working: boolean;
    /** Anything else keeping Astra busy (an edit of the set, a shot being read). */
    held: boolean;
    /** What the last rebuild said, already in words: done, or why not. */
    note: { text: string; ok: boolean } | null;
    onRebuild: () => void;
    /** Put the old blocks back: the Astra edit's own Undo, while it is still the last change. */
    onUndo: (() => void) | null;
  } | null;
  /**
   * The figure's card (R1, "Who plays this person?"): the person's
   * characters to cast, the one cast now, a new one (saved arrangement
   * first, then the character form, which comes back here), and a line for
   * a film, which stays the opening still's person.
   */
  casting?: {
    options: { id: string; name: string; thumbUrl: string | null; note?: string | null }[];
    current: string;
    onPick: (id: string) => void;
    onNew: () => void;
    newHref: string;
    editHref: string | null;
    filmNote: string | null;
    /** Below the list: anything the chosen character still needs (the likeness answer, R1.12). */
    extra?: ReactNode;
  } | null;
  c: Cast;
  variant: "dock" | "sheet";
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const modelFileRef = useRef<HTMLInputElement>(null);
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

      {element.kind === "figure" && casting && (
        <div className="flex flex-col gap-1.5" data-el-cast>
          <p className="text-[10px] font-semibold uppercase tracking-[0.07em] text-[#9aa0ad]">{c.whoPlays}</p>
          <div role="radiogroup" aria-label={c.whoPlays} className="flex flex-col gap-0.5">
            {casting.options.map((o) => (
              <button
                key={o.id}
                type="button"
                role="radio"
                aria-checked={o.id === casting.current}
                onClick={() => casting.onPick(o.id)}
                data-el-cast-option={o.id}
                className={`flex h-10 cursor-pointer items-center gap-2.5 rounded-[8px] px-2 text-left text-[12.5px] ${
                  o.id === casting.current ? "bg-[rgba(255,255,255,0.08)] text-[#ecedf1]" : "text-[#c6c9d1] hover:bg-[rgba(255,255,255,0.05)]"
                }`}
              >
                {o.thumbUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element -- a private media thumbnail, like the filmstrip's
                  <img src={o.thumbUrl} alt="" className="h-7 w-7 flex-none rounded-full object-cover" />
                ) : (
                  <span className="h-7 w-7 flex-none rounded-full bg-[#2a2c33]" aria-hidden />
                )}
                <span className="min-w-0 flex-1 truncate">{o.name}</span>
                {o.note && <span className="whitespace-nowrap text-[10.5px] text-[#e0a468]">{o.note}</span>}
                {o.id === casting.current && <span aria-hidden>✓</span>}
              </button>
            ))}
          </div>
          {casting.extra}
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 pt-0.5">
            <a
              href={casting.newHref}
              onClick={(e) => {
                e.preventDefault();
                casting.onNew();
              }}
              data-el-new-character
              className="text-[12px] font-medium text-[#e0a468] hover:text-[#f0cda6]"
            >
              {c.newCharacter}
            </a>
            {casting.editHref && person && (
              <a href={casting.editHref} className="text-[12px] text-[#c6c9d1] underline underline-offset-2 hover:text-[#ecedf1]">
                {formatMsg(c.editCharacter, { name: person.name })}
              </a>
            )}
          </div>
          <p className="text-[11px] leading-snug text-[#9aa0ad]">{c.personPhotos}</p>
          {casting.filmNote && <p className="text-[11px] leading-snug text-[#e0a468]">{casting.filmNote}</p>}
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
                  className="absolute -right-1.5 -top-1.5 flex h-5 w-5 cursor-pointer items-center justify-center rounded-full border border-[rgba(255,255,255,0.15)] bg-[#1d1e24] text-[12px] leading-none text-[#d6d9e0] hover:text-[#ecedf1] disabled:cursor-default disabled:text-[#6b6f7a]"
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
                className="flex h-16 w-16 flex-none cursor-pointer items-center justify-center rounded-[8px] border border-dashed border-[rgba(214,217,224,0.35)] px-1 text-center text-[11px] leading-tight text-[#d6d9e0] hover:bg-[rgba(255,255,255,0.05)] disabled:cursor-default disabled:text-[#9aa0ad]"
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
          {rebuild && (
            <div className="flex flex-wrap items-center gap-1.5 border-t border-[rgba(255,255,255,0.07)] pt-2" data-el-rebuild>
              <span className="text-[10px] font-semibold uppercase tracking-[0.07em] text-[#9aa0ad]">{c.rebuildTitle}</span>
              <p className="w-full text-[11px] leading-snug text-[#c6c9d1]" data-el-rebuild-hint>
                {rebuild.working ? c.rebuildWorking : rebuild.photos > 0 ? c.rebuildHint : c.rebuildNeedsPhoto}
              </p>
              {rebuild.note && !rebuild.working && (
                <p className={`w-full text-[11px] leading-snug ${rebuild.note.ok ? "text-[#8fcf9a]" : "text-[#e0a468]"}`} data-el-rebuild-note={rebuild.note.ok ? "done" : "not"}>
                  {rebuild.note.text}
                  {rebuild.onUndo && (
                    <>
                      {" · "}
                      <button type="button" onClick={rebuild.onUndo} data-el-rebuild-undo className="cursor-pointer font-medium text-[#e0a468] hover:text-[#f0cda6]">
                        {c.rebuildUndo}
                      </button>
                    </>
                  )}
                </p>
              )}
              {rebuild.photos > 0 && (
                <button
                  type="button"
                  onClick={rebuild.onRebuild}
                  disabled={rebuild.working || rebuild.held || busy}
                  data-el-rebuild-go
                  className={`${DRIVE_CHIP(rebuild.working)} disabled:cursor-default disabled:opacity-60`}
                >
                  {c.rebuildButton}
                </button>
              )}
            </div>
          )}
          {model && (
            <div className="flex flex-wrap items-center gap-1.5 border-t border-[rgba(255,255,255,0.07)] pt-2" data-el-model>
              <span className="text-[10px] font-semibold uppercase tracking-[0.07em] text-[#9aa0ad]">{c.modelTitle}</span>
              <span
                className={`text-[11px] ${model.state === "failed" ? "text-[#f08c8c]" : model.state === "ready" ? "text-[#8fcf9a]" : "text-[#c6c9d1]"}`}
                data-el-model-state={model.state ?? "none"}
              >
                {model.build?.building
                  ? c.modelBuilding
                  : model.state === "loading"
                    ? c.modelLoading
                    : model.state === "failed"
                      ? c.modelFailed
                      : model.state === "ready" && model.name
                        ? formatMsg(c.modelReady, { name: model.name })
                        : model.build?.can
                          ? c.modelBuildHint
                          : c.modelHint}
              </span>
              {model.kept && model.state !== "failed" && (
                <span
                  className={`text-[11px] ${model.kept === "unsaved" ? "text-[#e0a468]" : model.kept === "saved" ? "text-[#9aa0ad]" : "text-[#c6c9d1]"}`}
                  data-el-model-kept={model.kept}
                  title={model.note ?? undefined}
                >
                  · {model.kept === "saving" ? c.modelSaving : model.kept === "saved" ? c.modelSaved : c.modelUnsaved}
                </span>
              )}
              {model.state === "ready" && (model.painted ?? 0) > 0 && (
                <p className="w-full text-[11px] leading-snug text-[#8fcf9a]" data-el-model-painted={model.painted}>
                  {model.painted === 1 ? c.modelPaintedOne : formatMsg(c.modelPainted, { n: model.painted ?? 0 })}
                </p>
              )}
              {model.note && <p className="w-full text-[11px] leading-snug text-[#e0a468]">{model.note}</p>}
              <input
                ref={modelFileRef}
                type="file"
                accept=".glb,model/gltf-binary"
                className="hidden"
                data-el-model-input
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  e.target.value = "";
                  if (file) model.onFile(file);
                }}
              />
              {model.build?.can && (
                <button
                  type="button"
                  onClick={model.build.onBuild}
                  disabled={model.build.building || model.state === "loading"}
                  data-el-model-build
                  className={`${DRIVE_CHIP(model.build.building)} disabled:cursor-default disabled:opacity-60`}
                >
                  {c.modelBuild}
                </button>
              )}
              <button type="button" onClick={() => modelFileRef.current?.click()} disabled={model.state === "loading" || model.build?.building} data-el-model-file className={DRIVE_CHIP(false)}>
                {c.modelLoad}
              </button>
              {model.state === "ready" && (
                <>
                  <button type="button" onClick={model.onFlip} disabled={model.kept === "saving"} data-el-model-flip className={DRIVE_CHIP(model.flipped)}>
                    {c.modelFlip}
                  </button>
                  <button type="button" onClick={model.onRemove} data-el-model-remove className={DRIVE_CHIP(false)}>
                    {c.modelRemove}
                  </button>
                </>
              )}
            </div>
          )}
          {drive && (
            <div className="flex flex-wrap items-center gap-1.5 border-t border-[rgba(255,255,255,0.07)] pt-2" data-el-drive>
              <span className="text-[10px] font-semibold uppercase tracking-[0.07em] text-[#9aa0ad]">{formatMsg(c.driveTitle, { n: drive.beat })}</span>
              {!drive.can ? (
                <p className="text-[11px] leading-snug text-[#9aa0ad]" data-el-drive-cannot>
                  {c.driveCannot}
                </p>
              ) : (
                <>
                  {drive.words && <span className="text-[11px] text-[#f0cda6]">{drive.words}</span>}
                  <button type="button" onClick={drive.onLay} data-el-drive-lay className={DRIVE_CHIP(drive.laying === "where")}>
                    {drive.laying === "where" ? c.driveLaying : c.driveLay}
                  </button>
                  {drive.words && (
                    <>
                      <button type="button" onClick={drive.onTurn} data-el-drive-turn className={DRIVE_CHIP(false)}>
                        {c.driveTurn}
                      </button>
                      <button type="button" onClick={drive.onWay} data-el-drive-way className={DRIVE_CHIP(drive.laying === "way")}>
                        {drive.laying === "way" ? c.driveWayLaying : c.driveWay}
                      </button>
                      <button type="button" onClick={drive.onClear} data-el-drive-clear className={DRIVE_CHIP(false)}>
                        {c.driveClear}
                      </button>
                    </>
                  )}
                </>
              )}
            </div>
          )}
          {move && (move.earlier || move.later) && (
            <div className="flex items-center gap-1.5" data-el-move>
              <button
                type="button"
                onClick={move.earlier ?? undefined}
                disabled={!move.earlier}
                className="h-7 cursor-pointer rounded-full border border-[rgba(255,255,255,0.12)] px-2.5 text-[11px] text-[#d6d9e0] hover:bg-[rgba(255,255,255,0.06)] disabled:cursor-default disabled:border-[rgba(255,255,255,0.06)] disabled:text-[#6b6f7a]"
              >
                ↑ {formatMsg(c.moveEarlier, { name: element.name })}
              </button>
              <button
                type="button"
                onClick={move.later ?? undefined}
                disabled={!move.later}
                className="h-7 cursor-pointer rounded-full border border-[rgba(255,255,255,0.12)] px-2.5 text-[11px] text-[#d6d9e0] hover:bg-[rgba(255,255,255,0.06)] disabled:cursor-default disabled:border-[rgba(255,255,255,0.06)] disabled:text-[#6b6f7a]"
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
