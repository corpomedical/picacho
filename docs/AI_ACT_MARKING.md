# EU AI Act Article 50(2) — marking obligation

**Deadline: 2 December 2026.** Article 50 became applicable on 2 August 2026;
the marking duty carries a grace period to 2 December for systems already on
the market before August, which is us. Penalties for breach reach €15m or 3%
of global turnover, whichever is lower for an SME.

**What it requires.** Providers of AI systems generating synthetic audio,
image, video or text must mark outputs "in a machine-readable format and
detectable as artificially generated or manipulated", with solutions that are
"effective, interoperable, robust and reliable as far as technically
feasible". The law names no specific technology; C2PA is the interoperable
standard the industry has converged on, and the Commission's Code of Practice
on Transparency of AI-generated Content (voluntary, but evidence of
compliance) is written around that shape.

JEAR TECNICA S.A. is established in Madrid and puts this system on the market
under its own name, so the obligation lands on us regardless of where customers
are. (Legal name per src/lib/legal-entity.ts, which is what the site renders —
earlier drafts here wrote "Jeartecnica".)

---

## What our output actually carries (measured 2026-09-03)

Not assumed — fetched and inspected byte by byte.

| Surface | C2PA manifest | Evidence |
|---|---|---|
| Images (all engines) | **YES** | Stored PNG from `generated-images` carries `c2pa`, `jumd`, `trainedAlgorithmicMedia` |
| Video — minimax-h3 | **YES** | `ftyp uuid moov free mdat`; manifest names `fal-ai/minimax_h3`, `digitalSourceType: trainedAlgorithmicMedia` |
| Video — gemini-omni | **NO** | no `uuid` box, no markers |
| Video — flux upscale | **NO** | `ftyp moov free mdat` — no `uuid` box at all |
| Marketing copies in `public/` | **NO** | re-encoded to x264; the manifest was stripped |

### What that means

**Images are already compliant, by accident rather than design.** The provider
embeds the manifest and `persistGeneratedImage` (core.ts:379) stores the bytes
verbatim — no re-encode — so it survives into our own bucket. Worth knowing
that this is load-bearing: any future thumbnailing, compression or format
conversion in that path silently destroys compliance.

**Video is a coin flip.** Some fal endpoints embed a manifest and others do
not. Whether a given customer's render is marked depends on which engine they
happened to pick, which we neither surface nor control. "It depends on the
model" is not a compliance position.

**Our own upscale lane produces unmarked output**, and that is the worst of
the three, because it is a Picacho feature rather than a provider default. A
customer takes a marked or unmarked clip, upscales it, and receives something
carrying no provenance at all.

**Re-encoding destroys manifests.** Proven by our own marketing files, which
went through x264 and came out clean. Any pipeline step that touches video
bytes has to be assumed to strip provenance unless it is written not to.

---

## Options

**A. Require it upstream.** Ask fal which endpoints embed C2PA and whether it
can be enabled across all of them. Cheapest by far, and it is their business
to be able to answer. Weakness: we would be depending on a supplier for a duty
that is legally ours, with no visibility when it regresses.

**B. Mark on delivery ourselves.** Fetch the finished file, embed a signed
C2PA manifest naming Picacho as the producing system, store and serve that.
Uniform across engines and under our control. Costs: a signing certificate, a
C2PA library in the pipeline, storage for video (we currently store none —
result_url points at the provider), and a processing step in the collect path.
The image half of this already exists in all but the signing.

**C. Detect and refuse to ship unmarked.** Probe every finished render, record
whether a manifest is present, and treat its absence as a defect — either
marking it ourselves or declining to offer that engine to EU customers.
Weakest as a standalone answer, strongest as the measurement layer under A or B.

**Recommendation: A + C now, B if A comes back thin.** Ask fal the question
this week — it is one email and it may resolve most of the exposure. Build the
detector regardless, because without it we cannot tell whether we are
compliant on any given day, and the answer changes per engine and per provider
release.

---

## This interacts with the BytePlus migration

If the Seedance lane moves to ModelArk direct, **we may lose marking we
currently get for free**. ByteDance's create call has a `watermark` boolean
which their own example sets to `false`, and a visible watermark is not the
same thing as a machine-readable manifest in any case. Before that migration
ships, establish whether ModelArk output carries C2PA and what `watermark:
true` actually does. That question belongs in the same enquiry as the asset
library and flex pricing.

---

## Open questions for counsel

- Does a provider-embedded manifest naming *fal-ai/minimax_h3* discharge our
  obligation, or must the mark identify Picacho as the provider placing the
  system on the market?
- The upscale case: is an upscaled clip a new synthetic output requiring its
  own mark, or a manipulation of an existing one?
- Does the Article 50(4) deepfake disclosure duty on our *users* create any
  duty on us to make disclosure possible in the product?
