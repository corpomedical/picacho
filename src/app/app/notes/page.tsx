import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { NotesClient } from "@/components/notes-client";
import { getServerMessages } from "@/lib/i18n/server";

export default async function NotesPage() {
  const { t } = await getServerMessages();
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  if (!data.user) redirect("/login");

  const { data: notes } = await supabase
    .from("notes")
    .select("id, title, body, updated_at")
    .eq("user_id", data.user.id)
    .order("updated_at", { ascending: false });

  return (
    <div>
      <h1 className="text-lg font-semibold text-neutral-900">{t.notes.title}</h1>
      <p className="mt-1 text-sm text-neutral-500">
        {t.notes.subtitle}
      </p>

      <NotesClient initialNotes={notes ?? []} />
    </div>
  );
}
