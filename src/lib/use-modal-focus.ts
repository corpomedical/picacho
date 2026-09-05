"use client";

import { useEffect, type RefObject } from "react";

// The focus contract aria-modal promises (2026-09-05 audit): move focus INTO
// the dialog on open, keep Tab inside it, and hand focus back where it came
// from on close. image-lightbox.tsx implemented this correctly and documented
// why; the media-gallery viewer and the community pager claimed
// aria-modal="true" while focus stayed on the grid BEHIND the overlay — Tab
// walked the hidden page while screen readers were told it didn't exist.
// One hook, so the next dialog gets it in one line.
export function useModalFocus(active: boolean, containerRef: RefObject<HTMLElement | null>): void {
  useEffect(() => {
    if (!active) return;
    const container = containerRef.current;
    if (!container) return;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;

    const focusables = () =>
      container.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), video[controls], [tabindex]:not([tabindex="-1"])',
      );

    (focusables()[0] ?? container).focus?.();

    function onKeyDown(e: KeyboardEvent) {
      if (e.key !== "Tab" || !container) return;
      const list = focusables();
      if (list.length === 0) return;
      const first = list[0];
      const last = list[list.length - 1];
      const inside = container.contains(document.activeElement);
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
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      previous?.focus();
    };
  }, [active, containerRef]);
}
