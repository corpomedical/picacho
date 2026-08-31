import { resolveSendPlan } from "@/lib/generations/send-plan";
import type { SupabaseClient } from "@supabase/supabase-js";
import { runRealPipeline } from "@/lib/generations/pipeline";
import {
  checkGenerationAllowance,
  consumeFreeGeneration,
  consumePurchasedCredits,
  persistGeneratedImage,
} from "@/lib/generations/core";
import { refundGenerationCosts } from "@/lib/generations/job-runner";
import { forceRefundEligible } from "@/lib/generations/refund-rules";
import { scoreIdentityMatch } from "@/lib/generations/providers/openai";
import { absolutizeMediaUrl, isRenderableUrl, toMediaUrl } from "@/lib/media/url";
import { getOrigin } from "@/lib/origin";
import type { BrandRule } from "@/lib/brand-rules/types";

// The API's image generation path.
//
// It shares the parts that must never diverge — the credit gate, the pipeline
// itself, image persistence, the refund path — and owns the parts that differ
// from the composer: no cookies, no RLS, so ownership is checked explicitly
// here on every row it touches.
//
// Images only in v1. Video renders take 6-10 minutes through a job queue,
// which needs a genuinely different (submit / poll / advance) shape; shipping
// half of that would be worse than not shipping it.

export type ApiGenerationResult =
  | { error: string; status: number }
  | {
      error: null;
      id: string;
      status: "succeeded" | "failed";
      prompt: string;
      imageUrl: string | null;
      matchScore: number | null;
      creditsUsed: number;
    };

export async function runApiImageGeneration(params: {
  supabase: SupabaseClient;
  userId: string;
  prompt: string;
  characterId: string | null;
  origin: string;
}): Promise<ApiGenerationResult> {
  const { supabase, userId, prompt, characterId } = params;

  // Ownership, explicitly. The composer can lean on RLS for this; a service
  // client cannot, and "select by id" against a service client is an IDOR
  // waiting to happen — any customer could generate against any other
  // customer's character by guessing a uuid.
  let character: {
    name: string;
    traits: Record<string, string>;
    motion_style: string | null;
    voice_tone_tags: string[];
    reference_image_urls: string[] | null;
  } | null = null;

  if (characterId) {
    const { data } = await supabase
      .from("character_profiles")
      .select("name, traits, motion_style, voice_tone_tags, reference_image_urls")
      .eq("id", characterId)
      .eq("user_id", userId)
      .maybeSingle();
    if (!data) {
      return { error: "No character with that id on this account.", status: 404 };
    }
    character = {
      name: data.name as string,
      traits: (data.traits ?? {}) as Record<string, string>,
      motion_style: data.motion_style as string | null,
      voice_tone_tags: (data.voice_tone_tags ?? []) as string[],
      reference_image_urls: (data.reference_image_urls ?? []) as string[],
    };
  }

  // Same feature flag the website honours, so "providers off" means off
  // everywhere rather than off in the UI and live on the API.
  const [{ data: providersFlag }, { data: brandFlag }] = await Promise.all([
    supabase.from("feature_flags").select("enabled").eq("key", "real_ai_providers").single(),
    supabase.from("feature_flags").select("enabled").eq("key", "brand_rules_enforcement").single(),
  ]);
  if (providersFlag?.enabled !== true) {
    return { error: "Generation is temporarily unavailable.", status: 503 };
  }

  let brandRules: BrandRule[] = [];
  if (brandFlag?.enabled) {
    const { data } = await supabase
      .from("brand_rules")
      .select("id, kind, label, value, applies_to, severity, active")
      .eq("user_id", userId)
      .eq("active", true);
    brandRules = (data ?? []).map((r) => ({
      id: r.id as string,
      kind: r.kind as BrandRule["kind"],
      label: r.label as string,
      value: r.value as string,
      appliesTo: r.applies_to as BrandRule["appliesTo"],
      severity: r.severity as BrandRule["severity"],
      active: r.active as boolean,
    }));
  }

  // Exactly the gate the composer uses: same plan limits, same bonus and
  // purchased credit handling, same suspension check.
  // Same credit gate as the composer, minus the human cooldown: the API's
  // own per-minute limit is the right shape for a script (see route.ts).
  let allowance = await checkGenerationAllowance(supabase, userId, 1, { skipCooldown: true });
  if (allowance.error) {
    return { error: allowance.error, status: 402 };
  }

  // Atomic reservation, same as the composer: the check-and-insert runs under a
  // per-user advisory lock so a concurrent burst can't clear the plan cap. The
  // API's per-minute rate limit already bounds bursts, but this makes the plan
  // ceiling exact. supabase here is the service-role client, which may call the
  // RPC directly. On a lost monthly race we re-decide and retry.
  let generationId: string | null = null;
  for (let attempt = 0; attempt < 5 && !generationId; attempt++) {
    if (attempt > 0) {
      const re = await checkGenerationAllowance(supabase, userId, 1, { skipCooldown: true });
      if (re.error) return { error: re.error, status: 402 };
      allowance = re;
    }
    const monthlyPortion =
      allowance.isAdmin || allowance.consumeFree ? 0 : Math.max(0, 1 - (allowance.consumePurchased ?? 0));
    const { data: reservedId, error: reserveError } = await supabase.rpc("reserve_generation", {
      p_user_id: userId,
      p_monthly_portion: monthlyPortion,
      p_limit: allowance.monthlyLimit ?? 0,
      p_since: allowance.periodStartIso ?? new Date(0).toISOString(),
      // No id → the RPC generates one; there's no client-supplied id on this path.
      p_row: {
        character_profile_id: characterId,
        prompt_input: prompt,
        status: "generating",
        content_type: "image",
        attempts: 0,
        credits_used: 1,
        purchased_credits_used: allowance.consumePurchased ?? 0,
        free_generation_used: Boolean(allowance.consumeFree),
      },
    });
    if (reserveError) {
      console.error("API generation reservation failed", reserveError);
      return { error: "Couldn't start that generation.", status: 500 };
    }
    if (reservedId) generationId = reservedId as string;
  }

  if (!generationId) {
    return { error: "Insufficient credits for that request.", status: 402 };
  }

  // The insert IS the charge — getMonthlyUsage sums credits_used — so the
  // balance moves immediately, and a failure below refunds it.
  const purchasedOk = allowance.consumePurchased
    ? await consumePurchasedCredits(supabase, userId, allowance.consumePurchased)
    : true;
  const freeOk = allowance.consumeFree ? await consumeFreeGeneration(supabase, userId) : true;
  if (!purchasedOk || !freeOk) {
    // Concurrent request already took the last credit / today's free
    // generation — abort before any paid work and release this row's charge.
    await supabase
      .from("generations")
      .update({ status: "failed", credits_used: 0, purchased_credits_used: 0, free_generation_used: false })
      .eq("id", generationId);
    return {
      error: allowance.consumeFree
        ? "You've used today's free generation — it comes back tomorrow. Top up credits or pick a plan to keep going."
        : "Insufficient credits for that request.",
      status: 402,
    };
  }

  try {
    // The character's identity photo, if it has one: this is what makes the
    // face come out right, and it's the whole product.
    let referenceImageUrl: string | null = null;
    const firstPhoto = character?.reference_image_urls?.[0];
    if (firstPhoto) {
      const { data: signed } = await supabase.storage
        .from("character-references")
        .createSignedUrl(firstPhoto, 60 * 10);
      referenceImageUrl = signed?.signedUrl ?? null;
    }

    // Send-plan parity (Send Receipt P4): the public API is a side door into
    // generation, so it runs the same resolver log-only pass as the web
    // composer — every generation surface answers to one source of truth.
    try {
      const apiPlan = resolveSendPlan({
        contentType: "image",
        modelId: "gpt-image",
        character: character
          ? {
              name: character.name,
              referencePhotoCount: (character.reference_image_urls ?? []).length,
              hasOutfit: false,
              outfitOn: false,
              photoreal: null,
            }
          : null,
        companionsCount: 0,
        attachments: [],
        anchorPhotoPicked: false,
        advancedMode: "none",
        multiRefCount: 0,
        storyboardStart: false,
        storyboardEnd: false,
        storyboardShotsActive: false,
        continueFromId: null,
        dialogueText: "",
        dialogueVoiceAssigned: false,
        rulesSkipArmed: false,
      });
      console.log(
        "[send-plan:api]",
        JSON.stringify({
          entries: apiPlan.entries.map((e) => `${e.slot}:${e.source}:${e.consumption}`),
          issues: apiPlan.issues.map((i) => `${i.severity}:${i.code}`),
        }),
      );
    } catch {
      // Parity logging must never cost an API caller a render.
    }

    const result = await runRealPipeline(
      prompt,
      character
        ? {
            name: character.name,
            traits: character.traits,
            motion_style: character.motion_style,
            voice_tone_tags: character.voice_tone_tags,
          }
        : { name: "", traits: {}, motion_style: null, voice_tone_tags: [] },
      {
        contentType: "image",
        brandRules,
        referenceImageUrl,
        persistImage: (base64: string) => persistGeneratedImage(supabase, userId, base64),
      },
    );

    const resultUrl = result.resultUrl;
    const succeeded = result.succeeded && isRenderableUrl(resultUrl);

    let matchScore: number | null = null;
    if (succeeded && character && firstPhoto && resultUrl) {
      const { data: signed } = await supabase.storage
        .from("character-references")
        .createSignedUrl(firstPhoto, 60 * 10);
      if (signed?.signedUrl) {
        const traitSummary = [character.traits.hair, character.traits.distinguishing_features]
          .filter(Boolean)
          .join(", ");
        const verdict = await scoreIdentityMatch(
          absolutizeMediaUrl(resultUrl, params.origin),
          signed.signedUrl,
          traitSummary,
        );
        matchScore = verdict?.score ?? null;

        // Same automatic fail-and-refund the website applies to a black or
        // corrupted frame: an API customer must not be billed for a picture
        // that isn't one either.
        if (verdict?.unusable) {
          await supabase
            .from("generations")
            .update({
              status: "failed",
              attempts: result.attempts.length,
              pipeline_log: result.attempts,
              match_score: verdict.score,
              match_notes: verdict.notes,
            })
            .eq("id", generationId);
          const refunded = await refundGenerationCosts(generationId, {
            force: forceRefundEligible(result.attempts),
          });
          return {
            error: null,
            id: generationId,
            status: "failed",
            prompt: result.finalPrompt,
            imageUrl: null,
            matchScore: verdict.score,
            // Only report 0 if the credit was actually released — with the
            // refund kill switch off it was kept, and saying otherwise is a lie.
            creditsUsed: refunded ? 0 : 1,
          };
        }
      }
    }

    await supabase
      .from("generations")
      .update({
        status: succeeded ? "succeeded" : "failed",
        attempts: result.attempts.length,
        result_url: resultUrl,
        pipeline_log: result.attempts,
        match_score: matchScore,
      })
      .eq("id", generationId);

    // Same force calculation as the website's path (2026-08-31): with the
    // automatic_refunds switch off, an API customer whose request was
    // refused by the provider before anything rendered — or blocked by
    // their own brand rules — was charged where the composer refunded. The
    // two surfaces sell the same credits; they refund by the same rule.
    const refunded = !succeeded
      ? await refundGenerationCosts(generationId, {
          force: Boolean(result.rulesBlock?.length) || forceRefundEligible(result.attempts),
        })
      : false;

    return {
      error: null,
      id: generationId,
      status: succeeded ? "succeeded" : "failed",
      prompt: result.finalPrompt,
      imageUrl: succeeded ? absolutizeMediaUrl(toMediaUrl(resultUrl) ?? "", params.origin) : null,
      matchScore,
      // Charged unless the credit was actually released by a refund.
      creditsUsed: !succeeded && refunded ? 0 : 1,
    };
  } catch (err) {
    console.error("API generation failed", { generationId, err });
    await supabase.from("generations").update({ status: "failed" }).eq("id", generationId);
    const refunded = await refundGenerationCosts(generationId);
    return {
      error: refunded
        ? "The generation failed. You have not been charged."
        : "The generation failed. The credit was used — contact support if you'd like it refunded.",
      status: 500,
    };
  }
}

export async function apiOrigin(): Promise<string> {
  return getOrigin();
}
