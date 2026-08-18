"use client";

import { useEffect, useRef } from "react";
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

export function ImageLightbox({
  url,
  // What the picture IS, for screen readers — the sole content of this
  // dialog used to be alt="", which announced the whole lightbox as an
  // empty, unnamed thing. Callers that know more (which character, which
  // slot) can pass it; otherwise the generic reference-photo label applies.
  alt,
  onClose,
}: {
  url: string;
  alt?: string;
  onClose: () => void;
}) {
  const { t } = useLocale();
  const c = t.character;
  const panelRef = useRef<HTMLDivElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
      // Same Tab trap as search-dialog.tsx — this claims aria-modal, so
      // focus mustn't wander off into the page behind the backdrop.
      if (e.key === "Tab") {
        const panel = panelRef.current;
        if (!panel) return;
        const focusable = panel.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])',
        );
        if (focusable.length === 0) return;
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        const inside = panel.contains(document.activeElement);
        if (!inside) {
          e.preventDefault();
          first.focus();
        } else if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  // Move focus into the dialog on open, and hand it back where it came from
  // on close — without this a keyboard user's focus stayed on the thumbnail
  // behind the backdrop, so the lightbox opened but arrow-of-attention never
  // followed, and Escape/Tab operated on the page underneath.
  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    closeButtonRef.current?.focus();
    return () => previous?.focus();
  }, []);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-neutral-950/70 p-6"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={alt ?? c.lightboxAlt}
    >
      <div ref={panelRef} className="relative max-h-full max-w-3xl" onClick={(e) => e.stopPropagation()}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={url}
          alt={alt ?? c.lightboxAlt}
          className="max-h-[85vh] max-w-full rounded-[14px] object-contain shadow-[0_24px_48px_-12px_rgba(0,0,0,0.5)]"
        />
        <DownloadButton url={url} contentType="image" />
        <button
          ref={closeButtonRef}
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
