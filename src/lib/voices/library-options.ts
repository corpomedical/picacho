// The library filters the voice sheet offers (lib/voices/elevenlabs.ts reads
// them on the server too). Values are ElevenLabs' own, read 2026-10-01.

export const GENDERS = ["female", "male", "neutral"] as const;
export const AGES = ["young", "middle_aged", "old"] as const;
export const USE_CASES = [
  "conversational",
  "narrative_story",
  "characters_animation",
  "social_media",
  "entertainment_tv",
  "advertisement",
  "informative_educational",
] as const;
export const SORTS = ["trending", "usage_character_count_1y", "cloned_by_count", "created_date"] as const;
/** The languages Picacho speaks, then the most common others ElevenLabs lists. */
export const LANGUAGES = ["en", "es", "pt", "it", "fr", "de", "ja", "ko", "zh", "hi", "ar", "nl", "pl", "tr", "ru", "sv"] as const;


/** Voice Design's limits (POST /v1/text-to-voice/design): a description, and preview text of 100–1,000 characters. */
export const DESCRIPTION_MIN = 20;
export const DESCRIPTION_MAX = 1000;
export const PREVIEW_TEXT_MIN = 100;
export const PREVIEW_TEXT_MAX = 1000;

/** A person's own voice row as the character form's card shows it (before the sheet words it in their language). */
export function ownVoiceCard(r: { id: unknown; label: unknown; description: unknown; source: unknown; attributes: unknown }) {
  const a = (r.attributes && typeof r.attributes === "object" ? r.attributes : {}) as Record<string, unknown>;
  const s = (k: string) => (typeof a[k] === "string" ? (a[k] as string) : "");
  const source = (["library", "designed", "cloned"].includes(String(r.source)) ? r.source : "library") as "library" | "designed" | "cloned";
  return {
    id: String(r.id),
    label: String(r.label ?? ""),
    description: typeof r.description === "string" ? r.description : null,
    source,
    meta: [s("gender"), s("age").replace(/_/g, " "), s("accent"), s("language")].filter(Boolean).join(" · "),
  };
}
