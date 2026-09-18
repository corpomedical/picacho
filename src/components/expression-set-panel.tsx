"use client";

// The expression set on the character page (drawn as the Expression Set
// canvas, board 1, 2026-09-19): nine close-ups in three groups, each with
// its likeness against photo 1 and where it came from; the teeth marked as
// the ones every smile uses; a way to make the missing ones — teeth first,
// since the smile and the laugh are made from them — and to put the
// person's own photo in any slot. lib/characters/expression-set.ts is the
// model, expression-actions.ts does the work.

import { useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useLocale } from "@/lib/i18n/provider";
import { localizeServerText } from "@/lib/i18n/server-text";
import { formatMsg } from "@/lib/i18n/format";
import {
  EXPRESSION_BUILD_ORDER,
  EXPRESSION_SET_LIKENESS_FLOOR,
  EXPRESSION_SLOTS,
  EXPRESSION_SLOT_GROUPS,
  type ExpressionSlot,
} from "@/lib/characters/expression-set";
import { makeExpressionSlot, removeExpressionSlot, setExpressionSlotUpload } from "@/lib/characters/expression-actions";

export type ExpressionSlotView = {
  url: string;
  thumbUrl?: string;
  source: "made" | "upload";
  likeness: number | null;
  usable: boolean;
};

const SLOT_KEY: Record<ExpressionSlot, string> = {
  neutral: "slotNeutral",
  teeth: "slotTeeth",
  smile: "slotSmile",
  laugh: "slotLaugh",
  eyes: "slotEyes",
  "profile-left": "slotProfileLeft",
  "profile-right": "slotProfileRight",
  "three-quarter-left": "slotThreeQuarterLeft",
  "three-quarter-right": "slotThreeQuarterRight",
};
const GROUP_KEY = { expressions: "groupExpressions", details: "groupDetails", angles: "groupAngles" } as const;

const LABEL = "text-[10.5px] font-semibold uppercase tracking-[0.14em] text-atelier-muted";
const TEXT_BUTTON =
  "cursor-pointer rounded-[4px] text-left text-[11.5px] font-medium text-atelier-accent underline-offset-2 hover:underline disabled:cursor-default disabled:text-atelier-muted disabled:no-underline";

export function ExpressionSetPanel({
  characterId,
  userId,
  hasPhotos,
  initial,
}: {
  characterId: string;
  userId: string;
  hasPhotos: boolean;
  initial: Partial<Record<ExpressionSlot, ExpressionSlotView>>;
}) {
  const { t } = useLocale();
  const c = t.character.expressionSet;
  const [slots, setSlots] = useState(initial);
  const [busy, setBusy] = useState<{ slot: ExpressionSlot; kind: "make" | "upload" | "remove" } | null>(null);
  const [running, setRunning] = useState(false);
  const [note, setNote] = useState<{ kind: "error" | "done"; text: string } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const uploadFor = useRef<ExpressionSlot | null>(null);

  const name = (slot: ExpressionSlot) => (c as Record<string, string>)[SLOT_KEY[slot]] ?? slot;
  const filled = EXPRESSION_SLOTS.filter((s) => slots[s]);
  const missing = EXPRESSION_BUILD_ORDER.filter((s) => !slots[s]);
  const scored = filled.map((s) => slots[s]?.likeness).filter((x): x is number => typeof x === "number");
  const average = scored.length ? Math.round(scored.reduce((a, b) => a + b, 0) / scored.length) : null;
  const locked = busy !== null || running;

  async function makeOne(slot: ExpressionSlot): Promise<boolean> {
    setBusy({ slot, kind: "make" });
    try {
      const fd = new FormData();
      fd.set("character_id", characterId);
      fd.set("slot", slot);
      const result = await makeExpressionSlot(fd);
      if (result.error !== null) {
        setNote({ kind: "error", text: localizeServerText(result.error, t) });
        return false;
      }
      setSlots((prev) => ({ ...prev, [slot]: { url: result.url, source: result.source, likeness: result.likeness, usable: result.usable } }));
      return true;
    } catch {
      setNote({ kind: "error", text: t.character.connectionError });
      return false;
    } finally {
      setBusy(null);
    }
  }

  async function makeMissing() {
    if (locked || missing.length === 0) return;
    setRunning(true);
    setNote(null);
    let made = 0;
    // In the build order: the teeth before the smile and the laugh made from them.
    for (const slot of missing) {
      const ok = await makeOne(slot);
      if (!ok) {
        // Said as a stop, not a slot's own error: the rest were not made.
        setNote((prev) => (prev && prev.kind === "error" ? { kind: "error", text: formatMsg(c.stopped, { reason: prev.text }) } : prev));
        break;
      }
      made++;
    }
    setRunning(false);
    if (made === missing.length) setNote({ kind: "done", text: formatMsg(c.done, { count: String(made) }) });
  }

  async function remove(slot: ExpressionSlot) {
    if (locked) return;
    setBusy({ slot, kind: "remove" });
    setNote(null);
    try {
      const fd = new FormData();
      fd.set("character_id", characterId);
      fd.set("slot", slot);
      const result = await removeExpressionSlot(fd);
      if (result.error) {
        setNote({ kind: "error", text: localizeServerText(result.error, t) });
        return;
      }
      setSlots((prev) => {
        const next = { ...prev };
        delete next[slot];
        return next;
      });
    } catch {
      setNote({ kind: "error", text: t.character.connectionError });
    } finally {
      setBusy(null);
    }
  }

  function pickPhoto(slot: ExpressionSlot) {
    if (locked) return;
    uploadFor.current = slot;
    fileRef.current?.click();
  }

  async function onFile(file: File | undefined) {
    const slot = uploadFor.current;
    if (fileRef.current) fileRef.current.value = "";
    if (!file || !slot) return;
    setBusy({ slot, kind: "upload" });
    setNote(null);
    const supabase = createClient();
    // The same sanitize as every upload lane (character-form.tsx): storage
    // refuses keys outside its ASCII-safe set.
    const safe = file.name.replace(/[^a-zA-Z0-9._-]/g, "_").slice(-80);
    const path = `${userId}/face-${slot}-${crypto.randomUUID()}-${safe}`;
    try {
      const { error: uploadError } = await supabase.storage.from("character-references").upload(path, file);
      if (uploadError) throw uploadError;
      const fd = new FormData();
      fd.set("character_id", characterId);
      fd.set("slot", slot);
      fd.set("path", path);
      const result = await setExpressionSlotUpload(fd);
      if (result.error !== null) {
        setNote({ kind: "error", text: localizeServerText(result.error, t) });
        return;
      }
      setSlots((prev) => ({ ...prev, [slot]: { url: result.url, source: result.source, likeness: result.likeness, usable: result.usable } }));
    } catch {
      void supabase.storage.from("character-references").remove([path]);
      setNote({ kind: "error", text: t.character.connectionError });
    } finally {
      setBusy(null);
    }
  }

  if (!hasPhotos) {
    return (
      <section className="border-t border-atelier-rule pt-4" aria-labelledby="expression-set-title">
        <h2 id="expression-set-title" className={LABEL}>
          {c.title}
        </h2>
        <p className="mt-2 text-sm text-atelier-muted">{c.needsPhoto}</p>
      </section>
    );
  }

  return (
    <section className="flex flex-col gap-5 border-t border-atelier-rule pt-4" aria-labelledby="expression-set-title">
      <div className="flex items-center justify-between gap-4">
        <h2 id="expression-set-title" className={LABEL}>
          {c.title}
        </h2>
        <span className="text-xs text-atelier-muted">
          {average === null
            ? formatMsg(c.metaCount, { have: String(filled.length), total: String(EXPRESSION_SLOTS.length) })
            : formatMsg(c.metaAverage, { have: String(filled.length), total: String(EXPRESSION_SLOTS.length), average: String(average) })}
        </span>
      </div>

      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between sm:gap-8">
        <p className="max-w-[560px] text-sm leading-[21px] text-atelier-ink">{c.intro}</p>
        {missing.length > 0 && (
          <div className="flex flex-shrink-0 flex-col gap-1.5 sm:items-end">
            <button
              type="button"
              onClick={makeMissing}
              disabled={locked}
              className="min-h-11 cursor-pointer rounded-full bg-atelier-accent px-[18px] py-2.5 text-xs font-semibold text-atelier-paper transition-opacity hover:opacity-90 disabled:cursor-default disabled:opacity-60"
            >
              {missing.length === EXPRESSION_SLOTS.length
                ? c.makeAll
                : missing.length === 1
                  ? c.makeMissingOne
                  : formatMsg(c.makeMissingMany, { count: String(missing.length) })}
            </button>
            <span className="text-[11.5px] text-atelier-muted">{c.costLine}</span>
          </div>
        )}
      </div>

      {note && (
        <p role={note.kind === "error" ? "alert" : "status"} className={note.kind === "error" ? "text-sm text-red-600 dark:text-red-400" : "text-sm text-atelier-accent"}>
          {note.text}
        </p>
      )}
      {busy && (
        <p role="status" className="text-sm text-atelier-muted">
          {busy.kind === "upload" ? c.uploading : formatMsg(c.making, { slot: name(busy.slot) })}
        </p>
      )}

      <input
        ref={fileRef}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        className="sr-only"
        tabIndex={-1}
        aria-hidden
        onChange={(e) => void onFile(e.target.files?.[0])}
      />

      <div className="flex flex-col gap-6 sm:flex-row sm:flex-wrap sm:gap-x-8">
        {EXPRESSION_SLOT_GROUPS.map((group) => (
          <div key={group.id} className={group.id === "angles" ? "flex w-full flex-col gap-2.5" : "flex flex-col gap-2.5"}>
            <span className={LABEL}>{c[GROUP_KEY[group.id]]}</span>
            <div className="grid grid-cols-2 gap-3 sm:flex sm:flex-wrap sm:gap-4">
              {group.slots.map((slot) => {
                const view = slots[slot];
                const isBusy = busy?.slot === slot;
                const weak = view && view.likeness !== null && view.likeness < EXPRESSION_SET_LIKENESS_FLOOR;
                return (
                  <div key={slot} className="flex min-w-0 flex-col gap-1.5 sm:w-[184px]">
                    <div
                      className={
                        "relative aspect-square w-full overflow-hidden rounded-[12px] " +
                        (view
                          ? "bg-atelier-ink/5" + (slot === "teeth" ? " ring-2 ring-inset ring-atelier-accent" : "")
                          : "border border-dashed border-atelier-rule")
                      }
                    >
                      {view ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={view.thumbUrl ?? view.url} alt={name(slot)} className="h-full w-full object-cover" />
                      ) : (
                        <span className="flex h-full w-full items-center justify-center p-3 text-center text-xs text-atelier-muted">
                          {c.missing}
                        </span>
                      )}
                      {isBusy && (
                        <span className="absolute inset-0 flex items-center justify-center bg-black/45 text-xs font-medium text-onmedia">
                          …
                        </span>
                      )}
                    </div>
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="truncate text-[10.5px] font-semibold uppercase tracking-[0.1em] text-atelier-ink">{name(slot)}</span>
                      <span
                        className={"font-numeral text-[15px] font-semibold tabular-nums " + (view && !weak ? "text-atelier-accent" : "text-atelier-muted")}
                        aria-label={view?.likeness !== null && view?.likeness !== undefined ? `${c.likenessLabel} ${Math.round(view.likeness)}` : undefined}
                      >
                        {view?.likeness !== null && view?.likeness !== undefined ? Math.round(view.likeness) : "—"}
                      </span>
                    </div>
                    <span className={"text-[11.5px] leading-4 " + (weak ? "text-red-600 dark:text-red-400" : slot === "teeth" && view ? "text-atelier-accent" : "text-atelier-muted")}>
                      {!view
                        ? "\u00a0"
                        : weak
                          ? view.source === "upload"
                            ? c.weakUpload
                            : c.weakMade
                          : slot === "teeth"
                            ? c.teethNote
                            : view.likeness === null
                              ? c.unchecked
                              : view.source === "upload"
                                ? c.sourceUpload
                                : c.sourceMade}
                    </span>
                    <span className="flex flex-wrap gap-x-3 gap-y-1" aria-label={formatMsg(c.slotActions, { slot: name(slot) })}>
                      <button type="button" className={TEXT_BUTTON} disabled={locked} onClick={() => void makeOne(slot).then(() => undefined)}>
                        {view ? c.makeAgain : c.make}
                      </button>
                      <button type="button" className={TEXT_BUTTON} disabled={locked} onClick={() => pickPhoto(slot)}>
                        {view ? c.replaceWithMine : c.useMyPhoto}
                      </button>
                      {view && (
                        <button type="button" className={TEXT_BUTTON} disabled={locked} onClick={() => void remove(slot)}>
                          {c.remove}
                        </button>
                      )}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>

      <div className="rounded-[12px] border border-atelier-accent/25 bg-atelier-accent/[0.08] p-4 sm:max-w-[560px]">
        <p className="text-[13px] font-semibold text-atelier-ink">{c.realPersonTitle}</p>
        <p className="mt-1 text-[12.5px] leading-[18px] text-atelier-ink">{c.realPersonBody}</p>
      </div>
    </section>
  );
}
