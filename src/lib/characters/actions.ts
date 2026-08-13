"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { generateImageWithOpenAI, ImageSafetyRejection } from "@/lib/generations/providers/openai-images";
import { generateImageWithFlux } from "@/lib/generations/providers/fal-image";
import { softenPromptForSafety } from "@/lib/generations/providers/anthropic";
import { getImageModel } from "@/lib/generations/providers/image-models";
import { toUserFacingError } from "@/lib/generations/user-facing-error";
import { PLAN_LABELS, PLAN_REFERENCE_IMAGE_LIMITS, type PlanId } from "@/lib/plans";

// Real incident, 2026-08-09: a plan=none account generated an AI reference
// photo for free — this function had no plan/credit check at all, unlike
// the main Generate composer (see checkGenerationAllowance in
// generations/actions.ts), so it happily called OpenAI/fal.ai on the
// business's own key for anyone who was simply logged in. Free accounts now
// get exactly this many lifetime AI-generated reference photos before
// they're asked to subscribe; uploading your own photo stays free and
// unlimited, since that costs nothing to serve.
const FREE_REFERENCE_GENERATIONS_LIMIT = 2;

type SaveResult = { error: string } | { error: null };

// NOTE: this is called directly from a Client Component (not via a plain
// <form action={...}>) because the form needs to upload images to Storage
// first. Calling redirect() from a server action invoked that way doesn't
// reliably navigate the browser, so instead this returns a plain result and
// the client does the navigation itself once it knows the save succeeded.
export async function saveCharacterProfile(formData: FormData): Promise<SaveResult> {
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  if (!data.user) return { error: "Your session expired — please log in again." };

  const id = formData.get("id") as string | null;
  const name = (formData.get("name") as string)?.trim();
  const motionStyle = (formData.get("motion_style") as string)?.trim() || null;
  const projectId = (formData.get("project_id") as string)?.trim() || null;
  const voiceId = (formData.get("voice_id") as string)?.trim() || null;
  const tags = JSON.parse((formData.get("tags") as string) || "[]") as string[];
  const referenceImagePaths = JSON.parse(
    (formData.get("reference_image_paths") as string) || "[]",
  ) as string[];

  const traits = {
    hair: (formData.get("trait_hair") as string)?.trim() || "",
    outfit: (formData.get("trait_outfit") as string)?.trim() || "",
    personality: (formData.get("trait_personality") as string)?.trim() || "",
    distinguishing_features:
      (formData.get("trait_distinguishing_features") as string)?.trim() || "",
  };

  if (!name) {
    return { error: "Give your character a name." };
  }
  if (name.length > 120) {
    return { error: "Keep the character name under 120 characters." };
  }

  const row = {
    user_id: data.user.id,
    name,
    reference_image_urls: referenceImagePaths,
    traits,
    motion_style: motionStyle,
    voice_tone_tags: tags,
    project_id: projectId,
    voice_id: voiceId,
    updated_at: new Date().toISOString(),
  };

  if (id) {
    const { error } = await supabase
      .from("character_profiles")
      .update(row)
      .eq("id", id)
      .eq("user_id", data.user.id);

    if (error) {
      console.error("saveCharacterProfile update failed:", error.message);
      return { error: "Couldn't save this character — try again." };
    }
  } else {
    const { error } = await supabase.from("character_profiles").insert(row);

    if (error) {
      console.error("saveCharacterProfile insert failed:", error.message);
      return { error: "Couldn't save this character — try again." };
    }
  }

  revalidatePath("/app/character");
  return { error: null };
}

type GenerateReferenceResult =
  | { error: string }
  | { error: null; path: string; url: string };

// Lets a user bootstrap a character's first reference photo from a text
// description instead of only uploading their own — same image pipeline
// used for scene generation, just with no reference photo to anchor to yet.
export async function generateReferenceImage(formData: FormData): Promise<GenerateReferenceResult> {
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  if (!data.user) return { error: "Your session expired — please log in again." };

  const prompt = (formData.get("prompt") as string)?.trim();
  if (!prompt) return { error: "Describe what they look like first." };

  // The character's existing reference photos (storage paths) and typed
  // visual traits, sent by the form. Used below to keep every generated
  // photo the SAME person: without an anchor, each generation is a fresh
  // text-to-image that invents a brand-new face — generate two "reference"
  // photos and the character's own gallery is two different people, which
  // then poisons every downstream generation anchored to those photos
  // (the root cause of "creating a character is not consistent").
  const anchorPaths = (
    JSON.parse((formData.get("anchor_paths") as string) || "[]") as string[]
  ).filter(
    // Only this user's own files — paths are keyed ${userId}/... in the
    // bucket, so this also stops a crafted request from signing (and
    // generating from) someone else's photo.
    (path) => typeof path === "string" && path.startsWith(`${data.user!.id}/`),
  );
  const traitHair = (formData.get("trait_hair") as string)?.trim() || "";
  const traitOutfit = (formData.get("trait_outfit") as string)?.trim() || "";
  const traitFeatures =
    (formData.get("trait_distinguishing_features") as string)?.trim() || "";

  const { data: profile } = await supabase
    .from("profiles")
    .select("plan, role, free_reference_generations_used, current_period_start")
    .eq("id", data.user.id)
    .single();

  const plan = (profile?.plan ?? "none") as PlanId;
  const isAdmin = profile?.role === "admin";

  // Free tier: a lifetime allowance, not a monthly one — two photos to see
  // whether the product does what they want, then a plan. Admins are exempt
  // for the same reason checkGenerationAllowance exempts them: testing and
  // support work should never trip a consumer-facing cap.
  const isFreeTier = plan === "none" && !isAdmin;
  const freeUsed = profile?.free_reference_generations_used ?? 0;
  if (isFreeTier && freeUsed >= FREE_REFERENCE_GENERATIONS_LIMIT) {
    return {
      error:
        `You've used your ${FREE_REFERENCE_GENERATIONS_LIMIT} free AI-generated character photos. ` +
        "Subscribe to a plan to keep generating, or upload your own photo instead — that's always free.",
    };
  }

  // Paid plans: a monthly cap, counted against this account's real billing
  // period so it resets in step with credits. Until 2026-08-10 these were
  // unlimited and free on every paid plan — the largest money leak in the
  // pricing analysis. See PLAN_REFERENCE_IMAGE_LIMITS for why this is a cap
  // rather than a credit charge, and why the numbers are set where they are.
  if (!isFreeTier && !isAdmin) {
    const periodStart = profile?.current_period_start
      ? new Date(profile.current_period_start as string)
      : (() => {
          // No Stripe billing anchor yet (see backfill-billing-period.js) —
          // fall back to the calendar month, matching getMonthlyUsage.
          const d = new Date();
          d.setDate(1);
          d.setHours(0, 0, 0, 0);
          return d;
        })();

    const { count } = await supabase
      .from("reference_image_generations")
      .select("id", { count: "exact", head: true })
      .eq("user_id", data.user.id)
      .gte("created_at", periodStart.toISOString());

    const cap = PLAN_REFERENCE_IMAGE_LIMITS[plan];
    if ((count ?? 0) >= cap) {
      return {
        error:
          `You've generated ${cap} AI character photos this billing period, which is the limit on ` +
          `the ${PLAN_LABELS[plan]} plan. Uploading your own photo is always free and unlimited.`,
      };
    }
  }

  const { data: flag } = await supabase
    .from("feature_flags")
    .select("enabled")
    .eq("key", "real_ai_providers")
    .single();

  if (flag?.enabled !== true) {
    return {
      error:
        "Real AI providers are off, so there's no live model to generate from yet. Turn " +
        "them on in Admin > Feature flags, or upload a photo instead.",
    };
  }

  const { data: imageModelSetting } = await supabase
    .from("app_settings")
    .select("value")
    .eq("key", "image_model")
    .single();
  const model = getImageModel(imageModelSetting?.value ?? "gpt-image");

  if (model.provider === "openai" && !process.env.OPENAI_API_KEY) {
    return { error: "OPENAI_API_KEY is missing — add it to .env.local first." };
  }
  if (model.provider === "fal" && !process.env.FAL_KEY) {
    return { error: "FAL_KEY is missing — add it to .env.local first." };
  }

  try {
    // Identity anchor: if the character already has photos, sign the first
    // one and generate the new photo FROM it (image edit / image-to-image),
    // so it's the same person in a new shot rather than a new person. The
    // very first photo of a brand-new character has nothing to anchor to —
    // that one is legitimately text-only.
    let anchorUrl: string | null = null;
    if (anchorPaths.length > 0) {
      const { data: signed } = await supabase.storage
        .from("character-references")
        .createSignedUrl(anchorPaths[0], 60 * 10);
      anchorUrl = signed?.signedUrl ?? null;
    }

    // Fold the character sheet's visual traits into the prompt — the scene
    // pipeline already does this (see buildScenePrompt in pipeline.ts), but
    // this path used to send only the raw describe-box text, so the photo
    // ignored the hair/outfit/features the user typed right above it.
    const visualTraits = [
      traitHair && `Hair: ${traitHair}.`,
      traitOutfit && `Outfit: ${traitOutfit}.`,
      traitFeatures && `Distinguishing features: ${traitFeatures}.`,
    ]
      .filter(Boolean)
      .join(" ");
    let fullPrompt = prompt;
    if (visualTraits) fullPrompt += `\n\n${visualTraits}`;
    if (anchorUrl) {
      fullPrompt +=
        "\n\nThis is the same person as in the reference photo — keep the face, age, build, and identity exactly the same; only the pose, framing, and scene may change.";
    }

    const downloadImage = async (url: string): Promise<Buffer> => {
      const res = await fetch(url);
      if (!res.ok) throw new Error("Couldn't download the generated image.");
      return Buffer.from(await res.arrayBuffer());
    };

    let bytes: Buffer;
    if (model.provider === "fal") {
      bytes = await downloadImage(await generateImageWithFlux(fullPrompt, anchorUrl));
    } else {
      try {
        const base64 = await generateImageWithOpenAI(fullPrompt, anchorUrl);
        bytes = Buffer.from(base64, "base64");
      } catch (err) {
        // OpenAI's safety classifier is aggressive about photorealistic
        // people — real report: "a beautiful blonde woman" was flagged.
        // Scene generation already falls back to Flux on exactly this case
        // (see providers/image.ts); this path was missing the same
        // fallback, so an ordinary description just failed. Only the
        // safety case falls back — an outage or bad key says nothing about
        // whether Flux would do better.
        if (!(err instanceof ImageSafetyRejection)) throw err;
        // Soften the wording and retry on GPT first — that keeps the
        // identity anchor, which the Flux fallback loses (see
        // providers/image.ts for the full reasoning). Flux is last resort.
        let recovered: Buffer | null = null;
        if (process.env.ANTHROPIC_API_KEY) {
          try {
            const softened = await softenPromptForSafety(fullPrompt);
            recovered = Buffer.from(await generateImageWithOpenAI(softened, anchorUrl), "base64");
          } catch {
            recovered = null;
          }
        }
        if (!recovered) {
          if (!process.env.FAL_KEY) throw err;
          recovered = await downloadImage(await generateImageWithFlux(fullPrompt, anchorUrl));
        }
        bytes = recovered;
      }
    }

    const path = `${data.user.id}/${crypto.randomUUID()}.png`;
    const { error: uploadError } = await supabase.storage
      .from("character-references")
      .upload(path, bytes, { contentType: "image/png" });
    if (uploadError) throw new Error(uploadError.message);

    const { data: signed, error: signError } = await supabase.storage
      .from("character-references")
      .createSignedUrl(path, 60 * 60);
    if (signError || !signed?.signedUrl) {
      throw new Error("Generated the image but couldn't create a preview link.");
    }

    // Only counted once a photo actually came back — a safety-filter
    // rejection or provider error above throws before this line, so a failed
    // attempt never burns a free try or a slot in the monthly cap.
    if (isFreeTier) {
      await supabase
        .from("profiles")
        .update({ free_reference_generations_used: freeUsed + 1 })
        .eq("id", data.user.id);
    } else if (!isAdmin) {
      // Admins are exempt from the cap, so logging their generations would
      // only add noise to a table whose sole purpose is counting against it.
      await supabase
        .from("reference_image_generations")
        .insert({ user_id: data.user.id });
    }

    return { error: null, path, url: signed.signedUrl };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Couldn't generate that image.";
    // Full detail (including any raw provider JSON) goes to the server log
    // for debugging; the user only ever sees the sanitized version.
    console.error("generateReferenceImage failed:", message);
    return { error: toUserFacingError(message) };
  }
}

// Same delete as below, but client-invoked and returning a result instead of
// redirecting — for the sidebar's quick-delete button, which can be clicked
// from any page and shouldn't yank the user over to the character list just
// because they deleted one from the Recent/Characters rail. Mirrors the
// deleteProject/removeProject split in lib/projects/actions.ts.
export async function removeCharacterProfile(formData: FormData): Promise<{ error: string | null }> {
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  if (!data.user) return { error: "Your session expired — please log in again." };

  const id = formData.get("id") as string;
  if (!id) return { error: "Missing character id." };

  const { data: existing } = await supabase
    .from("character_profiles")
    .select("reference_image_urls")
    .eq("id", id)
    .eq("user_id", data.user.id)
    .single();

  const { error } = await supabase
    .from("character_profiles")
    .delete()
    .eq("id", id)
    .eq("user_id", data.user.id);

  if (error) {
    console.error("removeCharacterProfile failed:", error.message);
    return { error: "Couldn't delete this character — try again." };
  }

  const paths = (existing?.reference_image_urls as string[] | null) ?? [];
  if (paths.length > 0) {
    await supabase.storage.from("character-references").remove(paths);
  }

  revalidatePath("/app", "layout");
  revalidatePath("/app/character");
  return { error: null };
}

export async function deleteCharacterProfile(formData: FormData) {
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  if (!data.user) redirect("/login");

  const id = formData.get("id") as string;

  // Fetch the reference photo paths before deleting the row — once the row
  // is gone, there's no record of which files in Storage belonged to this
  // character, and they'd be orphaned (never shown again, but billed
  // forever) with no way to find them later.
  const { data: existing } = await supabase
    .from("character_profiles")
    .select("reference_image_urls")
    .eq("id", id)
    .eq("user_id", data.user.id)
    .single();

  const { error } = await supabase
    .from("character_profiles")
    .delete()
    .eq("id", id)
    .eq("user_id", data.user.id);

  if (error) {
    redirect(`/app/character?error=${encodeURIComponent("Couldn't delete this character — try again.")}`);
  }

  const paths = (existing?.reference_image_urls as string[] | null) ?? [];
  if (paths.length > 0) {
    await supabase.storage.from("character-references").remove(paths);
  }

  revalidatePath("/app/character");
  redirect("/app/character");
}
