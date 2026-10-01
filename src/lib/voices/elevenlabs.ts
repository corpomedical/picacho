// ElevenLabs' voice catalogue, straight from ElevenLabs (2026-10-01,
// operator: "Build a full voice picker and generator on characters like in
// Elevenlabs"). fal hosts ElevenLabs' speech but none of this — the library,
// Voice Design and cloning are only on ElevenLabs' own API — so these calls
// use ELEVENLABS_API_KEY, which needs the Voices (read + write) permission
// as well as Text to Speech.
//
// Read at source on 2026-10-01 (elevenlabs.io/docs):
// - GET /v1/shared-voices: page_size ≤ 100, page, gender, age, accent,
//   language, locale, search, use_cases, sort (created_date,
//   usage_character_count_1y, trending, cloned_by_count), featured,
//   include_custom_rates, min_notice_period_days, owner_id. Each voice has
//   public_owner_id, voice_id, name, accent, gender, age, descriptive,
//   use_case, language, description, preview_url, rate, notice_period,
//   free_users_allowed. "Voices saved from the Voice Library do not take up
//   your custom voice slots", and a library voice is used by its id.
// - POST /v1/text-to-voice/design: voice_description, model_id
//   (eleven_multilingual_ttv_v2 | eleven_ttv_v3), text (100–1,000 chars) or
//   auto_generate_text; returns previews [{ audio_base_64,
//   generated_voice_id, media_type, duration_secs, language }] and the text.
//   "The only charge for using voice design is the number of credits to
//   generate your preview text, which you are only charged once even though
//   we are generating three samples."
// - POST /v1/text-to-voice: voice_name, voice_description,
//   generated_voice_id, labels → { voice_id }. Takes a custom voice slot
//   (Free 3, Starter 10, Creator 30, Pro 160, Scale/Business 660) and a
//   voice operation (Starter 65 a month … Scale 1,040).
// - POST /v1/voices/add (multipart): name, files, remove_background_noise,
//   description, labels → { voice_id }. A slot and an operation too.
// - DELETE /v1/voices/{voice_id} frees the slot.
//
// Server-only. The pure helpers (query, reading, the safety rule, bodies)
// are exported for tests.

// ELEVENLABS_API_BASE exists only for the local mock rig (a stand-in that
// answers the library and Voice Design with sample data); production never
// sets it.
const API = process.env.ELEVENLABS_API_BASE || "https://api.elevenlabs.io";

/** A library voice may be withdrawn by its owner after its notice period; we only offer ones with at least a year. */
export const MIN_NOTICE_DAYS = 365;
export const LIBRARY_PAGE_SIZE = 30;

export { AGES, GENDERS, LANGUAGES, SORTS, USE_CASES } from "./library-options";
import { AGES, GENDERS, LANGUAGES, SORTS, USE_CASES } from "./library-options";

export type LibraryFilters = {
  search?: string;
  gender?: string;
  age?: string;
  accent?: string;
  language?: string;
  useCase?: string;
  sort?: string;
  page?: number;
};

export type LibraryVoice = {
  voiceId: string;
  publicOwnerId: string;
  name: string;
  gender: string;
  age: string;
  accent: string;
  language: string;
  useCase: string;
  descriptive: string;
  description: string;
  previewUrl: string | null;
  noticeDays: number | null;
};

const pick = <T extends readonly string[]>(list: T, v: unknown): T[number] | undefined =>
  typeof v === "string" && (list as readonly string[]).includes(v) ? (v as T[number]) : undefined;

const clean = (v: unknown, max: number) =>
  typeof v === "string" ? v.replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, max) : "";

/** The query for one page of the library: only the filters we offer, always the safe ones. */
export function libraryQuery(f: LibraryFilters): URLSearchParams {
  const q = new URLSearchParams();
  q.set("page_size", String(LIBRARY_PAGE_SIZE));
  q.set("page", String(Math.max(0, Math.min(50, Math.floor(Number(f.page) || 0)))));
  q.set("include_custom_rates", "false");
  q.set("min_notice_period_days", String(MIN_NOTICE_DAYS));
  q.set("sort", pick(SORTS, f.sort) ?? "trending");
  const search = clean(f.search, 80);
  if (search) q.set("search", search);
  const gender = pick(GENDERS, f.gender);
  if (gender) q.set("gender", gender);
  const age = pick(AGES, f.age);
  if (age) q.set("age", age);
  const language = pick(LANGUAGES, f.language);
  if (language) q.set("language", language);
  const useCase = pick(USE_CASES, f.useCase);
  if (useCase) q.append("use_cases", useCase);
  const accent = clean(f.accent, 40).toLowerCase();
  if (accent && /^[a-z -]+$/.test(accent)) q.set("accent", accent);
  return q;
}

/** Previews come from ElevenLabs' public bucket; anything else is dropped (the page's CSP allows only this). */
export const PREVIEW_URL_PREFIX = "https://storage.googleapis.com/eleven-public-prod/";

/**
 * A library voice we may offer: the normal rate (no custom rate or
 * multiplier), at least a year's notice before its owner can withdraw it,
 * and usable on a paid plan. The query already asks for this; it is checked
 * again on every voice, and again when one is chosen.
 */
export function isSafeLibraryVoice(raw: Record<string, unknown>): boolean {
  const rate = raw.rate;
  if (rate !== null && rate !== undefined && Number(rate) !== 1) return false;
  if (raw.fiat_rate !== null && raw.fiat_rate !== undefined) return false;
  const notice = raw.notice_period;
  if (typeof notice !== "number" || notice < MIN_NOTICE_DAYS) return false;
  return typeof raw.voice_id === "string" && /^[A-Za-z0-9]{20}$/.test(raw.voice_id) && typeof raw.public_owner_id === "string";
}

export function readLibraryVoice(raw: Record<string, unknown>): LibraryVoice {
  const preview = typeof raw.preview_url === "string" && raw.preview_url.startsWith(PREVIEW_URL_PREFIX) ? raw.preview_url : null;
  return {
    voiceId: String(raw.voice_id),
    publicOwnerId: clean(raw.public_owner_id, 100),
    name: clean(raw.name, 60) || "Voice",
    gender: clean(raw.gender, 20),
    age: clean(raw.age, 20),
    accent: clean(raw.accent, 40),
    language: clean(raw.language, 10),
    useCase: clean(raw.use_case, 40),
    descriptive: clean(raw.descriptive, 40),
    description: clean(raw.description, 300),
    previewUrl: preview,
    noticeDays: typeof raw.notice_period === "number" ? raw.notice_period : null,
  };
}

export class ElevenLabsError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string,
  ) {
    super(message);
  }
}

function key(): string {
  const k = process.env.ELEVENLABS_API_KEY;
  if (!k) throw new ElevenLabsError("ELEVENLABS_API_KEY is not set", 0, "no_key");
  return k;
}

async function call(path: string, init: RequestInit & { timeoutMs?: number } = {}): Promise<unknown> {
  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: { "xi-api-key": key(), ...(init.headers ?? {}) },
    signal: AbortSignal.timeout(init.timeoutMs ?? 30_000),
  });
  const text = await res.text();
  let body: unknown = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  if (!res.ok) {
    const d = (body as { detail?: unknown })?.detail;
    const detail = (typeof d === "object" && d ? d : {}) as { status?: unknown; code?: unknown; message?: unknown };
    const code = String(detail.status ?? detail.code ?? res.status);
    const message = String(detail.message ?? (typeof d === "string" ? d : text)).slice(0, 300);
    throw new ElevenLabsError(message, res.status, code);
  }
  return body;
}

export async function searchLibrary(f: LibraryFilters): Promise<{ voices: LibraryVoice[]; hasMore: boolean }> {
  const body = (await call(`/v1/shared-voices?${libraryQuery(f)}`)) as { voices?: unknown; has_more?: unknown };
  const raw = Array.isArray(body?.voices) ? (body.voices as Record<string, unknown>[]) : [];
  return { voices: raw.filter(isSafeLibraryVoice).map(readLibraryVoice), hasMore: body?.has_more === true };
}

/**
 * The library's own record of one voice, found by its owner and name, or
 * null: what a choice is checked against, so a page can't save any voice id
 * it likes (another account's private clone, a voice with a custom rate).
 */
export async function findLibraryVoice(voiceId: string, publicOwnerId: string, name: string): Promise<LibraryVoice | null> {
  if (!/^[A-Za-z0-9]{20}$/.test(voiceId) || !/^[A-Za-z0-9_-]{1,100}$/.test(publicOwnerId)) return null;
  const q = new URLSearchParams({ page_size: "100", owner_id: publicOwnerId });
  const search = clean(name, 80);
  if (search) q.set("search", search);
  const body = (await call(`/v1/shared-voices?${q}`)) as { voices?: unknown };
  const raw = Array.isArray(body?.voices) ? (body.voices as Record<string, unknown>[]) : [];
  const hit = raw.find((v) => v.voice_id === voiceId);
  return hit && isSafeLibraryVoice(hit) ? readLibraryVoice(hit) : null;
}

// ---- Voice Design --------------------------------------------------------

export const DESIGN_MODEL = "eleven_ttv_v3";
export { DESCRIPTION_MAX, DESCRIPTION_MIN, PREVIEW_TEXT_MAX, PREVIEW_TEXT_MIN } from "./library-options";

export function designBody(description: string, previewText: string | null) {
  const text = previewText ? previewText.trim() : "";
  return {
    voice_description: description.trim(),
    model_id: DESIGN_MODEL,
    ...(text ? { text } : { auto_generate_text: true }),
  };
}

export type DesignPreview = { generatedVoiceId: string; audioBase64: string; mediaType: string; durationSecs: number };

export async function designVoice(description: string, previewText: string | null): Promise<{ text: string; previews: DesignPreview[] }> {
  const body = (await call(`/v1/text-to-voice/design?output_format=mp3_44100_64`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(designBody(description, previewText)),
    timeoutMs: 90_000,
  })) as { text?: unknown; previews?: unknown };
  const previews = (Array.isArray(body?.previews) ? (body.previews as Record<string, unknown>[]) : [])
    .filter((p) => typeof p.generated_voice_id === "string" && typeof p.audio_base_64 === "string")
    .map((p) => ({
      generatedVoiceId: String(p.generated_voice_id),
      audioBase64: String(p.audio_base_64),
      mediaType: typeof p.media_type === "string" ? p.media_type : "audio/mpeg",
      durationSecs: Number(p.duration_secs) || 0,
    }));
  return { text: typeof body?.text === "string" ? body.text : "", previews };
}

export async function keepDesignedVoice(generatedVoiceId: string, name: string, description: string): Promise<string> {
  const body = (await call(`/v1/text-to-voice`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      voice_name: name,
      voice_description: description,
      generated_voice_id: generatedVoiceId,
      labels: { app: "picacho" },
    }),
  })) as { voice_id?: unknown };
  if (typeof body?.voice_id !== "string") throw new ElevenLabsError("no voice_id in the answer", 200, "bad_answer");
  return body.voice_id;
}

// ---- Cloning (the person's own voice) ------------------------------------

export async function cloneVoice(name: string, description: string, file: Blob, filename: string): Promise<string> {
  const form = new FormData();
  form.set("name", name);
  form.set("description", description);
  form.set("remove_background_noise", "true");
  form.set("labels", JSON.stringify({ app: "picacho", kind: "own-voice" }));
  form.append("files", file, filename);
  const body = (await call(`/v1/voices/add`, { method: "POST", body: form, timeoutMs: 120_000 })) as { voice_id?: unknown };
  if (typeof body?.voice_id !== "string") throw new ElevenLabsError("no voice_id in the answer", 200, "bad_answer");
  return body.voice_id;
}

export async function deleteVoice(voiceId: string): Promise<void> {
  if (!/^[A-Za-z0-9]{20}$/.test(voiceId)) return;
  try {
    await call(`/v1/voices/${voiceId}`, { method: "DELETE" });
  } catch (err) {
    // Already gone is gone.
    if (err instanceof ElevenLabsError && err.status === 404) return;
    throw err;
  }
}

/** What to tell a person when ElevenLabs refuses: the key's permissions are ours to fix, not theirs. */
export function elevenLabsProblem(err: unknown): "setup" | "slots" | "busy" | "refused" | "failed" {
  if (!(err instanceof ElevenLabsError)) return "failed";
  if (err.code === "no_key" || err.code === "missing_permissions" || err.status === 401) return "setup";
  if (/voice_limit|voice_add_edit_limit|slot/i.test(`${err.code} ${err.message}`)) return "slots";
  if (err.status === 409 || err.status === 429) return "busy";
  if (err.status === 400 || err.status === 422) return "refused";
  return "failed";
}
