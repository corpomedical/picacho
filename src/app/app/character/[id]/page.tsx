import { redirect } from "next/navigation";
import { mediaUrl, thumbUrl, toMediaUrl } from "@/lib/media/url";
import { createClient } from "@/lib/supabase/server";
import { CharacterForm } from "@/components/character-form";
import { getServerMessages } from "@/lib/i18n/server";

export default async function EditCharacterPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const { t } = await getServerMessages();
  const { id } = await params;
  const { error } = await searchParams;
  const supabase = await createClient();
  const { data: userData } = await supabase.auth.getUser();
  if (!userData.user) redirect("/login");

  // .eq("user_id", ...) here isn't optional — without it, an admin's SELECT
  // policy (which intentionally allows reading every user's characters, for
  // /admin/users/[id]) would let this page load and let CharacterForm edit
  // someone else's character. Same reasoning for the projects list below,
  // which should only offer this user's own projects in the picker.
  const { data: profile } = await supabase
    .from("character_profiles")
    .select("*")
    .eq("id", id)
    .eq("user_id", userData.user.id)
    .single();

  // Same reasoning as the History detail page: deleting the character you're
  // looking at re-renders this route before the redirect lands, so a 404
  // would be the last thing you saw. Send people back to the list instead.
  if (!profile) redirect("/app/character");

  const toTile = (path: string) => ({
    path,
    url: mediaUrl("character-references", path),
    // Grid tiles only — the lightbox and everything the pipeline touches
    // keep using `url` above.
    thumbUrl: thumbUrl(mediaUrl("character-references", path), 320) ?? undefined,
  });
  const [existingImages, { data: projects }, { data: voices }] = await Promise.all([
    // Stable capability URLs — cacheable, no per-photo storage round trip.
    (profile.reference_image_urls ?? []).map(toTile),
    supabase
      .from("projects")
      .select("id, name")
      .eq("user_id", userData.user.id)
      .order("name", { ascending: true }),
    supabase.from("voice_presets").select("id, label, description").order("sort_order", { ascending: true }),
  ]);

  // "In action" (2026-08-27 redesign, case 4): the character's recent
  // succeeded image renders with their identity scores — the receipts of
  // the consistency promise, shown on the profile.
  const { data: recentRows } = await supabase
    .from("generations")
    .select("id, result_url, match_score")
    .eq("user_id", userData.user.id)
    .eq("character_profile_id", id)
    .eq("content_type", "image")
    .eq("status", "succeeded")
    // deleteGeneration soft-deletes the ROW but hard-deletes the FILE, so a
    // deleted render still matches every other clause here — and its media
    // URL 404s. Shipping without this filter put broken tiles on the strip
    // the first day (operator: "some pictures are not loading").
    .is("deleted_at", null)
    .not("result_url", "is", null)
    .order("created_at", { ascending: false })
    .limit(8);
  const recentRenders = (recentRows ?? [])
    .map((r) => ({
      id: r.id as string,
      url: thumbUrl(toMediaUrl(r.result_url as string) ?? "", 320) ?? "",
      score: (r.match_score ?? null) as number | null,
    }))
    .filter((r) => r.url);

  return (
    <div>
      <CharacterForm
        userId={userData.user.id}
        initial={profile}
        recentRenders={recentRenders}
        existingImages={existingImages}
        existingOutfitImages={(profile.outfit_image_urls ?? []).map(toTile)}
        errorMessage={error}
        projects={projects ?? []}
        voices={voices ?? []}
      />
    </div>
  );
}
