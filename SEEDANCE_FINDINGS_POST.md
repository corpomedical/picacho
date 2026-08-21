# Community post — the Seedance likeness-policy findings

The verified discovery (2026-08-21 live tests) written up as value-first
content. Post from your own accounts; always keep the disclosure line —
it's required by most subreddit rules and it's what makes this credible
rather than promotional. Expect questions; the test details below are your
answers.

## The facts (from our live requests — your evidence if challenged)

- Seedance 2.5 `reference-to-video` AND `image-to-video` (via fal.ai) both
  rejected a photoreal AI-generated face with:
  `content_policy_violation — "The images or videos provided may contain
  likenesses of real people…" (reason: partner_validation_failed)` —
  rejected by ByteDance's own validation, before generation, uncharged.
- The same photoreal face on **Seedance 2.0** (both endpoints): generated
  successfully.
- A flat-vector cartoon mascot on **2.5**: generated successfully.
- Conclusion: 2.5 added a likeness fence that blocks photoreal humans
  (real or AI-generated — the filter can't tell); stylized characters pass;
  2.0 predates the policy.

## Version A — Reddit (r/aivideo, r/artificial, r/StableDiffusion)

**Title:** PSA: Seedance 2.5 silently rejects photoreal faces — 2.0 doesn't.
We verified it with live requests.

**Body:**

> We kept getting 422s from Seedance 2.5 on requests that looked perfectly
> valid, so we ran a controlled test instead of guessing:
>
> - Same photoreal (AI-generated) face → 2.5 reference-to-video: **rejected**
>   — "may contain likenesses of real people… cannot be processed"
>   (`partner_validation_failed`, i.e. ByteDance's own check, not the API
>   host's).
> - Same face → 2.5 image-to-video: **rejected**, same error.
> - Same face → Seedance **2.0**, both endpoints: **generated fine**.
> - Cartoon mascot → 2.5: **generated fine**.
>
> So: 2.5 ships an anti-deepfake likeness fence that blocks photoreal
> humans — including AI-generated ones, since the filter can't tell the
> difference — while stylized/illustrated characters pass. 2.0 predates
> the policy and still accepts faces.
>
> Practical takeaways if your "Seedance doesn't work" errors look like
> policy noise: it's not your prompt or your params. Use 2.0-class
> endpoints for photoreal people, keep 2.5 for illustrated characters
> (where its 30-second takes are genuinely great), and don't burn hours
> debugging a fence.
>
> Disclosure: I run picacho.ai (character-consistency tooling) — we hit
> this in production, tested it properly, and figured the findings were
> worth more shared than sitting in our logs. Happy to answer questions
> about the test setup.

## Version B — Hacker News (Ask/Tell HN, drier)

**Title:** Tell HN: ByteDance's Seedance 2.5 rejects photoreal faces at the
API level (2.0 doesn't)

**Body:** same facts as A, minus the "PSA" tone; lead with the error
payload, end with the one-line disclosure. HN rewards the payload quote and
punishes marketing adjectives — keep it clinical.

## Version C — X/thread (5 posts)

1. We just burned a day learning something about Seedance 2.5 that isn't
   documented anywhere. Sharing so you don't:
2. 2.5 rejects photoreal human faces as identity references — hard API
   rejection, "likenesses of real people", by ByteDance's own validator.
   AI-generated faces too: the filter can't tell.
3. Same face on Seedance 2.0: works. Both endpoints. Verified with live
   requests, not vibes.
4. Cartoon/illustrated characters sail through 2.5 — so its 30-second takes
   are effectively a stylized-characters feature now.
5. If your 422s look like nonsense: it's the fence, not your prompt.
   (Found while building picacho.ai — we measure character identity per
   render, so this mattered to us more than most.)

## Where & etiquette

- One subreddit per day, not a blast; each community notices cross-posting.
- Answer every technical question; never argue with "this is an ad"
  replies beyond pointing at the disclosure.
- If it lands well, the guide at
  https://picacho.ai/guides/ai-character-consistency (which documents the
  same finding) is the natural "longer writeup" link when someone asks.
