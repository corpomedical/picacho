import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getReliabilityStats } from "@/lib/generations/actions";
import { GenerateForm } from "@/components/generate-form";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { getServerMessages } from "@/lib/i18n/server";

// Video generation (Kling, via fal.ai) routinely takes 30s-3min. Most hosts
// (Vercel included) cap a server action's run time well below that by
// default — raise it here so a normal, successful-but-slow generation isn't
// killed mid-flight.
export const maxDuration = 200;

export default async function GeneratePage() {
  const { t } = await getServerMessages();
  const g = t.generate;
  const supabase = await createClient();
  const { data: userData } = await supabase.auth.getUser();

  const { data: characters } = await supabase
    .from("character_profiles")
    .select("id, name, reference_image_urls, voice_id")
    .order("created_at", { ascending: false });

  if (!characters || characters.length === 0) {
    return (
      <div className="mx-auto max-w-md text-center">
        <Card>
          <h1 className="text-lg font-semibold text-neutral-900">{g.noCharacterTitle}</h1>
          <p className="mt-2 text-sm text-neutral-500">{g.noCharacterBody}</p>
          <Link href="/app/character/new" className="mt-6 block">
            <Button className="w-full">{g.noCharacterCta}</Button>
          </Link>
        </Card>
      </div>
    );
  }

  const stats = userData.user
    ? await getReliabilityStats(userData.user.id)
    : { firstTryRate: null, avgAttempts: null, total: 0 };

  // Reference photos, signed up front so the storyboard/multi-reference
  // pickers in the composer (Kling advanced options) have something to show
  // without a round trip when a character is selected. One batched sign
  // call across every character's photos, rather than one call per photo.
  const allPaths = characters.flatMap((c) => (c.reference_image_urls as string[] | null) ?? []);
  const signedByPath = new Map<string, string>();
  if (allPaths.length > 0) {
    const { data: signedList } = await supabase.storage
      .from("character-references")
      .createSignedUrls(allPaths, 60 * 60);
    for (const s of signedList ?? []) {
      if (s.path && s.signedUrl) signedByPath.set(s.path, s.signedUrl);
    }
  }
  const charactersForForm = characters.map((c) => ({
    id: c.id as string,
    name: c.name as string,
    referencePhotos: ((c.reference_image_urls as string[] | null) ?? [])
      .map((path) => ({ path, url: signedByPath.get(path) }))
      .filter((p): p is { path: string; url: string } => Boolean(p.url)),
    voiceId: (c.voice_id as string | null) ?? null,
  }));

  const { data: videoModelSetting } = await supabase
    .from("app_settings")
    .select("value")
    .eq("key", "video_model")
    .single();
  const klingActive = (videoModelSetting?.value ?? "kling") === "kling";

  // Storyboard and multi-image reference are Elite-exclusive (admins get a
  // free pass, same as the generation-cap exemption elsewhere).
  const { data: profile } = userData.user
    ? await supabase.from("profiles").select("plan, role").eq("id", userData.user.id).single()
    : { data: null };
  const elitePlanActive = profile?.plan === "elite" || profile?.role === "admin";

  return (
    <div className="mx-auto max-w-2xl">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-lg font-semibold text-neutral-900">Generate</h1>
        {stats.total > 0 && (
          <div className="flex gap-6 text-right">
            <div>
              <p className="text-lg font-semibold text-neutral-900">{stats.firstTryRate}%</p>
              <p className="text-xs text-neutral-500">first-try success</p>
            </div>
            <div>
              <p className="text-lg font-semibold text-neutral-900">{stats.avgAttempts}</p>
              <p className="text-xs text-neutral-500">avg. attempts</p>
            </div>
          </div>
        )}
      </div>

      <GenerateForm
        characters={charactersForForm}
        klingActive={klingActive}
        elitePlanActive={elitePlanActive}
      />
    </div>
  );
}
