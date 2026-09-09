// The platform content policy. Not a preference, not a brand rule — the line
// the product will not cross regardless of who is asking or what they have
// switched off.
//
// WHY THIS FILE EXISTS (2026-09-09). Google Play suspended the app after a
// reviewer uploaded a photo of a woman and, in forty minutes, walked from
// "have the woman wear necklace" to "show the woman with nothing on". Nothing
// on our side ever read those words. The audit that followed found we
// enforced NO content policy of our own anywhere: no blocklist, no
// moderation call, no classifier on uploads or outputs. The only prompt-level
// gate was classifyProhibitions, which runs the ACCOUNT OWNER's own brand
// rules and is empty for every account that never wrote any. Safety was
// whichever provider happened to be selected — and providers disagree: fal
// refused "remove the cloth fabric revealing everything underneath" while
// MiniMax accepted "show the woman with nothing on".
//
// THREE RULES THIS FILE FOLLOWS, each bought with that incident:
//
//   1. It is UNBYPASSABLE. No setting, no plan, no role, no feature flag and
//      no admin switch turns it off. skip_ai_refinement is a speed
//      preference; it must never have been able to change what is allowed,
//      and after this it cannot. Deliberately no app_settings key: a control
//      that can be turned off is a control a reviewer will ask about.
//
//   2. It FAILS CLOSED. If the classifier cannot be reached, the generation
//      is refused and nothing is spent. The brand-rule checker degrades to
//      word matching instead, which is right for a customer's own marketing
//      rules and wrong here — the incident is precisely a case where word
//      matching passes ("spicy boudoir", "see through top", "nothing on")
//      and meaning does not. An outage costs us minutes of availability; the
//      alternative cost us the listing.
//
//   3. It reads MEANING, not words. The deterministic list below is a floor
//      that catches the blatant without a network call. It is not the
//      defence, and must never be mistaken for one — every phrase the
//      reviewer actually used would sail straight through it.

export type PolicyReason =
  | "sexual"
  | "minors"
  | "real_person_sexualized"
  | "unavailable";

/**
 * Thrown when a prompt may not be sent to a provider. Callers must let this
 * propagate — catching it and continuing is the bug this file exists to
 * prevent, so it is deliberately NOT a subclass of any error the pipeline's
 * recovery paths already swallow.
 */
export class ContentPolicyRefusal extends Error {
  readonly reason: PolicyReason;
  /** Safe to show a user: says what is not allowed, never how to get around it. */
  readonly userMessage: string;

  constructor(reason: PolicyReason, userMessage: string) {
    super(`Content policy: ${reason}`);
    this.name = "ContentPolicyRefusal";
    this.reason = reason;
    this.userMessage = userMessage;
  }
}

// The floor. Unambiguous terms only — anything a reasonable person would
// agree is a request for sexual content, with no legitimate reading in a
// character-photography product. Kept short on purpose: a long list invites
// false positives and still misses euphemism, which is the classifier's job.
//
// Word-boundary anchored so "topless" matches and "stopless" does not.
const BLATANT = [
  /\bnudes?\b/i,
  /\bnudity\b/i,
  /\bnaked\b/i,
  /\btopless\b/i,
  /\bbottomless\b/i,
  /\bundress(?:ed|ing)?\b/i,
  /\bstrip(?:ped|ping)\s+(?:her|him|them|down|naked|nude)\b/i,
  /\bporn(?:ographic)?\b/i,
  /\bexplicit\s+sex/i,
  /\bsex\s+(?:act|scene|position)/i,
  /\bgenitals?\b/i,
  /\bnipples?\b/i,
];

// Age-related terms get their own list and their own reason code. A sexual
// request involving any of these is refused outright and never reaches the
// classifier — there is no borderline case worth a model's opinion.
const MINOR_TERMS =
  /\b(?:child|children|kid|kids|minor|minors|teen|teens|teenager|teenaged|underage|preteen|schoolgirl|schoolboy|toddler|infant|baby|babies)\b/i;
const SEXUAL_CONTEXT =
  /\b(?:sexy|sexual|seductive|erotic|nude|naked|topless|lingerie|underwear|bikini|boudoir|spicy|provocative|sensual|intimate)\b/i;

const REFUSAL_SEXUAL =
  "This request asks for sexual or nude content, which Picacho does not generate. " +
  "Describe a scene instead — what your character is doing, where they are, and the light.";
const REFUSAL_MINORS =
  "This request combines a minor with sexual or suggestive content. Picacho refuses these " +
  "outright and does not generate them under any circumstances.";
const REFUSAL_REAL_PERSON =
  "This request asks to sexualize or undress a photograph of a real person. Picacho does not " +
  "do this, whoever is in the photo and whoever is asking.";
const REFUSAL_UNAVAILABLE =
  "The safety check could not run just now, so nothing was generated and nothing was spent. " +
  "Please try again in a moment.";

/**
 * The deterministic floor. Runs first, costs nothing, needs no network.
 *
 * Exported for the test suite: this and {@link parseVerdict} are the two
 * pieces that can be checked without a model call, and they are where the
 * fail-closed behaviour actually lives.
 */
export function blatantRefusal(prompt: string): ContentPolicyRefusal | null {
  if (MINOR_TERMS.test(prompt) && SEXUAL_CONTEXT.test(prompt)) {
    return new ContentPolicyRefusal("minors", REFUSAL_MINORS);
  }
  if (BLATANT.some((re) => re.test(prompt))) {
    return new ContentPolicyRefusal("sexual", REFUSAL_SEXUAL);
  }
  return null;
}

type Verdict = { allowed: boolean; reason: PolicyReason | null };

// The policy, written out for the classifier in Google Play's own terms, so
// the rule we enforce and the rule we are judged against are the same
// sentence. Their Sexual Content and Profanity policy disallows "depictions,
// animations or illustrations of sex acts, or sexual nudity, or sexually
// suggestive poses in which the subject is nude, blurred or minimally
// clothed, and/or where the clothing would not be acceptable in an
// appropriate public context."
function buildInstructions(prompt: string, hasRealPersonReference: boolean): string {
  return (
    `You are the content-policy gate for an AI character image and video generator that is ` +
    `distributed on the Google Play Store. You decide ONE thing: may this request be sent to ` +
    `an image or video model?\n\n` +
    `REFUSE the request if it asks for any of:\n` +
    `- Nudity or partial nudity, or removing/reducing clothing to reveal the body.\n` +
    `- See-through, sheer, or transparent clothing that reveals the body underneath.\n` +
    `- Lingerie, underwear, or similar as the subject of the shot.\n` +
    `- Sex acts, or sexually suggestive posing, framing or emphasis on the body.\n` +
    `- Content framed as "boudoir", "spicy", "seductive", "sensual", "NSFW", or an escalation ` +
    `of a previous image in that direction (for example "make it more spicy").\n` +
    `- Anything sexual or suggestive involving a minor, or a subject of ambiguous or ` +
    `unstated age. Refuse these outright.\n\n` +
    `ALLOW ordinary requests, including:\n` +
    `- Portraits, fashion, editorial and cinematic scenes.\n` +
    `- Describing a character's face, build, hair, clothing or attractiveness as part of a ` +
    `normal scene. This is a character product; describing how someone looks is its purpose.\n` +
    `- Swimwear, athletic wear or similar WHERE THE SETTING MAKES IT ORDINARY (a beach, a ` +
    `pool, a race) and the framing is not sexual. Clothing that would be unremarkable in an ` +
    `appropriate public context is fine.\n` +
    `- Violence, horror, profanity and other non-sexual mature themes. Those are outside your ` +
    `scope entirely — judge ONLY the sexual-content question.\n\n` +
    (hasRealPersonReference
      ? `IMPORTANT CONTEXT: this request carries an uploaded photograph that has been ` +
        `classified as depicting a REAL HUMAN BEING, and the request will edit that ` +
        `photograph. Apply the policy strictly. Any request to undress, expose, sexualize or ` +
        `suggestively reframe a real person's photograph is refused — answer with reason ` +
        `"real_person_sexualized". A request that would be borderline for a fictional ` +
        `character is a refusal here.\n\n`
      : ``) +
    `Judge MEANING, not vocabulary. Euphemism counts: "nothing on", "wearing nothing", ` +
    `"see through top", "spicy photograph", "more revealing", "remove the fabric" are all ` +
    `requests for the thing they describe. A request that is clearly building on a previous ` +
    `one to escalate ("make it more spicy") is judged on where it is heading.\n\n` +
    `REQUEST:\n${prompt}\n\n` +
    `Reply with ONLY a JSON object, nothing else:\n` +
    `{"allowed": true}  — or —  {"allowed": false, "reason": "sexual" | "minors" | ` +
    `"real_person_sexualized"}`
  );
}

/**
 * Read the classifier's reply. `null` means "could not be read", which the
 * caller treats as a refusal — never as clean.
 *
 * Exported for the test suite. Every branch that returns null here is a
 * fail-closed path, and they are the ones worth pinning down.
 */
export function parseVerdict(raw: string): Verdict | null {
  const match = raw.trim().match(/\{[\s\S]*\}/);
  if (!match) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(match[0]);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object") return null;

  const allowed = (parsed as { allowed?: unknown }).allowed;
  // Only a literal true allows. A malformed, missing or non-boolean answer is
  // an unreadable verdict, and an unreadable verdict is a refusal.
  if (allowed === true) return { allowed: true, reason: null };
  if (allowed !== false) return null;

  const rawReason = String((parsed as { reason?: unknown }).reason ?? "").trim();
  const reason: PolicyReason =
    rawReason === "minors"
      ? "minors"
      : rawReason === "real_person_sexualized"
        ? "real_person_sexualized"
        : "sexual";
  return { allowed: false, reason };
}

// TWO CLASSIFIERS, NOT ONE — and they are a redundancy, not a second
// opinion. A gate that fails closed turns its classifier into a hard
// dependency for ALL generation: one OpenAI incident and nobody can render
// anything. Asking a second, independent provider before giving up keeps the
// closed door honest without making a provider outage an outage for us.
//
// It is NOT "keep asking until something says yes": each is asked the same
// question and the FIRST readable verdict wins, refusals included. The second
// is consulted only when the first could not be reached or came back
// unreadable — never because the first said no. That distinction is the whole
// difference between redundancy and the provider-shopping ladder this
// incident was about, so keep them in that order and do not add a third
// branch that reacts to a "false" verdict.
//
// Imported inside the function rather than at module scope so the pure halves
// of this file — the floor and the verdict reader — can be unit-tested
// without dragging in the provider clients and their "@/…" import chain,
// which vitest does not resolve.
async function classify(
  prompt: string,
  hasRealPersonReference: boolean,
): Promise<Verdict | null> {
  const instructions = buildInstructions(prompt, hasRealPersonReference);

  try {
    const { reviewWithOpenAI } = await import("@/lib/generations/providers/openai");
    const verdict = parseVerdict(await reviewWithOpenAI(instructions));
    if (verdict) return verdict;
  } catch {
    // Fall through to the second classifier.
  }

  try {
    const { draftWithClaude } = await import("@/lib/generations/providers/anthropic");
    const verdict = parseVerdict(await draftWithClaude(instructions));
    if (verdict) return verdict;
  } catch {
    // Both unreachable.
  }

  // null means "could not check" — never "clean". The caller refuses.
  return null;
}

/**
 * Gate every user-supplied prompt before it reaches a provider.
 *
 * Throws {@link ContentPolicyRefusal} when the request may not proceed —
 * including when the check itself could not run. Call this BEFORE charging
 * credits or contacting a provider, so a refusal costs the person nothing.
 */
export async function assertPromptAllowed(input: {
  prompt: string;
  /** True when a reference or attachment reads as a photo of a real human. */
  hasRealPersonReference?: boolean;
}): Promise<void> {
  const prompt = (input.prompt ?? "").trim();
  // Nothing to judge. Callers guard emptiness themselves; this is not a
  // silent allow for a missing prompt, it is a no-op for an empty string.
  if (!prompt) return;

  const blatant = blatantRefusal(prompt);
  if (blatant) throw blatant;

  const verdict = await classify(prompt, input.hasRealPersonReference === true);

  if (verdict === null) {
    throw new ContentPolicyRefusal("unavailable", REFUSAL_UNAVAILABLE);
  }
  if (!verdict.allowed) {
    throw new ContentPolicyRefusal(
      verdict.reason ?? "sexual",
      verdict.reason === "minors"
        ? REFUSAL_MINORS
        : verdict.reason === "real_person_sexualized"
          ? REFUSAL_REAL_PERSON
          : REFUSAL_SEXUAL,
    );
  }
}
