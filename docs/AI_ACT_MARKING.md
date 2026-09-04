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

## What our output actually carries

### The full video roster, measured 2026-09-04

Every engine that has ever produced a finished video on this account, one
render each, fetched from the delivered URL and probed for the JUMBF label —
the same scan `hasC2paManifest` runs, plus the top-level MP4 box order as
structural corroboration.

| Engine | C2PA | Top-level boxes | Renders on this account |
|---|---|---|---|
| gemini-omni | **YES** | `ftyp uuid moov free mdat` | 1 |
| minimax-h3 | **YES** | `ftyp uuid moov free mdat` | 1 |
| kling-o3-pro | no | `ftyp moov free mdat` | 15 |
| kling | no | `ftyp free mdat` | 12 |
| **seedance-2** | **no** | `ftyp moov free mdat` | 11 |
| kling-o3 | no | `ftyp moov free mdat` | 11 |
| flux-upscale | no | `ftyp moov free mdat` | 2 |
| (older rows, no model recorded) | no | `ftyp free mdat` | 5 |

**56 of 58 finished videos — 97% — carry no manifest at all.** The earlier
sample of three made this look engine-dependent and roughly balanced. Across
the whole roster it is not balanced: marking is the exception, and the two
engines that have it account for two renders.

### Two corrections to the 2026-09-03 table

**gemini-omni was recorded as unmarked, and it is marked.** There is exactly
one gemini-omni render on the account, so both measurements are of the same
file: the earlier one was simply wrong. Today's reads a `uuid` box sitting
between `ftyp` and `moov`, which is where a C2PA manifest store lives — that
is structure, not a substring coincidence. The row is corrected above and the
lesson is recorded rather than quietly fixed: a probe that reads a prefix can
report absence for a reason that has nothing to do with the file.

**Seedance was never measured, and it is the interesting one.** BytePlus
Technical Support state, in writing on 2026-09-04, that "the generated video
includes embedded C2PA provenance metadata". The same ByteDance model
delivered through fal has **no manifest**. Both can be true, and the
difference is the delivery path: either fal re-encodes or re-containerises on
the way to us, or ByteDance embeds only on its own platform.

That has two consequences. It is direct evidence for the first question in
`FAL_C2PA_ENQUIRY.md` — do they re-encode between the model's output and our
download URL — and it is now the strongest non-price argument for going to
ModelArk direct: it would **add** marking to eleven renders' worth of lane
that currently ships bare, at a moment when the price advantage that
justified the migration has itself come into doubt.

### Images

Images (all engines) carry a manifest: a stored PNG from `generated-images`
contains `c2pa`, `jumd` and `trainedAlgorithmicMedia`. That is load-bearing
and accidental — `persistGeneratedImage` (core.ts) stores provider bytes
verbatim, so any future thumbnailing, compression or format conversion in
that path silently destroys compliance.

### What that means

**Video is not "a coin flip". It is unmarked, with two exceptions.** Whether a
customer's render carries provenance depends on an engine choice we neither
surface nor control, and for 97% of them the answer is no.

**We store no video at all.** `result_url` points at fal's CDN, so the file a
customer downloads is the provider's, served by the provider — which is why
these probes fetch from `v3b.fal.media` rather than our own bucket. Marking on
delivery would therefore mean storing video for the first time.

**Re-encoding destroys manifests**, proven by our own marketing files, which
went through x264 and came out clean.

---

## Options

## ANSWERED BY FAL, 2026-09-04

The ticket came back, and it closes option A for the engines that matter.

> "We've enabled watermarking and metadata tagging on any models we host; all
> have c2pa, where it is not provided natively by the Model Lab itself. For
> partner models, it depends on them directly; for Kling, we confirmed they are
> not providing it, and we're following up with them. For Seedance, they apply
> an invisible watermark."

So the 97% measured above is explained rather than mysterious. Every video
engine in this catalogue is a PARTNER model, not a fal-hosted one, which is why
fal's own C2PA never reaches our output — and **Kling is confirmed as not
providing it at all**, which is decisive here because Kling 1.6 is the default
engine and the Kling family is most of our video. Seedance's "invisible
watermark" is not C2PA and is not a provenance manifest; it is a detection aid
for ByteDance, readable by them and not by us or by a regulator's tool.

Option A is therefore closed for the default lane. What remains is B (mark on
delivery ourselves) or C (detect and refuse to ship unmarked), and B now has a
second reason to exist — see below.

## AND A SEPARATE, MORE URGENT FINDING FROM THE SAME REPLY

> "As for data retention, you can configure how long you want it to be with the
> headers described here ... If not set, by default we can only guarantee 7
> days, even though they may stay longer."

A finished video is never copied anywhere. job-runner's collect path writes
fal's own CDN URL straight into `generations.result_url`; there is a
`generated-images` bucket and no video equivalent, which this file already
noted in passing ("we currently store none — result_url points at the
provider"). Put together with the sentence above: **every video in every
customer's History is a link to fal's CDN with a seven-day guarantee.**

Stopgap applied the same day: every fal submit now sends
`X-Fal-Object-Lifecycle-Preference: {"expiration_duration_seconds": null}` —
no expiration, per fal's Data Retention page — and the header was verified
accepted against a real queue submit before it shipped. That stops the bleeding
for everything rendered from now on. It does nothing for rows already written,
and it is not the fix: the fix is to persist video the way images already are.

Two things to look at next, both from the same page: the header also takes an
`initial_acl`, and these are PUBLIC CDN URLs holding video of real people; and
`X-Fal-Store-IO: 0` would stop fal retaining our request payloads, which
otherwise sit for 30 days and contain the prompts and the reference-image URLs.

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

~~If the Seedance lane moves to ModelArk direct, **we may lose marking we
currently get for free**.~~ **ANSWERED 2026-09-04, and the answer is good.**
BytePlus Technical Support, in writing: "The generated video includes embedded
C2PA provenance metadata", and `watermark: true` adds "a visible 'AI-generated'
watermark in the lower-right corner ... in addition to the embedded C2PA
metadata."

So the two are independent. ModelArk marks by default, and we can keep
`watermark: false` — which every plan's no-watermark promise requires — while
still receiving a machine-readable manifest. A ModelArk migration would
therefore IMPROVE our Article 50 position on that lane rather than risk it,
because today the same lane's marking depends on which fal endpoint ran.

Not yet verified on real bytes: run `hasC2paManifest` over the first ModelArk
delivery we get. A vendor's sentence is a good reason to expect a manifest and
not evidence that one is there — the same standard applied to fal, where the
measurement is what produced the table above.

---

## Open questions for counsel

- Does a provider-embedded manifest naming *fal-ai/minimax_h3* discharge our
  obligation, or must the mark identify Picacho as the provider placing the
  system on the market?
- The upscale case: is an upscaled clip a new synthetic output requiring its
  own mark, or a manipulation of an existing one?
- Does the Article 50(4) deepfake disclosure duty on our *users* create any
  duty on us to make disclosure possible in the product?
