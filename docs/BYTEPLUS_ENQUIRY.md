# BytePlus ModelArk — enquiry (SUPERSEDED)

> **⚠ Superseded 2026-09-03 by `BYTEPLUS_FOLLOWUP.md`.** That draft is the one
> to send: this one was written before the account existed and before the
> provenance question became material, and adversarial review found four fatal
> problems in it — an Article 50 self-characterisation, a consent claim we do
> not verify, an unprompted report that our traffic trips their likeness
> filter, and a DPA/DPIA commitment with no foundation in the product.
> Kept for the pricing table and the per-question reasoning below, both of
> which still hold.

Send to BytePlus sales (Contact sales / live chat on any page of
docs.byteplus.com, or partner enquiry via byteplus.com). Send from
hello@picacho.ai. The four questions are ordered so that a "no" to Q1 or Q3
saves the rest of the work — do not start engineering before they answer.

---

**Subject:** Seedance API for a consented-likeness product — pre-sales questions (EU / Spain)

Hello,

I run Picacho (picacho.ai), an AI character-video product operated by
JEAR TECNICA S.A., a company registered in Madrid, Spain. Our customers save a
"character" — a person, with their own reference photographs — and generate
short video of that character across many scenes, with every render scored
for facial consistency against the saved reference.

We currently reach Seedance 2.0 and 2.5 through a third-party API aggregator,
and we are evaluating moving to ModelArk directly. Two reasons: the direct
per-second pricing, and — more importantly — your private real-human asset
library, which matches how our product already works. Our users are creating
video of themselves or of people who have engaged them to do so, so a route
where portrait rights are verified at the source is the right architecture
for us rather than an obstacle.

Before we commit engineering time, four questions:

1. **End-user verification flow.** Your real-human asset library guide
   describes end users completing real-person authentication via an H5 page,
   while the console documentation says verification "currently requires
   logging in to a BytePlus account". For a platform integrating on behalf of
   its own customers, can the H5 liveness flow be embedded in our onboarding
   so our customer completes it without registering a BytePlus account of
   their own? This is the single question that decides whether the feature is
   viable for a consumer product.

2. **Access to the private real-human asset library.** The guide is titled
   "invited users only", while the Advanced Creation Rights table shows the
   Entry tier as free with real-person verification enabled on the Assets API.
   Is the Entry tier self-serve on account creation, or is an invitation
   required? If an invitation is required, please treat this email as the
   request.

3. **Restricted Model status in the EU.** Your International Availability page
   lists Spain, but excludes models carrying the "Restricted Model" tag. Are
   Seedance 2.0 and Seedance 2.5 available to a Spain-domiciled account, and
   are they tagged as Restricted?

4. **Data protection.** The liveness check captures biometric data, which is
   special-category data under GDPR Article 9 and requires a lawful transfer
   mechanism out of the EEA. Which region serves the asset library for an EU
   customer, and can you provide a Data Processing Agreement incorporating
   Standard Contractual Clauses, plus documentation of retention periods for
   the liveness reference image? We will complete a DPIA before sending any
   EU data subject to the flow.

For scale: we are early and small — low hundreds of renders to date, growing —
so the Entry tier's 50-asset allowance would cover an initial pilot. I would
rather start correctly on the verified route than scale on an unverified one.

Happy to complete organisation authentication (corporate registration
certificate, CIF) at any point in the process.

Best regards,

Ahmad
Picacho — picacho.ai
JEAR TECNICA S.A., Madrid, Spain
hello@picacho.ai

---

## Why each question is there (internal note, do not send)

- **Q1** decides the product's shape. Embedded H5 = a selfie scan inside our
  own onboarding, high conversion. A required BytePlus account per customer =
  the feature is dead for consumers and only works for agencies.
- **Q2** decides whether this is self-serve today or needs a relationship.
  Higgsfield's route was an "official BytePlus partnership", so a relationship
  is clearly obtainable — this email is the cheapest test of whether it is
  obtainable at our size.
- **Q3** would void everything: the availability list explicitly carves out
  Restricted Models, and Seedance is exactly the kind of model that would
  carry the tag.
- **Q4** is not optional for an EU company. Liveness is Article 9 biometric
  data; the storage region observed in their SDK samples is ap-southeast-1
  (Johor, Malaysia) and the contracting entity is BytePlus Pte Ltd
  (Singapore), so a DPA with SCCs and a DPIA are prerequisites, not paperwork
  to chase afterwards.

## The numbers behind the decision (verified 2026-09-03)

| | via fal (today) | BytePlus direct | ratio |
|---|---|---|---|
| Seedance 2.0, 720p | $0.3024/s | $0.152/s | 2.00x |
| Seedance 2.5, 720p | $0.4730/s | $0.231/s | 2.05x |

Creation-rights tiers: Entry free (50 assets / 50 asset groups, 3 QPM), then
$1,400/month or $14,000/year (1M assets / 1M asset groups, 120 QPM). One asset
group = one real person. BytePlus does not charge for generations that fail
moderation; fal does not refund the request either way, but a 4xx costs
nothing there too.
