import { redirect } from "next/navigation";
import { isRenderableUrl, mediaUrl, thumbUrl, toMediaUrl } from "@/lib/media/url";
import { createClient } from "@/lib/supabase/server";
import { CharacterForm } from "@/components/character-form";

export default async function EditCharacterPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
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

  // Never sign a path outside the owner's folder, whatever the row says. The
  // DB trigger enforces this for reference_image_urls; outfit_image_urls was
  // added later WITHOUT trigger coverage (pending-2026-09-05 closes that), so
  // a direct PostgREST write could plant another user's storage path here —
  // and this page would then mint a valid /api/media capability for it.
  const owned = (path: string) => path.startsWith(`${userData.user.id}/`);
  const toTile = (path: string) => ({
    path,
    url: mediaUrl("character-references", path),
    // Grid tiles only — the lightbox and everything the pipeline touches
    // keep using `url` above.
    thumbUrl: thumbUrl(mediaUrl("character-references", path), 320) ?? undefined,
  });
  const [existingImages, { data: projects }, { data: voices }] = await Promise.all([
    // Stable capability URLs — cacheable, no per-photo storage round trip.
    (profile.reference_image_urls ?? []).filter(owned).map(toTile),
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
  // Video belongs on the strip too. It was images-only because nothing
  // scored video until 2026-08-30; now that the middle frame is scored, a
  // video render is exactly the same kind of receipt — and a character whose
  // work is mostly video was looking at an empty profile.
  const [{ data: recentRows }, { data: statRows }] = await Promise.all([
    supabase
    .from("generations")
    .select("id, result_url, match_score, content_type")
    .eq("user_id", userData.user.id)
    .eq("character_profile_id", id)
    .eq("status", "succeeded")
    // deleteGeneration soft-deletes the ROW but hard-deletes the FILE, so a
    // deleted render still matches every other clause here — and its media
    // URL 404s. Shipping without this filter put broken tiles on the strip
    // the first day (operator: "some pictures are not loading").
    .is("deleted_at", null)
    .not("result_url", "is", null)
    .order("created_at", { ascending: false })
    .limit(15),
    // The masthead figures describe the CHARACTER, not the page of work
    // under them, so they are counted separately — bounded at 500 for the
    // same reason the project page bounds its own.
    supabase
      .from("generations")
      .select("match_score, created_at")
      .eq("user_id", userData.user.id)
      .eq("character_profile_id", id)
      .eq("status", "succeeded")
      .is("deleted_at", null)
      .order("created_at", { ascending: false })
      .limit(500),
  ]);
  const recentRenders = (recentRows ?? [])
    .map((r) => {
      const isVideo = r.content_type === "video";
      const url = toMediaUrl(r.result_url as string) ?? "";
      return {
        id: r.id as string,
        // thumbUrl on a video URL yields something no <img> and no <video>
        // can play — the broken lineage tile, 2026-09-03. Videos keep the
        // real file and are rendered by QuietVideo.
        url: isRenderableUrl(url) ? (isVideo ? url : (thumbUrl(url, 640) ?? url)) : "",
        score: (r.match_score ?? null) as number | null,
        isVideo,
      };
    })
    .filter((r) => r.url);

  const scored = (statRows ?? []).filter((r) => typeof r.match_score === "number");
  const stats = {
    renders: (statRows ?? []).length,
    meanIdentity:
      scored.length > 0
        ? Math.round(scored.reduce((n, r) => n + (r.match_score as number), 0) / scored.length)
        : null,
    lastWorkedAt: ((statRows ?? [])[0]?.created_at as string | undefined) ?? null,
  };

  return (
    <div>
      <CharacterForm
        userId={userData.user.id}
        initial={profile}
        recentRenders={recentRenders}
        stats={stats}
        existingImages={existingImages}
        existingOutfitImages={(profile.outfit_image_urls ?? []).filter(owned).map(toTile)}
        errorMessage={error}
        projects={projects ?? []}
        voices={voices ?? []}
      />
    </div>
  );
}
