"use client";

import Link from "next/link";
import { QuietVideo } from "@/components/quiet-video";
import { useEffect, useState, type SVGProps } from "react";
import { Badge } from "@/components/ui/badge";
import { LocalDate } from "@/components/local-date";
import { MediaActionBar } from "@/components/media-action-bar";
import { formatMsg } from "@/lib/i18n/format";

export type GalleryItem = {
  id: string;
  prompt_input: string;
  status: string;
  result_url: string | null;
  // The untouched original, for the viewer and its download — result_url may
  // be a resized thumb (images pages pass thumbUrl for grid weight). Falls
  // back to result_url when absent.
  full_url?: string | null;
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

// Shared grid for the Media/Images/Videos pages — a square thumbnail grid so
// browsing feels like a media library rather than a chronological list.
//
// Tapping a finished tile opens the media RIGHT HERE, in a full-screen
// viewer with the download control — it no longer detours through the
// History detail page (operator call, 2026-08-21: "this is just a media
// section that opens the images and videos directly"). History remains the
// place for pipeline logs and metadata; unfinished/mock tiles still link
// there, because progress and logs are exactly what you want for those.
export function MediaGallery({
  items,
  contentType,
  emptyLabel,
  labels,
}: {
  items: GalleryItem[];
  // Fallback for rows without their own content_type (legacy callers pass
  // homogeneous lists); the mixed Media page relies on per-item types.
  contentType: "image" | "video";
  emptyLabel: string;
  labels: {
    generateOne: string;
    failed: string;
    simulated: string;
    angleCountOther: string;
  };
}) {
  const [viewer, setViewer] = useState<GalleryItem | null>(null);
  // Rows deleted from inside the viewer, hidden without a server round-trip —
  // the next server render won't include them anyway (deleted_at filter).
  const [hiddenIds, setHiddenIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!viewer) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setViewer(null);
    };
    window.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [viewer]);

  const visibleItems = items.filter((i) => !hiddenIds.has(i.id));

  if (visibleItems.length === 0) {
    return (
      <div className="mt-10 flex flex-col items-center justify-center rounded-media border border-dashed border-atelier-rule py-16 text-center">
        <p className="text-sm text-atelier-muted">{emptyLabel}</p>
        <Link href="/app/generate" className="mt-3 text-sm font-medium text-atelier-ink underline decoration-atelier-accent/50 underline-offset-2">
          {labels.generateOne}
        </Link>
      </div>
    );
  }

  const viewerIsVideo = viewer ? (viewer.content_type ?? contentType) === "video" : false;
  const viewerUrl = viewer ? (viewer.full_url ?? viewer.result_url) : null;

  return (
    <>
    <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
      {visibleItems.map((item) => {
        const isVideo = (item.content_type ?? contentType) === "video";
        const hasRealMedia =
          item.status === "succeeded" &&
          Boolean(item.result_url && (item.result_url.startsWith("http") || item.result_url.startsWith("/api/media/")));

        const tileMedia = hasRealMedia ? (
          !isVideo ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={item.result_url!}
              alt={item.prompt_input}
              className="h-full w-full object-cover transition-transform duration-200 group-hover:scale-105"
            />
          ) : (
            <QuietVideo
              // #t fragment: paints the first frame in Android WebView
              // too — see history/page.tsx.
              src={`${item.result_url!}#t=0.1`}
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
        );

        const overlays = (
          <>
            {isVideo && hasRealMedia && (
              // The same white/95 chip the marketing score band and identity
              // labels use — a printed label pinned on the render, constant
              // across themes (bg-white would repaint dark in dark mode).
              <span className="absolute right-2 top-2 flex h-6 w-6 items-center justify-center rounded-full bg-[#faf8f3]/95 text-[#211d16] shadow-sm">
                <PlayIcon className="h-3 w-3" />
              </span>
            )}

            {item.angleCount && item.angleCount > 1 ? (
              <span className="absolute bottom-2 right-2 rounded-full bg-[#faf8f3]/95 px-2 py-0.5 text-[10px] font-semibold tabular-nums text-[#211d16] shadow-sm">
                {formatMsg(labels.angleCountOther, { n: item.angleCount })}
              </span>
            ) : null}

            {!hasRealMedia && (
              <span className="absolute left-2 top-2">
                <Badge tone={item.status === "failed" ? "danger" : "neutral"}>
                  {item.status === "failed" ? labels.failed : labels.simulated}
                </Badge>
              </span>
            )}

            {/* group-focus-visible alongside hover: hover doesn't exist on
                touch or for keyboard users — tabbing to a tile reveals the
                same overlay a mouse hover does. */}
            <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-[#17150f]/85 to-transparent p-2.5 opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100">
              <p className="truncate text-[11px] font-medium text-[#f5f1e9]">{item.prompt_input}</p>
              {/* Caps-label voice for on-media metadata (uppercase is a CSS
                  transform — the rendered string bytes are untouched). */}
              <p className="truncate text-[9px] font-medium uppercase tracking-wider text-[#cfc7b6]">
                {item.characterName} · <LocalDate date={item.created_at} />
              </p>
            </div>
          </>
        );

        // Darkroom stage tile ground — mounted slides on paper, seamless in
        // the dark theme.
        const tileClass =
          "cv-auto group relative aspect-square overflow-hidden rounded-media border border-[#eae6dc]/10 bg-atelier-stage text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-atelier-accent";

        return hasRealMedia ? (
          <button
            key={item.id}
            type="button"
            onClick={() => setViewer(item)}
            aria-label={item.prompt_input}
            className={tileClass}
          >
            {tileMedia}
            {overlays}
          </button>
        ) : (
          <Link key={item.id} href={`/app/history/${item.id}`} aria-label={item.prompt_input} className={tileClass}>
            {tileMedia}
            {overlays}
          </Link>
        );
      })}
    </div>

    {viewer && viewerUrl && (
      <div
        role="dialog"
        aria-modal="true"
        onClick={() => setViewer(null)}
        className="fixed inset-0 z-[95] flex items-center justify-center bg-[#17150f]/95 p-4"
        style={{
          paddingTop: "calc(env(safe-area-inset-top) + 1rem)",
          paddingBottom: "calc(env(safe-area-inset-bottom) + 1rem)",
        }}
      >
        {viewerIsVideo ? (
          <QuietVideo
            pending="spinner"
            src={viewerUrl}
            controls
            autoPlay
            playsInline
            aria-label={viewer.prompt_input}
            onClick={(e) => e.stopPropagation()}
            className="max-h-full max-w-full rounded-media"
          />
        ) : (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={viewerUrl} alt={viewer.prompt_input} className="max-h-full max-w-full rounded-media object-contain" />
        )}
        <div
          className="absolute inset-x-0 z-10 flex justify-center"
          style={{ bottom: "calc(env(safe-area-inset-bottom) + 1.25rem)" }}
        >
          <MediaActionBar
            url={viewerUrl}
            contentType={viewerIsVideo ? "video" : "image"}
            generationId={viewer.id}
            ownerActions
            onDeleted={() => {
              setHiddenIds((prev) => new Set(prev).add(viewer.id));
              setViewer(null);
            }}
          />
        </div>
        <button
          type="button"
          aria-label="Close"
          onClick={() => setViewer(null)}
          className="absolute right-4 flex h-9 w-9 items-center justify-center rounded-full bg-[#f5f1e9]/10 text-[#f5f1e9] backdrop-blur-sm"
          style={{ top: "calc(env(safe-area-inset-top) + 1rem)" }}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="h-4 w-4">
            <path d="M6 6l12 12M18 6L6 18" />
          </svg>
        </button>
      </div>
    )}
    </>
  );
}
