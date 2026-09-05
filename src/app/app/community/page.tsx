import Link from "next/link";
import type { ReactNode } from "react";
import { createClient } from "@/lib/supabase/server";
import { toMediaUrl, thumbUrl, isRenderableUrl } from "@/lib/media/url";
import { getServerMessages } from "@/lib/i18n/server";
import { formatMsg } from "@/lib/i18n/format";
import { PAGE_SIZES, pageBounds, pageHref, pageRange, parsePage, takePage } from "@/lib/pagination";
import { Pager } from "@/components/pager";
import { CommunityFeed, type CommunityPostView } from "@/components/community-feed";

// The community feed — opt-in shared renders from every account, hearts +
// views, newest or top. Reads are a single RLS-guarded select over
// community_posts (the row snapshots everything the feed shows — see
// supabase/applied/2026-08-21/community.sql for why); media URLs are
// re-derived through the same non-expiring signed proxy the media library
// uses. Tolerates the SQL not being applied yet: an error just renders the
// empty state.

function FilterPill({ href, active, children }: { href: string; active: boolean; children: ReactNode }) {
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={
        active
          ? "rounded-full bg-atelier-ink px-3 py-1 text-xs font-medium text-atelier-paper"
          : "rounded-full px-3 py-1 text-xs text-atelier-muted transition-colors hover:text-atelier-ink"
      }
    >
      {children}
    </Link>
  );
}

// match_score + character_name arrive with applied/2026-08-22/
// community-feed.sql — apply it BEFORE deploying this select.
const POST_COLUMNS =
  "id, user_id, username, caption, prompt, media_url, content_type, hearts_count, views_count, created_at, hidden_at, match_score, character_name";

export default async function CommunityPage({
  searchParams,
}: {
  searchParams: Promise<{ sort?: string; item?: string; page?: string }>;
}) {
  const { t } = await getServerMessages();
  const c = t.community;
  const raw = await searchParams;
  const { sort: sortParam, item } = raw;
  const sort = sortParam === "top" ? "top" : "new";
  const page = parsePage(raw.page);
  const size = PAGE_SIZES.community;
  const { from, to } = pageRange(page, size);

  const supabase = await createClient();
  const { data: userData } = await supabase.auth.getUser();
  const userId = userData.user?.id ?? "";

  let query = supabase.from("community_posts").select(POST_COLUMNS).range(from, to);
  query =
    sort === "top"
      ? query.order("hearts_count", { ascending: false }).order("created_at", { ascending: false })
      : query.order("created_at", { ascending: false });
  const { data: rows } = await query;
  const { rows: pagedRows, hasNext } = takePage(rows ?? [], size);

  const visible = pagedRows.filter((r) => isRenderableUrl(r.media_url));
  const pagedCount = visible.length;

  // A share link (?item=<id>) must open its post even when the post has aged
  // off this page: the grid used to load, the client's findIndex to miss,
  // and the link to die with nothing on screen. Fetch the linked post
  // directly and put it first — RLS still decides whether this viewer may
  // see it at all.
  if (item && !visible.some((r) => r.id === item)) {
    const { data: linked } = await supabase
      .from("community_posts")
      .select(POST_COLUMNS)
      .eq("id", item)
      .maybeSingle();
    if (linked && isRenderableUrl(linked.media_url)) visible.unshift(linked);
  }

  // Which of these the current account already hearted (for the filled state).
  let heartedIds: string[] = [];
  if (visible.length > 0) {
    const { data: hearts } = await supabase
      .from("community_hearts")
      .select("post_id")
      .eq("user_id", userId)
      .in(
        "post_id",
        visible.map((r) => r.id),
      );
    heartedIds = (hearts ?? []).map((h) => h.post_id);
  }

  const { data: me } = await supabase.from("profiles").select("role").eq("id", userId).maybeSingle();
  const isAdmin = me?.role === "admin";

  const posts: CommunityPostView[] = visible.map((r) => {
    const display = toMediaUrl(r.media_url) ?? r.media_url;
    return {
      id: r.id,
      username: r.username,
      caption: r.caption,
      prompt: r.prompt,
      contentType: r.content_type === "video" ? "video" : "image",
      displayUrl: display,
      // Sized variants derive from `display` — the RE-SIGNED url — never
      // from the raw stored snapshot: its baked signature predates the
      // signing key for older renders, and thumbUrl() doesn't re-sign
      // (2026-08-22: every such thumb 404'd, the fallback loaded full
      // multi-MB originals, and the whole grid felt broken-slow).
      thumbUrl: r.content_type === "video" ? display : (thumbUrl(display, 640) ?? display),
      feedUrl: r.content_type === "video" ? display : (thumbUrl(display, 1600) ?? display),
      hearts: r.hearts_count ?? 0,
      views: r.views_count ?? 0,
      createdAt: r.created_at,
      hidden: r.hidden_at != null,
      mine: r.user_id === userId,
      matchScore: typeof r.match_score === "number" ? Math.round(r.match_score) : null,
      characterName: r.character_name ?? null,
    };
  });

  return (
    <div className="mx-auto max-w-5xl">
      <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
        <div>
          <p className="text-[10.5px] font-semibold uppercase tracking-[0.14em] text-atelier-muted">
            {c.eyebrow}
          </p>
          <h1 className="mt-1 font-numeral text-3xl font-semibold tracking-tight text-atelier-ink">
            {c.title}
          </h1>
          <p className="mt-1 text-sm text-atelier-muted">{c.subtitle}</p>
        </div>
        <div className="inline-flex items-center gap-0.5 rounded-full border border-atelier-rule bg-atelier-surface p-1">
          <FilterPill href="/app/community" active={sort === "new"}>
            {c.sortNew}
          </FilterPill>
          <FilterPill href="/app/community?sort=top" active={sort === "top"}>
            {c.sortTop}
          </FilterPill>
        </div>
      </div>

      <CommunityFeed posts={posts} heartedIds={heartedIds} isAdmin={isAdmin} initialPostId={item} />

      {posts.length > 0 && (
        <Pager
          // `item` deliberately not carried into the page links — it would
          // reopen the linked post's viewer on every page turn.
          prevHref={page > 1 ? pageHref("/app/community", { sort: raw.sort }, page - 1) : null}
          nextHref={hasNext ? pageHref("/app/community", { sort: raw.sort }, page + 1) : null}
          label={formatMsg(t.history.pageRange, pageBounds(page, size, pagedCount))}
          prevLabel={t.common.prev}
          nextLabel={t.common.next}
        />
      )}
    </div>
  );
}
