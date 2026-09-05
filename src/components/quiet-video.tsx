"use client";

import { useState } from "react";
import { cn } from "@/lib/cn";

// A <video> that never shows the WebView's built-in placeholder
// (2026-08-27, operator: "the default play image when the content hasn't
// loaded — I want to get rid of that ugly image", then again for the
// expanded viewer). Android's WebView paints its own gray play graphic
// over an empty <video> until the first frame decodes — on a slow
// connection that ugly frame IS the element. Here the video stays
// invisible until it actually has a frame (onLoadedData); until then the
// element shows its own quiet state over the parent's ground:
//   pending="disc"    — a soft play disc (grid tiles: reads as "a video")
//   pending="spinner" — a loading ring (viewers that autoplay: reads as
//                       "it's coming")
// Parent must be positioned with a background — every call site is.
// `ref` rides as a plain prop (React 19) so the community pager's
// play/pause registry keeps working through the wrapper.
export function QuietVideo({
  className,
  pending = "disc",
  ref,
  onLoadedData,
  ...props
}: React.VideoHTMLAttributes<HTMLVideoElement> & {
  pending?: "disc" | "spinner";
  ref?: React.Ref<HTMLVideoElement>;
}) {
  const [ready, setReady] = useState(false);
  return (
    <>
      {!ready && (
        <span className="pointer-events-none absolute inset-0 flex items-center justify-center">
          {pending === "disc" ? (
            <span className="flex h-9 w-9 items-center justify-center rounded-full bg-onmedia/10">
              <svg viewBox="0 0 24 24" fill="currentColor" fillOpacity={0.5} className="ml-0.5 h-4 w-4 text-onmedia">
                <path d="M8 5v14l11-7Z" />
              </svg>
            </span>
          ) : (
            <span className="h-8 w-8 animate-spin rounded-full border-2 border-onmedia/20 border-t-onmedia/80" />
          )}
        </span>
      )}
      <video
        // Default, not forced (callers can still override): a grid of tiles
        // used to mount full mp4s — with the media route now honoring Range,
        // metadata preload means a tile costs the moov atom, not the movie.
        preload="metadata"
        {...props}
        ref={ref}
        onLoadedData={(e) => {
          setReady(true);
          onLoadedData?.(e);
        }}
        className={cn(className, "transition-opacity duration-300", ready ? "opacity-100" : "opacity-0")}
      />
    </>
  );
}
