import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { toMediaUrl, thumbUrl, isRenderableUrl } from "@/lib/media/url";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { SubmitButton } from "@/components/ui/submit-button";
import { AdminErrorBanner } from "@/components/admin-error-banner";
import { setCommunityPostModeration } from "@/lib/admin/actions";

// The moderation area (2026-08-27, operator: "I need a moderation area for
// it [community]"). Everything currently shared into the community feed —
// hidden posts included, which the admin RLS select allows — with each
// post's open-report count from the community source of generation_reports,
// and a one-click hide/unhide that rides the same RLS policy as the in-feed
// admin control. Reports themselves are worked in /admin/reports (they were
// already flowing there); this page is about the POSTS. The failed-render
// list this page used to be lives on below the community section.

function PlayGlyph(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" {...props}>
      <path d="M8 5v14l11-7Z" />
    </svg>
  );
}

type PostRow = {
  id: string;
  generation_id: string | null;
  user_id: string;
  username: string | null;
  caption: string | null;
  prompt: string | null;
  media_url: string | null;
  content_type: string;
  hearts_count: number | null;
  views_count: number | null;
  hidden_at: string | null;
  created_at: string;
};

export default async function AdminModerationPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error: errorParam } = await searchParams;
  const supabase = await createClient();

  const [{ data: postRows, error: postsError }, { data: failedRows, error: failedError }] =
    await Promise.all([
      supabase
        .from("community_posts")
        .select(
          "id, generation_id, user_id, username, caption, prompt, media_url, content_type, hearts_count, views_count, hidden_at, created_at",
        )
        .order("created_at", { ascending: false })
        .limit(60),
      supabase
        .from("generations")
        .select("id, user_id, prompt_input, status, attempts, created_at")
        .eq("status", "failed")
        .order("created_at", { ascending: false })
        .limit(30),
    ]);

  const posts = (postRows ?? []) as PostRow[];

  // Open community reports, counted per post's generation.
  const genIds = posts.map((p) => p.generation_id).filter((g): g is string => Boolean(g));
  const { data: reportRows } = genIds.length
    ? await supabase
        .from("generation_reports")
        .select("generation_id, status")
        .eq("source", "community")
        .eq("status", "open")
        .in("generation_id", genIds)
    : { data: [] as { generation_id: string; status: string }[] };
  const openReportsByGen = new Map<string, number>();
  for (const r of reportRows ?? []) {
    if (!r.generation_id) continue;
    openReportsByGen.set(r.generation_id, (openReportsByGen.get(r.generation_id) ?? 0) + 1);
  }
  const totalOpenReports = (reportRows ?? []).length;

  // Owner emails for both sections in one lookup.
  const userIds = Array.from(
    new Set([...posts.map((p) => p.user_id), ...(failedRows ?? []).map((g) => g.user_id)]),
  );
  const { data: users } = userIds.length
    ? await supabase.from("profiles").select("id, email").in("id", userIds)
    : { data: [] as { id: string; email: string }[] };
  const emailById = new Map((users ?? []).map((u) => [u.id, u.email]));

  const hiddenCount = posts.filter((p) => p.hidden_at != null).length;

  return (
    <div>
      <h1 className="text-lg font-semibold text-neutral-900">Moderation</h1>
      <p className="mt-1 text-sm text-neutral-500">
        Everything shared into the community feed, hidden posts included. Hiding is reversible and
        keeps the sharer&apos;s row; reports are worked in{" "}
        <Link href="/admin/reports" className="underline underline-offset-2 hover:text-neutral-900">
          Reports
        </Link>
        .
      </p>

      <AdminErrorBanner error={errorParam} />

      <div className="mt-6 flex flex-wrap items-center gap-2">
        <Badge tone="neutral">{posts.length} shared</Badge>
        <Badge tone={hiddenCount > 0 ? "warning" : "neutral"}>{hiddenCount} hidden</Badge>
        <Badge tone={totalOpenReports > 0 ? "danger" : "neutral"}>
          {totalOpenReports} open report{totalOpenReports === 1 ? "" : "s"}
        </Badge>
      </div>

      <div className="mt-4 space-y-3">
        {postsError ? (
          <Card className="text-center">
            <p className="text-sm text-red-600">Couldn&apos;t load posts: {postsError.message}</p>
          </Card>
        ) : posts.length === 0 ? (
          <Card className="text-center">
            <p className="text-sm text-neutral-500">Nothing has been shared yet.</p>
          </Card>
        ) : (
          posts.map((post) => {
            const display =
              post.media_url && isRenderableUrl(post.media_url)
                ? (toMediaUrl(post.media_url) ?? post.media_url)
                : null;
            const isVideo = post.content_type === "video";
            const isHidden = post.hidden_at != null;
            const reports = post.generation_id
              ? (openReportsByGen.get(post.generation_id) ?? 0)
              : 0;
            return (
              <Card key={post.id} className="flex items-center gap-4 p-4">
                <div className="relative h-20 w-20 flex-shrink-0 overflow-hidden rounded-xl bg-neutral-900">
                  {display ? (
                    isVideo ? (
                      <video
                        src={`${display}#t=0.1`}
                        muted
                        playsInline
                        preload="metadata"
                        className="h-full w-full object-cover"
                      />
                    ) : (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={thumbUrl(display, 320) ?? display}
                        alt=""
                        className="h-full w-full object-cover"
                      />
                    )
                  ) : null}
                  {isVideo && (
                    <span className="absolute right-1 top-1 flex h-5 w-5 items-center justify-center rounded-full bg-black/60 text-white">
                      <PlayGlyph className="ml-px h-2.5 w-2.5" />
                    </span>
                  )}
                </div>

                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-neutral-900">
                    {post.caption || post.prompt || "(no caption)"}
                  </p>
                  <p className="mt-0.5 truncate text-xs text-neutral-500">
                    {post.username ? `@${post.username}` : "unknown"} ·{" "}
                    {emailById.get(post.user_id) ?? "unknown email"} ·{" "}
                    {new Date(post.created_at).toLocaleDateString()}
                  </p>
                  <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs tabular-nums text-neutral-500">
                    <span>{isVideo ? "video" : "image"}</span>
                    <span>♥ {post.hearts_count ?? 0}</span>
                    <span>{post.views_count ?? 0} views</span>
                  </p>
                </div>

                <div className="flex flex-shrink-0 flex-col items-end gap-2">
                  <div className="flex items-center gap-1.5">
                    {reports > 0 && (
                      <Badge tone="danger">
                        {reports} report{reports === 1 ? "" : "s"}
                      </Badge>
                    )}
                    {isHidden && <Badge tone="warning">hidden</Badge>}
                  </div>
                  <div className="flex items-center gap-2">
                    <Link
                      href={`/app/community?item=${post.id}`}
                      className="rounded-full border border-neutral-200 px-3 py-1 text-xs font-medium text-neutral-600 transition-colors hover:border-neutral-400 hover:text-neutral-900"
                    >
                      View
                    </Link>
                    <form action={setCommunityPostModeration}>
                      <input type="hidden" name="post_id" value={post.id} />
                      <input type="hidden" name="hide" value={isHidden ? "0" : "1"} />
                      <SubmitButton
                        className={
                          isHidden
                            ? "rounded-full border border-neutral-200 px-3 py-1 text-xs font-medium text-neutral-600 transition-colors hover:border-neutral-400 hover:text-neutral-900"
                            : "rounded-full bg-neutral-900 px-3 py-1 text-xs font-medium text-white transition-colors hover:bg-neutral-700"
                        }
                        pendingLabel="Saving…"
                      >
                        {isHidden ? "Unhide" : "Hide"}
                      </SubmitButton>
                    </form>
                  </div>
                </div>
              </Card>
            );
          })
        )}
      </div>

      <h2 className="mt-12 text-base font-semibold text-neutral-900">Failed generations</h2>
      <p className="mt-1 text-sm text-neutral-500">
        Renders that failed to pass validation after every retry.
      </p>
      <div className="mt-4 space-y-3">
        {failedError ? (
          <Card className="text-center">
            <p className="text-sm text-red-600">Couldn&apos;t load: {failedError.message}</p>
          </Card>
        ) : !failedRows || failedRows.length === 0 ? (
          <Card className="text-center">
            <p className="text-sm text-neutral-500">Nothing flagged. All clear.</p>
          </Card>
        ) : (
          failedRows.map((g) => (
            <Link key={g.id} href={`/app/history/${g.id}`} className="block">
              <Card className="flex items-center justify-between gap-4 p-5 transition-shadow hover:shadow-[0_8px_20px_-10px_rgba(0,0,0,0.12)]">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-neutral-900">{g.prompt_input}</p>
                  <p className="mt-0.5 truncate text-xs text-neutral-500">
                    {emailById.get(g.user_id) ?? "Unknown user"} ·{" "}
                    {new Date(g.created_at).toLocaleDateString()} · {g.attempts} attempts
                  </p>
                </div>
                <Badge tone="danger" className="flex-shrink-0">
                  failed
                </Badge>
              </Card>
            </Link>
          ))
        )}
      </div>
    </div>
  );
}
