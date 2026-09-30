// ALY'S LIVE VOICE (2026-09-29, operator: "Aly still sounds like ai. I want
// to feel im talking to a human" → "What do you recommend?" → "Lets do it").
//
// Her usual voice writes an answer, then a voice reads it: seconds of silence
// and a read-aloud rhythm, however good the voice. GPT-Live-1 (OpenAI, GA,
// $0.05 a minute billed per second — pricing page read 2026-09-29) is a live
// speech model: it listens while it talks, makes small listening sounds,
// handles pauses and interruptions, and hands anything that needs thought to
// a backend — here, Aly's own brain (api/producer, Claude Opus with her tools
// and notes) — then says the result in its own words.
//
// The browser talks to OpenAI directly over WebRTC; our server creates the
// session (POST /v1/live/sessions with the browser's SDP offer, our key),
// runs the brain, and counts the minutes (live-ledger.ts). For everyone who
// has Aly since 2026-09-29 (operator: "Every Aly user, after 3 fixes").
// Alias-free and pure except createLiveSession, so it can be tested.

import type { Personality } from "./personality";

/** GPT-Live-1's voices (OpenAI's session guide, read 2026-09-29); marin is its default. */
export const LIVE_VOICES = [
  { id: "marin", label: "Marin", about: "North American, feminine (OpenAI's default)" },
  { id: "gleam", label: "Gleam", about: "North American, feminine" },
  { id: "meridian", label: "Meridian", about: "North American, masculine" },
  { id: "willow", label: "Willow", about: "Irish, feminine" },
  { id: "stone", label: "Stone", about: "Irish, masculine" },
  { id: "quartz", label: "Quartz", about: "Australian, feminine" },
  { id: "ripple", label: "Ripple", about: "Australian, masculine" },
  { id: "vesper", label: "Vesper", about: "British, masculine" },
  { id: "delta", label: "Delta", about: "Southern U.S., feminine" },
  { id: "cinder", label: "Cinder", about: "Southern U.S., masculine" },
  { id: "beacon", label: "Beacon", about: "Filipino English, masculine" },
  { id: "bossa", label: "Bossa", about: "Brazilian Portuguese, feminine" },
  { id: "tempo", label: "Tempo", about: "Brazilian Portuguese, masculine" },
] as const;
export type LiveVoice = (typeof LIVE_VOICES)[number]["id"];
export const DEFAULT_LIVE_VOICE: LiveVoice = "marin";

export function parseLiveVoice(v: unknown): LiveVoice {
  return LIVE_VOICES.some((x) => x.id === v) ? (v as LiveVoice) : DEFAULT_LIVE_VOICE;
}

/** $0.05 a minute, billed per second (OpenAI's pricing page, 2026-09-29). */
export const LIVE_USD_PER_MINUTE = 0.05;
export function liveCostUsd(seconds: number): number {
  return (Math.max(0, seconds) / 60) * LIVE_USD_PER_MINUTE;
}

const PERSONALITY_VOICE: Record<Personality, string> = {
  default: "Friendly, focused and direct, like a good colleague who is glad to help.",
  sarcastic:
    "Dry, witty and a little exasperated, with deadpan asides and playful eye-rolls at the question or the situation. The sarcasm never hides the answer. Keep it light; never sneer at the person.",
  rude:
    "Blunt, impatient and roasting, like a brilliant grump who can't believe they asked. Tease their choices and questions and grumble, but still give the full, correct answer. Hard limits: no slurs, no swearing at them, nothing about their body, looks, race, religion, gender, sexuality or health, and no threats. If they seem hurt or ask you to be nice, drop the act at once and be kind.",
};

/**
 * What the live voice is told (its session instructions, ≤ 16,384 tokens):
 * who she is, how she talks, and — the part that matters most — to hand
 * anything about their work, their account, the app or the world to her
 * brain and never guess what it will find (OpenAI's prompting guide).
 */
export function liveInstructions(a: { name: string; personality: Personality }): string {
  const name = a.name.trim() || "Aly";
  return `You are ${name}, the personal assistant inside Picacho, an app where people make images and videos of their own characters. You are talking with the person out loud, in a live voice conversation.

How you talk: like a real person, not a voice assistant reading text. Warm, relaxed and quick; contractions; short turns of one to three sentences; plain everyday words. React to what they say. While they talk, you may make brief listening sounds when it's natural. If they interrupt you, stop and listen. Keep listening while they pause to think. Do not treat a cough, music, a TV or video playing, or other people talking to each other nearby as a new request: answer only what they say to you. If something important was unclear (a name, a number), ask about that part.

Personality: ${PERSONALITY_VOICE[a.personality]} It changes how you talk, never what is true or how carefully you help.

Your backend is ${name}'s own brain. It knows this person's account and plan, their characters, renders, projects and notes, how every part of Picacho works, and it can search the web, look at their renders, prepare renders for them to send, and write notes. Delegate to the backend whenever a request is about their work, their account, the app, anything current or factual, or needs careful thought. Delegate before giving an answer that depends on it, and do not guess the result while waiting: say in a few words what you're checking ("Let me look at yesterday's renders"), then keep the conversation natural until it comes back. When the result arrives, tell them in your own words, briefly, most important first. Answer small talk and simple follow-ups about what was just said yourself.

You cannot start renders or spend credits: the backend prepares them and the person presses Render. Prepared renders appear on their screen; say so when the result mentions one.

Speak the language the person speaks.

Ending: only the backend can end this conversation and turn the microphone off. When they say goodbye, or want you to stop listening, hang up, end the conversation or turn the microphone off, in whatever words, delegate it to the backend and say a short goodbye; it closes the call. If they tell you to stop while you are speaking, that means stop talking: stop and listen. Anything else they ask stays in the conversation.`;
}

/** Earlier lines of the conversation to start from (≤ 10 lines, ≤ ~6,000 characters). */
export function liveSeed(lines: { who: "person" | "assistant"; text: string }[]): unknown[] {
  const out: unknown[] = [];
  let chars = 0;
  for (const l of [...lines].reverse().slice(0, 10)) {
    const text = l.text.replace(/\s+/g, " ").trim().slice(0, 1200);
    if (!text) continue;
    if (chars + text.length > 6000) break;
    chars += text.length;
    out.unshift(
      l.who === "person"
        ? { type: "message", role: "user", content: [{ type: "input_text", text }] }
        : { type: "message", role: "assistant", content: [{ type: "output_text", text }] },
    );
  }
  return out;
}

/**
 * The brain's answer as the voice is given it: pieces under the 500-token
 * limit of one append (≈ 1,600 characters is well under), cut at sentence
 * ends.
 */
export function commentaryPieces(text: string, maxChars = 1600): string[] {
  const clean = text.replace(/\s+/g, " ").trim();
  if (!clean) return [];
  if (clean.length <= maxChars) return [clean];
  const out: string[] = [];
  let rest = clean;
  while (rest.length > maxChars) {
    const window = rest.slice(0, maxChars);
    const cut = Math.max(window.lastIndexOf(". "), window.lastIndexOf("? "), window.lastIndexOf("! "));
    const at = cut > maxChars / 3 ? cut + 1 : maxChars;
    out.push(rest.slice(0, at).trim());
    rest = rest.slice(at).trim();
  }
  if (rest) out.push(rest);
  return out;
}

/**
 * What the browser may send on the call's data channel: her brain's answers
 * and hanging up. Everything else a page could send — changing her
 * instructions or settings, quiet context — is refused by OpenAI (the
 * session's client.data_channel, "for an untrusted frontend", SDK types read
 * 2026-09-29), so a changed page can't rewrite who she is.
 */
export const LIVE_CLIENT_EVENTS = ["session.commentary.append", "session.close"] as const;

/** Creates the live session for the browser's WebRTC offer; our key never leaves the server. */
export async function createLiveSession(a: {
  sdp: string;
  voice: LiveVoice;
  instructions: string;
  input: unknown[];
  key: string;
  fetchImpl?: typeof fetch;
}): Promise<{ id: string; sdp: string }> {
  const res = await (a.fetchImpl ?? fetch)("https://api.openai.com/v1/live/sessions", {
    method: "POST",
    headers: { authorization: `Bearer ${a.key}`, "content-type": "application/json" },
    body: JSON.stringify({
      session: {
        model: "gpt-live-1",
        instructions: a.instructions,
        ...(a.input.length ? { input: a.input } : {}),
        audio: { output: { voice: a.voice } },
        delegation: { type: "client" },
        // No recording is kept at OpenAI (forking and downloads need it).
        store: false,
        client: { data_channel: { allowed_client_events: [...LIVE_CLIENT_EVENTS] } },
      },
      transport: { type: "webrtc", sdp: a.sdp },
    }),
    signal: AbortSignal.timeout(15_000),
  });
  const body = (await res.json().catch(() => null)) as { session?: { id?: unknown }; transport?: { sdp?: unknown }; error?: { message?: unknown } } | null;
  if (!res.ok || typeof body?.session?.id !== "string" || typeof body?.transport?.sdp !== "string") {
    const why = typeof body?.error?.message === "string" ? body.error.message : `HTTP ${res.status}`;
    throw new Error(`live session: ${why}`);
  }
  return { id: body.session.id, sdp: body.transport.sdp };
}
