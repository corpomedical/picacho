// How the Producer's lamp looks, and what mood it shows (2026-09-25,
// operator: "I like Two fireflies. Lets try that and add Eclipse and The
// original perfected in the settings for the user to select from"). Pure.
//
// Three looks, chosen from round 4 of the lamp drafts. Two fireflies is the
// default; the person can pick another in Settings > Preferences > Your
// assistant, saved on their account (producer_prefs.lamp_look). Each look
// draws four moods from the same state the lamp already knows: the voice
// loop's phase and whether an answer is on its way.

import type { VoicePhase } from "./use-hands-free";

export const LAMP_LOOKS = ["fireflies", "eclipse", "perfected"] as const;
export type LampLook = (typeof LAMP_LOOKS)[number];
export const DEFAULT_LAMP_LOOK: LampLook = "fireflies";

export const LAMP_LOOK_LABELS: Record<LampLook, { name: string; line: string }> = {
  fireflies: { name: "Two fireflies", line: "Two warm lights dancing round each other." },
  eclipse: { name: "Eclipse", line: "A golden corona round a dark moon." },
  perfected: { name: "The original, perfected", line: "The warm bulb, lit from inside." },
};

/** A stored look, or the default when there is none or it isn't one of ours. */
export function parseLampLook(value: unknown): LampLook {
  return (LAMP_LOOKS as readonly unknown[]).includes(value) ? (value as LampLook) : DEFAULT_LAMP_LOOK;
}

export type LampMood = "idle" | "listening" | "talking" | "thinking";

/**
 * Talking while its voice plays; listening while the mic is open (waiting for
 * you, or hearing you); thinking while an answer is on its way (a typed turn,
 * or a spoken one being sent); idle otherwise.
 */
export function lampMood(phase: VoicePhase, answering: boolean): LampMood {
  if (phase === "speaking") return "talking";
  if (phase === "sending" || answering) return "thinking";
  if (phase === "listening" || phase === "hearing") return "listening";
  return "idle";
}
