"use client";

import { useEffect, useRef, useState } from "react";

// Custom play/pause + mute/unmute for the homepage's real-result showcase
// video (see app/page.tsx) — native browser <video controls> was replaced
// with this because the default control bar looks out of place inside the
// rounded/glowing frame it sits in; these two small circular buttons match
// the overlay style already used elsewhere (e.g. download-button.tsx).

function PlayIcon(props: React.SVGProps<SVGSVGElement>) {
  // Same triangle path already used for the video-thumbnail play badge in
  // media-gallery.tsx — kept identical rather than redrawn.
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" {...props}>
      <path d="M8 5v14l11-7Z" />
    </svg>
  );
}

function PauseIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" {...props}>
      <rect x="6" y="5" width="4" height="14" rx="1" />
      <rect x="14" y="5" width="4" height="14" rx="1" />
    </svg>
  );
}

function SpeakerOnIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <path d="M4 9v6h4l5 4V5L8 9H4Z" />
      <path d="M17 8a5 5 0 0 1 0 8" />
      <path d="M19.5 5.5a9 9 0 0 1 0 13" />
    </svg>
  );
}

function SpeakerOffIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <path d="M4 9v6h4l5 4V5L8 9H4Z" />
      <path d="m17 9 5 6M22 9l-5 6" />
    </svg>
  );
}

export function ShowcaseVideoPlayer({
  src = "/showcase-video.mp4",
  poster = "/showcase-poster.jpg",
  badge,
  playLabel,
  pauseLabel,
  // Second homepage showcase video has no audio track at all (see
  // app/page.tsx) — passing muteLabel/unmuteLabel as undefined there hides
  // the speaker button entirely rather than showing a control with nothing
  // for it to toggle.
  muteLabel,
  unmuteLabel,
}: {
  src?: string;
  poster?: string;
  badge: string;
  playLabel: string;
  pauseLabel: string;
  muteLabel?: string;
  unmuteLabel?: string;
}) {
  const showMuteControl = Boolean(muteLabel && unmuteLabel);
  const videoRef = useRef<HTMLVideoElement>(null);
  const [playing, setPlaying] = useState(false);
  const [muted, setMuted] = useState(true);

  function togglePlay() {
    const video = videoRef.current;
    if (!video) return;
    if (video.paused) {
      void video.play();
      setPlaying(true);
    } else {
      video.pause();
      setPlaying(false);
    }
  }

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          video.play().catch(() => {});
          observer.disconnect();
        }
      },
      { rootMargin: "100% 0px" },
    );
    observer.observe(video);
    return () => observer.disconnect();
  }, []);

  function toggleMute() {
    const video = videoRef.current;
    if (!video) return;
    video.muted = !video.muted;
    setMuted(video.muted);
  }

  return (
    <div className="relative overflow-hidden rounded-[28px] border border-onmedia shadow-[0_30px_60px_-20px_rgba(30,64,175,0.35)]">
      <video
        ref={videoRef}
        src={src}
        poster={poster}
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        className="aspect-square w-full object-cover"
        // No autoPlay and preload="none": these players sit below the fold,
        // and on load the homepage was downloading every one of them —
        // ~28MB before the visitor had scrolled an inch (2026-08-31
        // inspection). The observer effect below starts playback (and the
        // download) one viewport before the player scrolls in; the poster
        // covers the gap.
        muted
        loop
        playsInline
        preload="none"
        onClick={togglePlay}
      />
      <span className="pointer-events-none absolute bottom-3 left-3 rounded-full bg-black/55 px-3 py-1 text-xs font-medium text-onmedia backdrop-blur-sm">
        {badge}
      </span>
      <div className="absolute bottom-3 right-3 flex items-center gap-2">
        <button
          type="button"
          onClick={togglePlay}
          aria-label={playing ? pauseLabel : playLabel}
          title={playing ? pauseLabel : playLabel}
          className="flex h-8 w-8 items-center justify-center rounded-full bg-black/55 text-onmedia backdrop-blur-sm transition-colors hover:bg-black/70"
        >
          {playing ? <PauseIcon className="h-4 w-4" /> : <PlayIcon className="h-4 w-4" />}
        </button>
        {showMuteControl && (
          <button
            type="button"
            onClick={toggleMute}
            aria-label={muted ? unmuteLabel : muteLabel}
            title={muted ? unmuteLabel : muteLabel}
            className="flex h-8 w-8 items-center justify-center rounded-full bg-black/55 text-onmedia backdrop-blur-sm transition-colors hover:bg-black/70"
          >
            {muted ? <SpeakerOffIcon className="h-4 w-4" /> : <SpeakerOnIcon className="h-4 w-4" />}
          </button>
        )}
      </div>
    </div>
  );
}
