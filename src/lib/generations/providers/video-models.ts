// Catalog of switchable video generation models, all hosted behind fal.ai's
// single API/key. Add an entry here (with a confirmed fal.ai endpoint id) to
// make a new model selectable — no other code needs to change, which is the
// "easy to add a fallback provider" architecture the brief asked for.
//
// durations: every duration fal.ai actually accepts for this model (server-
// validated in actions.ts, not just a UI convenience), each with its own
// creditWeight — how many of the user's monthly plan credits ONE generation
// at that specific length consumes (see checkGenerationAllowance in
// actions.ts). Real incident, 2026-08-07: every video used to render at a
// fixed 5 seconds because nothing let a user ask for longer, and credits
// were priced per-model only — a 10s video cost the same 1 credit as a 5s
// one despite costing us roughly 2x on fal.ai's side. Weights below are
// pegged to fal.ai's real, confirmed per-second pricing (not guessed) at a
// fixed exchange rate of 1 credit ≈ $0.28 — the value Kling 1.6's original
// weight of 1 already implied at its 5s default ($0.056/sec × 5s = $0.28).
// One entry per model must have `default: true`, matching that model's own
// default duration on fal.ai's side.

export type VideoDurationOption = {
  seconds: number;
  creditWeight: number;
  default?: boolean;
};

export const VIDEO_MODELS = [
  {
    id: "kling",
    // fal.ai's real per-second price, for pricingAudit() below.
    costPerSecondUsd: 0.056,
    // This used to point at "v2.1/standard/text-to-video", which doesn't
    // exist — fal.ai's Kling 2.1 "standard" tier is image-to-video only
    // (confirmed against fal.ai's own docs, 2026-08-07). Every plain
    // text-to-video request was hitting a guaranteed 404, burning a full
    // retry cycle (Claude + OpenAI calls, repeated) on a request that could
    // never succeed. v1.6 standard is fal.ai's real, working text-to-video
    // endpoint at this tier — and actually cheaper ($0.056/sec) than the
    // price this was already advertising.
    name: "Kling 1.6",
    falEndpoint: "fal-ai/kling-video/v1.6/standard/text-to-video",
    recommended: true,
    description: "Best price-to-quality ratio — about $0.056 per second.",
    // Confirmed against fal.ai's docs, 2026-08-07: every v1.6 standard
    // endpoint (text-to-video, elements, image-to-video) shares the same
    // duration enum — exactly 5 or 10 seconds, nothing in between.
    durations: [
      { seconds: 5, creditWeight: 1, default: true },
      { seconds: 10, creditWeight: 2 },
    ] satisfies VideoDurationOption[],
  },
  {
    id: "kling-o3",
    // fal.ai's real per-second price, for pricingAudit() below.
    costPerSecondUsd: 0.08,
    // Kling's newest generation (2026-08-07: confirmed via fal.ai's model
    // catalog that v1.6 was no longer their latest — this is). Standard
    // tier (not Pro): same "start frame + prompt" shape we already send for
    // the baseline single-photo anchor, confirmed against fal.ai's own
    // parameter table at fal.ai/models/fal-ai/kling-video/o3/standard/image-to-video —
    // notably it takes `image_url` (not `start_image_url`, which trips up
    // people used to the v3 endpoints), and has no aspect_ratio parameter
    // (inherits the input image's shape, same caveat as our old single-photo
    // path).
    //
    // generate_audio: fal.ts requests this as true by default (real
    // incident, 2026-08-07: the first O3 integration never set it, and it
    // defaults OFF on fal.ai's side — silent video even with a talking
    // character in the prompt). It's turned off only when the separate
    // ElevenLabs/Sync Labs dialogue pipeline is also going to run on the
    // same video (see pipeline.ts), since Sync Labs' lipsync step re-renders
    // the video with its own audio anyway. $0.112/sec WITH audio (the price
    // that actually applies, since audio is on by default) is exactly 2x
    // Kling 1.6's $0.056/sec — a clean, accurate credit weight, not a
    // rounded approximation.
    name: "Kling O3",
    falEndpoint: "fal-ai/kling-video/o3/standard/image-to-video",
    recommended: false,
    description: "Kling's newest model — stronger prompt-following, detail, and native audio. About $0.112 per second.",
    // Confirmed against fal.ai's docs, 2026-08-07: O3 standard's real range
    // is 3-15s in 1s steps. Only offering 5/10/15 here rather than all 13
    // values — enough range to matter, without turning the picker into a
    // slider for a difference most people won't notice second-to-second.
    durations: [
      { seconds: 5, creditWeight: 2, default: true },
      { seconds: 10, creditWeight: 4 },
      { seconds: 15, creditWeight: 6 },
    ] satisfies VideoDurationOption[],
  },
  {
    id: "veo",
    // fal.ai's real per-second price, for pricingAudit() below.
    costPerSecondUsd: 0.40,
    name: "Veo 3.1",
    falEndpoint: "fal-ai/veo3.1",
    recommended: false,
    // Real correction, 2026-08-07: this used to say "~$0.75/sec", which was
    // never fal.ai's actual price — checked directly against fal.ai's own
    // pricing table while wiring up duration and found the real number.
    // Standard tier, 720p/1080p, audio on (our default): $0.40/sec.
    description: "Google's flagship model. Higher cost (~$0.40/sec with audio), strongest quality.",
    // Confirmed against fal.ai's docs, 2026-08-07: Veo 3.1's duration enum
    // is exactly 4s/6s/8s (note the "s" suffix fal.ai expects in the actual
    // request body — see formatDuration in fal.ts) — an 8s cap per
    // generation, unlike Kling's 10-15s ceiling.
    //
    // Credit weights below were left flat at 1 when this model was first
    // added — flagged then as a real underpricing (its true cost is far
    // above Kling's) that was a business call, not a technical one, and
    // deliberately not decided unilaterally. Now that credits scale with
    // duration for every model (2026-08-07, user's explicit call), the same
    // $0.28/credit rate has been applied here too rather than leaving Veo as
    // the one model where a longer video is still free against the plan —
    // worth double-checking these land where you want them.
    // Briefly raised to 12 on 2026-08-11 on the false premise that 11 sold
    // below cost. It never did: $0.28 is the COST basis used to keep weights
    // proportional to provider spend, not the price of a credit. A credit
    // actually sells for about $1.80-2.15 depending on plan, so 8s of Veo
    // earns roughly $20 against $3.20 of cost. Reverted.
    durations: [
      { seconds: 4, creditWeight: 6 },
      { seconds: 6, creditWeight: 9 },
      { seconds: 8, creditWeight: 11, default: true },
    ] satisfies VideoDurationOption[],
  },
  {
    id: "kling-2.5",
    // fal.ai's real per-second price, for pricingAudit() below.
    costPerSecondUsd: 0.07,
    name: "Kling 2.5 Turbo Pro",
    falEndpoint: "fal-ai/kling-video/v2.5-turbo/pro/image-to-video",
    recommended: false,
    // Confirmed against fal.ai's own docs, 2026-08-11 (llms.txt for
    // fal-ai/kling-video/v2.5-turbo/pro/image-to-video), not guessed:
    // $0.35 for 5s, +$0.07 for each additional second. `image_url` is
    // REQUIRED — this is a first-frame endpoint, so it inherits the same
    // "clip opens in the reference photo's exact pose" behaviour as 1.6's
    // elements endpoint, and it has no aspect_ratio parameter (the input
    // image's shape wins, same as Kling O3 — fal.ts reframes the photo first
    // to work around it). It does accept negative_prompt and cfg_scale.
    description: "Sharper motion and prompt accuracy than 1.6 (~$0.07/sec). Needs a reference photo.",
    durations: [
      { seconds: 5, creditWeight: 2, default: true },
      { seconds: 10, creditWeight: 3 },
    ] satisfies VideoDurationOption[],
  },
  {
    id: "seedance",
    // fal.ai's real per-second price, for pricingAudit() below.
    costPerSecondUsd: 0.4730,
    name: "Seedance 2.5",
    falEndpoint: "bytedance/seedance-2.5/reference-to-video",
    recommended: false,
    // The one model here whose reference images are IDENTITY references
    // rather than the opening frame. fal's schema: "Reference images to guide
    // video generation. Refer to them in the prompt as @Image1, @Image2."
    // That is what stops every clip beginning frozen in the photographed
    // pose, and what lets several camera angles genuinely differ from frame
    // one while still being the same person.
    //
    // Pricing confirmed 2026-08-11: $0.4730 per second at 720p. At the
    // established $0.28/credit that's 8.45 credits for 5s and 16.9 for 10s,
    // rounded UP — rounding down would sell the most expensive model in the
    // catalogue at a loss on every generation.
    //
    // 480p exists at $0.2205/sec but is deliberately not offered: a visibly
    // softer result undercuts the reliability-and-quality positioning, and a
    // second resolution would mean pricing every model by a duration x
    // resolution matrix rather than duration alone.
    description: "Holds a character across clips up to 30s without copying the photo's pose. Premium (~$0.47/sec).",
    // fal's schema allows 4-30 seconds (or "auto"). This originally shipped
    // capped at 5 and 10 because it was copied from Kling's enum rather than
    // read off Seedance's own — which threw away the single thing that most
    // distinguishes this model: it holds a character across a full 30-second
    // take, where everything else here tops out at 8-15.
    //
    // A ladder rather than all 27 values: a picker with 27 options is not a
    // choice, it's a chore. Weights are cost / $0.28, rounded up.
    durations: [
      { seconds: 5, creditWeight: 9, default: true },
      { seconds: 10, creditWeight: 17 },
      { seconds: 15, creditWeight: 26 },
      { seconds: 20, creditWeight: 34 },
      { seconds: 30, creditWeight: 51 },
    ] satisfies VideoDurationOption[],
  },
] as const;

export type VideoModelId = (typeof VIDEO_MODELS)[number]["id"];
export type VideoModel = (typeof VIDEO_MODELS)[number];

export function getVideoModel(id: string): VideoModel {
  return VIDEO_MODELS.find((m) => m.id === id) ?? VIDEO_MODELS.find((m) => m.recommended)!;
}

export function getDefaultDurationSeconds(model: VideoModel): number {
  return model.durations.find((d) => d.default)?.seconds ?? model.durations[0].seconds;
}

// Server-side source of truth for what a specific duration choice actually
// costs — never trust a duration value that arrived via form data without
// checking it against this first (see runGeneration/runMultiAngleGeneration).
export function getDurationCreditWeight(model: VideoModel, seconds: number): number {
  const match = model.durations.find((d) => d.seconds === seconds);
  if (match) return match.creditWeight;
  const fallback = model.durations.find((d) => d.default) ?? model.durations[0];
  return fallback.creditWeight;
}

export function isValidDuration(model: VideoModel, seconds: number): boolean {
  return model.durations.some((d) => d.seconds === seconds);
}

// Adding spoken dialogue to a video runs two extra paid steps that a silent
// video never touches: ElevenLabs speech synthesis, then a Sync Labs lipsync
// pass that re-renders the whole clip. Until 2026-08-10 both were free to
// the user — creditWeight was identical with or without dialogue — which the
// pricing analysis flagged as an unmetered cost path.
//
// Scaled by DURATION, not by the model's own credit weight. Lipsync cost
// tracks how many seconds of video it has to re-render; it doesn't care
// whether those seconds came from Kling or Veo. Charging a multiple of the
// model weight would have made dialogue on Veo cost 11 extra credits for the
// same lipsync work Kling pays 1 for.
//
// One credit per 5 seconds is roughly cost-parity at the $0.28/credit peg
// this file already uses — dialogue about doubles the cost of a short clip.
// The underlying TTS and lipsync per-second prices are ESTIMATES, unlike the
// video prices above which were confirmed against fal.ai's own pricing page;
// worth checking against a real invoice and adjusting.
const DIALOGUE_SECONDS_PER_CREDIT = 5;

export function getDialogueCreditWeight(seconds: number): number {
  return Math.max(1, Math.ceil(seconds / DIALOGUE_SECONDS_PER_CREDIT));
}

// What one generation of this model costs at its default length.
//
// This is the number the picker sorts and labels by, because it's the one a
// person is actually deciding between: "this generation will cost me N of my
// credits". Sorting by cost-per-second looked defensible but ranked Veo above
// Seedance, when a default Veo clip (8s, 11 credits) costs more than a default
// Seedance one (5s, 9) — which is not what anyone reading the menu expects.
export function defaultCreditCost(model: VideoModel): number {
  const seconds = getDefaultDurationSeconds(model);
  return model.durations.find((d) => d.seconds === seconds)?.creditWeight ?? model.durations[0].creditWeight;
}

// Average credits per second, used only to break ties between models that
// cost the same at their default length.
export function creditsPerSecond(model: VideoModel): number {
  const rates = model.durations.map((d) => d.creditWeight / d.seconds);
  return rates.reduce((sum, r) => sum + r, 0) / rates.length;
}

export const VIDEO_MODELS_BY_PRICE: readonly VideoModel[] = [...VIDEO_MODELS].sort(
  (a, b) =>
    defaultCreditCost(a) - defaultCreditCost(b) || creditsPerSecond(a) - creditsPerSecond(b),
);

// The COST basis, not the price.
//
// This is the provider spend one credit is meant to represent, and its only
// job is keeping weights proportional across models so a minute of Veo costs
// the user proportionally more allowance than a minute of Kling.
//
// It is emphatically NOT what a credit sells for. Plans work out at roughly
// $1.80-2.15 per credit (see lib/pricing.ts), so gross margin is around 85%.
// Confusing the two led to a real mistake on 2026-08-11 — Veo was declared
// "sold at a loss" and repriced on that basis, when it was earning about 85%.
// If you find yourself comparing a credit weight against this number and
// calling the difference margin, that is the same error.
export const COST_BASIS_USD_PER_CREDIT = 0.28;

// Options whose credit weight is out of step with what they actually cost.
//
// NOT a profitability check — every model here is comfortably profitable at
// current plan prices. This catches weights that have drifted relative to
// provider cost, which shows up as one model quietly consuming less of
// someone's allowance per dollar of spend than another. That matters when a
// provider changes its prices and a weight isn't updated to match.
//
// Surfaced on Admin > AI providers so drift is visible rather than assumed
// away.
export function pricingAudit(): {
  modelId: string;
  name: string;
  seconds: number;
  credits: number;
  allowanceValueUsd: number;
  costUsd: number;
}[] {
  const losses = [];
  for (const model of VIDEO_MODELS) {
    for (const d of model.durations) {
      const allowanceValueUsd = d.creditWeight * COST_BASIS_USD_PER_CREDIT;
      const costUsd = model.costPerSecondUsd * d.seconds;
      // Half a cent of tolerance for floating point, not for genuine losses.
      if (allowanceValueUsd + 0.005 < costUsd) {
        losses.push({
          modelId: model.id,
          name: model.name,
          seconds: d.seconds,
          credits: d.creditWeight,
          allowanceValueUsd,
          costUsd,
        });
      }
    }
  }
  return losses;
}
