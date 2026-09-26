"use client";

import { useId, useMemo, useState, type CSSProperties, type ReactNode } from "react";
import type { Messages } from "@/lib/i18n/messages/en";
import { formatMsg } from "@/lib/i18n/format";
import { localizeServerText } from "@/lib/i18n/server-text";
import type { MomentDetail, ShotView, StillView, TakeView, Verdict } from "@/lib/press-tour/campaign-types";
import { CUT_LAST_SHOT, REFILM_LIMIT } from "@/lib/press-tour/film-messages";
import {
  clockTenths,
  firstDecisionShot,
  isMiss,
  letterRow,
  shotBusy,
  shotMisses,
  shotsInCut,
  shownTake,
  singleSwap,
  wallMoments,
  wallTally,
  worstMoment,
  type WallMoment,
} from "@/lib/press-tour/door-view";
import { cn } from "@/lib/cn";
import { CheckIcon, InfoIcon, PlayIcon, RefreshIcon, ScissorsIcon } from "./icons";
import { MomentFrame } from "./moment-frame";
import { roleName } from "./running-order";
import { Glyph, VerdictInline, verdictWord, type PressWords } from "./verdict";
import s from "./press-tour.module.css";

// THE PRESS WALL (Cut 4 UI, design A's lock-desktop and wall-phone
// artboards): after filming, every shot's take is read at a few moments,
// and every moment goes up on the wall as a print with its verdict stamp —
// the fixed words and shapes (a hatched square for Not readable, the red
// square only for Didn't match), the flashbulb only on a print that
// matched. The worst moment leads: its "Why moment N missed" says what was
// read and what the card says, letter by letter and part by part when the
// record holds both readings, and only its reason when it doesn't.
//
// Nothing is decided for the person (operator, 2026-09-26: no re-shoot and
// no refund for a miss before the checker is calibrated). A shot that
// missed waits for one of three presses: Keep take N (free), Re-film shot N
// at that shot's own film price (the contract's refilmCredits, printed as
// it came), or Cut this shot (free). The check can be wrong, so every
// moment stays up to judge, and blur never counts as a miss.
//
// Touch sizes: the phone's wall (below lg) keeps 44 px keys; the computer's
// tightens a little, as the running order does.

export type WallActions = {
  keep: (shot: number, take: number) => void;
  refilm: (shot: number, note: string) => void;
  cut: (shot: number) => void;
};

/** What "Why moment N missed" holds up against the moment: the product's own card. */
export type WallProduct = {
  /** The front photo (a short-lived signed link), or null. */
  photo: string | null;
  /** The card's shape words, logo marks and colours (the product read, as confirmed). */
  shape: string[];
  marks: string[];
  palette: string[];
};

type WallProps = {
  shots: ShotView[];
  stills: StillView[];
  /** Presses are open: the ad waits on the person and nothing else is in flight. */
  canAct: boolean;
  /** The shot whose press is in flight. */
  busyShot: number | null;
  act: WallActions;
  t: Messages;
  product: WallProduct | null;
  /** The key under the decision (Make the cut), with what blocks it. */
  keySlot?: ReactNode;
  /** The wall alone, to look at: no decision (the ad is being cut, or is ready). */
  readOnly?: boolean;
};

const LABEL = "font-slate text-[11px] font-medium uppercase tracking-[0.12em] text-[#858994]";
const GHOST =
  "inline-flex min-h-11 w-full items-center justify-center gap-1.5 rounded-xl px-3 text-[13.5px] font-medium text-[#ecedf1] ring-1 ring-inset ring-[rgba(255,255,255,0.16)] hover:bg-[rgba(255,255,255,0.04)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#f0cda6] disabled:opacity-50";
const QUIET =
  "inline-flex min-h-11 items-center gap-1.5 text-[12.5px] text-[#9aa0ad] underline decoration-[rgba(255,255,255,0.2)] underline-offset-[3px] hover:text-[#ecedf1] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#f0cda6] disabled:opacity-50 lg:min-h-8";

/** A template with named slots filled by nodes ("Moment {n} reads {read}."). */
function fill(template: string, slots: Record<string, ReactNode>): ReactNode[] {
  return template.split(/(\{\w+\})/g).map((part, i) => {
    const m = part.match(/^\{(\w+)\}$/);
    return m && m[1] in slots ? <span key={i}>{slots[m[1]]}</span> : part;
  });
}

/** Everything both walls read: the moments of the takes shown, the worst, the shot that waits. */
function useWall(shots: ShotView[], stills: StillView[]) {
  const [picked, setPicked] = useState<Record<number, number>>({});
  const [selected, setSelected] = useState<string | null>(null);
  const starts = useMemo(() => Object.fromEntries(stills.map((x) => [x.shot, x.span[0]])) as Record<number, number>, [stills]);
  const moments = useMemo(() => wallMoments(shots, starts, picked), [shots, starts, picked]);
  const worst = worstMoment(moments);
  const shown = moments.find((x) => x.key === selected) ?? worst ?? null;
  const waiting = firstDecisionShot(shots);
  // The shot the decision is about: the shown moment's, when it waits; else the first that waits.
  const shownShot = shown ? shots.find((x) => x.shot === shown.shot) ?? null : null;
  const decide = shownShot && shownShot.needsDecision ? shownShot : waiting;
  const stillOf = (shot: number) => stills.find((x) => x.shot === shot)?.imageUrl ?? null;
  const takeOf = (shot: ShotView) => shownTake(shot, picked[shot.shot] ?? null);
  return {
    moments,
    worst,
    shown,
    decide,
    stillOf,
    takeOf,
    select: (key: string) => setSelected(key),
    pickTake: (shot: number, take: number) => {
      setPicked((prev) => ({ ...prev, [shot]: take }));
      setSelected(null);
    },
  };
}

/** The tally over the wall: how many moments read each word. */
function Tally({ moments, m, big }: { moments: WallMoment[]; m: PressWords; big?: boolean }) {
  const tally = wallTally(moments);
  if (tally.length === 0) return null;
  return (
    <p className="flex flex-wrap gap-x-4 gap-y-1">
      {tally.map(({ verdict, count }) => (
        <span key={verdict} className={cn(s.vd, verdict === "match" && s.vdMatch, verdict === "didnt_match" && s.vdMiss, "items-baseline text-[12.5px]")}>
          <Glyph v={verdict} />
          <b className={cn("font-numeral font-medium tabular-nums", big ? "text-[16px]" : "text-[15px]")}>{count}</b>
          <span>{verdictWord(verdict, m)}</span>
        </span>
      ))}
    </p>
  );
}

/** "Face · Match" beside a shot's name; a packshot says "No one in this shot". */
function FaceWord({ v, m }: { v: Verdict; m: PressWords }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-[11.5px] text-[#858994]">
      {v !== "no_one_in_shot" && m.face}
      <VerdictInline v={v} m={m} />
    </span>
  );
}

/** The takes of a shot that was filmed again: the person looks at each before keeping one. */
function TakeTabs({ shot, shown, onPick, m }: { shot: ShotView; shown: TakeView | null; onPick: (take: number) => void; m: PressWords }) {
  if (shot.takes.length < 2) return null;
  return (
    <div role="group" aria-label={formatMsg(m.takesOf, { n: shot.shot })} className="mb-2 flex flex-wrap gap-1.5">
      {shot.takes.map((tk) => (
        <button
          key={tk.take}
          type="button"
          onClick={() => onPick(tk.take)}
          aria-pressed={shown?.take === tk.take}
          className={cn(
            "inline-flex min-h-9 items-center gap-1.5 rounded-full px-3 text-[12px] font-medium ring-1 ring-inset focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#f0cda6]",
            shown?.take === tk.take ? "bg-[rgba(255,255,255,0.07)] text-[#ecedf1] ring-[rgba(240,196,142,0.6)]" : "text-[#9aa0ad] ring-[rgba(255,255,255,0.14)]",
          )}
        >
          {formatMsg(m.takeN, { n: tk.take })}
          {shot.chosenTake === tk.take && shot.decision === "kept" && <CheckIcon className="h-3 w-3 text-[#e0a468]" />}
        </button>
      ))}
    </div>
  );
}

/** A take we are still filming or reading, or one that didn't come through: its still stands in. */
function TakePending({ take, still, m, className }: { take: TakeView | null; still: string | null; m: PressWords; className?: string }) {
  const failed = take?.state === "failed";
  const word = !take || take.state === "filming" ? m.takeFilming : take.state === "checking" ? m.takeChecking : m.takeFailed;
  return (
    <div className={cn(s.print, "relative grid place-items-center rounded-lg", !failed && s.painting, className)}>
      {still && (
        <>
          {/* The whole still, upright as it was approved, over a soft wash of itself: a wide tile cropping a 9:16 still reads as a stranger's close-up. */}
          {/* eslint-disable-next-line @next/next/no-img-element -- a short-lived signed link to the person's own still */}
          <img src={still} alt="" className="absolute inset-0 h-full w-full scale-110 object-cover opacity-25 blur-md" />
          <span className="absolute inset-y-[9%] left-1/2 aspect-[9/16] -translate-x-1/2 overflow-hidden rounded-[6px] opacity-60 shadow-[0_0_0_1px_rgba(255,255,255,0.12)]">
            {/* eslint-disable-next-line @next/next/no-img-element -- a short-lived signed link to the person's own still */}
            <img src={still} alt="" className="block h-full w-full object-cover" />
          </span>
        </>
      )}
      <span className="relative z-[1] rounded-full bg-[rgba(10,9,8,0.78)] px-2.5 py-1 text-[11.5px] font-medium text-[#d3d6dd] shadow-[inset_0_0_0_1px_rgba(255,255,255,0.2)]">
        {word}
      </span>
    </div>
  );
}

/** One moment's print: the take held at that second, its stamp, the flash when it matched. */
function MomentPrint({
  x,
  take,
  still,
  worst,
  selected,
  onSelect,
  order,
  m,
  small,
}: {
  x: WallMoment;
  take: TakeView;
  still: string | null;
  worst: boolean;
  selected: boolean;
  onSelect: () => void;
  order: number;
  m: PressWords;
  small?: boolean;
}) {
  const matched = x.verdict === "match";
  const label = formatMsg(m.momentAlt, { n: x.index, at: clockTenths(x.at), verdict: verdictWord(x.verdict, m) });
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      aria-label={label}
      className="block w-full rounded-lg text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#f0cda6]"
    >
      <span
        className={cn(
          s.print,
          s.moment,
          "block",
          small ? "h-[62px] rounded-[5px]" : "aspect-[80/142] rounded-lg",
          matched && s.flash,
          x.verdict === "not_readable" && s.momentUnread,
          worst && s.printMiss,
          selected && !worst && s.momentOn,
        )}
        style={{ ["--flash-at" as string]: `${600 + order * 180}ms` } as CSSProperties}
      >
        <MomentFrame videoUrl={take.videoUrl} at={x.atTake} still={still} label={null} />
        <span className={cn(s.badge, small && s.badgeSm, matched && s.land)} aria-hidden="true">
          <Glyph v={x.verdict} />
        </span>
        {worst && !small && <span className={s.worstTagMiss}>{m.worstTag}</span>}
      </span>
    </button>
  );
}

/** The letter row: what was read, letter by letter, the label's letter under each one that differs. */
function Letters({ detail, m, small }: { detail: MomentDetail; m: PressWords; small?: boolean }) {
  const row = letterRow(detail.read, detail.expected);
  if (!row) return null;
  const swap = singleSwap(row);
  return (
    <div>
      <div role="img" aria-label={formatMsg(m.lettersAria, { read: detail.read, expected: detail.expected })} className="flex flex-wrap gap-1">
        {row.cells.map((c, i) => (
          <span key={i} className={cn(s.letter, small && s.letterSm, c.want !== null && s.letterMiss)}>
            {c.read === " " ? " " : c.read || " "}
            {c.want !== null && <i className={s.letterWant}>{c.want === "" ? "–" : c.want === " " ? " " : c.want}</i>}
          </span>
        ))}
      </div>
      <p className={cn("text-[11.5px] leading-[1.4] text-[#9aa0ad]", small ? "mt-[22px]" : "mt-[26px]")}>
        {swap
          ? fill(m.letterSwap, { n: swap.at, want: <b className="font-medium text-[#f0cda6]">{swap.want}</b> })
          : row.wrong === 1
            ? m.letterOneDiffers
            : formatMsg(m.lettersDiffer, { n: row.wrong })}
      </p>
    </div>
  );
}

/** What the second reading saw of one part, in the moment's column. */
function partWords(v: Verdict, m: PressWords): string {
  return v === "match" ? m.partSame : v === "didnt_match" ? m.partDifferent : m.partUnseen;
}

/** The headline of "Why moment N missed": what was read against what the label says, or the reason alone. */
function whyHeadline(x: WallMoment, m: PressWords, t: Messages): ReactNode {
  const d = x.moment.detail;
  if (d && x.moment.product === "didnt_match") {
    return fill(m.whyReads, {
      n: x.index,
      read: <span className={cn("font-slate font-medium tracking-[0.04em]", s.inkMiss)}>{d.read}</span>,
      expected: <span className="font-slate font-medium tracking-[0.04em]">{d.expected}</span>,
    });
  }
  if (x.moment.reason) return localizeServerText(x.moment.reason, t);
  switch (x.verdict) {
    case "match":
      return m.whyMatch;
    case "not_readable":
      return m.whyUnreadable;
    case "not_checked":
      return m.whyNotChecked;
    default:
      return verdictWord(x.verdict, m);
  }
}

/** The four rows: the card's label, logo, shape and colours against the moment's. */
function PartsTable({ x, product, m }: { x: WallMoment; product: WallProduct | null; m: PressWords }) {
  const d = x.moment.detail;
  if (!d) return null;
  const rows: { key: string; name: string; card: ReactNode; seen: ReactNode; v: Verdict; mono?: boolean }[] = [
    { key: "label", name: m.partLabel, card: d.expected, seen: d.read, v: d.label, mono: true },
    { key: "logo", name: m.logoTag, card: product?.marks[0] || m.cardLogo, seen: partWords(d.logo, m), v: d.logo },
    { key: "shape", name: m.partShape, card: product && product.shape.length > 0 ? product.shape.slice(0, 3).join(" · ") : m.cardShape, seen: partWords(d.shape, m), v: d.shape },
    {
      key: "colour",
      name: m.partColour,
      card:
        product && product.palette.length > 0 ? (
          <span className="inline-flex items-center gap-1.5">
            <span className="inline-flex gap-[3px]" aria-hidden="true">
              {product.palette.slice(0, 4).map((hex) => (
                <i key={hex} className="h-2.5 w-2.5 rounded-[3px] ring-1 ring-inset ring-[rgba(255,255,255,0.2)]" style={{ backgroundColor: hex }} />
              ))}
            </span>
            {formatMsg(m.nColours, { n: product.palette.length })}
          </span>
        ) : (
          m.cardColours
        ),
      seen: partWords(d.colour, m),
      v: d.colour,
    },
  ];
  return (
    <table className="mt-3 w-full border-collapse text-left">
      <thead>
        <tr>
          <th scope="col" className="pb-1.5 pr-2 font-slate text-[11px] font-normal uppercase tracking-[0.1em] text-[#858994]">
            {m.partCheck}
          </th>
          <th scope="col" className="pb-1.5 pr-2 font-slate text-[11px] font-normal uppercase tracking-[0.1em] text-[#858994]">
            {m.partCard}
          </th>
          <th scope="col" className="pb-1.5 pr-2 font-slate text-[11px] font-normal uppercase tracking-[0.1em] text-[#858994]">
            {formatMsg(m.momentAt, { n: x.index, at: clockTenths(x.at) })}
          </th>
          <th scope="col" className="pb-1.5 font-slate text-[11px] font-normal uppercase tracking-[0.1em] text-[#858994]">
            {m.partVerdict}
          </th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.key} className="shadow-[inset_0_1px_0_rgba(255,255,255,0.06)]">
            <th scope="row" className="w-[70px] py-1 pr-2 text-[12.5px] font-normal leading-[1.45] text-[#9aa0ad]">
              {r.name}
            </th>
            <td className={cn("py-1 pr-2 text-[12.5px] leading-[1.45] text-[#c6c9d1]", r.mono && "font-slate text-[12px] tracking-[0.04em]")}>{r.card}</td>
            <td className={cn("py-1 pr-2 text-[12.5px] leading-[1.45]", r.mono && "font-slate text-[12px] tracking-[0.04em]", r.mono && r.v === "didnt_match" ? s.inkMiss : "text-[#c6c9d1]")}>
              {r.seen}
            </td>
            {/* The cell's own size, so its line box is the verdict's and not the page's 16 px strut (rows as the artboard spaces them). */}
            <td className="py-1 text-[12.5px] leading-[1.45]">
              <VerdictInline v={r.v} m={m} />
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** "Why moment N missed" (the computer's panel), or what the wall says when nothing did. */
function WhyPanel({ x, take, still, product, m, t }: { x: WallMoment | null; take: TakeView | null; still: string | null; product: WallProduct | null; m: PressWords; t: Messages }) {
  if (!x || !take) {
    return (
      <section className="rounded-2xl bg-[rgba(255,255,255,0.03)] px-4 py-3.5 ring-1 ring-inset ring-[rgba(255,255,255,0.08)]">
        <p className={LABEL}>{m.stepWall}</p>
        <h3 className="mt-1.5 text-[17px] font-semibold leading-[1.3] text-[#ecedf1]">{m.wallClearTitle}</h3>
        <p className="mt-1 text-[12.5px] leading-[1.45] text-[#9aa0ad]">{m.wallClearBody}</p>
      </section>
    );
  }
  const d = x.moment.detail;
  const missed = isMiss(x.verdict);
  return (
    <section aria-live="polite" className="min-w-0 rounded-2xl bg-[rgba(255,255,255,0.03)] px-4 py-3.5 ring-1 ring-inset ring-[rgba(255,255,255,0.08)]">
      <p className={LABEL}>{missed ? formatMsg(m.whyMissed, { n: x.index }) : formatMsg(m.momentAt, { n: x.index, at: clockTenths(x.at) })}</p>
      <h3 className="mt-1.5 text-[17px] font-semibold leading-[1.3] text-[#ecedf1]">{whyHeadline(x, m, t)}</h3>
      <div className={cn("mt-3 grid items-start gap-[18px]", d ? "md:grid-cols-[230px_minmax(0,1fr)]" : "")}>
        {d && <Letters detail={d} m={m} />}
        <div className="grid max-w-[300px] grid-cols-2 gap-2">
          <figure className="overflow-hidden rounded-[10px] bg-[#121216] ring-1 ring-inset ring-[rgba(255,255,255,0.1)]">
            <span className="relative block h-[66px]">
              {product?.photo && (
                // eslint-disable-next-line @next/next/no-img-element -- a short-lived signed link to the person's own photo
                <img src={product.photo} alt="" className="absolute inset-0 h-full w-full object-cover" />
              )}
            </span>
            <figcaption className="px-2 py-[5px] text-[11px] text-[#9aa0ad]">{m.yourProduct}</figcaption>
          </figure>
          <figure className={cn("overflow-hidden rounded-[10px] bg-[#121216] ring-1 ring-inset", missed ? s.cropMiss : "ring-[rgba(255,255,255,0.1)]")}>
            <span className="relative block h-[66px]">
              <MomentFrame videoUrl={take.videoUrl} at={x.atTake} still={still} label={formatMsg(m.momentAlt, { n: x.index, at: clockTenths(x.at), verdict: verdictWord(x.verdict, m) })} />
            </span>
            <figcaption className={cn("flex justify-between gap-2 px-2 py-[5px] text-[11px]", missed ? s.inkMiss : "text-[#9aa0ad]")}>
              <span>{formatMsg(m.momentN, { n: x.index })}</span>
              <span className="font-slate">{clockTenths(x.at)}</span>
            </figcaption>
          </figure>
        </div>
      </div>
      <PartsTable x={x} product={product} m={m} />
      {d && x.moment.product === "didnt_match" && d.label === "didnt_match" && (
        <p className="mt-2.5 flex gap-[7px] text-[12px] leading-[1.4] text-[#9aa0ad]">
          <InfoIcon className="mt-px h-[13px] w-[13px] flex-none text-[#858994]" />
          {m.readTwoWays}
        </p>
      )}
    </section>
  );
}

/** The first shot still in our hands, its newest take and the word for where it is, or null. */
function busyTake(shots: ShotView[], m: PressWords): { shot: number; take: number; word: string } | null {
  const s = [...shots].sort((a, b) => a.shot - b.shot).find(shotBusy);
  if (!s) return null;
  const t = s.takes[s.takes.length - 1] ?? null;
  return { shot: s.shot, take: t?.take ?? 1, word: t?.state === "checking" ? m.takeChecking : m.takeFilming };
}

/** The title and the line under it for the shot that waits. */
function decisionWords(shot: ShotView, take: TakeView | null, misses: number, m: PressWords): { title: string; lede: string } {
  const usable = shot.takes.some((tk) => tk.state === "checked");
  if (!usable) return { title: formatMsg(m.decideNoTake, { n: shot.shot }), lede: m.decideNoTakeLede };
  if (shot.takes.length > 1 && !(take && isMiss(take.worst))) return { title: formatMsg(m.decidePick, { n: shot.shot }), lede: m.decidePickLede };
  const title =
    misses === 1 ? formatMsg(m.decideMissedOne, { n: shot.shot }) : misses > 1 ? formatMsg(m.decideMissed, { n: shot.shot, k: misses }) : formatMsg(m.decideMissedTake, { n: shot.shot });
  const readCount = take?.moments.length ?? 0;
  return { title, lede: misses > 0 && misses < readCount ? m.decideLede : m.decideLedeAll };
}

/** The three presses on a shot that waits: keep, film again at its price, or cut. */
function DecisionActions({
  shot,
  take,
  canAct,
  busy,
  act,
  lastShot,
  m,
  t,
  compact,
}: {
  shot: ShotView;
  take: TakeView | null;
  canAct: boolean;
  busy: boolean;
  act: WallActions;
  lastShot: boolean;
  m: PressWords;
  t: Messages;
  compact?: boolean;
}) {
  const ids = useId();
  const [noteOpen, setNoteOpen] = useState(false);
  const [note, setNote] = useState("");
  const [watch, setWatch] = useState(false);
  const disabled = !canAct || busy || shotBusy(shot);
  const keepable = take !== null && take.state === "checked";
  const refilm = (
    <button type="button" onClick={() => act.refilm(shot.shot, note.trim())} disabled={disabled || !shot.canRefilm} className={GHOST}>
      {!compact && <RefreshIcon className="h-3.5 w-3.5" />}
      {formatMsg(m.refilmShot, { n: shot.shot })} <small className="text-[12px] font-normal text-[#9aa0ad]">· {formatMsg(m.creditsShort, { n: shot.refilmCredits })}</small>
    </button>
  );
  const cut = (
    <button type="button" onClick={() => act.cut(shot.shot)} disabled={disabled || lastShot} className={GHOST}>
      {!compact && <ScissorsIcon className="h-3.5 w-3.5" />}
      {m.cutShot} <small className="text-[12px] font-normal text-[#9aa0ad]">· {m.free}</small>
    </button>
  );
  return (
    <div>
      <div className="mt-2.5 grid gap-[7px]">
        {keepable && (
          <button type="button" onClick={() => act.keep(shot.shot, take.take)} disabled={disabled} className={s.keepKey}>
            <CheckIcon className="h-4 w-4" />
            {formatMsg(m.keepTake, { n: take.take })}
          </button>
        )}
        {compact ? (
          // Side by side when both fit, one under the other when the words run longer.
          <div className="flex flex-wrap gap-2 [&>button]:w-auto [&>button]:flex-auto [&>button]:whitespace-nowrap [&>button]:px-2.5 [&>button]:text-[13px]">
            {refilm}
            {cut}
          </div>
        ) : (
          <>
            {refilm}
            {cut}
          </>
        )}
      </div>
      {!shot.canRefilm && <p className="mt-2 text-[11.5px] leading-[1.4] text-[#eed6a0]">{localizeServerText(REFILM_LIMIT, t)}</p>}
      {lastShot && <p className="mt-2 text-[11.5px] leading-[1.4] text-[#9aa0ad]">{localizeServerText(CUT_LAST_SHOT, t)}</p>}
      <div className="mt-1 flex flex-wrap gap-x-4">
        {shot.canRefilm && (
          <button type="button" onClick={() => setNoteOpen((v) => !v)} aria-expanded={noteOpen} aria-controls={`${ids}-note`} className={QUIET}>
            {m.refilmNoteToggle}
          </button>
        )}
        {take?.videoUrl && (
          <button type="button" onClick={() => setWatch((v) => !v)} aria-expanded={watch} className={QUIET}>
            <PlayIcon className="h-3 w-3" />
            {formatMsg(m.watchTake, { n: take.take })}
          </button>
        )}
      </div>
      {noteOpen && shot.canRefilm && (
        <label id={`${ids}-note`} className="mt-1 block text-[12px] text-[#9aa0ad]">
          {m.refilmNoteLabel}
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={2}
            maxLength={200}
            placeholder={m.refilmNotePlaceholder}
            className="mt-1 block w-full resize-none rounded-[10px] bg-[rgba(255,255,255,0.03)] px-2.5 py-2 text-[13px] leading-[1.4] text-[#ecedf1] ring-1 ring-inset ring-[rgba(255,255,255,0.1)] placeholder:text-[#62656e] focus:outline-none focus:ring-[rgba(240,196,142,0.65)]"
          />
        </label>
      )}
      {watch && take?.videoUrl && (
        <video src={take.videoUrl} controls playsInline className="mt-2 aspect-[9/16] max-h-[320px] rounded-xl bg-black" aria-label={formatMsg(m.watchTake, { n: take.take })} />
      )}
    </div>
  );
}

/** The computer's decision panel: the shot that waits, or the clear wall, and the key under it. */
function DecisionPanel({
  w,
  shots,
  canAct,
  busyShot,
  act,
  keySlot,
  m,
  t,
}: {
  w: ReturnType<typeof useWall>;
  shots: ShotView[];
  canAct: boolean;
  busyShot: number | null;
  act: WallActions;
  keySlot?: ReactNode;
  m: PressWords;
  t: Messages;
}) {
  const ids = useId();
  const shot = w.decide;
  const take = shot ? w.takeOf(shot) : null;
  const words = shot ? decisionWords(shot, take, shotMisses(w.moments, shot.shot), m) : null;
  // Nothing waits on the person, but a shot is still in our hands (filmed again, or its take being read).
  const busy = shot ? null : busyTake(shots, m);
  return (
    <section role="group" aria-labelledby={`${ids}-h`} className="flex min-w-0 flex-col rounded-2xl bg-[rgba(255,255,255,0.03)] px-4 py-3.5 ring-1 ring-inset ring-[rgba(255,255,255,0.08)]">
      {shot && words ? (
        <>
          <p className={LABEL}>{take ? formatMsg(m.shotTake, { n: shot.shot, t: take.take }) : formatMsg(m.shotN, { n: shot.shot })}</p>
          <h3 id={`${ids}-h`} className="mt-1.5 text-[16px] font-semibold leading-[1.3] text-[#ecedf1]">
            {words.title}
          </h3>
          <p className="mt-[3px] text-[12.5px] leading-[1.42] text-[#9aa0ad]">{words.lede}</p>
          <DecisionActions
            key={`${shot.shot}-${take?.take ?? 0}`}
            shot={shot}
            take={take}
            canAct={canAct}
            busy={busyShot !== null}
            act={act}
            lastShot={shotsInCut(shots) <= 1}
            m={m}
            t={t}
          />
          <p className="mt-3 text-[12px] leading-[1.45] text-[#c6c9d1]">{m.refilmHow}</p>
        </>
      ) : busy ? (
        <>
          <p className={LABEL}>{formatMsg(m.shotTake, { n: busy.shot, t: busy.take })}</p>
          <h3 id={`${ids}-h`} className="mt-1.5 text-[16px] font-semibold leading-[1.3] text-[#ecedf1]">
            {busy.word}
          </h3>
          <p className="mt-[3px] text-[12.5px] leading-[1.42] text-[#9aa0ad]">{m.filmingBody}</p>
        </>
      ) : (
        <>
          <p className={LABEL}>{m.stepWall}</p>
          <h3 id={`${ids}-h`} className="mt-1.5 text-[16px] font-semibold leading-[1.3] text-[#ecedf1]">
            {m.wallDecidedTitle}
          </h3>
          <p className="mt-[3px] text-[12.5px] leading-[1.42] text-[#9aa0ad]">{m.wallDecidedBody}</p>
        </>
      )}
      <p className="mt-2 text-[11.5px] leading-[1.45] text-[#858994]">{m.wallHonest}</p>
      {keySlot && <div className="mt-3 flex flex-col gap-2">{keySlot}</div>}
    </section>
  );
}

/** One shot's column on the computer's wall. */
function ShotGroup({ shot, w, canAct, busyShot, act, m, readOnly }: { shot: ShotView; w: ReturnType<typeof useWall>; canAct: boolean; busyShot: number | null; act: WallActions; m: PressWords; readOnly?: boolean }) {
  const take = w.takeOf(shot);
  const moments = w.moments.filter((x) => x.shot === shot.shot);
  const still = w.stillOf(shot.shot);
  return (
    <li className={cn("min-w-0", shot.decision === "cut" && "opacity-60")}>
      {/* One line, so every shot's prints start at the same height: the name gives way, never the verdict. */}
      <div className="flex items-center justify-between gap-2 whitespace-nowrap px-0.5 pb-2 text-[12.5px] text-[#858994]">
        <b className="min-w-0 truncate font-semibold text-[#ecedf1]" title={formatMsg(m.shotRole, { n: shot.shot, role: roleName(shot.role, m) })}>
          {formatMsg(m.shotRole, { n: shot.shot, role: roleName(shot.role, m) })}
        </b>
        {take?.state === "checked" && shot.decision !== "cut" && (
          <span className="flex-none">
            <FaceWord v={take.face} m={m} />
          </span>
        )}
      </div>
      {shot.decision === "cut" ? (
        <div className="grid min-h-[142px] place-items-center rounded-lg border border-dashed border-[rgba(255,255,255,0.14)] px-3 text-center">
          <div>
            <p className="text-[12.5px] text-[#9aa0ad]">{m.shotCutOut}</p>
            {!readOnly && take && take.state === "checked" && (
              <button type="button" onClick={() => act.keep(shot.shot, take.take)} disabled={!canAct || busyShot !== null} className={QUIET}>
                {m.putBack}
              </button>
            )}
          </div>
        </div>
      ) : take && take.state === "checked" && moments.length > 0 ? (
        // Prints spaced as the artboard spaces them (lock-desktop), so each
        // verdict word can run into the gap after its print and stay on one
        // line; a longer one (Portuguese, Italian) wraps inside that width.
        // Print, verdict and time are the rows of one grid the moments share (subgrid), so a verdict that
        // wraps ("Product missing", "Falta el producto") moves every time in the shot down together.
        <ol className="grid grid-rows-[auto_auto_auto] gap-x-4 gap-y-0" style={{ gridTemplateColumns: `repeat(${moments.length}, minmax(0, 1fr))` }}>
          {moments.map((x) => (
            <li key={x.key} className="row-span-3 grid min-w-0 grid-cols-[minmax(0,1fr)] grid-rows-subgrid">
              <MomentPrint
                x={x}
                take={take}
                still={still}
                worst={w.worst?.key === x.key}
                selected={w.shown?.key === x.key}
                onSelect={() => w.select(x.key)}
                order={x.index - 1}
                m={m}
              />
              <span className="mt-1.5 flex w-max max-w-[calc(100%+14px)] items-start">
                <VerdictInline v={x.verdict} m={m} />
              </span>
              <span className={cn("mt-0.5 font-slate text-[11px] tracking-[0.02em]", isMiss(x.verdict) ? s.inkMiss : "text-[#858994]")}>{clockTenths(x.at)}</span>
            </li>
          ))}
        </ol>
      ) : (
        <TakePending take={take} still={still} m={m} className="h-[142px]" />
      )}
      {/* Under the prints, so every shot's prints still start on one line. */}
      <div className="mt-2">
        <TakeTabs shot={shot} shown={take} onPick={(n) => w.pickTake(shot.shot, n)} m={m} />
      </div>
    </li>
  );
}

/** A computer's press wall: every shot's moments side by side, then why the worst one missed and the choice. */
export function PressWall({ shots, stills, canAct, busyShot, act, t, product, keySlot, readOnly }: WallProps) {
  const m = t.pressTour;
  const w = useWall(shots, stills);
  const ordered = [...shots].sort((a, b) => a.shot - b.shot);
  const shownShot = w.shown ? shots.find((x) => x.shot === w.shown!.shot) ?? null : null;
  const shownTakeView = shownShot ? w.takeOf(shownShot) : null;
  return (
    <div>
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h2 className={LABEL}>{w.moments.length > 0 ? formatMsg(m.wallHead, { n: w.moments.length }) : m.stepWall}</h2>
        <Tally moments={w.moments} m={m} big />
      </div>
      <ol
        aria-label={m.stepWall}
        className={cn(s.wall, "mt-2.5 grid gap-4")}
        style={{ gridTemplateColumns: `repeat(${Math.min(3, Math.max(1, ordered.length))}, minmax(0, 1fr))` }}
      >
        {ordered.map((shot) => (
          <ShotGroup key={shot.shot} shot={shot} w={w} canAct={canAct} busyShot={busyShot} act={act} m={m} readOnly={readOnly} />
        ))}
      </ol>
      {!readOnly && (
        <div className="mt-3.5 grid items-start gap-[18px] xl:grid-cols-[minmax(0,1fr)_300px]">
          <WhyPanel x={w.shown} take={shownTakeView} still={w.shown ? w.stillOf(w.shown.shot) : null} product={product} m={m} t={t} />
          <DecisionPanel w={w} shots={shots} canAct={canAct} busyShot={busyShot} act={act} keySlot={keySlot} m={m} t={t} />
        </div>
      )}
    </div>
  );
}

/** The phone's parts rows, beside the worst moment. */
function MiniParts({ detail, m }: { detail: MomentDetail; m: PressWords }) {
  const rows: [string, Verdict][] = [
    [m.partLabel, detail.label],
    [m.logoTag, detail.logo],
    [m.partShape, detail.shape],
    [m.partColour, detail.colour],
  ];
  return (
    <dl className="mt-5 grid grid-cols-[auto_1fr] gap-x-2.5 gap-y-[3px] text-[12px]">
      {rows.map(([name, v]) => (
        <div key={name} className="contents">
          <dt className="text-[#858994]">{name}</dt>
          <dd>
            <VerdictInline v={v} m={m} />
          </dd>
        </div>
      ))}
    </dl>
  );
}

/**
 * A phone's press wall: the worst moment first, in its own card with the
 * choice under it; then all the moments, shot by shot, as small prints.
 * Tapping a print puts that moment in the card.
 */
export function PhonePressWall({ shots, stills, canAct, busyShot, act, t, readOnly }: WallProps) {
  const m = t.pressTour;
  const w = useWall(shots, stills);
  const ordered = [...shots].sort((a, b) => a.shot - b.shot);
  const x = w.shown;
  const xShot = x ? shots.find((sh) => sh.shot === x.shot) ?? null : null;
  const xTake = xShot ? w.takeOf(xShot) : null;
  const decide = w.decide;
  const decideTake = decide ? w.takeOf(decide) : null;
  const words = decide ? decisionWords(decide, decideTake, shotMisses(w.moments, decide.shot), m) : null;
  const busy = decide ? null : busyTake(shots, m);
  const missed = x ? isMiss(x.verdict) : false;
  return (
    <div>
      <Tally moments={w.moments} m={m} />

      {!readOnly && (x || decide || busy) && (
        <div
          role="group"
          aria-label={x ? (missed && w.worst?.key === x.key ? m.worstFirst : formatMsg(m.momentN, { n: x.index })) : (words?.title ?? busy?.word)}
          className={cn("mt-2.5 rounded-2xl bg-[rgba(255,255,255,0.03)] px-3 pb-3 pt-[11px]", missed ? s.worstCardMiss : "shadow-[inset_0_0_0_1px_rgba(255,255,255,0.08)]")}
        >
          {x && xTake && (
            <>
              <div className="flex items-baseline justify-between gap-2">
                <p className={LABEL}>{missed && w.worst?.key === x.key ? m.worstFirst : formatMsg(m.momentN, { n: x.index })}</p>
                <span className={cn("flex-none whitespace-nowrap font-slate text-[11px] tracking-[0.04em]", missed ? s.inkMiss : "text-[#858994]")}>
                  {formatMsg(m.shotAt, { n: x.shot, at: clockTenths(x.at) })}
                </span>
              </div>
              <div className="mt-2 grid grid-cols-[92px_minmax(0,1fr)] gap-3">
                <span className={cn(s.print, "relative block h-[164px] w-[92px] rounded-[10px]", missed && s.printMiss)}>
                  <MomentFrame
                    videoUrl={xTake.videoUrl}
                    at={x.atTake}
                    still={w.stillOf(x.shot)}
                    label={formatMsg(m.momentAlt, { n: x.index, at: clockTenths(x.at), verdict: verdictWord(x.verdict, m) })}
                  />
                  <span className={s.badge} aria-hidden="true">
                    <Glyph v={x.verdict} />
                  </span>
                </span>
                <div className="min-w-0">
                  <h3 className="text-[14.5px] font-semibold leading-[1.32] text-[#ecedf1]">{whyHeadline(x, m, t)}</h3>
                  {x.moment.detail && (
                    <div className="mt-2">
                      <Letters detail={x.moment.detail} m={m} small />
                    </div>
                  )}
                  {x.moment.detail && <MiniParts detail={x.moment.detail} m={m} />}
                </div>
              </div>
            </>
          )}
          {busy && (
            <p role="status" className="mt-3 text-[12.5px] leading-[1.42] text-[#9aa0ad]">
              <b className="font-medium text-[#ecedf1]">
                {formatMsg(m.shotTake, { n: busy.shot, t: busy.take })} · {busy.word}.
              </b>{" "}
              {m.filmingBody}
            </p>
          )}
          {decide && words && (
            <div className="mt-3">
              <p className="text-[12.5px] leading-[1.42] text-[#9aa0ad]">
                <b className="font-medium text-[#ecedf1]">{words.title}.</b> {m.decidePhoneLede}
              </p>
              <DecisionActions
                key={`${decide.shot}-${decideTake?.take ?? 0}`}
                shot={decide}
                take={decideTake}
                canAct={canAct}
                busy={busyShot !== null}
                act={act}
                lastShot={shotsInCut(shots) <= 1}
                m={m}
                t={t}
                compact
              />
            </div>
          )}
        </div>
      )}

      <div className="mt-3.5 flex items-baseline justify-between gap-3">
        <p className={LABEL}>{w.moments.length > 0 ? formatMsg(m.allMoments, { n: w.moments.length }) : m.stepWall}</p>
        <span className="text-[11.5px] text-[#858994]">{m.blurNever}</span>
      </div>
      <ol className="mt-2 grid gap-2.5" style={{ gridTemplateColumns: `repeat(${Math.min(3, Math.max(1, ordered.length))}, minmax(0, 1fr))` }}>
        {ordered.map((shot) => {
          const take = w.takeOf(shot);
          const moments = w.moments.filter((mm) => mm.shot === shot.shot);
          return (
            <li key={shot.shot} className={cn("grid min-w-0 grid-rows-[auto_1fr] items-end", shot.decision === "cut" && "opacity-60")}>
              <p className="mb-[5px] min-h-[2.9em] self-start text-[11.5px] leading-[1.45] text-[#858994]">
                <b className="font-semibold text-[#ecedf1]">{formatMsg(m.shotN, { n: shot.shot })}</b>
                <br />
                {shot.decision === "cut" ? m.shotCutOut : take?.state === "checked" ? <FaceWord v={take.face} m={m} /> : null}
              </p>
              {shot.decision !== "cut" && take && take.state === "checked" && moments.length > 0 ? (
                <div className="grid gap-[3px]" style={{ gridTemplateColumns: `repeat(${moments.length}, minmax(0, 1fr))` }}>
                  {moments.map((mm) => (
                    <MomentPrint
                      key={mm.key}
                      x={mm}
                      take={take}
                      still={w.stillOf(shot.shot)}
                      worst={w.worst?.key === mm.key}
                      selected={w.shown?.key === mm.key}
                      onSelect={() => w.select(mm.key)}
                      order={mm.index - 1}
                      m={m}
                      small
                    />
                  ))}
                </div>
              ) : shot.decision === "cut" ? null : (
                <TakePending take={take} still={w.stillOf(shot.shot)} m={m} className="h-[62px] rounded-[5px]" />
              )}
            </li>
          );
        })}
      </ol>
      <p className="mt-3 text-[11.5px] leading-[1.45] text-[#858994]">{m.wallHonest}</p>
    </div>
  );
}
