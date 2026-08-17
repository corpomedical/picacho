import { createClient } from "@/lib/supabase/server";
import { toMediaUrl } from "@/lib/media/url";
import { MediaGallery, type GalleryItem } from "@/components/media-gallery";
import { getServerMessages } from "@/lib/i18n/server";

export default async function VideosPage() {
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
    .order("created_at", { ascending: false })
    .limit(60);

  if (error) console.error("Failed to load videos:", error);

  const characterIds = Array.from(
    new Set((generations ?? []).map((g) => g.character_profile_id).filter(Boolean)),
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
  for (const g of generations ?? []) {
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
      <h1 className="text-lg font-semibold text-neutral-900">{t.gallery.videosTitle}</h1>
      <p className="mt-1 text-sm text-neutral-500">{t.gallery.videosSubtitle}</p>

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
    </div>
  );
}
