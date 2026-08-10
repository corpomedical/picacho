import { getMonthlyUsage } from "@/lib/generations/actions";
import { isVoiceModeEnabled } from "@/lib/voice/enabled";
import { PLAN_LIMITS, type PlanId } from "@/lib/plans";
import {
  VIDEO_MODELS_BY_PRICE,
  getDefaultDurationSeconds,
  type VideoDurationOption,
} from "@/lib/generations/providers/video-models";
import type { createClient } from "@/lib/supabase/server";

type SupabaseServerClient = Awaited<ReturnType<typeof createClient>>;

export type CharacterOption = {
  id: string;
  name: string;
  referencePhotos: { path: string; url: string }[];
  voiceId: string | null;
};

export type VideoModelOption = {
  id: string;
  name: string;
  description: string;
  durations: VideoDurationOption[];
  defaultDurationSeconds: number;
};

export type GenerateWorkspaceData = {
  hasCharacter: boolean;
  charactersForForm: CharacterOption[];
  videoModels: VideoModelOption[];
  defaultVideoModelId: string;
  elitePlanActive: boolean;
  multiAngleAvailable: boolean;
  approachingLimit: boolean;
  voiceModeEnabled: boolean;
  // Raw numbers + the real reset timestamp (when known — see
  // current_period_end below), so the usage banner in generate-form.tsx can
  // show "12 of 15 used, resets Aug 12 at 2:00 PM" instead of just a plain
  // warning with no specifics.
  creditsUsed: number;
  creditsLimit: number;
  // Top-up credits bought outright. Separate from the monthly allowance
  // because they don't reset — and because the composer needs the real total
  // to work out whether the selected model is actually affordable.
  purchasedCredits: number;
  // ISO string from the caller's actual Stripe billing cycle
  // (profiles.current_period_end), or null for a "none"-plan/bonus-only
  // profile, or an existing subscriber not yet backfilled with real Stripe
  // dates — the banner falls back to "resets on the 1st" in that case.
  currentPeriodEnd: string | null;
};

// Shared by /app/page.tsx (the dashboard home, which now embeds the same
// composer in "hero" mode) and /app/generate/page.tsx, so the two entry
// points into generation can never drift out of sync with each other.
export async function getGenerateWorkspaceData(
  supabase: SupabaseServerClient,
  userId: string | undefined,
): Promise<GenerateWorkspaceData> {
  // .eq("user_id", ...) here isn't optional — an admin's SELECT policy
  // intentionally allows reading every user's characters (for /admin), so
  // without this the Generate composer's character picker would list every
  // user's characters to an admin, not just their own (and the reference
  // photo signing below would then fail for anyone else's paths anyway,
  // since storage RLS has no admin bypass — the same failure mode as the
  // /app/character list bug).
  const { data: characters } = await supabase
    .from("character_profiles")
    .select("id, name, reference_image_urls, voice_id")
    .eq("user_id", userId)
    .order("created_at", { ascending: false });

  const hasCharacter = Boolean(characters && characters.length > 0);

  // Reference photos, signed up front so the storyboard/multi-reference
  // pickers in the composer (Kling advanced options) have something to show
  // without a round trip when a character is selected. One batched sign
  // call across every character's photos, rather than one call per photo.
  const allPaths = (characters ?? []).flatMap((c) => (c.reference_image_urls as string[] | null) ?? []);
  const signedByPath = new Map<string, string>();
  if (allPaths.length > 0) {
    const { data: signedList } = await supabase.storage
      .from("character-references")
      .createSignedUrls(allPaths, 60 * 60);
    for (const s of signedList ?? []) {
      if (s.path && s.signedUrl) signedByPath.set(s.path, s.signedUrl);
    }
  }
  const charactersForForm: CharacterOption[] = (characters ?? []).map((c) => ({
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
  const defaultVideoModelId = videoModelSetting?.value ?? "kling";
  // Cheapest first — see VIDEO_MODELS_BY_PRICE.
  const videoModels: VideoModelOption[] = VIDEO_MODELS_BY_PRICE.map((m) => ({
    id: m.id,
    name: m.name,
    description: m.description,
    durations: [...m.durations],
    defaultDurationSeconds: getDefaultDurationSeconds(m),
  }));

  // Storyboard and multi-image reference are Elite-exclusive (admins get a
  // free pass, same as the generation-cap exemption below).
  const { data: profile } = userId
    ? await supabase
        .from("profiles")
        .select("plan, role, bonus_credits, purchased_credits, current_period_start, current_period_end")
        .eq("id", userId)
        .single()
    : { data: null };
  const elitePlanActive = profile?.plan === "elite" || profile?.role === "admin";
  // Multi-angle is several generations in one click, so it isn't part of the
  // free trial (enforced in runMultiAngleGeneration). Mirrored here so the
  // button is hidden rather than letting someone pick angles, confirm, and
  // only then be told no — the worst possible moment to find out.
  const multiAngleAvailable =
    (profile?.plan ?? "none") !== "none" ||
    (profile?.bonus_credits ?? 0) > 0 ||
    profile?.role === "admin";

  // Same "approaching your limit" nudge Claude/ChatGPT show near the
  // composer once you're close to a usage cap — admins are exempt since
  // they're not actually capped (see checkGenerationAllowance), and it only
  // shows in the 80%-99% band; at 100% the hard block in runGeneration
  // already takes over with its own message. Bonus credits (admin-granted)
  // widen the limit here too, same as the actual enforcement check, so this
  // nudge doesn't fire early for someone who still has bonus credits left.
  const isAdminUser = profile?.role === "admin";
  const planLimit =
    PLAN_LIMITS[(profile?.plan ?? "none") as PlanId] + (profile?.bonus_credits ?? 0);
  const usedThisMonth = userId
    ? await getMonthlyUsage(userId, profile?.current_period_start as string | null | undefined)
    : 0;
  const approachingLimit =
    !isAdminUser && planLimit > 0 && usedThisMonth < planLimit && usedThisMonth / planLimit >= 0.8;

  const voiceModeEnabled = await isVoiceModeEnabled(supabase);

  return {
    hasCharacter,
    charactersForForm,
    videoModels,
    defaultVideoModelId,
    elitePlanActive,
    multiAngleAvailable,
    approachingLimit,
    voiceModeEnabled,
    creditsUsed: usedThisMonth,
    creditsLimit: planLimit,
    purchasedCredits: (profile?.purchased_credits ?? 0) as number,
    currentPeriodEnd: (profile?.current_period_end as string | null | undefined) ?? null,
  };
}
