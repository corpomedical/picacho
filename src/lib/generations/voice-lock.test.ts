import { describe, expect, it } from "vitest";
import {
  assignedVoiceFor,
  isVoiceSource,
  voiceRecord,
  VOICE_SOURCES,
  type VoicePreset,
  type VoiceSettings,
} from "./voice-lock";

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

describe("isVoiceSource", () => {
  it("accepts exactly the three the column allows", () => {
    for (const source of VOICE_SOURCES) expect(isVoiceSource(source)).toBe(true);
    expect(VOICE_SOURCES).toHaveLength(3);
  });

  it("rejects anything else, including near-misses and non-strings", () => {
    for (const bad of ["", "Character", "voice", "none", null, undefined, 3, {}]) {
      expect(isVoiceSource(bad)).toBe(false);
    }
  });
});
