import { generateImageWithOpenAI } from "@/lib/generations/providers/openai-images";
import { generateImageWithFlux } from "@/lib/generations/providers/fal-image";
import { fetchWithTimeout } from "@/lib/generations/providers/fetch-with-timeout";
import { getImageModel } from "@/lib/generations/providers/image-models";
import { buildImageReferences } from "@/lib/generations/providers/image-references";

// A hard ceiling on PAID calls for one generation, counted across every
// retry inside it (and, until the ladder was removed on 2026-09-09, every
// fallback and soften-and-try-again too).
//
// The old shape multiplied: 3 attempts x 2 generate-retries, and each of
// those could chain GPT Image -> safety rejection -> softened retry -> Flux.
// Twelve GPT Image calls plus six Flux renders for a single credit, and if
// the generation ultimately failed that credit was refunded — so the worst
// case was roughly two euros of spend against zero revenue, from one click.
//
// The budget is threaded through instead of lowering the retry counts,
// because the retries themselves are worth keeping: a transient 500 really
// does succeed on the second try. What must not happen is many EXPENSIVE
// recoveries stacking up inside them.
export type ProviderBudget = { spent: number; limit: number };

export function newProviderBudget(limit: number): ProviderBudget {
  return { spent: 0, limit };
}

export class ProviderBudgetExhausted extends Error {
  constructor(limit: number) {
    super(
      `This request already used its ${limit} generation attempts without producing a usable image.`,
    );
    this.name = "ProviderBudgetExhausted";
  }
}

// Call immediately BEFORE anything that costs money. Throws rather than
// returning false so no call site can forget to check.
function chargeBudget(budget: ProviderBudget | undefined): void {
  if (!budget) return;
  if (budget.spent >= budget.limit) throw new ProviderBudgetExhausted(budget.limit);
  budget.spent += 1;
}

// Single entry point for image generation regardless of which model is
// selected. OpenAI returns raw image bytes (persisted via the caller-supplied
// persistBase64 handler); fal.ai/Flux returns a hosted URL directly.
//
// referenceImageUrl accepts either a single URL (the ordinary one-character
// case) or an array (multi-character mode — one photo per selected
// character). Since the FLUX.2 Pro upgrade (2026-08-26) BOTH providers
// accept the array form — /edit takes up to ten reference images — so
// multi-character no longer needs to be blocked from the fal lane.
export async function generateImage(
  modelId: string,
  prompt: string,
  referenceImageUrl: string | string[] | null | undefined,
  persistBase64: (base64: string) => Promise<string>,
  // Records that a different model than the one asked for produced the
  // image. NOTHING CALLS THIS ANY MORE: the only fallback that ever fired
  // was the safety ladder removed on 2026-09-09, and a model is no longer
  // substituted mid-request for any reason. Kept so the pipeline's
  // "which model actually rendered this" reporting keeps its shape; if a
  // legitimate substitution is ever reintroduced, wire it here — but never
  // one triggered by a content refusal (see the note further down).
  onFallback?: (note: string, finalModelName?: string) => void,
  // Shared across every attempt of one generation — see ProviderBudget.
  budget?: ProviderBudget,
  // Outfit-on-the-character (2026-08-24): a clothing photo sent ALONGSIDE
  // the single identity photo. Its own argument (not merged into
  // referenceImageUrl) so the array form keeps meaning multi-character.
  // Since FLUX.2 (2026-08-26) both providers receive it — see combinedRefs.
  outfitImageUrl?: string | null,
  // Prop-role photo (Send Receipt P5) — same extra-image contract as the
  // outfit photo, both providers.
  propImageUrl?: string | null,
): Promise<string> {
  const model = getImageModel(modelId);

  // Flux results come back as fal.media URLs — external hosting we don't
  // control, which can expire and leave History cards dead. Persisting into
  // our own storage (same as the GPT path) makes every result durable and
  // uniformly served via our signed URLs. Best-effort: if the download
  // hiccups, the fal URL still works today, so return it rather than
  // failing a generation that actually succeeded.
  async function persistRemoteImage(url: string): Promise<string> {
    try {
      const res = await fetchWithTimeout(url, {}, 20_000);
      if (!res.ok) return url;
      const base64 = Buffer.from(await res.arrayBuffer()).toString("base64");
      return await persistBase64(base64);
    } catch {
      return url;
    }
  }

  // One combined reference array for BOTH providers (2026-08-26): identity
  // first, then outfit, then prop. GPT's multi-image edit always worked
  // this way; FLUX.2 Pro's /edit now takes the same array (up to ten), so
  // the prompt's instruction suffixes about each photo hold on whichever
  // image model the person picked. (This used to say they stayed true
  // "across the lane switch" — there is no lane switch since the Flux
  // fallback went with the safety ladder on 2026-09-09.)
  const combinedRefs = buildImageReferences({
    identity: referenceImageUrl,
    outfit: outfitImageUrl,
    prop: propImageUrl,
  });

  if (model.provider === "fal") {
    chargeBudget(budget);
    return persistRemoteImage(await generateImageWithFlux(prompt, combinedRefs));
  }

  const openAiRefs = combinedRefs;

  // NO FALLBACK ON A SAFETY REFUSAL. Read this before adding one back.
  //
  // Until 2026-09-09 this catch did the opposite: a provider's content
  // refusal was the ONE error class allowed to continue, into a three-stage
  // ladder — ask Claude to reword the prompt "so a strict classifier clearly
  // reads it as wholesome", retry GPT, then hand the reworded text to Flux,
  // chosen in the comment here for having a "much less restrictive filter".
  // Every other error (auth, outage, rate limit) was rethrown. So the system
  // treated "this content is not allowed" as the signal to try harder, and
  // told the user so: "OpenAI's safety filter rejected the prompt —
  // generated with Flux 2 Pro instead."
  //
  // Google Play suspended the app on 2026-09-09 citing Sexual Content and
  // AI-Generated Content. Whatever else that ladder was, it is a mechanism
  // for defeating a content filter, and it is not defensible in a
  // Play-distributed app whatever the intent behind it was.
  //
  // The intent WAS honest — GPT's classifier is genuinely aggressive about
  // photorealistic people, which is exactly what this product makes, and it
  // rejected 3 of 8 failed generations measured on 2026-08-10. The answer to
  // that is a more precise gate of our own in front of the provider (see
  // lib/generations/content-policy.ts, which now runs before any prompt gets
  // here), not shopping for a provider that says yes. If a prompt our own
  // policy passed is still refused downstream, that render fails: the
  // pipeline treats a safety refusal as non-retryable (SAFETY_REJECTION).
  // A refusal before anything was drawn is force-refunded (2026-09-10): the
  // pipeline marks the attempt REFUSED_BEFORE_RENDER_ISSUE, because OpenAI's
  // own ledger shows it bills nothing for one (refund-rules.ts). A refusal of
  // "a generated image" (OpenAI's output stage) is not — the picture was
  // made — and comes back through the automatic_refunds switch and under the
  // daily cap, like Flux's. See refusal-messages.ts for which sentence says
  // what about money, and why.
  chargeBudget(budget);
  const base64 = await generateImageWithOpenAI(prompt, openAiRefs);
  return persistBase64(base64);
}
