"use client";

import { useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";

// A single stop in the tour. targetId, when set, must match a
// data-tour-id="..." attribute on some element already in the DOM (see
// generate-form.tsx and app-sidebar.tsx) — the tour measures that element's
// live position every render, it never hardcodes coordinates. targetId null
// means a centered, un-anchored stop (welcome/closing messages).
export type TourStep = {
  targetId: string | null;
  title: string;
  body: string;
};

type Rect = { top: number; left: number; width: number; height: number };

const PAD = 22; // breathing room between the target's real edge and the spotlight — generous, so it's obvious what's highlighted
const GAP = 20; // balloon distance from the target
const BALLOON_MAX_WIDTH = 320;
const CORNER_RADIUS = 26; // spotlight + ring corner radius
const BLUR_SOFTNESS = 46; // feGaussianBlur stdDeviation — a wide, gradual falloff instead of a tight one
const TWEEN_MS = 420;
// Apple's system blue (light-mode value) — used for the primary action, the
// one spot of color against an otherwise grayscale UI, same as iOS/macOS
// coach marks and alerts.
const SYSTEM_BLUE = "#0A84FF";
const SYSTEM_BLUE_HOVER = "#0870dc";

function clamp(v: number, min: number, max: number) {
  return Math.min(Math.max(v, min), max);
}

function easeOutCubic(t: number) {
  return 1 - Math.pow(1 - t, 3);
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
  const maskUid = useId().replace(/[:]/g, "");
  const maskId = `tour-mask-${maskUid}`;
  const blurId = `tour-blur-${maskUid}`;

  // Rendered via a portal to <body> — the composer's own root element uses
  // transform-gpu/isolate (see generate-form.tsx, a Safari corner-radius
  // fix), which creates a new containing block for any `position: fixed`
  // descendant and would trap this overlay inside the composer's bounds
  // instead of covering the real viewport. Same reasoning, same fix as the
  // sidebar's settings popover (app-sidebar.tsx). mounted guards against
  // calling document.body during SSR, where it doesn't exist.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  // The target's real, current position — only ever set to an ACTUAL
  // measurement or explicitly to null for a step that intentionally has no
  // target (welcome/closing). Never bounced to null "in between" while
  // waiting to find the next step's target — that transient null was what
  // made the spotlight and the balloon's tail flicker out and back in on
  // every step change instead of gliding.
  const [rect, setRect] = useState<Rect | null>(null);

  useLayoutEffect(() => {
    if (!step.targetId) {
      setRect(null);
      return;
    }
    let cancelled = false;
    function measure() {
      if (cancelled) return;
      const el = document.querySelector(`[data-tour-id="${step.targetId}"]`);
      if (!el) return; // keep showing the previous target until this one exists
      const r = el.getBoundingClientRect();
      setRect({ top: r.top - PAD, left: r.left - PAD, width: r.width + PAD * 2, height: r.height + PAD * 2 });
      el.scrollIntoView({ block: "center", behavior: "smooth" });
    }
    measure();
    const timers = [setTimeout(measure, 60), setTimeout(measure, 160), setTimeout(measure, 380)];
    window.addEventListener("resize", measure);
    return () => {
      cancelled = true;
      timers.forEach(clearTimeout);
      window.removeEventListener("resize", measure);
    };
  }, [step.targetId, index]);

  // displayRect is what's actually drawn — smoothly tweened toward `rect`
  // every time it changes, on a single requestAnimationFrame loop, so the
  // spotlight, its ring, and the balloon all glide together as one motion
  // instead of a CSS transition (which can't animate the SVG mask below)
  // or an instant jump.
  const [displayRect, setDisplayRect] = useState<Rect | null>(null);
  const displayRectRef = useRef<Rect | null>(null);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    if (!rect) {
      displayRectRef.current = null;
      setDisplayRect(null);
      return;
    }
    const from = displayRectRef.current ?? rect;
    const to = rect;
    const start = performance.now();
    function tick(now: number) {
      const t = clamp((now - start) / TWEEN_MS, 0, 1);
      const eased = easeOutCubic(t);
      const next: Rect = {
        top: from.top + (to.top - from.top) * eased,
        left: from.left + (to.left - from.left) * eased,
        width: from.width + (to.width - from.width) * eased,
        height: from.height + (to.height - from.height) * eased,
      };
      displayRectRef.current = next;
      setDisplayRect(next);
      if (t < 1) rafRef.current = requestAnimationFrame(tick);
    }
    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [rect]);

  function goNext() {
    if (isLast) {
      onFinish();
    } else {
      onNext();
    }
  }

  const vw = typeof window !== "undefined" ? window.innerWidth : 375;
  const vh = typeof window !== "undefined" ? window.innerHeight : 800;
  const balloonWidth = Math.min(BALLOON_MAX_WIDTH, vw - 32);
  const r = displayRect && displayRect.width > 0 && displayRect.height > 0 ? displayRect : null;

  // Balloon placement — below the target when there's room, otherwise
  // above; clamped so it never runs off-screen sideways. placeBelow also
  // decides which edge of the balloon the notch sits on.
  let placeBelow = true;
  let balloonLeft = (vw - balloonWidth) / 2;
  let balloonStyle: CSSProperties = { top: "50%", left: "50%", transform: "translate(-50%, -50%)" };
  if (r) {
    const spaceBelow = vh - (r.top + r.height);
    placeBelow = spaceBelow > 200 || r.top < 220;
    balloonLeft = clamp(r.left, 16, Math.max(16, vw - balloonWidth - 16));
    balloonStyle = placeBelow
      ? { top: r.top + r.height + GAP, left: balloonLeft }
      : { top: Math.max(16, r.top - GAP), left: balloonLeft, transform: "translateY(-100%)" };
  }

  // Notch anchor — lined up with the target's own horizontal center,
  // clamped to stay over the balloon. Nested inside the balloon itself (not
  // positioned separately in page coordinates), so it can never drift out
  // of sync with it or disappear on its own.
  const notchX = r ? clamp(r.left + r.width / 2 - balloonLeft, 28, balloonWidth - 28) : balloonWidth / 2;

  if (!mounted) return null;

  return createPortal(
    <div className="fixed inset-0 z-[100]" role="dialog" aria-modal="true" aria-label={step.title}>
      {/* Hidden SVG defs — a full-viewport mask with a soft rounded-rect
          hole cut over the target (or no hole at all for a centered step).
          A blurred SVG mask, not a CSS gradient, is what gives the hole's
          edge a genuinely smooth falloff that closely fits a rounded-rect
          control instead of an approximate ellipse. */}
      <svg width="0" height="0" className="absolute" aria-hidden focusable="false">
        <defs>
          <filter id={blurId} x="-150%" y="-150%" width="400%" height="400%">
            <feGaussianBlur stdDeviation={BLUR_SOFTNESS} />
          </filter>
          <mask id={maskId} maskUnits="userSpaceOnUse" x="0" y="0" width={vw} height={vh}>
            <rect x="0" y="0" width={vw} height={vh} fill="#fff" />
            {r && (
              <rect
                x={r.left}
                y={r.top}
                width={r.width}
                height={r.height}
                rx={CORNER_RADIUS}
                ry={CORNER_RADIUS}
                fill="#000"
                filter={`url(#${blurId})`}
              />
            )}
          </mask>
        </defs>
      </svg>

      <div
        className="absolute inset-0 bg-black/45 backdrop-blur-md"
        style={{ WebkitMaskImage: `url(#${maskId})`, maskImage: `url(#${maskId})` }}
      />

      {r && (
        <div
          className="pointer-events-none absolute ring-[1.5px] ring-white/90"
          style={{
            top: r.top,
            left: r.left,
            width: r.width,
            height: r.height,
            borderRadius: CORNER_RADIUS,
            // A soft ambient halo around the crisp ring, the same kind of
            // gentle focus glow tvOS/macOS use to draw the eye to whatever's
            // highlighted — it's what makes the spotlight read clearly as
            // "this, specifically" rather than just a faint outline.
            boxShadow: "0 0 0 1px rgba(255,255,255,0.15), 0 0 32px 6px rgba(255,255,255,0.35)",
          }}
        />
      )}

      {/* Speech balloon — a frosted-glass card (Apple's "material" look:
          translucent white + backdrop blur, a hairline edge instead of a
          hard border) with a small fused notch on whichever edge faces the
          target. The notch is a child of the balloon, not a separately-
          positioned element, so it always moves and appears with it as one
          piece. */}
      <div
        className="absolute w-80 max-w-[calc(100vw-32px)] rounded-[24px] bg-white/90 p-4 shadow-[0_24px_60px_-16px_rgba(0,0,0,0.4)] ring-1 ring-black/[0.04] backdrop-blur-2xl"
        style={balloonStyle}
      >
        {r && (
          <span
            aria-hidden
            className="absolute rounded-[4px] bg-white/90"
            style={{
              width: 16,
              height: 16,
              left: notchX - 8,
              ...(placeBelow ? { top: -7 } : { bottom: -7 }),
              transform: "rotate(45deg)",
            }}
          />
        )}

        <p className="font-[system-ui] text-[15px] font-semibold tracking-[-0.01em] text-neutral-900">
          {step.title}
        </p>
        <p className="mt-1.5 font-[system-ui] text-[13.5px] leading-relaxed tracking-[-0.005em] text-neutral-500">
          {step.body}
        </p>
        <div className="mt-4 flex items-center justify-between">
          <div className="flex gap-1.5" aria-hidden="true">
            {steps.map((_, i) => (
              <span
                key={i}
                className={
                  i === index
                    ? "h-1.5 w-1.5 rounded-full bg-neutral-900 transition-colors"
                    : "h-1.5 w-1.5 rounded-full bg-neutral-300/70 transition-colors"
                }
              />
            ))}
          </div>
          <div className="flex items-center gap-4">
            {!isLast && (
              <button
                type="button"
                onClick={onFinish}
                className="font-[system-ui] text-[13px] text-neutral-400 transition-colors hover:text-neutral-600"
              >
                {skip}
              </button>
            )}
            <button
              type="button"
              onClick={goNext}
              className="rounded-full px-4 py-[7px] font-[system-ui] text-[13px] font-medium text-white transition-colors"
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
