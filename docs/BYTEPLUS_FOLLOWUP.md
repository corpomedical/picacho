# BytePlus ModelArk — follow-up to the submitted enquiry

Send from hello@picacho.ai. This supersedes the send-ready draft in
BYTEPLUS_ENQUIRY.md, which was written before the account existed. Keep that
file for its pricing table and its per-question reasoning.

**Placeholders to fill before sending:** [ACCOUNT ID], [DATE I CONTACTED BYTEPLUS], [SURNAME]

---

**Subject:** ModelArk account [ACCOUNT ID] (Spain) — Assets API access and Seedance availability

```
Hello,

I contacted BytePlus on [DATE I CONTACTED BYTEPLUS] about Seedance for a consented-likeness product, and have since registered ModelArk account [ACCOUNT ID]. This is a follow-up to that, not a second lead.

The one thing I need: confirmation that a Spain-registered account can run Seedance in production, and access to the private real-human asset library. Everything below is detail you can skip if either answer is no.

Picacho (picacho.ai) is operated by JEAR TECNICA S.A., registered in Madrid. Customers save a character — a real person, from their own reference photographs — and generate short video of that character across scenes. We are live, small, and piloting. We reach Seedance through an aggregator today and want to move direct, mainly for the asset library: ByteDance's documentation for the Seedance 2.0 series says reference images containing real-person faces are not supported as direct uploads, and points to the verified asset library as the sanctioned route instead. We do not try to work around that. Our terms already permit a person's likeness only with their consent, and the asset library is how we would move from a contractual prohibition to a verified one.

1. Availability. Can account [ACCOUNT ID], registered in Spain, run dreamina-seedance-2-0 and dreamina-seedance-2-5 in production for paying customers — yes or no? ListModelRateLimit returns both for us (10 concurrent requests, 600 CreateTask RPM each), but I read that as capacity, not permission. As I read your International Availability page, Spain is in scope except for models carrying the "Restricted Model" tag. If both are clear for us, please confirm that in writing. If not, that ends the evaluation and I will stop here.

2. Assets API. We have registered, and the real-human asset library does not appear in our account's API list at all. Is the Entry tier self-serve, or does it need an invitation or an entitlement you enable? If an invitation is required, please treat this as the request. Two things I need confirmed alongside it: that generating video of an identified real person who has completed your verification flow is permitted under your acceptable-use terms, and that a verified asset clears the real-person check on both Seedance 2.0 and 2.5. The whole plan assumes it does.

3. End-user verification. (a) Does the end user need their own BytePlus account to complete real-person authentication — yes or no? (b) If no, how is the H5 session authenticated, and is there a callback telling us the result? A yes to (a) means the feature works for agencies and not for consumers, and I would rather know that now than after we build.

4. Watermark and provenance. What does the top-level watermark boolean on the create call produce when set to true — a visible on-screen overlay, embedded metadata, an invisible watermark, or some combination? Your reference-to-video example sets it to false, so the reference does not say. We sell output without visible marks, and machine-readable provenance is on our own roadmap, so I also need to know whether returned video carries any provenance metadata. Rather than have you chase that internally: if you can send two short Seedance 2.5 samples, one generated with watermark true and one false, I will inspect them myself and will not need you to answer for it. Happy to sign an NDA if that is what it takes.

5. Data, briefly. Which region serves the asset library for an EU customer? And in that flow, do you act as processor on our instructions, or as an independent controller towards the end user? I will need a data processing agreement and the retention terms for the liveness image before routing any EU user through it, but that can wait until access is settled.

Five API-reference points our client build hit, if there is someone technical to route them to — or say the word and I will raise them as a support ticket instead:

- Model identifier on create. ListModelRateLimit gives us the bare family names dreamina-seedance-2-5 and dreamina-seedance-2-0, your create sample passes a version-suffixed id, and your pricing page quotes dreamina-seedance-2-0-260128. Which form does the create call accept?
- Service tier. filter.service_tier is documented on the task list endpoint. Is there a request-side field to set one, what is it called, and what does flex cost against default?
- Failed tasks. The reference documents the success fields. What is the error object on a failure, so we can separate a content refusal from a platform error?
- Does deleting an in-flight task stop the billing clock, or only remove the record?
- Once a person is verified, what does the create call look like — an asset id inside an image_url part, or a different shape?

We are choosing a route by the end of September. If 1 and 2 are yes, we will run a pilot on the Entry allowance and move up the creation-rights tiers as it scales; if either is no, we will stay on the aggregator and revisit later. I can complete organisation authentication (corporate registration certificate and NIF A28847549) whenever it is useful, and I am happy to take this on a 20-minute call in Singapore hours.

Best regards,

Ahmad [SURNAME]
Founder, Picacho
picacho.ai · hello@picacho.ai

Picacho is operated by JEAR TECNICA S.A. · NIF A28847549
Paseo de la Castellana 259, 28046 Madrid, Spain
```

---

## Why it is shaped this way (internal — do not send)

FATAL/MAJOR FIXES APPLIED

1. Article 50 framing deleted entirely (legal reviewer, two fatals). Cut the Regulation citation, the article number, the 2 August 2026 applicability date, and "we place Picacho on the EU market under our own name, so meeting that is ours to do." Written a month after the date it names, that paragraph was a dated, unprivileged, founder-signed acknowledgement that we did not know whether our live output was marked — an inference that lands on the existing fal lane, not just the prospective one. It also silently contradicted docs/AI_ACT_MARKING.md:3-5, which claims a grace period to 2 December.

CONFLICT RESOLVED: the legal reviewer wanted all law removed; the recipient reviewer proposed keeping one clause ("we have our own EU marking duty"). I went further than the recipient and slightly less far than the legal reviewer: "machine-readable provenance is on our own roadmap." That is a requirement, not a status — no citation, no date, no provider self-attribution, no admission of a gap — while still giving BytePlus a commercial reason to answer. Rule followed: state the requirement, never the status.

2. Refusal telemetry cut and attribution corrected. The draft said "a reference image containing a real person is refused on both Seedance lanes today — consistent with your documentation." Verified at src/lib/generations/providers/video-models.ts:188-190: the source is VOLCENGINE, scoped to the SEEDANCE 2.0 SERIES. "Your documentation" said to BytePlus about both lanes was doubly wrong and correctable in one line.

CONFLICT RESOLVED: the factual reviewer wanted the evidence split ("refused at our aggregator; Volcengine documents 2.0"); the legal reviewer wanted the observed-refusal detail dropped as a trust-and-safety self-report inviting account review. Sided with legal — the refusal history is not needed to make the ask, and volunteering "our traffic trips your filter, please give us a route where it stops" is the wrong thing to hand a supplier. Kept only the correctly attributed, correctly scoped documentation point.

3. Consent representation replaced. "Our customers generate video of themselves, or of people who have engaged them to do so" asserted a consent state we do not verify — which is the reason we want the asset library. Replaced with the published terms (src/lib/i18n/legal/terms.ts:22) plus the honest gap: contractual prohibition today, verification is what we are buying. Makes the business case more strongly than the original.

4. [REGISTRO MERCANTIL] deleted. Verified src/lib/legal-entity.ts:14-17 — the tomo/folio/hoja is intentionally empty product-wide until the escritura surfaces, and operator-card.tsx renders it conditionally precisely so no placeholder ever ships. Nothing has changed since 1 September. The signature now matches the live site exactly.

5. CIF corrected to NIF, both places. Verified legal-entity.ts:11 stores it as nif, footer.tsx:32 renders "NIF A28847549", and the privacy policy names it that way in all four languages. CIF was replaced by NIF for Spanish entities in 2008; a recipient cross-checking picacho.ai would have seen two labels for one number.

6. Channel claim de-risked. Nothing in the repo records that the enquiry was sent, when, or through which door — docs/BYTEPLUS_ENQUIRY.md still calls itself "enquiry to send" and offers three channels. "I submitted the partner enquiry form" was checkable against their CRM in thirty seconds and would have collapsed "not a second lead" in sentence one. Now channel-neutral ("I contacted BytePlus on [DATE]"), true whichever door was used, with the account ID doing the routing work instead.

7. DPA/DPIA/Article 9 block rebuilt (four legal majors). Removed: "I can sign a DPA on receipt" (executing a contract sight-unseen, quotable as leverage), "We will complete a DPIA before routing any EU data subject" (a promise with no foundation anywhere in the product — the word appears nowhere outside the draft — that becomes evidence of knowing disregard if the flow ever ships without one), the Article 9 legal characterisation of a flow we have not seen, and the assumption that BytePlus is our processor. Replaced with the role question first, then paper deferred to contract stage.

8. Migration made conditional throughout. "Before we move a lane onto it" and "before we build" told the supplier the decision was taken and removed our walk-away — undercutting questions 2, 5 and the flex pricing ask. Now "if 1 and 2 are yes... if either is no, we will stay on the aggregator."

RECIPIENT CUTS MADE (length is a real cost — roughly 1,300 words to roughly 620)

- Entire pricing paragraph cut. Quoting their own list price back with a read-date reads as an audit, marks us as a price-shopper, and gives a rep nothing actionable. One clause survives: "we reach Seedance through an aggregator today and want to move direct."
- "That is the smaller reason to move" cut — no reason to tell them price is secondary three paragraphs before asking what flex costs.
- "Two things our own account has already established" block dissolved into the questions it qualifies.
- Company paragraph halved. Cut the Play Store, the four languages, the subscription model, and the identity-scoring claim. Cutting the scoring line also resolves a factual overclaim both other reviewers flagged: upscale takes carry no identity score (changelog.ts:63) and scoring is best-effort (changelog.ts:188), so "video and character images are scored" was the same class of absolute the 2026-08-30 honesty pass removed from the site.
- Q10 (duration) cut. byteplus.ts:285 records "Seedance accepts 4-15" as transcribed from ByteDance's own reference — asking a vendor something their published docs state is how a list of ten earns one "please see the documentation" reply covering the nine good questions too.
- Q4 reduced from four sub-questions to one plain question plus a sample-file request. The JUMBF/uuid-box/digitalSourceType specification guaranteed a forward to engineering and death there; asking for two sample clips converts it into a one-minute action and lets us measure it ourselves.
- "please say so plainly rather than pointing me at it" cut — pre-emptively accusing the recipient of evasion, in the sub-question they are least able to answer.
- Tagline cut from the signature; short block used. A slogan in a partnerships email is the strongest single template signal.
- "if you can route them to someone technical" now paired with an offer to raise a ticket ourselves rather than assigning them internal routing.
- Two rhetorical em-dash reversals flattened; the cadence was dense enough to read as machine-polished.

ADDITIONS (all three reviewers' "missing" lists)

- Account ID in the subject line and first sentence — the highest-leverage single change for routability.
- The premise-check nobody asked: does a VERIFIED asset actually clear the real-person filter? The entire business case assumes it does, and that assumption is inferred in our notes, never confirmed. A no here voids the migration as completely as a no to Q1.
- The acceptable-use permission question: is the use case allowed at all? Asked how to get access and how the flow works, never whether it is permitted.
- The asset-citation shape (asset://<id> per video-models.ts:210-215) — without it, a yes to Q2 and Q3 still leaves us unable to write the create call.
- Controller/processor role question before the paper question.
- Q1 made binary and consequential, with a request to confirm in writing.
- Q3 split so the load-bearing half (does the end user need their own account) is first and cannot be answered past.
- A decision date and a conditional path, plus a stated cost to ignoring the email.
- An offer of a 20-minute call in Singapore hours, and an NDA offer to unblock the provenance answers, which vendors decline by reflex as roadmap.

WHERE I DECLINED A REVIEWER

- The recipient reviewer called the ten-question spread fatal and wanted two separate emails. I cannot deliver two emails, so I restructured instead: one named ask in the first three lines, five numbered decision questions, and the API points demoted to a labelled block with an explicit offer to move them to a ticket. That is the reviewer's own fallback fix.
- The recipient wanted a hard revenue commitment ("we will take the $1,400/month tier"). Declined. Our own enquiry doc says the free Entry allowance covers the pilot, so promising the paid tier contradicts our stated plan and overcommits the operator. Written as a growth path instead.
- The recipient wanted two concrete call slots in SGT. I cannot invent the operator's availability; offered the window generically.
- "By the end of September" is written as prose rather than a fourth bracket — three reviewers agree an unfilled bracket kills the email, and each extra one raises that odds. The operator should change that phrase if the timing is wrong.
- The International Availability wording is unverifiable from the repo (it originates in the unsent draft). Kept, because it was already put to them, but hedged to "As I read your International Availability page."


---

## What was actually sent (2026-09-03): two support tickets, not the email

The BytePlus console has no sales inbox reachable from a new account; the door
that exists is **Support → Create Ticket → ModelArk**, and its description
field takes **1,000 characters**. The email above is 5,300. So it went as two
tickets, split by who can answer: a **General Inquiry** for access and
availability (the two answers that gate everything, and the ones a support
engineer can escalate with the account already attached), and a **Technical
Support** ticket for the five API-reference points (which route straight to
engineers and would be noise on the first). Legal, DPA and the H5 flow detail
wait for whoever replies — they are partnership questions and a ticket cannot
carry them.

### Ticket 1 — General Inquiry (967 chars)

**Subject:** Seedance in production from Spain, and access to the real-human asset library

```
Picacho (picacho.ai), operated by JEAR TECNICA S.A., Madrid. We generate short video of a saved character from the customer's own reference photos and want to move our Seedance lane to ModelArk directly.

1. Can this Spain-registered account run dreamina-seedance-2-0 and 2-5 in production for paying customers? ListModelRateLimit returns both, but I read that as capacity, not permission: your availability page excludes "Restricted Model" tagged models for Spain. A yes/no in writing, please.

2. The real-human asset library does not appear in our API list. Is the Entry tier self-serve, or does it need an invitation? If an invitation, please treat this as the request. Does a verified asset clear the real-person check on both 2.0 and 2.5, and must the end user hold their own BytePlus account to complete verification?

3. Does returned video carry provenance metadata (C2PA), and what does watermark:true produce: a visible overlay, embedded metadata, or both?
```

### Ticket 2 — Technical Support (900 chars)

**Subject:** Video generation API: five reference questions before we build

```
Building a client for POST /contents/generations/tasks (Seedance). Five points the reference leaves open:

1. Model id on create. ListModelRateLimit gives bare family names (dreamina-seedance-2-5), the create sample uses a version-suffixed id, and pricing quotes dreamina-seedance-2-0-260128. Which form does create accept?

2. Service tier. filter.service_tier exists on the list endpoint. Is there a request-side field to choose flex vs default, and how is flex priced?

3. Failed tasks. The reference documents success fields only. What is the error object on failure, so we can separate a content refusal (e.g. InputImageSensitiveContentDetected) from a platform error?

4. Does deleting an in-flight task stop billing, or only remove the record?

5. Once a real-human asset is verified, what does the create call look like: an asset id inside an image_url part, or a different shape?

Thank you.
```

---

## THEIR REPLY, 2026-09-04 — three answers, and one new problem

BytePlus Technical Support answered the General Inquiry. Verbatim points:

**1. Availability — YES.** "Spain is within ModelArk's supported service
regions, so your Spain-registered account can use dreamina-seedance-2-0 and
dreamina-seedance-2-5." They add that ListModelRateLimit returning the models
"indicates that the corresponding rate-limit metadata is available" — which is
them agreeing with our own reading that capacity is not permission, and then
granting the permission separately. No "Restricted Model" tag was raised.

**2. Asset library — SELF-SERVE, and the end user needs no BytePlus account.**
"The Entry tier is free of charge and is available to enterprise customers who
have completed the required KYC verification." That KYC is three steps on an
H5 page — compliance risk assessment, read and accept a letter of commitment,
mobile phone verification — done ONCE, and "remains valid for subsequent
purchases or configuration changes". Activation link:
https://ai.byteplus.com/ark/region:ap-southeast-1/openManagement?LLM=%7B%7D&advancedActiveKey=mediaAsset
And the sentence that decides the product's shape: **"Videos generated through
the API do not require the end user to hold a BytePlus account."**

**3. Provenance — C2PA IS EMBEDDED, and the watermark is separate.** "The
generated video includes embedded C2PA provenance metadata." With
`watermark: true` the video "also includes a visible 'AI-generated' watermark
in the lower-right corner. Therefore, this setting produces a visible overlay
in addition to the embedded C2PA metadata."

This is the best possible answer for us and it reverses a risk this file
recorded: migrating the Seedance lane would NOT lose the marking we currently
get for free. We can keep `watermark: false` — which every plan's no-watermark
promise requires — and still receive C2PA. To be verified on real output the
day we have access, with `hasC2paManifest` (lib/media/c2pa-probe.ts).

### FIRST, THE FRAMING — PRICE WAS NEVER THE REASON

Operator, 2026-09-04: "Remember that we decided to go straight to the source
to avoid restrictions from using images of people to create videos."

That is right and this file had drifted off it. The reason for going direct is
that **the Seedance lane cannot render a real person at all through fal**, and
the asset library is ByteDance's own sanctioned route to doing so with
verified portrait rights. Price was a secondary attraction; C2PA was a
question we asked while we were there. Neither is the case.

Measured on the account, 2026-09-04:

- **10 of 20 failed video renders — half of every video failure we have — are
  likeness refusals**, all Seedance: 7 on 2.5, 3 on 2.0. The provider's own
  words in the log: "The images or videos provided may contain likenesses of
  real people", `content_policy_violation`.
- **13 of 20 video failures are Seedance**, an engine that is 11 of 58
  successes. It fails more than it delivers.
- And the count UNDERSTATES the loss, because the product now prevents the
  attempt: `send-plan.ts` marks both `seedance` and `seedance-2` as
  `photorealPolicy: "rejects"`, so a photoreal character picking either gets
  a warning and a one-tap switch to another engine before spending anything.
  Those ten failures are what happened BEFORE the fence went up. Since then
  the lane simply is not offered for the product's central case.

So the ranking is: **capability first** (a saved character is a real person,
and this is the only route that makes Seedance usable for one), provenance
second (they embed C2PA, and fal's delivery of the same model does not — see
AI_ACT_MARKING.md), price third and now uncertain. A price parity finding
does not weaken the case; it only removes a bonus.

### THE FIVE API QUESTIONS, ANSWERED 2026-09-04

Technical Support came back on the second ticket. All five, and two of them
change code.

1. **Model id on create.** "Model supports entering the model name or EP ID" —
   either the model id or an endpoint id. The versioned ids we send are the
   right form, and that is now confirmed as well as proven by a real call.

2. **Pricing.** "The seedance2.x series models are only related to video
   resolution and whether there is an input video, and have nothing to do with
   priority." That is the cleanest statement anyone has given us, and it
   corroborates the measurement below rather than the earlier support answer:
   there is no separate "enhanced" tier to land on, only resolution and whether
   a video went in. At 720p with no input video the account billed 87,300
   tokens for 4 seconds, i.e. $0.153/s.

3. **Error codes.** Documented at ModelArk/1299023.

4. **Deleting an in-flight task — and this contradicted our code.** "Tasks
   currently in progress cannot be deleted; you can only delete tasks in the
   queue or those that have been completed. Deleting tasks in the queue will
   not incur any charges." Their status table: queued deletes and becomes
   cancelled; succeeded/failed/expired delete but only lose the RECORD;
   **running cannot be deleted, and neither can cancelled**.

   Our cancel path called DELETE unconditionally and threw on any non-2xx,
   which would have turned a documented refusal into a provider outage.
   deleteArkTask now returns false on a 4xx instead, and the Stop button's
   meaning is written down where it belongs: it stops the work only if we got
   there before the render started. After that the customer has stopped
   waiting, not stopped paying.

5. **The asset library call shape.** `asset://<asset_ID>` in the content part's
   url field — the same thing the public docs showed, now confirmed by support.
   Reference: ModelArk/2333589.

### MEASURED 2026-09-04 ON THE RECHARGED ACCOUNT — AND IT CONTRADICTS SUPPORT

The account was topped up and the four Dreamina models activated, so the
questions below stopped needing an answer from anyone. Two API calls settled
them.

**The lane works.** `dreamina-seedance-2-0-260128`, 4s, 720p, text-to-video,
generate_audio false: the create call was accepted (`cgt-20260904165259-b69q9`),
the list endpoint with `filter.task_ids` reported running -> succeeded exactly
as `checkArkTasks` parses it, and the finished task carried
`content.video_url`. Every field our client sends was accepted as sent.

**The real rate is HALF what support quoted, and half what we pay fal.** That
render reported `usage.completion_tokens` 87,300 (`total_tokens` identical —
no input tokens on a t2v call). At ModelArk's recorded $7.00/M for Seedance
2.0: 87,300 x $7.00/1e6 = $0.6111 for 4 seconds = **$0.1528 per second**.

  fal today, video-models.ts:161 ....... $0.3024/s
  BytePlus support, "enhanced" line .... $0.3030/s
  MEASURED on our own account .......... $0.1528/s   (-49.5%)

So the 2x saving this file recorded and then withdrew was right, and the
withdrawal was wrong. Support answered about a published billing example; the
account bills something else. A default 5-second render is $1.512 through fal
against $0.764 direct.

TWO HONEST LIMITS ON THAT NUMBER. It is text-to-video; the product's lane is
reference-to-video, whose token cost stays unmeasured for the reason below.
And $7.00/M is this repo's recorded list price from 2026-09-03, not re-read
today.

**And the likeness fence is confirmed on our own key.** The same model, same
size, with one `reference_image` part pointing at a public photograph of a real
person, returned HTTP 400:

  InputImageSensitiveContentDetected.PrivacyInformation
  "The request failed because the input image 'content[1]' may contain real
   person."

That is the claim the whole migration rests on, no longer inferred from a
comment. Going direct does not put a customer's face on screen. The verified
real-human asset library is still the only route, and this account still does
not have it. The refusal is free — a 400 at submit, nothing queued, nothing
billed — which is worth knowing: the fence costs us nothing to hit.

### SUPERSEDED — what support said on 2026-09-04

BytePlus Technical Support replied to the price question. What it settles:

- **USD 0.303/second is confirmed** for the documented Seedance 2.0 example
  on the *enhanced* line, 720p, no billable video input. Against fal's
  $0.3024/sec (video-models.ts:161) that is 0.198% MORE expensive — parity,
  and the wrong side of it. A default 5-second render: $1.515 direct against
  $1.512 through fal.
- **The $0.462/s figure below is withdrawn by the vendor.** 1.5251 is the
  **1080p resolution factor**, not a Seedance 2.5 model factor. The reading
  in this file was wrong. There is now NO rate of any kind for
  dreamina-seedance-2-5 direct — not $0.462, and not the $0.231 in
  BYTEPLUS_ENQUIRY.md:107, which was already flagged unsafe.
- **The capability question is answered, and this is the valuable half:**
  "The real-human asset library officially supports authorized real-human
  assets for video generation with both Seedance 2.0 and Seedance 2.5." That
  is the first written vendor statement on the premise recorded as
  inferred-never-confirmed at :94.
- **Still open, and it is what would decide the price question:** they will
  not map a real-human-asset request to the enhanced billing line without
  checking our account's own endpoint and billing configuration. So the one
  rate they will stand behind is for a scenario we may never run.

Two things to hold onto when reading the reply. Their own conclusion assumes
a **720p factor of 1.0** — they give the 1080p factor and state no 720p
factor anywhere. And 1080p is not a product we could sell today regardless:
fal.ts:452 hardcodes `resolution: "720p"` for both Seedance lanes and
video-resolution.ts's OFFERS table has no Seedance entry at all.

**Consequence for the decision: price comes out of the case entirely.** Not
as a saving, not as a cost — it is parity to within a third of a cent, and
every credit weight in the catalogue is already correct for the confirmed
rate. What survives is capability, which the reply strengthens.

The live-code claim that "the credit weights below therefore all halve if
the lane ever moves to ModelArk direct" was withdrawn in
video-models.ts:203 on the same day.

### THE PRICE CLAIM IN THIS FILE IS NO LONGER SAFE TO ACT ON

The table above says $0.152/s for 2.0 and $0.231/s for 2.5, against fal's
$0.3024 and $0.4730 — a 2x saving, and the main commercial reason to migrate.
Re-reading on 2026-09-04, the page **BytePlus themselves cited** for
availability (docs/Byteplus_LAS/video_gen_enhanced) states "Unit price: 0.303
USD/second" for the enhanced version, with a duration conversion factor of 1.0
at 720p for 2.0 and 1.525 for 2.5 — so about **$0.303/s and $0.462/s**, which
is fal's price to within a fraction of a percent.

> **WRONG, corrected 2026-09-04 by BytePlus themselves: 1.5251 is the 1080p
> RESOLUTION factor, not a 2.5 model factor. The $0.462 derived here has no
> basis and the vendor refuses it by name. See the section above.**

Both cannot be right. The likeliest explanation is two product lines — a
standard/fast Seedance around $0.15/s and an "enhanced" line around $0.30/s —
and that the reference-to-video lane with the asset library is the enhanced
one, i.e. the expensive one. Their public pricing is also quoted per MILLION
TOKENS ($4.3–$7.0 per 1M at 720p depending on video input), not per second, so
every per-second figure in circulation is somebody's conversion.

**Nothing should be built on the 2x number until BytePlus states the rate for
the exact model ids they just confirmed, in the reference-to-video lane, in
writing.** If the real answer is parity, the case for migrating is no longer
price — it is the asset library and the C2PA marking, which are still real but
are a different argument and a different priority.

### Still unanswered

- The five API-reference questions (model id form on create, request-side
  service_tier, the error object, whether deleting an in-flight task stops
  billing, the create shape with a verified asset) — sent as a separate
  Technical Support ticket, no reply yet.
- **Who completes the per-person check.** Their KYC (risk assessment, letter
  of commitment, phone) reads as ACCOUNT-level enterprise verification. The
  real-human asset library normally also requires a per-person portrait-rights
  or liveness check on the individual whose likeness is used. "The end user
  does not need a BytePlus account" answers the account question and not that
  one. Until it is answered we do not know whether a customer can enrol a
  person from inside our onboarding, which was the question that decides
  whether this is a consumer feature or an agency one.
- Data protection: region for an EU customer, DPA with SCCs, retention of any
  liveness reference image. Deliberately deferred to contract stage, still open.

### The reply to send — two tickets, split by who answers

The form caps at 1,000 characters and one combined reply is ~2,000, so it
splits. ORDER CHANGED 2026-09-04 after the operator corrected the framing:
the per-person check goes FIRST, because capability is the case and price is
a bonus. Send as a reply on the answered General Inquiry thread, not a new
ticket.

**Second — price (984 chars).** REWRITTEN 2026-09-04. The earlier version
opened with the same "thank you, we will complete the KYC" as the contradiction
ticket (duplicated on one thread) and closed with "this number decides the
move", which the corrected framing makes false — capability decides it, price
is a bonus.

```
A separate question, on billing — for planning rather than as a condition.

The availability page you linked (Byteplus_LAS/video_gen_enhanced) states "Unit price: 0.303 USD/second", with a duration conversion factor of 1.0 for 2.0 and 1.525 for 2.5 at 720p — about 0.303 and 0.462 USD/s. Other BytePlus pricing is quoted per million tokens, so every per-second figure around is someone's conversion.

For dreamina-seedance-2-0 and dreamina-seedance-2-5, at 720p, reference-to-video using a verified real-human asset, could you confirm:

1. the rate we would actually be billed, in USD per second of delivered output;

2. whether that lane is the "enhanced" line the 0.303 figure refers to.

Why we ask precisely: we pay 0.3024 USD/s for the same model through an aggregator today, so we are sizing the change rather than shopping. The reason we are moving is the real-human asset library — that lane refuses reference images of real people for us today, and that is our core use case.
```

**Ticket 2 — the per-person check** — superseded, see below.

**FIRST — the per-person check** — WITHDRAWN 2026-09-04. The docs answer
it; see the replacement at the end of this file.

---

## READ THE DOCS FIRST — 2026-09-04, operator: "what if this information you are requesting is available on their website?"

It was, and the ticket would have shown we had not looked. Recorded here so the
next person does not repeat it. (The reason I missed it the first time is worth
naming too: the earlier attempt used a plain HTTP fetch on a JavaScript-rendered
docs site and got only the navigation chrome, which reads exactly like "the page
does not say".)

Source: **Add real-human assets to asset library**,
https://docs.byteplus.com/en/docs/ModelArk/2315856 (last updated 2026-08-31).

### The per-person question is ANSWERED, and the answer contradicts support

> "To protect artist permissions and facilitate subsequent management of their
> own portraits, **real-person verification currently requires logging in to a
> BytePlus account.** A single BytePlus account supports creating multiple real
> portraits or portraits of multiple people."

BytePlus Technical Support told us on 2026-09-04: "Videos generated through the
API do not require the end user to hold a BytePlus account." Both can be true
and they answer different questions — GENERATING from an already-verified asset
needs nothing from the end user, but ENROLLING that person does. Support
answered the question we asked; the documentation answers the one we meant.

### The actual enrolment flow, from the docs

1. **We** generate an authorization QR code in the ModelArk Playground
   (My assets > Real-human > Add real-human assets > Create an asset group;
   the account must have completed real-human or enterprise authentication).
   We set the authorization validity period and accept the Personal
   Information Processing Rules.
2. **The person** scans it, **logs in to their own personal BytePlus account**,
   confirms the authorization subject and purpose, agrees to the facial
   information processing rules, and completes real-person verification —
   a liveness check that "may occasionally be affected by lighting, angles and
   other factors, resulting in failure".
3. They upload a full-body portrait-orientation image and a face close-up
   (face about two-thirds of the frame), which pass a **face consistency
   check** against the verification; anything that fails is not stored.
4. **We** accept the asset in the console; status goes Active. Reject is
   permanent for that asset.

One authorization per person, not per shoot: "Human actors only need to
authorize once; subsequent additions of makeup and styling do not require
repeating the real-person verification process." One asset group = one person;
mixing people in a group is unsupported.

### So this is the agency shape, not the consumer shape

A customer cannot be enrolled invisibly inside our onboarding. The minimum
journey is: we generate a QR, they scan it on a phone, they sign in to or
create a BytePlus account, they pass a face scan, we accept. That is a real
hand-off to a third party mid-flow, and it decides the feature's audience —
which is exactly what this question was for.

It does not kill it. It means the honest framing is "verified likeness", a
one-time setup a serious customer will do, rather than something that happens
behind the scenes.

### Two of the five technical questions are also answered

**The create call with a verified asset** — question 5 of the pending
Technical Support ticket:

```json
{ "type": "image_url",
  "image_url": { "url": "asset://asset-20260222234430-mxpgh" },
  "role": "reference_image" }
```

**Asset format limits**: images jpeg/png/webp/bmp/tiff/gif/heic, aspect ratio
0.4–2.5, 300–6000 px per side, under 30 MB. Video mp4/mov, 2–30 s, 24–60 fps,
up to 200 MB. Audio wav/mp3, 2–30 s, up to 15 MB.

### And the tier table is more precise than we recorded

| Tier | Price | Real-person via Console | via Assets API | Quota | QPM |
|---|---|---|---|---|---|
| Basic (free) | Free | ✅ console only | ❌ | 50 / 50 | 3 |
| **Advanced (Entry)** | **Free** | ✅ | **✅** | 50 / 50 | 3 |
| Advanced | $14,000/yr or $1,400/mo | ✅ | ✅ | 1M / 1M | 120 |
| Premium | $42,000/yr or $4,200/mo | ✅ | ✅ | 5M / 5M | 300 |

Entry is the tier that unlocks the Assets API, and it is free — the free
**Basic** tier is console-only, which would not work for us. Prerequisites are
enterprise verification plus Organization real-name authentication with a
corporate registration certificate, and acceptance of four legal documents
including the "BytePlus Real Person Verification H5/API - Usage Rules".

Expiry has teeth worth knowing before anyone subscribes above Entry: 15 days
after a paid package lapses, assets created **during** that paid period are
deleted permanently. Assets created before it, or in the 15-day grace, survive.

### The ticket to actually send (998 chars)

The original per-person ticket is withdrawn: the documentation answers it.
What remains is a genuine contradiction between their written reply and their
own guide — and asking that shows we read both rather than neither.

```
Thank you — we have since read "Add real-human assets to asset library" (docs/ModelArk/2315856), which answers most of what we were going to ask. One point where it and your reply appear to differ, and it decides how we build.

You wrote: "Videos generated through the API do not require the end user to hold a BytePlus account."

The guide says: "real-person verification currently requires logging in to a BytePlus account", with the actor scanning our QR code, signing in, and verifying on their phone.

We read these as answering different questions: generating from a verified asset needs nothing from the end user, but enrolling that person does. Could you confirm?

For onboarding a new person today:

1. Is the QR-plus-login flow the only route, or does the Assets API on the Entry tier expose real-person verification we could host in our own product?

2. Does "currently" mean an API-hosted flow is planned?

We can build around either answer, and would rather build around the right one.
```
