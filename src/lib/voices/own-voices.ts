// The rules for a person's own voices (2026-10-01, operator: "Build a full
// voice picker and generator on characters like in Elevenlabs"; his picks:
// Generate for "Studio + Elite only", cloning "Own voice only").
//
// Library voices cost us nothing to keep (they take no slot in our
// ElevenLabs account), so every paid plan may pick them. A generated or
// cloned voice takes one of the account's custom voice slots (Starter 10 …
// Pro 160 … Scale 660), shared by every Picacho user — so making one is for
// Studio and Elite, and each account keeps a few.
//
// Pure, apart from the seal (node:crypto): the actions and the page share it.

import { createHmac, timingSafeEqual } from "node:crypto";
import { advancedVideoPlan } from "../plans";

/** Generated + cloned voices one account may keep at a time. */
export const OWN_VOICE_LIMITS: Record<string, number> = { studio: 5, elite: 10 };
/** Library voices one account may have picked (no slot cost; a bound on rows). */
export const LIBRARY_PICK_LIMIT = 60;
/** Generations (each three options) one account may run in a rolling day. */
export const DESIGNS_PER_DAY: Record<string, number> = { studio: 10, elite: 20 };
export const CLONES_PER_DAY = 3;
/** A clone's recording: ElevenLabs needs ~10 s at least and recommends 1–2 min. */
export const CLONE_MAX_BYTES = 10 * 1024 * 1024;
export const CLONE_TYPES = ["audio/mpeg", "audio/mp3", "audio/wav", "audio/x-wav", "audio/wave", "audio/mp4", "audio/x-m4a", "audio/m4a", "audio/webm", "audio/ogg"];

export type VoiceSource = "curated" | "library" | "designed" | "cloned";

/**
 * Whether this plan may make voices (generate or clone): Studio and Elite,
 * and admins — exactly the advanced-video rule, so it is asked of that one
 * function (plans.ts) rather than written out again.
 */
export function canMakeVoices(plan: string | null | undefined, isAdmin: boolean): boolean {
  return advancedVideoPlan(plan, isAdmin);
}

export function ownVoiceLimit(plan: string | null | undefined, isAdmin: boolean): number {
  if (isAdmin) return OWN_VOICE_LIMITS.elite;
  return OWN_VOICE_LIMITS[plan ?? ""] ?? 0;
}

export function designsPerDay(plan: string | null | undefined, isAdmin: boolean): number {
  if (isAdmin) return DESIGNS_PER_DAY.elite;
  return DESIGNS_PER_DAY[plan ?? ""] ?? 0;
}

export function cloneTypeOk(type: string): boolean {
  return CLONE_TYPES.includes(type.toLowerCase().split(";")[0].trim());
}

/** A name for a voice: printable, short, never empty. */
export function voiceName(raw: unknown, fallback: string): string {
  const s = typeof raw === "string" ? raw.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, 40) : "";
  return s || fallback;
}

// ---- The seal on a generated voice ---------------------------------------
//
// A generation answers with three generated_voice_ids; keeping one turns it
// into a voice in our account. The page sends back the id it wants kept, so
// the server seals each id it handed out — to this person, with its
// description, for an hour — and keeps only an id whose seal opens. Without
// it a page could keep ids it never generated (or another person's), and
// every keep spends one of the account's slots. Stateless, as edit-seal.ts.

const SEAL_TTL_MS = 60 * 60 * 1000;

function sealKey(): string {
  return process.env.MEDIA_SIGNING_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY || "";
}

function mac(userId: string, generatedVoiceId: string, description: string, at: number): string {
  return createHmac("sha256", sealKey())
    .update(`voice-design:v1:${userId}:${generatedVoiceId}:${at}:${description}`)
    .digest("base64url")
    .slice(0, 32);
}

export function sealDesign(userId: string, generatedVoiceId: string, description: string, now = Date.now()): string {
  return `${now}.${mac(userId, generatedVoiceId, description, now)}`;
}

export function openDesignSeal(seal: unknown, userId: string, generatedVoiceId: string, description: string, now = Date.now()): boolean {
  if (!sealKey() || typeof seal !== "string") return false;
  const [atRaw, sig] = seal.split(".");
  const at = Number(atRaw);
  if (!Number.isFinite(at) || !sig || now - at > SEAL_TTL_MS || at > now + 60_000) return false;
  const want = Buffer.from(mac(userId, generatedVoiceId, description, at));
  const got = Buffer.from(sig);
  return want.length === got.length && timingSafeEqual(want, got);
}
