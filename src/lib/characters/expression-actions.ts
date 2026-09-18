"use server";

// Making, uploading and removing the close-ups of a character's expression
// set (lib/characters/expression-set.ts, 2026-09-19).
//
// A close-up Picacho makes goes through generateReferenceImage, the lane
// every AI character photo already takes: the same allowance (reserved
// before the call, refunded on any failure), the same prompt gate, the same
// picture check, the same providers. What is new is only what it is made
// FROM — up to three of the character's photos, and for a smile or a laugh
// the set's teeth close-up — and where it is kept. Then the product's own
// identity scorer reads it against photo 1, and a close-up that has drifted
// stays on the page but never rides a render (isUsable).
//
// Nothing is spent before the set is known to be writable: until
// character-expression-set.sql runs, making a close-up says so and costs
// nothing.

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { mediaUrl } from "@/lib/media/url";
import { generateReferenceImage } from "@/lib/characters/actions";
import { scoreIdentityMatch } from "@/lib/generations/providers/openai";
import {
  chainsFromTeeth,
  isExpressionSlot,
  isUsable,
  slotPrompt,
  type ExpressionSlot,
  type ExpressionSlotEntry,
} from "@/lib/characters/expression-set";
import { probeExpressionSet, writeExpressionSlot } from "@/lib/characters/expression-set-store";
import {
  EXPRESSION_BAD_REQUEST,
  EXPRESSION_BAD_UPLOAD,
  EXPRESSION_NEEDS_DATABASE,
  EXPRESSION_NEEDS_PHOTO,
  EXPRESSION_NO_CHARACTER,
  EXPRESSION_REMOVE_FAILED,
  EXPRESSION_SAVE_FAILED,
} from "@/lib/characters/expression-messages";

const SESSION_EXPIRED = "Your session expired — please log in again.";

export type ExpressionSlotResult =
  | { error: string }
  | {
      error: null;
      slot: ExpressionSlot;
      url: string;
      source: "made" | "upload";
      likeness: number | null;
      usable: boolean;
    };

type Character = { id: string; photos: string[]; traits: { hair?: string; distinguishing_features?: string } };

async function loadCharacter(characterId: string): Promise<
  | { error: string }
  | { error: null; supabase: Awaited<ReturnType<typeof createClient>>; userId: string; character: Character }
> {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return { error: SESSION_EXPIRED };
  if (!characterId) return { error: EXPRESSION_BAD_REQUEST };
  const userId = auth.user.id;
  const { data: row } = await supabase
    .from("character_profiles")
    .select("id, traits, reference_image_urls")
    .eq("id", characterId)
    .eq("user_id", userId)
    .maybeSingle();
  if (!row) return { error: EXPRESSION_NO_CHARACTER };
  const photos = ((row.reference_image_urls as string[] | null) ?? []).filter((p) => p.startsWith(`${userId}/`));
  const traits = (row.traits ?? {}) as Character["traits"];
  return { error: null, supabase, userId, character: { id: row.id as string, photos, traits } };
}

/** The product's scorer against photo 1 (providers/openai.ts); null when it cannot read. */
async function likenessAgainstPhotoOne(
  supabase: Awaited<ReturnType<typeof createClient>>,
  character: Character,
  path: string,
): Promise<number | null> {
  if (character.photos.length === 0) return null;
  const sign = async (p: string) =>
    (await supabase.storage.from("character-references").createSignedUrl(p, 60 * 10)).data?.signedUrl ?? null;
  const [closeUp, photoOne] = await Promise.all([sign(path), sign(character.photos[0])]);
  if (!closeUp || !photoOne) return null;
  // The same trait summary every render's identity check reads (generations/actions.ts).
  const traitSummary = [
    character.traits.hair ? `hair: ${character.traits.hair}` : null,
    character.traits.distinguishing_features ? `distinguishing features: ${character.traits.distinguishing_features}` : null,
  ]
    .filter(Boolean)
    .join("; ");
  const verdict = await scoreIdentityMatch(closeUp, photoOne, traitSummary);
  // A close-up of the eyes or the mouth alone can read "face not visible": no
  // verdict on likeness, so none is recorded — it is used, marked unchecked.
  if (!verdict || verdict.unusable || !verdict.faceVisible) return null;
  return verdict.score;
}

async function keep(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string,
  characterId: string,
  slot: ExpressionSlot,
  entry: ExpressionSlotEntry,
): Promise<ExpressionSlotResult> {
  const written = await writeExpressionSlot(supabase, characterId, userId, slot, entry);
  if (written.error !== null) {
    // Nothing points at the new file: it goes, rather than sit orphaned.
    await supabase.storage.from("character-references").remove([entry.path]);
    return { error: written.error === "missing" ? EXPRESSION_NEEDS_DATABASE : EXPRESSION_SAVE_FAILED };
  }
  if (written.replaced) await supabase.storage.from("character-references").remove([written.replaced]);
  revalidatePath(`/app/character/${characterId}`);
  return {
    error: null,
    slot,
    url: mediaUrl("character-references", entry.path),
    source: entry.source,
    likeness: entry.likeness,
    usable: isUsable(entry),
  };
}

/** Makes one close-up from the character's photos (and, for a smile or a laugh, from the set's teeth). */
export async function makeExpressionSlot(formData: FormData): Promise<ExpressionSlotResult> {
  const slot = String(formData.get("slot") ?? "").trim();
  if (!isExpressionSlot(slot)) return { error: EXPRESSION_BAD_REQUEST };
  const loaded = await loadCharacter(String(formData.get("character_id") ?? "").trim());
  if (loaded.error !== null) return { error: loaded.error };
  const { supabase, userId, character } = loaded;
  if (character.photos.length === 0) return { error: EXPRESSION_NEEDS_PHOTO };

  const probe = await probeExpressionSet(supabase, character.id, userId);
  if (!probe.available) return { error: probe.reason === "missing" ? EXPRESSION_NEEDS_DATABASE : EXPRESSION_SAVE_FAILED };

  // The teeth ride only if the set's teeth are ones a render would use.
  const teeth = probe.set.teeth && isUsable(probe.set.teeth) ? probe.set.teeth.path : null;
  const withTeeth = chainsFromTeeth(slot) && teeth !== null;
  const request = new FormData();
  request.set("prompt", slotPrompt(slot, { withTeeth }));
  request.set("anchor_paths", JSON.stringify([...character.photos.slice(0, 3), ...(withTeeth ? [teeth] : [])]));
  request.set("expression_slot", slot);
  // The face's traits, never the outfit: a close-up is not about the clothes.
  request.set("trait_hair", character.traits.hair ?? "");
  request.set("trait_distinguishing_features", character.traits.distinguishing_features ?? "");

  const made = await generateReferenceImage(request);
  if (made.error !== null) return { error: made.error };
  const likeness = await likenessAgainstPhotoOne(supabase, character, made.path);
  return keep(supabase, userId, character.id, slot, { path: made.path, source: "made", likeness, at: new Date().toISOString() });
}

/** Puts the person's own photo, already uploaded to their folder, in a slot. Free, like every upload. */
export async function setExpressionSlotUpload(formData: FormData): Promise<ExpressionSlotResult> {
  const slot = String(formData.get("slot") ?? "").trim();
  const path = String(formData.get("path") ?? "").trim();
  if (!isExpressionSlot(slot)) return { error: EXPRESSION_BAD_REQUEST };
  const loaded = await loadCharacter(String(formData.get("character_id") ?? "").trim());
  if (loaded.error !== null) return { error: loaded.error };
  const { supabase, userId, character } = loaded;
  // Only a file in the person's own folder, and one that is really there.
  if (!path.startsWith(`${userId}/`) || path.includes("..") || path.length > 400) return { error: EXPRESSION_BAD_UPLOAD };
  const { data: exists } = await supabase.storage.from("character-references").createSignedUrl(path, 60);
  if (!exists?.signedUrl) return { error: EXPRESSION_BAD_UPLOAD };

  const probe = await probeExpressionSet(supabase, character.id, userId);
  if (!probe.available) {
    await supabase.storage.from("character-references").remove([path]);
    return { error: probe.reason === "missing" ? EXPRESSION_NEEDS_DATABASE : EXPRESSION_SAVE_FAILED };
  }
  const likeness = await likenessAgainstPhotoOne(supabase, character, path);
  return keep(supabase, userId, character.id, slot, { path, source: "upload", likeness, at: new Date().toISOString() });
}

/** Empties a slot and removes its file. */
export async function removeExpressionSlot(formData: FormData): Promise<{ error: string | null }> {
  const slot = String(formData.get("slot") ?? "").trim();
  if (!isExpressionSlot(slot)) return { error: EXPRESSION_BAD_REQUEST };
  const loaded = await loadCharacter(String(formData.get("character_id") ?? "").trim());
  if (loaded.error !== null) return { error: loaded.error };
  const { supabase, userId, character } = loaded;
  const written = await writeExpressionSlot(supabase, character.id, userId, slot, null);
  if (written.error !== null) return { error: written.error === "missing" ? EXPRESSION_NEEDS_DATABASE : EXPRESSION_REMOVE_FAILED };
  if (written.replaced) await supabase.storage.from("character-references").remove([written.replaced]);
  revalidatePath(`/app/character/${character.id}`);
  return { error: null };
}
