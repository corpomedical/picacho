import Link from "next/link";
import { QuietVideo } from "@/components/quiet-video";
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
  /** Videos cannot be drawn by <img>; they need the poster-frame treatment. */
  isVideo?: boolean;
  label: string;
  detail: string | null;
  /** The node the page is about, drawn in the accent. */
  current?: boolean;
  /**
   * Made FROM the current node. Derivatives are SIBLINGS of each other, not a
   * sequence: a split and an upscale both come from this take, neither from
   * the other. So no arrow is drawn between two of them — the first
   * implementation put one between every pair and thereby claimed the upscale
   * was made from the split, which is simply untrue of the data.
   */
  derivative?: boolean;
};

export function LineageChain({
  nodes,
  title,
}: {
  nodes: LineageNode[];
  title: string;
}) {
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
        {nodes.map((node, i) => {
          // An arrow means "made from the thing on its left". True along the
          // upstream chain and into the first derivative; false between two
          // derivatives, which are siblings.
          const previous = nodes[i - 1];
          const showArrow = i > 0 && !(node.derivative && previous?.derivative);
          return (
            <li
              key={node.id}
              className="flex flex-shrink-0 items-center gap-2.5"
            >
              {showArrow && (
                <span aria-hidden className="text-sm text-atelier-muted">
                  →
                </span>
              )}
              <Node node={node} />
            </li>
          );
        })}
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
      <div className="relative h-11 w-14 flex-shrink-0 overflow-hidden rounded-[8px] bg-atelier-stage">
        {node.thumb && isRenderableUrl(node.thumb) ? (
          node.isVideo ? (
            // A video URL in an <img> is a guaranteed broken image, and an
            // upscale — the commonest derivative — is always a video, so the
            // last node in a chain broke every time (operator, 2026-09-04).
            // The #t=0.1 fragment is the same one the History grid uses to
            // make Android's WebView paint a real frame instead of a grey
            // system play tile.
            <QuietVideo
              pending="disc"
              src={`${node.thumb}#t=0.1`}
              muted
              playsInline
              preload="metadata"
              className="h-full w-full object-cover"
            />
          ) : (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={node.thumb}
              alt=""
              className="h-full w-full object-cover"
              loading="lazy"
            />
          )
        ) : (
          // Nothing to show — a split still rendering, or one that failed.
          // An empty charcoal square reads as broken; a glyph reads as "not
          // yet", which is what it is.
          <span
            aria-hidden
            className="absolute inset-0 flex items-center justify-center text-[#a39a88]"
          >
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth={1.5}
              className="h-4 w-4"
            >
              <rect x="3" y="5" width="18" height="14" rx="2" />
              <path d="m5 17 4.5-4.5 3.5 3.5 3-3 3 4" />
            </svg>
          </span>
        )}
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
export function lineageThumb(
  resultUrl: string | null,
  contentType: string | null,
): string | null {
  const url = toMediaUrl(resultUrl);
  if (!url || !isRenderableUrl(url)) return null;
  // Videos keep the stable URL (a <video> poster frame is not worth a second
  // request here at 56px); images go through the resizer.
  return contentType === "image" ? (thumbUrl(url, 320) ?? url) : url;
}
