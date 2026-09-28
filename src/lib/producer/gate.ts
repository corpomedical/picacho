import Anthropic from "@anthropic-ai/sdk";
import { GATE_MODEL } from "./prices";

// 2026-09-28 (operator: "She almost never has an answer to the question"):
// 5 of 15 spoken messages in his 10:51-10:54 run were let be. A question on a
// new topic read as "nothing to do with the conversation", so questions on
// any topic were made hers, and a clear voice as loud as the person's leaned
// towards her. The same evening (operator: "The assistant is struggling even
// more to answer when picking up background voices and noises"): a TV and
// the people around ask questions and change topics too, and can be as loud
// as the person. So a new topic is hers when it is asked OF her, loudness is
// a clue that never argues for her by itself, and an unclear message that
// also sounds like the room (quieter than the person, or words the
// transcriber wasn't sure of) is let be (letBe). Still by meaning and by
// signals, never by words.
//
// Was that said TO the Producer? (2026-09-25, operator: "doesnt pick up every
// voice on the background and processes it"). The data that day: five lines
// from social-media videos he was scrolling were transcribed, shown as his
// messages and answered with silence — each a full turn, one of them cutting
// off a real answer.
//
// A small, fast model judges each spoken message before it becomes a turn,
// by what it MEANS in the conversation so far (operator standard: a gate
// judges meaning, never contents — no word lists, no phrases to match). It
// also sees the signals a person would use: how sure the transcriber was of
// the words, and how loud they were against the person's own voice (a TV
// across the room is much quieter at the mic). Only a clear "not for the
// Producer" drops the message; unclear goes on, and the Producer itself can
// still answer with nothing. It runs alongside the turn's first model call,
// so a message that IS for the Producer waits for nothing (route.ts).

export type Verdict = "to_producer" | "not_for_producer" | "unclear";
export type GateInput = {
  /** What the person calls the assistant. */
  name: string;
  /** The conversation so far, oldest first (a few recent lines). */
  recent: { who: "person" | "assistant"; text: string }[];
  /** The words the microphone picked up. */
  words: string;
  /** Mean log-probability of the transcript's tokens (null when unknown). */
  confidence: number | null;
  /** Loudness against the person's usual voice, 1 = the same (null until known). */
  nearness: number | null;
  /** The assistant was answering (thinking or speaking) when this was heard. */
  whileAnswering: boolean;
  /** Seconds since the assistant last said something (null: nothing yet). */
  sinceAssistant: number | null;
  /**
   * What the assistant was saying out loud when this was heard (the part of
   * its current answer played so far, as the sheet reports it), so its own
   * voice caught by the mic can be told from the person's words. Null when
   * it wasn't speaking.
   */
  herWords?: string | null;
  /** They started talking while it spoke and kept talking after it went quiet. */
  talkedOver?: boolean;
};

/** Why a spoken message was judged as it was: the signals the judge read, for an admin's screen. */
export type GateSignals = { loud: string; sure: string; whileAnswering: boolean; talkedOver: boolean };

const SYSTEM = `You are a filter in front of a voice assistant. Its microphone stays open while the person uses the app, so it also hears things that were not said to the assistant. For each thing it picks up, decide whether the person using the app said it TO the assistant.

It was said to the assistant when it asks the assistant something, answers or reacts to what the assistant just said, tells it to do something, corrects it, or carries on the conversation with it. People ask their assistant about anything, not only the app — but videos, shows and the people around ask questions and change the subject too, so a question or request on a new topic is for the assistant only when it is asked of the assistant, the way someone talks to the assistant they are using, not when it is part of what someone or something else is saying.

The app is a studio where people make images and videos of their own characters, and they often say out loud what they want to make: a scene, a shot, a look, what a character does or says. That is said to the assistant, even though it can sound like a description, narration or a line from a script.

It was not said to the assistant when it is something else the microphone happened to hear: a video, TV, podcast or song playing nearby; other people in the room; the person talking to someone else or on the phone; or the assistant's own voice coming back through the speaker.

Judge by what the words mean in this conversation, not by particular words. Speech that reads like dialogue, narration, commentary or someone else's talk, and isn't a question or request to the assistant, is most likely not for the assistant. A short reply that fits what the assistant just said is for it, even if it is only a word or two. Loudness is only a clue: a TV or someone nearby can be as loud as the person, so being loud never makes words the assistant's by itself. Words that are much quieter than the person's own voice, or that the transcriber was unsure of, lean towards not for the assistant, but meaning comes first. If you can't tell, say unclear.

When the person talks while the assistant is speaking, the microphone may also catch the end of what the assistant was saying. If the words go beyond the assistant's own words with something of the person's (a question, a correction, "wait", "stop", a new request), they were said to it; if they are only the assistant's own words, they were not.

The person may call the assistant by its name. The transcriber may misspell that name, or write an everyday word that sounds like it as the name, so the name appearing in the words is not by itself a sign they were said to the assistant: judge what the whole sentence means.`;

/**
 * Whether a spoken message is let be: a clear "not for" always; an "unclear"
 * one too when it also sounds like the room — noticeably quieter than the
 * person (under 0.6 of their level, the judge's "about as loud" line below)
 * or words the transcriber wasn't sure of. An unclear one as loud as the
 * person, or before their level is known, still goes on.
 */
export function letBe(v: Verdict, s: { nearness: number | null; confidence: number | null }): boolean {
  if (v === "not_for_producer") return true;
  if (v !== "unclear") return false;
  return (s.nearness !== null && s.nearness < 0.6) || (s.confidence !== null && s.confidence < -0.7);
}

/** The judge's reading of the signals, in words (shared with an admin's "why"). */
export function gateSignals(a: Pick<GateInput, "confidence" | "nearness" | "whileAnswering" | "talkedOver">): GateSignals {
  const sure =
    a.confidence === null ? "unknown" : a.confidence > -0.25 ? "high" : a.confidence > -0.7 ? "medium" : "low";
  const loud =
    a.nearness === null
      ? "unknown (not enough of their voice heard yet)"
      : a.nearness >= 0.6
        ? "about as loud as the person's own voice"
        : a.nearness >= 0.3
          ? "noticeably quieter than the person's own voice"
          : "much quieter than the person's own voice";
  return { loud, sure, whileAnswering: a.whileAnswering, talkedOver: a.talkedOver === true };
}

function describe(a: GateInput): string {
  const convo = a.recent.length
    ? a.recent.map((l) => `- ${l.who === "assistant" ? a.name : "Person"}: ${l.text.replace(/\s+/g, " ").slice(0, 280)}`).join("\n")
    : "(nothing yet: this would be the first thing said)";
  const when = a.whileAnswering
    ? `${a.name} was in the middle of answering when this was heard.`
    : a.sinceAssistant === null
      ? `${a.name} hasn't said anything yet.`
      : `${a.name} last spoke ${Math.round(a.sinceAssistant)} seconds ago.`;
  const { sure, loud } = gateSignals(a);
  const her = a.herWords?.trim()
    ? `\nWhat ${a.name} was saying out loud when this was heard (the end of it): "${a.herWords.replace(/\s+/g, " ").trim().slice(-400)}"`
    : "";
  const over = a.talkedOver ? `\nThey started talking while ${a.name} was speaking and kept talking after ${a.name} went quiet.` : "";
  return `The conversation so far, oldest first:\n${convo}\n\n${when}${her}${over}\nHow sure the transcriber was of the words: ${sure}.\nHow loud it was: ${loud}.\n\nWhat the microphone just picked up:\n"${a.words.replace(/\s+/g, " ").slice(0, 600)}"`;
}

const TOOL = {
  name: "verdict",
  description: "Record whether the words were said to the assistant.",
  input_schema: {
    type: "object" as const,
    properties: {
      verdict: { type: "string" as const, enum: ["to_producer", "not_for_producer", "unclear"] },
    },
    required: ["verdict"],
  },
};

/**
 * The verdict and what it cost. Never throws: a failure or a slow answer is
 * "unclear", which lets the message through (a missed filter costs a turn; a
 * wrong drop loses what the person said).
 */
export async function judgeSpoken(
  a: GateInput,
  opts: { signal?: AbortSignal; timeoutMs?: number } = {},
): Promise<{ verdict: Verdict; usage: { input: number; output: number } }> {
  const none = { verdict: "unclear" as Verdict, usage: { input: 0, output: 0 } };
  if (!process.env.ANTHROPIC_API_KEY) return none;
  try {
    const client = new Anthropic();
    const res = await client.messages.create(
      {
        model: GATE_MODEL,
        max_tokens: 40,
        system: SYSTEM,
        tools: [TOOL],
        tool_choice: { type: "tool", name: "verdict" },
        messages: [{ role: "user", content: describe(a) }],
      },
      { timeout: opts.timeoutMs ?? 3500, maxRetries: 0, signal: opts.signal },
    );
    const call = res.content.find((b) => b.type === "tool_use");
    const v = (call?.input as { verdict?: unknown } | undefined)?.verdict;
    const verdict: Verdict = v === "to_producer" || v === "not_for_producer" ? v : "unclear";
    return { verdict, usage: { input: res.usage.input_tokens ?? 0, output: res.usage.output_tokens ?? 0 } };
  } catch {
    return none;
  }
}

/** Exposed for tests: the text the judge reads. */
export const gatePromptFor = describe;
