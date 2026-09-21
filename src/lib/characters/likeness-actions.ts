"use server";

// Answer who is in a character's photos from the set page (R1, the
// figure's card): the character must be the person's own, the answer one
// of the three, and the photos the ones on the character now. The notice
// version, the method and the place are the server's.

import { createAdminClient, createClient } from "@/lib/supabase/server";
import { getLocale } from "@/lib/i18n/server";
import { parseLikeness, photosHash } from "./likeness";
import { recordLikeness } from "./likeness-store";
import { LIKENESS_COULDNT_RECORD } from "./likeness-messages";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function answerLikeness(characterId: string, answer: string): Promise<{ error: string | null }> {
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  if (!data.user) return { error: "Your session expired — please log in again." };
  const parsed = parseLikeness(answer);
  if (!parsed || typeof characterId !== "string" || !UUID_RE.test(characterId)) return { error: LIKENESS_COULDNT_RECORD };
  const { data: character } = await supabase
    .from("character_profiles")
    .select("id, reference_image_urls")
    .eq("id", characterId)
    .eq("user_id", data.user.id)
    .maybeSingle();
  if (!character) return { error: LIKENESS_COULDNT_RECORD };
  const paths = Array.isArray(character.reference_image_urls) ? (character.reference_image_urls as string[]) : [];
  const kept = await recordLikeness(createAdminClient(), {
    userId: data.user.id,
    characterId,
    answer: parsed,
    photosHash: photosHash(paths),
    locale: await getLocale(),
    place: "helios_cast",
  });
  // A missing table (the SQL not run yet) lets the shot go on, as the shot's own check does.
  return { error: kept === "failed" ? LIKENESS_COULDNT_RECORD : null };
}
