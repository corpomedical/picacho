"use client";

import { useEffect, useRef } from "react";
import styles from "./producer-lamp.module.css";
import { brightness, newFireflies, stepFireflies, type Fireflies } from "./fireflies";
import type { LampMood } from "./lamp-look";

// Two fireflies, drawn (fireflies.ts moves them). A small canvas a little
// larger than the glass, so a tucked lamp's light can shrink and slide
// without its glow meeting the canvas's own edge; the lamp's round light
// frame clips it to the glass. The two lights and their trails are soft
// radial glows added together, so where they overlap they burn hotter.

const SIZE = 64;

function glow(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, rgb: string, a: number) {
  if (a <= 0.002 || r <= 0.1) return;
  const alpha = Math.min(1, a);
  const g = ctx.createRadialGradient(x, y, 0, x, y, r);
  g.addColorStop(0, `rgba(${rgb},${alpha})`);
  g.addColorStop(0.38, `rgba(${rgb},${alpha * 0.42})`);
  g.addColorStop(1, `rgba(${rgb},0)`);
  ctx.fillStyle = g;
  ctx.fillRect(x - r, y - r, r * 2, r * 2);
}

function trail(ctx: CanvasRenderingContext2D, points: [number, number][], rgb: string, r: number, a: number) {
  for (let j = points.length - 1; j >= 1; j--) {
    const k = 1 - j / points.length;
    glow(ctx, points[j][0], points[j][1], r * (0.55 + 0.45 * k), rgb, a * k * k);
  }
}

function draw(ctx: CanvasRenderingContext2D, dpr: number, f: Fireflies, still: boolean) {
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, SIZE, SIZE);
  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  ctx.translate(SIZE / 2, SIZE / 2);
  const b = brightness(f);
  glow(ctx, f.ax * 0.55, f.ay * 0.55 + 1.5, 23, "255,196,132", 0.24 * b);
  if (!still) {
    trail(ctx, f.trailB, "236,142,112", 5.2, 0.26 * b);
    trail(ctx, f.trailA, "255,202,128", 7.5, 0.26 * b);
  }
  glow(ctx, f.bx, f.by, 6.5, "236,142,112", 0.5 * b);
  glow(ctx, f.bx, f.by, 2.3, "255,214,196", 0.95 * b);
  glow(ctx, f.ax, f.ay, 15, "240,168,98", 0.52 * b);
  glow(ctx, f.ax, f.ay, 6.4, "255,214,160", 0.82 * b);
  glow(ctx, f.ax, f.ay, 2.5, "255,245,226", Math.min(1, b));
  ctx.restore();
}

export function FirefliesLight({ mood, glow: level }: { mood: LampMood; glow: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const input = useRef({ mood, level });
  const wake = useRef<(() => void) | null>(null);

  useEffect(() => {
    input.current = { mood, level };
    wake.current?.();
  }, [mood, level]);

  useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    const dpr = Math.min(3, window.devicePixelRatio || 1);
    canvas.width = Math.round(SIZE * dpr);
    canvas.height = Math.round(SIZE * dpr);
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)");
    const f = newFireflies(input.current.mood);
    let raf = 0;
    let last = performance.now();
    const frame = (now: number) => {
      raf = 0;
      const still = reduce.matches;
      // With motion reduced the lights stand still, drawn once per change of mood.
      const dt = still ? 10 : Math.min(0.05, Math.max(0, (now - last) / 1000));
      last = now;
      stepFireflies(f, dt, input.current.mood, input.current.level);
      draw(ctx, dpr, f, still);
      if (!still) raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    wake.current = () => {
      if (!raf) raf = requestAnimationFrame(frame);
    };
    const onChange = () => wake.current?.();
    reduce.addEventListener("change", onChange);
    return () => {
      cancelAnimationFrame(raf);
      wake.current = null;
      reduce.removeEventListener("change", onChange);
    };
  }, []);

  return <canvas ref={ref} aria-hidden="true" className={styles.fireflies} />;
}
