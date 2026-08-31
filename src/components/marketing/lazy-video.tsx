"use client";

import { useEffect, useRef } from "react";

// A below-the-fold autoplay video that does not download until it is nearly
// on screen (2026-08-31 inspection: the homepage started FOUR players on
// load — ~28MB of mp4 for a first paint where three of them were below the
// fold). preload="none" keeps the network idle; the observer starts playback
// — and therefore the download — one viewport early, so by the time the
// player scrolls into view it is already running and nothing looks broken.
//
// The hero reel at the very top is deliberately NOT this component: it is
// the first thing on screen, and lazy-loading it would trade real paint time
// for nothing.
export function LazyVideo({
  src,
  poster,
  className,
}: {
  src: string;
  poster?: string;
  className?: string;
}) {
  const ref = useRef<HTMLVideoElement | null>(null);

  useEffect(() => {
    const video = ref.current;
    if (!video) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          // play() on a preload="none" video triggers the fetch. Autoplay
          // policy is satisfied by muted+playsInline; a rejection (rare,
          // battery-saver modes) just leaves the poster showing.
          video.play().catch(() => {});
          observer.disconnect();
        }
      },
      { rootMargin: "100% 0px" },
    );
    observer.observe(video);
    return () => observer.disconnect();
  }, []);

  return (
    <video
      ref={(el) => {
        ref.current = el;
        if (el) el.muted = true;
      }}
      src={src}
      poster={poster}
      muted
      loop
      playsInline
      preload="none"
      aria-hidden
      className={className}
    />
  );
}
