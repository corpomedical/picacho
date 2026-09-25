"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";
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
  settleThrown,
  writeLampHidden,
  writeLampPlace,
  type Box,
  type Edge,
  type Place,
  type Stage,
} from "./lamp-place";
import {
  GLIDE,
  MORPH,
  SWELL,
  cornersFor,
  flight,
  keyframes,
  landing,
  maxStartVelocity,
  pullOf,
  sampleSpring,
  timeAt,
  velocityOf,
  type Corners,
  type Frame,
} from "./lamp-motion";
import { LookInner, lookClasses } from "./lamp-looks";
import type { LampLook, LampMood } from "./lamp-look";

// The lamp you can move (2026-09-25, operator: "The light bulb is disturbing
// some of the buttons", then "Lets make it movable and dismissible. Also, if
// taken to any edge, its lives as an edge tab. Give it nice effects when it
// transitions to an edge tab").
//
// DRAG IT anywhere (mouse, finger or pen; a tap still opens the Producer).
// Near an edge it is drawn toward it, more the closer it gets, and a thin
// light shows on the edge where it would dock. LET GO there — or throw it at
// an edge — and it joins that edge as a slim tab; pull a tab out and it swells
// back into the round lamp under your finger. DROP IT ON × (bottom centre,
// shown while dragging) to hide it, with Undo; Settings > Preferences > Your
// assistant brings it back. It can't be hidden while voice is live — the lamp
// is then the way to see it's listening, and End is beside it.
//
// HOW IT MOVES (2026-09-25, operator: "the animation when sticking to the
// sides looks cheap. Try to make it look premium"; lamp-motion.ts has the
// before and after). Every move is one spring on one clock, played with the
// Web Animations API over the final place React has already set: position,
// size and corners together, started with the finger's own speed, and it
// never passes the wall. A landing glides round, then flattens into the tab
// against the wall; the light crossfades — the old one dims into a blur at
// contact, the new one arrives from a blur as the tab takes shape — and a
// soft warm bloom marks the moment of contact.
//
// While the sheet is open it flies back to its corner, because the wheel
// opens into that corner (producer-lamp.tsx waits for it to land).
//
// WHAT IT LOOKS LIKE (2026-09-25, operator: "I like Two fireflies. Lets try
// that and add Eclipse and The original perfected in the settings for the user
// to select from"): one of three looks (lamp-look.ts, lamp-looks.tsx), in one
// of four moods (idle, listening, talking, thinking) that producer-lamp.tsx
// works out from the voice loop and the answer in flight.
//
// Places are computed in lamp-place.ts; HOME is read from an invisible twin
// carrying the lamp's own CSS, so the corner keeps every rule it had: the dock
// lift on a phone, the tab bar in the app, the open-state corner.

const W = {
  hide: "Hide",
  hidden: "Lamp hidden.",
  undo: "Undo",
  bringBack: "Settings → Preferences brings it back.",
  moveHint: "drag to move",
};

/** How long the old shape's light takes to dim out before the new one is drawn. */
const LIGHT_OUT_MS = 110;
/** How far from an edge (the rim's gap, px) its pull is felt while dragging. */
const PULL_ZONE = SNAP_GAP + 26;
const FRAME_MS = 1000 / 60;

type Layout = { stage: Stage; home: { left: number; top: number } };
/**
 * A flight worked out ahead (at the release, where the throw is known), so
 * the light and the glow keep its time: its frames, when the old light
 * should start to dim (outAt), and when the new one should start to arrive.
 */
type Plan = { to: Box; frames: Frame[]; outAt: number; lightDelay: number };

// prefers-reduced-motion, live.
function subscribeReduced(cb: () => void) {
  const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
  mq.addEventListener("change", cb);
  return () => mq.removeEventListener("change", cb);
}
const readReduced = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

function sameBox(a: Box, b: Box): boolean {
  return (
    Math.abs(a.left - b.left) < 0.5 &&
    Math.abs(a.top - b.top) < 0.5 &&
    Math.abs(a.width - b.width) < 0.5 &&
    Math.abs(a.height - b.height) < 0.5
  );
}

/** The corners an element is drawn with right now (mid-flight included), as the browser draws them. */
function cornersNow(el: HTMLElement, box: Box): Corners {
  const cs = getComputedStyle(el);
  const r = [cs.borderTopLeftRadius, cs.borderTopRightRadius, cs.borderBottomRightRadius, cs.borderBottomLeftRadius].map(
    (v) => Math.max(0, parseFloat(v) || 0),
  );
  // Radii that overflow a side are scaled down together (CSS's own rule) —
  // a tab's page side keeps its full width.
  const fit = Math.min(
    1,
    box.width / (r[0] + r[1] || 1),
    box.height / (r[1] + r[2] || 1),
    box.width / (r[2] + r[3] || 1),
    box.height / (r[3] + r[0] || 1),
  );
  return [r[0] * fit, r[1] * fit, r[2] * fit, r[3] * fit];
}

export function MovableLamp({
  name,
  open,
  onToggle,
  live,
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
}: {
  name: string;
  open: boolean;
  onToggle: () => void;
  /** Voice is on: the lamp follows the sound and can't be hidden. */
  live: boolean;
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
}) {
  const [place, setPlace] = useState<Place>({ kind: "home" });
  const [hidden, setHidden] = useState(false);
  const [layout, setLayout] = useState<Layout | null>(null);
  const [placed, setPlaced] = useState(false);
  const [drag, setDrag] = useState<{ cx: number; cy: number } | null>(null);
  const [leaving, setLeaving] = useState<{ cx: number; cy: number } | null>(null);
  const [undo, setUndo] = useState(false);
  // What the look draws: round, or a tab on this edge. It follows the place a
  // beat behind — the old light dims out first (lightOut) — so the light is
  // never drawn for a shape the lamp isn't.
  const [shapeEdge, setShapeEdge] = useState<Edge | null>(null);
  const [lightOut, setLightOut] = useState(false);
  const [contact, setContact] = useState<{ id: number; edge: Edge; x: number; y: number; delay: number } | null>(null);
  const reduced = useSyncExternalStore(subscribeReduced, readReduced, () => false);

  const homeRef = useRef<HTMLSpanElement>(null);
  const probeRef = useRef<HTMLSpanElement>(null);
  const hiddenRef = useRef(false);
  const dragRef = useRef<{ cx: number; cy: number } | null>(null);
  const gesture = useRef<{ id: number; x: number; y: number; cx: number; cy: number; moved: boolean } | null>(null);
  const samples = useRef<{ t: number; x: number; y: number }[]>([]);
  const suppressClick = useRef(false);
  const animRef = useRef<Animation | null>(null);
  const lastRef = useRef<{ box: Box; corners: Corners; edge: Edge | null } | null>(null);
  // Where the flight under way set off from (a flight retargeted before its
  // first frame keeps its start: opening from a tab on a phone moves home).
  const flightFromRef = useRef<{ box: Box; corners: Corners; edge: Edge | null } | null>(null);
  const planRef = useRef<Plan | null>(null);
  // When the flight under way wants the old light to start dimming (ms).
  const outAtRef = useRef(0);

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

  // Moves animate only once it has been placed: no flight across the screen
  // on the first paint. A timer, not a frame: a hidden tab paints no frames.
  useEffect(() => {
    if (!layout || placed) return;
    const t = window.setTimeout(() => setPlaced(true), 60);
    return () => window.clearTimeout(t);
  }, [layout, placed]);

  useEffect(() => {
    if (!contact) return;
    const t = window.setTimeout(() => setContact(null), contact.delay + 1100);
    return () => window.clearTimeout(t);
  }, [contact]);

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

  // The light follows the shape: dim the old one, then draw the new (the
  // new one's fade-in is timed by --light-delay, set with the flight).
  useEffect(() => {
    if (tabEdge === shapeEdge) {
      if (!lightOut) return;
      const lift = window.setTimeout(() => setLightOut(false), 0);
      return () => window.clearTimeout(lift);
    }
    if (!placed || reduced) {
      const now = window.setTimeout(() => setShapeEdge(tabEdge), 0);
      return () => window.clearTimeout(now);
    }
    const outAt = outAtRef.current;
    const dim = window.setTimeout(() => setLightOut(true), outAt);
    const swap = window.setTimeout(() => {
      setShapeEdge(tabEdge);
      setLightOut(false);
    }, outAt + LIGHT_OUT_MS);
    return () => {
      window.clearTimeout(dim);
      window.clearTimeout(swap);
    };
  }, [tabEdge, shapeEdge, placed, reduced, lightOut]);

  // Every change of place is one spring, played over the place React has
  // already set (the final left/top/width/height are inline), so an
  // interrupted flight simply starts the next one from wherever it is.
  const hasBox = box !== null;
  const bl = box?.left ?? 0;
  const bt = box?.top ?? 0;
  const bw = box?.width ?? 0;
  const bh = box?.height ?? 0;
  const dragging = drag !== null;
  useLayoutEffect(() => {
    const el = lampRef.current;
    if (!hasBox) return;
    const to: Box = { left: bl, top: bt, width: bw, height: bh };
    const toCorners = cornersFor(to, tabEdge);
    const prev = lastRef.current;
    if (prev && sameBox(prev.box, to) && prev.edge === tabEdge) return;
    lastRef.current = { box: to, corners: toCorners, edge: tabEdge };
    const plan = planRef.current;
    planRef.current = null;
    if (!el || !prev || !placed || reduced || sameBox(prev.box, to)) return;

    let from = prev.box;
    let fromCorners = prev.corners;
    let fromEdge = prev.edge;
    const running = animRef.current;
    // In the hand it follows the finger exactly; a swell out of a tab keeps
    // going under it (it animates only the transform).
    if (dragging && prev.edge === null) return;
    const start = flightFromRef.current;
    if (running && running.playState === "running" && !dragging && start && Number(running.currentTime ?? 0) < FRAME_MS) {
      // Retargeted before it drew a frame: the same flight, to the new place.
      from = start.box;
      fromCorners = start.corners;
      fromEdge = start.edge;
      running.cancel();
    } else if (running && running.playState === "running") {
      const cs = getComputedStyle(el);
      from = {
        left: parseFloat(cs.left) || from.left,
        top: parseFloat(cs.top) || from.top,
        width: parseFloat(cs.width) || from.width,
        height: parseFloat(cs.height) || from.height,
      };
      fromCorners = cornersNow(el, from);
      running.cancel();
    }
    animRef.current = null;

    if (dragging) {
      // The first moment out of a tab: it swells from the tab into the round
      // lamp under the finger.
      const progress = sampleSpring(SWELL);
      const cx = from.left + from.width / 2 - (to.left + to.width / 2);
      const cy = from.top + from.height / 2 - (to.top + to.height / 2);
      const frames = progress.map((p) => {
        const q = 1 - p;
        const sx = (from.width / to.width) * q + p;
        const sy = (from.height / to.height) * q + p;
        return {
          transformOrigin: "50% 50%",
          transform: `translate(${(cx * q).toFixed(2)}px, ${(cy * q).toFixed(2)}px) scale(${sx.toFixed(3)}, ${sy.toFixed(3)})`,
        };
      });
      animRef.current = el.animate(frames, { duration: (frames.length - 1) * FRAME_MS, easing: "linear" });
      outAtRef.current = 0;
      el.style.setProperty("--light-delay", "40ms");
      return;
    }

    // Worked out at the release (a drop, with the throw), or now: a landing
    // on an edge glides round and flattens at the wall; leaving a tab, the
    // shape swells first and the glide follows a beat later; any other move
    // is one glide.
    let run: Plan;
    if (plan && sameBox(plan.to, to) && sameBox(plan.frames[0], from)) run = plan;
    else if (tabEdge && layout && fromEdge !== tabEdge) {
      const st = layout.stage;
      const wallAt = tabEdge === "right" ? st.right : tabEdge === "left" ? st.left : tabEdge === "bottom" ? st.bottom : st.top;
      const l = landing(from, to, tabEdge, wallAt, 0);
      run = { to, frames: l.frames, outAt: l.contactMs, lightDelay: Math.max(0, l.shapedMs - l.contactMs - LIGHT_OUT_MS) };
    } else if (fromEdge && !tabEdge) {
      const shape = sampleSpring(MORPH);
      const move = [0, 0, 0, 0, 0, ...sampleSpring(GLIDE)];
      run = { to, frames: flight(from, fromCorners, to, toCorners, move, shape), outAt: 0, lightDelay: Math.max(0, timeAt(shape, 0.5) - LIGHT_OUT_MS) };
    } else {
      const move = sampleSpring(GLIDE);
      run = { to, frames: flight(from, fromCorners, to, toCorners, move), outAt: 0, lightDelay: 0 };
    }
    outAtRef.current = run.outAt;
    flightFromRef.current = { box: from, corners: fromCorners, edge: fromEdge };
    animRef.current = el.animate(keyframes(run.frames), { duration: (run.frames.length - 1) * FRAME_MS, easing: "linear" });
    // When the new shape's light starts to arrive: set on the element (React
    // never writes this property) for the look's .roundBox/.tabBox and the
    // tab's spill.
    el.style.setProperty("--light-delay", `${Math.round(run.lightDelay)}ms`);
  }, [hasBox, bl, bt, bw, bh, tabEdge, dragging, placed, reduced, layout, lampRef]);

  const near = drag && layout ? nearestEdge(drag.cx, drag.cy, layout.stage) : null;
  const canHide = !live;
  const over = drag !== null && layout !== null && canHide && overDismiss(drag.cx, drag.cy, layout.stage);
  const target = layout ? dismissTarget(layout.stage) : null;
  // Near an edge it is drawn toward it, continuously (0 far, 1 touching).
  const pull = drag && near && !over && !reduced ? pullOf(near.gap, PULL_ZONE) : 0;

  function onPointerDown(e: React.PointerEvent<HTMLButtonElement>) {
    suppressClick.current = false;
    if (open || !layout || e.button !== 0) return;
    const r = e.currentTarget.getBoundingClientRect();
    // From a tab, the lamp forms under the finger; from the round lamp, it
    // keeps the offset it was picked up with.
    const fromTab = tabEdge !== null;
    gesture.current = {
      id: e.pointerId,
      x: e.clientX,
      y: e.clientY,
      cx: fromTab ? e.clientX : r.left + r.width / 2,
      cy: fromTab ? e.clientY : r.top + r.height / 2,
      moved: false,
    };
    samples.current = [{ t: e.timeStamp, x: e.clientX, y: e.clientY }];
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
    samples.current.push({ t: e.timeStamp, x: e.clientX, y: e.clientY });
    if (samples.current.length > 8) samples.current.shift();
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
    const { vx, vy } = velocityOf(samples.current, e.timeStamp);
    const next = settleThrown(at.cx, at.cy, vx, vy, layout.stage);
    setPlace(next);
    writeLampPlace(next);

    // The landing, worked out now while the throw is known: its frames (the
    // glide starts with the throw's speed along the trip), when the old
    // light dims (at contact), when the new one arrives (as the tab takes
    // shape), and the glow at the moment of contact.
    const from: Box = { left: at.cx - BULB / 2, top: at.cy - BULB / 2, width: BULB, height: BULB };
    const to = next.kind === "home" ? null : boxFor(next, layout.stage);
    if (!to || reduced) return;
    const dx = to.left + to.width / 2 - at.cx;
    const dy = to.top + to.height / 2 - at.cy;
    const dist = Math.hypot(dx, dy);
    const along = dist > 1 ? Math.max(0, (vx * dx + vy * dy) / dist) : 0;
    const velocity = dist > 1 ? along / dist : 0;
    if (next.kind === "edge") {
      const st = layout.stage;
      const edge = next.edge;
      const wallAt = edge === "right" ? st.right : edge === "left" ? st.left : edge === "bottom" ? st.bottom : st.top;
      const l = landing(from, to, edge, wallAt, velocity);
      planRef.current = {
        to,
        frames: l.frames,
        outAt: l.contactMs,
        lightDelay: Math.max(0, l.shapedMs - l.contactMs - LIGHT_OUT_MS),
      };
      const x = edge === "right" ? st.right : edge === "left" ? st.left : to.left + to.width / 2;
      const y = edge === "top" ? st.top : edge === "bottom" ? st.bottom : to.top + to.height / 2;
      setContact({ id: e.timeStamp, edge, x, y, delay: Math.round(l.contactMs + 40) });
    } else {
      const move = sampleSpring(GLIDE, Math.min(velocity, maxStartVelocity(GLIDE)));
      const round = cornersFor(from, null);
      planRef.current = { to, frames: flight(from, round, to, round, move), outAt: 0, lightDelay: 0 };
    }
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

  // In the hand: lifted a touch; near an edge, drawn toward it — thinner
  // across, a little longer along, pulled a few pixels in. Grows with
  // closeness, so it never switches.
  let dragTransform: React.CSSProperties | null = null;
  if (drag && near) {
    const lift1 = 1.06;
    const side = near.edge === "left" || near.edge === "right";
    const across = 1 - 0.1 * pull;
    const alongE = 1 + 0.05 * pull;
    const shift = 5 * pull;
    const tx = near.edge === "right" ? shift : near.edge === "left" ? -shift : 0;
    const ty = near.edge === "bottom" ? shift : near.edge === "top" ? -shift : 0;
    const sx = (side ? across : alongE) * lift1;
    const sy = (side ? alongE : across) * lift1;
    dragTransform = over
      ? null
      : {
          transform: `translate(${tx.toFixed(2)}px, ${ty.toFixed(2)}px) scale(${sx.toFixed(3)}, ${sy.toFixed(3)})`,
          transformOrigin: `${near.edge === "left" ? "left" : near.edge === "right" ? "right" : "center"} ${near.edge === "top" ? "top" : near.edge === "bottom" ? "bottom" : "center"}`,
        };
  }

  // Before the first measure (server render, first paint) the CSS places it,
  // exactly as before it could move.
  const lampPosition: React.CSSProperties = box
    ? {
        left: box.left,
        top: box.top,
        width: box.width,
        height: box.height,
        right: "auto",
        bottom: "auto",
        borderRadius: cornersFor(box, tabEdge).map((c) => `${c}px`).join(" "),
      }
    : lift !== null && !open
      ? { bottom: lift }
      : {};

  const lampClass = [
    styles.lamp,
    placed ? styles.placed : "",
    open ? styles.lampOpen : "",
    live ? styles.lampLive : "",
    drag ? styles.dragging : "",
    shapeEdge ? `${styles.tab} ${styles[`tab_${shapeEdge}`]}` : "",
    lightOut ? styles.lightOut : "",
    leaving ? styles.leaving : "",
    over ? styles.overTarget : "",
    lookClasses(look, mood, shapeEdge !== null),
    "fixed z-[45] grid h-11 w-11 place-items-center",
  ]
    .filter(Boolean)
    .join(" ");

  // Where it would dock if let go now: a thin light on the edge, as strong as the pull.
  let dockHint: React.CSSProperties | null = null;
  if (drag && near && layout && !over && near.gap <= SNAP_GAP) {
    const s = layout.stage;
    const len = 72;
    const thick = 3;
    dockHint =
      near.edge === "right" || near.edge === "left"
        ? { left: near.edge === "right" ? s.right - thick : s.left, top: drag.cy - len / 2, width: thick, height: len }
        : { top: near.edge === "bottom" ? s.bottom - thick : s.top, left: drag.cx - len / 2, width: len, height: thick };
    // Fully lit where a drop docks; with motion reduced there's no pull, so it
    // is simply on.
    dockHint.opacity = reduced ? 1 : Math.min(1, 0.45 + pull);
  }

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
          // --glow: the look's light, worked out by the parent (producer-lamp.tsx).
          // (--light-delay is set on the element by the flight, above.)
          style={{ ...lampPosition, ...(dragTransform ?? {}), "--glow": level } as React.CSSProperties}
          className={lampClass}
        >
          <LookInner look={look} tab={shapeEdge !== null} edge={shapeEdge} />
          {shapeEdge
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

      {/* Dragging: where it would dock, and the × that hides it. */}
      {dockHint && <span aria-hidden="true" className={styles.dockHint} style={dockHint} />}
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

      {/* Landing on an edge: a soft warm bloom where it touches, then gone. */}
      {contact && (
        <span
          key={contact.id}
          aria-hidden="true"
          className={`${styles.contactGlow} ${contact.edge === "left" || contact.edge === "right" ? styles.alongY : styles.alongX}`}
          style={
            contact.edge === "left" || contact.edge === "right"
              ? { left: contact.x - 18, top: contact.y - 60, width: 36, height: 120, animationDelay: `${contact.delay}ms` }
              : { left: contact.x - 60, top: contact.y - 18, width: 120, height: 36, animationDelay: `${contact.delay}ms` }
          }
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
