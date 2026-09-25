import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  ALWAYS_SPEAKS,
  assignedVoiceFor,
  engineAudioReaches,
  isVoiceSource,
  SPEECH_ENDPOINT,
  speechSeedFor,
  speechSettings,
  voiceRecord,
  voiceSourceFor,
  VOICE_SOURCES,
  type VoicePreset,
  type VoiceSettings,
} from "./voice-lock";
import { VIDEO_MODELS } from "./providers/video-models";

const CATALOGUE: VoicePreset[] = [
  { id: "p1", elevenlabs_voice_id: "EL1" },
  { id: "p2", elevenlabs_voice_id: "EL2" },
  { id: "p3", elevenlabs_voice_id: "EL3" },
  { id: "p4", elevenlabs_voice_id: "EL4" },
];

const SETTINGS: VoiceSettings = {
  endpoint: "fal-ai/elevenlabs/text-to-dialogue/eleven-v3",
  seed: 12345,
  stability: 1,
  speakerBoost: true,
};

describe("assignedVoiceFor", () => {
  it("gives the same character the same voice every time", () => {
    const id = "8f14e45f-ea2c-4f5d-9c1b-000000000001";
    const first = assignedVoiceFor(id, CATALOGUE);
    expect(first).not.toBeNull();
    for (let i = 0; i < 25; i += 1) {
      expect(assignedVoiceFor(id, CATALOGUE)).toBe(first);
    }
  });

  it("always picks a voice that is actually in the catalogue", () => {
    const ids = CATALOGUE.map((p) => p.id);
    for (let i = 0; i < 200; i += 1) {
      const picked = assignedVoiceFor(`character-${i}`, CATALOGUE);
      expect(ids).toContain(picked);
    }
  });

  it("spreads characters across the catalogue instead of stacking them on one voice", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 200; i += 1) {
      const picked = assignedVoiceFor(`00000000-0000-4000-8000-${String(i).padStart(12, "0")}`, CATALOGUE);
      if (picked) seen.add(picked);
    }
    // Every voice in a four-row catalogue should come up across 200 ids; a
    // hash that collapsed onto one row would still pass the test above.
    expect(seen.size).toBe(CATALOGUE.length);
  });

  it("is not fooled by ids that differ only in their last character", () => {
    const a = assignedVoiceFor("11111111-1111-4111-8111-11111111111a", CATALOGUE);
    const b = assignedVoiceFor("11111111-1111-4111-8111-11111111111b", CATALOGUE);
    const c = assignedVoiceFor("11111111-1111-4111-8111-11111111111c", CATALOGUE);
    const d = assignedVoiceFor("11111111-1111-4111-8111-11111111111d", CATALOGUE);
    // Not a guarantee that all four differ — a 4-row catalogue makes
    // collisions ordinary — but they must not ALL be the same, which is what
    // a hash ignoring the tail would produce.
    expect(new Set([a, b, c, d]).size).toBeGreaterThan(1);
  });

  it("returns null rather than inventing a voice when the catalogue is empty", () => {
    expect(assignedVoiceFor("some-character", [])).toBeNull();
  });

  it("returns null for a missing character id", () => {
    expect(assignedVoiceFor("", CATALOGUE)).toBeNull();
  });

  it("works on a single-row catalogue", () => {
    expect(assignedVoiceFor("anyone", [CATALOGUE[0]])).toBe("p1");
  });
});

describe("voiceRecord", () => {
  it("records the voice and its settings when we spoke", () => {
    expect(
      voiceRecord({ source: "character", presetId: "p2", externalId: "EL2", settings: SETTINGS }),
    ).toEqual({
      dialogue_voice_id: "p2",
      dialogue_voice_external_id: "EL2",
      voice_settings: SETTINGS,
      voice_source: "character",
    });
  });

  it("keeps the provider's permanent id, so a deleted preset does not erase the record", () => {
    const row = voiceRecord({ source: "character", presetId: "p3", externalId: "EL3", settings: SETTINGS });
    // character_profiles.voice_id is ON DELETE SET NULL; this column is not.
    expect(row.dialogue_voice_external_id).toBe("EL3");
  });

  it("writes no voice on a silent take, even when a preset was resolved", () => {
    const row = voiceRecord({ source: "silent", presetId: "p2", externalId: "EL2", settings: SETTINGS });
    expect(row).toEqual({
      dialogue_voice_id: null,
      dialogue_voice_external_id: null,
      voice_settings: null,
      voice_source: "silent",
    });
  });

  it("writes no voice when the engine's own voice reached the file", () => {
    const row = voiceRecord({ source: "engine", presetId: "p2", externalId: "EL2" });
    expect(row.dialogue_voice_id).toBeNull();
    expect(row.voice_source).toBe("engine");
  });

  it("tolerates a spoken take whose ids are missing rather than throwing", () => {
    expect(voiceRecord({ source: "character" })).toEqual({
      dialogue_voice_id: null,
      dialogue_voice_external_id: null,
      voice_settings: null,
      voice_source: "character",
    });
  });
});

describe("the engines that cannot be silenced", () => {
  it("names only models that actually exist in the catalogue", () => {
    const ids = VIDEO_MODELS.map((m) => m.id as string);
    for (const id of ALWAYS_SPEAKS) expect(ids, id).toContain(id);
  });

  it("lets the engine's audio through when we asked for it", () => {
    expect(engineAudioReaches("veo", true)).toBe(true);
    expect(engineAudioReaches("kling-o3", true)).toBe(true);
  });

  it("keeps a switchable engine quiet when we didn't ask", () => {
    expect(engineAudioReaches("veo", false)).toBe(false);
    expect(engineAudioReaches("kling-o3", false)).toBe(false);
    expect(engineAudioReaches("seedance-2-5", false)).toBe(false);
  });

  it("knows H3 and Omni speak even when we asked for silence", () => {
    expect(engineAudioReaches("minimax-h3", false)).toBe(true);
    expect(engineAudioReaches("gemini-omni", false)).toBe(true);
  });
});

describe("voiceSourceFor", () => {
  it("is the character's when our track was lip-synced on", () => {
    expect(voiceSourceFor({ spoke: true, modelId: "veo", nativeAudioRequested: false })).toBe("character");
  });

  it("is silent when nothing spoke and the engine was switched off", () => {
    expect(voiceSourceFor({ spoke: false, modelId: "veo", nativeAudioRequested: false })).toBe("silent");
  });

  it("is the engine's when we left its microphone on", () => {
    expect(voiceSourceFor({ spoke: false, modelId: "veo", nativeAudioRequested: true })).toBe("engine");
  });

  it("does NOT call an H3 or Omni take silent just because we asked for silence", () => {
    // The whole point of the column: what we requested and what shipped are
    // different things on these two, and the old code called both "silent".
    for (const modelId of ALWAYS_SPEAKS) {
      expect(voiceSourceFor({ spoke: false, modelId, nativeAudioRequested: false })).toBe("engine");
    }
  });

  it("calls a recast take what it is: a real person's recorded voice", () => {
    expect(
      voiceSourceFor({ spoke: false, modelId: "kling-o3", nativeAudioRequested: false, keepsSourceAudio: true }),
    ).toBe("source");
  });

  it("ranks the uploaded clip's own voice above the engine's, since that is what is audible", () => {
    expect(
      voiceSourceFor({ spoke: false, modelId: "veo", nativeAudioRequested: true, keepsSourceAudio: true }),
    ).toBe("source");
    // Even on an engine that cannot be silenced.
    expect(
      voiceSourceFor({ spoke: false, modelId: "minimax-h3", nativeAudioRequested: false, keepsSourceAudio: true }),
    ).toBe("source");
  });

  it("still reports our own voice when we dubbed over a kept source track", () => {
    expect(
      voiceSourceFor({ spoke: true, modelId: "kling-o3", nativeAudioRequested: true, keepsSourceAudio: true }),
    ).toBe("character");
  });

  // A Helios take on an engine with no switch (2026-09-25): the runner took
  // the engine's sound out of the stored file and checked it.
  it("calls a take silent when its stored file was checked to carry no sound", () => {
    for (const modelId of ["gemini-omni", "minimax-h3"]) {
      expect(voiceSourceFor({ spoke: false, modelId, nativeAudioRequested: false, fileSilent: true })).toBe("silent");
    }
  });

  it("still reports our own voice over a file said to be silent", () => {
    expect(voiceSourceFor({ spoke: true, modelId: "gemini-omni", nativeAudioRequested: false, fileSilent: true })).toBe("character");
  });

  it("leaves Omni's take the engine's unless the file was checked", () => {
    expect(voiceSourceFor({ spoke: false, modelId: "gemini-omni", nativeAudioRequested: false, fileSilent: false })).toBe("engine");
    expect(voiceSourceFor({ spoke: false, modelId: "gemini-omni", nativeAudioRequested: false })).toBe("engine");
  });

  it("never reports anything outside the four the column allows", () => {
    for (const spoke of [true, false]) {
      for (const nativeAudioRequested of [true, false]) {
        for (const keepsSourceAudio of [true, false]) {
          for (const fileSilent of [true, false]) {
            for (const modelId of ["veo", "minimax-h3", "gemini-omni", "unknown-model", ""]) {
              expect(
                isVoiceSource(voiceSourceFor({ spoke, modelId, nativeAudioRequested, keepsSourceAudio, fileSilent })),
              ).toBe(true);
            }
          }
        }
      }
    }
  });
});

// The record is only worth having if it describes what the submit actually
// did. These two expressions live in different files and must stay in step:
// if the pipeline silences the engine but the payload still says nativeAudio
// was on, every character take is filed as `engine` and the count the whole
// lock is judged by is wrong in the pessimistic direction — and if they drift
// the other way it is wrong in the flattering one, which is worse.
describe("the microphone rule and the record agree", () => {
  const read = (p: string) => readFileSync(join(__dirname, p), "utf8");
  const pipeline = read("pipeline.ts");
  const actions = read("actions.ts");

  it("silences the engine whenever a character is in the shot", () => {
    expect(pipeline).toContain(
      "!usingSeparateDialoguePipeline && !options.hasCharacter && options.nativeAudio !== false",
    );
  });

  it("tells the pipeline when there is a character", () => {
    expect(actions).toContain("hasCharacter: Boolean(character),");
  });

  it("records exactly the condition the pipeline applied", () => {
    expect(actions).toContain("nativeAudio: !wantsDialogue && !character && videoSound !== false,");
  });

  it("leaves multi-angle no way to turn the microphone back on", () => {
    expect(actions).toContain("generateNativeAudio: false,");
    // The lane stopped reading the sound preference when the rule landed;
    // a reintroduced read would mean the setting silently does nothing.
    expect(actions).not.toContain("generateNativeAudio: videoSound");
  });

  // A Helios take on an engine with no switch has its sound taken out of the
  // stored file (2026-09-25, "silent now, dubbed later"). The lane asks; the
  // runner does it, names no lane, and says silent only for a checked file.
  const runner = read("job-runner.ts");

  it("asks for the engine's sound out only on a Helios take, on an engine that cannot be silenced", () => {
    expect(actions).toContain('const heliosTake = contentType === "video" && serverBuiltFrames();');
    expect(actions).toContain(
      "...(heliosTake && !wantsDialogue && ALWAYS_SPEAKS.includes(videoModelId) ? { dropEngineAudio: true } : {}),",
    );
    // Right beside the record of what the engine was asked for.
    const pinned = actions.indexOf("nativeAudio: !wantsDialogue && !character && videoSound !== false,");
    const asked = actions.indexOf("{ dropEngineAudio: true }");
    expect(pinned).toBeGreaterThan(-1);
    expect(asked).toBeGreaterThan(pinned);
    expect(actions.slice(pinned, asked)).not.toContain("}),");
  });

  it("takes the sound out where the clip is stored, never on a run our dialogue re-voices", () => {
    expect(runner).toContain("const dropSound = row.payload.voice?.dropEngineAudio === true && !wantsDialogue;");
    expect(runner).toContain("await persistVideo(admin, userId, providerVideoUrl, { dropSound })");
    expect(runner).toContain("const fileSilent = dropSound && persisted?.silent === true;");
    expect(runner.indexOf("const wantsDialogue = Boolean(")).toBeLessThan(runner.indexOf("const dropSound = "));
  });

  it("records silent only for a stored file that was checked", () => {
    expect(runner).toContain('fileSilent: outcome.status === "succeeded" && outcome.fileSilent === true');
    expect(runner).toContain("fileSilent: salvageUrl === collectedVideoUrl && collectedSilent,");
  });

  it("keeps the runner lane-neutral", () => {
    expect(runner).not.toMatch(/helios|takeInSet/i);
  });
});

describe("the pinned speech call", () => {
  it("points at the endpoint that actually has a seed", () => {
    // tts/eleven-v3, which we ran until 2026-09-23, has no seed in its
    // schema at all — the swap is the whole point.
    expect(SPEECH_ENDPOINT).toBe("fal-ai/elevenlabs/text-to-dialogue/eleven-v3");
  });

  it("gives one character the same seed every time", () => {
    const id = "c0ffee00-0000-4000-8000-000000000001";
    const first = speechSeedFor(id);
    for (let i = 0; i < 20; i += 1) expect(speechSeedFor(id)).toBe(first);
  });

  it("gives different characters different seeds", () => {
    const seeds = new Set(
      Array.from({ length: 50 }, (_, i) => speechSeedFor(`00000000-0000-4000-8000-${String(i).padStart(12, "0")}`)),
    );
    // Collisions are possible but 50 ids landing on fewer than 45 seeds
    // would mean the hash is not spreading.
    expect(seeds.size).toBeGreaterThan(45);
  });

  it("stays inside a positive integer seed range", () => {
    for (const id of ["", "a", "c0ffee00-0000-4000-8000-000000000001", "x".repeat(400)]) {
      const seed = speechSeedFor(id);
      expect(Number.isInteger(seed)).toBe(true);
      expect(seed).toBeGreaterThanOrEqual(0);
      expect(seed).toBeLessThan(2147483647);
    }
  });

  it("pins stability at Robust and asks for speaker boost", () => {
    const s = speechSettings(42);
    expect(s).toEqual({
      endpoint: "fal-ai/elevenlabs/text-to-dialogue/eleven-v3",
      seed: 42,
      stability: 1,
      speakerBoost: true,
    });
  });
});

describe("the provider actually sends what we pinned", () => {
  const fal = readFileSync(join(__dirname, "providers/fal.ts"), "utf8");

  it("builds one body for every spoken line in the product", () => {
    expect(fal).toContain("function speechRequestBody(text: string, elevenLabsVoiceId: string, seed: number)");
    expect(fal).toContain("inputs: [{ text, voice: elevenLabsVoiceId }]");
    expect(fal).toContain("use_speaker_boost: settings.speakerBoost");
  });

  it("no longer posts the bare two-field body that pinned nothing", () => {
    expect(fal).not.toContain("{ text, voice: elevenLabsVoiceId },");
    expect(fal).not.toContain("JSON.stringify({ text, voice: elevenLabsVoiceId })");
  });

  it("makes both call sites take a seed, so neither can be fixed alone", () => {
    expect(fal).toMatch(/submitSpeechJob\(\s*text: string,\s*elevenLabsVoiceId: string,\s*seed: number,\s*\)/);
    expect(fal).toMatch(/generateSpeech\(\s*text: string,\s*elevenLabsVoiceId: string,\s*seed: number,\s*\)/);
  });
});

// Until 2026-09-23 the four voice columns were read by NOTHING in src/app or
// src/components — the lock was a count in a database and had no surface at
// all, while the face had a visible match percentage. These pin the path that
// fixed that, end to end, because every link in it is a separate file and a
// silent break anywhere just means the line stops appearing.
describe("the voice reaches the take card", () => {
  const actions = readFileSync(join(__dirname, "actions.ts"), "utf8");
  const form = readFileSync(join(__dirname, "../../components/generate-form.tsx"), "utf8");

  it("asks the database for it, in the one column list both selects share", () => {
    expect(actions).toContain("match_score, attachments, voice_source, dialogue_voice_id");
  });

  it("declares it on the type the client inherits", () => {
    expect(actions).toContain("voiceSource?: VoiceSource | null;");
    expect(actions).toContain("voiceName?: string | null;");
  });

  it("names the voice from the id the ROW recorded, not the character's voice today", () => {
    // The point of storing it: a character's voice can be changed afterwards
    // and a delivered clip must keep saying what was actually in it.
    expect(actions).toContain('.eq("id", row.dialogue_voice_id as string)');
    expect(actions).toMatch(/voiceSource === "character" && row\.dialogue_voice_id/);
  });

  it("puts both on the item the card reads", () => {
    expect(actions).toMatch(/matchScore: \(row\.match_score \?\? null\) as number \| null,\s*voiceSource,\s*voiceName,/);
  });

  it("renders every source, and only accents the one we made", () => {
    expect(form).toContain('turn.voiceSource === "character" ?');
    expect(form).toContain("formatMsg(g.voiceLocked, { name: turn.voiceName })");
    expect(form).toContain("g.voiceLockedUnnamed");
    expect(form).toContain("g.voiceSilent");
    expect(form).toContain("g.voiceFromSource");
    expect(form).toContain("g.voiceEngine");
  });

  it("covers every value the column allows, so no source can render blank", () => {
    // If VOICE_SOURCES grows, this fails until the card handles the new one.
    const handled = ["character", "silent", "source"]; // the fourth falls through to voiceEngine
    for (const source of VOICE_SOURCES) {
      expect(handled.includes(source) || source === "engine").toBe(true);
    }
  });
});

describe("the voice copy exists in every language", () => {
  const KEYS = ["voiceLocked", "voiceLockedUnnamed", "voiceSilent", "voiceEngine", "voiceFromSource"];
  for (const lang of ["en", "es", "pt", "it"]) {
    it(`has all five keys in ${lang}`, () => {
      const messages = readFileSync(join(__dirname, `../i18n/messages/${lang}.ts`), "utf8");
      for (const key of KEYS) expect(messages, `${lang}.${key}`).toContain(`${key}: "`);
    });
  }
});

describe("isVoiceSource", () => {
  it("accepts exactly the four the column allows", () => {
    for (const source of VOICE_SOURCES) expect(isVoiceSource(source)).toBe(true);
    // Guards the CHECK constraint in supabase: adding a value here without
    // widening the column would fail every write that used it.
    expect([...VOICE_SOURCES].sort()).toEqual(["character", "engine", "silent", "source"]);
  });

  it("rejects anything else, including near-misses and non-strings", () => {
    for (const bad of ["", "Character", "voice", "none", null, undefined, 3, {}]) {
      expect(isVoiceSource(bad)).toBe(false);
    }
  });
});
