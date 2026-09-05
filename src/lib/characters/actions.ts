"use server";

import { redirect } from "next/navigation";
import { mediaUrl } from "@/lib/media/url";
import { revalidatePath } from "next/cache";
import { createClient, createAdminClient } from "@/lib/supabase/server";
import { generateImageWithOpenAI, ImageSafetyRejection } from "@/lib/generations/providers/openai-images";
import { describeOutfitImage, classifyRenderStyle } from "@/lib/generations/providers/describe-image";
import { generateImageWithFlux } from "@/lib/generations/providers/fal-image";
import { softenPromptForSafety } from "@/lib/generations/providers/anthropic";
import { getImageModel } from "@/lib/generations/providers/image-models";
import { toUserFacingError } from "@/lib/generations/user-facing-error";
import { PLAN_LABELS, PLAN_REFERENCE_IMAGE_LIMITS, type PlanId } from "@/lib/plans";
import { latestMonthlyAnniversary } from "@/lib/generations/core";

// Real incident, 2026-08-09: a plan=none account generated an AI reference
// photo for free — this function had no plan/credit check at all, unlike
// the main Generate composer (see checkGenerationAllowance in
// generations/actions.ts), so it happily called OpenAI/fal.ai on the
// business's own key for anyone who was simply logged in. Free accounts now
// get exactly this many lifetime AI-generated reference photos before
// they're asked to subscribe; uploading your own photo stays free and
// unlimited, since that costs nothing to serve.
const FREE_REFERENCE_GENERATIONS_LIMIT = 2;

// Proportionate caps on the free-text character fields, in the style of the
// existing 120-char name cap. These all get folded verbatim into prompts on
// every generation (see buildScenePrompt / the visual-traits block below), so
// an unbounded field quietly inflates every downstream model call — and with
// no cap at all, one crafted save could store megabytes per row.
const MAX_TAGS = 25;
const MAX_TAG_LENGTH = 60;
const MAX_TRAIT_LENGTH = 500;
const MAX_MOTION_STYLE_LENGTH = 500;
const MAX_REFERENCE_IMAGES = 20;
const MAX_OUTFIT_IMAGES = 2;

// Client-supplied JSON fields (tags, image path lists) used to go straight
// through JSON.parse — malformed input threw and surfaced as a 500 instead of
// the action's normal validation-error shape. Returns null on anything that
// isn't a JSON array; non-string elements are dropped rather than rejected,
// matching how the path filters already treated them.
function parseStringArray(raw: FormDataEntryValue | null): string[] | null {
  if (raw == null || raw === "") return [];
  try {
    const parsed: unknown = JSON.parse(String(raw));
    if (!Array.isArray(parsed)) return null;
    return parsed.filter((v): v is string => typeof v === "string");
  } catch {
    return null;
  }
}

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
  const tags = parseStringArray(formData.get("tags"));
  if (tags === null) return { error: "Couldn't read the character's tags — refresh and try again." };
  // Only accept storage paths in the caller's OWN folder. Without this a user
  // could save a character whose reference_image_urls point at another user's
  // objects, and the media route (signature-only, no per-user check) would then
  // mint valid capability URLs for those files — a cross-user read. Same guard
  // generateReferenceImage already applies. (uid hoisted so the null-narrowing
  // survives into the filter closure — TS drops property narrowing there.)
  const uid = data.user.id;
  const rawReferencePaths = parseStringArray(formData.get("reference_image_paths"));
  if (rawReferencePaths === null) {
    return { error: "Couldn't read the reference photo list — refresh and try again." };
  }
  const referenceImagePaths = rawReferencePaths.filter((p) => p.startsWith(`${uid}/`));
  // Outfit photos (2026-08-24): clothing shots, kept apart from the identity
  // references above — same bucket, same own-folder ownership rule.
  // What the submitting form believed the row held when it loaded (the form
  // also folds in auto-persists it witnessed). Photos on the row but NOT in
  // this baseline were appended from outside the form — another tab's
  // promote-to-reference, an auto-persisted AI reference — and a Save must
  // neither drop them from the row nor delete their files: the old wholesale
  // replace-then-diff permanently destroyed a promoted photo on the next
  // Save from any tab opened before the promotion. A form from before this
  // shipped sends no baseline; the fallback below keeps the old semantics.
  const referenceBaseline = parseStringArray(formData.get("reference_baseline_paths"));
  const outfitBaseline = parseStringArray(formData.get("outfit_baseline_paths"));
  const hasBaselines = formData.get("reference_baseline_paths") !== null;

  const rawOutfitPaths = parseStringArray(formData.get("outfit_image_paths"));
  if (rawOutfitPaths === null) {
    return { error: "Couldn't read the outfit photo list — refresh and try again." };
  }
  const outfitImagePaths = rawOutfitPaths.filter((p) => p.startsWith(`${uid}/`));

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
  if (motionStyle && motionStyle.length > MAX_MOTION_STYLE_LENGTH) {
    return { error: `Keep the motion style under ${MAX_MOTION_STYLE_LENGTH} characters.` };
  }
  if (tags.length > MAX_TAGS) {
    return { error: `Keep it to ${MAX_TAGS} tags or fewer.` };
  }
  if (tags.some((t) => t.length > MAX_TAG_LENGTH)) {
    return { error: `Keep each tag under ${MAX_TAG_LENGTH} characters.` };
  }
  if (Object.values(traits).some((t) => t.length > MAX_TRAIT_LENGTH)) {
    return { error: `Keep each trait under ${MAX_TRAIT_LENGTH} characters.` };
  }
  if (referenceImagePaths.length > MAX_REFERENCE_IMAGES) {
    return { error: `A character can have up to ${MAX_REFERENCE_IMAGES} reference photos.` };
  }
  if (outfitImagePaths.length > MAX_OUTFIT_IMAGES) {
    return { error: `A character can have up to ${MAX_OUTFIT_IMAGES} outfit photos.` };
  }

  // project_id / voice_id arrive from the client and are written straight into
  // the row. The FK constraint doesn't enforce ownership and character_profiles
  // RLS only checks user_id, so without these lookups a crafted request could
  // attach a character to another user's project (FK bypasses RLS). Projects
  // are owner-scoped; voice presets are a global admin-curated catalogue, so
  // existence is the whole check there.
  if (projectId) {
    const { data: project } = await supabase
      .from("projects")
      .select("id")
      .eq("id", projectId)
      .eq("user_id", uid)
      .maybeSingle();
    if (!project) return { error: "Couldn't find that project." };
  }
  if (voiceId) {
    const { data: voice } = await supabase
      .from("voice_presets")
      .select("id")
      .eq("id", voiceId)
      .maybeSingle();
    if (!voice) return { error: "Couldn't find that voice." };
  }

  // The outfit description is written ONCE, here at save time, and reused by
  // every generation after — models whose endpoints can't take a clothing
  // photo (the Kling family) get this text injected into drafting instead.
  // Re-described only when the photo set actually changed; a vision failure
  // stores null and the save still succeeds (Seedance/images still get the
  // photo itself, and the Kling path just goes without).
  const { data: existingRow } = id
    ? await supabase
        .from("character_profiles")
        .select("outfit_image_urls, outfit_description, reference_image_urls, render_style")
        .eq("id", id)
        .eq("user_id", uid)
        .maybeSingle()
    : { data: null };

  let outfitDescription: string | null = null;
  if (outfitImagePaths.length > 0) {
    const previousPaths = (existingRow?.outfit_image_urls as string[] | null) ?? [];
    const unchanged =
      previousPaths.length === outfitImagePaths.length &&
      previousPaths.every((p, i) => p === outfitImagePaths[i]);
    if (unchanged && existingRow?.outfit_description) {
      outfitDescription = existingRow.outfit_description as string;
    } else {
      const { data: signed } = await supabase.storage
        .from("character-references")
        .createSignedUrl(outfitImagePaths[0], 60 * 10);
      if (signed?.signedUrl) {
        outfitDescription = await describeOutfitImage(signed.signedUrl);
      }
    }
  }

  // Render style (Send Receipt P3): photoreal vs illustrated, decided by one
  // vision look at the primary reference photo whenever the photo set
  // changes. Null on failure — the composer's 2.5 lane rule then falls back
  // to its heuristic, so this can only ever ADD precision, never lose
  // coverage. Same graceful-degradation contract as the outfit description.
  let renderStyle: string | null = (existingRow?.render_style as string | null) ?? null;
  if (referenceImagePaths.length === 0) {
    renderStyle = null;
  } else {
    const previousRefs = (existingRow?.reference_image_urls as string[] | null) ?? [];
    const refsChanged =
      previousRefs.length !== referenceImagePaths.length ||
      !previousRefs.every((p, i) => p === referenceImagePaths[i]);
    if (refsChanged || renderStyle === null) {
      const { data: signedRef } = await supabase.storage
        .from("character-references")
        .createSignedUrl(referenceImagePaths[0], 60 * 10);
      if (signedRef?.signedUrl) {
        renderStyle = await classifyRenderStyle(signedRef.signedUrl);
      }
    }
  }

  const row = {
    user_id: data.user.id,
    name,
    reference_image_urls: referenceImagePaths,
    outfit_image_urls: outfitImagePaths,
    outfit_description: outfitDescription,
    render_style: renderStyle,
    traits,
    motion_style: motionStyle,
    voice_tone_tags: tags,
    project_id: projectId,
    voice_id: voiceId,
    updated_at: new Date().toISOString(),
  };

  if (id) {
    // Fresh read at the last moment: the vision calls above can hold this
    // action open for tens of seconds, and photos auto-persist onto the row
    // from outside the form in exactly that window. Merging against a fresh
    // read shrinks the lost-append window from half a minute to milliseconds.
    const { data: freshRow } = await supabase
      .from("character_profiles")
      .select("reference_image_urls, outfit_image_urls")
      .eq("id", id)
      .eq("user_id", data.user.id)
      .maybeSingle();
    const oldRefs = (freshRow?.reference_image_urls as string[] | null) ?? [];
    const oldOutfits = (freshRow?.outfit_image_urls as string[] | null) ?? [];
    const refBase = (hasBaselines ? referenceBaseline : null) ?? oldRefs;
    const outfitBase = (hasBaselines ? outfitBaseline : null) ?? oldOutfits;
    // On the row but unknown to this form: appended elsewhere — keep, after
    // the form's own list so the primary photo stays the one the form chose.
    const appendedRefs = oldRefs.filter(
      (p) => !refBase.includes(p) && !referenceImagePaths.includes(p),
    );
    const appendedOutfits = oldOutfits.filter(
      (p) => !outfitBase.includes(p) && !outfitImagePaths.includes(p),
    );
    row.reference_image_urls = [...referenceImagePaths, ...appendedRefs];
    row.outfit_image_urls = [...outfitImagePaths, ...appendedOutfits];

    const { error } = await supabase
      .from("character_profiles")
      .update(row)
      .eq("id", id)
      .eq("user_id", data.user.id);

    if (error) {
      console.error("saveCharacterProfile update failed:", error.message);
      return { error: "Couldn't save this character — try again." };
    }

    // The submitted lists replace the stored ones, so any photo the user
    // deliberately dropped from the gallery was left behind in storage
    // forever — 43 stranded objects had accumulated by the 2026-08-31
    // inspection. Diff after a confirmed save and remove what fell off.
    // Everything appended-elsewhere is in `keep` by construction, so only
    // deliberate removals (in the form's baseline, not resubmitted) can land
    // here. Best-effort: a failed remove costs pennies, not the save.
    const keep = new Set([...row.reference_image_urls, ...row.outfit_image_urls]);
    const dropped = [...oldRefs, ...oldOutfits].filter((p) => p && !keep.has(p));
    if (dropped.length) {
      const { error: removeError } = await supabase.storage
        .from("character-references")
        .remove(dropped);
      if (removeError) {
        console.error("saveCharacterProfile couldn't clear dropped photos:", removeError.message);
      }
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
  | { error: null; path: string; url: string; saved: boolean };

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
  const rawAnchorPaths = parseStringArray(formData.get("anchor_paths"));
  if (rawAnchorPaths === null) {
    return { error: "Couldn't read the character's photos — refresh and try again." };
  }
  const anchorPaths = rawAnchorPaths.filter(
    // Only this user's own files — paths are keyed ${userId}/... in the
    // bucket, so this also stops a crafted request from signing (and
    // generating from) someone else's photo.
    (path) => path.startsWith(`${data.user!.id}/`),
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
  // support work should never trip a consumer-facing cap. Enforcement is the
  // atomic reservation further down — this early read is only a courtesy
  // fast-path so an obviously capped account gets its answer before the
  // flag/model lookups run.
  const isFreeTier = plan === "none" && !isAdmin;
  const freeUsed = profile?.free_reference_generations_used ?? 0;
  const freeCapError =
    `You've used your ${FREE_REFERENCE_GENERATIONS_LIMIT} free AI-generated character photos. ` +
    "Subscribe to a plan to keep generating, or upload your own photo instead — that's always free.";
  if (isFreeTier && freeUsed >= FREE_REFERENCE_GENERATIONS_LIMIT) {
    return { error: freeCapError };
  }

  // Paid plans: a monthly cap, counted against this account's real billing
  // period so it resets in step with credits. Until 2026-08-10 these were
  // unlimited and free on every paid plan — the largest money leak in the
  // pricing analysis. See PLAN_REFERENCE_IMAGE_LIMITS for why this is a cap
  // rather than a credit charge, and why the numbers are set where they are.
  const periodStart = profile?.current_period_start
    // Advance to the most recent MONTHLY anniversary — an annual sub's raw
    // period start can be ~12 months ago, which made this cap span the whole
    // year (never resetting monthly). Mirrors getMonthlyUsageWith.
    ? latestMonthlyAnniversary(new Date(profile.current_period_start as string))
    : (() => {
        // No Stripe billing anchor yet (see backfill-billing-period.js) —
        // fall back to the calendar month, matching getMonthlyUsage.
        const d = new Date();
        d.setDate(1);
        d.setHours(0, 0, 0, 0);
        return d;
      })();
  const paidCap = PLAN_REFERENCE_IMAGE_LIMITS[plan];
  const paidCapError =
    `You've generated ${paidCap} AI character photos this billing period, which is the limit on ` +
    `the ${PLAN_LABELS[plan]} plan. Uploading your own photo is always free and unlimited.`;

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

  // Reserve the allowance atomically BEFORE the paid provider call. The old
  // shape — read the count above, generate, then record — meant a concurrent
  // burst all read the same count, all passed, and all called OpenAI/fal:
  // unlimited free paid-API generations, the same bug class the composer
  // fixed with reserve_generation (commits 538a2ee / 4a4e3ee). Both RPCs
  // (supabase/pending-2026-08-19/user-actions.sql) serialize check-and-record
  // per user; EXECUTE is revoked from `authenticated`, so they run through
  // the service-role client. An RPC error fails closed, like the voice
  // preview's rate limiter: better a retry than an unmetered paid call.
  // A failed generation refunds the reservation in the catch below, keeping
  // the old "a failed attempt never burns a slot" semantics.
  const admin = createAdminClient();
  // Paid path: the reserved meter row, deleted on failure.
  let reservedRowId: string | null = null;
  if (isFreeTier) {
    const { data: spent, error: spendError } = await admin.rpc(
      "spend_free_reference_generation",
      { p_user_id: data.user.id, p_limit: FREE_REFERENCE_GENERATIONS_LIMIT },
    );
    if (spendError) {
      console.error("spend_free_reference_generation failed:", spendError.message);
      return { error: "Couldn't check your allowance — try again in a moment." };
    }
    if (spent !== true) return { error: freeCapError };
  } else if (!isAdmin) {
    const { data: reserved, error: reserveError } = await admin.rpc(
      "reserve_reference_image_generation",
      { p_user_id: data.user.id, p_cap: paidCap, p_since: periodStart.toISOString() },
    );
    if (reserveError) {
      console.error("reserve_reference_image_generation failed:", reserveError.message);
      return { error: "Couldn't check your allowance — try again in a moment." };
    }
    if (!reserved) return { error: paidCapError };
    reservedRowId = reserved as string;
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

    const previewUrl = mediaUrl("character-references", path);

    // Auto-persist (2026-08-27, operator lost a full Perspective set to the
    // unpressed Save button): when the form names an EXISTING character,
    // append the photo to its row right here. A photo that cost an
    // allowance must never depend on a later Save click to survive — the
    // renders were sitting orphaned in storage while the row knew nothing.
    // Creation mode passes no id (there is no row yet), and Save keeps
    // owning everything else: name, traits, ordering, removals. Best-effort
    // on purpose: if the append fails the photo still returns to the form
    // and the old Save path persists it.
    let saved = false;
    const characterId = ((formData.get("character_id") as string | null) ?? "").trim();
    if (characterId) {
      const { data: row } = await supabase
        .from("character_profiles")
        .select("id, reference_image_urls")
        .eq("id", characterId)
        .eq("user_id", data.user.id)
        .maybeSingle();
      const existing = (row?.reference_image_urls as string[] | null) ?? [];
      if (row && existing.length < 5 && !existing.includes(path)) {
        const { error: appendError } = await supabase
          .from("character_profiles")
          .update({
            reference_image_urls: [...existing, path],
            updated_at: new Date().toISOString(),
          })
          .eq("id", characterId)
          .eq("user_id", data.user.id);
        if (appendError) {
          console.error("auto-persist of generated reference failed:", appendError.message);
        } else {
          saved = true;
          revalidatePath("/app/character");
          revalidatePath(`/app/character/${characterId}`);
        }
      }
    }

    // Nothing to record here: the free try / monthly slot was already
    // reserved atomically before the provider call. (Admins reserve nothing —
    // they're exempt from the cap, so logging their generations would only
    // add noise to a table whose sole purpose is counting against it.)
    return { error: null, path, url: previewUrl, saved };
  } catch (err) {
    // A safety-filter rejection, provider error, or failed upload lands here —
    // refund the up-front reservation so a failed attempt never burns a free
    // try or a slot in the monthly cap (the semantics the old record-on-success
    // code had). Both refunds are service-role and idempotent-safe: the free
    // decrement floors at 0, and the paid delete targets exactly the row this
    // request reserved.
    if (isFreeTier) {
      await admin.rpc("refund_free_reference_generation", { p_user_id: data.user.id });
    } else if (reservedRowId) {
      await admin.from("reference_image_generations").delete().eq("id", reservedRowId);
    }
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
    .select("reference_image_urls, outfit_image_urls")
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

  const paths = [
    ...(((existing?.reference_image_urls as string[] | null) ?? [])),
    ...(((existing?.outfit_image_urls as string[] | null) ?? [])),
  ];
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
    .select("reference_image_urls, outfit_image_urls")
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

  const paths = [
    ...(((existing?.reference_image_urls as string[] | null) ?? [])),
    ...(((existing?.outfit_image_urls as string[] | null) ?? [])),
  ];
  if (paths.length > 0) {
    await supabase.storage.from("character-references").remove(paths);
  }

  revalidatePath("/app/character");
  redirect("/app/character");
}
