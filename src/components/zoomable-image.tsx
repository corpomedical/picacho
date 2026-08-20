"use client";

import { useEffect, useState } from "react";

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
}: {
  src: string;
  alt?: string;
  className?: string;
}) {
  const [open, setOpen] = useState(false);

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
          <button
            type="button"
            aria-label="Close"
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
