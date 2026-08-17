import { createClient } from "@/lib/supabase/server";
import { toMediaUrl, thumbUrl } from "@/lib/media/url";
import { MediaGallery, type GalleryItem } from "@/components/media-gallery";
import { getServerMessages } from "@/lib/i18n/server";

export default async function ImagesPage() {
  const { t } = await getServerMessages();
  const supabase = await createClient();
  const { data: userData } = await supabase.auth.getUser();
  if (!userData.user) return null;

  const { data: generations, error } = await supabase
    .from("generations")
    .select("id, prompt_input, status, result_url, content_type, created_at, character_profile_id")
    .eq("user_id", userData.user.id)
    .eq("content_type", "image")
    .order("created_at", { ascending: false })
    .limit(60);

  if (error) console.error("Failed to load images:", error);

  const characterIds = Array.from(
    new Set((generations ?? []).map((g) => g.character_profile_id).filter(Boolean)),
  );
  const { data: characters } = characterIds.length
    ? await supabase.from("character_profiles").select("id, name").in("id", characterIds)
    : { data: [] as { id: string; name: string }[] };
  const nameById = new Map((characters ?? []).map((c) => [c.id, c.name]));

  const items: GalleryItem[] = (generations ?? []).map((g) => ({
    id: g.id,
    prompt_input: g.prompt_input,
    status: g.status,
    // Grid thumbnails. Clicking through to /app/history/<id> loads the
    // real file, and the download there is the untouched original.
    result_url: thumbUrl(toMediaUrl(g.result_url), 640),
    content_type: g.content_type,
    created_at: g.created_at,
    characterName: g.character_profile_id
      ? (nameById.get(g.character_profile_id) ?? t.history.unknownCharacter)
      : t.history.noCharacter,
  }));

  return (
    <div>
      <h1 className="text-lg font-semibold text-neutral-900">{t.gallery.imagesTitle}</h1>
      <p className="mt-1 text-sm text-neutral-500">{t.gallery.imagesSubtitle}</p>

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
    </div>
  );
}
