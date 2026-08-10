// The voice agent's conversation logic — a small, deterministic state
// machine, deliberately not an LLM call per turn. Two reasons: latency (a
// spoken back-and-forth falls apart if every reply costs 1-3s of model
// time) and predictability (a scripted flow can't wander off-task or
// invent a detail the person never said, which is the whole failure this
// was built to prevent — see isTrivialUtterance below).
//
// The actual question wording lives in the i18n message files as arrays of
// phrasings; pickPhrasing rotates through them so the agent doesn't say the
// exact same sentence every single time.

export type AgentStep =
  // Asked the opening question, waiting to hear what they want made.
  | "await-prompt"
  // Have a prompt, don't know whether it's an image or a video.
  | "await-type"
  // Have a prompt and a type, they have saved characters but none picked.
  | "await-character"
  // Everything's gathered — read it back and wait for a yes.
  | "await-confirm";

export function pickPhrasing(options: string[], avoid?: string | null): string {
  if (options.length === 0) return "";
  if (options.length === 1) return options[0];
  // Never repeat the phrasing used immediately before, so consecutive
  // questions of the same kind visibly differ instead of relying on luck.
  const pool = avoid ? options.filter((o) => o !== avoid) : options;
  return pool[Math.floor(Math.random() * pool.length)] ?? options[0];
}

function normalize(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFD")
    // Strip accents so "olá"/"ola" and "sì"/"si" both match.
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\p{L}\p{N}\s]/gu, "")
    .trim();
}

// Greetings and filler across the four supported locales. Used both by the
// agent (to re-ask instead of treating "hey" as a creative brief) and by
// the server-side guard in generations/actions.ts — real incident,
// 2026-08-10: saying "Hey" produced a fully rendered room, because the
// pipeline's AI refinement step happily expands any input, however
// contentless, into a complete scene description.
const GREETING_WORDS = new Set([
  // en
  "hey", "hi", "hello", "yo", "hiya", "sup", "howdy", "ok", "okay", "yeah", "yep", "yes", "no",
  "um", "uh", "erm", "hmm", "test", "testing", "thanks", "thank", "you", "please", "hello there",
  // es
  "hola", "buenas", "oye", "vale", "si", "gracias", "prueba", "probando", "que", "tal",
  // pt
  "oi", "ola", "opa", "eai", "obrigado", "obrigada", "teste", "testando", "tudo", "bem",
  // it
  "ciao", "salve", "pronto", "ehi", "grazie", "prova", "provando", "come", "va", "buongiorno",
]);

// True when an utterance is nothing but greetings/filler — i.e. contains no
// actual content to generate from. Deliberately conservative: it only fires
// when EVERY word is filler, so a genuinely short but real prompt
// ("sunset", "a red car") still goes through untouched.
export function isTrivialUtterance(text: string): boolean {
  const normalized = normalize(text);
  if (!normalized) return true;
  const words = normalized.split(/\s+/).filter(Boolean);
  if (words.length === 0) return true;
  return words.every((w) => GREETING_WORDS.has(w));
}

const YES_WORDS = new Set([
  "yes", "yeah", "yep", "yup", "sure", "ok", "okay", "correct", "right", "confirm", "confirmed",
  "go", "generate", "do", "it", "please", "thats", "all", "perfect", "good", "great", "send",
  "si", "claro", "vale", "dale", "correcto", "genera", "adelante",
  "sim", "isso", "certo", "manda", "gera", "pode",
  "esatto", "vai", "perfetto",
]);

const NO_WORDS = new Set([
  "no", "nope", "nah", "wait", "stop", "cancel", "change", "not", "dont", "wrong", "back",
  "espera", "cancela", "cambia", "para",
  "nao", "espere", "cancelar", "muda",
  "aspetta", "annulla", "ferma",
]);

// Returns null when the answer is neither a clear yes nor a clear no — the
// caller re-asks rather than guessing, since guessing wrong here is exactly
// what burns a generation on something the person didn't ask for.
export function parseYesNo(text: string): "yes" | "no" | null {
  const words = normalize(text).split(/\s+/).filter(Boolean);
  if (words.length === 0) return null;
  // Check "no" first: "no, make it a video" leads with the negation, and
  // treating a correction as confirmation is the costly direction to err.
  if (words.some((w) => NO_WORDS.has(w))) return "no";
  if (words.some((w) => YES_WORDS.has(w))) return "yes";
  return null;
}

const VIDEO_WORDS = new Set(["video", "videos", "clip", "movie", "animation", "animated", "vídeo", "filme", "filmato"]);
const IMAGE_WORDS = new Set(["image", "images", "picture", "photo", "photograph", "still", "imagen", "foto", "imagem", "immagine"]);

export function parseContentType(text: string): "image" | "video" | null {
  const words = normalize(text).split(/\s+/).filter(Boolean);
  if (words.some((w) => VIDEO_WORDS.has(w))) return "video";
  if (words.some((w) => IMAGE_WORDS.has(w))) return "image";
  return null;
}

// Loose match of a spoken answer against the account's own character names.
// Substring rather than exact because the answer is usually a sentence
// ("let's use Mia for this one"), and speech recognition rarely returns a
// bare name on its own.
export function matchCharacterName(text: string, names: string[]): string | null {
  const normalized = normalize(text);
  if (!normalized) return null;
  // Longest name first so "Mia Rose" wins over a separate character
  // literally called "Mia" when both exist and both appear in the string.
  const sorted = [...names].sort((a, b) => b.length - a.length);
  for (const name of sorted) {
    const normalizedName = normalize(name);
    if (!normalizedName) continue;
    if (normalized === normalizedName || normalized.includes(normalizedName)) return name;
  }
  return null;
}

// "no character", "skip", "none" — an explicit opt-out of picking one,
// which is valid: generations don't require a character.
const SKIP_WORDS = new Set([
  "none", "no", "skip", "nobody", "without", "anyone", "any",
  "ninguno", "ninguna", "saltar", "sin",
  "nenhum", "nenhuma", "pular", "sem",
  "nessuno", "nessuna", "salta", "senza",
]);

export function isSkipAnswer(text: string): boolean {
  const words = normalize(text).split(/\s+/).filter(Boolean);
  if (words.length === 0) return false;
  return words.some((w) => SKIP_WORDS.has(w));
}
