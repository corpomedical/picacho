import { redirect } from "next/navigation";
import { ownVoiceCard } from "@/lib/voices/library-options";
import { createClient } from "@/lib/supabase/server";
import { CharacterForm } from "@/components/character-form";
import { safeReturnTo } from "@/lib/characters/return-to";

export default async function NewCharacterPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; returnTo?: string }>;
}) {
  const { error, returnTo } = await searchParams;
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  if (!data.user) redirect("/login");

  const [{ data: projects }, { data: voices }, { data: ownVoiceRows }] = await Promise.all([
    supabase
      .from("projects")
      .select("id, name")
      .eq("user_id", data.user.id)
      .order("name", { ascending: true }),
    supabase.from("voice_presets").select("id, label, description").is("owner_id", null).order("sort_order", { ascending: true }).order("created_at", { ascending: true }).order("id", { ascending: true }),
    // This person's own voices (library picks, generated, cloned — the voice
    // sheet): the character's current one may be among them.
    supabase.from("voice_presets").select("id, label, description, source, attributes").eq("owner_id", data.user.id).order("created_at", { ascending: false }).limit(100),
  ]);

  return (
    <div>
      {/* No <h1> here any more: the form's masthead carries the eyebrow and
          the name field that used to sit under this heading. */}
      <CharacterForm
        userId={data.user.id}
        errorMessage={error}
        projects={projects ?? []}
        voices={voices ?? []}
        ownVoices={(ownVoiceRows ?? []).map(ownVoiceCard)}
        returnTo={safeReturnTo(returnTo)}
      />
    </div>
  );
}
