// EVERY CHARACTER HAS A VOICE, AND EVERY TAKE SAYS WHOSE IT WAS (2026-09-23).
//
// The face lock (face-lock.ts) has to MEASURE, because the model paints the
// face and we can only judge it afterwards. The voice is the opposite: we
// either made the track or we did not, so the lock is a matter of record
// rather than of scoring. That difference is the whole design — there is no
// voice threshold and no voice refund here, because there is nothing to
// guess at.
//
// What the audit of 2026-09-23 found, and what these two pieces answer:
//
//   1. A character could be saved with NO voice at all. `voice_id` is
//      nullable with no default (schema.sql) and the picker is optional
//      (character-form.tsx). "This character always sounds like this" has no
//      `this` until a voice exists, so assignedVoiceFor() below gives every
//      character one at creation, and the form can still change it.
//
//   2. Nothing recorded which voice spoke. The resolved id rode the job
//      payload and was erased at delivery, so not one row in the database
//      could say what a delivered clip sounded like. voiceRecord() below is
//      what finish() writes, beside match_score, so the claim "no voice that
//      is not ours is ever in a delivered file" becomes one count(*) instead
//      of a hope.
//
// Alias-free, like face-lock.ts and identity-gate.ts, so it can be tested
// without booting Supabase or fal.

/**
 * Where the audible voice in a delivered file came from.
 *
 * `character` — a track we synthesised from this character's own voice.
 * `silent`    — no voice track: the engine was switched off, or its audio
 *               was dropped locally because it has no switch.
 * `engine`    — the engine's own invented voice reached the file. This is
 *               the failure the whole lock exists to drive to zero, and it
 *               is recorded rather than assumed absent: a delivery path that
 *               skips the voice stage must say so, or the count is a lie by
 *               omission.
 */
export type VoiceSource = "character" | "silent" | "engine";

export const VOICE_SOURCES: readonly VoiceSource[] = ["character", "silent", "engine"];

export function isVoiceSource(value: unknown): value is VoiceSource {
  return typeof value === "string" && (VOICE_SOURCES as readonly string[]).includes(value);
}

/** One row of the curated catalogue, as little of it as this file needs. */
export type VoicePreset = { id: string; elevenlabs_voice_id: string };

// FNV-1a, 32-bit. Any stable hash would do; the requirements are that it is
// pure (Date.now and Math.random are both unavailable to us by policy and
// would break repeatability anyway) and that the same character id picks the
// same voice on every machine, forever — including in a backfill run months
// after the character was made.
function hash32(value: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < value.length; i += 1) {
    h ^= value.charCodeAt(i);
    // The FNV prime, applied with Math.imul so the multiply stays in 32-bit
    // space instead of drifting into float territory on long ids.
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/**
 * The voice a character gets when nobody picked one.
 *
 * Deterministic on the character's id, so the same character picks the same
 * voice on every machine and in a backfill run months later — and so two
 * characters made by the same person are spread across the catalogue rather
 * than all landing on whatever happens to sort first. The caller passes the
 * presets in a fixed order (sort_order, then id) so the pick does not move
 * with row-return order.
 *
 * Note what this does NOT survive: adding a preset changes the catalogue's
 * length and therefore the modulo, so a character resolved before the new
 * voice existed would resolve differently afterwards. That is harmless here
 * only because the answer is PERSISTED onto character_profiles.voice_id at
 * creation and never recomputed. This function decides a voice once; it is
 * not a lookup, and it must never be used as one.
 *
 * Deliberately NOT derived from voice_tone_tags. Choosing a voice because a
 * tag says "gravelly" is a word list wearing a hat: it judges what the tags
 * CONTAIN rather than what the character IS, and the first user to write
 * "not gravelly" would get the gravelly voice. Tags steer the picture prompt
 * and stay there.
 *
 * Returns null only when the catalogue is empty, which is an operator
 * problem (Admin > Voices) and not something to paper over with a fallback
 * voice nobody chose.
 */
export function assignedVoiceFor(
  characterId: string,
  presets: readonly VoicePreset[],
): string | null {
  if (!characterId || presets.length === 0) return null;
  return presets[hash32(characterId) % presets.length].id;
}

/** The settings we pin on every speech call. See speechSettings() below. */
export type VoiceSettings = {
  endpoint: string;
  seed: number;
  stability: number;
  speakerBoost: boolean;
};

/**
 * What finish() writes onto the generation row, beside match_score.
 *
 * `externalId` is kept as well as `presetId` because a preset can be deleted
 * out from under a delivered clip — character_profiles.voice_id is
 * ON DELETE SET NULL (schema.sql) — and a record that evaporates with the
 * catalogue row is not a record. The external id is the provider's own
 * permanent voice id, which survives.
 */
export type VoiceRecord = {
  dialogue_voice_id: string | null;
  dialogue_voice_external_id: string | null;
  voice_settings: VoiceSettings | null;
  voice_source: VoiceSource;
};

export function voiceRecord(input: {
  source: VoiceSource;
  presetId?: string | null;
  externalId?: string | null;
  settings?: VoiceSettings | null;
}): VoiceRecord {
  // A voice only belongs on the row when we actually spoke. A silent take
  // that carried a preset id would read, to the count and to anyone
  // debugging it, as a take that spoke in that voice.
  const spoke = input.source === "character";
  return {
    dialogue_voice_id: spoke ? (input.presetId ?? null) : null,
    dialogue_voice_external_id: spoke ? (input.externalId ?? null) : null,
    voice_settings: spoke ? (input.settings ?? null) : null,
    voice_source: input.source,
  };
}
