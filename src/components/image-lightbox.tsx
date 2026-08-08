"use client";

import { useEffect } from "react";
import { useLocale } from "@/lib/i18n/provider";
import { DownloadButton } from "@/components/download-button";

// A simple full-screen viewer for a single static image (e.g. a character's
// reference photo) — click a thumbnail, see it large, download it. Modeled
// on search-dialog.tsx's overlay pattern: a dark backdrop that closes on
// click, a centered panel that stops that click from bubbling, and Escape
// closes it from anywhere.

function CloseIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <path d="M18 6 6 18M6 6l12 12" />
    </svg>
  );
}

export function ImageLightbox({ url, onClose }: { url: string; onClose: () => void }) {
  const { t } = useLocale();
  const c = t.character;

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-neutral-950/70 p-6"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
    >
      <div className="relative max-h-full max-w-3xl" onClick={(e) => e.stopPropagation()}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={url}
          alt=""
          className="max-h-[85vh] max-w-full rounded-[14px] object-contain shadow-[0_24px_48px_-12px_rgba(0,0,0,0.5)]"
        />
        <DownloadButton url={url} contentType="image" />
        <button
          type="button"
          onClick={onClose}
          aria-label={c.closeLightbox}
          title={c.closeLightbox}
          className="absolute -right-3 -top-3 flex h-8 w-8 items-center justify-center rounded-full bg-white text-neutral-700 shadow-[0_4px_12px_-2px_rgba(0,0,0,0.3)] hover:text-neutral-900"
        >
          <CloseIcon className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}
