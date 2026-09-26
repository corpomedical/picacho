import Anthropic from "@anthropic-ai/sdk";
import { GATE_MODEL } from "./prices";

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
};

const SYSTEM = `You are a filter in front of a voice assistant. Its microphone stays open while the person uses the app, so it also hears things that were not said to the assistant. For each thing it picks up, decide whether the person using the app said it TO the assistant.

It was said to the assistant when it asks the assistant something, answers or reacts to what the assistant just said, tells it to do something, corrects it, or carries on the conversation with it.

It was not said to the assistant when it is something else the microphone happened to hear: a video, TV, podcast or song playing nearby; other people in the room; the person talking to someone else or on the phone; or the assistant's own voice coming back through the speaker.

Judge by what the words mean in this conversation, not by particular words. Speech that has nothing to do with the conversation and reads like dialogue, narration, commentary or someone else's talk is most likely not for the assistant. A short reply that fits what the assistant just said is for it, even if it is only a word or two. Words that are much quieter than the person's own voice, or that the transcriber was unsure of, lean towards not for the assistant, but meaning comes first. If you can't tell, say unclear.

The person may call the assistant by its name. The transcriber may misspell that name, or write an everyday word that sounds like it as the name, so the name appearing in the words is not by itself a sign they were said to the assistant: judge what the whole sentence means.`;

function describe(a: GateInput): string {
  const convo = a.recent.length
    ? a.recent.map((l) => `- ${l.who === "assistant" ? a.name : "Person"}: ${l.text.replace(/\s+/g, " ").slice(0, 280)}`).join("\n")
    : "(nothing yet: this would be the first thing said)";
  const when = a.whileAnswering
    ? `${a.name} was in the middle of answering when this was heard.`
    : a.sinceAssistant === null
      ? `${a.name} hasn't said anything yet.`
      : `${a.name} last spoke ${Math.round(a.sinceAssistant)} seconds ago.`;
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
  return `The conversation so far, oldest first:\n${convo}\n\n${when}\nHow sure the transcriber was of the words: ${sure}.\nHow loud it was: ${loud}.\n\nWhat the microphone just picked up:\n"${a.words.replace(/\s+/g, " ").slice(0, 600)}"`;
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
