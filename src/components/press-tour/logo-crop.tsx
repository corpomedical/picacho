"use client";

import { useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import { clampBox, type Box } from "@/lib/press-tour/door-view";
import { cn } from "@/lib/cn";
import type { PressWords } from "./verdict";
import s from "./press-tour.module.css";

// The logo box on the front photo (spec §1.1; product-import-phone
// artboard, section 3): drag across the photo to draw it, drag the box to
// move it, drag a corner to fit it. By keyboard the box is one focusable
// control: arrows move it, Shift and the arrows change its size. Every value
// is a share of the photo (0..1), exactly what confirmProductCard takes.

type Drag =
  | { kind: "draw"; x0: number; y0: number }
  | { kind: "move"; dx: number; dy: number }
  | { kind: "corner"; corner: "nw" | "ne" | "sw" | "se"; fixedX: number; fixedY: number };

const STEP = 0.01;

export function LogoCrop({ src, box, onChange, m }: { src: string; box: Box | null; onChange: (b: Box | null) => void; m: PressWords }) {
  const frame = useRef<HTMLDivElement>(null);
  const drag = useRef<Drag | null>(null);
  const [ratio, setRatio] = useState<number | null>(null);

  const at = (e: PointerEvent) => {
    const r = frame.current?.getBoundingClientRect();
    if (!r || r.width === 0 || r.height === 0) return { x: 0, y: 0 };
    return { x: Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)), y: Math.min(1, Math.max(0, (e.clientY - r.top) / r.height)) };
  };

  const fromCorners = (ax: number, ay: number, bx: number, by: number): Box =>
    clampBox({ x: Math.min(ax, bx), y: Math.min(ay, by), w: Math.abs(bx - ax), h: Math.abs(by - ay) });

  function start(e: PointerEvent<HTMLElement>, next: Drag) {
    e.preventDefault();
    e.stopPropagation();
    drag.current = next;
    frame.current?.setPointerCapture(e.pointerId);
  }

  function onFramePointerDown(e: PointerEvent<HTMLDivElement>) {
    const p = at(e);
    start(e, { kind: "draw", x0: p.x, y0: p.y });
  }

  function onPointerMove(e: PointerEvent<HTMLDivElement>) {
    const d = drag.current;
    if (!d) return;
    const p = at(e);
    if (d.kind === "draw") onChange(fromCorners(d.x0, d.y0, p.x, p.y));
    else if (d.kind === "move" && box) onChange(clampBox({ ...box, x: p.x - d.dx, y: p.y - d.dy }));
    else if (d.kind === "corner") onChange(fromCorners(d.fixedX, d.fixedY, p.x, p.y));
  }

  function onPointerUp(e: PointerEvent<HTMLDivElement>) {
    if (!drag.current) return;
    drag.current = null;
    if (frame.current?.hasPointerCapture(e.pointerId)) frame.current.releasePointerCapture(e.pointerId);
  }

  function onKey(e: KeyboardEvent<HTMLDivElement>) {
    if (!box) return;
    const dx = e.key === "ArrowLeft" ? -STEP : e.key === "ArrowRight" ? STEP : 0;
    const dy = e.key === "ArrowUp" ? -STEP : e.key === "ArrowDown" ? STEP : 0;
    if (dx === 0 && dy === 0) return;
    e.preventDefault();
    onChange(clampBox(e.shiftKey ? { ...box, w: box.w + dx, h: box.h + dy } : { ...box, x: box.x + dx, y: box.y + dy }));
  }

  const pct = (n: number) => `${n * 100}%`;
  const corners = box
    ? ([
        ["nw", box.x, box.y, box.x + box.w, box.y + box.h],
        ["ne", box.x + box.w, box.y, box.x, box.y + box.h],
        ["sw", box.x, box.y + box.h, box.x + box.w, box.y],
        ["se", box.x + box.w, box.y + box.h, box.x, box.y],
      ] as const)
    : [];

  return (
    <div
      ref={frame}
      className="relative mx-auto mt-2.5 max-h-[320px] w-full touch-none select-none overflow-hidden rounded-xl bg-[#efe6d6]"
      style={{ aspectRatio: ratio ?? 1, maxWidth: ratio ? `${320 * ratio}px` : undefined }}
      onPointerDown={onFramePointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
    >
      {/* eslint-disable-next-line @next/next/no-img-element -- a short-lived private link to the person's own photo */}
      <img
        src={src}
        alt=""
        draggable={false}
        className="pointer-events-none h-full w-full object-fill"
        onLoad={(e) => {
          const img = e.currentTarget;
          if (img.naturalWidth > 0 && img.naturalHeight > 0) setRatio(img.naturalWidth / img.naturalHeight);
        }}
      />
      {box && (
        <div
          role="group"
          tabIndex={0}
          aria-label={m.logoAria}
          onKeyDown={onKey}
          className={s.cropSel}
          style={{ left: pct(box.x), top: pct(box.y), width: pct(box.w), height: pct(box.h) }}
          onPointerDown={(e) => {
            const p = at(e);
            start(e, { kind: "move", dx: p.x - box.x, dy: p.y - box.y });
          }}
        >
          <span aria-hidden="true" className={cn("lock-frame", s.marks)} style={{ inset: -4, ["--lock-arm" as string]: "10px", ["--lock-stroke" as string]: "2.5px" }} />
        </div>
      )}
      {corners.map(([corner, x, y, fx, fy]) => (
        <span
          key={corner}
          aria-hidden="true"
          className={s.handle}
          style={{ left: pct(x), top: pct(y), cursor: corner === "nw" || corner === "se" ? "nwse-resize" : "nesw-resize" }}
          onPointerDown={(e) => start(e, { kind: "corner", corner, fixedX: fx, fixedY: fy })}
        />
      ))}
      <span className="pointer-events-none absolute left-2.5 top-2.5 rounded-[5px] bg-[rgba(240,205,166,0.95)] px-1.5 py-0.5 text-[11px] font-semibold text-[#1a1410]">
        {m.logoTag}
      </span>
    </div>
  );
}
