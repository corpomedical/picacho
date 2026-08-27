"use client";

import { useEffect, useRef, useState } from "react";
import { useLocale } from "@/lib/i18n/provider";
import {
  recordCommunityView,
  reportCommunityPost,
  setCommunityHeart,
  setCommunityPostHidden,
} from "@/lib/community/actions";
import { REPORT_REASONS, type ReportReason } from "@/lib/generations/report-constants";
import { formatMsg } from "@/lib/i18n/format";
import { cn } from "@/lib/cn";

// Community, social-media shaped (operator-directed 2026-08-22, from a
// mocked design he approved: "Start building, I love it!!"):
//   * The GRID is the index — an Instagram-style edge-to-edge mosaic (2px
//     gaps, square crops, the first post featured 2×2, just a heart count
//     and a video badge on tiles; usernames live in the feed, not here).
//   * Tapping a tile opens the FEED — a full-screen vertical swipe pager
//     (CSS scroll-snap: swipe/scroll up for next, down for previous; arrow
//     keys on desktop). Each render fills the screen on a blurred echo of
//     itself, with hearts/views/share/report on a right rail, the maker,
//     caption, identity score and character on the bottom-left. Videos
//     autoplay muted while active and pause when swiped away.
// Views are counted when a post becomes the ACTIVE feed item (60% visible),
// once per session — same accounting the old open/close viewer had.
// Everything mutating still goes through src/lib/community/actions.ts.

export type CommunityPostView = {
  id: string;
  username: string | null;
  caption: string | null;
  prompt: string | null;
  contentType: "image" | "video";
  displayUrl: string;
  thumbUrl: string;
  // Full-screen-sized resize (1600w webp) for the feed — far lighter than
  // the original, which stays as the fallback.
  feedUrl: string;
  hearts: number;
  views: number;
  createdAt: string;
  hidden: boolean;
  mine: boolean;
  matchScore: number | null;
  characterName: string | null;
};

function HeartIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z" />
    </svg>
  );
}
function EyeIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}
function FlagIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V4s-1 1-4 1-5-2-8-2-4 1-4 1Z" />
      <path d="M4 22V4" />
    </svg>
  );
}
function ShareIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <path d="M12 3v12" />
      <path d="m8 7 4-4 4 4" />
      <path d="M5 12v7a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-7" />
    </svg>
  );
}
function PlayIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" {...props}>
      <path d="M8 5v14l11-7Z" />
    </svg>
  );
}
function EyeOffIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19" />
      <path d="M1 1l22 22" />
    </svg>
  );
}

// Every image in Community loads through this: a quiet spinner while
// loading, an automatic retry at the full-size URL when the thumb fails
// (the media route's resizer can choke on individual files — the original
// usually still serves), and a calm glyph if both die. The browser's
// broken-image icon can never appear (operator, 2026-08-22: "This just
// looks cheap").
function ResilientImage({
  thumb,
  full,
  alt,
  className,
}: {
  thumb: string;
  full: string;
  alt: string;
  className?: string;
}) {
  const [src, setSrc] = useState(thumb);
  const [phase, setPhase] = useState<"loading" | "ok" | "dead">("loading");

  if (phase === "dead") {
    return (
      <div className={cn("flex items-center justify-center", className)}>
        <svg viewBox="0 0 24 24" fill="none" stroke="#4a4d58" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" className="h-7 w-7">
          <rect x="3" y="3" width="18" height="18" rx="2.5" />
          <path d="M4 16l5-4 4 3 3-3 4 4" />
          <path d="M3 3l18 18" />
        </svg>
      </div>
    );
  }

  return (
    <>
      {phase === "loading" && (
        <span className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <span className="h-6 w-6 animate-spin rounded-full border-2 border-[#f5f1e9]/20 border-t-[#f5f1e9]/80" />
        </span>
      )}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={src}
        alt={alt}
        loading="lazy"
        onLoad={() => setPhase("ok")}
        onError={() => {
          if (src !== full) {
            setSrc(full);
            setPhase("loading");
          } else {
            setPhase("dead");
          }
        }}
        className={cn(className, "transition-opacity duration-300", phase === "ok" ? "opacity-100" : "opacity-0")}
      />
    </>
  );
}

export function CommunityFeed({
  posts,
  heartedIds,
  isAdmin,
  initialPostId,
}: {
  posts: CommunityPostView[];
  heartedIds: string[];
  isAdmin: boolean;
  // Deep link (?item=<id>): opens the feed on that post at load — this is
  // what a shared feed link lands on.
  initialPostId?: string;
}) {
  const { t } = useLocale();
  const c = t.community;
  const g = t.generate;
  const [feedIndex, setFeedIndex] = useState<number | null>(null);
  const [activeIndex, setActiveIndex] = useState(0);
  const [hearted, setHearted] = useState<Set<string>>(() => new Set(heartedIds));
  const [heartDelta, setHeartDelta] = useState<Record<string, number>>({});
  const [hiddenState, setHiddenState] = useState<Record<string, boolean>>({});
  const [reportOpenId, setReportOpenId] = useState<string | null>(null);
  const [reportReason, setReportReason] = useState<ReportReason>("inappropriate");
  const [reportDetails, setReportDetails] = useState("");
  const [reportSending, setReportSending] = useState(false);
  const [reportedIds, setReportedIds] = useState<Set<string>>(new Set());
  const [sharedTick, setSharedTick] = useState<string | null>(null);
  // In state, not a ref: the displayed count adds 1 once this session has
  // counted its own view of a post.
  const [viewedIds, setViewedIds] = useState<Set<string>>(new Set());
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const videoRefs = useRef<Map<number, HTMLVideoElement>>(new Map());
  const openedRef = useRef(false);
  // Instagram's sound contract (operator, 2026-08-24): the feed starts
  // muted (autoplay demands it); unmuting applies to THIS and every next
  // video until muted again. Tapping a video pauses/plays it. The ref
  // mirrors the state for the observer's closure.
  const [feedMuted, setFeedMuted] = useState(true);
  const feedMutedRef = useRef(true);
  useEffect(() => {
    feedMutedRef.current = feedMuted;
    videoRefs.current.forEach((v) => {
      v.muted = feedMuted;
    });
  }, [feedMuted]);

  const feedOpen = feedIndex !== null;

  // Deep link: open once, on mount, if the post is in the loaded set.
  useEffect(() => {
    if (openedRef.current || !initialPostId) return;
    const idx = posts.findIndex((p) => p.id === initialPostId);
    if (idx >= 0) {
      openedRef.current = true;
      setFeedIndex(idx);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialPostId]);

  // Body scroll lock + keyboard while the feed is open.
  useEffect(() => {
    if (!feedOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setFeedIndex(null);
      } else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        const dir = e.key === "ArrowDown" ? 1 : -1;
        const next = Math.min(posts.length - 1, Math.max(0, activeIndex + dir));
        scrollerRef.current?.children[next]?.scrollIntoView({ behavior: "smooth" });
      }
    };
    window.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [feedOpen, activeIndex, posts.length]);

  // Jump to the tapped post the moment the pager mounts — instant, so the
  // person lands ON their tile's render, not at the top of the feed.
  useEffect(() => {
    if (feedIndex === null) return;
    const child = scrollerRef.current?.children[feedIndex] as HTMLElement | undefined;
    child?.scrollIntoView({ behavior: "instant" as ScrollBehavior });
    setActiveIndex(feedIndex);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [feedIndex === null]);

  // Which post is on screen: drives view-counting and video play/pause.
  useEffect(() => {
    if (!feedOpen) return;
    const scroller = scrollerRef.current;
    if (!scroller) return;
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const idx = Number((entry.target as HTMLElement).dataset.feedIndex);
          const video = videoRefs.current.get(idx);
          if (entry.intersectionRatio >= 0.6) {
            setActiveIndex(idx);
            const post = posts[idx];
            if (post && !viewedIds.has(post.id)) {
              setViewedIds((prev) => new Set(prev).add(post.id));
              void recordCommunityView(post.id);
            }
            if (video) {
              // Honour the sticky sound preference; if the browser refuses
              // unmuted autoplay for this video, fall back to muted rather
              // than a frozen frame — the person can tap the sound back on.
              video.muted = feedMutedRef.current;
              video.play().catch(() => {
                video.muted = true;
                setFeedMuted(true);
                void video.play().catch(() => {});
              });
            }
          } else {
            video?.pause();
          }
        }
      },
      { root: scroller, threshold: [0.6] },
    );
    Array.from(scroller.children).forEach((el) => observer.observe(el));
    return () => observer.disconnect();
    // viewedIds deliberately omitted: re-creating the observer on every view
    // tick would re-fire entries; the set is read through closure freshness
    // via the functional check above being idempotent server-side anyway.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [feedOpen, posts]);

  async function toggleHeart(post: CommunityPostView) {
    const isOn = hearted.has(post.id);
    setHearted((prev) => {
      const next = new Set(prev);
      if (isOn) next.delete(post.id);
      else next.add(post.id);
      return next;
    });
    setHeartDelta((prev) => ({ ...prev, [post.id]: (prev[post.id] ?? 0) + (isOn ? -1 : 1) }));
    const { error } = await setCommunityHeart(post.id, !isOn);
    if (error) {
      setHearted((prev) => {
        const next = new Set(prev);
        if (isOn) next.add(post.id);
        else next.delete(post.id);
        return next;
      });
      setHeartDelta((prev) => ({ ...prev, [post.id]: (prev[post.id] ?? 0) + (isOn ? 1 : -1) }));
    }
  }

  async function toggleHidden(post: CommunityPostView) {
    const now = hiddenState[post.id] ?? post.hidden;
    setHiddenState((prev) => ({ ...prev, [post.id]: !now }));
    const { error } = await setCommunityPostHidden(post.id, !now);
    if (error) setHiddenState((prev) => ({ ...prev, [post.id]: now }));
  }

  async function submitReport(post: CommunityPostView) {
    setReportSending(true);
    const { error } = await reportCommunityPost(post.id, reportReason, reportDetails);
    setReportSending(false);
    if (!error) {
      setReportedIds((prev) => new Set(prev).add(post.id));
      setReportOpenId(null);
      setReportDetails("");
    }
  }

  async function sharePost(post: CommunityPostView) {
    const link = new URL(`/app/community?item=${post.id}`, window.location.origin).toString();
    if (navigator.share) {
      try {
        await navigator.share({ url: link });
        return;
      } catch {
        // cancelled — fall through
      }
    }
    try {
      await navigator.clipboard.writeText(link);
      setSharedTick(post.id);
      setTimeout(() => setSharedTick(null), 1500);
    } catch {
      // nothing left to try
    }
  }

  const reasonLabels: Record<ReportReason, string> = {
    wrong_result: g.reportReasonWrongResult,
    inappropriate: g.reportReasonInappropriate,
    technical_error: g.reportReasonTechnicalError,
    other: g.reportReasonOther,
  };

  function heartsOf(post: CommunityPostView) {
    return Math.max(0, post.hearts + (heartDelta[post.id] ?? 0));
  }

  if (posts.length === 0) {
    return (
      <div className="mt-10 flex flex-col items-center justify-center rounded-media border border-dashed border-atelier-rule py-16 text-center">
        <p className="text-sm text-atelier-muted">{c.empty}</p>
      </div>
    );
  }

  return (
    <>
      {/* The index: an edge-to-edge social mosaic. First post is featured
          2×2; tiles carry only a heart count and a video badge — every other
          detail waits for the feed. */}
      <div className="mt-6 grid grid-cols-3 gap-[2px] overflow-hidden rounded-media">
        {posts.map((post, i) => {
          const isHidden = hiddenState[post.id] ?? post.hidden;
          const featured = i === 0 && posts.length > 2;
          return (
            <button
              key={post.id}
              type="button"
              onClick={() => setFeedIndex(i)}
              aria-label={post.caption ?? post.prompt ?? "Community post"}
              className={cn(
                "group relative overflow-hidden bg-atelier-stage text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-atelier-accent",
                featured ? "col-span-2 row-span-2" : "cv-auto aspect-square",
                isHidden && "opacity-50",
              )}
            >
              {post.contentType === "video" ? (
                <video
                  src={`${post.displayUrl}#t=0.1`}
                  muted
                  playsInline
                  preload="metadata"
                  className="absolute inset-0 h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.03]"
                />
              ) : (
                <ResilientImage
                  thumb={post.thumbUrl}
                  full={post.displayUrl}
                  alt={post.caption ?? post.prompt ?? ""}
                  className="absolute inset-0 h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.03]"
                />
              )}
              {post.contentType === "video" && (
                /* The video marker (operator: "videos must have an icon that
                   shows it's a video"). The previous bare 16px glyph vanished
                   on bright footage — a scrim disc guarantees contrast on any
                   frame, the way every video grid on earth marks its clips. */
                <span className="absolute right-2 top-2 flex h-7 w-7 items-center justify-center rounded-full bg-[#17150f]/60 text-[#f5f1e9] backdrop-blur-[2px]">
                  <PlayIcon className="ml-0.5 h-3.5 w-3.5" />
                </span>
              )}
              {isHidden && (
                <span className="absolute left-2 top-2 rounded-full bg-[#17150f]/80 px-2 py-0.5 text-[10px] font-semibold text-[#f5f1e9]">
                  {c.hiddenBadge}
                </span>
              )}
              <span className="absolute bottom-1.5 left-2 flex items-center gap-1 text-[11px] font-semibold tabular-nums text-[#f5f1e9] drop-shadow-[0_1px_3px_rgba(0,0,0,0.7)]">
                <HeartIcon
                  className={cn("h-3.5 w-3.5", hearted.has(post.id) && "text-[#e0a468]")}
                  fill={hearted.has(post.id) ? "currentColor" : "none"}
                />
                {heartsOf(post)}
              </span>
            </button>
          );
        })}
      </div>

      {/* The feed: full-screen vertical swipe pager. */}
      {feedOpen && (
        <div role="dialog" aria-modal="true" aria-label={c.title} className="fixed inset-0 z-[95] bg-[#0c0d11]">
          <div
            ref={scrollerRef}
            className="h-full w-full snap-y snap-mandatory overflow-y-auto overscroll-contain"
            style={{ scrollbarWidth: "none" }}
          >
            {posts.map((post, i) => {
              const isHidden = hiddenState[post.id] ?? post.hidden;
              return (
                <section
                  key={post.id}
                  data-feed-index={i}
                  className="relative flex h-full w-full snap-start snap-always items-center justify-center overflow-hidden"
                >
                  {/* Blurred echo of the render as the stage, so any aspect
                      ratio fills the screen without cropping the real one. */}
                  {post.contentType === "image" && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={post.thumbUrl}
                      alt=""
                      aria-hidden
                      // The echo is decoration — if its thumb fails, vanish
                      // silently rather than show anything broken.
                      onError={(e) => {
                        (e.currentTarget as HTMLImageElement).style.display = "none";
                      }}
                      className="absolute inset-0 h-full w-full scale-110 object-cover opacity-30 blur-2xl"
                    />
                  )}
                  {post.contentType === "video" ? (
                    <video
                      ref={(el) => {
                        if (el) {
                          el.muted = feedMutedRef.current;
                          videoRefs.current.set(i, el);
                        } else videoRefs.current.delete(i);
                      }}
                      src={post.displayUrl}
                      muted
                      loop
                      playsInline
                      onClick={(e) => {
                        // Tap the video to pause/resume — the Instagram
                        // gesture, no controls chrome needed.
                        const v = e.currentTarget;
                        if (v.paused) void v.play().catch(() => {});
                        else v.pause();
                      }}
                      className="relative max-h-full max-w-full"
                    />
                  ) : (
                    <div className="relative flex h-full w-full items-center justify-center">
                      <ResilientImage
                        thumb={post.feedUrl}
                        full={post.displayUrl}
                        alt={post.caption ?? post.prompt ?? ""}
                        className="max-h-full max-w-full object-contain"
                      />
                    </div>
                  )}

                  <div className="pointer-events-none absolute inset-x-0 bottom-0 h-2/5 bg-gradient-to-t from-[#08090c]/85 to-transparent" />
                  <div className="pointer-events-none absolute inset-x-0 top-0 h-24 bg-gradient-to-b from-[#08090c]/60 to-transparent" />

                  {/* Right rail. */}
                  <div
                    className="absolute right-2.5 flex flex-col items-center gap-4"
                    style={{ bottom: "calc(env(safe-area-inset-bottom) + 92px)" }}
                  >
                    <div className="flex flex-col items-center">
                      <button
                        type="button"
                        onClick={() => toggleHeart(post)}
                        aria-pressed={hearted.has(post.id)}
                        aria-label={c.sortTop}
                        className={cn(
                          "flex h-11 w-11 items-center justify-center rounded-full bg-[#101116]/55 text-[#f2f0ec] backdrop-blur-md transition-transform active:scale-90",
                          hearted.has(post.id) && "text-[#e0a468]",
                        )}
                      >
                        <HeartIcon className="h-5 w-5" fill={hearted.has(post.id) ? "currentColor" : "none"} />
                      </button>
                      <span className="mt-1 text-[10.5px] font-bold tabular-nums text-[#f2f0ec] drop-shadow-[0_1px_3px_rgba(0,0,0,0.7)]">
                        {heartsOf(post)}
                      </span>
                    </div>
                    <div className="flex flex-col items-center">
                      <span className="flex h-11 w-11 items-center justify-center rounded-full bg-[#101116]/55 text-[#f2f0ec] backdrop-blur-md">
                        <EyeIcon className="h-5 w-5" />
                      </span>
                      <span className="mt-1 text-[10.5px] font-bold tabular-nums text-[#f2f0ec] drop-shadow-[0_1px_3px_rgba(0,0,0,0.7)]">
                        {post.views + (viewedIds.has(post.id) ? 1 : 0)}
                      </span>
                    </div>
                    {post.contentType === "video" && (
                      <button
                        type="button"
                        onClick={() => setFeedMuted((v) => !v)}
                        aria-pressed={feedMuted}
                        aria-label={feedMuted ? c.unmuteLabel : c.muteLabel}
                        className="flex h-11 w-11 items-center justify-center rounded-full bg-[#101116]/55 text-[#f2f0ec] backdrop-blur-md transition-transform active:scale-90"
                      >
                        {feedMuted ? (
                          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5">
                            <path d="M11 5 6 9H2v6h4l5 4V5Z" />
                            <path d="m23 9-6 6M17 9l6 6" />
                          </svg>
                        ) : (
                          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5">
                            <path d="M11 5 6 9H2v6h4l5 4V5Z" />
                            <path d="M15.5 8.5a5 5 0 0 1 0 7M19 5a9 9 0 0 1 0 14" />
                          </svg>
                        )}
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => sharePost(post)}
                      aria-label={g.shareResult}
                      className="flex h-11 w-11 items-center justify-center rounded-full bg-[#101116]/55 text-[#f2f0ec] backdrop-blur-md transition-transform active:scale-90"
                    >
                      {sharedTick === post.id ? (
                        <span className="text-[9px] font-bold">{g.linkCopied}</span>
                      ) : (
                        <ShareIcon className="h-5 w-5" />
                      )}
                    </button>
                    {!post.mine && (
                      <button
                        type="button"
                        onClick={() => setReportOpenId(reportOpenId === post.id ? null : post.id)}
                        aria-label={g.reportProblem}
                        className={cn(
                          "flex h-11 w-11 items-center justify-center rounded-full bg-[#101116]/55 text-[#f2f0ec]/85 backdrop-blur-md",
                          reportedIds.has(post.id) && "text-amber-400",
                        )}
                      >
                        <FlagIcon className="h-4.5 w-4.5" fill={reportedIds.has(post.id) ? "currentColor" : "none"} />
                      </button>
                    )}
                    {isAdmin && (
                      <button
                        type="button"
                        onClick={() => toggleHidden(post)}
                        aria-label={isHidden ? c.unhide : c.hide}
                        className={cn(
                          "flex h-11 w-11 items-center justify-center rounded-full bg-[#101116]/55 backdrop-blur-md",
                          isHidden ? "text-amber-400" : "text-[#f2f0ec]/85",
                        )}
                      >
                        <EyeOffIcon className="h-4.5 w-4.5" />
                      </button>
                    )}
                  </div>

                  {/* Maker + caption + the Picacho signature. */}
                  <div
                    className="absolute left-3 right-16"
                    style={{ bottom: "calc(env(safe-area-inset-bottom) + 18px)" }}
                  >
                    <p className="text-[13.5px] font-extrabold text-[#f2f0ec] drop-shadow-[0_1px_3px_rgba(0,0,0,0.7)]">
                      {post.username ? `@${post.username}` : "—"}
                    </p>
                    {(post.caption ?? post.prompt) && (
                      <p className="mt-1 line-clamp-2 text-[12px] leading-relaxed text-[#f2f0ec]/85 drop-shadow-[0_1px_3px_rgba(0,0,0,0.7)]">
                        {post.caption ?? post.prompt}
                      </p>
                    )}
                    <div className="mt-2 flex flex-wrap items-center gap-1.5">
                      {post.matchScore != null && (
                        <span className="flex items-center gap-1 rounded-full bg-[#faf8f3]/95 px-2.5 py-1 text-[10px] font-bold text-[#211d16]">
                          {t.marketing.home.scoreBandMatch}
                          <span className="text-[#b45a28]">{post.matchScore}%</span>
                        </span>
                      )}
                      {post.characterName && (
                        <span className="rounded-full bg-[#101116]/55 px-2.5 py-1 text-[10px] font-semibold text-[#d6d3cd] backdrop-blur-md">
                          {post.characterName} · {post.contentType === "video" ? g.video : g.image}
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Report sheet, anchored above the rail. */}
                  {reportOpenId === post.id && (
                    <div className="absolute bottom-24 right-14 z-10 w-64 rounded-control bg-atelier-surface/95 p-3 shadow-[0_0_0_1px_var(--frost-ring),0_24px_48px_-12px_rgba(0,0,0,0.4)] backdrop-blur-xl">
                      <p className="text-xs font-medium text-atelier-ink">{g.reportTitle}</p>
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {REPORT_REASONS.map((reason) => (
                          <button
                            key={reason}
                            type="button"
                            onClick={() => setReportReason(reason)}
                            className={cn(
                              "rounded-full border px-2.5 py-1 text-[11px] font-medium transition-colors",
                              reportReason === reason
                                ? "border-atelier-ink bg-atelier-ink text-atelier-paper"
                                : "border-atelier-rule text-atelier-muted hover:border-atelier-muted",
                            )}
                          >
                            {reasonLabels[reason]}
                          </button>
                        ))}
                      </div>
                      <textarea
                        value={reportDetails}
                        onChange={(e) => setReportDetails(e.target.value)}
                        placeholder={g.reportDetailsPlaceholder}
                        rows={2}
                        maxLength={1000}
                        className="mt-2 w-full resize-none rounded-control border border-atelier-rule bg-transparent p-2 text-xs text-atelier-ink placeholder:text-atelier-muted/70 focus:border-atelier-accent focus:outline-none"
                      />
                      <button
                        type="button"
                        onClick={() => submitReport(post)}
                        disabled={reportSending}
                        className="mt-2 w-full rounded-control bg-atelier-ink py-1.5 text-xs font-medium text-atelier-paper transition-opacity hover:opacity-90 disabled:opacity-50"
                      >
                        {reportSending ? g.reportSending : g.reportSubmit}
                      </button>
                    </div>
                  )}
                </section>
              );
            })}
          </div>

          <button
            type="button"
            aria-label="Close"
            onClick={() => setFeedIndex(null)}
            className="absolute right-3 z-10 flex h-9 w-9 items-center justify-center rounded-full bg-[#101116]/55 text-[#f2f0ec] backdrop-blur-md"
            style={{ top: "calc(env(safe-area-inset-top) + 12px)" }}
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
