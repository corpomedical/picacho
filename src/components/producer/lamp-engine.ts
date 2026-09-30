// The lamp's motion, run outside React (2026-09-30, operator: "The light bulb
// and how it sticks in the corner, the animation feels cheap" → the draft's
// "A · Tuck"). movable-lamp.tsx decides where the lamp lives; this draws it
// getting there, frame by frame, without a React render per frame:
//
// - In the hand it follows the finger on every frame (lifted, stretched a
//   touch along a fast move, its light lagging a little), drawn toward a
//   corner or a side it comes near, and the side or corner shows where it
//   would go.
// - Let go, it flies on springs (lamp-motion.ts) played as Web Animations on
//   the compositor: position, lift, the light's place, the shadow and the
//   reflection, all from one set of samples, so they keep time even when the
//   page is busy. A flight picked up halfway starts from where it is.
// - Tucked into an edge, the edge shows a thin warm line where it went in; it
//   brightens at the moment of contact and when a mouse makes the lamp peek.

import {
  RADIUS,
  cornerCentre,
  isSideEdge,
  magnet,
  overDismiss,
  type Edge,
  type Point,
  type Pull,
  type Stage,
  type Tuckable,
} from "./lamp-place";
import { FLY, flight, flightFrames, poseOf, sampleAt, settleParts, still, velocityOf, type Motion, type Spring } from "./lamp-motion";

export type LampLayout = { stage: Stage; home: Point; tuckable: Tuckable; vw: number; vh: number };
/** Where a tucked lamp's edge line is drawn, and how bright. */
export type Seam = { edge: Edge; along: number; level: number };

type Run = { samples: Motion[]; anims: Animation[]; to: Point };
type Grip = {
  id: number;
  sx: number;
  sy: number;
  /** Where on the lamp it was picked up (from its centre). */
  gx: number;
  gy: number;
  /** Where the finger wants the lamp's centre. */
  px: number;
  py: number;
  moved: boolean;
  held: boolean;
  /** Out of a tuck it comes out under the finger over a moment, not at once. */
  catchT: number;
  last: number;
  samples: { t: number; x: number; y: number }[];
};

const SEAM_LEN = 88;
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

export class LampEngine {
  private layout: LampLayout | null = null;
  private reduced = false;
  private canHide = true;
  /** Where it is when nothing is playing. */
  private m: Motion | null = null;
  private pull: Pull | null = null;

  private lamp: HTMLElement | null = null;
  private inner: HTMLElement | null = null;
  private seam: HTMLElement | null = null;
  private hint: HTMLElement | null = null;
  private drop: HTMLElement | null = null;
  private dropOverClass: string;
  private run: Run | null = null;
  private grip: Grip | null = null;
  private raf = 0;
  private angle = 0;
  private seamAt: Seam | null = null;
  private seamAnims: Animation[] = [];

  constructor(dropOverClass: string) {
    this.dropOverClass = dropOverClass;
  }

  /** What it needs to know about the page: the stage, motion reduced, whether it may be hidden. */
  configure(c: { layout: LampLayout | null; reduced: boolean; canHide: boolean }): void {
    this.layout = c.layout;
    this.reduced = c.reduced;
    this.canHide = c.canHide;
  }

  /** Whether a finger (or the mouse) has it. */
  inHand(): boolean {
    return this.grip !== null;
  }

  /** Whether it has been placed yet. */
  placed(): boolean {
    return this.m !== null;
  }

  /** The elements it draws with; true when the lamp itself is a new one (just shown). */
  attach(els: { lamp: HTMLElement | null; inner: HTMLElement | null; seam: HTMLElement | null; hint: HTMLElement | null; drop: HTMLElement | null }): boolean {
    const fresh = els.lamp !== this.lamp;
    if (fresh) this.cancelRun();
    this.lamp = els.lamp;
    this.inner = els.inner;
    this.seam = els.seam;
    this.hint = els.hint;
    this.drop = els.drop;
    return fresh;
  }

  private part(name: string): HTMLElement | null {
    return this.lamp?.querySelector<HTMLElement>(`[data-part="${name}"]`) ?? null;
  }

  /** Draws the lamp as it is at one moment of motion. */
  write(m: Motion, opacity = 1): void {
    const L = this.layout;
    if (!L || !this.lamp) return;
    const pose = poseOf(this.reduced ? { ...m, vx: 0, vy: 0, slx: 0, sly: 0 } : m, L.stage, this.angle);
    this.angle = pose.angle;
    this.lamp.style.translate = pose.translate;
    if (this.inner) {
      this.inner.style.transform = pose.inner;
      this.inner.style.opacity = opacity === 1 ? "" : String(opacity);
    }
    const light = this.part("light");
    if (light) {
      light.style.translate = pose.lightTranslate;
      light.style.scale = pose.lightScale;
    }
    const set = (name: string, v: number) => {
      const el = this.part(name);
      if (el) el.style.opacity = String(v);
    };
    set("gloss", pose.gloss);
    set("shadowRest", pose.shadowRest);
    set("shadowLifted", pose.shadowLifted);
    const pool = this.part("pool");
    if (pool) pool.style.translate = pose.poolTranslate;
  }

  private cancelRun(): void {
    if (!this.run) return;
    for (const a of this.run.anims) a.cancel();
    this.run = null;
  }

  /** Where the lamp is right now, mid-flight included. */
  current(): Motion | null {
    const run = this.run;
    if (run && run.anims[0] && run.anims[0].playState === "running") {
      const t = Number(run.anims[0].currentTime ?? 0);
      return sampleAt(run.samples, t);
    }
    return this.m ? { ...this.m } : null;
  }

  /** Stops a flight where it is, and draws it there. */
  halt(): Motion | null {
    const m = this.current();
    this.cancelRun();
    if (m) {
      this.m = m;
      this.write(m);
    }
    return m;
  }

  /** Whether it is resting at `to`, or already flying there. */
  headingTo(to: Point): boolean {
    const end = this.run ? this.run.to : this.m;
    return !!end && Math.abs(end.x - to.x) < 0.5 && Math.abs(end.y - to.y) < 0.5;
  }

  /** Puts it somewhere at once (the first paint, a resize, a lamp shown again). */
  jump(to: Point, seam: Seam | null): void {
    this.cancelRun();
    this.m = still(to);
    this.write(this.m);
    this.showSeam(seam, false, 0);
  }

  /**
   * Flies it to `to` on `spring`, starting from `from` (a throw) or from
   * wherever it is. `seam` is the edge line to show when it arrives; `landing`
   * lights it at the moment of contact and, for a park, warms the page once.
   * `fade` shrinks it away (into the hide target). Returns the flight's length (ms).
   */
  fly(
    to: Point,
    spring: Spring = FLY,
    opts: { from?: Motion | null; seam?: Seam | null; landing?: "tuck" | "park" | null; lift?: number; fade?: boolean } = {},
  ): number {
    const L = this.layout;
    if (!L || !this.lamp) return 0;
    const start = opts.from ?? this.current() ?? still(to);
    this.cancelRun();
    const lift = opts.lift ?? 0;
    if (this.reduced) {
      this.m = still(to, 0);
      this.write(this.m);
      this.showSeam(opts.seam ?? null, false, 0);
      return 0;
    }
    const samples = flight(start, to, spring, lift);
    const fr = flightFrames(samples, L.stage);
    const end = samples[samples.length - 1];
    this.m = { ...end };
    this.write(end);
    const timing: KeyframeAnimationOptions = { duration: fr.durationMs, easing: "linear" };
    const anims: Animation[] = [this.lamp.animate(fr.lamp, timing)];
    const add = (el: HTMLElement | null, frames: Keyframe[]) => {
      if (el) anims.push(el.animate(frames, timing));
    };
    add(this.inner, fr.inner);
    add(this.part("light"), fr.light);
    add(this.part("gloss"), fr.gloss);
    add(this.part("shadowRest"), fr.shadowRest);
    add(this.part("shadowLifted"), fr.shadowLifted);
    add(this.part("pool"), fr.pool);
    if (opts.fade && this.inner) anims.push(this.inner.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 300, easing: "ease-in", fill: "forwards" }));
    const run: Run = { samples, anims, to };
    this.run = run;
    anims[0].onfinish = () => {
      if (this.run === run) this.run = null;
    };
    const contact = opts.landing === "tuck" && fr.contactMs >= 0 ? fr.contactMs : -1;
    this.showSeam(opts.seam ?? null, opts.landing === "tuck", contact >= 0 ? contact : fr.durationMs * 0.5);
    if (opts.landing === "park") {
      this.part("flash")?.animate([{ opacity: 0 }, { opacity: 0.55, offset: 0.22 }, { opacity: 0 }], {
        duration: 900,
        delay: Math.max(0, fr.durationMs * 0.55),
        easing: "ease-out",
      });
    }
    return fr.durationMs;
  }

  // -- The edge line where a tucked lamp went in -----------------------------

  private placeSeam(edge: Edge, along: number): void {
    const s = this.seam?.style;
    const L = this.layout;
    if (!s || !L) return;
    const st = L.stage;
    if (isSideEdge(edge)) {
      s.width = "2px";
      s.height = `${SEAM_LEN}px`;
      s.left = `${edge === "right" ? st.right - 2 : st.left}px`;
      s.top = `${along - SEAM_LEN / 2}px`;
    } else {
      s.width = `${SEAM_LEN}px`;
      s.height = "2px";
      s.top = `${edge === "top" ? st.top : st.bottom - 2}px`;
      s.left = `${along - SEAM_LEN / 2}px`;
    }
    s.background = isSideEdge(edge)
      ? "linear-gradient(180deg, rgba(255,216,172,0), rgba(255,216,172,0.95) 50%, rgba(255,216,172,0))"
      : "linear-gradient(90deg, rgba(255,216,172,0), rgba(255,216,172,0.95) 50%, rgba(255,216,172,0))";
  }

  /** Shows (or hides) the edge line; `pulse` flares it at `atMs`, the moment the lamp touches. */
  showSeam(seam: Seam | null, pulse: boolean, atMs: number): void {
    const el = this.seam;
    if (!el) return;
    for (const a of this.seamAnims) a.cancel();
    this.seamAnims = [];
    const was = Number(el.style.opacity || 0);
    if (!seam) {
      el.style.opacity = "0";
      if (was > 0.01 && !this.reduced) this.seamAnims.push(el.animate([{ opacity: was }, { opacity: 0 }], { duration: 200, easing: "ease-out" }));
      this.seamAt = null;
      return;
    }
    const moved = !this.seamAt || this.seamAt.edge !== seam.edge || Math.abs(this.seamAt.along - seam.along) > 1;
    this.placeSeam(seam.edge, seam.along);
    this.seamAt = seam;
    el.style.opacity = String(seam.level);
    el.style.scale = "";
    if (this.reduced) return;
    if (pulse) {
      const side = isSideEdge(seam.edge);
      const stretch = side ? "1 1.7" : "1.7 1";
      this.seamAnims.push(
        el.animate(
          [
            { opacity: moved ? 0 : was, scale: "1 1" },
            { opacity: 1, scale: stretch, offset: 0.25 },
            { opacity: seam.level, scale: "1 1" },
          ],
          { duration: 820, delay: Math.max(0, atMs - 60), easing: "cubic-bezier(0.2, 0.7, 0.2, 1)", fill: "backwards" },
        ),
      );
    } else if (Math.abs(was - seam.level) > 0.01 || moved) {
      this.seamAnims.push(el.animate([{ opacity: moved ? 0 : was }, { opacity: seam.level }], { duration: 240, easing: "ease-out" }));
    }
  }

  // -- In the hand -------------------------------------------------------------

  /** Picked up (a press: it may become a drag, a tap or a hold). */
  grab(p: { id: number; x: number; y: number; t: number }, fromTuck: boolean): void {
    const m = this.halt() ?? (this.layout ? still(this.layout.home) : null);
    if (!m) return;
    this.m = m;
    this.grip = {
      id: p.id,
      sx: p.x,
      sy: p.y,
      // From a tuck it comes out under the finger; otherwise it keeps its grip.
      gx: fromTuck ? 0 : p.x - m.x,
      gy: fromTuck ? 0 : p.y - m.y,
      px: m.x,
      py: m.y,
      moved: false,
      held: false,
      catchT: fromTuck ? 0.24 : 0,
      last: performance.now(),
      samples: [{ t: p.t, x: p.x, y: p.y }],
    };
    cancelAnimationFrame(this.raf);
    this.raf = requestAnimationFrame(this.tick);
  }

  /** The finger moved; "started" when this move made it a drag. */
  follow(id: number, x: number, y: number, t: number): "started" | "moving" | null {
    const g = this.grip;
    if (!g || g.id !== id || g.held) return null;
    if (!g.moved && Math.hypot(x - g.sx, y - g.sy) < 6) return null;
    const started = !g.moved;
    g.moved = true;
    g.px = x - g.gx;
    g.py = y - g.gy;
    g.samples.push({ t, x, y });
    if (g.samples.length > 12) g.samples.shift();
    return started ? "started" : "moving";
  }

  /** Held still long enough to talk: it stays where it is. */
  hold(): void {
    if (this.grip) this.grip.held = true;
  }

  /** Let go: where it was and how fast the finger threw it (null when it wasn't in hand). */
  release(id: number, t: number): { m: Motion; vx: number; vy: number; moved: boolean } | null {
    const g = this.grip;
    if (!g || g.id !== id) return null;
    this.grip = null;
    cancelAnimationFrame(this.raf);
    this.raf = 0;
    this.previewOff();
    const m = this.m ?? still({ x: g.px, y: g.py });
    if (g.moved && !g.held && this.layout) {
      // Let go from where the finger is, even if no frame was drawn there yet.
      const L = this.layout;
      const p = magnet(g.px, g.py, L.stage, L.home, L.tuckable);
      m.x = clamp(p.x, L.stage.left, L.stage.right);
      m.y = clamp(p.y, L.stage.top, L.stage.bottom);
    }
    const v = g.moved && !g.held ? velocityOf(g.samples, t) : { vx: 0, vy: 0 };
    this.m = m;
    return { m: { ...m }, vx: v.vx, vy: v.vy, moved: g.moved && !g.held };
  }

  /** Let go without a throw (a cancelled press). */
  letGo(): void {
    this.grip = null;
    cancelAnimationFrame(this.raf);
    this.raf = 0;
    this.previewOff();
  }

  private previewOff(): void {
    if (this.hint) this.hint.style.opacity = "0";
    this.drop?.classList.remove(this.dropOverClass);
  }

  private tick = (now: number) => {
    const g = this.grip;
    const L = this.layout;
    const m = this.m;
    if (!g || !L || !m) return;
    const dt = clamp((now - g.last) / 1000, 0.001, 0.05);
    g.last = now;
    let over = false;
    if (g.moved && !g.held) {
      const pull = magnet(g.px, g.py, L.stage, L.home, L.tuckable);
      this.pull = pull;
      const tx = clamp(pull.x, L.stage.left, L.stage.right);
      const ty = clamp(pull.y, L.stage.top, L.stage.bottom);
      const k = g.catchT > 0 ? 1 - Math.exp(-dt / 0.05) : 1;
      g.catchT -= dt;
      const nx = m.x + (tx - m.x) * k;
      const ny = m.y + (ty - m.y) * k;
      m.vx += ((nx - m.x) / dt - m.vx) * 0.3;
      m.vy += ((ny - m.y) / dt - m.vy) * 0.3;
      m.x = nx;
      m.y = ny;
      over = this.canHide && overDismiss(m.x, m.y, L.stage);
      this.preview(pull, m, over);
    } else {
      m.vx *= 0.5;
      m.vy *= 0.5;
    }
    // Pressed it sinks a touch; in the hand it lifts; over the hide target it shrinks.
    settleParts(m, dt, !g.moved ? (g.held ? 0 : -0.7) : over ? -4 : 1);
    this.write(m, over ? 0.8 : 1);
    this.raf = requestAnimationFrame(this.tick);
  };

  /** While dragging: where it would go if let go now. */
  private preview(pull: Pull, m: Motion, over: boolean): void {
    this.drop?.classList.toggle(this.dropOverClass, over);
    const L = this.layout;
    if (!L) return;
    if (this.hint) {
      if (pull.corner && !over) {
        const at = pull.corner === "home" ? L.home : cornerCentre(pull.corner, L.stage, L.home);
        this.hint.style.translate = `${at.x - RADIUS}px ${at.y - RADIUS}px`;
        this.hint.style.opacity = (Math.pow(pull.cornerPull, 0.55) * 0.9).toFixed(3);
      } else {
        this.hint.style.opacity = "0";
      }
    }
    if (pull.edge && !over) {
      const along = isSideEdge(pull.edge) ? m.y : m.x;
      for (const a of this.seamAnims) a.cancel();
      this.seamAnims = [];
      this.placeSeam(pull.edge, along);
      this.seamAt = { edge: pull.edge, along, level: 0.6 * pull.edgePull };
      if (this.seam) {
        this.seam.style.opacity = (0.6 * pull.edgePull).toFixed(3);
        this.seam.style.scale = "";
      }
    } else if (this.seamAt && this.seam) {
      // Out of an edge's reach (or pulled out of a tuck): the line goes.
      this.seam.style.opacity = "0";
      this.seamAt = null;
    }
  }

  /** Stops everything (the lamp went away). */
  destroy(): void {
    cancelAnimationFrame(this.raf);
    this.raf = 0;
    this.grip = null;
    this.cancelRun();
    for (const a of this.seamAnims) a.cancel();
    this.seamAnims = [];
  }
}
