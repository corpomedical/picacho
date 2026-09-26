// The star's say-so for ads (critique #9; press-tour-03-campaigns.sql §4,
// character_ad_consents): who is in a character's photos — the person
// themself, someone who gave them permission, or no real person — AND that
// the character may appear in ads for products the person sells. Kept for
// exactly the photos on the character now (characters/likeness.ts
// photosHash): a new photo asks again.
//
// The door's Starring tile asks it; the engine reads the same rows before
// it plans or paints ("You said this is you and may appear in your ads." is
// printed only from a row this module wrote). Written by the server alone,
// with the service role; people read their own rows (the table's read-own
// policy), so the door's loader reads them with the person's own client.
//
// The notice version, the method, the place and the hashed address are the
// server's, never the page's. Ticked, never pre-ticked (S11).
//
// Alias-free (vitest has no "@/"): star-consent.test.ts imports it as it is.

import type { SupabaseClient } from "@supabase/supabase-js";
import { parseLikeness, photosHash, type LikenessAnswer } from "../characters/likeness";

/** The notice the answer is given under; set here, never by the page. */
export const STAR_CONSENT_NOTICE_VERSION = "2026-09-26";
export const STAR_CONSENT_METHOD = "checkbox";
export const STAR_CONSENT_TABLE = "character_ad_consents";

export type StarAnswer = LikenessAnswer;

/** Writes an hour, shared with the product card's (card-service.ts writeBudget). */
export const STAR_WRITES_SCOPE = "press-card-write";
export const STAR_WRITES_PER_HOUR = 120;

// What a person reads (English; i18n/server-text.ts maps them).
export const STAR_ADS_OK_REQUIRED = "Tick that your star may appear in your ads.";
export const STAR_NEEDS_PHOTO = "Add a photo to your character first.";
export const STAR_CONSENT_FAILED = "We couldn't record your answer. Try again.";
export const STAR_NOT_YOURS = "We couldn't find that in your account.";
export const STAR_WRITE_LIMIT = "That's a lot of changes in an hour. Try again a little later.";

export const STAR_CONSENT_MESSAGES = [STAR_ADS_OK_REQUIRED, STAR_NEEDS_PHOTO, STAR_CONSENT_FAILED, STAR_NOT_YOURS, STAR_WRITE_LIMIT] as const;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The answer that still holds for a character's photos now: the newest row
 * given for exactly these photos, or null (no answer, or the photos changed).
 */
export function currentStarAnswer(
  photos: readonly string[],
  rows: readonly { answer?: unknown; photos_hash?: unknown; ads_ok?: unknown }[],
): StarAnswer | null {
  if (photos.length === 0) return null;
  const hash = photosHash(photos);
  for (const row of rows) {
    if (row?.photos_hash !== hash || row?.ads_ok !== true) continue;
    const answer = parseLikeness(row.answer);
    if (answer) return answer;
  }
  return null;
}

export interface StarConsentDeps {
  /** The person's own client: reads their character (RLS, and an explicit owner filter). */
  db: SupabaseClient;
  /** The service role: the only writer of character_ad_consents. */
  admin: SupabaseClient;
  /** rate-limit.ts rateLimited: true = over the limit (fails closed). */
  rateLimited: (key: string, scope: string, windowSeconds: number, max: number) => Promise<boolean>;
  /** rate-limit.ts hashedRateKey, for the address. */
  hashKey: (value: string | null | undefined, scope: string) => string;
}

export type StarConsentResult = { error: null; answer: StarAnswer } | { error: string };

/**
 * Keeps the person's answer for one of their characters. `userId` is the
 * caller the action already let through (Press Tour on, open to them, email
 * confirmed: card-service.ts pressTourCaller).
 */
export async function keepStarConsent(
  deps: StarConsentDeps,
  userId: string,
  input: { characterId?: unknown; answer?: unknown; adsOk?: unknown },
  context: { locale: string; ip: string | null },
): Promise<StarConsentResult> {
  const answer = parseLikeness(input?.answer);
  const characterId = typeof input?.characterId === "string" && UUID_RE.test(input.characterId) ? input.characterId.toLowerCase() : null;
  if (!answer || !characterId) return { error: STAR_CONSENT_FAILED };
  if (input?.adsOk !== true) return { error: STAR_ADS_OK_REQUIRED };
  if (await deps.rateLimited(userId, STAR_WRITES_SCOPE, 60 * 60, STAR_WRITES_PER_HOUR)) return { error: STAR_WRITE_LIMIT };

  let paths: string[] = [];
  try {
    const { data, error } = await deps.db
      .from("character_profiles")
      .select("id, reference_image_urls")
      .eq("id", characterId)
      .eq("user_id", userId)
      .maybeSingle();
    if (error) return { error: STAR_CONSENT_FAILED };
    if (!data) return { error: STAR_NOT_YOURS };
    const raw = (data as { reference_image_urls?: unknown }).reference_image_urls;
    paths = Array.isArray(raw) ? raw.filter((p): p is string => typeof p === "string" && p.length > 0) : [];
  } catch {
    return { error: STAR_CONSENT_FAILED };
  }
  if (paths.length === 0) return { error: STAR_NEEDS_PHOTO };

  const locale = typeof context?.locale === "string" && /^[a-z]{2}(-[A-Za-z]{2})?$/.test(context.locale) ? context.locale : "en";
  try {
    const { error } = await deps.admin.from(STAR_CONSENT_TABLE).insert({
      user_id: userId,
      character_id: characterId,
      answer,
      ads_ok: true,
      photos_hash: photosHash(paths),
      notice_version: STAR_CONSENT_NOTICE_VERSION,
      locale,
      method: STAR_CONSENT_METHOD,
      place: "door",
      ip_hash: context?.ip ? deps.hashKey(context.ip, "press-consent") : null,
    });
    if (error) return { error: STAR_CONSENT_FAILED };
  } catch {
    return { error: STAR_CONSENT_FAILED };
  }
  return { error: null, answer };
}
