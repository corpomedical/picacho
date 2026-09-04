import { createClient } from "@/lib/supabase/server";
import { formatMsg } from "@/lib/i18n/format";
import { Pager } from "@/components/pager";
import { PAGE_SIZES, pageBounds, pageHref, pageRange, parsePage, takePage } from "@/lib/pagination";
import { toMediaUrl, isRenderableUrl } from "@/lib/media/url";
import { MediaGallery, type GalleryItem } from "@/components/media-gallery";
import { getServerMessages } from "@/lib/i18n/server";

export default async function VideosPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string }>;
}) {
  const raw = await searchParams;
  const page = parsePage(raw.page);
  const size = PAGE_SIZES.videos;
  const { from, to } = pageRange(page, size);
  const { t } = await getServerMessages();
  const supabase = await createClient();
  const { data: userData } = await supabase.auth.getUser();
  if (!userData.user) return null;

  const { data: generations, error } = await supabase
    .from("generations")
    .select(
      "id, prompt_input, status, result_url, content_type, created_at, character_profile_id, angle_group_id, angle",
    )
    .eq("user_id", userData.user.id)
    .eq("content_type", "video")
    .is("deleted_at", null)
    // The media sections show finished work only — a failed generation has
    // no video, so it never gets a tile here (operator call, 2026-08-20).
    // History remains the complete record, failures included. In-flight
    // rows (drafted/generating/…) stay: in progress is not failed, and the
    // placeholder tile is how a just-fired render shows up at all. For a
    // multi-angle group this also means only its non-failed angles are
    // fetched, so the surviving angle becomes the tile's representative.
    .neq("status", "failed")
    .order("created_at", { ascending: false })
    .range(from, to);

  if (error) console.error("Failed to load videos:", error);

  // Same rule at the row level: a "succeeded" row with nothing the browser
  // can render (old mock runs stored result_url "mock://…") has no video to
  // hang a tile on — History keeps it, the gallery skips it.
  // The probe row comes off BEFORE the renderable filter, so "is there a
  // next page" answers about rows the query returned, not about how many of
  // them happened to have a video.
  const { rows: pageRows, hasNext } = takePage(generations ?? [], size);
  const visibleRows = pageRows.filter(
    (g) => g.status !== "succeeded" || isRenderableUrl(toMediaUrl(g.result_url)),
  );

  const characterIds = Array.from(
    new Set(visibleRows.map((g) => g.character_profile_id).filter(Boolean)),
  );
  const { data: characters } = characterIds.length
    ? await supabase.from("character_profiles").select("id, name").in("id", characterIds)
    : { data: [] as { id: string; name: string }[] };
  const nameById = new Map((characters ?? []).map((c) => [c.id, c.name]));

  // Multi-angle requests insert one row per angle, all sharing angle_group_id
  // — collapse those back into a single tile (front angle as the thumbnail,
  // or whichever angle came first) so the gallery reads as one request.
  type VideoRow = NonNullable<typeof generations>[number];
  const groups = new Map<string, VideoRow[]>();
  for (const g of visibleRows) {
    const key = g.angle_group_id ?? g.id;
    const arr = groups.get(key) ?? [];
    arr.push(g);
    groups.set(key, arr);
  }

  const items: GalleryItem[] = Array.from(groups.values())
    .map((rows) => {
      const representative = rows.find((g) => g.angle === "front") ?? rows[0];
      return {
        id: representative.id,
        prompt_input: representative.prompt_input,
        status: representative.status,
        result_url: toMediaUrl(representative.result_url),
        full_url: toMediaUrl(representative.result_url),
        content_type: representative.content_type,
        created_at: representative.created_at,
        characterName: representative.character_profile_id
          ? (nameById.get(representative.character_profile_id) ?? t.history.unknownCharacter)
          : t.history.noCharacter,
        angleCount: rows.length > 1 ? rows.length : undefined,
      };
    })
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

  return (
    <div>
      <h1 className="text-lg font-semibold text-atelier-ink">{t.gallery.videosTitle}</h1>
      <p className="mt-1 text-sm text-atelier-muted">{t.gallery.videosSubtitle}</p>

      <MediaGallery
        items={items}
        contentType="video"
        emptyLabel={t.gallery.noVideosYet}
        labels={{
          generateOne: t.gallery.generateOne,
          failed: t.generate.failed,
          simulated: t.generate.simulated,
          angleCountOther: t.history.angleCountOther,
        }}
      />

      {items.length > 0 && (
        <Pager
          prevHref={page > 1 ? pageHref("/app/videos", raw, page - 1) : null}
          nextHref={hasNext ? pageHref("/app/videos", raw, page + 1) : null}
          label={formatMsg(t.history.pageRange, pageBounds(page, size, items.length))}
          prevLabel={t.common.prev}
          nextLabel={t.common.next}
        />
      )}
    </div>
  );
}
