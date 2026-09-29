import { redirect } from "next/navigation";
import { createClient, createAdminClient } from "@/lib/supabase/server";
import { getServerMessages } from "@/lib/i18n/server";
import { formatMsg } from "@/lib/i18n/format";
import { loadPrefs } from "@/lib/producer/store";
import { MemoryList } from "@/components/aly-chat/memory-list";

/**
 * What Aly remembers (2026-09-29, "a memory you can see"): her notes, the
 * same ones the lamp keeps, each one readable, editable and deletable.
 */
export default async function MemoryPage() {
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  if (!data.user) redirect("/login");
  const [{ t }, prefs, { data: notes }] = await Promise.all([
    getServerMessages(),
    loadPrefs(createAdminClient(), data.user.id),
    supabase
      .from("producer_notes")
      .select("path, content, updated_at")
      .eq("user_id", data.user.id)
      .order("updated_at", { ascending: false })
      .limit(100),
  ]);
  const c = t.alyChat;
  return (
    <div className="mx-auto max-w-2xl">
      <h1 className="text-2xl font-semibold tracking-tight text-atelier-ink">{formatMsg(c.memoryTitle, { name: prefs.name })}</h1>
      <p className="mt-2 text-sm text-atelier-muted">{formatMsg(c.memoryIntro, { name: prefs.name })}</p>
      <MemoryList
        notes={(notes ?? []).map((n) => ({ path: n.path as string, content: n.content as string }))}
        emptyText={formatMsg(c.memoryEmpty, { name: prefs.name })}
      />
    </div>
  );
}
