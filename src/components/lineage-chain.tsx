import Link from "next/link";
import { toMediaUrl, thumbUrl, isRenderableUrl } from "@/lib/media/url";

// The lineage chain — direction C, operator pick 2026-09-04.
//
// What this render came from, and what came out of it: the character's
// identity photo, the take it was made from, this one, and everything made
// FROM it (a layers split, an upscale, a layer edit). The studio has recorded
// this all along in source_generation_id; nothing showed it, so a detail page
// was a dead end in a product whose whole structure is derivation.
//
// It renders nothing at all when there is no chain — which is most renders,
// and an empty "Lineage" heading over one tile would be worse than silence.

export type LineageNode = {
  id: string;
  /** null for the identity photo, which is not a generation. */
  href: string | null;
  thumb: string | null;
  label: string;
  detail: string | null;
  /** The node the page is about, drawn in the accent. */
  current?: boolean;
};

export function LineageChain({ nodes, title }: { nodes: LineageNode[]; title: string }) {
  // One node is just "this render" — a chain of one is not a chain.
  if (nodes.length < 2) return null;

  return (
    <section className="mt-6 border-t border-atelier-rule pt-5">
      <h2 className="text-[10.5px] font-semibold uppercase tracking-[0.14em] text-atelier-muted">
        {title}
      </h2>
      {/* Scrolls on its own rather than widening the page: the app has one
          scroller and a long chain must not make the whole page pan. */}
      <ol className="mt-3 flex items-center gap-2.5 overflow-x-auto pb-1">
        {nodes.map((node, i) => (
          <li key={node.id} className="flex flex-shrink-0 items-center gap-2.5">
            {i > 0 && (
              <span aria-hidden className="text-sm text-atelier-muted">
                →
              </span>
            )}
            <Node node={node} />
          </li>
        ))}
      </ol>
    </section>
  );
}

function Node({ node }: { node: LineageNode }) {
  const body = (
    <div
      className={
        node.current
          ? "flex items-center gap-2.5 rounded-[12px] bg-atelier-accent/[0.08] p-1.5 pr-3 shadow-[inset_0_0_0_1px_rgba(180,90,40,0.45)]"
          : "flex items-center gap-2.5 rounded-[12px] border border-atelier-rule bg-atelier-surface p-1.5 pr-3 transition-colors hover:border-atelier-muted"
      }
    >
      <div className="h-11 w-14 flex-shrink-0 overflow-hidden rounded-[8px] bg-atelier-stage">
        {node.thumb && isRenderableUrl(node.thumb) ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={node.thumb} alt="" className="h-full w-full object-cover" loading="lazy" />
        ) : null}
      </div>
      <div className="min-w-0">
        <p
          className={
            node.current
              ? "whitespace-nowrap text-xs font-semibold text-atelier-ink"
              : "whitespace-nowrap text-xs font-medium text-atelier-ink"
          }
        >
          {node.label}
        </p>
        {node.detail && (
          <p
            className={
              node.current
                ? "mt-0.5 whitespace-nowrap font-numeral text-[10px] tabular-nums text-atelier-accent"
                : "mt-0.5 whitespace-nowrap text-[9px] font-semibold uppercase tracking-[0.12em] text-atelier-muted"
            }
          >
            {node.detail}
          </p>
        )}
      </div>
    </div>
  );
  return node.href ? (
    <Link href={node.href} className="block">
      {body}
    </Link>
  ) : (
    body
  );
}

/** Media thumb for a lineage node, or null when the row has nothing to show. */
export function lineageThumb(resultUrl: string | null, contentType: string | null): string | null {
  const url = toMediaUrl(resultUrl);
  if (!url || !isRenderableUrl(url)) return null;
  // Videos keep the stable URL (a <video> poster frame is not worth a second
  // request here at 56px); images go through the resizer.
  return contentType === "image" ? (thumbUrl(url, 320) ?? url) : url;
}
