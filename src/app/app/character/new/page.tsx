import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { CharacterForm } from "@/components/character-form";

export default async function NewCharacterPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  if (!data.user) redirect("/login");

  const [{ data: projects }, { data: voices }] = await Promise.all([
    supabase
      .from("projects")
      .select("id, name")
      .eq("user_id", data.user.id)
      .order("name", { ascending: true }),
    supabase.from("voice_presets").select("id, label, description").order("sort_order", { ascending: true }),
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
      />
    </div>
  );
}
