"use client";

import { useEffect, useRef, useState } from "react";
import { spotSelector, type Spot } from "@/lib/producer/spots";
import styles from "./producer-lamp.module.css";

// Where the Producer is standing (2026-09-25, operator: "the generator lights
// with a very thin light at the bottom edge of the generator. So the user
// knows where the assistant is standing. (This must be applied on everything
// on the page)").
//
// A lit spot is drawn as a fixed-position line laid along the bottom edge of
// every element on the page marked with that spot (lib/producer/spots.ts),
// followed frame by frame while it is lit, so it stays on the element as the
// page scrolls or the composer grows. The element itself is never restyled:
// the light sits on top of the page, so no designed surface changes for it.
// A spot that isn't on the current page simply lights nothing.

export type LitSpot = { spot: Spot; id?: string | null; until: number };

type Line = { key: string; left: number; top: number; width: number };

const MAX_ELEMENTS = 6;

export function Spotlight({ lit }: { lit: LitSpot[] }) {
  const [lines, setLines] = useState<Line[]>([]);
  const litRef = useRef(lit);
  useEffect(() => {
    litRef.current = lit;
  }, [lit]);

  useEffect(() => {
    if (lit.length === 0) {
      setLines([]);
      return;
    }
    let frame = 0;
    const tick = () => {
      const now = Date.now();
      const next: Line[] = [];
      for (const s of litRef.current) {
        if (s.until < now) continue;
        const els = Array.from(document.querySelectorAll(spotSelector(s.spot, s.id))).slice(0, MAX_ELEMENTS);
        els.forEach((el, i) => {
          const r = el.getBoundingClientRect();
          if (r.width < 24 || r.bottom < 0 || r.top > window.innerHeight) return;
          // Inset a little so the light reads as the element's edge, not a rule
          // across the page, and sits just inside rounded corners.
          const inset = Math.min(18, r.width * 0.06);
          next.push({
            key: `${s.spot}:${s.id ?? ""}:${i}`,
            left: r.left + inset,
            top: Math.min(r.bottom, window.innerHeight) - 1,
            width: r.width - inset * 2,
          });
        });
      }
      setLines((prev) =>
        prev.length === next.length &&
        prev.every((p, i) => p.key === next[i].key && p.left === next[i].left && p.top === next[i].top && p.width === next[i].width)
          ? prev
          : next,
      );
      if (litRef.current.some((s) => s.until >= now)) frame = requestAnimationFrame(tick);
      else setLines([]);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [lit]);

  return (
    <>
      {lines.map((l) => (
        <span
          key={l.key}
          aria-hidden="true"
          className={styles.spot}
          style={{ left: l.left, top: l.top, width: l.width }}
        />
      ))}
    </>
  );
}
