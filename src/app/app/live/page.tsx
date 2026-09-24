import { notFound, redirect } from "next/navigation";
import { createAdminClient, createClient } from "@/lib/supabase/server";
import { mediaUrl, thumbUrl, toMediaUrl } from "@/lib/media/url";
import { isLiveEnabled, isLiveOpenToPlans, liveAllowed } from "@/lib/live/enabled";
import { sweepLiveTakes } from "@/lib/live/store";
import { readShotWords } from "@/lib/sets/shot-words-store";
import { LiveStage, type LiveCharacter, type LiveStill } from "@/components/live/live-stage";

// LIVE (2026-09-24) — MiniMax H3 Max Director: a take that streams while the
// person keeps directing it. The operator's siting: the Projector menu (the
// app bar's lamp, beside Generate Video and Recast) and Helios ("Direct it
// live" on a finished still, which arrives here as ?from=<still>&set=<set>).
// Every paid plan from the start; credits do the rest of the gating.
//
// The server half: who may, the characters with a photo, and — from Helios —
// the still and the shot's own words. The take itself runs in the browser
// (components/live/live-stage.tsx) through the relay (api/live/relay).
export const maxDuration = 120;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function LivePage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const supabase = await createClient();
  const { data: userData } = await supabase.auth.getUser();
  if (!userData.user) redirect("/login");
  const userId = userData.user.id;
  if (!(await isLiveEnabled(supabase))) notFound();

  const { data: profile } = await supabase.from("profiles").select("plan, role, status").eq("id", userId).maybeSingle();
  const access = liveAllowed(profile, profile?.role === "admin" || (await isLiveOpenToPlans(supabase)));
  // Admins first (operator, 2026-09-24): until live_paid_plans is on, to
  // anyone else this page does not exist — the Recast door's rule.
  if (access.code === "notOpen") notFound();

  // A take left open in another tab or a closed one settles on the way in.
  if (!access.error) await sweepLiveTakes(createAdminClient(), userId).catch(() => undefined);

  const params = await searchParams;
  const one = (v: string | string[] | undefined) => (typeof v === "string" ? v : null);
  const fromId = one(params.from);
  const setId = one(params.set);

  const { data: rows } = await supabase
    .from("character_profiles")
    .select("id, name, reference_image_urls")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(60);
  const characters: LiveCharacter[] = (rows ?? [])
    .map((c) => ({
      id: c.id as string,
      name: (c.name as string) || "",
      photos: ((c.reference_image_urls as string[] | null) ?? [])
        .slice(0, 6)
        .map((path) => ({ path, url: thumbUrl(mediaUrl("character-references", path), 320) ?? "" }))
        .filter((p) => p.url),
    }))
    .filter((c) => c.photos.length > 0);

  let still: LiveStill | null = null;
  if (fromId && UUID.test(fromId)) {
    const { data: g } = await supabase
      .from("generations")
      .select("id, result_url")
      .eq("id", fromId)
      .eq("user_id", userId)
      .eq("content_type", "image")
      .eq("status", "succeeded")
      .is("deleted_at", null)
      .maybeSingle<{ id: string; result_url: string | null }>();
    const stored = toMediaUrl(g?.result_url ?? null);
    if (g && stored) {
      let words: string | null = null;
      if (setId && UUID.test(setId)) {
        words = (await readShotWords(supabase, setId, userId, [g.id]).catch(() => new Map<string, string>())).get(g.id) ?? null;
      }
      still = { id: g.id, url: thumbUrl(stored, 1600) ?? stored, words };
    }
  }

  return (
    <LiveStage
      blocked={access.code === "suspended" || access.code === "needsPlan" ? access.code : null}
      characters={characters}
      still={still}
    />
  );
}
