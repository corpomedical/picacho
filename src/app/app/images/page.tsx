import { createClient } from "@/lib/supabase/server";
import { formatMsg } from "@/lib/i18n/format";
import { Pager } from "@/components/pager";
import { PAGE_SIZES, pageBounds, pageHref, pageRange, parsePage, takePage } from "@/lib/pagination";
import { toMediaUrl, thumbUrl, isRenderableUrl } from "@/lib/media/url";
import { MediaGallery, type GalleryItem } from "@/components/media-gallery";
import { getServerMessages } from "@/lib/i18n/server";

export default async function ImagesPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string }>;
}) {
  const raw = await searchParams;
  const page = parsePage(raw.page);
  const size = PAGE_SIZES.images;
  const { from, to } = pageRange(page, size);
  const { t } = await getServerMessages();
  const supabase = await createClient();
  const { data: userData } = await supabase.auth.getUser();
  if (!userData.user) return null;

  const { data: generations, error } = await supabase
    .from("generations")
    .select("id, prompt_input, status, result_url, content_type, created_at, character_profile_id")
    .eq("user_id", userData.user.id)
    .eq("content_type", "image")
    .is("deleted_at", null)
    // The media sections show finished work only — a failed generation has
    // no image, so it never gets a tile here (operator call, 2026-08-20).
    // History remains the complete record, failures included. In-flight
    // rows (drafted/generating/…) stay: in progress is not failed, and the
    // placeholder tile is how a just-fired render shows up at all.
    .neq("status", "failed")
    .order("created_at", { ascending: false })
    .range(from, to);

  if (error) console.error("Failed to load images:", error);

  // Same rule at the row level: a "succeeded" row with nothing the browser
  // can render (old mock runs stored result_url "mock://…") has no image to
  // hang a tile on — History keeps it, the gallery skips it.
  // The probe row the range asked for comes off BEFORE the renderable
  // filter, so "is there a next page" answers about rows the query returned,
  // not about how many of them happened to have a picture.
  const { rows: pageRows, hasNext } = takePage(generations ?? [], size);
  const rows = pageRows.filter(
    (g) => g.status !== "succeeded" || isRenderableUrl(toMediaUrl(g.result_url)),
  );

  const characterIds = Array.from(
    new Set(rows.map((g) => g.character_profile_id).filter(Boolean)),
  );
  const { data: characters } = characterIds.length
    ? await supabase.from("character_profiles").select("id, name").in("id", characterIds)
    : { data: [] as { id: string; name: string }[] };
  const nameById = new Map((characters ?? []).map((c) => [c.id, c.name]));

  const items: GalleryItem[] = rows.map((g) => ({
    id: g.id,
    prompt_input: g.prompt_input,
    status: g.status,
    // Grid thumbnails; the viewer and its download use full_url — the
    // untouched original.
    result_url: thumbUrl(toMediaUrl(g.result_url), 640),
    full_url: toMediaUrl(g.result_url),
    content_type: g.content_type,
    created_at: g.created_at,
    characterName: g.character_profile_id
      ? (nameById.get(g.character_profile_id) ?? t.history.unknownCharacter)
      : t.history.noCharacter,
  }));

  return (
    <div>
      <h1 className="text-lg font-semibold text-atelier-ink">{t.gallery.imagesTitle}</h1>
      <p className="mt-1 text-sm text-atelier-muted">{t.gallery.imagesSubtitle}</p>

      <MediaGallery
        items={items}
        contentType="image"
        emptyLabel={t.gallery.noImagesYet}
        labels={{
          generateOne: t.gallery.generateOne,
          failed: t.generate.failed,
          simulated: t.generate.simulated,
          angleCountOther: t.history.angleCountOther,
        }}
      />

      {items.length > 0 && (
        <Pager
          prevHref={page > 1 ? pageHref("/app/images", raw, page - 1) : null}
          nextHref={hasNext ? pageHref("/app/images", raw, page + 1) : null}
          label={formatMsg(t.history.pageRange, pageBounds(page, size, items.length))}
          prevLabel={t.common.prev}
          nextLabel={t.common.next}
        />
      )}
    </div>
  );
}
