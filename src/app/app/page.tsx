import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { Button } from "@/components/ui/button";
import { HomeComposer } from "@/components/home-composer";
import { getServerMessages } from "@/lib/i18n/server";
import { formatMsg } from "@/lib/i18n/format";

export default async function AppHome() {
  const { t } = await getServerMessages();
  const d = t.dashboard;
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();

  const [{ count: characterCount }, { data: profile }] = await Promise.all([
    supabase.from("character_profiles").select("*", { count: "exact", head: true }),
    supabase.from("profiles").select("username").eq("id", data.user?.id ?? "").single(),
  ]);

  const hasCharacter = (characterCount ?? 0) > 0;
  const name = profile?.username ?? (data.user?.email ?? "").split("@")[0];

  if (!hasCharacter) {
    return (
      <div className="flex min-h-[60vh] flex-col items-center justify-center text-center">
        <h1 className="text-2xl font-semibold text-neutral-900">{formatMsg(d.greeting, { name })}</h1>
        <p className="mt-2 max-w-sm text-sm text-neutral-500">{d.setupCharacterBody}</p>
        <Link href="/app/character/new" className="mt-6">
          <Button>{d.setupCharacterCta}</Button>
        </Link>
      </div>
    );
  }

  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center">
      <h1 className="text-2xl font-semibold text-neutral-900">{formatMsg(d.greetingWithPrompt, { name })}</h1>
      <div className="mt-6 w-full">
        <HomeComposer />
      </div>
    </div>
  );
}
