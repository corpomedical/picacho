import type { SupabaseClient } from "@supabase/supabase-js";
import { runRealPipeline } from "@/lib/generations/pipeline";
import {
  checkGenerationAllowance,
  consumeFreeGeneration,
  consumePurchasedCredits,
  persistGeneratedImage,
} from "@/lib/generations/core";
import { refundGenerationCosts } from "@/lib/generations/job-runner";
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
  const allowance = await checkGenerationAllowance(supabase, userId, 1);
  if (allowance.error) {
    return { error: allowance.error, status: 402 };
  }

  const { data: row, error: insertError } = await supabase
    .from("generations")
    .insert({
      user_id: userId,
      character_profile_id: characterId,
      prompt_input: prompt,
      status: "generating",
      content_type: "image",
      attempts: 0,
      credits_used: 1,
      purchased_credits_used: allowance.consumePurchased ?? 0,
      free_generation_used: Boolean(allowance.consumeFree),
    })
    .select("id")
    .single();

  if (insertError || !row) {
    // Logged, because the caller only ever sees a polite sentence: this
    // exact path swallowed a CHECK-constraint violation once (status
    // "running", which the table does not allow) and the message alone gave
    // no way to tell a constraint failure from a database outage.
    console.error("API generation insert failed", insertError);
    return { error: "Couldn't start that generation.", status: 500 };
  }

  const generationId = row.id as string;

  // The insert IS the charge — getMonthlyUsage sums credits_used — so the
  // balance moves immediately, and a failure below refunds it.
  if (allowance.consumePurchased) {
    await consumePurchasedCredits(supabase, userId, allowance.consumePurchased);
  }
  if (allowance.consumeFree) {
    await consumeFreeGeneration(supabase, userId);
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
          await refundGenerationCosts(generationId);
          return {
            error: null,
            id: generationId,
            status: "failed",
            prompt: result.finalPrompt,
            imageUrl: null,
            matchScore: verdict.score,
            creditsUsed: 0,
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

    if (!succeeded) await refundGenerationCosts(generationId);

    return {
      error: null,
      id: generationId,
      status: succeeded ? "succeeded" : "failed",
      prompt: result.finalPrompt,
      imageUrl: succeeded ? absolutizeMediaUrl(toMediaUrl(resultUrl) ?? "", params.origin) : null,
      matchScore,
      creditsUsed: succeeded ? 1 : 0,
    };
  } catch (err) {
    console.error("API generation failed", { generationId, err });
    await supabase.from("generations").update({ status: "failed" }).eq("id", generationId);
    await refundGenerationCosts(generationId);
    return { error: "The generation failed. You have not been charged.", status: 500 };
  }
}

export async function apiOrigin(): Promise<string> {
  return getOrigin();
}
