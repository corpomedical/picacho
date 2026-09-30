"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";
import styles from "./producer-lamp.module.css";
import {
  LAMP_EVENT,
  PEEK,
  PEEK_HOVER,
  RADIUS,
  decide,
  dismissTarget,
  isSideEdge,
  isTucked,
  overDismiss,
  placeCentre,
  readLampHidden,
  readLampPlace,
  tuckableSides,
  writeLampHidden,
  writeLampPlace,
  type Edge,
  type Place,
  type Point,
} from "./lamp-place";
import { FLY, HOME, PEEK_SPRING, TUCK, type Motion } from "./lamp-motion";
import { LampEngine, type LampLayout, type Seam } from "./lamp-engine";
import { LookInner, lookClasses } from "./lamp-looks";
import type { LampLook, LampMood } from "./lamp-look";

// The lamp you can move (2026-09-25, operator: "The light bulb is disturbing
// some of the buttons", then "Lets make it movable and dismissible. Also, if
// taken to any edge, its lives as an edge tab"). Redrawn 2026-09-30
// (operator: "The light bulb and how it sticks in the corner, the animation
// feels cheap" and "Looks cheap, not premium"; he picked "A · Tuck" from the
// draft): a glass bead that never changes shape.
//
// DRAG IT anywhere (mouse, finger or pen; a tap still opens the Producer).
// Near a corner it is drawn into it and a faint ring shows where it would
// park; near a side, a thin warm line shows where it would tuck in. LET GO —
// or throw it — and it goes where the throw carries it: a corner parks it, a
// side tucks it half behind the screen's edge with its light still on (a
// mouse over it makes it peek out), anywhere else it stays. Pull a tucked lamp
// and it comes out under your finger. DROP IT ON × (bottom centre, shown while
// dragging) to hide it, with Undo; Settings > Preferences > Your assistant
// brings it back. It can't be hidden while voice is live — the lamp is then
// the way to see it's listening, and End is beside it. HOLD IT to talk.
//
// Where it lives is decided here (lamp-place.ts); how it gets there is drawn
// by lamp-engine.ts outside React, on springs (lamp-motion.ts). While the
// sheet is open it flies to its corner, because the wheel opens into that
// corner (producer-lamp.tsx waits for it to land). HOME is read from an
// invisible twin carrying the corner's CSS, so the corner keeps every rule it
// had: the dock lift on a phone, the tab bar in the app, the open-state corner.
//
// WHAT IT LOOKS LIKE: one of three looks in the same glass (lamp-looks.tsx),
// in one of four moods that producer-lamp.tsx works out from the voice loop
// and the answer in flight.

const W = {
  hide: "Hide",
  hidden: "Lamp hidden.",
  undo: "Undo",
  bringBack: "Settings → Preferences brings it back.",
  moveHint: "drag to move",
  moveHoldHint: "drag to move, hold to talk",
};

/** How long the lamp is held still before the mic opens (push to talk). */
const HOLD_MS = 420;

// prefers-reduced-motion, live.
function subscribeReduced(cb: () => void) {
  const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
  mq.addEventListener("change", cb);
  return () => mq.removeEventListener("change", cb);
}
const readReduced = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

function sameLayout(a: LampLayout | null, b: LampLayout): boolean {
  return (
    !!a &&
    a.home.x === b.home.x &&
    a.home.y === b.home.y &&
    a.stage.top === b.stage.top &&
    a.stage.bottom === b.stage.bottom &&
    a.stage.right === b.stage.right &&
    a.vw === b.vw &&
    a.vh === b.vh
  );
}

/** Where the lamp should be, and the edge line it shows there. */
function aimOf(place: Place, open: boolean, layout: LampLayout, peek: boolean): { to: Point; seam: Seam | null; tucked: boolean } {
  if (open) return { to: layout.home, seam: null, tucked: false };
  const tucked = isTucked(place, layout.tuckable);
  const to = placeCentre(place, layout.stage, layout.home, layout.tuckable, tucked && peek ? PEEK_HOVER : 0);
  if (!tucked || place.kind !== "edge") return { to, seam: null, tucked: false };
  return { to, seam: { edge: place.edge, along: isSideEdge(place.edge) ? to.y : to.x, level: peek ? 0.85 : 0.5 }, tucked: true };
}

/** Where the small dot sits on a tucked lamp: in the part still on the screen. */
function tuckDotStyle(edge: Edge): React.CSSProperties {
  const inset = RADIUS * 2 - PEEK + 4;
  if (edge === "right") return { left: 4, top: 6 };
  if (edge === "left") return { right: 4, top: 6 };
  if (edge === "top") return { bottom: 4, left: inset };
  return { top: 4, left: inset };
}

export function MovableLamp({
  name,
  open,
  onToggle,
  live,
  endable = live,
  level,
  look,
  mood,
  lift,
  unseenCards,
  dot,
  onEndVoice,
  lampRef,
  openLabel,
  newCardsLabel,
  endVoiceLabel,
  onHoldStart,
  onHoldEnd,
  holdText = null,
  holdKeyName = null,
}: {
  name: string;
  open: boolean;
  onToggle: () => void;
  /** Voice is on: the lamp follows the sound and can't be hidden. */
  live: boolean;
  /** Hands-free is on: End sits beside the closed lamp (a push-to-talk hold has none). */
  endable?: boolean;
  /** The look's light (0..1): the voice's loudness, or a steady strength while it talks unmetered. */
  level: number;
  look: LampLook;
  mood: LampMood;
  /** On a phone, how far above the bottom the composer's dock pushes the corner. */
  lift: number | null;
  unseenCards: number;
  dot: number;
  onEndVoice: () => void;
  lampRef: React.RefObject<HTMLButtonElement | null>;
  openLabel: string;
  newCardsLabel: string;
  endVoiceLabel: string;
  /** Push to talk: held still for HOLD_MS, the mic opens (undefined = holding does nothing). */
  onHoldStart?: () => void;
  /** Let go after a hold: what was said is sent. */
  onHoldEnd?: () => void;
  /** Said beside the lamp while it is held ("Listening · let go to send"). */
  holdText?: string | null;
  /** The push-to-talk key, named in the lamp's tooltip ("Right Option ⌥"). */
  holdKeyName?: string | null;
}) {
  const [place, setPlace] = useState<Place>({ kind: "home" });
  const [hidden, setHidden] = useState(false);
  const [layout, setLayout] = useState<LampLayout | null>(null);
  const [placed, setPlaced] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const [undo, setUndo] = useState(false);
  const [holding, setHolding] = useState(false);
  // A mouse over a tucked lamp: it peeks out a little.
  const [hovered, setHovered] = useState(false);
  const reduced = useSyncExternalStore(subscribeReduced, readReduced, () => false);
  const [eng] = useState(() => new LampEngine(styles.dropOver));

  const homeRef = useRef<HTMLSpanElement>(null);
  const probeRef = useRef<HTMLSpanElement>(null);
  const innerRef = useRef<HTMLSpanElement>(null);
  const seamRef = useRef<HTMLSpanElement>(null);
  const hintRef = useRef<HTMLSpanElement>(null);
  const dropRef = useRef<HTMLDivElement>(null);
  const hiddenRef = useRef(false);
  const suppressClick = useRef(false);
  // Push to talk (2026-09-27, operator: "By long pressing the light bulb it
  // would activate the mic and deactivating when unpressed"): a press held
  // still for HOLD_MS is a hold, not a tap or a drag.
  const holdRef = useRef<{ id: number; x: number; y: number; timer: number; fired: boolean } | null>(null);
  // What the lamp was last aimed at, to tell a resize (jump) from a move (fly).
  const lastAim = useRef<{ layout: LampLayout | null; look: LampLook | null; hovered: boolean }>({ layout: null, look: null, hovered: false });

  // This device's choice, and changes to it from Settings or the sheet. Read
  // before the first paint, so a hidden lamp never blinks on a page load and
  // a moved one doesn't start in the corner.
  useLayoutEffect(() => {
    const read = () => {
      const h = readLampHidden();
      if (h && !hiddenRef.current) setUndo(true);
      hiddenRef.current = h;
      setHidden(h);
      setPlace(readLampPlace());
    };
    hiddenRef.current = readLampHidden();
    setHidden(hiddenRef.current);
    setPlace(readLampPlace());
    window.addEventListener(LAMP_EVENT, read);
    return () => window.removeEventListener(LAMP_EVENT, read);
  }, []);

  // The stage: the viewport minus the phone's top bar and whatever sits at
  // the bottom (the app's tab bar, the composer's dock, the home indicator).
  const measure = useCallback(() => {
    const homeBox = homeRef.current?.getBoundingClientRect();
    if (!homeBox) return;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const probe = probeRef.current?.getBoundingClientRect();
    let top = probe ? probe.top : 0;
    let bottom = probe && probe.bottom > 0 ? probe.bottom : vh;
    const bar = document.querySelector("[data-mobile-topbar]");
    if (bar) {
      const r = bar.getBoundingClientRect();
      if (r.height > 0 && r.top <= 1) top = Math.max(top, r.bottom);
    }
    const tabBar = parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--native-tab-bar")) || 0;
    if (tabBar > 0) bottom = Math.min(bottom, vh - tabBar);
    if (lift !== null) bottom = Math.min(bottom, vh - lift + 12);
    const stage = { left: 0, top, right: vw, bottom };
    const next: LampLayout = {
      stage,
      home: { x: homeBox.left + homeBox.width / 2, y: homeBox.top + homeBox.height / 2 },
      tuckable: tuckableSides(stage, vw, vh),
      vw,
      vh,
    };
    setLayout((prev) => (sameLayout(prev, next) ? prev : next));
  }, [lift]);

  useLayoutEffect(() => {
    measure();
  }, [measure, open]);

  useEffect(() => {
    window.addEventListener("resize", measure);
    // The app's tab bar publishes its height on <html> after it mounts.
    const mo = new MutationObserver(measure);
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ["style", "class"] });
    return () => {
      window.removeEventListener("resize", measure);
      mo.disconnect();
    };
  }, [measure]);

  // Moves animate only once it has been placed: no flight across the screen
  // on the first paint. A timer, not a frame: a hidden tab paints no frames.
  useEffect(() => {
    if (!layout || placed) return;
    const t = window.setTimeout(() => setPlaced(true), 60);
    return () => window.clearTimeout(t);
  }, [layout, placed]);

  useEffect(() => {
    if (!undo) return;
    const t = window.setTimeout(() => setUndo(false), 7000);
    return () => window.clearTimeout(t);
  }, [undo]);

  useEffect(() => () => eng.destroy(), [eng]);

  const shown = !hidden || open || live || leaving;
  const tucked = !!layout && !open && isTucked(place, layout.tuckable);

  // Where it lives, drawn: at once on the first paint, after a resize or when
  // it is shown again; on springs when it moves (opened, closed, a place set
  // in Settings, a mouse making a tucked lamp peek). A throw has already set
  // off its own flight at the release, and is left to land.
  useLayoutEffect(() => {
    eng.configure({ layout, reduced, canHide: !live });
    if (!layout || !shown) return;
    const fresh = eng.attach({
      lamp: lampRef.current,
      inner: innerRef.current,
      seam: seamRef.current,
      hint: hintRef.current,
      drop: dropRef.current,
    });
    const last = lastAim.current;
    // A new screen size or bars jumps it there; home moving to the open corner
    // on a phone (the same screen) is a move, and it flies.
    const prev = last.layout;
    const resized =
      prev !== null &&
      (prev.vw !== layout.vw || prev.vh !== layout.vh || prev.stage.top !== layout.stage.top || prev.stage.bottom !== layout.stage.bottom);
    const lookChanged = last.look !== null && last.look !== look;
    const peekChanged = last.hovered !== hovered;
    lastAim.current = { layout, look, hovered };
    if (eng.inHand() || leaving) return;
    const aim = aimOf(place, open, layout, hovered);
    if (fresh || !placed || resized || !eng.placed()) {
      eng.jump(aim.to, aim.seam);
      return;
    }
    // A new look is new markup: pick the motion up from where it is.
    if (lookChanged) eng.halt();
    if (eng.headingTo(aim.to)) return;
    const spring = open ? HOME : peekChanged && aim.tucked ? PEEK_SPRING : aim.tucked ? TUCK : FLY;
    eng.fly(aim.to, spring, { seam: aim.seam, landing: aim.tucked && !peekChanged ? "tuck" : null });
  }, [eng, layout, place, open, placed, reduced, shown, leaving, hovered, live, look, dragging, lampRef]);

  useEffect(() => {
    if (!holding) return;
    const away = () => endHold(true);
    window.addEventListener("blur", away);
    document.addEventListener("visibilitychange", away);
    return () => {
      window.removeEventListener("blur", away);
      document.removeEventListener("visibilitychange", away);
    };
    // endHold reads refs only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [holding]);

  function endHold(send: boolean) {
    const h = holdRef.current;
    holdRef.current = null;
    if (!h) return false;
    window.clearTimeout(h.timer);
    if (!h.fired) return false;
    setHolding(false);
    if (send) onHoldEnd?.();
    return true;
  }

  /** Back where it lives, lift let go (after a tap, a hold or a cancelled press). */
  function settle() {
    if (!layout) return;
    const aim = aimOf(place, open, layout, hovered);
    eng.fly(aim.to, aim.tucked ? PEEK_SPRING : FLY, { seam: aim.seam });
  }

  /** Into the ×: it shrinks away there, then hides. */
  function leave(from: Motion) {
    if (!layout) return;
    setLeaving(true);
    eng.fly(dismissTarget(layout.stage), FLY, { from, lift: -12, fade: true, seam: null });
    window.setTimeout(() => {
      hiddenRef.current = true;
      setHidden(true);
      setLeaving(false);
      setUndo(true);
      writeLampHidden(true);
    }, 320);
  }

  function onPointerDown(e: React.PointerEvent<HTMLButtonElement>) {
    suppressClick.current = false;
    if (e.button !== 0) return;
    if (onHoldStart) {
      const h = { id: e.pointerId, x: e.clientX, y: e.clientY, timer: 0, fired: false };
      h.timer = window.setTimeout(() => {
        if (holdRef.current !== h) return;
        h.fired = true;
        // A hold, so not a drag: the lamp stays where it is.
        eng.hold();
        setDragging(false);
        setHolding(true);
        try {
          navigator.vibrate?.(12);
        } catch {}
        onHoldStart();
      }, HOLD_MS);
      holdRef.current = h;
    }
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {}
    if (open || !layout) return;
    setHovered(false);
    eng.grab({ id: e.pointerId, x: e.clientX, y: e.clientY, t: e.timeStamp }, tucked);
  }

  function onPointerMove(e: React.PointerEvent<HTMLButtonElement>) {
    // A mouse moving over a tucked lamp makes it peek. Taken from moves, not
    // from pointerenter: a lamp that flies away from under a still mouse never
    // gets its pointerleave, so the browser's own idea of hover goes stale.
    if (e.pointerType === "mouse" && e.buttons === 0 && tucked && !hovered && !eng.inHand()) setHovered(true);
    const h = holdRef.current;
    if (h && h.id === e.pointerId) {
      if (h.fired) return; // held: it doesn't move
      // Moved before the hold began: a drag (or nothing, when open).
      if (Math.hypot(e.clientX - h.x, e.clientY - h.y) >= 6) {
        window.clearTimeout(h.timer);
        holdRef.current = null;
      }
    }
    if (eng.follow(e.pointerId, e.clientX, e.clientY, e.timeStamp) === "started") setDragging(true);
  }

  function onPointerUp(e: React.PointerEvent<HTMLButtonElement>) {
    if (holdRef.current?.id === e.pointerId && endHold(true)) {
      // Let go of a hold: sent, and no click opens the chat.
      suppressClick.current = true;
      eng.letGo();
      setDragging(false);
      settle();
      return;
    }
    const r = eng.release(e.pointerId, e.timeStamp);
    setDragging(false);
    if (!r || !layout) return;
    if (!r.moved) {
      settle();
      return; // a tap: the click opens it
    }
    suppressClick.current = true;
    if (!live && overDismiss(r.m.x, r.m.y, layout.stage)) {
      leave(r.m);
      return;
    }
    // Where the throw carries it, set off with the throw's own speed.
    const next = decide(r.m.x, r.m.y, r.vx, r.vy, layout.stage, layout.tuckable);
    const aim = aimOf(next, false, layout, false);
    eng.fly(aim.to, aim.tucked ? TUCK : FLY, {
      from: { ...r.m, vx: r.vx, vy: r.vy },
      seam: aim.seam,
      landing: aim.tucked ? "tuck" : "park",
    });
    setPlace(next);
    writeLampPlace(next);
  }

  function onPointerCancel() {
    endHold(true);
    eng.letGo();
    setDragging(false);
    settle();
  }

  function onClick() {
    if (suppressClick.current) {
      suppressClick.current = false;
      return;
    }
    // It flies off to open (or back to its place): no longer under the mouse.
    setHovered(false);
    onToggle();
  }

  // Where it rests, for what sits beside it.
  const restAt = layout ? aimOf(place, open, layout, false).to : null;
  const tuckEdge = tucked && place.kind === "edge" ? place.edge : null;

  // The End chip sits beside the lamp, on the page's side of a tucked one.
  let chip: { left: number; top: number } | null = null;
  if (endable && !open && restAt && layout && !dragging) {
    const c = 30;
    const gap = 10;
    const s = layout.stage;
    if (tuckEdge === "right") chip = { left: s.right - PEEK - gap - c, top: restAt.y - c / 2 };
    else if (tuckEdge === "left") chip = { left: s.left + PEEK + gap, top: restAt.y - c / 2 };
    else if (tuckEdge === "top") chip = { left: restAt.x - c / 2, top: s.top + PEEK + gap };
    else if (tuckEdge === "bottom") chip = { left: restAt.x - c / 2, top: s.bottom - PEEK - gap - c };
    else {
      const leftSide = restAt.x - RADIUS - gap - c;
      chip = { left: leftSide >= 8 ? leftSide : restAt.x + RADIUS + gap, top: restAt.y - c / 2 };
    }
  }

  const lampClass = [
    styles.lamp,
    open ? styles.lampOpen : "",
    live ? styles.lampLive : "",
    dragging ? styles.dragging : "",
    tucked ? styles.tucked : "",
    lookClasses(look, mood),
  ]
    .filter(Boolean)
    .join(" ");

  const target = layout ? dismissTarget(layout.stage) : null;
  const pillSide = tuckEdge === "left" || (!tuckEdge && restAt !== null && restAt.x < 180);

  return (
    <>
      <span ref={probeRef} aria-hidden="true" className={styles.insetProbe} />
      <span
        ref={homeRef}
        aria-hidden="true"
        data-producer-lamp-home
        className={`${styles.anchor} ${open ? styles.anchorOpen : ""}`}
        style={lift !== null && !open ? { bottom: lift } : undefined}
      />
      <span ref={seamRef} aria-hidden="true" className={styles.seam} />
      <span ref={hintRef} aria-hidden="true" className={styles.cornerHint} />

      {shown && layout && (
        <button
          type="button"
          ref={lampRef}
          data-producer-lamp
          onClick={onClick}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerCancel}
          onPointerLeave={() => setHovered(false)}
          onContextMenu={onHoldStart ? (e) => e.preventDefault() : undefined}
          aria-label={openLabel}
          aria-expanded={open}
          title={`${name} (${onHoldStart ? W.moveHoldHint : W.moveHint}${holdKeyName ? `, or hold ${holdKeyName}` : ""})`}
          // --glow: the look's light, worked out by the parent (producer-lamp.tsx).
          style={{ "--glow": level } as React.CSSProperties}
          className={lampClass}
        >
          <span ref={innerRef} className={styles.inner}>
            <LookInner look={look} mood={mood} glow={level} />
          </span>
          {tuckEdge
            ? (unseenCards > 0 || dot > 0) && <span className={styles.tuckDot} style={tuckDotStyle(tuckEdge)} aria-label={newCardsLabel} />
            : !open && (
                <>
                  {unseenCards > 0 && (
                    <span
                      className="absolute -left-1 -top-1 grid h-[18px] min-w-[18px] place-items-center rounded-full bg-atelier-accent px-1 text-[10px] font-semibold leading-none text-[#1a120a] tabular-nums"
                      aria-label={newCardsLabel}
                    >
                      {unseenCards}
                    </span>
                  )}
                  {dot > 0 && (
                    <span
                      className="absolute -right-0.5 -top-0.5 grid h-[18px] min-w-[18px] place-items-center rounded-full bg-[#e6c46e] px-1 text-[10px] font-semibold leading-none text-[#1a120a] tabular-nums"
                      aria-label={`${dot} to look at`}
                    >
                      {dot}
                    </span>
                  )}
                </>
              )}
        </button>
      )}

      {/* Held: what the lamp is doing, beside it on the page's side. */}
      {holdText && (
        <span
          role="status"
          aria-live="polite"
          className={styles.holdPill}
          style={
            restAt && layout
              ? pillSide
                ? { left: (tuckEdge ? layout.stage.left + PEEK : restAt.x + RADIUS) + 10, top: restAt.y - 15 }
                : { right: Math.max(8, layout.vw - (tuckEdge === "right" ? layout.stage.right - PEEK : restAt.x - RADIUS) + 10), top: restAt.y - 15 }
              : { right: 74, bottom: 27 }
          }
        >
          <span className={styles.holdDot} aria-hidden="true" />
          {holdText}
        </span>
      )}

      {/* Voice is live with the sheet closed: the one-tap way to turn it off. */}
      {endable && !open && (
        <button
          type="button"
          onClick={onEndVoice}
          aria-label={endVoiceLabel}
          title={endVoiceLabel}
          className={styles.endChip}
          style={
            chip
              ? { left: chip.left, top: chip.top, right: "auto", bottom: "auto" }
              : lift !== null
                ? { bottom: lift + 7 }
                : undefined
          }
        >
          <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
            <path d="M4 4l8 8M12 4l-8 8" />
          </svg>
        </button>
      )}

      {/* Dragging: the × that hides it. */}
      {dragging && !live && target && (
        <div ref={dropRef} aria-hidden="true" className={styles.dropTarget} style={{ left: target.x - 28, top: target.y - 28 }}>
          <svg viewBox="0 0 16 16" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
            <path d="M4 4l8 8M12 4l-8 8" />
          </svg>
          <span className={styles.dropLabel}>{W.hide}</span>
        </div>
      )}

      {undo && hidden && (
        <div
          role="status"
          className={styles.undoPill}
          style={layout ? { top: layout.stage.bottom - 64, bottom: "auto" } : undefined}
        >
          <span>
            {W.hidden} <span className={styles.undoHint}>{W.bringBack}</span>
          </span>
          <button
            type="button"
            onClick={() => {
              setUndo(false);
              hiddenRef.current = false;
              writeLampHidden(false);
            }}
          >
            {W.undo}
          </button>
        </div>
      )}
    </>
  );
}
