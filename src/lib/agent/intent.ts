// Reading one line of text and deciding whether it is a shot to render or a
// question to answer (2026-08-31, operator: "it should know a prompt from a
// conversation. all continuous").
//
// Alias-free so it can be unit-tested, like prices.ts, sse.ts and failures.ts.
// This module decides whether a credit gets spent, which makes it the most
// load-bearing forty lines in the feature and the one place where being
// clever is a liability.
//
// THE RULE IS DELIBERATELY ASYMMETRIC, and that asymmetry is the whole
// design. There are two ways to be wrong:
//
//   - Read a question as a shot. Costs a credit, produces a video nobody
//     asked for, and the person finds out after the money is gone.
//   - Read a shot as a question. Costs a fraction of a cent, produces an
//     answer plus a "Render this" chip, and the person is one tap from what
//     they wanted.
//
// Those are not equally bad, so the rule is not balanced. Anything carrying a
// question mark, opening on a question word, or addressed to a person goes to
// the assistant. Everything else renders — which keeps the ordinary case
// ("Eva walking through a market at dawn") instant, free of any classifier
// round trip, and exactly as it behaves today.

export type MessageIntent = "render" | "ask";

export type IntentReading = {
  intent: MessageIntent;
  /**
   * When a message is read as a question but still has a renderable shot
   * inside it ("can you make Eva walk through a market"), this is that shot
   * with the conversational wrapper removed. It becomes the "Render this"
   * chip under the answer. Null when there is nothing to offer.
   *
   * Derived here rather than asked of the model on purpose: it must be the
   * same every time, it must cost nothing, and a chip that spends credits
   * should never be built from a sentence a model improvised.
   */
  renderablePrompt: string | null;
};

// Openers that make a sentence a question even without a question mark.
// "show" is deliberately ABSENT: "show me Eva in a market" is a render
// request, and treating it as a question would put a tap in front of one of
// the most natural ways to ask for a shot.
const QUESTION_OPENERS = [
  "what", "why", "how", "which", "when", "where", "who", "whom", "whose",
  "should", "shall", "can", "could", "would", "will", "do", "does", "did",
  "is", "are", "was", "were", "am", "has", "have", "had", "may", "might",
  "any", "anything", "explain", "tell", "compare", "suggest", "recommend",
  "advise", "help",
];

// Phrases that address a person rather than describe a picture. These catch
// the polite forms that would otherwise sail past the opener list.
const ADDRESSED_PHRASES = [
  "can you", "could you", "would you", "will you", "do you", "did you",
  "are you", "you think", "your opinion", "your advice", "let me know",
  "tell me", "explain to me", "walk me through", "what about",
];

// A short conversational reply is never a shot. Without this, "thanks" is a
// perfectly well-formed two-word prompt and would render.
const SMALL_TALK = [
  "hi", "hello", "hey", "yo", "thanks", "thank you", "ta", "ok", "okay", "k",
  "yes", "no", "yeah", "nope", "cool", "nice", "great", "perfect", "got it",
  "sure", "please", "sorry", "good morning", "good evening", "bye",
];

// Polite wrappers that can be peeled off to recover the shot underneath.
// Ordered longest-first so "can you please" is stripped before "can you".
const RENDER_WRAPPERS = [
  "can you please", "could you please", "would you please", "can u please",
  "can you", "could you", "would you", "will you", "can u", "please can you",
  "i want you to", "i'd like you to", "i would like you to", "please",
];

// The verbs that mean "produce a picture". A wrapper is only worth peeling
// when what is left actually asks for one — otherwise "can you explain the
// scoring" would come back with a chip offering to render "explain the
// scoring", which is nonsense that costs a credit.
const RENDER_VERBS = [
  "make", "create", "generate", "render", "shoot", "film", "show", "draw",
  "put", "give me", "do", "animate", "build",
];

function normalise(text: string): string {
  return text.trim().toLowerCase().replace(/\s+/g, " ");
}

function startsWithWord(haystack: string, word: string): boolean {
  return haystack === word || haystack.startsWith(word + " ");
}

/**
 * Reads one composer message.
 *
 * Only ever called when the assistant is switched ON. With it off nothing
 * classifies anything and every send renders, exactly as it did before this
 * feature existed — which is what "off means off" has to mean for someone who
 * has turned it off precisely because they do not want to be second-guessed.
 */
export function classifyMessage(text: string): IntentReading {
  const raw = text.trim();
  const lower = normalise(raw);

  if (!lower) return { intent: "render", renderablePrompt: null };

  const asks =
    raw.includes("?") ||
    SMALL_TALK.includes(lower.replace(/[.!]+$/, "")) ||
    QUESTION_OPENERS.some((w) => startsWithWord(lower, w)) ||
    ADDRESSED_PHRASES.some((p) => lower.includes(p));

  if (!asks) return { intent: "render", renderablePrompt: null };

  return { intent: "ask", renderablePrompt: recoverRenderPrompt(raw, lower) };
}

function recoverRenderPrompt(raw: string, lower: string): string | null {
  for (const wrapper of RENDER_WRAPPERS) {
    if (!startsWithWord(lower, wrapper)) continue;
    const rest = raw.slice(wrapper.length).trim().replace(/^[,:]\s*/, "");
    const restLower = normalise(rest);
    if (!restLower) return null;
    // Only offer the chip when what survives is genuinely an instruction to
    // produce something, and only when the person was not ALSO asking
    // something else in the same breath.
    if (rest.includes("?")) return null;
    if (!RENDER_VERBS.some((v) => startsWithWord(restLower, v))) return null;
    // Capitalise nothing and change nothing else: what goes in the composer
    // must be recognisably the person's own words, or the chip is putting
    // sentences in their mouth and charging them for it.
    return rest;
  }
  return null;
}
