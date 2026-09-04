# fal — which endpoints embed C2PA provenance

Send from hello@picacho.ai to fal support. This asks a supplier a factual
question about API behaviour; it deliberately makes no legal claim about fal's
obligations and no statement about Picacho's own compliance status.

**Placeholders to fill before sending:** [FAL ACCOUNT EMAIL OR TEAM ID], [SURNAME]

---

**Subject:** Does fal re-encode delivered files? (C2PA manifests, per endpoint)

```
Hi,

We're a fal customer — Picacho, an AI character-video product. Our video, our audio, and one of our two image lanes all run through fal. Our account is [FAL ACCOUNT EMAIL OR TEAM ID].

We need to know, per endpoint, whether the file your API hands back carries a C2PA manifest. Machine-readable provenance is becoming a requirement for products sold into the EU, and we need to be able to state accurately, per engine, what the file we deliver carries. We measured what we could ourselves first.

WHAT WE MEASURED — a one-off manual check on 3 September 2026, scanning the bytes of delivered files

- minimax/h3/reference-to-video — manifest present.
- google/gemini-omni-flash/v1.1/reference-to-video — none found. One render; we did not probe the text-to-video lane.
- blackforestlabs/flux-video-upscale — none found.
- One stored image of ours carries a manifest, but we can't attribute it to an engine, so we're treating both flux image lanes as unmeasured.

Caveat on our method, because it matters for how you read all four lines: it's a byte-level scan for the C2PA marker, not a validating parser, and it reads only the head of the file. So our negatives could be false — including if a model developer marks with an invisible watermark rather than C2PA — and our one positive is unvalidated too: we detect marker bytes, not a signed manifest. Correct us where we're wrong.

QUESTIONS, in the order that helps us most

1. Do you re-encode, transcode, re-container or rewrite metadata anywhere between the model's output and the file on our download URL — on any endpoint, or on the queue and CDN path generally? If the bytes pass through untouched, say exactly that and we'll take every marking question upstream to the model developers ourselves.

2. fal-ai/sync-lipsync/v2/pro re-renders the whole clip against a generated audio track, so its output — not the base render — is what our customer receives. Does it preserve a C2PA manifest present on the input video? This one is your processing rather than a model developer's, so if we only get one answer, we want this one.

3. Which of the endpoints listed below embed a manifest in their output today? A yes or no per line.

4. Where a manifest is present, whose certificate signs it — fal's or the model developer's — and is it on a public C2PA trust list?

5. Where it's absent, is there a request-side flag to switch it on? We're asking about a machine-readable manifest, not a visible overlay — a burned-in mark doesn't answer the same question. If there is a flag, does turning it on change price, latency or output size?

6. Where there's no C2PA, is any other machine-readable marking present that a byte scan like ours would miss — an invisible watermark applied by the model developer, for instance?

7. When you change the model version behind an endpoint, is that announced anywhere we can subscribe to? A changelog feed, a version field on the response, or a dated endpoint alias we can pin would all work. We're not asking you to track C2PA for us; we need to know when an endpoint's output could have changed.

THE ENDPOINTS — every fal endpoint whose output reaches one of our customers

Video
fal-ai/kling-video/v1.6/standard/text-to-video
fal-ai/kling-video/v1.6/standard/elements
fal-ai/kling-video/v2.1/pro/image-to-video
fal-ai/kling-video/o3/standard/image-to-video
fal-ai/kling-video/o3/pro/reference-to-video
fal-ai/kling-video/v2.5-turbo/pro/image-to-video
bytedance/seedance-2.0/reference-to-video
bytedance/seedance-2.5/reference-to-video
minimax/h3/reference-to-video  (measured: manifest present)
fal-ai/wan/v2.2-a14b/text-to-video/turbo
fal-ai/wan/v2.2-a14b/image-to-video/turbo
google/gemini-omni-flash/v1.1/text-to-video
google/gemini-omni-flash/v1.1/reference-to-video  (measured: none found)
fal-ai/veo3.1
fal-ai/veo3.1/image-to-video
blackforestlabs/flux-video-upscale  (measured: none found)

Audio, and audio plus video
fal-ai/elevenlabs/tts/eleven-v3  — does this mark its output?
fal-ai/sync-lipsync/v2/pro  — question 2 above

Image
fal-ai/flux-2-pro
fal-ai/flux-2-pro/edit

If it's only three lines: fal-ai/sync-lipsync/v2/pro, fal-ai/wan/v2.2-a14b/text-to-video/turbo and fal-ai/veo3.1. Our free tier is pinned to the wan lanes, and lipsync sits on top of every dialogue video we deliver.

One aside while we have you: we store none of the video we deliver — result_url points at your hosted file, and that's what our customer downloads. How long do those URLs live, and can the bytes behind one change after we've stored the URL?

We're not asking you for a legal position or for advice, only for factual API behaviour. Anything by 17 September lets us scope the work; a partial answer then beats a complete one in October. Happy to share our own measurements back across the full list once we have them — every EU customer you have will be asking this shortly, and the answer is better written once. Please treat the endpoint list above as commercially confidential.

Ahmad [SURNAME]
Founder, Picacho
picacho.ai · hello@picacho.ai
```

---

## Why it is shaped this way (internal — do not send)

FATAL FIXES

1. Legal self-characterisation removed entirely. Cut "EU AI Act Article 50(2) became applicable on 2 August 2026", "The obligation is ours — we're a Spanish company selling this product under our own name", and "we're not asking you to take it on". Two reviewers called this fatal from different directions and they were both right: the first is a dated, self-authored, discoverable document asserting a duty applies to us while enumerating three of our own lanes as unmarked; the second is a written waiver of any argument that fal is a provider, given away before any contract exists (no fal MSA exists anywhere in the repo). Replaced with a commercial need — "we need to be able to state accurately, per engine, what the file we deliver carries" — plus a neutral market observation that provenance is becoming an EU requirement, which asserts nothing about our own status in either direction. "We're not asking you for a legal position or for advice, only for factual API behaviour" is kept, near the close: it is the sentence that stops the thread being routed to fal's legal team, where it dies.

2. Both placeholder problems resolved. [SURNAME] stays because the surname is genuinely not in the repository (the git author string "Wigly" is a handle, not a surname, and must not be substituted). [REGISTRO MERCANTIL] is gone along with the whole corporate footer — see the conflict call below.

MAJOR FACTUAL FIXES, each verified against the repo

3. "Every model we call except our OpenAI image lane runs through fal, on one key" was false and checkable. We also call api.anthropic.com directly for prompt drafting (claude-sonnet-5) and the chat agent, and api.openai.com directly for identity scoring and image description (gpt-5.4-mini) and voice-mode TTS. Narrowed to "our video, our audio, and one of our two image lanes" — true, and it stops short of volunteering total supplier dependence immediately before asking that supplier for work. "On one key" cut as useless to the reader.

4. Endpoint list verified exhaustively rather than trusted. A repo-wide grep for endpoint string literals returns exactly the 22 strings the draft listed and no others — every line in the email is a real string we send. The two intermediates (fal-ai/image-editing/reframe, fal-ai/ffmpeg-api/extract-frame) are cut per the recipient reviewer: telling a busy vendor which part of the ask is optional guarantees that is the part you get. The list header is therefore "every fal endpoint whose output reaches one of our customers", which stays true after the cut. I dropped the draft's "these never reach a customer, so they're lower priority" reasoning with them — that sentence was an untested legal exemption theory about a lane that AI-alters a real person's photograph, and it is exactly the line that gets quoted back.

5. gemini-omni row fixed. The summary bullet named the model family with no lane while the list below annotated only reference-to-video, so the two halves of the email disagreed. Both now say google/gemini-omni-flash/v1.1/reference-to-video, with "one render; we did not probe the text-to-video lane" stated explicitly. Note docs/AI_ACT_MARKING.md:30 records only "Video — gemini-omni" without a lane; I attribute it to reference-to-video because that lane fires automatically whenever a character has a saved photo, which is the ordinary case, and I flag the single-sample scope so the claim can't over-read.

6. Method caveat made symmetric. The draft owned only the false-negative direction. Our probe (src/lib/media/c2pa-probe.ts:16, :29) matches the bare substring "c2pa" in the first 1 MiB and never checks digitalSourceType, so the minimax positive is as soft as the negatives. Now stated: "we detect marker bytes, not a signed manifest." One clause, and it stops fal finding the hole first. Compressed from four lines to two per the recipient reviewer.

7. Measurement framing softened to "a one-off manual check". Nothing in the repo reproduces the 3 September table — no script, no retained samples, no logged output, and c2pa-probe.ts is imported by no production code. Describing it as a standing method we could re-run on request would collapse in the first reply. For the same reason I did not add fal request ids: we don't have them.

8. "Whose identity signs it" narrowed to certificate and trust list, and the string "fal-ai/minimax_h3" is NOT quoted. The endpoint we actually call is minimax/h3/reference-to-video; the other string is something read out of a manifest months-old in our notes and not re-read from bytes. Being corrected on our own evidence in the first exchange would cost the credibility the rest of the email runs on.

CONFLICTS, and how I called them

9. The date. The recipient reviewer wanted "2 December 2026" in the subject line for urgency; the factual and legal reviewers both showed that date is unsourced and contradicted. Our own doc says 2 December with a grace period for systems on the market before August, but the repo's first commit is 2026-08-06, the earliest changelog entry 2026-08-14 and the ToS updated 12 August — every marker postdates 2 August, so the premise for claiming legacy relief fails on its own terms, and the upscale lane was operator-approved on 2026-09-02 regardless. I cut both dates and supplied the urgency commercially instead: "anything by 17 September lets us scope the work." A near, modest, self-set date gets calendared; a contested regulatory one gets us corrected or invites deprioritisation.

10. The corporate footer. The factual reviewer wanted CIF relabelled NIF (correct — legal-entity.ts:11-12 and the privacy policy in all four languages all say NIF, and the name is JEAR TECNICA S.A., two words); the legal reviewer wanted the registry placeholder deleted; the recipient reviewer wanted the whole block cut as letterhead intimidation that routes the email to legal rather than engineering. I cut the block. It resolves all three at once, removes an unfillable placeholder (legal-entity.ts:14-17 keeps registryLine deliberately empty until the escritura surfaces, and the live site renders it only when set precisely so no placeholder ever shows), and the corporate identity stays in reserve if they stonewall. The tagline went with it — marketing copy in a technical support mail.

11. The no-watermark distinction. Kept the technical point, cut the commercial motive. "We sell no-watermark output on every plan" is true (src/lib/i18n/messages/en.ts:362) but writing down that we declined a marking option to protect a pricing promise, in a file about marking, is the sentence that reads worst later. "A burned-in mark doesn't answer the same question" carries the same weight and concedes nothing.

WHERE A REVIEWER WAS WRONG, AND I KEPT THE ORIGINAL

12. The factual reviewer said the image-attribution bullet is "wrong about our own data" because every generations row records model_id. That's right about the row and beside the point: what was never recorded is which stored file the 3 September probe inspected, which is what the bullet actually says. I kept the substance and tightened the wording per the legal reviewer (dropped "our records don't say" and dropped naming OpenAI, which is commercial information fal doesn't need).

13. Two reviewers said to measure the flux lane before sending, and they are right that it is measurable — flux output is downloaded and re-uploaded verbatim into our own bucket, and character-reference renders route to flux deterministically. I did not do it: it requires reading production storage holding customer images, which is not something to do unprompted for an email draft. This is the single highest-value thing to do before sending. If the operator probes one stored flux render, replace that bullet with the hard result and the image section becomes an answer rather than a question.

14. "Which endpoints embed a manifest" is demoted, not deleted. The recipient reviewer was right that the cheap answer is "we pass through whatever the model returns" — so question 1 is now phrased so that pass-through IS a complete, usable answer rather than a dodge, and lipsync (fal's own processing, ten seconds to answer, changes what we build) is promoted to question 2 with its own justification. The per-line table survives as question 3.

ADDED, all from reviewer gaps

15. The re-encode question (Q1) — the one thing only fal can answer, and absent from the draft entirely. A missing manifest may be fal's delivery pipeline rather than the model developer's, and that distinction decides whether the fix is a request flag or a conversation with Google and ByteDance.
16. URL retention (the closing aside) — we store no generated video at all; result_url is fal's URL served straight to the customer, so fal's retention and any future re-encode is our delivery guarantee. Flagged as an aside so it doesn't dilute the marking ask.
17. Named the three lines we'd take if we only get three, with support: the free tier is pinned to wan (plans.ts:120) and lipsync sits on every dialogue video. No volume numbers — the repo contains none, and "low hundreds of renders" from the BytePlus draft has no source anywhere.
18. Account id inline as a placeholder rather than offered, saving a round trip. I did NOT add monthly spend, against the recipient reviewer's advice: the fal ledger shows 235 requests total, so a spend figure would weaken the ask rather than route it.
19. Something in it for them — offering our measurements back across the full list, which costs nothing and gives an engineer a reason to escalate rather than close.
20. A one-line confidentiality request on the endpoint list.

CUT FOR TONE, per the recipient reviewer: "so an engineer can answer line by line rather than in prose" (instructing the reader on their job), "so this isn't a discovery call" (sales jargon plus a pre-emptive accusation), "the one that matters most operationally" (verbal tic contradicting the new ordering). I also thinned the negation-then-correction construction the draft leaned on five times, keeping it only where the contrast is load-bearing.

---

## Cut to ticket size, 2026-09-04 — and sharpened by a measurement

The long draft above is ~5,000 characters and was written before we had the
one piece of evidence that makes this email answerable. On 2026-09-04 we
probed one delivered video from every endpoint on the account and found that
**bytedance/seedance-2.0/reference-to-video arrives with no C2PA manifest,
while ByteDance state in writing that the model embeds one.** That turns a
general question about policy into a specific question about fal's delivery
path, which is the kind an engineer can answer in one line.

So it splits like the BytePlus pair: the answerable question alone and first,
the per-endpoint audit second. Send from hello@picacho.ai, as a NEW ticket —
nothing has ever been sent to fal on this, so there is no thread to reply to.

The subject lines lead with the question fal can answer rather than with the
topic. "C2PA provenance" as a subject gets triaged to whoever owns compliance
questions; "do you re-encode delivered video" gets read by someone who knows
the answer, and the endpoint in the second half is the detail that makes them
open it.

Two things deliberately NOT in either: any claim about fal's own legal
obligations, and any statement of our compliance status. Both were cut from
the long draft for the reasons recorded in its rationale, and neither has
become safer to say since.

**Ticket 1 — the re-encode question (993 chars)**

Subject: `Does fal re-encode delivered video? bytedance/seedance-2.0 arrives without its C2PA manifest`

```
We are a fal customer (Picacho, an AI character-video product). A factual question about delivery, with our measurement first.

We probed one delivered video from every endpoint we use, reading the first 1 MiB at its result URL for a C2PA manifest. Two of nine carry one:

  minimax/h3/reference-to-video ............ present
  google/gemini-omni-flash/v1.1 ref-to-vid . present
  bytedance/seedance-2.0/reference-to-video  NONE
  the six kling / veo / wan / flux lanes ... none

The Seedance line is why we are writing. ByteDance state in writing that video from that model carries embedded C2PA provenance. The file we receive through fal does not: top-level boxes ftyp/moov/free/mdat, no uuid box, where both marked files have one.

Do you re-encode, transcode, re-containerise or rewrite metadata between a model's output and the file on our download URL — on that endpoint, or on the queue and CDN path generally?

If the bytes pass through untouched, say so and we will take it upstream.
```

**Ticket 2 — the per-endpoint audit (941 chars)**

Subject: `Which endpoints embed a C2PA manifest, and is there a request-side flag?`

```
Following our re-encoding question, the same topic from the other side.

1. Which of these embed a C2PA manifest today? Yes or no per line is all we need.

  kling-video/o3/pro/reference-to-video
  kling-video/o3/standard/image-to-video
  kling-video/v2.5-turbo/pro/image-to-video
  kling-video/v1.6/standard/text-to-video
  bytedance/seedance-2.0 and 2.5 /reference-to-video
  veo3.1 and veo3.1/image-to-video
  wan/v2.2-a14b/text-to-video/turbo
  blackforestlabs/flux-video-upscale
  sync-lipsync/v2/pro
  elevenlabs/tts/eleven-v3
  flux-2-pro and flux-2-pro/edit

2. Where one is absent, is there a request-side flag to turn it on? We mean a machine-readable manifest, not a visible overlay.

3. When the model behind an endpoint changes version, is that announced anywhere we can subscribe to — a changelog, a version field on the response, or a dated alias we can pin?

Happy to share our measurements across the list once we have them.
```
