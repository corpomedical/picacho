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
