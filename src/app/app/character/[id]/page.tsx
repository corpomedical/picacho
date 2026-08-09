import { notFound, redirect } from "next/navigation";
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

  if (!profile) notFound();

  const [existingImages, { data: projects }, { data: voices }] = await Promise.all([
    Promise.all(
      (profile.reference_image_urls ?? []).map(async (path: string) => {
        const { data } = await supabase.storage
          .from("character-references")
          .createSignedUrl(path, 60 * 60);
        return { path, url: data?.signedUrl ?? "" };
      }),
    ),
    supabase
      .from("projects")
      .select("id, name")
      .eq("user_id", userData.user.id)
      .order("name", { ascending: true }),
    supabase.from("voice_presets").select("id, label, description").order("sort_order", { ascending: true }),
  ]);

  return (
    <div>
      <h1 className="mx-auto mb-6 max-w-2xl text-lg font-semibold text-neutral-900">
        {t.character.editTitle}
      </h1>
      <CharacterForm
        userId={userData.user.id}
        initial={profile}
        existingImages={existingImages}
        errorMessage={error}
        projects={projects ?? []}
        voices={voices ?? []}
      />
    </div>
  );
}
