"use client";

import { useEffect, useState } from "react";
import { useBackCloser } from "@/lib/native/back-stack";
import { useLocale } from "@/lib/i18n/provider";
import { MediaActionBar } from "@/components/media-action-bar";

// A result image that expands to a fullscreen viewer on tap — the thing
// every phone user tries first and the app previously didn't do at all
// (operator-reported, 2026-08-21: "clicking on a generated picture, the
// picture does not expand"). Web gets it too; there it's simply a bonus.
//
// Deliberately dependency-free: a fixed sheet on the Darkroom stage color,
// object-contain, tap anywhere (or Escape) to close. Colors are fixed
// literals for the same reason the stage itself is — a viewer never flips
// with the theme.
export function ZoomableImage({
  src,
  alt = "",
  className,
  downloadUrl,
  generationId,
  ownerActions = false,
  redirectAfterDelete,
}: {
  src: string;
  alt?: string;
  className?: string;
  // When set, the expanded view's action bar points at the ORIGINAL asset,
  // not whatever thumb/proxy `src` may be.
  downloadUrl?: string;
  // With ownerActions, the expanded bar also offers report + delete (the
  // server actions re-verify ownership regardless). redirectAfterDelete is a
  // plain string because server pages can't pass a client callback.
  generationId?: string;
  ownerActions?: boolean;
  redirectAfterDelete?: string;
}) {
  const { t } = useLocale();
  const [open, setOpen] = useState(false);
  // Android hardware back closes the zoom instead of navigating under it.
  useBackCloser(open, () => setOpen(false));

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    // No page scroll behind the sheet.
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [open]);

  return (
    <>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={src}
        alt={alt}
        className={className}
        onClick={() => setOpen(true)}
        style={{ cursor: "zoom-in" }}
      />
      {open && (
        <div
          role="dialog"
          aria-modal="true"
          onClick={() => setOpen(false)}
          className="fixed inset-0 z-[95] flex items-center justify-center bg-[#17150f]/95 p-4"
          style={{
            paddingTop: "calc(env(safe-area-inset-top) + 1rem)",
            paddingBottom: "calc(env(safe-area-inset-bottom) + 1rem)",
          }}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={src} alt={alt} className="max-h-full max-w-full rounded-media object-contain" />
          <div
            className="absolute inset-x-0 z-10 flex justify-center"
            style={{ bottom: "calc(env(safe-area-inset-bottom) + 1.25rem)" }}
          >
            <MediaActionBar
              url={downloadUrl ?? src}
              contentType="image"
              generationId={generationId}
              ownerActions={ownerActions}
              redirectAfterDelete={redirectAfterDelete}
            />
          </div>
          <button
            type="button"
            aria-label={t.common.close}
            onClick={() => setOpen(false)}
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
