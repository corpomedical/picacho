"use client";

import { useEffect, useRef } from "react";

// Android hardware back vs. overlays (2026-09-05 audit).
//
// The shell's back handler (native-chrome.tsx) only knew how to navigate:
// with a lightbox, the community viewer or the search dialog open, the
// hardware back button navigated AWAY underneath the overlay instead of
// closing it — the opposite of what every Android app does, and the kind of
// thing that makes a WebView shell feel like a website in a box.
//
// Overlays register a closer here while they are open; the back handler
// closes the top of the stack first and only navigates when nothing is open.
// A plain module-level stack, not context: the registrants and the consumer
// live in unrelated trees (root layout vs. page components), and the shell
// is a single WebView — there is exactly one hardware back button.

type Closer = () => void;

const stack: Closer[] = [];

export function pushBackCloser(close: Closer): () => void {
  stack.push(close);
  let removed = false;
  return () => {
    if (removed) return;
    removed = true;
    const i = stack.lastIndexOf(close);
    if (i >= 0) stack.splice(i, 1);
  };
}

// Closes the top open overlay. True when one was closed (the back press is
// consumed), false when nothing was open (the caller should navigate).
export function popBackCloser(): boolean {
  const close = stack.pop();
  if (!close) return false;
  close();
  return true;
}

// The one-liner overlays actually use: registered while `open`, gone on
// close/unmount. The closer is read through a ref so callers can pass an
// inline arrow without re-registering every render.
export function useBackCloser(open: boolean, close: Closer): void {
  const closeRef = useRef(close);
  // In an effect, not during render — the compiler lint forbids render-time
  // ref writes, and post-render assignment is all this needs anyway.
  useEffect(() => {
    closeRef.current = close;
  });
  useEffect(() => {
    if (!open) return;
    return pushBackCloser(() => closeRef.current());
  }, [open]);
}
