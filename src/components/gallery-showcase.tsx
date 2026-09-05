"use client";

import { useEffect, useRef, useState } from "react";
import type { SVGProps } from "react";
import { useLocale } from "@/lib/i18n/provider";
import { formatMsg } from "@/lib/i18n/format";
import { useModalFocus } from "@/lib/use-modal-focus";
import { thumbUrl } from "@/lib/media/url";
import { QuietVideo } from "@/components/quiet-video";
import { PicachoMark } from "@/components/picacho-mark";

// The public gallery's grid and viewer (2026-09-05 redesign). The v1 page
// rendered video tiles as bare first-frame <video> elements with no
// controls and no click handler — the operator's report was exact: "you can
// download them but can't play them". This is the fix and the redesign in
// one: poster-first tiles that OPEN, and a darkroom viewer that actually
// plays, with the Picacho mark riding every video (see picacho-mark.tsx).

function PlayIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" {...props}>
      <path d="M8 5v14l11-7Z" />
    </svg>
  );
}

export type ShowcaseItem = {
  id: string;
  prompt: string;
  url: string;
  posterUrl: string | null;
  contentType: "image" | "video";
  score: number | null;
};

export function GalleryShowcase({ items }: { items: ShowcaseItem[] }) {
  const { t } = useLocale();
  const [openIndex, setOpenIndex] = useState<number | null>(null);
  const viewerRef = useRef<HTMLDivElement>(null);
  useModalFocus(openIndex !== null, viewerRef);

  useEffect(() => {
    if (openIndex === null) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpenIndex(null);
      if (e.key === "ArrowRight") setOpenIndex((i) => (i === null ? i : Math.min(items.length - 1, i + 1)));
      if (e.key === "ArrowLeft") setOpenIndex((i) => (i === null ? i : Math.max(0, i - 1)));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [openIndex, items.length]);

  const open = openIndex !== null ? items[openIndex] : null;

  return (
    <>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4 lg:grid-cols-4">
        {items.map((item, index) => {
          const scoreTitle =
            item.score !== null ? formatMsg(t.generate.identityMatch, { n: item.score }) : undefined;
          return (
            <figure key={item.id} className="group min-w-0">
              <button
                type="button"
                onClick={() => setOpenIndex(index)}
                aria-label={item.prompt || t.marketing.gallery.title}
                className="relative block w-full cursor-pointer overflow-hidden rounded-media border border-onmedia/10 bg-[#141519] text-left transition-transform duration-200 hover:-translate-y-0.5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-ochre"
              >
                <div className="aspect-square w-full">
                  {item.contentType === "image" ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={thumbUrl(item.url, 640) ?? item.url}
                      alt={item.prompt}
                      loading="lazy"
                      className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.03]"
                    />
                  ) : item.posterUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={thumbUrl(item.posterUrl, 640) ?? item.posterUrl}
                      alt={item.prompt}
                      loading="lazy"
                      className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.03]"
                    />
                  ) : (
                    <video
                      src={`${item.url}#t=0.1`}
                      muted
                      playsInline
                      preload="metadata"
                      className="h-full w-full object-cover"
                    />
                  )}
                </div>

                {item.contentType === "video" && (
                  <>
                    <span
                      aria-hidden
                      className="absolute inset-0 m-auto flex h-11 w-11 items-center justify-center rounded-full bg-black/55 text-onmedia backdrop-blur-[2px] transition-transform duration-200 group-hover:scale-110"
                    >
                      <PlayIcon className="ml-0.5 h-4 w-4" />
                    </span>
                    <PicachoMark size="sm" />
                  </>
                )}

                {item.score !== null && (
                  <span
                    title={scoreTitle}
                    aria-label={scoreTitle}
                    className="absolute bottom-2 left-2 flex items-center gap-1.5 rounded-full bg-white/95 px-2.5 py-1 text-[10px] font-semibold text-neutral-800 shadow-sm"
                  >
                    <span className="hidden sm:inline">{t.marketing.home.scoreBandMatch}</span>
                    <span className="text-ochre">{item.score}%</span>
                  </span>
                )}
              </button>
              <figcaption title={item.prompt} className="mt-2 truncate text-xs text-[#a39a88]">
                {item.prompt}
              </figcaption>
            </figure>
          );
        })}
      </div>

      {open && (
        <div
          ref={viewerRef}
          role="dialog"
          aria-modal="true"
          aria-label={open.prompt || t.marketing.gallery.title}
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/90 p-4 sm:p-8"
          onClick={() => setOpenIndex(null)}
        >
          <div
            className="relative max-h-full w-full max-w-4xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="relative overflow-hidden rounded-media bg-[#141519]">
              {open.contentType === "image" ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={thumbUrl(open.url, 1600) ?? open.url}
                  alt={open.prompt}
                  className="max-h-[78vh] w-full object-contain"
                />
              ) : (
                <>
                  <QuietVideo
                    key={open.id}
                    pending="spinner"
                    src={open.url}
                    poster={open.posterUrl ? (thumbUrl(open.posterUrl, 1600) ?? undefined) : undefined}
                    controls
                    autoPlay
                    playsInline
                    className="max-h-[78vh] w-full bg-neutral-950 object-contain"
                  />
                  {/* Above the video, below nothing — the player's own
                      controls stay clickable through it. */}
                  <PicachoMark />
                </>
              )}
            </div>
            <div className="mt-3 flex items-start justify-between gap-4">
              <p className="min-w-0 flex-1 text-sm text-onmedia/80">{open.prompt}</p>
              {open.score !== null && (
                <span className="flex flex-shrink-0 items-center gap-1.5 rounded-full bg-white/95 px-2.5 py-1 text-[11px] font-semibold text-neutral-800">
                  <span>{t.marketing.home.scoreBandMatch}</span>
                  <span className="text-ochre">{open.score}%</span>
                </span>
              )}
            </div>
            <button
              type="button"
              onClick={() => setOpenIndex(null)}
              aria-label={t.common.close}
              className="absolute -top-2 right-0 flex h-9 w-9 -translate-y-full cursor-pointer items-center justify-center rounded-full bg-black/60 text-onmedia transition-colors hover:bg-black/80"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="h-4 w-4">
                <path d="M6 6l12 12M18 6L6 18" strokeLinecap="round" />
              </svg>
            </button>
            {openIndex !== null && openIndex > 0 && (
              <button
                type="button"
                onClick={() => setOpenIndex(openIndex - 1)}
                aria-label={t.common.prev}
                className="absolute left-0 top-1/2 flex h-10 w-10 -translate-y-1/2 cursor-pointer items-center justify-center rounded-full bg-black/60 text-onmedia transition-colors hover:bg-black/80 sm:-left-14"
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="h-4 w-4">
                  <path d="M15 6l-6 6 6 6" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </button>
            )}
            {openIndex !== null && openIndex < items.length - 1 && (
              <button
                type="button"
                onClick={() => setOpenIndex(openIndex + 1)}
                aria-label={t.common.next}
                className="absolute right-0 top-1/2 flex h-10 w-10 -translate-y-1/2 cursor-pointer items-center justify-center rounded-full bg-black/60 text-onmedia transition-colors hover:bg-black/80 sm:-right-14"
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="h-4 w-4">
                  <path d="M9 6l6 6-6 6" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </button>
            )}
          </div>
        </div>
      )}
    </>
  );
}
