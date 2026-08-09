"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { generateImageWithOpenAI } from "@/lib/generations/providers/openai-images";
import { generateImageWithFlux } from "@/lib/generations/providers/fal-image";
import { getImageModel } from "@/lib/generations/providers/image-models";
import { toUserFacingError } from "@/lib/generations/user-facing-error";

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

  const { data: profile } = await supabase
    .from("profiles")
    .select("plan, role, free_reference_generations_used")
    .eq("id", data.user.id)
    .single();

  // Only plan=none, non-admin accounts are metered here — anyone on a paid
  // plan is already a customer, so this stays a free perk for them rather
  // than drawing from their monthly credit pool, and admins are exempt for
  // the same reason checkGenerationAllowance exempts them (generations.ts):
  // testing and support work should never trip a consumer-facing free-tier
  // cap. See the constant's comment above for why this check exists at all.
  const isFreeTier = (profile?.plan ?? "none") === "none" && profile?.role !== "admin";
  const freeUsed = profile?.free_reference_generations_used ?? 0;
  if (isFreeTier && freeUsed >= FREE_REFERENCE_GENERATIONS_LIMIT) {
    return {
      error:
        `You've used your ${FREE_REFERENCE_GENERATIONS_LIMIT} free AI-generated character photos. ` +
        "Subscribe to a plan to keep generating, or upload your own photo instead — that's always free.",
    };
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
    let bytes: Buffer;
    if (model.provider === "fal") {
      const hostedUrl = await generateImageWithFlux(prompt, null);
      const res = await fetch(hostedUrl);
      if (!res.ok) throw new Error("Couldn't download the generated image.");
      bytes = Buffer.from(await res.arrayBuffer());
    } else {
      const base64 = await generateImageWithOpenAI(prompt, null);
      bytes = Buffer.from(base64, "base64");
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

    // Only counted against the free quota once a photo actually came back —
    // a safety-filter rejection or provider error above throws before this
    // line, so it never burns one of the user's free tries.
    if (isFreeTier) {
      await supabase
        .from("profiles")
        .update({ free_reference_generations_used: freeUsed + 1 })
        .eq("id", data.user.id);
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
