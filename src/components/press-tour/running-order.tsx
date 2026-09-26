"use client";

import type { Messages } from "@/lib/i18n/messages/en";
import { formatMsg } from "@/lib/i18n/format";
import { localizeServerText } from "@/lib/i18n/server-text";
import type { ShotRole, StillView } from "@/lib/press-tour/campaign-types";
import { productChecked, shotNumber, spanLabel, stillAllClear, stillFlashes, stillNeedsDecision, stillPainted } from "@/lib/press-tour/door-view";
import { cn } from "@/lib/cn";
import { CheckIcon, RefreshIcon } from "./icons";
import { Stamp, VerdictInline, type PressWords } from "./verdict";
import s from "./press-tour.module.css";

// THE RUNNING ORDER: one still per shot, in the order the ad cuts them,
// each wearing its two checks as press stamps (the fixed verdict words).
// A still whose checks all cleared is approved with one press; a still that
// did not waits for the person — Keep as is, or Repaint · 1 cr. There is no
// re-shoot and no refund before the checker is calibrated (operator,
// 2026-09-26): a miss shows its verdict, and the choice stays the person's.
// On a still where the star's face matched and every check that applies
// matched, the flashbulb fires once (press-tour.module.css .flash). A hook
// planned without the product is clear on its face alone, says so
// ("Product · Not planned"), and flashes too.
//
// Touch sizes: the phone's running order is used below lg (1024 px), so its
// keys keep the 44 px minimum there, iPads in portrait included; only the
// computer's running order (lg and up) tightens them (PT-09).

export type StillActions = {
  approve: (shot: number) => void;
  keep: (shot: number) => void;
  undo: (shot: number) => void;
  repaint: (shot: number) => void;
};

type Common = {
  stills: StillView[];
  /** The stills can be decided on now (the ad waits on the person, nothing in flight). */
  canAct: boolean;
  /** The shot whose press is in flight. */
  busyShot: number | null;
  /** The free first ad cannot repaint (critique #10). */
  canRepaint: boolean;
  act: StillActions;
  t: Messages;
};

export function roleName(role: ShotRole, m: PressWords): string {
  return role === "hook" ? m.roleHook : role === "costar" ? m.roleCostar : m.roleLine;
}

const QUIET =
  "inline-flex min-h-11 items-center text-[12.5px] text-[#9aa0ad] underline decoration-[rgba(255,255,255,0.2)] underline-offset-[3px] hover:text-[#ecedf1] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#f0cda6] disabled:opacity-50 lg:min-h-8";
const GHOST =
  "inline-flex min-h-11 w-full items-center justify-center gap-1.5 rounded-xl px-3 text-[14px] font-medium text-[#ecedf1] ring-1 ring-inset ring-[rgba(255,255,255,0.16)] hover:bg-[rgba(255,255,255,0.04)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#f0cda6] disabled:opacity-50 lg:min-h-8 lg:text-[13px]";
const APPROVE =
  "inline-flex min-h-11 items-center justify-center gap-1.5 rounded-xl px-3.5 text-[13px] font-medium text-[#ecedf1] ring-1 ring-inset ring-[rgba(255,255,255,0.16)] hover:bg-[rgba(255,255,255,0.04)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#f0cda6] disabled:opacity-50 lg:min-h-8";
const PILL =
  "inline-flex min-h-11 items-center justify-center gap-1.5 rounded-full bg-[rgba(255,255,255,0.06)] px-3.5 text-[13px] font-medium text-[#ecedf1] shadow-[inset_0_0_0_1.5px_rgba(240,196,142,0.75)] lg:min-h-8";

/** The print itself: image (or the painting sheen), stamps, corner marks, the flashbulb. */
function Print({ still, m, small }: { still: StillView; m: PressWords; small?: boolean }) {
  const painted = stillPainted(still);
  const flashes = stillFlashes(still);
  const clear = stillAllClear(still);
  const waits = still.decision === "pending" && stillNeedsDecision(still);
  return (
    <div
      className={cn(
        s.print,
        // The same 9:16-ish print at every width (a phone's third of a 390 px screen is 150 px tall).
        "aspect-[188/268]",
        small ? "rounded-xl" : "rounded-[14px]",
        !painted && s.painting,
        flashes ? s.flash : clear ? s.glow : waits ? s.waiting : null,
      )}
    >
      {painted && (
        // eslint-disable-next-line @next/next/no-img-element -- a short-lived signed link to the person's own still
        <img src={still.imageUrl!} alt={formatMsg(m.stillAlt, { n: still.shot, direction: still.direction })} />
      )}
      {!painted && <span className="sr-only">{formatMsg(m.stillPainting, { n: still.shot })}</span>}
      {!small && painted && <span className={s.shade} aria-hidden="true" />}
      {clear && (
        <span
          aria-hidden="true"
          className={cn("lock-frame", s.marks)}
          style={small ? { inset: 5, ["--lock-arm" as string]: "11px" } : { ["--lock-arm" as string]: "16px", ["--lock-color" as string]: "#e8b27c" }}
        />
      )}
      <span
        className={cn(
          "absolute z-[4] rounded-full bg-[rgba(0,0,0,0.75)] font-medium tabular-nums text-[rgba(255,255,255,0.94)] shadow-[inset_0_0_0_1px_rgba(255,255,255,0.14)] backdrop-blur-[4px]",
          small ? "left-1.5 top-1.5 px-[7px] py-0.5 text-[11px]" : "left-2 top-2 px-[9px] py-1 text-[11.5px]",
        )}
      >
        {small ? shotNumber(still.shot) : `${shotNumber(still.shot)} · ${spanLabel(still.span)}`}
      </span>
      {small && still.decision !== "pending" && (
        <span
          role="img"
          aria-label={still.decision === "kept" ? m.kept : m.approved}
          className={cn(
            "absolute right-1.5 top-1.5 z-[4] grid h-[22px] w-[22px] place-items-center rounded-full bg-[rgba(14,12,10,0.8)] text-[#f0cda6] shadow-[inset_0_0_0_1.5px_rgba(240,196,142,0.8)]",
            flashes && s.land,
          )}
        >
          <CheckIcon className="h-3 w-3" />
        </span>
      )}
      {!small && painted && (
        <div className="absolute bottom-[11px] left-2.5 right-2 z-[4] flex flex-col items-start gap-[5px]">
          <Stamp v={still.face} check={m.face} m={m} land={flashes} />
          <Stamp v={still.product} check={m.product} m={m} land={flashes} notPlanned={!productChecked(still)} />
        </div>
      )}
    </div>
  );
}

/** The reason a still waits, in the person's language (the engine sends English). */
function waitTitle(still: StillView, t: Messages): string {
  if (still.reason) return localizeServerText(still.reason, t);
  return t.pressTour.waitsTitle;
}

function RepaintButton({ onClick, disabled, m, className }: { onClick: () => void; disabled: boolean; m: PressWords; className: string }) {
  return (
    <button type="button" onClick={onClick} disabled={disabled} className={className}>
      <RefreshIcon className="h-3.5 w-3.5" />
      {m.repaint} <small className="text-[12px] font-normal text-[#9aa0ad]">· {formatMsg(m.creditsShort, { n: 1 })}</small>
    </button>
  );
}

/** A computer's running order: the stills side by side, each with its own decision under it. */
export function RunningOrder({ stills, canAct, busyShot, canRepaint, act, t }: Common) {
  const m = t.pressTour;
  return (
    <ol className="relative grid grid-cols-3 items-start gap-5" aria-label={m.stillsLabel}>
      <span aria-hidden="true" className={cn(s.floor, "-left-5 -right-5 top-[88%]")} />
      {stills.map((still) => {
        const waits = still.decision === "pending" && stillNeedsDecision(still);
        const disabled = !canAct || busyShot !== null;
        return (
          <li key={still.shot} className="relative z-[1] min-w-0">
            <Print still={still} m={m} />
            <h3 className="mt-2.5 text-[14px] font-semibold text-[#ecedf1]">{roleName(still.role, m)}</h3>
            {!waits && <p className="mt-[3px] min-h-[34px] text-[12px] leading-[1.42] text-[#9aa0ad]">{still.direction}</p>}
            {still.houseRepainted && (
              <p className="mt-1.5 flex gap-1.5 text-[11.5px] leading-[1.4] text-[#b9b2a6]">
                <RefreshIcon className="mt-px h-3 w-3 flex-none text-[#e0a468]" />
                {m.houseRepainted}
              </p>
            )}
            {stillPainted(still) && (
              <div className="mt-2">
                {waits ? (
                  <div role="group" aria-label={formatMsg(m.shotWaits, { n: still.shot })} className="rounded-xl bg-[rgba(230,196,110,0.05)] px-2.5 pb-2.5 pt-2 shadow-[inset_0_0_0_1px_rgba(230,196,110,0.28)]">
                    <p className="font-slate text-[11px] font-medium uppercase tracking-[0.1em] text-[#e6c46e]">{m.waitsForYou}</p>
                    <p className="mt-[3px] text-[12px] font-medium leading-[1.4] text-[#ecedf1]">{waitTitle(still, t)}</p>
                    <p className="mt-0.5 text-[12px] leading-[1.4] text-[#c6c9d1]">{m.waitsBody}</p>
                    <div className="mt-2 grid gap-1.5">
                      {canRepaint && <RepaintButton onClick={() => act.repaint(still.shot)} disabled={disabled} m={m} className={GHOST} />}
                      <button type="button" onClick={() => act.keep(still.shot)} disabled={disabled} className={GHOST}>
                        {m.keepAsIs}
                      </button>
                    </div>
                  </div>
                ) : still.decision === "pending" ? (
                  <div className="flex flex-col items-start gap-1.5">
                    <button type="button" onClick={() => act.approve(still.shot)} disabled={disabled} className={APPROVE}>
                      <CheckIcon className="h-3.5 w-3.5" />
                      {m.approve}
                    </button>
                    {canRepaint && (
                      <button type="button" onClick={() => act.repaint(still.shot)} disabled={disabled} className={QUIET}>
                        {m.repaint} · {formatMsg(m.creditsShort, { n: 1 })}
                      </button>
                    )}
                  </div>
                ) : (
                  <div className="flex flex-col items-start gap-1">
                    <span className={PILL}>
                      <CheckIcon className="h-3.5 w-3.5" />
                      {still.decision === "kept" ? m.kept : m.approved}
                    </span>
                    <span className="flex gap-3.5">
                      <button type="button" onClick={() => act.undo(still.shot)} disabled={disabled} className={QUIET}>
                        {m.undo}
                      </button>
                      {canRepaint && (
                        <button type="button" onClick={() => act.repaint(still.shot)} disabled={disabled} className={QUIET}>
                          {m.repaint} · {formatMsg(m.creditsShort, { n: 1 })}
                        </button>
                      )}
                    </span>
                  </div>
                )}
              </div>
            )}
          </li>
        );
      })}
    </ol>
  );
}

/**
 * A phone's running order: all the stills at once (never a carousel that
 * clips the one needing action), their checks in words under each, and one
 * decision card for the still in hand — the first that waits, unless the
 * person taps another.
 */
export function PhoneRunningOrder({ stills, canAct, busyShot, canRepaint, act, t, selected, onSelect }: Common & { selected: number; onSelect: (shot: number) => void }) {
  const m = t.pressTour;
  const still = stills.find((x) => x.shot === selected) ?? stills[0];
  const disabled = !canAct || busyShot !== null;
  const waits = still ? still.decision === "pending" && stillNeedsDecision(still) : false;
  return (
    <div>
      <ol className={cn("grid gap-[9px]", stills.length >= 3 ? "grid-cols-3" : "grid-cols-2")} aria-label={m.stillsLabel}>
        {stills.map((x) => (
          <li key={x.shot} className="min-w-0">
            <button
              type="button"
              onClick={() => onSelect(x.shot)}
              aria-pressed={x.shot === still?.shot}
              aria-label={formatMsg(m.showShot, { n: x.shot })}
              className={cn(
                "block w-full rounded-xl text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#f0cda6]",
                x.shot === still?.shot && stills.length > 1 && "outline outline-1 outline-offset-2 outline-[rgba(240,205,166,0.45)]",
              )}
            >
              <Print still={x} m={m} small />
            </button>
            <p className="mt-[7px] text-[12.5px] font-semibold leading-[1.3] text-[#ecedf1]">{roleName(x.role, m)}</p>
            {stillPainted(x) && (
              <div className="mt-1 grid gap-[3px] text-[11.5px] leading-[1.3]">
                <p className="flex flex-wrap items-center gap-x-1.5 gap-y-px">
                  <span className="text-[#858994]">{m.face}</span>
                  <VerdictInline v={x.face} m={m} />
                </p>
                <p className="flex flex-wrap items-center gap-x-1.5 gap-y-px">
                  <span className="text-[#858994]">{m.product}</span>
                  <VerdictInline v={x.product} m={m} notPlanned={!productChecked(x)} />
                </p>
              </div>
            )}
          </li>
        ))}
      </ol>

      {still && stillPainted(still) && (
        <div
          role="group"
          aria-label={waits ? formatMsg(m.shotWaits, { n: still.shot }) : formatMsg(m.showShot, { n: still.shot })}
          className={cn(
            "mt-2.5 rounded-2xl px-3 pb-3 pt-2.5",
            waits ? "bg-[rgba(230,196,110,0.05)] shadow-[inset_0_0_0_1px_rgba(230,196,110,0.3)]" : "bg-[rgba(255,255,255,0.03)] shadow-[inset_0_0_0_1px_rgba(255,255,255,0.08)]",
          )}
        >
          <p className={cn("font-slate text-[11px] font-medium uppercase tracking-[0.1em]", waits ? "text-[#e6c46e]" : "text-[#858994]")}>
            {waits ? formatMsg(m.shotWaits, { n: still.shot }) : `${formatMsg(m.shotN, { n: still.shot })} · ${roleName(still.role, m)}`}
          </p>
          <h3 className="mt-1.5 text-[15px] font-semibold text-[#ecedf1]">{waits ? waitTitle(still, t) : still.direction}</h3>
          {waits && <p className="mt-[3px] text-[12.5px] leading-[1.42] text-[#9aa0ad]">{m.waitsBody}</p>}
          {still.houseRepainted && (
            <p className="mt-1.5 flex gap-1.5 text-[12px] leading-[1.4] text-[#b9b2a6]">
              <RefreshIcon className="mt-px h-3.5 w-3.5 flex-none text-[#e0a468]" />
              {m.houseRepainted}
            </p>
          )}
          <div className={cn("mt-2.5 grid gap-2", canRepaint ? "grid-cols-2" : "grid-cols-1")}>
            {still.decision === "pending" ? (
              <>
                {canRepaint && <RepaintButton onClick={() => act.repaint(still.shot)} disabled={disabled} m={m} className={GHOST} />}
                <button type="button" onClick={() => (waits ? act.keep(still.shot) : act.approve(still.shot))} disabled={disabled} className={GHOST}>
                  {waits ? m.keepAsIs : m.approve}
                </button>
              </>
            ) : (
              <>
                {canRepaint && <RepaintButton onClick={() => act.repaint(still.shot)} disabled={disabled} m={m} className={GHOST} />}
                <button type="button" onClick={() => act.undo(still.shot)} disabled={disabled} className={GHOST}>
                  {m.undo}
                  <span className="sr-only">
                    {" "}
                    ({still.decision === "kept" ? m.kept : m.approved})
                  </span>
                </button>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
