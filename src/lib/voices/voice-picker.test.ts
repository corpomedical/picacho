import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  designBody,
  elevenLabsProblem,
  ElevenLabsError,
  findLibraryVoice,
  isSafeLibraryVoice,
  libraryQuery,
  MIN_NOTICE_DAYS,
  readLibraryVoice,
  searchLibrary,
} from "./elevenlabs";
import {
  canMakeVoices,
  cloneTypeOk,
  designsPerDay,
  openDesignSeal,
  ownVoiceLimit,
  sealDesign,
  voiceName,
} from "./own-voices";
import { CLONE_CONSENT, cloneConsentFor } from "./consent";
import { ownVoiceCard } from "./library-options";

// The voice sheet (operator, 2026-10-01: "Build a full voice picker and
// generator on characters like in Elevenlabs"; his picks: the full library
// limited to safe voices, Generate for Studio + Elite, cloning of one's own
// voice only, the sheet).

const SAFE = {
  voice_id: "AbCdEfGhIjKlMnOpQrSt",
  public_owner_id: "owner123",
  name: "Clara",
  gender: "female",
  age: "young",
  accent: "british",
  language: "en",
  use_case: "conversational",
  descriptive: "calm",
  description: "A calm narrator.",
  preview_url: "https://storage.googleapis.com/eleven-public-prod/u/x/voices/y/z.mp3",
  rate: null,
  fiat_rate: null,
  notice_period: 730,
};

describe("the library query", () => {
  it("always asks for safe voices: normal rate, a year's notice", () => {
    const q = libraryQuery({});
    expect(q.get("include_custom_rates")).toBe("false");
    expect(q.get("min_notice_period_days")).toBe(String(MIN_NOTICE_DAYS));
    expect(q.get("page_size")).toBe("30");
    expect(q.get("page")).toBe("0");
    expect(q.get("sort")).toBe("trending");
  });

  it("passes only the filters we offer, with ElevenLabs' own values", () => {
    const q = libraryQuery({ gender: "female", age: "middle_aged", language: "es", useCase: "narrative_story", sort: "cloned_by_count", accent: " British ", search: "warm", page: 3 });
    expect(q.get("gender")).toBe("female");
    expect(q.get("age")).toBe("middle_aged");
    expect(q.get("language")).toBe("es");
    expect(q.getAll("use_cases")).toEqual(["narrative_story"]);
    expect(q.get("sort")).toBe("cloned_by_count");
    expect(q.get("accent")).toBe("british");
    expect(q.get("search")).toBe("warm");
    expect(q.get("page")).toBe("3");
  });

  it("drops anything else", () => {
    const q = libraryQuery({ gender: "robot", age: "ancient", language: "xx", useCase: "spam", sort: "random", accent: "br<script>", page: -4 });
    for (const k of ["gender", "age", "language", "use_cases", "accent"]) expect(q.has(k)).toBe(false);
    expect(q.get("sort")).toBe("trending");
    expect(q.get("page")).toBe("0");
    expect(libraryQuery({ page: 9999 }).get("page")).toBe("50");
  });
});

describe("a safe library voice", () => {
  it("is at the normal rate with at least a year's notice", () => {
    expect(isSafeLibraryVoice(SAFE)).toBe(true);
    expect(isSafeLibraryVoice({ ...SAFE, rate: 1 })).toBe(true);
  });

  it("is never one with a custom rate, short or no notice, or a strange id", () => {
    expect(isSafeLibraryVoice({ ...SAFE, rate: 2 })).toBe(false);
    expect(isSafeLibraryVoice({ ...SAFE, fiat_rate: 0.5 })).toBe(false);
    expect(isSafeLibraryVoice({ ...SAFE, notice_period: 30 })).toBe(false);
    expect(isSafeLibraryVoice({ ...SAFE, notice_period: null })).toBe(false);
    expect(isSafeLibraryVoice({ ...SAFE, voice_id: "Rachel" })).toBe(false);
  });

  it("keeps a preview only from ElevenLabs' public bucket", () => {
    expect(readLibraryVoice(SAFE).previewUrl).toBe(SAFE.preview_url);
    expect(readLibraryVoice({ ...SAFE, preview_url: "https://evil.example/x.mp3" }).previewUrl).toBeNull();
    const v = readLibraryVoice({ ...SAFE, name: "Cl\u0007ara" });
    expect(v.name).toBe("Cl ara");
    expect(v.noticeDays).toBe(730);
  });
});

describe("talking to ElevenLabs", () => {
  const KEY = process.env.ELEVENLABS_API_KEY;
  beforeEach(() => {
    process.env.ELEVENLABS_API_KEY = "test-key";
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    if (KEY === undefined) delete process.env.ELEVENLABS_API_KEY;
    else process.env.ELEVENLABS_API_KEY = KEY;
  });

  it("returns only the safe voices of a page, read", async () => {
    const calls: string[] = [];
    vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
      calls.push(url);
      expect((init.headers as Record<string, string>)["xi-api-key"]).toBe("test-key");
      return new Response(JSON.stringify({ voices: [SAFE, { ...SAFE, voice_id: "ZyXwVuTsRqPoNmLkJiHg", rate: 3 }], has_more: true }));
    });
    const r = await searchLibrary({ language: "en" });
    expect(r.voices.map((v) => v.voiceId)).toEqual([SAFE.voice_id]);
    expect(r.hasMore).toBe(true);
    expect(calls[0]).toContain("/v1/shared-voices?");
    expect(calls[0]).toContain("include_custom_rates=false");
  });

  it("checks a chosen voice against the library itself, by its owner", async () => {
    let asked = "";
    vi.stubGlobal("fetch", async (url: string) => {
      asked = url;
      return new Response(JSON.stringify({ voices: [SAFE] }));
    });
    expect((await findLibraryVoice(SAFE.voice_id, "owner123", "Clara"))?.voiceId).toBe(SAFE.voice_id);
    expect(asked).toContain("owner_id=owner123");
    // Not in the answer: not a library voice we may use.
    expect(await findLibraryVoice("ZyXwVuTsRqPoNmLkJiHg", "owner123", "Clara")).toBeNull();
    // A malformed id never reaches ElevenLabs.
    asked = "";
    expect(await findLibraryVoice("../../v1/voices", "owner123", "Clara")).toBeNull();
    expect(asked).toBe("");
  });

  it("reads ElevenLabs' refusals into what the sheet can say", async () => {
    vi.stubGlobal("fetch", async () =>
      new Response(JSON.stringify({ detail: { status: "missing_permissions", message: "missing voices_read" } }), { status: 401 }),
    );
    const err = await searchLibrary({}).catch((e) => e);
    expect(err).toBeInstanceOf(ElevenLabsError);
    expect(elevenLabsProblem(err)).toBe("setup");
    expect(elevenLabsProblem(new ElevenLabsError("voice_limit_reached", 400, "voice_limit_reached"))).toBe("slots");
    expect(elevenLabsProblem(new ElevenLabsError("busy", 409, "409"))).toBe("busy");
    expect(elevenLabsProblem(new ElevenLabsError("bad", 422, "422"))).toBe("refused");
    expect(elevenLabsProblem(new Error("x"))).toBe("failed");
  });
});

describe("Voice Design", () => {
  it("asks for the v3 design model and lets ElevenLabs write the sample when none is given", () => {
    expect(designBody(" A warm voice ", null)).toEqual({ voice_description: "A warm voice", model_id: "eleven_ttv_v3", auto_generate_text: true });
    expect(designBody("A warm voice", " Hello there ")).toEqual({ voice_description: "A warm voice", model_id: "eleven_ttv_v3", text: "Hello there" });
  });
});

describe("who may make voices, and how many", () => {
  it("is Studio and Elite (and admins), as he picked", () => {
    for (const plan of ["none", "basic", "starter", "growth", null]) expect(canMakeVoices(plan, false)).toBe(false);
    expect(canMakeVoices("studio", false)).toBe(true);
    expect(canMakeVoices("elite", false)).toBe(true);
    expect(canMakeVoices("basic", true)).toBe(true);
  });

  it("keeps a few per account, more on Elite, none below Studio", () => {
    expect(ownVoiceLimit("studio", false)).toBe(5);
    expect(ownVoiceLimit("elite", false)).toBe(10);
    expect(ownVoiceLimit("growth", false)).toBe(0);
    expect(designsPerDay("studio", false)).toBeGreaterThan(0);
    expect(designsPerDay("starter", false)).toBe(0);
  });

  it("names a voice sensibly", () => {
    expect(voiceName("  Clara\n  the\tgreat ", "x")).toBe("Clara the great");
    expect(voiceName("", "My voice")).toBe("My voice");
    expect(voiceName("a".repeat(80), "x")).toHaveLength(40);
  });

  it("takes only audio recordings for a clone", () => {
    expect(cloneTypeOk("audio/mpeg")).toBe(true);
    expect(cloneTypeOk("audio/webm;codecs=opus")).toBe(true);
    expect(cloneTypeOk("video/mp4")).toBe(false);
    expect(cloneTypeOk("application/pdf")).toBe(false);
  });
});

describe("the seal on a generated voice", () => {
  const SECRET = process.env.MEDIA_SIGNING_SECRET;
  beforeEach(() => {
    process.env.MEDIA_SIGNING_SECRET = "test-secret";
  });
  afterEach(() => {
    if (SECRET === undefined) delete process.env.MEDIA_SIGNING_SECRET;
    else process.env.MEDIA_SIGNING_SECRET = SECRET;
  });

  it("opens for the person, the option and the description it was made for, for an hour", () => {
    const now = 1_000_000_000;
    const seal = sealDesign("user-1", "gen-1", "A warm voice", now);
    expect(openDesignSeal(seal, "user-1", "gen-1", "A warm voice", now + 59 * 60_000)).toBe(true);
    expect(openDesignSeal(seal, "user-2", "gen-1", "A warm voice", now)).toBe(false);
    expect(openDesignSeal(seal, "user-1", "gen-2", "A warm voice", now)).toBe(false);
    expect(openDesignSeal(seal, "user-1", "gen-1", "A cold voice", now)).toBe(false);
    expect(openDesignSeal(seal, "user-1", "gen-1", "A warm voice", now + 61 * 60_000)).toBe(false);
    expect(openDesignSeal("garbage", "user-1", "gen-1", "A warm voice", now)).toBe(false);
    expect(openDesignSeal(undefined, "user-1", "gen-1", "A warm voice", now)).toBe(false);
  });
});

describe("the consent to a clone", () => {
  it("exists in all four languages and falls back to English", () => {
    expect(Object.keys(CLONE_CONSENT).sort()).toEqual(["en", "es", "it", "pt"]);
    expect(cloneConsentFor("es")).toBe(CLONE_CONSENT.es);
    expect(cloneConsentFor("fr")).toBe(CLONE_CONSENT.en);
    expect(cloneConsentFor(undefined)).toBe(CLONE_CONSENT.en);
  });
});

describe("a person's own voice on the character card", () => {
  it("reads the row's source and what the library said", () => {
    expect(
      ownVoiceCard({ id: "p1", label: "Clara", description: null, source: "library", attributes: { gender: "female", age: "middle_aged", accent: "british", language: "en" } }),
    ).toEqual({ id: "p1", label: "Clara", description: null, source: "library", meta: "female · middle aged · british · en" });
    expect(ownVoiceCard({ id: "p2", label: "Me", description: null, source: "cloned", attributes: null }).meta).toBe("");
  });
});

describe("the wiring", () => {
  const read = (p: string) => readFileSync(join(__dirname, "../..", p), "utf8");

  it("keeps every curated list curated: a person's own voices never become someone else's choice", () => {
    expect(read("lib/characters/actions.ts")).toContain('.is("owner_id", null)');
    expect(read("lib/producer/store.ts")).toContain('.is("owner_id", null)');
    expect(read("lib/producer/actions.ts").match(/\.is\("owner_id", null\)/g)?.length).toBe(2);
    expect(read("app/app/character/new/page.tsx")).toContain('.is("owner_id", null)');
    expect(read("app/app/character/[id]/page.tsx")).toContain('.is("owner_id", null)');
    expect(read("app/admin/voices/page.tsx")).toContain('.is("owner_id", null)');
  });

  it("deletes an account's own voices at ElevenLabs on both deletion paths", () => {
    expect(read("lib/profile/actions.ts")).toContain("await deleteUserVoices(admin, userId);");
    expect(read("lib/admin/actions.ts")).toContain("await deleteUserVoices(admin, userId);");
  });

  it("allows library previews in the page's media policy, path-limited", () => {
    expect(readFileSync(join(__dirname, "../../..", "middleware.ts"), "utf8")).toContain("https://storage.googleapis.com/eleven-public-prod/`");
  });

  it("checks plan, seal, slots and consent on the server before any voice is made", () => {
    const a = read("lib/voices/picker-actions.ts");
    expect(a).toContain('if (!canMakeVoices(g.plan, g.isAdmin)) return { ok: false, error: "studio" };');
    expect(a).toContain('if (!openDesignSeal(input?.seal, g.userId, generatedVoiceId, description)) return { ok: false, error: "seal" };');
    expect(a.match(/>= ownVoiceLimit\(g\.plan, g\.isAdmin\)\) return \{ ok: false, error: "full" \}/g)?.length).toBe(2);
    expect(a).toContain('if (formData.get("consent") !== "yes") return { ok: false, error: "consent" };');
    // A voice the database couldn't record is removed from ElevenLabs, so no slot is lost.
    expect(a.match(/await deleteVoice\(voiceId\)\.catch/g)?.length).toBe(2);
    // A voice a character speaks in can't be removed.
    expect(a).toContain('return { ok: false, error: "inUse" };');
  });
});
