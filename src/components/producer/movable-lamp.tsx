"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import styles from "./producer-lamp.module.css";
import {
  BULB,
  LAMP_EVENT,
  SNAP_GAP,
  boxFor,
  clampCentre,
  dismissTarget,
  nearestEdge,
  overDismiss,
  readLampHidden,
  readLampPlace,
  settle,
  writeLampHidden,
  writeLampPlace,
  type Box,
  type Edge,
  type Place,
  type Stage,
} from "./lamp-place";

// The lamp you can move (2026-09-25, operator: "The light bulb is disturbing
// some of the buttons", then "Lets make it movable and dismissible. Also, if
// taken to any edge, its lives as an edge tab. Give it nice effects when it
// transitions to an edge tab").
//
// DRAG IT anywhere (mouse, finger or pen; a tap still opens the Producer).
// LET GO near an edge and it becomes that edge's tab: it springs to the edge,
// melts from a round bulb into a slim glowing tab while its bulb stretches
// into a filament, and a flash of light runs along the edge. Pull a tab out
// and it swells back into the bulb under your finger. DROP IT ON × (bottom
// centre, shown while dragging) to hide it, with Undo; Settings > Preferences
// > Your assistant brings it back. It can't be hidden while voice is live —
// the lamp is then the way to see it's listening, and End is beside it.
//
// While the sheet is open it flies back to its corner, because the wheel
// opens into that corner (producer-lamp.tsx waits for it to land).
//
// Positions are computed here (lamp-place.ts) and animated by CSS transitions
// on left/top/size; HOME is read from an invisible twin carrying the lamp's
// own CSS, so the corner keeps every rule it had: the dock lift on a phone,
// the tab bar in the app, the open-state corner.

const W = {
  hide: "Hide",
  hidden: "Lamp hidden.",
  undo: "Undo",
  bringBack: "Settings → Preferences brings it back.",
  moveHint: "drag to move",
};

type Layout = { stage: Stage; home: { left: number; top: number } };

export function MovableLamp({
  name,
  open,
  onToggle,
  live,
  level,
  lift,
  unseenCards,
  dot,
  onEndVoice,
  lampRef,
  openLabel,
  newCardsLabel,
  endVoiceLabel,
}: {
  name: string;
  open: boolean;
  onToggle: () => void;
  /** Voice is on: the lamp follows the sound and can't be hidden. */
  live: boolean;
  level: number;
  /** On a phone, how far above the bottom the composer's dock pushes the corner. */
  lift: number | null;
  unseenCards: number;
  dot: number;
  onEndVoice: () => void;
  lampRef: React.RefObject<HTMLButtonElement | null>;
  openLabel: string;
  newCardsLabel: string;
  endVoiceLabel: string;
}) {
  const [place, setPlace] = useState<Place>({ kind: "home" });
  const [hidden, setHidden] = useState(false);
  const [layout, setLayout] = useState<Layout | null>(null);
  const [placed, setPlaced] = useState(false);
  const [drag, setDrag] = useState<{ cx: number; cy: number } | null>(null);
  const [leaving, setLeaving] = useState<{ cx: number; cy: number } | null>(null);
  const [flash, setFlash] = useState<{ id: number; edge: Edge; box: Box } | null>(null);
  const [undo, setUndo] = useState(false);
  const homeRef = useRef<HTMLSpanElement>(null);
  const probeRef = useRef<HTMLSpanElement>(null);
  const hiddenRef = useRef(false);
  const dragRef = useRef<{ cx: number; cy: number } | null>(null);
  const gesture = useRef<{ id: number; x: number; y: number; cx: number; cy: number; moved: boolean } | null>(null);
  const suppressClick = useRef(false);

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
    const home = homeRef.current?.getBoundingClientRect();
    if (!home) return;
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
    const next = { stage: { left: 0, top, right: vw, bottom }, home: { left: home.left, top: home.top } };
    setLayout((prev) =>
      prev &&
      prev.home.left === next.home.left &&
      prev.home.top === next.home.top &&
      prev.stage.top === next.stage.top &&
      prev.stage.bottom === next.stage.bottom &&
      prev.stage.right === next.stage.right
        ? prev
        : next,
    );
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

  // Transitions only once it has been placed: no flight across the screen on
  // the first paint. A timer, not a frame: a hidden tab paints no frames.
  useEffect(() => {
    if (!layout || placed) return;
    const t = window.setTimeout(() => setPlaced(true), 60);
    return () => window.clearTimeout(t);
  }, [layout, placed]);

  useEffect(() => {
    if (!flash) return;
    const t = window.setTimeout(() => setFlash(null), 1400); // the run lasts 180 + 1100 ms
    return () => window.clearTimeout(t);
  }, [flash]);

  useEffect(() => {
    if (!undo) return;
    const t = window.setTimeout(() => setUndo(false), 7000);
    return () => window.clearTimeout(t);
  }, [undo]);

  const shown = !hidden || open || live || leaving !== null;

  // Where it is drawn right now.
  let box: Box | null = null;
  let tabEdge: Edge | null = null;
  if (layout) {
    if (leaving) box = { left: leaving.cx - BULB / 2, top: leaving.cy - BULB / 2, width: BULB, height: BULB };
    else if (drag) box = { left: drag.cx - BULB / 2, top: drag.cy - BULB / 2, width: BULB, height: BULB };
    else if (open || place.kind === "home") box = { ...layout.home, width: BULB, height: BULB };
    else {
      box = boxFor(place, layout.stage);
      if (place.kind === "edge") tabEdge = place.edge;
    }
  }
  const near = drag && layout ? nearestEdge(drag.cx, drag.cy, layout.stage) : null;
  const hintEdge = near && near.gap <= SNAP_GAP ? near.edge : null;
  const hintPlace = hintEdge && drag && layout ? settle(drag.cx, drag.cy, layout.stage) : null;
  const hintBox = hintPlace && hintPlace.kind === "edge" && layout ? boxFor(hintPlace, layout.stage) : null;
  const canHide = !live;
  const over = drag !== null && layout !== null && canHide && overDismiss(drag.cx, drag.cy, layout.stage);
  const target = layout ? dismissTarget(layout.stage) : null;

  function onPointerDown(e: React.PointerEvent<HTMLButtonElement>) {
    suppressClick.current = false;
    if (open || !layout || e.button !== 0) return;
    const r = e.currentTarget.getBoundingClientRect();
    // From a tab, the bulb forms under the finger; from a bulb, it keeps the
    // offset it was picked up with.
    const fromTab = tabEdge !== null;
    gesture.current = {
      id: e.pointerId,
      x: e.clientX,
      y: e.clientY,
      cx: fromTab ? e.clientX : r.left + r.width / 2,
      cy: fromTab ? e.clientY : r.top + r.height / 2,
      moved: false,
    };
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {}
  }

  function onPointerMove(e: React.PointerEvent<HTMLButtonElement>) {
    const g = gesture.current;
    if (!g || g.id !== e.pointerId || !layout) return;
    const dx = e.clientX - g.x;
    const dy = e.clientY - g.y;
    if (!g.moved && Math.hypot(dx, dy) < 6) return;
    g.moved = true;
    const next = clampCentre(g.cx + dx, g.cy + dy, layout.stage);
    dragRef.current = next;
    setDrag(next);
  }

  function onPointerUp(e: React.PointerEvent<HTMLButtonElement>) {
    const g = gesture.current;
    gesture.current = null;
    const at = dragRef.current;
    dragRef.current = null;
    if (!g || g.id !== e.pointerId || !g.moved || !at || !layout) {
      setDrag(null);
      return; // a tap: the click opens it
    }
    suppressClick.current = true;
    setDrag(null);
    if (canHide && overDismiss(at.cx, at.cy, layout.stage)) {
      // Into the ×: it shrinks away there, then hides.
      setLeaving(dismissTarget(layout.stage));
      window.setTimeout(() => {
        hiddenRef.current = true;
        setHidden(true);
        setLeaving(null);
        setUndo(true);
        writeLampHidden(true);
      }, 320);
      return;
    }
    const next = settle(at.cx, at.cy, layout.stage);
    setPlace(next);
    writeLampPlace(next);
    if (next.kind === "edge") setFlash({ id: Date.now(), edge: next.edge, box: boxFor(next, layout.stage) });
  }

  function onPointerCancel() {
    gesture.current = null;
    dragRef.current = null;
    setDrag(null);
  }

  function onClick() {
    if (suppressClick.current) {
      suppressClick.current = false;
      return;
    }
    onToggle();
  }

  // The End chip sits beside the lamp, on the page's side of a tab.
  let chip: { left: number; top: number } | null = null;
  if (live && !open && box && !drag) {
    const c = 30;
    const gap = 10;
    const midY = box.top + box.height / 2 - c / 2;
    const midX = box.left + box.width / 2 - c / 2;
    if (tabEdge === "left") chip = { left: box.left + box.width + gap, top: midY };
    else if (tabEdge === "top") chip = { left: midX, top: box.top + box.height + gap };
    else if (tabEdge === "bottom") chip = { left: midX, top: box.top - gap - c };
    else if (tabEdge === "right") chip = { left: box.left - gap - c, top: midY };
    else {
      const leftSide = box.left - gap - c;
      chip = { left: leftSide >= 8 ? leftSide : box.left + box.width + gap, top: midY };
    }
  }

  // Before the first measure (server render, first paint) the CSS places it,
  // exactly as before it could move.
  const lampPosition: React.CSSProperties = box
    ? { left: box.left, top: box.top, width: box.width, height: box.height, right: "auto", bottom: "auto" }
    : lift !== null && !open
      ? { bottom: lift }
      : {};

  const lampClass = [
    styles.lamp,
    placed ? styles.placed : "",
    open ? styles.lampOpen : "",
    live ? styles.lampLive : "",
    drag ? styles.dragging : "",
    drag && hintEdge ? styles[`lean_${hintEdge}`] : "",
    tabEdge ? `${styles.tab} ${styles[`tab_${tabEdge}`]}` : "",
    leaving ? styles.leaving : "",
    over ? styles.overTarget : "",
    "fixed z-[45] grid h-11 w-11 place-items-center",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <>
      <span ref={probeRef} aria-hidden="true" className={styles.insetProbe} />
      <span
        ref={homeRef}
        aria-hidden="true"
        data-producer-lamp-home
        className={`${styles.lamp} ${styles.anchor} ${open ? styles.lampOpen : ""} fixed h-11 w-11`}
        style={lift !== null && !open ? { bottom: lift } : undefined}
      />

      {shown && (
        <button
          type="button"
          ref={lampRef}
          data-producer-lamp
          onClick={onClick}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerCancel}
          aria-label={openLabel}
          aria-expanded={open}
          title={`${name} (${W.moveHint})`}
          style={{ ...lampPosition, "--glow": live ? level : 0 } as React.CSSProperties}
          className={lampClass}
        >
          <span className={styles.glass} aria-hidden="true" />
          <span className={styles.bulb} aria-hidden="true" />
          {live && (
            <span className={styles.ripples} aria-hidden="true">
              <span className={styles.ripple} />
              <span className={`${styles.ripple} ${styles.ripple2}`} />
            </span>
          )}
          {tabEdge
            ? (unseenCards > 0 || dot > 0) && <span className={styles.tabDot} aria-label={newCardsLabel} />
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

      {/* Voice is live with the sheet closed: the one-tap way to turn it off. */}
      {live && !open && (
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

      {/* Dragging: where it will land as a tab, and the × that hides it. */}
      {drag && hintBox && hintEdge && (
        <span
          aria-hidden="true"
          className={`${styles.edgeHint} ${styles[`hint_${hintEdge}`]}`}
          style={{ left: hintBox.left, top: hintBox.top, width: hintBox.width, height: hintBox.height }}
        />
      )}
      {drag && canHide && target && (
        <div
          aria-hidden="true"
          className={`${styles.dropTarget} ${over ? styles.dropOver : ""}`}
          style={{ left: target.cx - 28, top: target.cy - 28 }}
        >
          <svg viewBox="0 0 16 16" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
            <path d="M4 4l8 8M12 4l-8 8" />
          </svg>
          <span className={styles.dropLabel}>{W.hide}</span>
        </div>
      )}

      {/* Landing on an edge: a flash of light runs along it. */}
      {flash && (
        <span
          key={flash.id}
          aria-hidden="true"
          className={`${styles.edgeFlash} ${styles[`flash_${flash.edge}`]}`}
          style={{ left: flash.box.left, top: flash.box.top, width: flash.box.width, height: flash.box.height }}
        />
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
