"use client";

// The Astra card (Helios Cut 2, 2026-09-25 — operator: "Run, keep going."):
// a change to the set itself, asked in the conversation, waits here for a
// press. It quotes exactly the words Astra will read, says what it uses of
// the month (counted only if it saves, Cut 1) and that it takes a minute,
// and has no button when nothing could come of the press: no changes left,
// a plan with none, or a set too big for Astra to answer whole. Every mode,
// every account, admins included (the owner's decision 1); the wording is
// astra-card.ts's. Literal colours only (the Screening theme turns
// Tailwind's `white` near-black, 42b64bc), as the thread around it.

import { formatMsg } from "@/lib/i18n/format";
import type { Messages } from "@/lib/i18n/messages/en";
import { astraCardCanGo, astraCardKind, astraCardWords } from "@/lib/sets/astra-card";
import { SET_EDIT_MAX_CHARS } from "@/lib/sets/set-config";

type Reply = Messages["sets"]["reply"];

/** A price in credits, as every priced button in the reply says it. */
export function creditsWord(copy: Pick<Reply, "creditOne" | "creditsN">, n: number): string {
  return n === 1 ? copy.creditOne : formatMsg(copy.creditsN, { n });
}

export function AstraChangeCard({
  words,
  editsLeft,
  editsCap,
  tooBig,
  busy,
  shootCredits,
  onGo,
  onGoShoot,
  onNotNow,
  copy,
  buildLabel,
}: {
  /** The person's own words asking for the change: quoted as Astra will read them. */
  words: string;
  /** The month's changes left; null for no cap (admins) or a count that could not be read. */
  editsLeft: number | null;
  /** The plan's changes a month (set-config.ts setEditsMonthlyLimit): −1 for no cap. */
  editsCap: number;
  /** The working copy is past what Astra can answer whole (astra-card.ts astraTooBig). */
  tooBig: boolean;
  /** Something else is in flight: the buttons wait. */
  busy: boolean;
  /** The still's price, for "Change it, then shoot"; null offers no such button. */
  shootCredits: number | null;
  onGo: () => void;
  /** "Change it, then shoot": offered only with a price and this handler. */
  onGoShoot?: () => void;
  onNotNow: () => void;
  copy: Reply;
  /** The Build editor's own name, in the person's language (sets.editorOpen). */
  buildLabel: string;
}) {
  const kind = astraCardKind({ editsLeft, editsCap, tooBig });
  // The person's words go in last (formatMsg fills in order), so a "{n}" they
  // typed is never taken for a number.
  const { quoted, cut } = astraCardWords(words);
  const line =
    kind === "none"
      ? formatMsg(copy.astraNone, { build: buildLabel, words: quoted })
      : kind === "tooBig"
        ? formatMsg(copy.astraTooBig, { build: buildLabel, words: quoted })
        : kind === "askOpen"
          ? formatMsg(copy.astraAskOpen, { words: quoted })
          : kind === "askUnknown"
            ? formatMsg(copy.astraAskUnknown, { cap: editsCap, words: quoted })
            : kind === "askLast"
              ? formatMsg(copy.astraAskLast, { words: quoted })
              : formatMsg(copy.astraAsk, { n: editsLeft ?? 0, words: quoted });
  const canGo = astraCardCanGo(kind);
  return (
    <div className="space-y-2.5 rounded-[14px] bg-[rgba(255,255,255,0.05)] p-3.5 ring-1 ring-[rgba(240,196,142,0.3)]" data-astra-card={kind}>
      <p className="text-sm leading-relaxed text-[#d6d9e0]">{line}</p>
      {cut && <p className="text-xs text-[#c6c9d1]">{formatMsg(copy.replyCutMessage, { n: SET_EDIT_MAX_CHARS })}</p>}
      <div className="flex flex-wrap items-center gap-2">
        {canGo && (
          <button
            type="button"
            onClick={onGo}
            disabled={busy}
            data-astra-go
            className="inline-flex h-9 cursor-pointer items-center justify-center rounded-[8px] bg-[#e0a468] px-4 text-sm font-semibold text-[#1b1c20] transition-opacity hover:opacity-90 disabled:bg-[#2a2b33] disabled:text-[#c6c9d1] disabled:opacity-100"
          >
            {copy.astraGo}
          </button>
        )}
        {canGo && onGoShoot && shootCredits !== null && (
          <button
            type="button"
            onClick={onGoShoot}
            disabled={busy}
            data-astra-go-shoot
            className="inline-flex h-9 cursor-pointer items-center justify-center rounded-[8px] bg-[rgba(255,255,255,0.06)] px-4 text-sm font-medium text-[#ecedf1] shadow-[inset_0_0_0_1px_rgba(255,255,255,0.1)] transition-colors hover:bg-[rgba(255,255,255,0.1)] disabled:text-[#9aa0ad]"
          >
            {formatMsg(copy.astraGoShoot, { credits: creditsWord(copy, shootCredits) })}
          </button>
        )}
        <button
          type="button"
          onClick={onNotNow}
          data-astra-not-now
          className="inline-flex h-9 cursor-pointer items-center justify-center rounded-[8px] px-3 text-sm font-medium text-[#c6c9d1] transition-colors hover:text-[#ecedf1]"
        >
          {copy.notNow}
        </button>
      </div>
    </div>
  );
}
