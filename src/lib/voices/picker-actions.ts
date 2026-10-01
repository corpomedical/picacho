"use server";

// The voice sheet's server side (2026-10-01, operator: "Build a full voice
// picker and generator on characters like in Elevenlabs"; his picks: the
// full library limited to safe voices, Generate for Studio + Elite, cloning
// of the person's own voice only, the voice sheet).
//
// Every answer is { ok } or { error: code }: the sheet words the code in the
// person's language. A voice a person picks, generates or clones becomes a
// voice_presets row they own (supabase/pending/character-voices.sql); the
// character form saves its id as today, and the save's existing check reads
// it through the person's own client, so only their own voices pass.

import { createAdminClient, createClient } from "@/lib/supabase/server";
import { dailyCapReached, rateLimited } from "@/lib/rate-limit";
import { planInGoodStanding } from "@/lib/plans";
import {
  cloneVoice,
  deleteVoice,
  DESCRIPTION_MAX,
  DESCRIPTION_MIN,
  designVoice,
  elevenLabsProblem,
  findLibraryVoice,
  keepDesignedVoice,
  PREVIEW_TEXT_MAX,
  PREVIEW_TEXT_MIN,
  searchLibrary,
  type LibraryFilters,
  type LibraryVoice,
} from "./elevenlabs";
import {
  canMakeVoices,
  CLONE_MAX_BYTES,
  CLONES_PER_DAY,
  cloneTypeOk,
  designsPerDay,
  LIBRARY_PICK_LIMIT,
  openDesignSeal,
  ownVoiceLimit,
  sealDesign,
  voiceName,
  type VoiceSource,
} from "./own-voices";
import { cloneConsentFor } from "./consent";

export type VoiceErrorCode =
  | "signin"
  | "suspended"
  | "paid"
  | "payment"
  | "studio"
  | "rate"
  | "day"
  | "setup"
  | "slots"
  | "busy"
  | "refused"
  | "failed"
  | "full"
  | "libraryFull"
  | "inUse"
  | "notFound"
  | "consent"
  | "fileType"
  | "fileSize"
  | "description"
  | "previewText"
  | "seal";

type Fail = { ok: false; error: VoiceErrorCode };

export type OwnVoice = {
  id: string;
  label: string;
  description: string | null;
  source: VoiceSource;
  gender: string;
  age: string;
  accent: string;
  language: string;
  useCase: string;
  previewUrl: string | null;
};

type Gate = { userId: string; plan: string; isAdmin: boolean };

async function gate(): Promise<Gate | Fail> {
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  if (!data.user) return { ok: false, error: "signin" };
  const { data: profile } = await supabase
    .from("profiles")
    .select("plan, plan_status, role, status")
    .eq("id", data.user.id)
    .single();
  const isAdmin = profile?.role === "admin";
  if (profile?.status === "suspended") return { ok: false, error: "suspended" };
  const plan = (profile?.plan as string | null) ?? "none";
  if (plan === "none" && !isAdmin) return { ok: false, error: "paid" };
  if (!planInGoodStanding(profile?.plan_status) && !isAdmin) return { ok: false, error: "payment" };
  return { userId: data.user.id, plan, isAdmin };
}

const failed = (g: Gate | Fail): g is Fail => "ok" in g;

function rowToVoice(r: Record<string, unknown>): OwnVoice {
  const a = (r.attributes && typeof r.attributes === "object" ? r.attributes : {}) as Record<string, unknown>;
  const s = (k: string) => (typeof a[k] === "string" ? (a[k] as string) : "");
  return {
    id: String(r.id),
    label: String(r.label ?? ""),
    description: typeof r.description === "string" ? r.description : null,
    source: (["curated", "library", "designed", "cloned"].includes(String(r.source)) ? r.source : "curated") as VoiceSource,
    gender: s("gender"),
    age: s("age"),
    accent: s("accent"),
    language: s("language"),
    useCase: s("useCase"),
    previewUrl: s("previewUrl") || null,
  };
}

const VOICE_COLUMNS = "id, label, description, source, attributes, elevenlabs_voice_id";

// ---- Library ------------------------------------------------------------

export async function browseVoiceLibrary(
  filters: LibraryFilters,
): Promise<{ ok: true; voices: LibraryVoice[]; hasMore: boolean } | Fail> {
  const g = await gate();
  if (failed(g)) return g;
  if (await rateLimited(g.userId, "voice-library", 60, 40)) return { ok: false, error: "rate" };
  try {
    const { voices, hasMore } = await searchLibrary(filters ?? {});
    return { ok: true, voices, hasMore };
  } catch (err) {
    console.error("voice library search failed:", err);
    return { ok: false, error: elevenLabsProblem(err) };
  }
}

export async function chooseLibraryVoice(input: {
  voiceId: string;
  publicOwnerId: string;
  name: string;
}): Promise<{ ok: true; voice: OwnVoice } | Fail> {
  const g = await gate();
  if (failed(g)) return g;
  if (await rateLimited(g.userId, "voice-choose", 60, 20)) return { ok: false, error: "rate" };
  const admin = createAdminClient();

  const voiceId = String(input?.voiceId ?? "");
  // Already picked: the same row again.
  const { data: existing } = await admin
    .from("voice_presets")
    .select(VOICE_COLUMNS)
    .eq("owner_id", g.userId)
    .eq("elevenlabs_voice_id", voiceId)
    .maybeSingle();
  if (existing) return { ok: true, voice: rowToVoice(existing) };

  const { count } = await admin
    .from("voice_presets")
    .select("id", { count: "exact", head: true })
    .eq("owner_id", g.userId)
    .eq("source", "library");
  if ((count ?? 0) >= LIBRARY_PICK_LIMIT) return { ok: false, error: "libraryFull" };

  let found: LibraryVoice | null;
  try {
    found = await findLibraryVoice(voiceId, String(input?.publicOwnerId ?? ""), String(input?.name ?? ""));
  } catch (err) {
    console.error("voice library lookup failed:", err);
    return { ok: false, error: elevenLabsProblem(err) };
  }
  if (!found) return { ok: false, error: "notFound" };

  const describe = [found.descriptive, found.accent, found.useCase.replace(/_/g, " ")].filter(Boolean).join(", ");
  const { data: row, error } = await admin
    .from("voice_presets")
    .insert({
      owner_id: g.userId,
      source: "library",
      label: voiceName(found.name, "Voice"),
      description: describe || null,
      elevenlabs_voice_id: found.voiceId,
      sort_order: 0,
      attributes: {
        gender: found.gender,
        age: found.age,
        accent: found.accent,
        language: found.language,
        useCase: found.useCase,
        previewUrl: found.previewUrl,
        publicOwnerId: found.publicOwnerId,
        noticeDays: found.noticeDays,
      },
    })
    .select(VOICE_COLUMNS)
    .single();
  if (error || !row) {
    console.error("couldn't save a library voice:", error?.message);
    return { ok: false, error: "failed" };
  }
  return { ok: true, voice: rowToVoice(row) };
}

// ---- My voices ----------------------------------------------------------

export async function listMyVoices(): Promise<
  { ok: true; voices: OwnVoice[]; canMake: boolean; made: number; limit: number } | Fail
> {
  const g = await gate();
  if (failed(g)) return g;
  const supabase = await createClient();
  const { data } = await supabase
    .from("voice_presets")
    .select(VOICE_COLUMNS)
    .eq("owner_id", g.userId)
    .order("created_at", { ascending: false });
  const voices = (data ?? []).map(rowToVoice);
  return {
    ok: true,
    voices,
    canMake: canMakeVoices(g.plan, g.isAdmin),
    made: voices.filter((v) => v.source === "designed" || v.source === "cloned").length,
    limit: ownVoiceLimit(g.plan, g.isAdmin),
  };
}

async function madeCount(userId: string): Promise<number> {
  const { count } = await createAdminClient()
    .from("voice_presets")
    .select("id", { count: "exact", head: true })
    .eq("owner_id", userId)
    .in("source", ["designed", "cloned"]);
  return count ?? 0;
}

export async function removeMyVoice(presetId: string): Promise<{ ok: true } | Fail> {
  const g = await gate();
  if (failed(g)) return g;
  const admin = createAdminClient();
  const { data: row } = await admin
    .from("voice_presets")
    .select("id, source, elevenlabs_voice_id")
    .eq("id", String(presetId ?? ""))
    .eq("owner_id", g.userId)
    .maybeSingle();
  if (!row) return { ok: false, error: "notFound" };
  // A character speaking in it would lose its voice: change theirs first.
  const { count } = await admin
    .from("character_profiles")
    .select("id", { count: "exact", head: true })
    .eq("voice_id", row.id);
  if ((count ?? 0) > 0) return { ok: false, error: "inUse" };
  if (row.source === "designed" || row.source === "cloned") {
    try {
      await deleteVoice(row.elevenlabs_voice_id as string);
    } catch (err) {
      console.error("couldn't delete a voice from ElevenLabs:", err);
      return { ok: false, error: elevenLabsProblem(err) };
    }
  }
  const { error } = await admin.from("voice_presets").delete().eq("id", row.id).eq("owner_id", g.userId);
  if (error) return { ok: false, error: "failed" };
  return { ok: true };
}

// ---- Generate (Voice Design) --------------------------------------------

export type DesignOption = { generatedVoiceId: string; seal: string; audioBase64: string; mediaType: string; durationSecs: number };

export async function generateVoiceOptions(input: {
  description: string;
  previewText?: string | null;
}): Promise<{ ok: true; text: string; options: DesignOption[] } | Fail> {
  const g = await gate();
  if (failed(g)) return g;
  if (!canMakeVoices(g.plan, g.isAdmin)) return { ok: false, error: "studio" };
  const description = String(input?.description ?? "").trim();
  if (description.length < DESCRIPTION_MIN || description.length > DESCRIPTION_MAX) return { ok: false, error: "description" };
  const previewText = String(input?.previewText ?? "").trim() || null;
  if (previewText && (previewText.length < PREVIEW_TEXT_MIN || previewText.length > PREVIEW_TEXT_MAX)) {
    return { ok: false, error: "previewText" };
  }
  if (await rateLimited(g.userId, "voice-design", 60, 4)) return { ok: false, error: "rate" };
  if (await dailyCapReached(g.userId, "voice-design", designsPerDay(g.plan, g.isAdmin))) return { ok: false, error: "day" };
  try {
    const { text, previews } = await designVoice(description, previewText);
    if (previews.length === 0) return { ok: false, error: "refused" };
    return {
      ok: true,
      text,
      options: previews.map((p) => ({ ...p, seal: sealDesign(g.userId, p.generatedVoiceId, description) })),
    };
  } catch (err) {
    console.error("voice design failed:", err);
    return { ok: false, error: elevenLabsProblem(err) };
  }
}

export async function keepGeneratedVoice(input: {
  generatedVoiceId: string;
  seal: string;
  description: string;
  name: string;
}): Promise<{ ok: true; voice: OwnVoice } | Fail> {
  const g = await gate();
  if (failed(g)) return g;
  if (!canMakeVoices(g.plan, g.isAdmin)) return { ok: false, error: "studio" };
  const description = String(input?.description ?? "").trim();
  const generatedVoiceId = String(input?.generatedVoiceId ?? "");
  if (!openDesignSeal(input?.seal, g.userId, generatedVoiceId, description)) return { ok: false, error: "seal" };
  if (await rateLimited(g.userId, "voice-keep", 60, 5)) return { ok: false, error: "rate" };
  if ((await madeCount(g.userId)) >= ownVoiceLimit(g.plan, g.isAdmin)) return { ok: false, error: "full" };

  const name = voiceName(input?.name, "My voice");
  let voiceId: string;
  try {
    voiceId = await keepDesignedVoice(generatedVoiceId, name, description.slice(0, 500));
  } catch (err) {
    console.error("keeping a designed voice failed:", err);
    return { ok: false, error: elevenLabsProblem(err) };
  }
  const { data: row, error } = await createAdminClient()
    .from("voice_presets")
    .insert({
      owner_id: g.userId,
      source: "designed",
      label: name,
      description: description.slice(0, 300),
      elevenlabs_voice_id: voiceId,
      sort_order: 0,
      attributes: { prompt: description },
    })
    .select(VOICE_COLUMNS)
    .single();
  if (error || !row) {
    // Never leave a slot taken by a voice nobody can reach.
    console.error("couldn't save a designed voice; removing it from ElevenLabs:", error?.message);
    await deleteVoice(voiceId).catch(() => {});
    return { ok: false, error: "failed" };
  }
  return { ok: true, voice: rowToVoice(row) };
}

// ---- Clone (the person's own voice) -------------------------------------

export async function cloneMyVoice(formData: FormData): Promise<{ ok: true; voice: OwnVoice } | Fail> {
  const g = await gate();
  if (failed(g)) return g;
  if (!canMakeVoices(g.plan, g.isAdmin)) return { ok: false, error: "studio" };
  if (formData.get("consent") !== "yes") return { ok: false, error: "consent" };
  const file = formData.get("recording");
  if (!(file instanceof Blob) || file.size === 0) return { ok: false, error: "fileType" };
  if (!cloneTypeOk(file.type)) return { ok: false, error: "fileType" };
  if (file.size > CLONE_MAX_BYTES) return { ok: false, error: "fileSize" };
  if (await rateLimited(g.userId, "voice-clone", 60, 2)) return { ok: false, error: "rate" };
  if (await dailyCapReached(g.userId, "voice-clone", CLONES_PER_DAY)) return { ok: false, error: "day" };
  if ((await madeCount(g.userId)) >= ownVoiceLimit(g.plan, g.isAdmin)) return { ok: false, error: "full" };

  const name = voiceName(formData.get("name"), "My own voice");
  const filename = (file as File).name?.replace(/[^\w.-]/g, "_").slice(0, 60) || "recording";
  let voiceId: string;
  try {
    voiceId = await cloneVoice(name, "A Picacho user's own voice, cloned with their consent.", file, filename);
  } catch (err) {
    console.error("cloning a voice failed:", err);
    return { ok: false, error: elevenLabsProblem(err) };
  }
  const { data: row, error } = await createAdminClient()
    .from("voice_presets")
    .insert({
      owner_id: g.userId,
      source: "cloned",
      label: name,
      description: null,
      elevenlabs_voice_id: voiceId,
      sort_order: 0,
      attributes: {},
      consent_at: new Date().toISOString(),
      consent_text: cloneConsentFor(formData.get("locale")),
    })
    .select(VOICE_COLUMNS)
    .single();
  if (error || !row) {
    console.error("couldn't save a cloned voice; removing it from ElevenLabs:", error?.message);
    await deleteVoice(voiceId).catch(() => {});
    return { ok: false, error: "failed" };
  }
  return { ok: true, voice: rowToVoice(row) };
}
