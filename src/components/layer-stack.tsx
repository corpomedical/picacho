"use client";

import { useMemo, useState } from "react";
import { thumbUrl } from "@/lib/media/url";
import { layerFileName, type LayerBox } from "@/lib/generations/layers";
import { useLocale } from "@/lib/i18n/provider";
import { formatMsg } from "@/lib/i18n/format";

// The layer stack (shape B, 2026-09-03): every delivered layer on a
// checkerboard so transparency is visible, named and z-ordered exactly as
// the provider returned it, each toggleable; the composite on the left is
// the visible layers stacked in z order — a real re-composite, not the
// source image, so hiding the base shows the cutouts alone. Downloads are
// the stored PNGs verbatim (alpha intact), which is the export Higgsfield's
// page does not offer.
export type StackLayer = {
  id: string;
  zIndex: number;
  name: string | null;
  description: string | null;
  url: string;
  width: number | null;
  height: number | null;
  identityScore: number | null;
  /** Where the layer sits on the base, from the provider; null = the base. */
  box: LayerBox | null;
};

export function LayerStack({ layers, tierLabel, generationId }: {
  layers: StackLayer[];
  tierLabel: string;
  generationId: string;
}) {
  const { t } = useLocale();
  const L = t.layers;
  const ordered = useMemo(() => [...layers].sort((a, b) => a.zIndex - b.zIndex), [layers]);
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const toggle = (id: string) =>
    setHidden((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const base = ordered[0];
  const aspect = base?.width && base?.height ? `${base.width} / ${base.height}` : "1 / 1";

  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
      {/* Composite */}
      <div className="rounded-control border border-atelier-rule bg-atelier-surface p-3 shadow-[0_1px_2px_rgba(33,29,22,0.04)]">
        <div className="flex items-baseline justify-between px-1">
          <p className="text-[10px] font-semibold uppercase tracking-widest text-atelier-muted">{L.composite}</p>
          <p className="font-numeral text-[11px] tabular-nums text-atelier-muted">
            {formatMsg(L.stackSub, { n: ordered.length, res: tierLabel })}
          </p>
        </div>
        <div
          className="relative mt-2 w-full overflow-hidden rounded-[10px] bg-[length:16px_16px] bg-[linear-gradient(45deg,#d9d9de_25%,transparent_25%),linear-gradient(-45deg,#d9d9de_25%,transparent_25%),linear-gradient(45deg,transparent_75%,#d9d9de_75%),linear-gradient(-45deg,transparent_75%,#d9d9de_75%)] bg-[position:0_0,0_8px,8px_-8px,-8px_0] [background-color:#f0f0f2]"
          style={{ aspectRatio: aspect }}
        >
          {ordered.map((layer) => {
            if (hidden.has(layer.id)) return null;
            // Each layer PNG is its bounding-box region (at the box's aspect,
            // often upscaled — measured, not assumed), so it is placed at the
            // provider's normalized box, per-mille of the base, and stretched
            // to fit; the base has no box and covers the canvas.
            const b = layer.box?.normalized;
            const style = b
              ? { left: `${b[0] / 10}%`, top: `${b[1] / 10}%`, width: `${(b[2] - b[0]) / 10}%`, height: `${(b[3] - b[1]) / 10}%`, zIndex: layer.zIndex }
              : { inset: 0, width: "100%", height: "100%", zIndex: layer.zIndex };
            return (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                key={layer.id}
                src={thumbUrl(layer.url, 1600) ?? layer.url}
                alt={layer.name ?? L.base}
                className="absolute"
                style={{ ...style, objectFit: b ? "fill" : "contain" }}
                draggable={false}
              />
            );
          })}
        </div>
      </div>

      {/* Stack — top layer first, the way every editor lists them. */}
      <div className="rounded-control border border-atelier-rule bg-atelier-surface p-3 shadow-[0_1px_2px_rgba(33,29,22,0.04)]">
        <div className="flex items-baseline justify-between px-1">
          <p className="text-[10px] font-semibold uppercase tracking-widest text-atelier-muted">{L.stackTitle}</p>
          <a
            href={`/app/layers/${generationId}/download`}
            className="text-[11px] font-semibold text-atelier-accent underline-offset-2 hover:underline"
          >
            {L.downloadAll}
          </a>
        </div>
        <ul className="mt-2 divide-y divide-atelier-rule/70">
          {[...ordered].reverse().map((layer, i) => {
            const isHidden = hidden.has(layer.id);
            return (
              <li key={layer.id} className="flex items-center gap-3 py-2">
                <button
                  type="button"
                  onClick={() => toggle(layer.id)}
                  aria-pressed={!isHidden}
                  title={isHidden ? "Show" : "Hide"}
                  className={
                    "flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-[6px] border text-[10px] transition-colors " +
                    (isHidden
                      ? "border-atelier-rule text-transparent hover:border-atelier-muted"
                      : "border-atelier-ink bg-atelier-ink text-atelier-paper")
                  }
                >
                  ✓
                </button>
                <div
                  className="h-12 w-12 flex-shrink-0 overflow-hidden rounded-[8px] bg-[length:8px_8px] bg-[linear-gradient(45deg,#d9d9de_25%,transparent_25%),linear-gradient(-45deg,#d9d9de_25%,transparent_25%),linear-gradient(45deg,transparent_75%,#d9d9de_75%),linear-gradient(-45deg,transparent_75%,#d9d9de_75%)] bg-[position:0_0,0_4px,4px_-4px,-4px_0] [background-color:#f0f0f2]"
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={thumbUrl(layer.url, 320) ?? layer.url} alt="" className="h-full w-full object-contain" draggable={false} />
                </div>
                <div className="min-w-0 flex-1">
                  <p className={"truncate text-sm " + (isHidden ? "text-atelier-muted line-through" : "text-atelier-ink")}>
                    {layer.name ?? (layer.zIndex === 0 ? L.base : formatMsg(L.layerOf, { i: ordered.length - i, n: ordered.length }))}
                  </p>
                  <p className="truncate text-[11px] text-atelier-muted">
                    <span className="font-numeral tabular-nums">z{layer.zIndex}</span>
                    {layer.width && layer.height ? (
                      <span className="font-numeral tabular-nums"> · {layer.width}×{layer.height}</span>
                    ) : null}
                    {layer.identityScore !== null ? (
                      <span className="font-numeral tabular-nums text-atelier-accent"> · {layer.identityScore}</span>
                    ) : null}
                    {layer.description ? <span> · {layer.description}</span> : null}
                  </p>
                </div>
                <a
                  href={layer.url}
                  download={layerFileName(layer.zIndex, layer.name)}
                  className="flex-shrink-0 rounded-full border border-atelier-rule px-2.5 py-1 text-[11px] font-semibold text-atelier-muted transition-colors hover:border-atelier-muted hover:text-atelier-ink"
                >
                  {L.download}
                </a>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}
