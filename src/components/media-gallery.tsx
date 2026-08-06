import Link from "next/link";
import type { SVGProps } from "react";
import { Badge } from "@/components/ui/badge";
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
      <div className="mt-10 flex flex-col items-center justify-center rounded-[18px] border border-dashed border-neutral-200 py-16 text-center">
        <p className="text-sm text-neutral-500">{emptyLabel}</p>
        <Link href="/app/generate" className="mt-3 text-sm font-medium text-neutral-900 underline">
          {labels.generateOne}
        </Link>
      </div>
    );
  }

  return (
    <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
      {items.map((item) => {
        const hasRealMedia = item.status === "succeeded" && Boolean(item.result_url?.startsWith("http"));

        return (
          <Link
            key={item.id}
            href={`/app/history/${item.id}`}
            className="group relative aspect-square overflow-hidden rounded-[14px] border border-neutral-100 bg-neutral-100"
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
              <div className="flex h-full w-full items-center justify-center bg-neutral-100 p-3 text-center">
                <p className="line-clamp-4 text-[11px] text-neutral-400">{item.prompt_input}</p>
              </div>
            )}

            {contentType === "video" && (
              <span className="absolute right-2 top-2 flex h-6 w-6 items-center justify-center rounded-full bg-neutral-950/60 text-white">
                <PlayIcon className="h-3 w-3" />
              </span>
            )}

            {item.angleCount && item.angleCount > 1 && (
              <span className="absolute bottom-2 right-2 rounded-full bg-neutral-950/60 px-2 py-0.5 text-[10px] font-medium text-white">
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

            <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-neutral-950/80 to-transparent p-2.5 opacity-0 transition-opacity group-hover:opacity-100">
              <p className="truncate text-[11px] font-medium text-white">{item.prompt_input}</p>
              <p className="truncate text-[10px] text-neutral-300">
                {item.characterName} · {new Date(item.created_at).toLocaleDateString()}
              </p>
            </div>
          </Link>
        );
      })}
    </div>
  );
}
