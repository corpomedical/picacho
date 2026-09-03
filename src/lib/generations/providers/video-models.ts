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
    // fal.ai's real per-second price, for pricingAudit() below. $0.112/s is
    // the WITH-audio price — the one that actually applies, since fal.ts
    // requests generate_audio by default (see the comment below). This held
    // the stale $0.08 no-audio figure until 2026-08-19, silently weakening
    // the audit for the price that was really being paid; the 2/4/6 weights
    // were always computed against $0.112 and pass exactly.
    costPerSecondUsd: 0.112,
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
    // the one model where a longer video is still free against the plan.
    //
    // 8s is 12, not 11 (settled 2026-08-19, after flip-flopping: raised to
    // 12 on 2026-08-11 for the wrong reason — "sold below cost", which
    // confused the cost basis with the sale price — then reverted). The
    // right reason is this file's own formula: weights are cost / $0.28
    // rounded UP (see Seedance and O3 Pro), and $0.40/sec × 8s = $3.20 /
    // $0.28 = 11.43 → 12. At 11 the option sits below its own cost line
    // forever, so pricingAudit() flagged it on every Admin > AI providers
    // load — a permanent false alarm that trains people to ignore the one
    // audit meant to catch real provider price drift. 4s (5.71→6) and 6s
    // (8.57→9) already rounded up.
    durations: [
      { seconds: 4, creditWeight: 6 },
      { seconds: 6, creditWeight: 9 },
      { seconds: 8, creditWeight: 12, default: true },
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
    id: "seedance-2",
    // fal.ai's real per-second price, for pricingAudit() below — 720p,
    // standard tier, image references only ($0.3024/sec; confirmed against
    // fal's pricing page 2026-08-21).
    costPerSecondUsd: 0.3024,
    name: "Seedance 2.0",
    falEndpoint: "bytedance/seedance-2.0/reference-to-video",
    recommended: false,
    // The PHOTOREAL Seedance. ByteDance's 2.5 endpoints reject reference
    // images that look like real people ("content_policy_violation /
    // partner_validation_failed" — verified live 2026-08-21 on both the
    // reference and image-to-video endpoints).
    //
    // RE-VERIFIED 2026-08-29, prompted by a competitor demo doing exactly
    // this (Lovart + Seedance 2.5, camera angles from the creator's own
    // video). Still blocked on fal, and now known to be blocked for BOTH
    // input kinds: image_urls AND video_urls come back with the same
    // partner_validation_failed. Two things worth remembering before anyone
    // re-litigates this: rejections are FREE (balance unchanged across three
    // test submissions), and fal reports the queue job as COMPLETED with the
    // policy error in the RESPONSE BODY — status alone will fool you.
    //
    // It is an ACCESS TIER, not a model limit — and as of 2026-09-03 we know
    // exactly what tier, because the whole picture was researched rather than
    // inferred. Four facts worth not re-deriving:
    //
    //   1. 2.0 IS NO LONGER SAFE EITHER. It refused a character's six
    //      reference photos twice on 2026-09-03 — the same photos, unchanged
    //      since 2026-08-15, that it accepted on 08-25. The line moves one
    //      way. Platform-wide, 2.5 has never once succeeded here: 21
    //      attempts, 18 policy refusals, 0 videos.
    //   2. THE SANCTIONED ROUTE TAKES ASSET IDs, NOT IMAGE URLs. ByteDance
    //      runs a private real-human asset library: the person passes a
    //      one-time liveness check, which yields an asset group (the person)
    //      and asset ids (their images), and the model call cites
    //      asset://<id>. fal's reference-to-video schema has no field for
    //      that — its inputs are prompt, image_urls, video_urls, audio_urls,
    //      resolution, duration, aspect_ratio, generate_audio, seed,
    //      end_user_id — so no amount of work on this side of fal reaches it.
    //   3. fal CHARGES EXACTLY 2.00x BYTEDANCE'S LIST. fal quotes Seedance
    //      2.0 reference-to-video at $14.00/M tokens against BytePlus
    //      ModelArk's $7.00/M; 2.5 is $21.40 against $10.70. The $0.3024/sec
    //      below is a reseller price, not the market: direct is ~$0.152/sec,
    //      which would put 2.0 beside Kling O3 Pro rather than at double it.
    //      The credit weights below therefore all halve if the lane ever
    //      moves to ModelArk direct.
    //   4. A COMPETITOR'S "WORKING SEEDANCE" IS NOT A BETTER PAYLOAD.
    //      Higgsfield runs an official BytePlus partnership with a custom
    //      SKU, and routes real people through a trained identity layer
    //      whose GENERATED portrait is what reaches the model. Neither is
    //      reachable by tuning our request.
    //
    // See docs/BYTEPLUS_ENQUIRY.md for the four questions that decide whether
    // Picacho can take the sanctioned route, and do not re-litigate this from
    // memory: the answer has changed twice and both times the evidence was in
    // production data, not in anyone's recollection.
    //
    // Same identity-reference contract
    // as 2.5 — image_urls cited as @Image1, schema is a compatible superset
    // (aspect_ratio, generate_audio, duration 4-15) — so fal.ts reuses one
    // request builder for both.
    //
    // Weights: cost / $0.28, rounded up ($1.51/5s → 6, $3.02/10s → 11,
    // $4.54/15s → 17).
    description: "Identity-referenced clips of photoreal people, up to 15s (~$0.30/sec).",
    durations: [
      { seconds: 5, creditWeight: 6, default: true },
      { seconds: 10, creditWeight: 11 },
      { seconds: 15, creditWeight: 17 },
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
    // Repositioned 2026-08-21 (operator call): ByteDance's 2.5 endpoints
    // REJECT photoreal human likenesses (anti-deepfake policy, verified
    // live — see seedance-2 above for the full story), so this is now the
    // ILLUSTRATED/MASCOT lane: a cartoon mascot sails through the same
    // filter (verified with a generated clip) and 2.5's 30-second takes are
    // exactly what mascot explainers want. Photoreal characters belong on
    // Seedance 2.0 or Kling O3 Pro.
    description:
      "Illustrated & mascot characters up to 30s — the provider blocks photoreal people. Premium (~$0.47/sec).",
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
  {
    id: "kling-o3-pro",
    // fal.ai's real per-second price, for pricingAudit() below. $0.14/sec
    // WITH audio — the price that actually applies, since fal.ts requests
    // generate_audio true by default (same reasoning as Kling O3 above) —
    // $0.112/sec without.
    costPerSecondUsd: 0.14,
    name: "Kling O3 Pro (reference)",
    falEndpoint: "fal-ai/kling-video/o3/pro/reference-to-video",
    recommended: false,
    // Kling's own answer to Seedance's identity references (confirmed
    // against fal.ai's docs, 2026-08-19:
    // fal.ai/models/fal-ai/kling-video/o3/pro/reference-to-video/api).
    // The character's photos go in as `elements` — IDENTITY references cited
    // in the prompt as @Element1, not the opening frame — so the clip
    // doesn't start frozen in the photographed pose the way the first-frame
    // endpoints (2.5 Turbo Pro, O3 standard) do. The endpoint also takes an
    // optional start_image_url, deliberately NOT used here: a first-frame
    // lock is exactly what this model exists to escape. Unlike O3 standard
    // it has a real aspect_ratio parameter (16:9/9:16/1:1), so no reframe
    // workaround is needed. See the branch in fal.ts for the full schema.
    description:
      "Kling's identity-reference model — anchors to the photo without copying its pose. About $0.14 per second. Needs a reference photo.",
    // Confirmed against fal.ai's docs, 2026-08-19: duration is an integer
    // string, 3-15s, default "5". Same 5/10/15 ladder as O3 standard rather
    // than all 13 values, for the same reason (see above).
    //
    // Weights are cost / $0.28, rounded up, same as Seedance: $0.14/sec
    // gives $0.70 for 5s = 2.5 → 3 credits, $1.40 for 10s = 5 exactly, and
    // $2.10 for 15s = 7.5 → 8 credits. Dialogue's surcharge stacks on top
    // via getDialogueCreditWeight, same as every other model.
    durations: [
      { seconds: 5, creditWeight: 3, default: true },
      { seconds: 10, creditWeight: 5 },
      { seconds: 15, creditWeight: 8 },
    ] satisfies VideoDurationOption[],
  },
  {
    id: "minimax-h3",
    // fal.ai's real per-second price, for pricingAudit() below. This is the
    // 768P rate, and it is only the right number because the branch in
    // fal.ts SENDS resolution: "768P" explicitly.
    //
    // READ THAT AGAIN BEFORE CHANGING THE BRANCH. fal's schema defaults this
    // endpoint's resolution to "2K", not to its cheapest tier — verbatim
    // from the model page, 2026-09-01: "$0.05 per second at 480p, $0.06 per
    // second at 768p, $0.13 per second at 2K and $0.16 per second at 4K".
    // Dropping the parameter would not restore some neutral default; it
    // would silently bill every render at $0.13/sec against weights built
    // for $0.06 — more than double, on the one lane most likely to become
    // the busiest. The 2K tier is offered deliberately and priced
    // separately in video-resolution.ts.
    costPerSecondUsd: 0.06,
    name: "MiniMax H3 (reference)",
    // NOT under the fal-ai/ prefix, unlike every other endpoint in this
    // file — MiniMax's own namespace on fal is `minimax/`. Harmless here
    // (submitToQueue interpolates the string as given, and the status and
    // response URLs come back from fal's submit response rather than being
    // rebuilt), but it will look like a typo to the next reader, so: it is
    // not. The older Hailuo models keep fal-ai/minimax/hailuo-02/....
    falEndpoint: "minimax/h3/reference-to-video",
    recommended: false,
    // MiniMax H3, announced 2026-07-31 (informally "Hailuo 3.0"). Same job
    // as Seedance and O3 Pro above — the photos say WHO is in the clip, not
    // what frame one looks like — but with the widest identity budget in
    // this catalogue: fal's schema takes up to 9 subject/style reference
    // images, plus 3 reference videos and 3 reference audio clips, capped
    // at 12 files combined. We send at most 5 (see fal.ts for why).
    //
    // Audio is not a parameter on this endpoint: H3 generates native stereo
    // sound in the same pass as the picture, always. There is no
    // generate_audio to turn off, so a dialogue render simply has its audio
    // replaced by the Sync Labs lipsync pass, exactly as it would on any
    // other model — the cost of the native track is already in the
    // per-second price either way.
    description:
      "MiniMax's newest model — the widest identity reference set here (up to 5 photos), always with native audio. About $0.06 per second at 768p. Needs a reference photo.",
    // fal's schema types duration as an INTEGER with a 5 default (every
    // Kling endpoint wants a numeric string instead — see formatDuration,
    // which this lane deliberately does not use). Range is 5-15s; the same
    // 5/10/15 ladder as O3 and O3 Pro rather than all eleven values, for
    // the reason given on Kling O3 above.
    //
    // Weights are cost / $0.28 rounded up, like every other row in this
    // file: $0.06/sec gives $0.30 for 5s = 1.07 -> 2 credits, $0.60 for 10s
    // = 2.14 -> 3, and $0.90 for 15s = 3.21 -> 4. Cheaper at every length
    // than the O3 Pro reference lane above (3/5/8), which is the closest
    // thing to it in the catalogue.
    durations: [
      { seconds: 5, creditWeight: 2, default: true },
      { seconds: 10, creditWeight: 3 },
      { seconds: 15, creditWeight: 4 },
    ] satisfies VideoDurationOption[],
  },
  {
    id: "wan-turbo",
    // A FLAT price expressed per second, which is the one place this
    // catalogue's cost model bends — read this before changing anything.
    //
    // fal bills both Wan turbo lanes per VIDEO, not per second. Verbatim
    // from both model pages, 2026-09-01, identical on each: "Your request
    // will cost $0.10 per video for 720p, $0.075 per video for 580p, $0.05
    // per video for 480p." The catalogue has only costPerSecondUsd, and
    // pricingAudit() multiplies it by the duration — so the flat $0.10 is
    // recorded here as $0.02 x the single 5s option it offers, which makes
    // the audit exact rather than approximate.
    //
    // That equivalence holds ONLY while this model offers exactly one
    // duration. Add a second one and the audit silently starts asserting a
    // cost fal does not charge (it would claim $0.20 for a 10s clip that
    // still bills $0.10) — overcharging the user's allowance for a render
    // that got no more expensive. If a longer option is ever wanted here,
    // the honest fix is a flat-price field in VideoDurationOption, not a
    // second row against this rate.
    costPerSecondUsd: 0.02,
    name: "Wan 2.2 Turbo",
    // The TEXT-to-video lane is the catalogue endpoint, exactly like Kling
    // 1.6 above: requiresReferenceImage() reads this string, and false is
    // the right answer because the lane works with no photo at all. When a
    // character photo IS present the branch in fal.ts swaps to
    // fal-ai/wan/v2.2-a14b/image-to-video/turbo — same flat $0.10 at 720p,
    // so the swap cannot change what a render costs.
    falEndpoint: "fal-ai/wan/v2.2-a14b/text-to-video/turbo",
    recommended: false,
    // Replaced Kling 1.6 as the free tier on 2026-09-01 (operator call:
    // "we are not running a charity"). The old peg was $0.056/sec x 5s =
    // exactly $0.28 against a 1-credit allowance of exactly $0.28 — zero
    // headroom, passing pricingAudit() only on its half-cent floating-point
    // tolerance, so any fal price rise on Kling 1.6 would have turned every
    // free render into a loss. This is $0.10 for the same 5 seconds at the
    // same 720p: 64% less provider spend, with $0.18 of real headroom.
    //
    // Why this model and not something cheaper. fal lists text-to-video
    // endpoints down to $0.02, but they are all pure text-to-video — and a
    // free render that cannot contain the user's own character is the wrong
    // saving for a character-consistency product, because showing someone
    // their character IS the conversion. Wan 2.2 A14B turbo is the cheapest
    // model found that has BOTH lanes at one flat price, so the free tier
    // keeps doing what it does today.
    description:
      "Fast and very cheap — a 720p clip at a flat $0.10, whatever the length. Silent, and anchors to one photo rather than several.",
    // Length is decided by the ENDPOINT, not by us. The text-to-video lane
    // defaults to num_frames 81 at frames_per_second 16 (~5.06s) and the
    // image-to-video lane exposes no frame controls at all, so neither
    // takes a duration parameter and fal.ts sends none. This row exists to
    // carry the credit weight and to label the picker honestly at the
    // length the endpoint actually returns; it is not a request.
    durations: [{ seconds: 5, creditWeight: 1, default: true }] satisfies VideoDurationOption[],
  },
  {
    id: "gemini-omni",
    // fal's real per-second price at the 720p tier this lane renders at.
    // Verbatim from the model page, 2026-09-01: "Billing is calculated per
    // second of output video, by resolution. For 360p, your request will
    // cost $0.03 per second; for 720p, $0.10 per second; for 1080p, $0.15
    // per second; and for 4K, $0.30 per second."
    //
    // 720p is also fal's own default here — unlike MiniMax H3, whose default
    // is its EXPENSIVE tier. The branch still pins it explicitly: a provider
    // default is not a promise, and this catalogue has been caught by that
    // once already.
    //
    // 360p at $0.03/sec is deliberately not offered. video-resolution.ts
    // expresses resolutions ABOVE a model's default, and dropping the base
    // to 360p to save a credit would make the newest, best-ranked model in
    // the catalogue look worse than the free tier.
    costPerSecondUsd: 0.10,
    name: "Gemini Omni Flash 1.1",
    // Google's namespace on fal, like MiniMax's — not the fal-ai/ prefix.
    // Text-to-video is the catalogue endpoint so requiresReferenceImage()
    // reads false; the branch in fal.ts swaps to
    // google/gemini-omni-flash/v1.1/reference-to-video when a character photo
    // exists — the REFERENCE lane, not image-to-video, so the clip does not
    // open frozen on the photograph. Both lanes bill at the same per-second
    // rate, so the swap cannot change the price.
    falEndpoint: "google/gemini-omni-flash/v1.1/text-to-video",
    recommended: false,
    // Ranked around the top of the Artificial Analysis text-to-video arena
    // (~Elo 1,237, roughly second overall) at $0.10/sec against Veo 3.1's
    // $0.40 — a quarter of the price of the model this catalogue has been
    // calling its flagship. Native synchronised audio comes with every
    // render and has no parameter to disable it, so a dialogue run simply
    // has its track replaced by the Sync Labs pass, same as MiniMax H3.
    description:
      "Google's newest — top-ranked quality with native audio, at a quarter of Veo's price. About $0.10 per second at 720p.",
    // fal types duration as an INTEGER (not the numeric string every Kling
    // endpoint wants), range 3-10, default 8. The 5/8/10 ladder mirrors the
    // rest of the catalogue rather than exposing all eight values, and 8 is
    // marked default because it is the endpoint's OWN default — the rule
    // this file's header sets for every entry.
    //
    // Weights are cost / $0.28 rounded up: $0.50 for 5s = 1.79 -> 2,
    // $0.80 for 8s = 2.86 -> 3, $1.00 for 10s = 3.57 -> 4.
    durations: [
      { seconds: 5, creditWeight: 2 },
      { seconds: 8, creditWeight: 3, default: true },
      { seconds: 10, creditWeight: 4 },
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

// True when the model's fal endpoint starts FROM an image (image-to-video or
// reference-to-video) and therefore cannot run without a reference frame — a
// saved character photo or a photo attached to the message. text-to-video
// models (Kling 1.6, Veo) return false. Used to reject before any credit is
// spent, including after the circuit breaker substitutes into such a model.
export function requiresReferenceImage(model: VideoModel): boolean {
  return /image-to-video|reference-to-video/.test(model.falEndpoint);
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
// One credit per THREE seconds (operator-approved 2026-08-31; was 5). The
// old rate was built on estimated provider prices — its own comment said
// "worth checking against a real invoice" — and the check came back showing
// every dialogue clip sold below cost: Sync Lipsync's published price is
// $5/minute ($0.0833/s) over the WHOLE clip, plus ElevenLabs TTS at $0.10
// per 1k characters, against the $0.056/s the old rate charged. At 1/3s
// every duration covers the invoice on the same $0.28 basis as everything
// else: 5s -> 2cr ($0.56 vs ~$0.43 cost), 10s -> 4cr, 15s -> 5cr. Audited
// below like every other price in this file.
export const SYNC_LIPSYNC_PER_SECOND_USD = 5 / 60; // fal: "$5 per minutes", read 2026-08-31
export const DIALOGUE_TTS_ALLOWANCE_USD = 0.01; // ~100 chars of ElevenLabs at $0.10/1k
const DIALOGUE_SECONDS_PER_CREDIT = 3;

export function getDialogueCreditWeight(seconds: number): number {
  return Math.max(1, Math.ceil(seconds / DIALOGUE_SECONDS_PER_CREDIT));
}

// What one generation of this model costs at its default length.
//
// This is the number the picker sorts and labels by, because it's the one a
// person is actually deciding between: "this generation will cost me N of my
// credits". Sorting by cost-per-second looked defensible but ranked Veo above
// Seedance, when a default Veo clip (8s, 12 credits) costs more than a default
// Seedance one (5s, 9) — which is not what anyone reading the menu expects.
export function defaultCreditCost(model: VideoModel): number {
  const seconds = getDefaultDurationSeconds(model);
  return model.durations.find((d) => d.seconds === seconds)?.creditWeight ?? model.durations[0].creditWeight;
}

// What ONE free-trial generation costs in credits: the free model's weight at
// its own default duration — the exact shape runGeneration pins trial
// accounts to (cheapest model, default length, no dialogue).
//
// Derived rather than written down (2026-08-19) because it used to be a bare
// `=== 1` inside checkGenerationAllowance, which made the trial's whole
// existence depend on the free model happening to cost exactly 1 credit —
// the single point of failure: reassign FREE_TIER_VIDEO_MODEL_ID to any
// 2-credit model and every trial request would silently stop matching the
// gate, bricking the free tier for all new signups. Computed from the
// catalog, the gate follows the model choice automatically.
// Relative, not "@/": vitest runs configless here, and aliased imports made
// this whole catalogue untestable (2026-08-31).
import { videoResolutionOffers } from "./video-resolution";
import { FREE_TIER_VIDEO_MODEL_ID } from "../../plans";
export const FREE_TIER_GENERATION_CREDITS = defaultCreditCost(
  getVideoModel(FREE_TIER_VIDEO_MODEL_ID),
);

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
// It is emphatically NOT what a credit sells for. Plans work out at $0.499
// (Elite) to $0.75 (Basic) per credit — see lib/pricing.ts.
//
// CORRECTED 2026-08-30. This comment used to say "roughly $1.80-2.15 per
// credit, so gross margin is around 85%". That was true until the 2026-08-19
// restructure multiplied every tier's allowance 3-4x at unchanged prices,
// which cut the realized rate to the range above — the 85% figure outlived
// it by eleven days and was wrong by about 3x. It sat directly over
// pricingAudit(), so it was also the number anyone reading this file would
// have quoted.
//
// Measured against production on 2026-08-30: 1.132 provider attempts per
// generation (the pricing model had assumed 1.57 — the 2026-08-10 pipeline
// fixes worked and nobody re-measured). All-in, a credit costs about
// $0.28 provider + $0.02 drafting, x1.132 = ~$0.34. Net of 21% VAT and
// Stripe fees, real gross margin is roughly 42% on Basic, 33% Starter,
// 25% Growth, 23% Studio, 16% Elite — and about 1% on Elite ANNUAL, which
// needs a pricing decision rather than a comment. Re-measure after any
// change to retry behavior; do not let this paragraph go stale again.
//
// Confusing cost basis with margin led to a real mistake on 2026-08-11 —
// Veo was declared "sold at a loss" and repriced on that basis. If you find
// yourself comparing a credit weight against this number and calling the
// difference margin, that is the same error.
export const COST_BASIS_USD_PER_CREDIT = 0.28;

// The most expensive SINGLE render this catalogue can produce, in provider
// dollars (2026-08-30).
//
// Used to turn an abstract fal balance into a sentence that means something:
// a balance below this number cannot complete the priciest render the product
// offers, so someone WILL hit a failure that is our fault rather than theirs.
// Derived from the catalogue instead of hardcoded so it follows the models —
// today the answer is Seedance 2.5 at 30 seconds, and it should keep being
// whatever the answer actually is.
//
// Includes priced resolutions: Veo at 4K bills $0.60/sec against $0.40, and a
// ceiling that ignored that would understate the worst case.
export function maxSingleRenderCostUsd(): number {
  let worst = 0;
  for (const model of VIDEO_MODELS) {
    const longest = Math.max(...model.durations.map((d) => d.seconds));
    worst = Math.max(worst, model.costPerSecondUsd * longest);
    for (const offer of videoResolutionOffers(model.id)) {
      if (offer.costPerSecondUsd) {
        worst = Math.max(worst, offer.costPerSecondUsd * longest);
      }
    }
  }
  return worst;
}

// Options whose credit weight is out of step with what they actually cost.
//
// NOT a profitability check — every model here is profitable at current
// monthly plan prices (see the margin note above; Elite ANNUAL is the one
// row that is not comfortably so). This catches weights that have drifted
// relative to
// provider cost, which shows up as one model quietly consuming less of
// someone's allowance per dollar of spend than another. That matters when a
// provider changes its prices and a weight isn't updated to match.
//
// Surfaced on Admin > AI providers so drift is visible rather than assumed
// away.
// Kling's start/end-frame lane runs on a DIFFERENT, pricier endpoint than
// the model's own weights assume: fal-ai/kling-video/v2.1/pro/image-to-video,
// "$0.49 for 5s, $0.098 per additional second" (read from fal's published
// pricing 2026-08-31), against the $0.056/s the Kling 1.6 weights are built
// on. Found by the 2026-08-31 inspection: every storyboard render was
// charged 1 credit ($0.28 basis) while costing $0.49 — a loss on each one.
//
// Re-pointing at the v1.6 image-to-video endpoint was checked first and is
// NOT possible: fal's docs show it has no tail_image_url, and the end frame
// is the feature. So the price follows the cost, like the 4K weights.
export const KLING_STORYBOARD_PER_SECOND_USD = 0.098;

/**
 * Extra credits when a Kling render carries a start/end frame — the
 * difference between the storyboard endpoint's real per-second price and the
 * base weight already charged, rounded up on the same $0.28 basis as every
 * weight in the catalogue. 5s: +1 (2 total). 10s: +2 (4 total).
 */
export function storyboardFrameExtraCredits(modelId: string, seconds: number): number {
  if (modelId !== "kling") return 0;
  const model = VIDEO_MODELS.find((m) => m.id === modelId);
  if (!model) return 0;
  const base =
    model.durations.find((d) => d.seconds === seconds)?.creditWeight ??
    getDurationCreditWeight(model, seconds);
  const total = Math.ceil((KLING_STORYBOARD_PER_SECOND_USD * seconds) / COST_BASIS_USD_PER_CREDIT);
  return Math.max(0, total - base);
}

// Continuation bills the SOURCE clip too. fal's published pricing for both
// Seedance reference-to-video endpoints (read 2026-08-31, their words): "The
// number of tokens is given by (height * width * (input video duration +
// output video duration) * 24) / 1024. If video inputs are provided the
// price is multiplied by 0.6" — and, on 2.5, in as many words: "With video
// references, you will be charged for both input and output videos."
//
// The old comment in fal.ts claimed the opposite ("continuation improves
// margin rather than costing it") and the 2026-08-31 inspection found the
// receipts: two production continuations from a ~15s source billed 266 units
// ($3.72) against a 6-credit charge ($1.68 basis) — a real loss, twice.
export const WITH_VIDEO_INPUT_MULTIPLIER = 0.6;

/**
 * Extra credits for continuing from a prior clip: the whole render re-priced
 * at the with-video rate over BOTH durations, minus the base weight already
 * charged. Floored at zero — when the discount on the output outweighs the
 * source's cost (a short source into a long render), the user simply pays
 * the normal price rather than a discount the mental model can't carry.
 *
 * seedance-2, 5s out + 15s source: ceil(0.6*0.3024*20 / 0.28) - 6 = +7 —
 * which covers the exact $3.63 the observed incidents cost.
 */
export function continuationExtraCredits(
  modelId: string,
  outSeconds: number,
  sourceSeconds: number,
): number {
  if (modelId !== "seedance" && modelId !== "seedance-2") return 0;
  const model = VIDEO_MODELS.find((m) => m.id === modelId);
  if (!model || sourceSeconds <= 0) return 0;
  const withVideoRate = model.costPerSecondUsd * WITH_VIDEO_INPUT_MULTIPLIER;
  const total = Math.ceil(
    (withVideoRate * (sourceSeconds + outSeconds)) / COST_BASIS_USD_PER_CREDIT,
  );
  return Math.max(0, total - getDurationCreditWeight(model, outSeconds));
}

export function pricingAudit(): {
  modelId: string;
  name: string;
  seconds: number;
  credits: number;
  allowanceValueUsd: number;
  costUsd: number;
}[] {
  const losses: {
    modelId: string;
    name: string;
    seconds: number;
    credits: number;
    allowanceValueUsd: number;
    costUsd: number;
  }[] = [];
  const check = (
    modelId: string,
    name: string,
    seconds: number,
    credits: number,
    costUsd: number,
  ) => {
    const allowanceValueUsd = credits * COST_BASIS_USD_PER_CREDIT;
    // Half a cent of tolerance for floating point, not for genuine losses.
    if (allowanceValueUsd + 0.005 < costUsd) {
      losses.push({ modelId, name, seconds, credits, allowanceValueUsd, costUsd });
    }
  };
  for (const model of VIDEO_MODELS) {
    for (const d of model.durations) {
      check(model.id, model.name, d.seconds, d.creditWeight, model.costPerSecondUsd * d.seconds);
    }
    // Dialogue is a duration surcharge, not a model, so it gets its own
    // audit rows: lipsync runs over the whole clip at fal's published
    // $5/minute, and the surcharge must cover that at every length.
    if (model === VIDEO_MODELS[0]) {
      for (const seconds of [5, 10, 15, 20, 30]) {
        check(
          "dialogue",
          "Dialogue (TTS + lipsync)",
          seconds,
          getDialogueCreditWeight(seconds),
          SYNC_LIPSYNC_PER_SECOND_USD * seconds + DIALOGUE_TTS_ALLOWANCE_USD,
        );
      }
    }
    // The start/end-frame lane bills at its own endpoint's price — audited
    // like everything else so a fal price rise shows up on the admin panel
    // instead of in the margin.
    if (model.id === "kling") {
      for (const d of model.durations) {
        check(
          model.id,
          `${model.name} (start/end frame)`,
          d.seconds,
          d.creditWeight + storyboardFrameExtraCredits(model.id, d.seconds),
          KLING_STORYBOARD_PER_SECOND_USD * d.seconds,
        );
      }
    }
    // Priced resolutions are the most expensive options in the catalogue and
    // need the same drift check — an unaudited 4K row is exactly where a
    // provider price rise would go unnoticed (2026-08-30).
    for (const offer of videoResolutionOffers(model.id)) {
      if (!offer.weights || !offer.costPerSecondUsd) continue;
      for (const [secondsKey, credits] of Object.entries(offer.weights)) {
        const seconds = Number(secondsKey);
        check(
          model.id,
          `${model.name} (${offer.value.toUpperCase()})`,
          seconds,
          credits,
          offer.costPerSecondUsd * seconds,
        );
      }
    }
  }
  return losses;
}

// Composer cleanup (2026-08-26, operator-approved): the picker leads with
// three curated lanes with plain jobs; everything else sits behind a
// "More models" expander. Curation only — nothing is removed from the
// catalog, and the server accepts every id exactly as before.
// Four since 2026-09-01 (operator call), when Gemini Omni Flash 1.1 joined.
// It earns a slot rather than replacing one: it is the highest-ranked model
// in the catalogue and it costs a quarter of what Veo does, so leaving it in
// the long tail would hide the best price-to-quality lane behind an
// expander. Veo stays because it is the one people arrive already knowing.
//
// EVERY id here needs a matching plain-language job line in the `jobs` map
// in generate-form.tsx AND in all four locales (en/es/it/pt) — the featured
// lanes show that line instead of the model's own description, so a missing
// key renders an empty subtitle rather than falling back.
export const FEATURED_VIDEO_MODEL_IDS = [
  "seedance-2",
  "kling-o3-pro",
  "gemini-omni",
  "veo",
] as const;
