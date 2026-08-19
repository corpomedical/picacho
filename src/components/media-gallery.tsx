import Link from "next/link";
import type { SVGProps } from "react";
import { Badge } from "@/components/ui/badge";
import { LocalDate } from "@/components/local-date";
import { formatMsg } from "@/lib/i18n/format";

export type GalleryItem = {
  id: string;
  prompt_input: string;
  status: string;
  result_url: string | null;
  content_type: string | null;
  created_at: string;
  characterName: string;
  // Set when this tile represents a multi-angle group (the id links to one
  // representative angle's generation row) — shows an "N angles" chip so it
  // reads as one request instead of near-duplicate tiles.
  angleCount?: number;
};

function PlayIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" {...props}>
      <path d="M8 5v14l11-7Z" />
    </svg>
  );
}

// Shared grid for the Images and Videos pages — a square thumbnail grid so
// browsing feels like a media library rather than a chronological list.
// Mock generations (no real result_url yet) still get a tile, just with a
// muted placeholder instead of real media, so the gallery isn't empty while
// real providers are off.
export function MediaGallery({
  items,
  contentType,
  emptyLabel,
  labels,
}: {
  items: GalleryItem[];
  contentType: "image" | "video";
  emptyLabel: string;
  labels: {
    generateOne: string;
    failed: string;
    simulated: string;
    angleCountOther: string;
  };
}) {
  if (items.length === 0) {
    return (
      <div className="mt-10 flex flex-col items-center justify-center rounded-media border border-dashed border-atelier-rule py-16 text-center">
        <p className="text-sm text-atelier-muted">{emptyLabel}</p>
        <Link href="/app/generate" className="mt-3 text-sm font-medium text-atelier-ink underline decoration-atelier-accent/50 underline-offset-2">
          {labels.generateOne}
        </Link>
      </div>
    );
  }

  return (
    <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
      {items.map((item) => {
        const hasRealMedia =
          item.status === "succeeded" &&
          Boolean(item.result_url && (item.result_url.startsWith("http") || item.result_url.startsWith("/api/media/")));

        return (
          <Link
            key={item.id}
            href={`/app/history/${item.id}`}
            // Accessible name for the whole tile. Image tiles at least had
            // the img's alt; video tiles had NO text alternative at all — a
            // <video> contributes nothing to a link's name, so a screen
            // reader announced every video as just "link".
            aria-label={item.prompt_input}
            // Darkroom stage: every tile ground is the same warm charcoal in
            // both themes, so renders read like mounted slides on the light
            // paper chrome and blend into the dark theme seamlessly.
            className="group relative aspect-square overflow-hidden rounded-media border border-[#eae6dc]/10 bg-atelier-stage focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-atelier-accent"
          >
            {hasRealMedia ? (
              contentType === "image" ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={item.result_url!}
                  alt={item.prompt_input}
                  className="h-full w-full object-cover transition-transform duration-200 group-hover:scale-105"
                />
              ) : (
                <video
                  src={item.result_url!}
                  muted
                  playsInline
                  preload="metadata"
                  className="h-full w-full object-cover transition-transform duration-200 group-hover:scale-105"
                />
              )
            ) : (
              <div className="flex h-full w-full items-center justify-center p-3 text-center">
                {/* Fixed Darkroom muted, not a theme token — the stage under
                    it never flips, so neither may the ink sitting on it. */}
                <p className="line-clamp-4 text-[11px] text-[#a39a88]">{item.prompt_input}</p>
              </div>
            )}

            {contentType === "video" && (
              // The same white/95 chip the marketing score band and identity
              // labels use — a printed label pinned on the render, constant
              // across themes (bg-white would repaint dark in dark mode).
              <span className="absolute right-2 top-2 flex h-6 w-6 items-center justify-center rounded-full bg-[#faf8f3]/95 text-[#211d16] shadow-sm">
                <PlayIcon className="h-3 w-3" />
              </span>
            )}

            {item.angleCount && item.angleCount > 1 && (
              <span className="absolute bottom-2 right-2 rounded-full bg-[#faf8f3]/95 px-2 py-0.5 text-[10px] font-semibold tabular-nums text-[#211d16] shadow-sm">
                {formatMsg(labels.angleCountOther, { n: item.angleCount })}
              </span>
            )}

            {!hasRealMedia && (
              <span className="absolute left-2 top-2">
                <Badge tone={item.status === "failed" ? "danger" : "neutral"}>
                  {item.status === "failed" ? labels.failed : labels.simulated}
                </Badge>
              </span>
            )}

            {/* group-focus-visible alongside hover: hover doesn't exist on
                touch or for keyboard users, so the prompt/date metadata was
                simply unreachable there — tabbing to a tile now reveals the
                same overlay a mouse hover does. (The full details remain one
                tap away on the history page either way.) */}
            <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-[#17150f]/85 to-transparent p-2.5 opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100">
              <p className="truncate text-[11px] font-medium text-[#f5f1e9]">{item.prompt_input}</p>
              {/* Caps-label voice for on-media metadata (uppercase is a CSS
                  transform — the rendered string bytes are untouched). */}
              <p className="truncate text-[9px] font-medium uppercase tracking-wider text-[#cfc7b6]">
                {item.characterName} · <LocalDate date={item.created_at} />
              </p>
            </div>
          </Link>
        );
      })}
    </div>
  );
}
