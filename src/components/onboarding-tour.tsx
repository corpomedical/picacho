"use client";

import { useEffect, useRef, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";

// A single stop in the tour. targetId, when set, must match a
// data-tour-id="..." attribute on some element already in the DOM (see
// generate-form.tsx and app-sidebar.tsx) — the tour measures that element's
// live position every frame, it never hardcodes coordinates. targetId null
// means a centered, un-anchored stop (welcome/closing messages).
export type TourStep = {
  targetId: string | null;
  title: string;
  body: string;
};

type Rect = { top: number; left: number; width: number; height: number };

const PAD = 22; // breathing room between the target's real edge and the spotlight
const GAP = 20; // balloon distance from the target
const BALLOON_MAX_WIDTH = 320;
const CORNER_RADIUS = 26; // spotlight + ring corner radius
const SCRIM = "rgba(0,0,0,0.5)";
const SCRIM_FEATHER = 40; // soft falloff at the spotlight's edge, in px
// Apple's system blue (light-mode value) — used for the primary action, the
// one spot of color against an otherwise grayscale UI, same as iOS/macOS
// coach marks and alerts.
// Atelier ink (see --color-atelier-ink in globals.css) — the primary action
// follows the app's ink-filled button idiom, and the CSS variable means the
// Darkroom theme resolves it automatically. Ochre stays reserved for proof:
// here, the progress dots. The hover mixes a step of paper into the ink,
// standing in for the ink/90 hover the utility classes use elsewhere.
const SYSTEM_BLUE = "var(--color-atelier-ink)";
const SYSTEM_BLUE_HOVER =
  "color-mix(in srgb, var(--color-atelier-ink) 88%, var(--color-atelier-paper))";

const ENTER_MS = 260;
const EXIT_MS = 190;
const TEXT_FADE_MS = 150;

// Exponential smoothing constant for the spotlight. Higher is snappier; 14
// settles in about a third of a second and reads as deliberate rather than
// floaty. Chosen over a duration-based tween because the target can move
// WHILE we're animating toward it (a smooth scroll is in flight, the composer
// is reflowing behind the overlay) and a tween would have to be restarted
// from scratch each time, which is what made the old spotlight lurch.
// Exponential smoothing just re-aims at the new target on the next frame.
const SMOOTHING = 14;

function clamp(v: number, min: number, max: number) {
  return Math.min(Math.max(v, min), max);
}

function prefersReducedMotion() {
  return typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

export function OnboardingTour({
  steps,
  stepIndex,
  onNext,
  onFinish,
  next,
  skip,
  finish,
}: {
  steps: TourStep[];
  // Controlled, not internal, state — the caller (generate-form.tsx) needs
  // to know which step is showing so it can reveal that step's target (e.g.
  // flip out of hero mode to surface the video model picker) before this
  // component tries to measure it.
  stepIndex: number;
  onNext: () => void;
  onFinish: () => void;
  next: string;
  skip: string;
  finish: string;
}) {
  const index = stepIndex;
  const step = steps[index];
  const isLast = index === steps.length - 1;

  // Rendered via a portal to <body> — the composer's own root element uses
  // transform-gpu/isolate (see generate-form.tsx, a Safari corner-radius
  // fix), which creates a new containing block for any `position: fixed`
  // descendant and would trap this overlay inside the composer's bounds
  // instead of covering the real viewport. Same reasoning, same fix as the
  // sidebar's settings popover (app-sidebar.tsx). mounted guards against
  // calling document.body during SSR, where it doesn't exist.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  // Drives the enter and exit fades. Exiting is deliberately a real state:
  // the tour has to finish fading before the caller unmounts it, otherwise
  // it vanishes on the frame the button is clicked, which is the single
  // cheapest-looking thing an overlay can do.
  const [phase, setPhase] = useState<"entering" | "open" | "leaving">("entering");
  useEffect(() => {
    const id = requestAnimationFrame(() => setPhase("open"));
    return () => cancelAnimationFrame(id);
  }, []);

  // Which step's text is actually painted. Trails stepIndex by one fade so
  // the words cross-dissolve instead of snapping mid-move.
  const [renderIndex, setRenderIndex] = useState(index);
  const [textVisible, setTextVisible] = useState(true);
  useEffect(() => {
    if (index === renderIndex) return;
    if (prefersReducedMotion()) {
      setRenderIndex(index);
      return;
    }
    setTextVisible(false);
    const id = setTimeout(() => {
      setRenderIndex(index);
      setTextVisible(true);
    }, TEXT_FADE_MS);
    return () => clearTimeout(id);
  }, [index, renderIndex]);

  const holeRef = useRef<HTMLDivElement | null>(null);
  const scrimRef = useRef<HTMLDivElement | null>(null);
  const ringRef = useRef<HTMLDivElement | null>(null);
  const balloonRef = useRef<HTMLDivElement | null>(null);
  const notchRef = useRef<HTMLSpanElement | null>(null);
  const nextButtonRef = useRef<HTMLButtonElement | null>(null);

  // The animated position, held in a ref rather than state. Nothing about the
  // spotlight's motion goes through React: the loop below writes styles
  // straight to the DOM.
  //
  // This is the single biggest change from the previous version, which called
  // setState on every animation frame and so re-rendered this whole component
  // — SVG mask, balloon, buttons and all — sixty times a second. That is what
  // made the tour feel like it was chugging.
  const currentRef = useRef<Rect | null>(null);
  // Whether the balloon hangs below the target or above it. Decided once when
  // the step changes, not per frame: recomputing it continuously meant that a
  // target drifting past the halfway line during a scroll would flip the
  // balloon back and forth across the screen.
  const placeSideRef = useRef<"below" | "above" | "right" | "left">("below");
  // Whether the current target was actually found in the DOM on the last
  // frame. Going from absent to present is what tells us a late-revealed
  // target has finally landed and its placement needs deciding for real.
  const measuredRef = useRef(false);
  // Set whenever the placement decision needs redoing — on a step change or a
  // resize. The frame loop consumes it and clears it.
  //
  // Without this the decision was made once, on the very first frame of the
  // entire tour, and every later step silently inherited it. A step whose
  // target sits low on the screen therefore still got its balloon placed
  // BELOW that target, which pushed the buttons off the bottom of the
  // viewport and left the tour with no reachable way to advance.
  const placeDirtyRef = useRef(true);
  // Whether the balloon ended up genuinely touching its target, or had to be
  // pushed away to stay on screen. The notch is only honest in the first case.
  const notchValidRef = useRef(true);
  // Only the target id is needed inside the animation loop, and mirroring it
  // into a ref is what lets that loop be set up once and never torn down —
  // depending on `step` directly would restart the loop on every render,
  // since the caller rebuilds its steps array each time it renders.
  const targetIdRef = useRef(step.targetId);
  useEffect(() => {
    targetIdRef.current = step.targetId;
  }, [step.targetId]);

  // Bring the target into view once per step. Measurement doesn't depend on
  // this having finished — the loop re-measures every frame, so the spotlight
  // simply rides the scroll. The old code instead guessed with three fixed
  // timers (60ms, 160ms, 380ms) and so kept sampling positions mid-scroll,
  // which is why it appeared to lunge at its target and overshoot.
  useEffect(() => {
    // FIRST, before any early return. This used to sit at the bottom of the
    // effect, below the `if (!el) return`, and that was a real bug: the
    // multi-angle step's target doesn't exist in the DOM yet when this runs
    // (generate-form only flips the composer into creation mode a render
    // later), so the early return fired, placement was never re-decided, and
    // the balloon kept the PREVIOUS step's side — which is how it ended up
    // sitting on top of the spotlight.
    placeDirtyRef.current = true;

    if (!step.targetId) return;
    const el = document.querySelector(`[data-tour-id="${step.targetId}"]`);
    if (!el) return;
    const r = el.getBoundingClientRect();
    const fullyVisible = r.top >= 80 && r.bottom <= window.innerHeight - 80;
    if (!fullyVisible) {
      el.scrollIntoView({ block: "center", behavior: prefersReducedMotion() ? "auto" : "smooth" });
    }
  }, [step.targetId, index]);

  // Re-decide above-versus-below when the window changes size, since a
  // shorter viewport can turn a placement that fitted into one that doesn't.
  useEffect(() => {
    function onResize() {
      placeDirtyRef.current = true;
    }
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  // One animation loop for the lifetime of the overlay. Every frame it
  // re-measures the live target, eases the drawn rect toward it, and writes
  // the result to the spotlight, ring, balloon and notch together — so they
  // move as one object instead of drifting out of sync with each other.
  //
  // Measuring every frame (rather than on a scroll listener or a
  // ResizeObserver) is what makes this robust: it tracks smooth scrolling,
  // window resizes, and the composer reflowing behind the overlay, with no
  // special case for any of them. It's one getBoundingClientRect per frame.
  useEffect(() => {
    if (!mounted) return;
    let raf = 0;
    let last = performance.now();
    let firstFrame = true;
    const reduce = prefersReducedMotion();

    function frame(now: number) {
      // Clamped so returning to a backgrounded tab doesn't integrate one
      // enormous step and teleport everything.
      const dt = Math.min((now - last) / 1000, 1 / 30);
      last = now;

      const vw = window.innerWidth;
      const vh = window.innerHeight;
      const targetId = targetIdRef.current;

      let goal: Rect | null = null;
      let measured = false;
      if (targetId) {
        const el = document.querySelector(`[data-tour-id="${targetId}"]`);
        if (el) {
          const r = el.getBoundingClientRect();
          goal = { top: r.top - PAD, left: r.left - PAD, width: r.width + PAD * 2, height: r.height + PAD * 2 };
          measured = true;
        } else if (currentRef.current) {
          // Target not in the DOM yet (the caller is still revealing it) —
          // hold the last known position rather than collapsing to nothing,
          // which is what used to make the spotlight blink out between steps.
          goal = currentRef.current;
        }
      }

      // A target that only just appeared needs its placement decided against
      // its REAL rect, not the stand-in above. Without this, steps whose
      // target is revealed a render late keep a placement computed from the
      // previous step's geometry.
      if (measured && !measuredRef.current) placeDirtyRef.current = true;
      measuredRef.current = measured;

      const hasTarget = goal !== null;

      if (goal) {
        if (!currentRef.current || firstFrame || reduce) {
          currentRef.current = goal;
        } else {
          // Frame-rate independent easing: the same visual speed at 60Hz and
          // 120Hz, which a naive `current += (target - current) * 0.2` is not.
          const k = 1 - Math.exp(-SMOOTHING * dt);
          const c = currentRef.current;
          currentRef.current = {
            top: c.top + (goal.top - c.top) * k,
            left: c.left + (goal.left - c.left) * k,
            width: c.width + (goal.width - c.width) * k,
            height: c.height + (goal.height - c.height) * k,
          };
        }
      }

      const c = currentRef.current;

      // Spotlight and scrim cross-fade rather than one being torn down: a
      // step with no target (welcome, closing) dims the whole screen, a step
      // with one punches a hole in it.
      if (holeRef.current) {
        holeRef.current.style.opacity = hasTarget ? "1" : "0";
        if (c) {
          holeRef.current.style.transform = `translate3d(${c.left}px, ${c.top}px, 0)`;
          holeRef.current.style.width = `${Math.max(0, c.width)}px`;
          holeRef.current.style.height = `${Math.max(0, c.height)}px`;
        }
      }
      if (scrimRef.current) scrimRef.current.style.opacity = hasTarget ? "0" : "1";

      if (ringRef.current) {
        ringRef.current.style.opacity = hasTarget ? "1" : "0";
        if (c) {
          ringRef.current.style.transform = `translate3d(${c.left}px, ${c.top}px, 0)`;
          ringRef.current.style.width = `${Math.max(0, c.width)}px`;
          ringRef.current.style.height = `${Math.max(0, c.height)}px`;
        }
      }

      // Balloon — positioned with a transform rather than top/left so it
      // composites on the GPU, and so that flipping from below a target to
      // above one is a continuous move instead of the instant jump the old
      // version made when it swapped its CSS `transform` for a different one.
      if (balloonRef.current) {
        const bw = balloonRef.current.offsetWidth || Math.min(BALLOON_MAX_WIDTH, vw - 32);
        const bh = balloonRef.current.offsetHeight || 160;
        let x: number;
        let y: number;

        if (c && hasTarget) {
          const M = 16; // keep this far clear of every viewport edge
          // Decide against where the spotlight is GOING, not where it is
          // mid-glide. On the first frame of a step `c` is still easing away
          // from the previous target, so scoring against it produced a
          // placement chosen for the wrong geometry entirely. Drawing still
          // follows `c`, so the balloon travels with the spotlight.
          const decide = goal ?? c;

          // Placement is chosen by testing candidates, not by rule.
          //
          // Picking a side and then clamping into the viewport isn't enough:
          // on a short window neither side has room, and the clamp then drops
          // the balloon straight onto the spotlight — hiding the exact thing
          // the step is pointing at. So try four positions, score each on how
          // much of the spotlight it would cover, and take the first that
          // covers none of it and didn't need moving to stay on screen.
          const wantsFrom = (r: Rect, side: "below" | "above" | "right" | "left") => ({
            x: side === "right" ? r.left + r.width + GAP : side === "left" ? r.left - GAP - bw : r.left,
            y: side === "below" ? r.top + r.height + GAP : side === "above" ? r.top - GAP - bh : r.top,
          });
          const wants = (side: "below" | "above" | "right" | "left") => wantsFrom(c, side);

          if (placeDirtyRef.current && bh > 0) {
            const order = ["below", "above", "right", "left"] as const;
            let best: { side: (typeof order)[number]; overlap: number } | null = null;

            for (const side of order) {
              const want = wantsFrom(decide, side);
              const cx = clamp(want.x, M, Math.max(M, vw - bw - M));
              const cy = clamp(want.y, M, Math.max(M, vh - bh - M));
              // Area shared between the balloon and the spotlight.
              const ox = Math.max(0, Math.min(cx + bw, decide.left + decide.width) - Math.max(cx, decide.left));
              const oy = Math.max(0, Math.min(cy + bh, decide.top + decide.height) - Math.max(cy, decide.top));
              const overlap = ox * oy;
              const undisturbed = Math.abs(cx - want.x) < 1 && Math.abs(cy - want.y) < 1;

              if (overlap === 0 && undisturbed) {
                best = { side, overlap: 0 };
                break;
              }
              if (!best || overlap < best.overlap) best = { side, overlap };
            }

            placeSideRef.current = best?.side ?? "below";
            placeDirtyRef.current = false;
          }

          const want = wants(placeSideRef.current);
          // Last line of defence: whatever the placement decision, the
          // balloon must stay fully on screen, because its buttons are the
          // only way out of the tour.
          x = clamp(want.x, M, Math.max(M, vw - bw - M));
          y = clamp(want.y, M, Math.max(M, vh - bh - M));

          // The notch only tells the truth when the balloon sits directly
          // above or below its target and hasn't been nudged off that spot.
          const side = placeSideRef.current;
          notchValidRef.current =
            (side === "above" || side === "below") &&
            Math.abs(y - want.y) < 1 &&
            Math.abs(x - want.x) < 1;
        } else {
          x = (vw - bw) / 2;
          y = (vh - bh) / 2;
          notchValidRef.current = false;
        }

        balloonRef.current.style.transform = `translate3d(${Math.round(x)}px, ${Math.round(y)}px, 0)`;

        if (notchRef.current) {
          notchRef.current.style.opacity = hasTarget && notchValidRef.current ? "1" : "0";
          if (c && hasTarget) {
            const nx = clamp(c.left + c.width / 2 - x, 28, bw - 28);
            notchRef.current.style.left = `${nx - 8}px`;
            const below = placeSideRef.current === "below";
            notchRef.current.style.top = below ? "-7px" : `${bh - 9}px`;
          }
        }
      }

      firstFrame = false;
      raf = requestAnimationFrame(frame);
    }

    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [mounted]);

  function close() {
    if (phase === "leaving") return;
    if (prefersReducedMotion()) {
      onFinish();
      return;
    }
    setPhase("leaving");
    setTimeout(onFinish, EXIT_MS);
  }

  function goNext() {
    if (isLast) close();
    else onNext();
  }

  // Keyboard control. The overlay claims aria-modal, so it has to actually
  // behave like a modal: Escape leaves, Enter and the right arrow advance,
  // and Tab is kept inside the balloon's buttons rather than wandering off
  // into the page behind the scrim. The trap is the same first/last-focusable
  // wrap search-dialog.tsx uses — until it existed, the comment above claimed
  // it while Tab actually walked straight out into the dimmed page, which is
  // exactly what aria-modal promises assistive tech can't happen.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        close();
      } else if (e.key === "ArrowRight" || (e.key === "Enter" && e.target === document.body)) {
        e.preventDefault();
        goNext();
      } else if (e.key === "Tab") {
        const balloon = balloonRef.current;
        if (!balloon) return;
        const focusable = balloon.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])',
        );
        if (focusable.length === 0) return;
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        // Focus that's already escaped (or never entered) also gets pulled
        // back in, so the trap can't be defeated by clicking the scrim first.
        const inside = balloon.contains(document.activeElement);
        if (!inside) {
          e.preventDefault();
          first.focus();
        } else if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  // Move focus to the primary action on open and on every step, so the tour
  // is operable by keyboard alone and a screen reader announces each stop.
  useEffect(() => {
    nextButtonRef.current?.focus({ preventScroll: true });
  }, [index]);

  if (!mounted) return null;

  const shown = phase === "open";
  const painted = steps[renderIndex] ?? step;

  const surface: CSSProperties = {
    transition: `opacity ${shown ? ENTER_MS : EXIT_MS}ms cubic-bezier(0.22,1,0.36,1), transform ${
      shown ? ENTER_MS : EXIT_MS
    }ms cubic-bezier(0.22,1,0.36,1)`,
  };

  return createPortal(
    <div
      className="fixed inset-0 z-[100]"
      role="dialog"
      aria-modal="true"
      aria-label={painted.title}
      style={{ opacity: shown ? 1 : 0, transition: `opacity ${shown ? ENTER_MS : EXIT_MS}ms ease-out` }}
    >
      {/* Full-screen dim, shown only on steps that highlight nothing. */}
      <div
        ref={scrimRef}
        className="absolute inset-0"
        style={{ backgroundColor: SCRIM, opacity: 0, transition: "opacity 260ms ease-out" }}
      />

      {/* The spotlight.

          A box-shadow with an enormous spread, NOT an SVG mask. The previous
          version applied `mask-image: url(#svg-mask)` to a plain <div>, which
          Safari does not support at all on non-SVG elements (and Chrome only
          gained in 120). On those browsers no hole was ever cut: the whole
          screen just dimmed and blurred with a white rectangle floating on
          top of it, highlighting nothing. This technique is plain CSS, works
          everywhere, animates on the compositor, and gets the soft edge from
          the shadow's own blur radius rather than an SVG filter. */}
      <div
        ref={holeRef}
        className="absolute left-0 top-0"
        style={{
          borderRadius: CORNER_RADIUS,
          boxShadow: `0 0 ${SCRIM_FEATHER}px 100vmax ${SCRIM}`,
          opacity: 0,
          transition: "opacity 260ms ease-out",
          willChange: "transform, width, height",
        }}
      />

      <div
        ref={ringRef}
        className="pointer-events-none absolute left-0 top-0"
        style={{
          borderRadius: CORNER_RADIUS,
          // A soft ambient halo around a hairline ring — the same gentle
          // focus glow tvOS and macOS use, which is what makes the spotlight
          // read as "this, specifically" rather than a faint outline.
          boxShadow:
            "inset 0 0 0 1.5px rgba(255,255,255,0.9), 0 0 0 1px rgba(255,255,255,0.15), 0 0 32px 6px rgba(255,255,255,0.28)",
          opacity: 0,
          transition: "opacity 260ms ease-out",
          willChange: "transform, width, height",
        }}
      />

      {/* Speech balloon — a raised paper sheet (translucent atelier surface +
          backdrop blur, a hairline ring instead of a hard border) with a
          small fused notch on whichever edge faces the target. The notch is
          a child of the balloon, so it always moves and appears with it as
          one piece. The atelier tokens carry the Darkroom values, so no
          dark: variants are needed here. */}
      <div
        ref={balloonRef}
        className="absolute left-0 top-0 w-80 max-w-[calc(100vw-32px)] rounded-control bg-atelier-surface/95 p-4 shadow-[0_24px_60px_-16px_rgba(33,29,18,0.45)] ring-1 ring-atelier-rule/70 backdrop-blur-2xl"
        style={{
          ...surface,
          opacity: shown ? 1 : 0,
          willChange: "transform",
          // On a short viewport (or with long translated copy) the balloon can
          // still be taller than the screen even when placed optimally. Cap it
          // and let it scroll rather than letting the buttons fall off the
          // bottom — being unable to reach "Next" traps the person in a modal
          // overlay with no way forward.
          maxHeight: "calc(100vh - 32px)",
          overflowY: "auto",
        }}
      >
        <span
          ref={notchRef}
          aria-hidden
          className="absolute h-4 w-4 rotate-45 rounded-[4px] bg-atelier-surface/95"
          style={{ opacity: 0, transition: "opacity 200ms ease-out" }}
        />

        <div
          style={{
            opacity: textVisible ? 1 : 0,
            transform: textVisible ? "translateY(0)" : "translateY(3px)",
            transition: `opacity ${TEXT_FADE_MS}ms ease-out, transform ${TEXT_FADE_MS}ms ease-out`,
          }}
          aria-live="polite"
        >
          <p className="font-[system-ui] text-[15px] font-semibold tracking-[-0.01em] text-atelier-ink">
            {painted.title}
          </p>
          <p className="mt-1.5 font-[system-ui] text-[13.5px] leading-relaxed tracking-[-0.005em] text-atelier-muted">
            {painted.body}
          </p>
        </div>

        <div className="mt-4 flex items-center justify-between">
          <div className="flex gap-1.5" aria-hidden="true">
            {steps.map((_, i) => (
              <span
                key={i}
                className="h-1.5 rounded-full transition-all duration-300 ease-out"
                style={{
                  // The current stop stretches into a short capsule rather
                  // than only changing colour — motion the eye can follow
                  // between steps, so progress is legible at a glance. The
                  // active dot is the balloon's one spot of ochre: proof of
                  // where you are, per the accent's reserved role.
                  width: i === index ? 14 : 6,
                  backgroundColor:
                    i === index ? "var(--color-atelier-accent)" : "var(--color-atelier-rule)",
                }}
              />
            ))}
          </div>
          <div className="flex items-center gap-4">
            {!isLast && (
              <button
                type="button"
                onClick={close}
                className="font-[system-ui] text-[13px] text-atelier-muted transition-colors hover:text-atelier-ink"
              >
                {skip}
              </button>
            )}
            <button
              ref={nextButtonRef}
              type="button"
              onClick={goNext}
              className="rounded-full px-4 py-[7px] font-[system-ui] text-[13px] font-medium text-atelier-paper transition-[background-color,transform] duration-150 active:scale-[0.97]"
              style={{ backgroundColor: SYSTEM_BLUE }}
              onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = SYSTEM_BLUE_HOVER)}
              onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = SYSTEM_BLUE)}
            >
              {isLast ? finish : next}
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
