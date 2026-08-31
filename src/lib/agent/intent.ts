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
  // Conversational openers that carry no question mark and no question word.
  // Every one of these was a real miss found in review (2026-08-31).
  "wondering", "curious", "thoughts", "unsure",
  // THE OTHER THREE LANGUAGES THE APP SHIPS IN. Found in the 2026-08-31 site
  // inspection: the whole module was English-only, so "por qué falló mi
  // video" — a question in Spanish, no question mark — fell straight through
  // to "render" and spent a credit on a video of the sentence. The app sells
  // itself in es/pt/it; the classifier has to read what the composer invites.
  // Inverted question marks are handled in classifyMessage directly.
  //
  // es
  "qué", "que", "por qué", "por que", "cómo", "como", "cuál", "cual", "cuáles", "cuándo",
  "cuando", "dónde", "donde", "quién", "quien", "cuánto", "cuanto", "cuánta",
  "puedes", "podrías", "podrias", "deberías", "deberias", "explícame",
  "explicame", "explica", "dime", "ayuda", "ayúdame", "ayudame", "recomienda",
  "sugiere", "compara",
  // pt
  "porque", "por que", "porquê", "o que", "qual", "quais", "quando", "onde",
  "quem", "quanto", "quanta", "pode", "poderia", "podes", "deveria", "explique",
  "explica-me", "me explica", "diga", "diz-me", "me diz", "ajuda", "ajude",
  "recomende", "recomenda", "sugira", "sugere",
  // it
  "cosa", "che", "perché", "perche", "come", "quale", "quali", "quando",
  "dove", "chi", "quanto", "quanta", "puoi", "potresti", "dovrei", "dovresti",
  "spiegami", "spiega", "dimmi", "aiuto", "aiutami", "consigliami", "consiglia",
  "suggerisci", "confronta",
];

// Multi-word openers, tested after the filler strip below. Kept separate from
// the single words because "i wonder" must match while a bare "i" must not —
// "i" opens plenty of legitimate shot descriptions.
const QUESTION_PHRASE_OPENERS = [
  "i wonder", "i am wondering", "i'm wondering", "i was wondering",
  "not sure", "no idea", "i need help", "need help", "any idea", "any chance",
  "just curious", "quick question", "one question", "a question",
];

// Leading noise that is not part of the question and must not hide it.
//
// THE HOLE THIS CLOSES (found in review, 2026-08-31, and it was the expensive
// direction — the one this module exists to prevent). The opener test only
// ever looked at the FIRST token, so a single polite or filler word in front
// of a question made the entire list miss, and with no question mark the
// message fell through to "render" and spent a credit on a video of the
// sentence. "explain why my score is low" asked; "please explain why my score
// is low" rendered. Same sentence, one word of manners, opposite outcome and
// a real charge.
//
// Deliberately an explicit list rather than "skip the first word": a generic
// skip would eat the subject of real prompts ("Eva walks through a market"
// would become "walks through a market").
const LEADING_FILLER = [
  "please", "so", "ok", "okay", "hmm", "hey", "hi", "also", "and", "but",
  "just", "actually", "sorry", "um", "uh", "well", "right", "then", "now",
  "quick question", "one more thing", "btw", "by the way",
  // es / pt / it politeness in front of a question must not hide it either —
  // "hola por qué falló" is the same hole "please explain why" was.
  "hola", "bueno", "pues", "oye", "vale", "perdón", "perdon", "gracias",
  "olá", "ola", "então", "entao", "bom", "desculpa", "obrigado", "obrigada",
  "ciao", "allora", "beh", "scusa", "grazie", "ecco",
];

// Phrases that address a person rather than describe a picture. These catch
// the polite forms that would otherwise sail past the opener list.
const ADDRESSED_PHRASES = [
  // The app's own name, anywhere in the message. Nobody describes a SHOT by
  // saying "picacho" — a message that names the app is talking TO it. Found
  // the expensive way (operator, 2026-08-31): "Hey picacho" fell through
  // every list below — "hey" is filler, "picacho" is no question word — and
  // rendered. One credit for a greeting, which OpenAI's safety filter then
  // rejected, which burned a softening call, which produced a nonsense
  // image of the words "Hey picacho". The person was saying hello.
  "picacho",
  "can you", "could you", "would you", "will you", "do you", "did you",
  "are you", "you think", "your opinion", "your advice", "let me know",
  "tell me", "explain to me", "walk me through", "what about",
  // es / pt / it — the polite second-person forms, same role as above.
  "me puedes", "me podrías", "me podrias", "qué opinas", "que opinas",
  "qué te parece", "que te parece", "me dices", "me recomiendas",
  "você pode", "voce pode", "o que acha", "o que você acha", "me diga",
  "pode me", "poderia me", "mi puoi", "mi potresti", "cosa ne pensi",
  "che ne pensi", "mi dici", "mi consigli", "secondo te",
];

// A short conversational reply is never a shot. Without this, "thanks" is a
// perfectly well-formed two-word prompt and would render.
const SMALL_TALK = [
  "hi", "hello", "hey", "yo", "thanks", "thank you", "ta", "ok", "okay", "k",
  "yes", "no", "yeah", "nope", "cool", "nice", "great", "perfect", "got it",
  "sure", "please", "sorry", "good morning", "good evening", "bye",
  // es / pt / it
  "hola", "gracias", "muchas gracias", "vale", "sí", "si", "claro", "genial",
  "perfecto", "buenos días", "buenos dias", "buenas", "adiós", "adios",
  "olá", "ola", "obrigado", "obrigada", "sim", "não", "nao", "legal",
  "ótimo", "otimo", "bom dia", "boa noite", "tchau",
  "ciao", "grazie", "mille grazie", "va bene", "certo", "ottimo", "perfetto",
  "buongiorno", "buonasera", "arrivederci",
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
// NOTE the absence of "do". It used to be here AND in QUESTION_OPENERS, which
// meant the one chip it could produce ("can you do a wide shot of Eva") came
// back reading as a question again, so that chip could never render — it just
// asked the same thing twice. Every other verb here round-trips to "render".
const RENDER_VERBS = [
  "make", "create", "generate", "render", "shoot", "film", "show", "draw",
  "put", "give me", "animate", "build",
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

  // Peel leading filler before testing openers, repeatedly — "ok so why did
  // that fail" carries two. Bounded to three passes so no list of fillers can
  // turn this into a loop.
  let probe = lower;
  for (let pass = 0; pass < 3; pass++) {
    const stripped = LEADING_FILLER.find((f) => startsWithWord(probe, f));
    if (!stripped) break;
    const rest = probe.slice(stripped.length).trim().replace(/^[,:]\s*/, "");
    // Never strip away the entire message: "please" on its own is small talk,
    // not an empty render.
    if (!rest) break;
    probe = rest;
  }

  const asks =
    raw.includes("?") ||
    // Spanish opens questions with an inverted mark; it alone settles it.
    raw.includes("\u00bf") ||
    SMALL_TALK.includes(lower.replace(/[.!]+$/, "")) ||
    QUESTION_OPENERS.some((w) => startsWithWord(probe, w)) ||
    QUESTION_PHRASE_OPENERS.some((w) => startsWithWord(probe, w)) ||
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
