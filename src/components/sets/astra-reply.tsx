"use client";

// Astra's reply in the set's chat (Helios Cut 2, "Astra understands", step
// 11b, 2026-09-25 — operator: "Run, keep going."). One turn's reply
// (turn-reply.ts composeReply) drawn as the spec's §5.1 lays it out, in
// its order, each part left out when empty: the answers and Astra's idea;
// what was Done (or what it would do, or what was undone) as ⌘K's own
// "group · value" pills, with Undo; what was already so; the notes; at most
// three "not yet" lines, each with where to do it now; what Needs your OK
// (the Astra card, "which one?", the take and a held shot, each at its
// price); the ways to try it, each with Do it and its priced second button;
// then anything cut or left out.
//
// MONEY IN WORDS (spec §3.8 rule 7, pin #8). A button that spends shows its
// price in credits: the label composeReply wrote carries it, and a paid
// button whose label does not say its own price is never drawn here
// (saysItsPrice) — the page's price check (set-view.tsx replyAction) then
// spends exactly that or nothing. A change to the set itself is pressed
// only on the Astra card (astra-change-card.tsx), which says the month's
// changes; this component draws the card the page hands it and never a
// button of its own for Astra.
//
// THE LAYOUT IS HIS PICK (his standing rule: 2–3 layouts drawn on the real
// page first). "stack" is the spec's §5.1 and the default; "sentences" is
// the reply as plain prose with its buttons after each line (the step-11a
// drawing); "boxed" puts each part in its own card. ASTRA_REPLY_LAYOUT picks
// one for everyone; the other two stay small so his choice is one word.
//
// Literal colours only (the Screening theme turns Tailwind's `white`
// near-black, 42b64bc), as the thread around it.

import type { ReactNode } from "react";
import type { Messages } from "@/lib/i18n/messages/en";
import { creditsLabel, type ReplyAction, type ReplyButton, type ReplyItems, type ReplyLine, type ReplyLineKind, type ReplyModel } from "@/lib/sets/turn-reply";

type Reply = Messages["sets"]["reply"];

export const REPLY_LAYOUTS = ["stack", "sentences", "boxed"] as const;
export type ReplyLayout = (typeof REPLY_LAYOUTS)[number];
/** The layout every reply is drawn in until the owner picks (Cut 2, step 11b): the spec's §5.1. */
export const ASTRA_REPLY_LAYOUT: ReplyLayout = "stack";

/** A button's price in credits; null for one that spends nothing (Do it, which-one, Undo…). */
export function buttonCredits(b: ReplyAction): number | null {
  switch (b.kind) {
    case "doItShoot":
    case "doItTake":
    case "take":
    case "shootAsIs":
    case "astraGoShoot":
      return b.credits;
    default:
      return null;
  }
}

/** Whether a button says what it spends: always for a free one; for a paid one, its own price is in its label. */
export function saysItsPrice(b: ReplyButton, copy: Pick<Reply, "creditOne" | "creditsN">): boolean {
  const n = buttonCredits(b);
  return n === null || b.label.includes(creditsLabel(copy, n));
}

/** The reply's parts, in its order (§5.1): a Needs line gathers the card, the which-one and the take's note after it. */
export type ReplySection = { kind: "said" | "notYet" | "needs" | "ways" | "after"; lines: ReplyLine[] };
const SECTION_OF: Record<Exclude<ReplyLineKind, "needs">, Exclude<ReplySection["kind"], "needs">> = {
  answer: "said",
  idea: "said",
  done: "said",
  planned: "said",
  undone: "said",
  shooting: "said",
  already: "said",
  note: "said",
  notYet: "notYet",
  notYetMore: "notYet",
  // Only ever after a Needs line (composeReply): they join it.
  astra: "said",
  which: "said",
  ways: "ways",
  way: "ways",
  cut: "after",
  dropped: "after",
  nothing: "after",
  down: "after",
  busy: "after",
};

export function replySections(lines: readonly ReplyLine[]): ReplySection[] {
  const out: ReplySection[] = [];
  for (const line of lines) {
    const last = out[out.length - 1];
    if (line.kind === "needs") {
      out.push({ kind: "needs", lines: [line] });
      continue;
    }
    // What a Needs line is waiting on follows it: the card, "which one?", the take's shape.
    if (last?.kind === "needs" && (line.kind === "astra" || line.kind === "which" || line.kind === "note")) {
      last.lines.push(line);
      continue;
    }
    const kind = SECTION_OF[line.kind];
    if (last && last.kind === kind) last.lines.push(line);
    else out.push({ kind, lines: [line] });
  }
  return out;
}

/**
 * The lines a turn's reply draws. An earlier turn keeps only what it did
 * (its Done, Undone or Here's what I'd do). An answered one — a press on
 * it, or a later message — loses what was waiting for a press: its Needs
 * part, the card and the which-one with it. The page asks the same
 * question before it draws the turn at all.
 */
export function shownLines(model: ReplyModel, at: { compact: boolean; open: boolean }): ReplyLine[] {
  if (at.compact) return model.lines.filter((l) => l.kind === "done" || l.kind === "undone" || l.kind === "planned").slice(0, 1);
  if (at.open) return model.lines;
  const out: ReplyLine[] = [];
  let needs = false;
  for (const l of model.lines) {
    if (l.kind === "needs") {
      needs = true;
      continue;
    }
    if (needs && (l.kind === "astra" || l.kind === "which" || l.kind === "note")) continue;
    needs = false;
    out.push(l);
  }
  return out;
}

const FREE_BUTTON =
  "inline-flex h-7 cursor-pointer items-center whitespace-nowrap rounded-full bg-[rgba(255,255,255,0.06)] px-2.5 text-[12px] font-medium text-[#e0a468] transition-colors hover:bg-[rgba(255,255,255,0.1)] disabled:cursor-default disabled:text-[#9aa0ad]";
const PAID_BUTTON =
  "inline-flex h-7 cursor-pointer items-center whitespace-nowrap rounded-full bg-[#e0a468] px-3 text-[12px] font-semibold text-[#1b1c20] transition-opacity hover:opacity-90 disabled:cursor-default disabled:bg-[#2a2b33] disabled:text-[#c6c9d1] disabled:opacity-100";
/** The prose layout's buttons: words after the line, a paid one heavier. */
const FREE_LINK = "ml-2 cursor-pointer font-medium text-[#e0a468] disabled:cursor-default disabled:text-[#9aa0ad]";
const PAID_LINK = "ml-2 cursor-pointer font-semibold text-[#f0cda6] underline underline-offset-2 disabled:cursor-default disabled:text-[#9aa0ad]";

/** The words before a line's pills, shown as its label: "Done", "Already so" (the template's own words, its colon dropped). */
function leadLabel(items: ReplyItems): string {
  const lead = items.lead.trim();
  return lead.endsWith(":") ? lead.slice(0, -1).trimEnd() : lead;
}
/** The words after them, when there are any beyond the full stop: "Nothing moves until you press." */
function tailWords(items: ReplyItems): string {
  let tail = items.tail.trim();
  while (tail.startsWith(".")) tail = tail.slice(1).trimStart();
  return tail;
}

export function AstraReply({
  model,
  copy,
  live,
  settled,
  busy,
  onAction,
  astraCard = null,
  following = null,
  compact = false,
  layout = ASTRA_REPLY_LAYOUT,
}: {
  model: ReplyModel;
  /** The reply's own words, for the price every paid button must say (creditOne / creditsN). */
  copy: Pick<Reply, "creditOne" | "creditsN">;
  /** The newest turn: its buttons act (the page's replyAction checks again). */
  live: boolean;
  /** Answered already: only Undo stays. */
  settled: boolean;
  /** A read, a shot or an Astra change is out: the buttons wait. */
  busy: boolean;
  onAction: (action: ReplyAction) => void;
  /** The Astra card for this turn's change, drawn where its line goes; null once answered. */
  astraCard?: ReactNode;
  /** Cut 1's line while a press is followed ("Still rendering — it will appear here."), said in place of the shot line. */
  following?: string | null;
  /** An earlier turn: only what it did, no buttons. */
  compact?: boolean;
  layout?: ReplyLayout;
}) {
  const lines = shownLines(model, { compact, open: live && !settled });
  const act = !compact && live;
  const buttonsOf = (line: ReplyLine): ReplyButton[] =>
    act ? line.buttons.filter((b) => (!settled || b.kind === "undo") && saysItsPrice(b, copy)) : [];
  const textOf = (line: ReplyLine) => (line.kind === "shooting" && following && live ? following : line.text);

  const button = (b: ReplyButton, i: number, prose: boolean) => {
    const credits = buttonCredits(b);
    return (
      <button
        key={i}
        type="button"
        onClick={() => onAction(b)}
        disabled={busy}
        data-reply-button={b.kind}
        data-credits={credits ?? undefined}
        className={prose ? (credits === null ? FREE_LINK : PAID_LINK) : credits === null ? FREE_BUTTON : PAID_BUTTON}
      >
        {b.label}
      </button>
    );
  };
  const buttonRow = (line: ReplyLine) => {
    const shown = buttonsOf(line);
    return shown.length > 0 ? <div className="flex flex-wrap items-center gap-1.5">{shown.map((b, i) => button(b, i, false))}</div> : null;
  };

  // "sentences": the reply as prose, each line's buttons after its words.
  if (layout === "sentences") {
    return (
      <div className="min-w-0 flex-1 space-y-1.5" data-astra-reply="sentences">
        {lines.map((line, i) =>
          line.kind === "astra" ? (
            astraCard ? <div key={i}>{astraCard}</div> : null
          ) : (
            <p key={i} className="text-sm leading-relaxed text-[#d6d9e0]" data-reply-line={line.kind}>
              {textOf(line)}
              {buttonsOf(line).map((b, j) => button(b, j, true))}
            </p>
          ),
        )}
      </div>
    );
  }

  const boxed = layout === "boxed";
  const pills = (line: ReplyLine, items: ReplyItems) => {
    const label = leadLabel(items);
    const tail = tailWords(items);
    const done = line.kind === "done" || line.kind === "undone";
    return (
      <div className="space-y-1.5" data-reply-line={line.kind}>
        <div className="flex flex-wrap items-center gap-1.5">
          {label && <span className="mr-0.5 text-[12px] font-medium text-[#9aa0ad]">{label}</span>}
          {items.chips.map((c, i) => (
            <span
              key={i}
              className={`inline-flex items-center rounded-full px-2.5 py-[3px] text-[12px] leading-4 ${
                done ? "bg-[rgba(224,164,104,0.12)] text-[#f0cda6]" : "bg-[rgba(255,255,255,0.07)] text-[#ecedf1]"
              }`}
              data-reply-chip
            >
              {c}
            </span>
          ))}
        </div>
        {tail && <p className="text-[12px] text-[#9aa0ad]">{tail}</p>}
        {buttonRow(line)}
      </div>
    );
  };
  const plain = (line: ReplyLine, tone: string) => (
    <div className="space-y-1.5" data-reply-line={line.kind}>
      <p className={tone}>{textOf(line)}</p>
      {buttonRow(line)}
    </div>
  );
  const drawLine = (line: ReplyLine, i: number): ReactNode => {
    let body: ReactNode;
    if (line.kind === "astra") body = astraCard;
    else if (line.items) body = pills(line, line.items);
    else if (line.kind === "idea") body = plain(line, "text-sm leading-relaxed text-[#f0cda6]");
    else if (line.kind === "shooting") body = plain(line, "text-[13px] font-medium text-[#f0cda6]");
    else if (line.kind === "answer") body = plain(line, "text-sm leading-relaxed text-[#d6d9e0]");
    else if (line.kind === "notYet" || line.kind === "note" || line.kind === "which") body = plain(line, "text-[13px] leading-relaxed text-[#c6c9d1]");
    else if (line.kind === "ways") body = plain(line, "text-[12px] font-medium text-[#9aa0ad]");
    else body = plain(line, "text-[12px] leading-relaxed text-[#9aa0ad]");
    return body ? <div key={i}>{body}</div> : null;
  };

  const sections = replySections(lines);
  return (
    <div className="min-w-0 flex-1 space-y-2.5" data-astra-reply={layout}>
      {sections.map((sec, i) => {
        if (sec.kind === "needs") {
          // Needs your OK: the heading, what it waits on, then the priced presses.
          const [head, ...rest] = sec.lines;
          const presses = buttonRow(head);
          const inner = rest.map(drawLine).filter(Boolean);
          if (!presses && inner.length === 0) return null;
          return (
            <div
              key={i}
              className={boxed || presses ? "space-y-2 rounded-[12px] bg-[rgba(224,164,104,0.06)] p-3 ring-1 ring-[rgba(240,196,142,0.3)]" : "space-y-2"}
              data-reply-section="needs"
            >
              <p className="text-[11px] font-medium uppercase tracking-[0.08em] text-[#f0cda6]" data-reply-line="needs">
                {head.text}
              </p>
              {inner}
              {presses}
            </div>
          );
        }
        const inner = sec.lines.map(drawLine).filter(Boolean);
        if (inner.length === 0) return null;
        const box =
          sec.kind === "ways"
            ? "space-y-2 rounded-[12px] bg-[rgba(255,255,255,0.04)] p-3"
            : boxed
              ? "space-y-2 rounded-[12px] bg-[rgba(255,255,255,0.04)] p-3 ring-1 ring-[rgba(255,255,255,0.06)]"
              : "space-y-2";
        return (
          <div key={i} className={box} data-reply-section={sec.kind}>
            {inner}
          </div>
        );
      })}
    </div>
  );
}
