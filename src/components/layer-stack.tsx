"use client";

import { useMemo, useState, useTransition } from "react";
import { Card } from "@/components/ui/card";
import { useRouter } from "next/navigation";
import { editLayer } from "@/lib/generations/actions";
import { thumbUrl } from "@/lib/media/url";
import { layerEditCreditCost, layerFileName, type LayerBox } from "@/lib/generations/layers";
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
  /** 1 for a layer as delivered; higher once it has been re-rendered. */
  version: number;
  /** What was asked for, on an edited layer. */
  prompt: string | null;
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
  const [editing, setEditing] = useState<string | null>(null);
  // Any layer already carrying a score means this stack came from a
  // character, so an edit here will be measured too.
  const scoredStack = layers.some((l) => l.identityScore !== null);
  const editingLayer = editing ? (layers.find((l) => l.id === editing) ?? null) : null;
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
      <Card pad="sm">
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
      </Card>

      {/* Stack — top layer first, the way every editor lists them. */}
      <Card pad="sm">
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
                    {layer.version > 1 ? (
                      <span className="font-numeral tabular-nums"> · v{layer.version}</span>
                    ) : null}
                    {layer.prompt ? <span> · “{layer.prompt}”</span> : layer.description ? <span> · {layer.description}</span> : null}
                  </p>
                </div>
                {/* The base is what every other layer sits on, so editing
                    it would change the picture underneath a stack still
                    showing the old elements over it. */}
                {layer.zIndex !== 0 && (
                  <button
                    type="button"
                    onClick={() => setEditing(editing === layer.id ? null : layer.id)}
                    aria-expanded={editing === layer.id}
                    className="flex-shrink-0 rounded-full bg-atelier-accent/10 px-2.5 py-1 text-[11px] font-semibold text-atelier-accent shadow-[inset_0_0_0_1px_rgba(180,90,40,0.45)] transition-colors hover:bg-atelier-accent/15"
                  >
                    {L.change}
                  </button>
                )}
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
        {editingLayer && (
          <LayerEditor
            key={editingLayer.id}
            layerId={editingLayer.id}
            credits={layerEditCreditCost(editingLayer.width, editingLayer.height)}
            scored={scoredStack}
            onDone={() => setEditing(null)}
          />
        )}
      </Card>
    </div>
  );
}

// The edit sheet for one layer: say what to change, spend one credit, get a
// new version. Synchronous — about fifteen seconds — so the button holds its
// pending state rather than the page polling for a job.
function LayerEditor({ layerId, credits, scored, onDone }: {
  layerId: string;
  /** Quoted before the button, like every other spend — the layer's own
   *  megapixels decide whether an edit is one credit or two. */
  credits: number;
  scored: boolean;
  onDone: () => void;
}) {
  const { t } = useLocale();
  const L = t.layers;
  const router = useRouter();
  const [prompt, setPrompt] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const submit = () => {
    if (!prompt.trim() || pending) return;
    setError(null);
    startTransition(async () => {
      const form = new FormData();
      form.set("layer_id", layerId);
      form.set("prompt", prompt.trim());
      const result = await editLayer(form);
      if ("error" in result) {
        setError(result.error);
        return;
      }
      onDone();
      router.refresh();
    });
  };

  return (
    <div className="mt-3 rounded-control border border-atelier-rule bg-atelier-ink/[0.03] p-3">
      <label className="text-[10px] font-semibold uppercase tracking-widest text-atelier-muted" htmlFor="layer-edit-prompt">
        {L.changeLabel}
      </label>
      <textarea
        id="layer-edit-prompt"
        autoFocus
        rows={2}
        value={prompt}
        onChange={(e) => setPrompt(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) submit();
          if (e.key === "Escape") onDone();
        }}
        placeholder={L.changePlaceholder}
        disabled={pending}
        className="mt-1.5 w-full resize-none rounded-control border border-atelier-rule bg-atelier-paper px-3 py-2 text-sm text-atelier-ink outline-none placeholder:text-atelier-muted/80 focus:border-atelier-muted disabled:opacity-60"
      />
      <div className="mt-2 flex items-center justify-between gap-3">
        <p className="text-[11px] leading-snug text-atelier-muted">
          {formatMsg(scored ? L.changeScoredNote : L.changeNote, { n: credits })}
        </p>
        <div className="flex flex-shrink-0 gap-2">
          <button
            type="button"
            onClick={onDone}
            disabled={pending}
            className="rounded-full border border-atelier-rule px-3 py-1.5 text-[11px] font-semibold text-atelier-muted transition-colors hover:text-atelier-ink disabled:opacity-50"
          >
            {L.changeCancel}
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={pending || !prompt.trim()}
            className="rounded-full bg-atelier-ink px-3.5 py-1.5 text-[11px] font-semibold text-atelier-paper transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            {pending ? L.changeWorking : formatMsg(L.changeGo, { n: credits })}
          </button>
        </div>
      </div>
      {error && <p className="mt-2 text-xs text-red-600 dark:text-red-400">{error}</p>}
    </div>
  );
}
