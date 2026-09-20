# Picacho launch kit (web-first)

Written 2026-09-20. Every product claim was read from source on 2026-09-20 (section 2 says where). It replaces `PRODUCT_HUNT_KIT.md` and `SEEDANCE_FINDINGS_POST.md`: the first waited for a Google Play approval and still said two things the site has since retracted, the second was marked superseded.

**How to use it.** Each fenced block is the exact text for ONE field: copy it as it is. Alternatives, counts and notes stay in the text around the blocks, never inside them. A heading that ends in `(max N)` is a length limit, and `src/lib/launch-kit.test.ts` fails the build if a block goes over it, quotes a price the pricing table doesn't have, or brings back a claim the site retracted. Nothing here has been posted or submitted.

---

## 1. The story, for you (not for pasting)

**Who it's for.** People who need one character to look like one person across many images and clips: AI filmmakers, creators, marketers, agencies with a recurring face (a presenter, a mascot, a founder).

**The sentence.** "The same face, in every single frame." It is on the site, so use it the same way everywhere.

**Three proofs, all checkable by a stranger in a minute.**

1. The match score printed under every image (the homepage shows real ones: 95, 91, 92).
2. A free checker anyone can use with no account, on output from any generator: `picacho.ai/tools/identity-check`.
3. The price is shown before every send, and a refused request never uses your credits.

**Three limits, said before someone else says them.**

1. The score is a vision model's judgment, not a measurement. No accuracy study has been published.
2. Photoreal real people are refused: our Content Policy forbids them without consent, and Seedance refuses them at the model.
3. Video takes minutes, not seconds.

**What is deliberately not in the kit** (it isn't live, or isn't proven): verifying your own face for Seedance (built, admin-only, BytePlus's business check is parked), Mystique and Recce (no public page, still being fixed), any Google Play link, and any "solo founder" line (you objected to it on 5 Sept).

---

## 2. Claims ledger (what the kit says, and where it is true)

| The kit says | True because (source, read 2026-09-20) |
|---|---|
| One photo saves a character; every image is scored 0-100 against it by a vision model and the number is printed under the result | Homepage stats; `providers/openai.ts` `scoreIdentityMatch` (a vision model reads both images, returns a score and one sentence about what differs) |
| A free checker: no account, any generator, nothing stored, 10 checks an hour per IP, about 4 MB | `app/tools/identity-check/page.tsx`; `app/api/tools/identity-check/route.ts` |
| A free generation every day, no card, on our fastest model | Pricing FAQ; `plans.ts` (`FREE_TIER_VIDEO_MODEL_ID` = Wan 2.2 Turbo, $0.10 a clip) |
| Plans from $9/month (Basic, 12 credits) to $499/month (Elite, 750 credits) | `lib/pricing.ts` `PRICING_TIERS` |
| A refused request never uses your credits | `lib/pricing.ts` features; pricing FAQ |
| The price is quoted before you send | Homepage "Send receipt" |
| Render with Seedance, Kling, Veo and more, on one subscription | Homepage engine rail (Seedance 2.0, Kling O3 Pro, Gemini Omni Flash 1.1, Veo 3.1 + 7 more) |
| Helios: describe a place, direct your character and camera inside a real 3D set; takes and films on every paid plan | Homepage Helios section; `/guides/helios` (live since 2026-09-19) |
| English, Spanish, Portuguese and Italian, the whole product | Homepage language card |
| API and an MCP server that return a `match_score` (Elite, other plans on request) | `/docs/api` |
| No real people without their consent | `lib/i18n/legal/content-policy.ts` |
| Refund within 7 days if it's your first subscription and you've used fewer than 5 generations | Pricing FAQ |
| Seedance: 21 Aug 2.5 refused a photoreal face and 2.0 took it; 3 Sep 2.0 refused what it took 11 days earlier; ByteDance now documents that 2.0 doesn't take direct uploads of real-person faces | `/guides/seedance-2` (dates inline); `providers/video-models.ts` comments |
| 4 Sep: a photograph of a real person sent straight to BytePlus's own API got HTTP 400 `InputImageSensitiveContentDetected.PrivacyInformation` | `providers/byteplus.ts` header |
| Photoreal people go to Kling O3 Pro (clips up to 15 s); illustrated and mascot characters to Seedance 2.5 (up to 30 s) | `/guides/seedance-2`; `video-models.ts` |
| Installs from the browser to the home screen on Android and iPhone | `components/install-badges.tsx`, `app/manifest.ts` (not yet tested on a real Android phone) |

**Never say** (each one is false or unproven today):

- "Failed generations never cost credits." Retracted 2026-08-30. Say: "Refused requests never use your credits."
- "A second model reviews your prompt." The two-model review was deleted. The steps are draft, validate, generate, score.
- Anything that points at Google Play. The listing is down; the site and the emails already hide it.
- "Guaranteed" or "verified" identity. The score is scored, not refunded, and gates nothing.
- "Every video is scored." The site promises images.
- "Verify your own face for Seedance." Built, not open.
- "Solo founder", "one-person shop".
- Competitor prices or features. The compare pages carry those, with sources.

---

## 3. Before you launch

1. **Fill the gallery.** *Made with Picacho* has 3 tiles and the first shows 79%. Feature about 15 of your best takes in Admin, and decide whether the 79% one stays on top.
2. **Top up the three balances and set an alert on each.** OpenAI scores every image and reads both content gates, Anthropic is the gates' second reader, fal renders the video. Balances ran dry during tests on 11 Sept (Anthropic) and 15 and 19 Sept (OpenAI), according to my notes of those sessions. A launch that fails on day one for lack of credit is worse than no launch.
3. **Know the free-tier bill.** A free account gets one clip a day on Wan 2.2 Turbo, which fal prices at $0.10 a video (read from `video-models.ts`, fal's page of 2026-09-01). 300 signups all using their clip on launch day is 300 x $0.10 = $30. 1,000 is $100. An account that comes back every day costs at most 30 x $0.10 = $3.00 a month.
4. **Decide a global cap for the free checker.** It stops one person at 10 checks an hour, but nothing stops many people. One check is one gpt-5.4-mini call with two images and a 2,000-token ceiling on the answer, and the code doesn't price it, so I can't put a number on it. Look at platform.openai.com/usage after the first 50 checks and multiply. I can add a daily ceiling (say 3,000 checks, then "busy, come back tomorrow") in about ten minutes once you name the number.
5. **Walk it as a stranger, on your phone.** Private window, homepage, Try the proof, Sign up, first free clip, result. Time it and write down the number you'll tell people. Then open picacho.ai in Chrome on an Android phone and tap **Get the app**.
6. **Measurement.** If the cookieless counter isn't in by Mon 28 Sept, the spike goes unmeasured. Use the tagged links in section 12 either way.
7. **Your Product Hunt account.** Product Hunt takes personal accounts only (your name and photo), and the account must be more than a week old on launch day (Product Hunt help, article 771527). If you don't have one, create it by Tue 22 Sept. A product can launch once per six months per domain (help article 484934), so if the ground isn't ready on the 29th, move the launch a week rather than spend it half-ready.
8. **Your Hacker News account.** Since March 2026 Show HN has been restricted for accounts with little history (`news.ycombinator.com/showlim`); whether that still applies in September isn't confirmed. Read that page. If the account is new, spend a week commenting usefully on other people's posts first. If Show HN is still limited on the 30th, hold it and put the checker on X and Reddit instead.
9. **Be at the keyboard on launch day.** Product Hunt rewards a maker who answers every comment for the first 12 hours. Have the support inbox open too.
10. **A video for Product Hunt.** Product Hunt takes a YouTube link (the full URL). The 16:9 file is `Picacho ai launch video.mov` (25 s); the vertical cuts for TikTok, Reels and Shorts are `Picacho TikTok 9x16 v3.mp4` and `Picacho Presets Demo.mp4` on your Desktop.

---

## 4. Calendar

| Day | What | Where it is |
|---|---|---|
| Sun 20 - Mon 21 Sept | You send the numbers I asked for; feature 15 takes; Bing Webmaster import. I build the cookieless counter (on your yes) and the checker cap (on your number). | sections 3, 12 |
| Tue 22 Sept | **Last day to create the Product Hunt account** (it must be over a week old on the 29th). Start the daily short clip. | section 3 |
| Wed 23 - Fri 25 | A short clip a day on Instagram, TikTok and Shorts, from the two vertical files you already have (I'll write that week's captions and shot list separately if you want them). Wed 23: the Seedance findings post on r/aifilmmaking. Any day: the free-checker post on X. | sections 7, 8 |
| Sat 26 - Mon 28 | Rehearse as a stranger. Upload the video to YouTube. Create the Product Hunt draft and schedule it for Tue 29 (it allows scheduling up to a month ahead). Draft the email. | sections 3, 5, 11 |
| **Tue 29 Sept, 00:01 Pacific** | **Product Hunt.** Post the maker comment at once, then the X post and the LinkedIn post, then the email to your users in the morning. Answer everything. | sections 5, 8, 11 |
| Wed 30 Sept | Show HN, in your own words, if your account allows it (see the note in section 6). | section 6 |
| Thu 1 Oct | The free-checker post on r/SideProject. Directories, first batch. | sections 7, 9 |
| Fri 2 Oct | Spanish post, in the Facebook groups and on X. | section 10 |
| Mon 5 Oct | Portuguese post. Directories, second batch. | sections 9, 10 |
| Tue 6 Oct | Italian post. Then read the numbers and decide what to repeat. | section 10 |

One community a day, never several at once: each one notices cross-posting.

---

## 5. Product Hunt (Tue 29 Sept, 00:01 Pacific)

**Do not ask anyone to upvote**, in the listing, the comments, the email or DMs. Ask people to look and leave an honest comment. Share the plain launch link.

#### Name

Name only: no description, no emoji.

```
Picacho
```

#### Tagline (max 60)

The homepage sentence, made to say what it is (Product Hunt's limit is 60). Two alternatives if you prefer them: `AI characters that keep their face, with a score to prove it` (60) or `The same face, in every single frame.` (37).

```
The same face in every frame, scored to prove it
```

#### Description (max 260)

The help center says 260 and the launch guide says 500; 260 satisfies both.

```
Save a character once from a photo. Every image and video keeps that face, and a vision model scores each image against your photo, printed under the result. A free generation every day, no card. Plans from $9/month.
```

#### Website

```
https://picacho.ai
```

**Topics.** Up to 3, from Product Hunt's own list: Artificial Intelligence and Video are the obvious two; add Design Tools or Marketing as the third. **Pricing tag:** the one for a paid product with a free trial or plan. **Thumbnail:** square, 240 x 240, under 3 MB (the P icon; `public/icon-512.png` scaled down).

**Gallery, in this order**, 1270 x 760, at least 2 images required (the team may edit your copy and images):

1. The homepage hero with the identity match chip, 1270 x 760.
2. The free checker with a real result on screen.
3. The send receipt (the price quoted before the button).
4. A Helios frame with the frame lines on.
5. One character across four scenes, with their scores.

The video is `Picacho ai launch video.mov` uploaded to YouTube; paste the full YouTube URL. I can make the five images from the live site if you want them.

#### Maker comment (post it the moment the launch goes live)

Product Hunt discourages AI-generated comments. Treat this as a draft: read it, change what isn't how you'd say it, then post.

```
Hi Product Hunt,

We built Picacho because every AI video tool we tried had the same quiet problem: the character in shot two was almost, but not quite, the person from shot one. "Almost" is exactly what audiences notice, and no tool would tell us when it happened.

So Picacho measures it. You save a character once from a photo. Every image you generate is compared with that photo by a vision model, and the match (0-100) is printed under the result, so you see it before your audience does.

The same check is free and needs no account. Upload a reference photo and any AI image, from any generator, and try it in a minute: picacho.ai/tools/identity-check

What else is inside: one place to render with Seedance, Kling, Veo and more, the price quoted before every send, refused requests never use your credits, and, new this month, Helios, where you describe a place and direct your character and camera inside a real 3D set.

Honest notes. The score is a vision model's judgment, not a guarantee, and we haven't published an accuracy study, so treat it as a strong hint. Photoreal real people aren't allowed without their consent. Video takes a few minutes.

Every account gets one free generation a day, no card, so you can see whether the same character holds up over several days. That is the whole claim.

I'll be here all day. Tell me what breaks, what's confusing, and what you'd need before trusting it with a real character.
```

**Through the day.** Answer every comment, including the sharp ones, within the hour; section 13 has the facts for the usual questions. Post one update comment if something real happens ("we passed N checks on the free tool, and the most common note so far is X"). Don't cross-post the Product Hunt link into Reddit or Hacker News.

**The day before.** The account you launch from should be a real one with some history; it must be more than a week old (section 3). Rehearse the stranger's path (also section 3).

---

## 6. Hacker News (Wed 30 Sept)

Post the free checker, not the product: Show HN is for something people can try, ideally without a sign-up or an email first, and sign-up pages and landing pages are off topic. The checker needs no account; the studio does. Link `https://picacho.ai/tools/identity-check` with no tag. Read `news.ycombinator.com/showhn.html` on the day.

#### Title (max 80)

```
Show HN: Identity Check - does an AI image still show the same person?
```

The title has to start with "Show HN", with no capitals for emphasis and no exclamation marks. Your username shouldn't be the company's.

**Write the first comment yourself, by hand.** The guidelines forbid posting AI-generated or AI-edited text, and Hacker News's own advice for launches is to write it without a language model at all. So there is no paste-ready comment here, and a pasted one would be spotted. Put the backstory, what is different and what it does in the first comment, with no marketing language. Say these things, in this order, plainly:

1. What it is: two images in, a 0-100 match and one sentence about what differs, on output from any generator.
2. How it works: a vision model with a fixed prompt reads both images; face, hair and distinguishing features count, clothing, pose and lighting don't. Not a face-recognition embedding. Every score is stamped with the model version.
3. What it isn't: we haven't published an accuracy study, and the request doesn't pin the sampling, so re-runs can differ. You want to hear where it disagrees with people's eyes.
4. Privacy: nothing is stored on our side; the two images go to a vision-model API to be scored. 4 MB or so, JPEG, PNG or WebP, 10 checks an hour per IP.
5. Why it exists: it is the check our character studio runs on every image it makes, unlocked and pointed at anything. One line, once. The studio needs an account; the checker doesn't.
6. If someone asks about the API: Elite plans get an API and an MCP server that return the same `match_score`, so an assistant can retry on its own.

**Mind the mood.** Don't argue, don't sell, answer the technical question that was asked, thank people who find the failure cases. Don't ask anyone to upvote or comment (asking friends to do it is against the rules), and don't cross-post the link the same day. If your account is too new for Show HN (see section 3), post it as a normal link only if you are ready for the questions.

---

## 7. Reddit

**Read this first.** The research agent could not read Reddit (it blocks automated fetching), so every rule below is second-hand and unverified. Read each community's rules and pinned posts on the day; a removed post costs the account. Reddit's own guidance, also second-hand, says promotion isn't spam by itself, but an account whose posts are mostly links to your own business gets flagged, the same text posted across communities counts as spam, and a moderator's reputation filter can hold posts from new accounts. So: post from an account that already has a history (spend a week commenting usefully first if it doesn't), one community a day, different wording in each, reply to every comment for the first few hours, and never delete a post that is getting criticism.

**Where, in English.**

- **r/aifilmmaking** (about 8K): the Seedance findings post, flair Tips & Tutorials. Character consistency is their pain point. It is small and quality-gated: no social videos, no memes.
- **r/SideProject** (about 850K): the free-checker post. Self-promotion is allowed. Reported removals: affiliate links, email-gated or waitlist-only products, same-day cross-posts and bare links. Say you are the maker.
- **Later, one each, in different words:** r/generativeAI (155K; self-promotion only as an original post with the required flair, linking to your own work) and r/alphaandbetausers (46K; the [Beta] flair, one post per product per month, say what stage it is at and what feedback you want).
- **r/aivideo** (395K) is the best audience but it is for finished clips: a tool post will probably be removed. If you ever have a clip worth showing, post it there with the prompt and the tool flair, and no link.
- **Skip:** r/StableDiffusion (reported to bar promoting yourself or paid tools), r/artificial (no selling), r/comfyui (bans paywalled workflows), r/SaaS (one mention per 60 days, or a weekly thread), r/startups (monthly thread), r/runwayml, r/KlingAI_Videos (Kling-made videos only).

#### Post 1 (Wed 23 Sept, r/aifilmmaking, flair Tips & Tutorials): the Seedance findings, title (max 300)

```
Seedance now refuses photoreal reference faces on 2.0 too: dated notes from production, and what works instead
```

#### Post 1: body

```
We build a character-consistency tool (picacho.ai), so we send a lot of reference photos to Seedance. Notes on how the photoreal-face fence moved, with dates, in case it saves you a debugging session.

21 Aug. Seedance 2.5, reference-to-video and image-to-video, rejected a photoreal (AI-generated) face before generating: content_policy_violation, "The images or videos provided may contain likenesses of real people…". Seedance 2.0 took the same face on both endpoints. A cartoon mascot passed on 2.5.

3 Sept. 2.0 refused reference photos it had accepted eleven days earlier. ByteDance's documentation now says the 2.0 series does not support direct uploads of reference images containing real-person faces; the sanctioned route is a verified asset library.

4 Sept. We sent a photograph of a real person straight to BytePlus's own API instead of going through fal: HTTP 400, InputImageSensitiveContentDetected.PrivacyInformation, "the input image … may contain real person". Same fence, so switching provider doesn't help. (A refusal at submit queues nothing, so it cost us nothing.)

What worked for us
- Photoreal people: Kling O3 Pro (reference-to-video, clips up to 15 s); it accepts those references in our tests.
- Illustrated and mascot characters: Seedance 2.5, up to 30 s.
- If a tool tells you Seedance "doesn't work" for your character, check for this before you rewrite the prompt.

Longer write-up with the dates and the rest of what we know about Seedance: https://picacho.ai/guides/seedance-2

Disclosure: I'm behind picacho.ai. Happy to answer questions about how we tested any of this.
```

#### Post 2 (Thu 1 Oct, r/SideProject): the free checker, title (max 300)

```
I made a free tool that scores whether an AI image still shows the same person as your reference photo (no account)
```

#### Post 2: body

```
When you generate a series of images or clips of the same character, "looks about right" is easy to fool yourself with at thumbnail size. So I made the check a tool anyone can use.

Upload the reference photo and any AI-generated image (from any generator: Kling, Midjourney, Veo, Sora, ours) and a vision model returns a 0-100 identity match with a short note on what differs. No account, nothing stored on our side.

How it works, so you can judge it: a vision model compares the two images with a fixed prompt. Face, hair and distinguishing features count; clothing, pose and lighting don't. It's a judgment, not a face-recognition embedding, and I haven't published an accuracy study, so treat it as a strong hint rather than a measurement. Limits: JPEG, PNG or WebP, about 4 MB, 10 checks an hour per IP address.

It's the same scorer my product runs on every image it generates (picacho.ai), so I'm biased. I'd like to know where the number disagrees with your eye.

https://picacho.ai/tools/identity-check
```

---

## 8. X and LinkedIn

X counts 280 characters and a link as 23. The limits below count every character, so they are conservative. Attach media where a block says so; a post with a video gets read far more than a bare link.

#### Launch post, Product Hunt day (max 280)

Attach `Picacho ai launch video.mov`. After you paste it, add the Product Hunt link after the colon.

```
Every AI video tool promises character consistency. None of them tells you whether it worked.

Picacho scores every image against your character's photo and prints the number under it. Live on Product Hunt today:
```

#### The free checker, as a post (max 280)

Post it any day from Tue 22 Sept, with a screenshot of a result.

```
Every AI video tool promises character consistency. None of them tells you whether it worked.

So we made the check free: upload a reference photo and any AI image, from any generator, and get a 0-100 identity match. No account.

picacho.ai/tools/identity-check
```

#### Thread 1 of 6: what happened to Seedance's face fence (max 280)

Post as one thread, in order. Same facts as the Reddit post in section 7, with the same dates.

```
Seedance 2.0 refused reference faces on 3 September that it had accepted eleven days earlier.

Dated notes from production, and what works instead. A thread.
```

#### Thread 2 of 6 (max 280)

```
21 Aug: Seedance 2.5 rejected a photoreal (AI-generated) face on both its reference and image-to-video endpoints: "may contain likenesses of real people". Seedance 2.0 took the same face. A cartoon mascot passed on 2.5.
```

#### Thread 3 of 6 (max 280)

```
3 Sept: 2.0 refused photos it had accepted eleven days earlier. ByteDance's docs now say the 2.0 series doesn't support direct uploads of reference images with real-person faces. The sanctioned route is a verified asset library.
```

#### Thread 4 of 6 (max 280)

```
4 Sept: we sent a photograph of a real person straight to BytePlus's own API, not through fal. HTTP 400, InputImageSensitiveContentDetected.PrivacyInformation. Same fence, so switching provider doesn't help.
```

#### Thread 5 of 6 (max 280)

```
What worked for us: photoreal people on Kling O3 Pro (clips up to 15 s), illustrated and mascot characters on Seedance 2.5 (up to 30 s).

If a tool says Seedance "doesn't work" for your character, check for this before rewriting the prompt.
```

#### Thread 6 of 6 (max 280)

```
The longer write-up, with the dates: picacho.ai/guides/seedance-2

(We make picacho.ai, a character studio, and hit this in production.)
```

#### LinkedIn post (max 900)

Post it on launch day from your own profile, then reply to comments the same way you do on Product Hunt.

```
If your brand has a recurring face (a presenter, a mascot, a founder), the hard part of AI video isn't making one good clip. It's making the tenth one look like the first.

Picacho keeps a saved character consistent across images and video, scores every image against the reference photo, and prints the number under the result, so you see the match before your audience does. Brand rules are checked before anything is generated, and the price is shown before every send.

The identity check is also a free tool that needs no account and works on output from any generator: picacho.ai/tools/identity-check
```

---

## 9. Directories (a backlink each; the alternatives pages are the prize)

A research agent read each site's own pages on 2026-09-20 and submitted nothing. **Free and worth doing**, in this order, about ten minutes each. Two batches: Thu 1 Oct and Mon 5 Oct.

1. **AlternativeTo** (`alternativeto.net`, submit after signing in; verified email; the queue runs months, a $5 priority option exists). It builds "alternatives to X" pages, and yours would sit beside HeyGen, Hedra, Higgsfield, ImagineArt and Renoise, the same five as our compare pages. Its FAQ says it declines products that are thin wrappers around another company's model, so lead with the saved character, the score and brand rules, not with the engines.
2. **SaaSHub** (`saashub.com/services/submit`, free queue, no time stated). Listing your competitors and verifying with a domain email raises the priority. Its own paid "Featured" slot ($99/month) isn't needed.
3. **G2** (`sell.g2.com/create-a-profile`). Profile is free, verification takes 3-5 working days. B2B only, and the seller must be a registered business with its own domain, which JEAR TECNICA S.A. is. The grid needs 10 or more reviews, so this one pays off later, not now.
4. **Capterra** (`capterra.com/vendors`, run by the same team as G2). Free profile. Its rules: a public trial or demo, a description with no superlatives and no calls to action, screenshots of the real interface.
5. **FutureTools** (`futuretools.io/submit-a-tool`). A free form: name, URL, short description, category, pricing, email.
6. **Curious Refuge's AI tools list** (`curiousrefuge.com/best-ai-tools`, an AI-filmmaking audience). The page invites submissions; the form itself wasn't verified, so read it first.

**Also checked and not worth it now.** Uneed's decline page names generic AI video generators as saturated, and its dofollow link needs a launch-day score of 20 or more. Peerlist needs a verified profile (its ID check has a fee). Fazier's free tier makes you link to Fazier from your site.

**Skip.** There's An AI For That ($49 to list), Futurepedia ($247+), Toolify ($99 express route) and BetaList charge to be listed. Dang.ai's free tier makes you link to them from your site. TopAI.tools blocked the research. A few "best AI video generator" list sites (`aivideogenerationtools.best`, VideAITools) look like link farms. Product Hunt is section 5. The Ahrefs and Similarweb connectors would let me measure the authority of each of these, but they need you to authorize them in your claude.ai connector settings.

Category to pick where asked: AI video generator (first) and AI image generator (second). Pricing: freemium. Platform: web (it installs to the home screen on Android and iPhone). Logo: `public/logo.png` and `public/brand-icon.png`; the 1200 x 630 card is `public/og-image.png`.

#### Directory: short description (max 160)

```
Save a character once from a photo. Every image and video keeps that face, and a vision model scores each image against it. A free generation every day.
```

#### Directory: medium description (max 300)

```
Picacho is an AI character studio. Save a character once from a photo; every image and video keeps that face, and a vision model scores each image against your photo so you see the match first. Render with Seedance, Kling, Veo and more on one subscription. A free generation every day, no card.
```

#### Directory: long description (max 600)

```
Picacho is an AI character studio for images and video. Save a character once from a photo; every image and video keeps that face, and a vision model scores each image against it, with the number printed under the result. Render with Seedance, Kling, Veo and more on one subscription, with the price shown before every send. Helios lets you direct your character inside a real 3D set. A free identity checker works on any generator's images, no account. A free generation every day, no card; plans from $9/month. In English, Spanish, Portuguese and Italian.
```

#### Capterra and G2: description without calls to action (max 600)

They ask for no superlatives and no calls to action, so this drops "free generation" and the price.

```
Picacho is an AI character studio for images and video. A character is saved once from a photo, and every image and video keeps that face. A vision model scores each image against the reference photo and prints the number under the result, so a team sees the match before publishing. Brand rules are checked before anything is generated, the price of each send is shown before it is spent, and one subscription covers several video and image engines. Available in English, Spanish, Portuguese and Italian.
```

---

## 10. Español, Português, Italiano

The site's own sentence in each language, for bios and captions: "La misma cara, en cada fotograma." / "O mesmo rosto, em cada quadro." / "La stessa faccia, in ogni singolo fotogramma."

The free checker page is English-only for now, so these posts link to the localized homepage and point at the checker as a bonus. Registers follow the site: Peninsular Spanish, Brazilian Portuguese, standard Italian. One language per day, never the same day as another.

**Where.** The research agent could not confirm any Spanish, Portuguese or Italian subreddit about AI creation, and I won't guess names. What it did find (sizes from public group pages; rules and activity unverified, so join, read the rules and watch a few days before you post):

- **Spanish:** Facebook groups "Inteligencia Artificial - Español" (about 188K) and "Inteligencia Artificial en español" (about 29K); Telegram group "Inteligencia Artificial" (about 2,300 members).
- **Portuguese (Brazil):** Facebook groups "I.A. Inteligência Artificial Brasil" (about 22.8K) and "INTELIGÊNCIA ARTIFICIAL - Iniciantes e Avançados" (about 12.5K).
- **Italian:** Facebook groups "Intelligenza Artificiale AI e ChatGPT Community Italia" (about 44.5K) and "AI Intelligenza Artificiale Italia" (about 12K). r/ItalyInformatica (195K, IT professionals) only as a genuine technical discussion, never as an announcement.

In a Facebook group paste the body only and let its first line do the title's job. Many groups hold posts with links for an admin's approval or remove anything promotional, so read the rules and, if they ask, message an admin first. The short posts (max 280) are for X, Threads or Bluesky in that language.

### Español

#### Español: post corto (max 280)

```
Todas las herramientas de vídeo con IA prometen personajes consistentes. Ninguna te dice si lo han conseguido.

Picacho puntúa cada imagen contra la foto de tu personaje y muestra la coincidencia de identidad. Una generación gratis cada día, sin tarjeta: picacho.ai/es
```

#### Español: comunidad, título (max 300)

```
Seedance ya rechaza también las caras fotorrealistas como referencia en la 2.0: notas fechadas de producción y qué funciona
```

#### Español: comunidad, cuerpo

```
Desarrollamos una herramienta de consistencia de personajes (picacho.ai), así que mandamos muchas fotos de referencia a Seedance. Apuntes con fechas sobre cómo se ha movido el filtro de caras fotorrealistas, por si te ahorra una sesión de depuración.

21 ago. Seedance 2.5 (referencia a vídeo e imagen a vídeo) rechazó, antes de generar, una cara fotorrealista creada con IA: content_policy_violation, "The images or videos provided may contain likenesses of real people…". Seedance 2.0 aceptó la misma cara en los dos endpoints. Una mascota de dibujos animados pasó en la 2.5.

3 sept. La 2.0 rechazó fotos de referencia que había aceptado once días antes. La documentación de ByteDance ya dice que la serie 2.0 no admite subir directamente imágenes de referencia con caras de personas reales; la vía autorizada es una biblioteca de activos verificados.

4 sept. Enviamos la fotografía de una persona real directamente a la API de BytePlus, sin pasar por fal: HTTP 400, InputImageSensitiveContentDetected.PrivacyInformation, "the input image … may contain real person". Mismo filtro, así que cambiar de proveedor no lo evita.

Qué nos ha funcionado
- Personas fotorrealistas: Kling O3 Pro (referencia a vídeo, clips de hasta 15 s); acepta esas referencias en nuestras pruebas.
- Personajes ilustrados y mascotas: Seedance 2.5, hasta 30 s.
- Si una herramienta te dice que Seedance "no funciona" con tu personaje, mira esto antes de reescribir el prompt.

Guía completa con las fechas (en inglés): https://picacho.ai/guides/seedance-2

Transparencia: estoy detrás de picacho.ai. Con gusto contesto preguntas sobre cómo lo probamos.
```

### Português (Brasil)

#### Português: post curto (max 280)

```
Toda ferramenta de vídeo com IA promete personagens consistentes. Nenhuma diz se conseguiu.

O Picacho pontua cada imagem contra a foto do seu personagem e mostra a correspondência de identidade. Uma geração grátis por dia, sem cartão: picacho.ai/pt
```

#### Português: comunidade, título (max 300)

```
O Seedance agora recusa rostos fotorrealistas como referência também na 2.0: notas datadas de produção e o que funciona
```

#### Português: comunidade, corpo

```
Desenvolvemos uma ferramenta de consistência de personagens (picacho.ai), então enviamos muitas fotos de referência para o Seedance. Anotações com datas sobre como o filtro de rostos fotorrealistas mudou, caso isso poupe uma sessão de depuração.

21 ago. O Seedance 2.5 (referência para vídeo e imagem para vídeo) recusou, antes de gerar, um rosto fotorrealista criado por IA: content_policy_violation, "The images or videos provided may contain likenesses of real people…". O Seedance 2.0 aceitou o mesmo rosto nos dois endpoints. Um mascote de desenho animado passou na 2.5.

3 set. A 2.0 recusou fotos de referência que tinha aceitado onze dias antes. A documentação da ByteDance agora diz que a série 2.0 não aceita o envio direto de imagens de referência com rostos de pessoas reais; o caminho oficial é uma biblioteca de ativos verificados.

4 set. Enviamos a fotografia de uma pessoa real direto para a API da BytePlus, sem passar pela fal: HTTP 400, InputImageSensitiveContentDetected.PrivacyInformation, "the input image … may contain real person". Mesmo filtro, então trocar de provedor não resolve.

O que funcionou para nós
- Pessoas fotorrealistas: Kling O3 Pro (referência para vídeo, clipes de até 15 s); aceita essas referências nos nossos testes.
- Personagens ilustrados e mascotes: Seedance 2.5, até 30 s.
- Se uma ferramenta disser que o Seedance "não funciona" com o seu personagem, veja isso antes de reescrever o prompt.

Guia completo com as datas (em inglês): https://picacho.ai/guides/seedance-2

Transparência: estou por trás do picacho.ai. Posso responder a perguntas sobre como testamos.
```

### Italiano

#### Italiano: post breve (max 280)

```
Ogni strumento video con IA promette personaggi coerenti. Nessuno ti dice se ci è riuscito.

Picacho assegna un punteggio a ogni immagine rispetto alla foto del tuo personaggio e mostra la somiglianza d'identità. Una generazione gratuita ogni giorno, senza carta: picacho.ai/it
```

#### Italiano: community, titolo (max 300)

```
Seedance ora rifiuta i volti fotorealistici come riferimento anche nella 2.0: note datate dalla produzione e cosa funziona
```

#### Italiano: community, testo

```
Sviluppiamo uno strumento per la coerenza dei personaggi (picacho.ai), quindi mandiamo molte foto di riferimento a Seedance. Appunti con le date su come si è mosso il filtro sui volti fotorealistici, nel caso ti risparmi una sessione di debug.

21 ago. Seedance 2.5 (riferimento-a-video e immagine-a-video) ha rifiutato, prima di generare, un volto fotorealistico creato con l'IA: content_policy_violation, "The images or videos provided may contain likenesses of real people…". Seedance 2.0 ha accettato lo stesso volto su entrambi gli endpoint. Una mascotte a cartoni animati è passata sulla 2.5.

3 set. La 2.0 ha rifiutato foto di riferimento che aveva accettato undici giorni prima. La documentazione di ByteDance ora dice che la serie 2.0 non supporta il caricamento diretto di immagini di riferimento con volti di persone reali; la via autorizzata è una libreria di asset verificati.

4 set. Abbiamo inviato la fotografia di una persona reale direttamente all'API di BytePlus, senza passare da fal: HTTP 400, InputImageSensitiveContentDetected.PrivacyInformation, "the input image … may contain real person". Stesso filtro, quindi cambiare fornitore non aiuta.

Cosa ha funzionato per noi
- Persone fotorealistiche: Kling O3 Pro (riferimento-a-video, clip fino a 15 s); nei nostri test accetta quei riferimenti.
- Personaggi illustrati e mascotte: Seedance 2.5, fino a 30 s.
- Se uno strumento ti dice che Seedance "non funziona" con il tuo personaggio, controlla questo prima di riscrivere il prompt.

Guida completa con le date (in inglese): https://picacho.ai/guides/seedance-2

Trasparenza: sono dietro a picacho.ai. Volentieri rispondo a domande su come abbiamo testato.
```

---

## 11. Email to your users

Send it from Admin on launch morning, to confirmed addresses. It doesn't ask for upvotes (Product Hunt penalizes that); it asks for an honest comment. The bodies use the email tool's own format (`{{username}}` and `<a href>` are the only markup it keeps). After you paste a body, add one last paragraph with the Product Hunt launch link as `<a href="https://…">Picacho on Product Hunt</a>`; the address isn't known until the launch page exists. If Admin lets you split the list by language, send each user their language; otherwise send the English one.

#### Email, English: subject (max 80)

```
Picacho is on Product Hunt today
```

#### Email, English: body

```
Hi {{username}},

Today Picacho launches on Product Hunt. If you've made something with it, an honest comment there about what worked and what didn't would help more than anything.

If you haven't tried the free identity checker yet, it needs no account and works on images from any generator: <a href="https://picacho.ai/tools/identity-check?utm_source=email&utm_medium=announcement&utm_campaign=launch-2026-09">picacho.ai/tools/identity-check</a>

Thank you for being early.
```

#### Email, español: asunto (max 80)

```
Picacho sale hoy en Product Hunt
```

#### Email, español: cuerpo

```
Hola {{username}}:

Hoy Picacho sale en Product Hunt. Si has hecho algo con Picacho, un comentario sincero allí sobre lo que funcionó y lo que no nos ayudaría más que nada.

Si aún no has probado el verificador de identidad gratuito, no necesita cuenta y funciona con imágenes de cualquier generador (en inglés): <a href="https://picacho.ai/tools/identity-check?utm_source=email&utm_medium=announcement&utm_campaign=launch-2026-09">picacho.ai/tools/identity-check</a>

Gracias por estar desde el principio.
```

#### Email, português: assunto (max 80)

```
O Picacho está hoje no Product Hunt
```

#### Email, português: corpo

```
Olá, {{username}},

Hoje o Picacho é lançado no Product Hunt. Se você já criou algo com o Picacho, um comentário sincero lá sobre o que funcionou e o que não funcionou ajudaria mais do que qualquer outra coisa.

Se ainda não experimentou o verificador de identidade gratuito, ele não precisa de conta e funciona com imagens de qualquer gerador (em inglês): <a href="https://picacho.ai/tools/identity-check?utm_source=email&utm_medium=announcement&utm_campaign=launch-2026-09">picacho.ai/tools/identity-check</a>

Agradecemos por estar aqui desde o começo.
```

#### Email, italiano: oggetto (max 80)

```
Oggi Picacho è su Product Hunt
```

#### Email, italiano: corpo

```
Ciao {{username}},

Oggi Picacho debutta su Product Hunt. Se hai creato qualcosa con Picacho, un commento sincero lì su cosa ha funzionato e cosa no ci aiuterebbe più di ogni altra cosa.

Se non hai ancora provato il verificatore di identità gratuito, non richiede un account e funziona con immagini di qualsiasi generatore (in inglese): <a href="https://picacho.ai/tools/identity-check?utm_source=email&utm_medium=announcement&utm_campaign=launch-2026-09">picacho.ai/tools/identity-check</a>

Grazie per esserci fin dall'inizio.
```

---

## 12. Tagged links

Where a platform strips the referrer (bios, email, apps), put a tag on the link so the visit says where it came from once the counter is in. Reddit, Hacker News and Product Hunt send their own referrer, so post those links clean.

#### Instagram bio

```
https://picacho.ai/?utm_source=instagram&utm_medium=bio&utm_campaign=launch-2026-09
```

#### TikTok bio

```
https://picacho.ai/?utm_source=tiktok&utm_medium=bio&utm_campaign=launch-2026-09
```

#### YouTube description and channel link

```
https://picacho.ai/?utm_source=youtube&utm_medium=description&utm_campaign=launch-2026-09
```

#### X profile and posts

```
https://picacho.ai/?utm_source=x&utm_medium=post&utm_campaign=launch-2026-09
```

#### The free checker, for any post that links it

```
https://picacho.ai/tools/identity-check?utm_source=social&utm_medium=post&utm_campaign=launch-2026-09
```

#### Spanish, Portuguese and Italian homepages, for local posts

```
https://picacho.ai/es?utm_source=social&utm_medium=post&utm_campaign=launch-2026-09
```

```
https://picacho.ai/pt?utm_source=social&utm_medium=post&utm_campaign=launch-2026-09
```

```
https://picacho.ai/it?utm_source=social&utm_medium=post&utm_campaign=launch-2026-09
```

---

## 13. The questions you'll be asked, and what is true today

These are talking points, not paste-ready text: answer in your own words, from these facts.

- **How does the score work?** A vision model (currently gpt-5.4-mini) reads the reference photo and the new image with a fixed prompt and returns 0-100 plus one sentence about what differs. Face, hair and distinguishing features count; clothing, pose, lighting and setting don't. Every score is stamped with the model version that produced it. It is not a face-recognition embedding.
- **Is it accurate, and is it repeatable?** We haven't published an accuracy study, we haven't measured how well it agrees with human judgment, and the request doesn't pin the sampling (no seed or temperature is set), so don't promise identical numbers on a re-run. Call it a strong hint, not a measurement, and say you would like to hear where it disagrees with someone's eye.
- **Which engines?** Seedance, Kling O3 Pro, Veo 3.1, Gemini Omni Flash 1.1 and more, on one subscription. The homepage lists the current set.
- **What does it cost?** A free generation every day, no card. Then Basic $9/month (12 credits), Starter $19 (30), Growth $79 (140), Studio $299 (550), Elite $499 (750). Annual billing is about 11% to 20% cheaper. A standard clip or image is 1 credit; premium models cost more and the exact cost is shown before you send. EU visitors are billed the same numbers in euros.
- **Do failed generations cost credits?** If we block the request, or a provider refuses it before rendering, it never counts. If a render fails after it has started, write to support and we put the credit back where the fault was ours. Stopping a render yourself is the one exception, once the engine has started on it.
- **Refunds?** A full refund within 7 days if it's your first subscription and you've used fewer than 5 generations. Cancel any time; you keep access to the end of the paid period.
- **Can I use a celebrity's face, or my friend's?** No. The Content Policy forbids any real, identifiable person without their explicit consent. If the character is you, you confirm that when you save it.
- **Do you train on my photos?** Say only what is written: your generations are stored in cloud storage that only your account and our administrators (for support and safety) can reach; your prompts and reference photos are sent to the AI providers that render them, under their API terms; we don't sell personal data. There is no sentence in the Privacy Policy that says "we don't train on your content". If you want to say it, get it into the policy first: it will be a top question.
- **Is there an app?** It installs from the browser to the home screen on Android and iPhone (Get the app in the header). Don't mention Google Play.
- **API?** Elite includes an API and an MCP server for Claude, Cursor or any MCP client; both return the same `match_score`, so an assistant can retry on its own. Other plans can ask for access. Video isn't in the API yet.
- **What is Helios?** You describe a place and get a walkable 3D set; you place your character and a camera with a real lens; stills, takes and films keep the same place. It's on every paid plan, with a monthly cap on set builds. It is new, so answer questions about it honestly rather than promising a result.
- **Why not use Kling or Seedance directly?** You can, and if you only need one clip you should. Picacho adds a saved character, brand rules checked before generation, the score under every image, the price before every send, and one subscription across engines.
- **Watermarks?** Your own downloads carry none on any plan, free included. Takes you choose to share publicly carry a small Picacho mark.
- **Where does the company operate?** From Spain, so GDPR applies (the Privacy Policy says so).

