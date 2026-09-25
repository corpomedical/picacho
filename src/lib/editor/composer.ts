// The track composer (operator, 2026-09-25: "Add a track composer — ACE AI
// studio has something of that sort"; his pick: "ElevenLabs + ACE-Step").
// Describe the music, pick moods and sounds, and it writes takes timed to the
// cut: ElevenLabs Music v2.5 for the real track, ACE-Step for quick drafts,
// both on our fal account. Prices read from fal's own model listing,
// 2026-09-25: ElevenLabs "$0.6 per output audio minute … rounded up to the
// closest minute"; ACE-Step "$0.0002 per second of generated audio".
//
// This file is the pure part: sections from the cut, what each engine is sent,
// what a take costs. composer-run.ts (server) calls fal and keeps the takes.

export type ComposerEngine = "eleven" | "ace";

export const ENGINES: Record<ComposerEngine, { endpoint: string; maxSeconds: number }> = {
  eleven: { endpoint: "elevenlabs/music/v2.5", maxSeconds: 600 },
  ace: { endpoint: "fal-ai/ace-step/prompt-to-audio", maxSeconds: 240 },
};

export const MAX_TAKES = 3;

export type ComposeRequest = {
  engine: ComposerEngine;
  prompt: string;
  /** Mood and sound chips. */
  styles: string[];
  instrumental: boolean;
  /** How long the track is (the cut's length, or the selection's). */
  seconds: number;
  sections: Section[];
  takes: number;
};

export type Section = { name: string; start: number; end: number };

/** What a request costs us at fal's list price, US dollars. */
export function composeCostUsd(engine: ComposerEngine, seconds: number, takes: number): number {
  const n = Math.max(1, Math.min(MAX_TAKES, Math.round(takes)));
  const s = Math.max(1, seconds);
  const each = engine === "eleven" ? Math.ceil(s / 60) * 0.6 : s * 0.0002;
  return Math.round(each * n * 10000) / 10000;
}

/**
 * The music's shape, laid on the cut: a build, a rise, the drop on the
 * biggest cut in the middle stretch, and an outro. Every part at least 3 s
 * (ElevenLabs' smallest section); a short cut gets fewer parts.
 */
export function sectionsFromCuts(duration: number, cuts: readonly number[]): Section[] {
  const d = Math.max(3, duration);
  const inside = [...new Set(cuts.filter((c) => c > 3 && c < d - 3).map((c) => Math.round(c * 100) / 100))].sort((a, b) => a - b);
  if (d < 12) return [{ name: "Build", start: 0, end: round(d) }];
  const near = (target: number, lo: number, hi: number) => {
    const pool = inside.filter((c) => c >= lo && c <= hi);
    if (pool.length === 0) return target;
    return pool.reduce((best, c) => (Math.abs(c - target) < Math.abs(best - target) ? c : best), pool[0]);
  };
  const rise = near(d * 0.22, 3, d * 0.4);
  const drop = near(d * 0.55, rise + 3, d * 0.8);
  const outro = near(d * 0.85, drop + 3, d - 3);
  const edges = [0, rise, drop, outro, d];
  const names = ["Build", "Rise", "Drop", "Outro"];
  const out: Section[] = [];
  for (let i = 0; i < 4; i++) {
    if (edges[i + 1] - edges[i] >= 3) out.push({ name: names[i], start: round(edges[i]), end: round(edges[i + 1]) });
    else if (out.length) out[out.length - 1].end = round(edges[i + 1]);
  }
  return out;
}

const round = (n: number) => Math.round(n * 100) / 100;
const clock = (t: number) => `${Math.floor(t / 60)}:${String(Math.round(t % 60)).padStart(2, "0")}`;

/** The words both engines get: the description, the chips, and the timing of the sections. */
export function promptText(req: Pick<ComposeRequest, "prompt" | "styles" | "sections" | "instrumental">): string {
  const parts = [req.prompt.trim()];
  if (req.styles.length) parts.push(`Style: ${req.styles.join(", ")}.`);
  if (req.sections.length > 1) {
    parts.push(`Structure: ${req.sections.map((s) => `${s.name.toLowerCase()} ${clock(s.start)}–${clock(s.end)}`).join(", ")}.`);
    const drop = req.sections.find((s) => s.name === "Drop");
    if (drop) parts.push(`The big hit lands exactly at ${clock(drop.start)}.`);
  }
  if (req.instrumental) parts.push("Instrumental, no vocals.");
  return parts.filter(Boolean).join(" ").slice(0, 2000);
}

/** ElevenLabs Music v2.5 on fal: the prompt route, the one that guarantees an instrumental and an exact length. */
export function elevenBody(req: ComposeRequest, seed: number) {
  return {
    prompt: promptText(req),
    music_length_ms: Math.round(Math.min(ENGINES.eleven.maxSeconds, Math.max(3, req.seconds)) * 1000),
    force_instrumental: req.instrumental,
    seed,
    output_format: "mp3_48000_192",
  };
}

/** ACE-Step on fal: tags-style prompt, instrumental switch, length in seconds. */
export function aceBody(req: ComposeRequest, seed: number) {
  return {
    prompt: [req.prompt.trim(), ...req.styles].filter(Boolean).join(", ").slice(0, 1000),
    instrumental: req.instrumental,
    duration: Math.round(Math.min(ENGINES.ace.maxSeconds, Math.max(5, req.seconds)) * 100) / 100,
    seed,
  };
}

/** A composed take on the timeline, known by its file (the SDK keys elements by its own data-hf-id). */
export function isTake(src: string | null): boolean {
  return !!src && /^(?:\.\/)?assets\/music\/take-[\w-]+\.(?:mp3|wav)$/i.test(src);
}

/** The element a chosen take becomes on the music track. */
export function musicElement(id: string, file: string, seconds: number, volume = 0.85): string {
  const esc = (v: string) => v.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
  return `<audio id="${esc(id)}" src="${esc(file)}" data-start="0" data-duration="${round(seconds)}" data-media-start="0" data-volume="${volume}" data-track-index="30" data-role="music"></audio>`;
}
