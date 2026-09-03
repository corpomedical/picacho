# "Layers" — is Higgsfield's feature achievable here, and what would 10x mean

Operator, 2026-09-03: "Lets add what Higgsfield has 'Layers'. Is it
achievable? If so, we add it to the tools section. It must be 10x better."

Every endpoint and price below was read from the vendor's page on 2026-09-03.
Anything not read is marked **unverified**.

---

## What Higgsfield Layers actually is

An image editor, launched 2026, built on **Nano Banana Pro and Seedream 5.0**
(named on their page). Capabilities in their own words:

- **Layer Separation** — "breaks any flat image into clean, editable layers —
  subject, background, and details."
- **Remove Background** — "pixel-level edges", "clean hair detail,
  transparent alpha, ready to composite."
- **Draw to Edit** — sketch on the frame to "remove unwanted objects, add new
  elements, or replace entire areas with a single brush stroke."
- **Edit text** — listed, undescribed.
- **Upscale** — "up to 4K", "real detail recovery."
- Export **JPG, PNG, WebP**. No PSD, no layered export.
- Tweets add: "non-destructive layout edits", "you can always go back a
  step", "turn one flat poster into a full multi-variant campaign."

What the page does **not** say: anything about keeping a person's identity
through an edit, anything connecting a layered still to their video tools,
any batch across subjects. Those silences are where 10x lives.

---

## Achievable on our stack? Yes — every primitive is on fal today

| Primitive | Endpoint (read 2026-09-03) | Price | Notes |
|---|---|---|---|
| True RGBA layer decomposition | `fal-ai/qwen-image-layered` | $0.05 / image | Returns `images[]`, one RGBA PNG per layer; `num_layers` (default 4), `prompt` caption, `seed`. **No field says what a layer is or its order** — the client has to infer subject/background from alpha coverage. |
| Subject cutout with alpha | `fal-ai/bria/background/remove` | $0.018 / call | Alpha PNG; **capped at 1024×1024**. Licensed training data. |
| Subject cutout, higher res | `fal-ai/birefnet/v2` | page shows "$0 per compute second" — **unverified**, treat as cheap | Alpha PNG + optional mask. |
| Object removal (text-selected) | `fal-ai/image-editing/object-removal` | $0.04 / image | "Objects to remove" as text; blends background. |
| Mask inpaint / replace | `fal-ai/flux-pro/v1/fill` | $0.05 / MP | `image_url` + `mask_url` + prompt. No outpaint. |
| Instruction edit, the engine Higgsfield uses | `fal-ai/nano-banana-pro/edit` | $0.15 / image, 4K = 2× | Up to **14** reference images; "maintains resemblance for up to 5 people"; "enhanced text rendering"; PNG/JPEG/WebP. |
| Instruction edit, the other engine Higgsfield uses | `bytedance/seedream/v5/pro/edit` | $0.0675 (≤1536²) / $0.135 (≤2048²) + $0.0045 per extra ref | Up to 10 refs; "layer separation", "sketch completion", "region-precise". Output shown as JPEG. |
| Multi-reference edit we already run | `fal-ai/flux-2-pro/edit` | in production | `image_urls`, identity + outfit + prop refs (image-references.ts). |
| Still upscale to 4K | `fal-ai/clarity-upscaler` | $0.03 / MP | Face-preservation parameters **unverified** — must be probed before use, same rule as the video upscaler's creativity=0. |
| Identity verification | `scoreIdentityMatch` (openai.ts) | ~cents | 0–100 vs the character's identity photo; free re-render gate exists (identity-gate-run.ts). |

So parity with Higgsfield is not an achievement — we can call the same two
engines they do, plus a real decomposition model their page does not claim.
Parity costs a few days. The question is only what to build on top.

---

## Where 10x actually comes from (each rests on something they cannot have)

1. **Identity-locked layers.** In Picacho the subject layer *is a character*.
   Every edit — new background, new product, new outfit, new text — is scored
   against the identity photo the moment it lands, and a miss gets the same
   free re-render the generate path already has. Higgsfield's page never
   mentions identity; Nano Banana Pro *claims* resemblance, we *measure* it.
   Code: `scoreIdentityMatch`, `runImageIdentityGate` — exists.

2. **Edit once, apply everywhere.** One background or product swap applied
   across a character's whole take set, or across every character in the
   library — a campaign, not a poster. Their tweet promises "multi-variant";
   ours is variant-per-*person* with a score on each. Code: takes and
   characters exist; the fan-out is new.

3. **Layers → video in one tap.** The composited still becomes the start
   frame of an image-to-video render (Kling O3, Veo i2v, MiniMax). Their
   page does not connect Layers to video. Code: image-to-video lanes exist;
   the handoff is new and small.

4. **Non-destructive by construction.** Every layer operation is a
   generation row with lineage, like an upscale is to its source — history,
   compare, restore, all already how the studio works. Their "go back a
   step" is a tweet; ours is the data model.

5. **Real layered export.** RGBA PNG per layer, verbatim from the model
   (`persistGeneratedImage` stores bytes untouched). They export flat files.

6. **Marked output.** C2PA on export rides the AI-Act work already scoped.

---

## Three shapes

**A — Honest parity (3–4 days).** A "Layers" tool page in the Tools group,
same skeleton as Upscale: bring any image or pick a take → split into layers
(Qwen) → per-layer: remove background, remove object, replace by brush mask
(FLUX Fill), instruction edit (Seedream 5 / Nano Banana Pro), upscale →
export PNG layers or a flat composite. Receipt quoted before every button.
No identity awareness. This matches Higgsfield and is not 10x.

**B — Character-native Layers (6–8 days). Recommended.** Everything in A,
plus: when the source has a character, the subject layer is bound to it;
every edit runs the identity gate and shows the score beside the layer;
"apply to all takes" fans one edit across the set with a score on each; one
tap sends the composite to image-to-video with the character attached.
This is the version only Picacho can ship.

**C — Campaign Layers (12+ days).** B, plus templates: define a layout once
(background, product, text slots), render it for N characters × M variants
as a grid, with per-cell scores, bulk export and a shareable contact sheet.
The multi-variant campaign their tweet describes, with a verified face in
every cell.

---

## Money (house basis $0.28/credit, ~20% margin, same rule as Upscale)

Per-operation provider cost → credits, rounded up:

| Operation | Provider | Suggested |
|---|---|---|
| Split into layers | $0.05 | 1 credit (or free with the first edit) |
| Remove background / object | $0.018–0.04 | 1 credit |
| Replace by mask, 1 MP | $0.05 | 1 credit |
| Instruction edit (Seedream ≤1536²) | ~$0.07 + score | 1 credit |
| Instruction edit (Nano Banana Pro 2K) | $0.15 + score | 1 credit |
| Instruction edit at 4K | $0.30 + score | 2 credits |
| Upscale still to 4K (8 MP) | $0.24 | 1–2 credits |

Cheap enough that a whole layered edit session is a few credits. The free
re-render on an identity miss costs us one extra edit; the gate's existing
daily cap applies.

---

## Risks, honestly

- **Hair edges and alpha quality** — Bria caps at 1024²; BiRefNet's limits
  are unverified. Side-by-side with Higgsfield on a portrait cutout is the
  test that would embarrass us if it fails. Probe before committing to an
  engine.
- **Qwen layer semantics** — the count is requestable (`num_layers`) but the
  API returns no label or order per layer. The UI must infer (largest alpha
  coverage = background, face-detected = subject) and let the user merge or
  rename, rather than promise "subject / background" as a guarantee.
- **Text editing** — Nano Banana Pro claims it; Seedream is "region-precise".
  Neither is a typographic editor. Promise "regenerate text", not "edit
  text like Figma".
- **Latency** — none of the pages state it. Budget 10–30 s per operation and
  design the page for that (the Upscale page already does).
- **Provenance** — Nano Banana Pro output may carry Google's SynthID; whether
  fal preserves C2PA per endpoint is the open question already sent to fal.
