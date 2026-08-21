"use client";

import { useEffect, useState } from "react";
import { useLocale } from "@/lib/i18n/provider";
import { MediaActionBar } from "@/components/media-action-bar";
import {
  recordCommunityView,
  reportCommunityPost,
  setCommunityHeart,
  setCommunityPostHidden,
} from "@/lib/community/actions";
import { REPORT_REASONS, type ReportReason } from "@/lib/generations/report-constants";
import { formatMsg } from "@/lib/i18n/format";
import { cn } from "@/lib/cn";

// The community feed — a grid of opt-in shared renders, each opening in the
// same Darkroom viewer the media library uses, plus the social layer:
// hearts (one per account, optimistic), per-account view counts, report
// into the admin queue, and admin hide/unhide. Everything mutating goes
// through src/lib/community/actions.ts.

export type CommunityPostView = {
  id: string;
  username: string | null;
  caption: string | null;
  prompt: string | null;
  contentType: "image" | "video";
  displayUrl: string;
  thumbUrl: string;
  hearts: number;
  views: number;
  createdAt: string;
  hidden: boolean;
  mine: boolean;
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
function PlayIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" {...props}>
      <path d="M8 5v14l11-7Z" />
    </svg>
  );
}

export function CommunityFeed({
  posts,
  heartedIds,
  isAdmin,
}: {
  posts: CommunityPostView[];
  heartedIds: string[];
  isAdmin: boolean;
}) {
  const { t } = useLocale();
  const c = t.community;
  const g = t.generate;
  const [viewer, setViewer] = useState<CommunityPostView | null>(null);
  const [hearted, setHearted] = useState<Set<string>>(() => new Set(heartedIds));
  // Optimistic count deltas on top of the server-rendered numbers.
  const [heartDelta, setHeartDelta] = useState<Record<string, number>>({});
  const [hiddenState, setHiddenState] = useState<Record<string, boolean>>({});
  const [reportOpen, setReportOpen] = useState(false);
  const [reportReason, setReportReason] = useState<ReportReason>("inappropriate");
  const [reportDetails, setReportDetails] = useState("");
  const [reportSending, setReportSending] = useState(false);
  const [reportedIds, setReportedIds] = useState<Set<string>>(new Set());
  // In state, not a ref: the viewer's displayed count adds 1 once this
  // session has counted its own view.
  const [viewedIds, setViewedIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!viewer) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setViewer(null);
    };
    window.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [viewer]);

  function openViewer(post: CommunityPostView) {
    setViewer(post);
    setReportOpen(false);
    if (!viewedIds.has(post.id)) {
      setViewedIds((prev) => new Set(prev).add(post.id));
      void recordCommunityView(post.id);
    }
  }

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
      // Roll back.
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
      setReportOpen(false);
      setReportDetails("");
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
      <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        {posts.map((post) => {
          const isHidden = hiddenState[post.id] ?? post.hidden;
          return (
            <button
              key={post.id}
              type="button"
              onClick={() => openViewer(post)}
              aria-label={post.caption ?? post.prompt ?? "Community post"}
              className={cn(
                "group relative aspect-square overflow-hidden rounded-media border border-[#eae6dc]/10 bg-atelier-stage text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-atelier-accent",
                isHidden && "opacity-50",
              )}
            >
              {post.contentType === "video" ? (
                <video
                  src={`${post.displayUrl}#t=0.1`}
                  muted
                  playsInline
                  preload="metadata"
                  className="h-full w-full object-cover transition-transform duration-200 group-hover:scale-105"
                />
              ) : (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={post.thumbUrl}
                  alt={post.caption ?? post.prompt ?? ""}
                  loading="lazy"
                  className="h-full w-full object-cover transition-transform duration-200 group-hover:scale-105"
                />
              )}
              {post.contentType === "video" && (
                <span className="absolute right-2 top-2 flex h-6 w-6 items-center justify-center rounded-full bg-[#faf8f3]/95 text-[#211d16] shadow-sm">
                  <PlayIcon className="h-3 w-3" />
                </span>
              )}
              {isHidden && (
                <span className="absolute left-2 top-2 rounded-full bg-[#17150f]/80 px-2 py-0.5 text-[10px] font-semibold text-[#f5f1e9]">
                  {c.hiddenBadge}
                </span>
              )}
              <div className="absolute inset-x-0 bottom-0 flex items-end justify-between bg-gradient-to-t from-[#17150f]/85 to-transparent p-2.5">
                <p className="truncate text-[10px] font-medium uppercase tracking-wider text-[#cfc7b6]">
                  {post.username ? `@${post.username}` : "—"}
                </p>
                <span className="flex items-center gap-1 text-[11px] font-semibold tabular-nums text-[#f5f1e9]">
                  <HeartIcon
                    className={cn("h-3.5 w-3.5", hearted.has(post.id) && "text-[#e0a468]")}
                    fill={hearted.has(post.id) ? "currentColor" : "none"}
                  />
                  {heartsOf(post)}
                </span>
              </div>
            </button>
          );
        })}
      </div>

      {viewer && (
        <div
          role="dialog"
          aria-modal="true"
          onClick={() => setViewer(null)}
          className="fixed inset-0 z-[95] flex flex-col items-center justify-center bg-[#17150f]/95 p-4"
          style={{
            paddingTop: "calc(env(safe-area-inset-top) + 1rem)",
            paddingBottom: "calc(env(safe-area-inset-bottom) + 1rem)",
          }}
        >
          <div className="flex max-h-full w-full max-w-3xl flex-1 items-center justify-center overflow-hidden" onClick={() => setViewer(null)}>
            {viewer.contentType === "video" ? (
              <video
                src={viewer.displayUrl}
                controls
                autoPlay
                playsInline
                onClick={(e) => e.stopPropagation()}
                className="max-h-[70vh] max-w-full rounded-media"
              />
            ) : (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={viewer.displayUrl}
                alt={viewer.caption ?? viewer.prompt ?? ""}
                onClick={(e) => e.stopPropagation()}
                className="max-h-[70vh] max-w-full rounded-media object-contain"
              />
            )}
          </div>

          <div className="mt-3 w-full max-w-3xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="truncate text-xs font-semibold uppercase tracking-wider text-[#cfc7b6]">
                  {viewer.username ? `@${viewer.username}` : "—"}
                </p>
                {viewer.caption && <p className="mt-0.5 truncate text-sm text-[#f5f1e9]">{viewer.caption}</p>}
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <button
                  type="button"
                  onClick={() => toggleHeart(viewer)}
                  aria-pressed={hearted.has(viewer.id)}
                  className={cn(
                    "flex items-center gap-1.5 rounded-full bg-[#f5f1e9]/10 px-3 py-1.5 text-sm font-semibold tabular-nums text-[#f5f1e9] transition-colors hover:bg-[#f5f1e9]/15",
                    hearted.has(viewer.id) && "text-[#e0a468]",
                  )}
                >
                  <HeartIcon className="h-4 w-4" fill={hearted.has(viewer.id) ? "currentColor" : "none"} />
                  {heartsOf(viewer)}
                </button>
                <span className="flex items-center gap-1.5 text-xs tabular-nums text-[#cfc7b6]">
                  <EyeIcon className="h-4 w-4" />
                  {formatMsg(c.views, { n: viewer.views + (viewedIds.has(viewer.id) ? 1 : 0) })}
                </span>
                {!viewer.mine && (
                  <div className="relative">
                    <button
                      type="button"
                      onClick={() => setReportOpen((v) => !v)}
                      aria-label={g.reportProblem}
                      className={cn(
                        "flex h-8 w-8 items-center justify-center rounded-full bg-[#f5f1e9]/10 text-[#f5f1e9]/80 transition-colors hover:bg-[#f5f1e9]/15",
                        reportedIds.has(viewer.id) && "text-amber-400",
                      )}
                    >
                      <FlagIcon className="h-3.5 w-3.5" fill={reportedIds.has(viewer.id) ? "currentColor" : "none"} />
                    </button>
                    {reportOpen && (
                      <div className="absolute bottom-full right-0 z-30 mb-2 w-64 rounded-control border border-atelier-rule bg-atelier-surface p-3 shadow-[0_24px_48px_-12px_rgba(33,29,18,0.4)]">
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
                          onClick={() => submitReport(viewer)}
                          disabled={reportSending}
                          className="mt-2 w-full rounded-control bg-atelier-ink py-1.5 text-xs font-medium text-atelier-paper transition-opacity hover:opacity-90 disabled:opacity-50"
                        >
                          {reportSending ? g.reportSending : g.reportSubmit}
                        </button>
                      </div>
                    )}
                  </div>
                )}
                {isAdmin && (
                  <button
                    type="button"
                    onClick={() => toggleHidden(viewer)}
                    className="rounded-full bg-[#f5f1e9]/10 px-3 py-1.5 text-xs font-medium text-[#f5f1e9]/80 transition-colors hover:bg-[#f5f1e9]/15"
                  >
                    {(hiddenState[viewer.id] ?? viewer.hidden) ? c.unhide : c.hide}
                  </button>
                )}
              </div>
            </div>

            <div className="mt-3 flex justify-center">
              <MediaActionBar url={viewer.displayUrl} contentType={viewer.contentType} />
            </div>
          </div>

          <button
            type="button"
            aria-label="Close"
            onClick={() => setViewer(null)}
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
