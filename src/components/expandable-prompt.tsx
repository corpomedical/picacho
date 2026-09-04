"use client";

import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/cn";

// A long prompt as the page's title: two lines, then "more".
//
// The render page sets the prompt as its h1 (2026-09-04). That reads well for
// the ordinary case and badly for the real one — prompts here run to a hundred
// words, and an unclamped serif h1 pushed the render's own metadata off the
// screen it was meant to caption.
//
// The toggle only appears when the text ACTUALLY overflows two lines, which
// cannot be known from CSS — hence a measurement. Measuring is done in the
// clamped state only (an expanded element's scrollHeight equals its
// clientHeight, so re-measuring while open would decide it no longer overflows
// and remove the control that closes it). `overflows` is therefore sticky once
// true, and re-checked on resize while collapsed.
export function ExpandablePrompt({
  text,
  className,
  moreLabel,
  lessLabel,
}: {
  text: string;
  className?: string;
  moreLabel: string;
  lessLabel: string;
}) {
  const ref = useRef<HTMLHeadingElement>(null);
  const [expanded, setExpanded] = useState(false);
  const [overflows, setOverflows] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const check = () => {
      // Only meaningful while clamped; see the note above.
      if (el.classList.contains("line-clamp-2")) {
        // +1 absorbs sub-pixel line-height rounding, which otherwise reports
        // a one-line prompt as overflowing on some zoom levels.
        if (el.scrollHeight > el.clientHeight + 1) setOverflows(true);
      }
    };
    check();
    const observer = new ResizeObserver(check);
    observer.observe(el);
    return () => observer.disconnect();
  }, [text]);

  return (
    <>
      <h1
        ref={ref}
        className={cn(className, expanded ? null : "line-clamp-2")}
        // The full text is always in the DOM, so it is selectable, findable
        // with the browser's own search, and read whole by a screen reader —
        // the clamp is presentation, never truncation of the content.
        title={expanded ? undefined : text}
      >
        {text}
      </h1>
      {overflows && (
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          aria-expanded={expanded}
          className="mt-1.5 cursor-pointer text-[11px] font-semibold uppercase tracking-[0.14em] text-atelier-muted transition-colors hover:text-atelier-ink"
        >
          {expanded ? lessLabel : moreLabel}
        </button>
      )}
    </>
  );
}
