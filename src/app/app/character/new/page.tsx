import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { CharacterForm } from "@/components/character-form";
import { getServerMessages } from "@/lib/i18n/server";

export default async function NewCharacterPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { t } = await getServerMessages();
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
      <h1 className="mx-auto mb-6 max-w-2xl text-lg font-semibold text-neutral-900">
        {t.character.newTitle}
      </h1>
      <CharacterForm
        userId={data.user.id}
        errorMessage={error}
        projects={projects ?? []}
        voices={voices ?? []}
      />
    </div>
  );
}
