import { getMonthlyUsage } from "@/lib/generations/actions";
import { guardedRead } from "@/lib/supabase/read-guard";
import { mediaUrl, thumbUrl } from "@/lib/media/url";
import { isVoiceModeEnabled } from "@/lib/voice/enabled";
import { isChatAgentEnabled } from "@/lib/agent/enabled";
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
  // Whether saved outfit photos exist — drives the composer's Outfit chip.
  // The photos themselves are resolved server-side at generation time.
  hasOutfit: boolean;
  // Render style for the Seedance lane rule (Send Receipt P3):
  // true = photoreal, false = illustrated, null = unknown (heuristic rules).
  photoreal: boolean | null;
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
  advancedPlanActive: boolean;
  multiAngleAvailable: boolean;
  approachingLimit: boolean;
  voiceModeEnabled: boolean;
  // Whether the composer may offer Ask. Both flags are read here rather
  // than in the component so the control simply does not exist in the HTML
  // when it is off — the API re-checks anyway (a hidden button is not an
  // access control), but there is no reason to ship the markup.
  chatAgentEnabled: boolean;
  // Whether Smarter is offered at all. The route downgrades free accounts
  // to Faster regardless (one Smarter turn can be a third of the free chat
  // allowance), so without this the picker would be a control that silently
  // does nothing — the UI says what the server will actually do.
  chatSmarterAvailable: boolean;
  // Rode along on the same profile read so /app/generate stops making its
  // own duplicate profiles query for the onboarding + daily-free banners
  // (2026-08-31 inspection).
  hasCompletedOnboarding: boolean;
  plan: string;
  bonusCredits: number;
  freeGenerationLastAt: string | null;
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
  // One round trip for the three independent reads instead of three in a
  // row (2026-08-31 inspection: this function alone was ~5 sequential trips
  // and /app/generate's TTFB is the sum of them — none of these depends on
  // another's answer).
  //
  // guardedRead on all three (2026-09-02, from a live first-session crash
  // report): these reads used to destructure `data` and DISCARD `error`, so
  // a transient DB failure didn't crash — it rendered a confidently wrong
  // page (characters null → the "create your first character" card shown to
  // someone who has characters; profile null → plan "none", zero credits).
  // Now a transient is absorbed by one retry, and a persistent failure
  // throws with the read's name so the function log carries the real cause
  // instead of a minified React #419.
  const [characters, videoModelSetting, profile] = await Promise.all([
    // No user, no characters — and no query. With userId undefined this
    // used to fire `.eq("user_id", undefined)`, which Postgres rejects as
    // "invalid input syntax for type uuid" — swallowed silently before the
    // guard existed, surfaced by it on its first live run (2026-09-02).
    userId
      ? guardedRead("characters", () =>
          supabase
            .from("character_profiles")
            .select("id, name, reference_image_urls, outfit_image_urls, voice_id, render_style")
            .eq("user_id", userId)
            .order("created_at", { ascending: false }),
        )
      : Promise.resolve(null),
    guardedRead("video-model setting", () =>
      supabase.from("app_settings").select("value").eq("key", "video_model").single(),
    ),
    userId
      ? guardedRead("profile", () =>
          supabase
            .from("profiles")
            .select(
              "plan, role, bonus_credits, purchased_credits, current_period_start, current_period_end, has_completed_onboarding, free_generation_last_at",
            )
            .eq("id", userId)
            .single(),
        )
      : Promise.resolve(null),
  ]);

  const hasCharacter = Boolean(characters && characters.length > 0);

  // Reference photos, signed up front so the storyboard/multi-reference
  // pickers in the composer (Kling advanced options) have something to show
  // without a round trip when a character is selected. One batched sign
  // call across every character's photos, rather than one call per photo.
  // Stable capability URLs (lib/media/url.ts) — pure computation, so the
  // batched storage signing round-trip this used to make on every app-shell
  // load is simply gone, and the browser caches each picker thumbnail.
  const charactersForForm: CharacterOption[] = (characters ?? []).map((c) => ({
    id: c.id as string,
    name: c.name as string,
    referencePhotos: ((c.reference_image_urls as string[] | null) ?? []).map((path) => ({
      path,
      // Picker thumbnails only. What actually anchors a generation is `path`,
      // resolved server-side against the real file — never this URL.
      url: thumbUrl(mediaUrl("character-references", path), 320) ?? "",
    })),
    voiceId: (c.voice_id as string | null) ?? null,
    hasOutfit: (((c.outfit_image_urls as string[] | null) ?? []).length > 0),
    photoreal:
      c.render_style === "photoreal" ? true : c.render_style === "illustrated" ? false : null,
  }));

  const defaultVideoModelId = videoModelSetting?.value ?? "kling";
  // Cheapest first — see VIDEO_MODELS_BY_PRICE.
  const videoModels: VideoModelOption[] = VIDEO_MODELS_BY_PRICE.map((m) => ({
    id: m.id,
    name: m.name,
    description: m.description,
    durations: [...m.durations],
    defaultDurationSeconds: getDefaultDurationSeconds(m),
  }));

  // Storyboard and multi-image reference are Studio-and-up (admins get a
  // free pass, same as the generation-cap exemption below). Moved down from
  // Elite-only on 2026-08-12 so the Studio tier has a capability difference,
  // not just a bigger quota — keep in sync with the server-side check in
  // generations/actions.ts and the pricing copy in lib/pricing.ts.
  const advancedPlanActive =
    profile?.plan === "studio" || profile?.plan === "elite" || profile?.role === "admin";
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
  // The remaining dependent read (needs current_period_start) rides with the
  // two flag lookups, one trip instead of two.
  const [usedThisMonth, voiceModeEnabled, chatAgentEnabled] = await Promise.all([
    userId
      ? getMonthlyUsage(userId, profile?.current_period_start as string | null | undefined)
      : Promise.resolve(0),
    isVoiceModeEnabled(supabase),
    isChatAgentEnabled(supabase),
  ]);
  const approachingLimit =
    !isAdminUser && planLimit > 0 && usedThisMonth < planLimit && usedThisMonth / planLimit >= 0.8;

  return {
    hasCharacter,
    charactersForForm,
    videoModels,
    defaultVideoModelId,
    advancedPlanActive,
    multiAngleAvailable,
    approachingLimit,
    voiceModeEnabled,
    chatAgentEnabled,
    chatSmarterAvailable: (profile?.plan ?? "none") !== "none",
    hasCompletedOnboarding: profile?.has_completed_onboarding === true,
    plan: (profile?.plan ?? "none") as string,
    bonusCredits: (profile?.bonus_credits ?? 0) as number,
    freeGenerationLastAt: (profile?.free_generation_last_at ?? null) as string | null,
    creditsUsed: usedThisMonth,
    creditsLimit: planLimit,
    purchasedCredits: (profile?.purchased_credits ?? 0) as number,
    currentPeriodEnd: (profile?.current_period_end as string | null | undefined) ?? null,
  };
}
