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
 * `engine`    — the engine's own invented voice reached the file.
 * `source`    — audio carried over from a clip the person uploaded: a REAL
 *               performer's recorded voice, under our character's face.
 *               Kept apart from `engine` because it is a different kind of
 *               wrong and a worse one — not a machine inventing a voice but
 *               a specific human being speaking as somebody else's
 *               character (recast.ts keep_audio / keep_original_sound, and
 *               the long take, which re-encodes that track across every
 *               join).
 *
 * The last three are all failures of the promise, and all three are RECORDED
 * rather than assumed absent: a delivery path that skips the voice stage has
 * to say so, or the count is a lie by omission.
 */
export type VoiceSource = "character" | "silent" | "engine" | "source";

export const VOICE_SOURCES: readonly VoiceSource[] = ["character", "silent", "engine", "source"];

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

/**
 * Engines that make audio whatever we ask, because their fal endpoint has no
 * generate_audio parameter at all to switch off.
 *
 * MiniMax H3: "Audio is not a parameter on this endpoint: H3 generates
 * native stereo sound in the same pass as the picture, always."
 * (providers/video-models.ts). Gemini Omni Flash: "THERE IS NO AUDIO
 * PARAMETER. Native synchronised audio is always generated, so
 * generateNativeAudio has nothing to switch off." (providers/fal.ts).
 *
 * This is why a delivered clip's voice cannot be inferred from what we
 * REQUESTED. On these two, asking for silence and getting it are different
 * things, and the row has to say which happened.
 *
 * Since 2026-09-25 a lane can ask the runner to take that sound out of the
 * stored file instead (job payload voice.dropEngineAudio; Helios takes,
 * "silent now, dubbed later"), and the row then says `silent` only when the
 * stored file was checked to carry no sound track (fileSilent below).
 */
export const ALWAYS_SPEAKS: readonly string[] = ["minimax-h3", "gemini-omni"];

/** Whether the engine's own audio can reach the file on this render. */
export function engineAudioReaches(modelId: string, nativeAudioRequested: boolean): boolean {
  return nativeAudioRequested || ALWAYS_SPEAKS.includes(modelId);
}

/**
 * What to record on the row, from what the render actually did.
 *
 * `spoke` means our own TTS track was lip-synced onto the picture. The
 * lip-sync pass is taken to REPLACE the video's audio rather than mix into
 * it — which is what the endpoint is for, and what this codebase has always
 * assumed — but note that it is assumed and not measured: nobody has yet
 * ffprobe'd a delivered H3 or Omni dialogue clip to confirm the engine's own
 * track is gone rather than sitting underneath. Until someone does, a
 * `character` row on one of those two engines is our best knowledge and not
 * a proof. One clip settles it; see the audit note of 2026-09-23.
 */
export function voiceSourceFor(input: {
  spoke: boolean;
  modelId: string;
  nativeAudioRequested: boolean;
  /**
   * The send deliberately carried the uploaded clip's own audio through —
   * the recast family's keep_audio / keep_original_sound. Ranked above the
   * engine because when both are true it is the human's recorded voice that
   * is audible, and that is the one worth counting.
   */
  keepsSourceAudio?: boolean;
  /**
   * The stored file was checked to carry no sound track: the engine's own
   * was taken out after the render (job-runner.ts, core.ts persistVideo,
   * 2026-09-25). A fact about the file rather than about the request, so it
   * outranks everything but our own voice.
   */
  fileSilent?: boolean;
}): VoiceSource {
  if (input.spoke) return "character";
  if (input.fileSilent) return "silent";
  if (input.keepsSourceAudio) return "source";
  return engineAudioReaches(input.modelId, input.nativeAudioRequested) ? "engine" : "silent";
}

// THE PINNED SPEECH CALL (2026-09-23), measured before it was written.
//
// Until today both call sites posted `{ text, voice }` and nothing else to
// fal-ai/elevenlabs/tts/eleven-v3, an endpoint whose whole input schema is
// text, voice, stability, timestamps, language_code, apply_text_normalization
// — no seed of any kind. Every line therefore ran at ElevenLabs' default
// stability of 0.5, on the model their own docs call their most variable:
// "voices in the voice library may produce more variable results compared to
// the v2 and v2.5 models".
//
// THE PROBE, six sends of one line, $0.061 (2026-09-23):
//   today's endpoint, today's body  -> 85,308 / 92,831 / 86,562 bytes.
//     Three different-length performances of the same words, ~9% spread.
//   text-to-dialogue, seeded        -> 90,324 / 90,324 / 90,324 bytes.
//
// And the confirmation, three more sends at $0.031, decoded to PCM and
// compared as a loudness envelope rather than as bytes (a few ms of mp3
// padding makes identical audio look wholly different sample-by-sample):
//   same seed      -> 5.642s vs 5.642s, envelope correlation 0.9863
//   different seed -> 5.642s vs 5.721s, envelope correlation 0.5519
//
// So the seed pins the PERFORMANCE — the length to the millisecond, the
// pacing, where the emphasis and the breaths fall. It does not pin the
// waveform, and nothing here should ever claim it does: ElevenLabs says in
// writing that a seed is a "best effort to sample deterministically" and
// that "Determinism is not guaranteed". Same performance, not same file.
//
// The sibling endpoint costs exactly what we already pay — "$0.1 per 1000
// character" on both — so this is a free move, and its response is the shape
// extractAudioUrl() already reads ({ audio: { url } }, plus the seed echoed
// back).
export const SPEECH_ENDPOINT_V3 = "fal-ai/elevenlabs/text-to-dialogue/eleven-v3";

// ELEVEN V4 (2026-10-01, operator: "Elevenlabs v4 integration in Picacho",
// then "Keep old characters on v3"). ElevenLabs released Eleven v4 on
// 2026-09-28 and calls it "a net upgrade over Eleven v3, delivering better
// results in almost every case" — but also says it "may sound substantially
// different from Eleven v3", because it copies the source voice more
// faithfully. A character who has already spoken in a delivered video would
// change voice between one take and the next, which is the one thing the
// lock exists to prevent. So the engine is a property of the CHARACTER,
// chosen once: whoever spoke before today keeps v3, and everyone whose first
// line comes after the switch speaks v4 for good (speech-engine.ts).
//
// fal's schema for elevenlabs/tts/eleven-v4 (read 2026-10-01): text, voice,
// stability 0–1 (continuous, default 0.5), similarity_boost 0–1 (default
// 0.75), seed ("best-effort reproducibility. Identical output is not
// guaranteed"), language_code, apply_text_normalization, output_format,
// timestamps; returns { audio: { url } }. No speaker boost, style or speed —
// ElevenLabs: "Style and Speed sliders are not available in Eleven v4".
// Price: "$0.08 per 1000 character" on fal, against v3 dialogue's $0.10.
export const SPEECH_ENDPOINT_V4 = "elevenlabs/tts/eleven-v4";

export type SpeechEngine = "v3" | "v4";

export const SPEECH_ENDPOINTS: Record<SpeechEngine, string> = {
  v3: SPEECH_ENDPOINT_V3,
  v4: SPEECH_ENDPOINT_V4,
};

/** Which engine a recorded take was spoken on. A row with no settings predates them (v3). */
export function speechEngineOf(settings: { endpoint?: unknown } | null | undefined): SpeechEngine {
  return settings?.endpoint === SPEECH_ENDPOINT_V4 ? "v4" : "v3";
}

/**
 * The engine a character speaks on, from their history: their FIRST
 * recorded spoken take decides it (so a v4 character's later takes keep
 * them on v4); a character who spoke before takes were recorded (only the
 * lip-sync step in the log says so) is v3; a character who never spoke
 * starts on v4.
 */
export function speechEngineForHistory(input: {
  firstRecorded: { voice_settings?: { endpoint?: unknown } | null } | null;
  spokeBeforeRecords: boolean;
}): SpeechEngine {
  if (input.firstRecorded) return speechEngineOf(input.firstRecorded.voice_settings);
  return input.spokeBeforeRecords ? "v3" : "v4";
}

/**
 * ElevenLabs v3 quantises stability to 0.0 / 0.5 / 1.0 — Creative, Natural,
 * Robust. 1.0 is Robust: "Highly stable, but less responsive to directional
 * prompts".
 *
 * That is a real trade and it is taken deliberately. Robust costs expressive
 * range — the docs are explicit that it "reduces responsiveness to
 * directional prompts" — and buys the thing the product actually sells,
 * which is one recognisable person who sounds the same every time. It is a
 * constant rather than a setting because a per-user knob here would mean the
 * lock is only as good as the least careful person's slider.
 *
 * v4's stability is continuous, and its top keeps "the performance closer to
 * a fixed baseline" (ElevenLabs) — the same trade, taken the same way.
 */
export const SPEECH_STABILITY = 1.0;

/**
 * v4's "how closely the output follows the reference voice", at fal's and
 * ElevenLabs' default: higher "may reduce naturalness", and v4 already
 * copies the voice more closely than v3 did with speaker boost on.
 */
export const SPEECH_SIMILARITY_V4 = 0.75;

/**
 * A stable seed for one character, so their delivery is a property of THEM
 * rather than of the moment they were rendered. Same character, same line,
 * same performance — today and in six months.
 *
 * Derived from the character's id with the same hash the voice assignment
 * uses, kept inside fal's positive-integer range.
 */
export function speechSeedFor(characterId: string): number {
  return hash32(characterId || "picacho") % 2147483647;
}

/** The settings we pin on every speech call, and record on the row. */
export type VoiceSettings = {
  endpoint: string;
  seed: number;
  stability: number;
  /** v3 only. */
  speakerBoost?: boolean;
  /** v4 only. */
  similarity?: number;
};

export function speechSettings(seed: number, engine: SpeechEngine): VoiceSettings {
  if (engine === "v4") {
    return { endpoint: SPEECH_ENDPOINT_V4, seed, stability: SPEECH_STABILITY, similarity: SPEECH_SIMILARITY_V4 };
  }
  return {
    endpoint: SPEECH_ENDPOINT_V3,
    seed,
    stability: SPEECH_STABILITY,
    // "Boosts similarity to original speaker" — the one remaining knob this
    // endpoint offers that points at the character sounding like themselves.
    speakerBoost: true,
  };
}

/** The request body for one spoken line on the character's engine — one builder for every call site. */
export function speechRequestBody(text: string, elevenLabsVoiceId: string, seed: number, engine: SpeechEngine) {
  const settings = speechSettings(seed, engine);
  if (engine === "v4") {
    return {
      text,
      voice: elevenLabsVoiceId,
      seed: settings.seed,
      stability: settings.stability,
      similarity_boost: settings.similarity,
    };
  }
  return {
    inputs: [{ text, voice: elevenLabsVoiceId }],
    seed: settings.seed,
    stability: settings.stability,
    use_speaker_boost: settings.speakerBoost,
  };
}

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
