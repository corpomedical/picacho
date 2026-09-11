# Astra Sets

Date: 2026-09-10. Status: Phase 0 and Phase 1 are built and switched off (flag `astra_sets`, admins only once on). Phases 2 and 3 are not built. Evidence comes from four places:
- 13 live responses from `gpt-6-astra` on Picacho's own key, recorded 2026-09-10. Total spend was $1.297.
- OpenAI's documentation.
- Competitors' own pages.
- A read of the repo. No repo files were modified.

Each probe ran once (n=1). Picacho's rule is that no verdict rests on one sample, so every "measured" figure below is a lead for the eval in section 4, not a result.

## The short version

Through our API, Astra takes text and images in and puts text out. It renders nothing. On our key it measurably did three things well:
- **A 3D set from a sentence.** It wrote one that ran first time: 84 s, $0.29.
- **A 3D set from a photo.** It rebuilt a photographed location as a 3D set you can orbit, with the camera where the photographer stood: 264 s, $0.67.
- **Camera reading.** It read a photo's layout and camera more accurately than gpt-5.4-mini: $0.103 against $0.004.

It did not do better at writing a shot list as text. gpt-5.4-mini produced an equally valid one for one eleventh of the price.

**The proposal is "Sets": Astra builds the location, not the picture.**
- Astra builds a reusable 3D location.
- The user places their saved character (as a grey stand-in on a mark) and the camera in it.
- Every still and clip renders through the engines, both content gates, identity scoring and refund rules Picacho already runs.
- Astra never sees, names or describes the character.

Higgsfield's 3D Jutsu ships the grey-box half of this. No competitor I found publishes an identity score on what comes out.

**Features, ranked by user value ÷ effort:**
1. Sets from a description (admins in days).
2. Sets from a photo, plus "Match this shot".
3. Previz board: Astra blocks out a multi-shot scene inside a Set. This one ships only if Astra beats a cheaper model in a blind test.

**Not doing:** Astra as prompt drafter, gate reader, identity scorer, chat-agent brain, image generator or video editor (reasons in 3.4).

## Status and what was measured while building (2026-09-10)

**Built.** Phase 0 (both ungated image paths now pass the picture check; the utility readers refuse any `gpt-6` model; a hashed `safety_identifier`; the guard test; the three flags, off) and Phase 1 (Sets from a description, admins only). Code: `src/lib/sets/`, `src/lib/generations/providers/astra.ts`, `src/lib/astra/prices.ts`, `src/components/sets/`, `src/app/app/sets/`. SQL: `supabase/applied/2026-09-10/astra-sets.sql` (run in production 2026-09-11; flags confirmed off, tables present, anonymous key refused).

**Deliberately not built in Phase 1.**
- The shared `stage-canvas.tsx`: the Angle Stage is a live Studio/Elite lane that cannot be exercised without a paid account and a proxy. Sets has its own viewer; the Stage is untouched.
- A credit price per build: Phase 1 is bounded by the monthly cap in `set-config.ts`, as the design said.

**First live JSON build on our key** (2026-09-10; production schema, effort `low`, background mode, `store: false`, `tools: []`, strict schema, `safety_identifier`, `prompt_cache_options.ttl: "30m"`; all accepted):

| Brief | Time | Tokens in / out (reasoning) | Cost | Result |
|---|---|---|---|---|
| Rainy night market street, one noodle stall, lamp post, puddles, shuttered shops | 90.5 s | 1,626 / 5,593 (47) | $0.296 | 42 objects expanding to 176 shapes (23 used `repeat`), 4 lights, 2 marks, 3 cameras. Valid first time; the normaliser clamped nothing. Description people-free and brand-free |

```
1,626 × $10/1M + 5,593 × $50/1M = $0.01626 + $0.27965 = $0.296
Worst case per attempt (set-config.ts as first written): 1,800 × $12.50/1M + 10,000 × $50/1M = $0.5225; two attempts $1.045 (since re-measured: $1.155, see the cap table in 3.1)
```

The real answer is the test fixture `src/lib/sets/fixtures-rainy-market.json`.

**Do stills follow a set snapshot?** One square snapshot per Astra camera, sent to GPT Image 2 edit with the server-built shot prompt, a generic invented person and no character photo (so this measures layout only, not identity). 3 of 3 matched the sketch's camera, lens, layout and light direction and put the person on the figure's spot; the same stall, lamp and shutters carried across the three angles. About $0.17 each (the `plans.ts` GPT Image figure), $0.51 in all. **Watch in eval Part C:** from the low "puddle level" camera the person came out small and read younger. With a real character the identity score would catch it, but Part C should record how often a low angle shrinks or de-ages the person.

n = 1 build and 3 stills. Every figure above is a lead for the eval in section 4, not a result.

**First production run (2026-09-11, the operator's admin account).** Brief "A street in europe with restaurants and coffee shops": ready on the first attempt, $0.4321, 66 objects expanding to 351 shapes, 3 marks, 3 cameras. One still, shot from a camera the operator placed: GPT Image 2, identity 89 on the first attempt (above the gate's 70), brand rules and the output check passed, 1 credit. The still kept the frame's facade, awning, café tables, kerb and planters and put the character on the mark. Where the camera looked past the end of the set into empty sky, the image model invented buildings.

**Closing the set (same day).** That gap is the one thing a Set exists to prevent: whatever the image model invents there changes from shot to shot. A rule was added to the builder's instructions ("Close the set, so no camera ever sees where it ends"). Measured by standing at each set's first mark and rendering the eight compass directions at eye height, judged blind by three judges per sheet (majority of three):

| Set | Instructions | Directions where the set visibly ends |
|---|---|---|
| Rainy market (first probe) | before | 3 of 8 |
| European street (production) | before | 4 of 8 |
| Rainy market, rebuilt | after | 0 of 8 |
| European street, rebuilt | after | 0 of 8 |

The two rebuilds cost $0.3094 (1,698 in / 5,849 out) and $0.2536 (1,723 in, 1,680 of them read from cache, / 5,029 out), so the rule costs nothing measurable. n = 2 builds per version: a strong lead, not a verdict. Sets built before the rule keep their open edges until rebuilt.

**The fourth wall, and a measure instead of judges (2026-09-11).** The operator's next two builds were interiors, built on the closed-set rule, six minutes after it went live: "A moder set podcast studio." ($0.29) and "A modern sports car on a dealership" ($0.28). Both left out the wall behind their cameras — the theatre's fourth wall — and the showroom's side glazing also stopped short of its back wall. The podcast studio's near-black background hid its missing wall from the eye.

Closure is now MEASURED on every build (`src/lib/sets/closure.ts`): from every mark at eye height, a fan of 5 rays (±8°) on each of 16 bearings; a bearing is open when at least 2 of the 5 escape past everything built and, just below the horizon, meet the interpreter's bare floor rather than anything the set modelled (a sea or dunes are a horizon; bare floor is an edge). The downward rays look no further than a set can build (300 m). It agreed direction for direction with the three blind judges on all four sets they scored, named the podcast studio's missing +Z wall and the showroom's +Z wall and +X corner gap, and runs in 10–60 ms (18–42 ms on a 400-shape, 4-mark set).

The instructions now say there is no fourth wall, walls meet at the corners, a glass front is still a wall, and a natural horizon is modelled to the horizon. Eight builds on them (the operator's three briefs word for word, plus a diner with big windows, a bedroom, a beach, a forest clearing, a rooftop at night), all valid first time at $0.2394–$0.3288 (mean $0.279), 85–116 s:

| Brief | Closed from every mark? |
|---|---|
| podcast studio, car showroom, European street, diner, bedroom, forest, rooftop | yes (7 of 8) |
| beach at sunset | no: the modelled sea (dead ahead) and dunes (inland) read closed, but bare floor runs to the sky along the shore both ways, and just either side of dead ahead, where the 200 m-wide sea stops short of the horizon |

The one retry a build already had is now spent on closing: a valid set that measures open is sent back to Astra with the open sides named, to be mended and returned — or, when a mend could not fit (over 16,000 characters to re-emit, or within 40 shapes of the 400 limit), rebuilt with the open sides named. The first set is kept as a draft meanwhile, and the person gets whichever of the two is more closed — or the draft, if anything happens to the retry (`src/lib/sets/build-retry.ts`). A refusal of the closing retry is logged under the provider, never as the person's. Worst case per build is now $0.53 + $0.625 = $1.155 (input re-measured at 1,837–1,843 tokens with short briefs, bounded at 2,400 for a 500-character brief; `set-config.ts` shows the arithmetic). At the measured first-attempt rate (1 in 8 open) the average cost barely moves. Sets over ~110 m with a natural horizon were not in the test builds.

**The mend, verified (2026-09-11, after the organisation's prepaid balance ran out and was topped up).** Five real open sets were sent back through the production retry input (`closeRetryInput`), plus one large-horizon build:

| Open set | Retry | Open bearings before → after | Cost | Time | Original objects kept exactly |
|---|---|---|---|---|---|
| Production showroom | mend | 5 → 0 | $0.2881 | 53 s | 43 of 43, cameras and marks identical; added the front wall and the corner strips |
| Production podcast studio | mend | 5 → 0 | $0.2678 | 53 s | 42 of 42; added the front wall and a ceiling |
| Beach | mend | 9 → 0 | $0.2772 | 56 s | 38 of 38; added sea and sand tiled to the horizon, and flanking dunes |
| Rainy market (first probe) | mend | 4 → 0 | $0.2901 | 57 s | 42 of 42; added end walls with windows at both ends |
| Production European street (16,127 characters, over the mend limit) | fresh, told | 7 → 0 | $0.3146 | 80 s | a new set, as expected |
| "Open ocean seen from the end of a long wooden pier at noon." | first build | 0 | $0.2166 | 60 s | — |

Two blind judges per mended set agreed with the measure on the market, the showroom and the street; on the podcast studio they agreed but called two views too dark to be sure; on the pier they split. On the beach both judges still saw flat sand running to the sky in two views: Astra closed the shoreline the way the rule allows — sand modelled out to the horizon — which the eye cannot tell from bare floor, and which is also what a long beach looks like. The measure is left as it is: telling "real" sand from floor by colour would be a rule about what a surface looks like, not what the set is.

**Dark sets, fixed (2026-09-11).** The cause was physics, not Astra's taste: since r155 three.js lights physically, so fill light reaches a surface divided by π, while Astra writes fill intensities on the old artist-friendly scale and tints them with the scene's own dark palette. Daylit sets hide it (the sun dominates); sets lit by fill and a few lamps collapse to black. Telling Astra to use more fill did not help (it did: 0.65–0.85; the sets stayed dark).

The fix is exposure, chosen once per set like a camera's (`src/lib/sets/exposure.ts`): when a set opens, the viewer measures the mean brightness of the first mark's eye-height panorama through the real renderer and raises the exposure until it reaches 80/255 — only ever raising, at most 8× (1.3 → 10.4), by false position in log-exposure. One exposure per SET, so the view, every snapshot sent to the image model and the card on the Sets page share it. Cards taken before the fix were taken at the base exposure, so the thumbnail's path now carries a version (`<user>/sets/<setId>.v2.jpg`, `setThumbPath`): a card at any other path is taken again the next time its set is opened, and the old file is removed. When the exposure was lifted, the shot prompt says the sketch is lit brighter than the scene and that the time of day and darkness come from the description; the viewer sends `lifted` with the shot, and a daylit set's prompt is unchanged. A readback that returns nothing — a GPU reset mid-measurement, seen as zero alpha where everything a set draws is opaque — counts as no measurement at any step of the search, and the set keeps the base exposure rather than being lifted 8×.

Measured on all twenty sets built so far (panorama from the first mark; one consistent run):

| | Sets | Near-black share of the panorama |
|---|---|---|
| Daylit | 11 (street ×3, showroom ×2, diner, bedroom, beach ×2, pier, rebuilt street) | unchanged — exposure stays at 1.3 |
| Interiors and night streets | podcast studio ×3, market ×3, showroom (mended) | 47–65% → 9–16% |
| Capped | forest at dusk, rooftop at night | 89% → 18%, 77% → 22% (what remains is mostly night sky) |

Blown-out pixels stayed at or under 2.2% everywhere. In a real browser the measurement takes 79–91 ms (pixel ratio 2), before the first frame.

Does a lifted sketch still give a night still? Four GPT Image 2 stills from lifted night sketches (a generic invented person, no character photo): the market with the new prompt line and, as a control, without it; the forest at dusk; the rooftop at night. All four came back as night or dusk — rain-dark cobbles under lamplight, a campfire under a purple sky, a lit skyline — with the layout followed, including the market's mended end wall, which the dark sketch had hidden. The control shows the image model takes night from the description even without the line; the line stays as a cheap safeguard, sent only with lifted sketches. About $0.68 at the `plans.ts` GPT Image figure.

---

## 1. What Astra is through our API today

### 1.1 Measured on Picacho's key

All probes used the Responses API at the default effort (the response reports `medium`), with no tools and `store: false`. Raw responses were kept with the research session; costs are recomputed from each usage block.

| Probe | Time | Tokens in / out (reasoning) | Cost | Result |
|---|---|---|---|---|
| Director: shot list with a strict `json_schema` | 14.7 s | 334 / 696 (0) | $0.038 | 3 shots, 4+3+3 s. Passes the storyboard contract (`actions.ts:836-864`). Shot 3 is 637 characters, over Cinema Studio's 600 cap (`scene-plan.ts:42`) |
| Same, effort `low` | 17.9 s | 334 / 718 | $0.039 | Valid |
| Same, Fast tier | 10.4 s | 334 / 778 (91) | $0.084 | Valid, at double price |
| **gpt-5.4-mini, same brief** | 5.6 s | 334 / 715 | **$0.0035** | Valid, 4 shots |
| Set from words (three.js code) | 84.2 s | 307 / 5,712 (360) | $0.289 | 16 KB file. Only network use is jsdelivr three@0.160. Headless Chrome: ready in 6.4 s, 0 console errors, snapshots worked at 4 angles |
| Set from a photo (public-domain NPS lighthouse photo) | 264.1 s | 1,992 / 12,834 (4,007) | $0.667 | 22 KB. The first camera reproduces the photo's framing (checked by eye against the photo) |
| Vision: layout and camera from a photo | 41.8 s | 1,821 / 1,608 (285) | $0.103 | Every structure placed correctly. Camera estimate: 1.6 m high, +9° pitch, ~25° yaw, 35 mm |
| **gpt-5.4-mini, same image** | 5.2 s | 1,821 / 612 | $0.004 | Mast in the wrong place, horizon wrong |
| Image through Astra's hosted `image_generation` tool | 17.6 s | 1,725 / 114, plus image | $0.029 | Actually gpt-image-2. $0.023 of the $0.029 is Astra token overhead |
| `POST /v1/videos` with `gpt-6-astra` | n/a | n/a | $0 | HTTP 400: only the sora-2 family is accepted |
| `code_interpreter` sandbox | n/a | n/a | ~$0.04 | No Blender or bpy. It does have ffmpeg, node and trimesh |

**Cost arithmetic.** Prices per 1M tokens are $10 input, $1 cached input, $12.50 cache write and $50 output (https://developers.openai.com/api/docs/pricing). For example, set from a photo:

```
1,989 × $12.50/1M + 3 × $10/1M + 12,834 × $50/1M = $0.0249 + $0.00003 + $0.6417 = $0.667
Reasoning tokens alone (4,007 of the 12,834 output tokens) = $0.20, i.e. 30% of that call
```

Converted at Picacho's cost basis of $0.28 provider cost per credit (`video-models.ts:839`):

| Call | Credits at cost basis |
|---|---|
| Director | 0.14 |
| Set from words | 1.03 |
| Set from photo | 2.38 |
| Vision read | 0.37 |

Our key's rate limits for Astra are 500 requests/min and 500K tokens/min (from the `x-ratelimit-*` headers), which are the Tier 1 figures.

### 1.2 Documented (primary sources)

- **Modalities.** Text and image in, text out. Audio and video are "Not supported". There is no 3D output. The context window is 1,050,000 tokens and the output cap 128,000. There is one alias and no dated snapshot (https://developers.openai.com/api/docs/models/gpt-6-astra).
- **Unsupported parameters.** `temperature`, `top_p` and logprobs are unsupported. `seed` is not mentioned anywhere. Tool calling needs the Responses API (https://developers.openai.com/api/docs/guides/latest-model).
- **Reasoning.** `reasoning.effort` accepts low, medium, high, xhigh or max; `none` returns HTTP 400. Reasoning tokens are billed as output (https://developers.openai.com/api/docs/guides/reasoning).
- **Price modifiers.** Prompts over 272K input tokens cost 2x on input and 1.5x on output for the whole request. Batch and Flex are half price. Fast mode is 2x, has no latency guarantee, and is unavailable with EU data residency (https://developers.openai.com/api/docs/pricing ; https://developers.openai.com/api/docs/guides/fast-mode).
- **Background mode.** Set `background: true`, then poll `GET /v1/responses/{id}`. With `store: false` the response is deleted after roughly 10 minutes. Cancel is `POST /v1/responses/{id}/cancel`. The guide's examples use `gpt-6-astra` (https://developers.openai.com/api/docs/guides/background). Webhooks can deliver `response.completed`, signed with Standard Webhooks headers (https://developers.openai.com/api/docs/guides/webhooks).
- **Safety identifiers.** `safety_identifier` lets OpenAI block one end user instead of the whole org (https://developers.openai.com/api/docs/guides/safety-checks). Picacho sends none today: a grep of `src/` finds zero hits.
- **Misalignment monitoring.** On the Responses API a flagged conversation returns HTTP 403 `misalignment_policy_violation` and cannot be resumed (https://developers.openai.com/api/docs/guides/safety-checks/misalignment-monitoring).
- **Video.** OpenAI's only video model is Sora 2. It refuses real people and rejects input images that show human faces, so it cannot serve Picacho's characters (https://developers.openai.com/api/docs/guides/video-generation).

### 1.3 What it cannot do, and what is still unknown

**Cannot:**
- Make pixels itself. Its only route to images is calling gpt-image through a tool.
- Render video or 3D, or take video input.
- Run Blender in OpenAI's sandbox. The Blender/Cycles demos run Blender outside the API (https://developers.openai.com/blog/architectural-visualization-with-astra).
- Accept `temperature: 0`. That means it cannot sit in our gates' readers, which rely on temperature 0 plus a seed.

**Unknown (flagged):**
- **Variance.** Every probe ran once. Two Astra calls on the same lighthouse photo disagreed: 1.6 m and +9° pitch in the vision probe, against 2.1 m and +6.3° in the photo-to-set probe.
- **JSON sets.** Sets were measured as three.js code. This proposal uses a JSON set description instead, whose quality and token count are unmeasured.
- **Cheaper builders.** No cheaper model was tried on building sets. Astra's edge there rests only on OpenAI's own BenchCAD figure (95.9% against 84.3% for Fable 5.1; https://openai.com/index/gpt-6-astra/).
- **People.** No photo containing people was sent.
- **Background mode.** Documented for Astra but not probed. Also unknown: whether `seed` works, and how Astra resizes images.

---

## 2. Competitors, and the gap Picacho can own

| Who | What ships with Astra | Where the pixels come from | Identity measured? |
|---|---|---|---|
| Higgsfield **3D Jutsu** (Sep 4–5) | Browser workspace. An agent builds editable grey-box scene data: objects, lights, cameras, Mixamo figures and a timeline. The user picks the driving model from 30+ LLMs; "Auto" is the free default and Astra costs about 17 credits a message. A cost estimate shows before sending. Modes include "generate without asking" (https://higgsfield.ai/blog/higgsfield-3d-jutsu) | A previz clip plus Soul character and location references go to a video model. Higgsfield's X post: "Seedance 2.5 generates the final pass" (https://x.com/higgsfield_ai/status/2096088339548115037, read via oEmbed) | No published score |
| Higgsfield Supercomputer, Games 2.0, ChatGPT plugin | Agent orchestration. The plugin exposes Soul 2.0 characters, Seedance 2.5, Kling 3 and GPT Image 2 inside ChatGPT (https://higgsfield.ai/blog/generate-ai-videos-from-chatgpt ; https://higgsfield.ai/blog/higgsfield-mcp-gpt6-astra-games-2) | Their own engines | No |
| Krea | No Astra. Elements (Sep 9): up to 8 reference images plus written guidelines under an @tag, for characters and locations (https://www.krea.ai/docs/changelog) | Its image and video models | No |
| Runway | No Astra. MCP agent workflows and Premiere/After Effects plugins (https://runway.com/changelog) | Its own models | No |
| Dreamina (ByteDance) | States its Astra review is not an integration. Suggests an Astra-assisted Blender clay render, then Seedance (https://dreamina.capcut.com/resource/gpt-6-astra-review) | Seedance | No |
| OpenAI's own demos | Codex writes Blender Python, rendered in Cycles; Three.js games (https://developers.openai.com/blog/how-to-build-games-with-astra) | Blender/Cycles, three.js | n/a |

**The real threat is not Astra.** It is ChatGPT plus Astra plus Higgsfield's plugin (consistent-character video from a chat window), together with Krea Elements. Saved characters are becoming a commodity, and saved locations are next. I found no public Astra integration at Leonardo, OpenArt, Freepik, Pika, Luma, Hedra, Captions, CapCut, Kling or Firefly. That is only an absence of search hits, not proof.

**The gap Picacho can own:**
1. **A number on every frame.** Picacho scores every render against the character's identity photo and acts on it: a miss gets one free re-render, and a double miss is refunded (`identity-gate.ts`, threshold 70). Nobody above publishes a score. One third-party tester reports that Astra-built characters "stray considerably from original designs" (https://yage.ai/gpt-6-astra-3d-modeling-en.html, unverified). So Astra builds the place and never the person.
2. **A saved location.** A Set is a saved asset, like a Character: same location, any camera, any take.
3. **Two gates at every render boundary**, including text the model wrote. There is no "generate without asking": every spend is a click on a quote.
4. **One fixed price per build.** Edits made by dragging are free. Higgsfield charges about 17 credits per Astra message.
5. **Routing by measurement.** Our eval picks the builder model and the still engine, and the UI names them. A 30-model picker leaves that to the user.

**Constraint.** Picacho cannot copy the Seedance final pass for most characters. Seedance refused real-person references on both fal and BytePlus in the 2026-09-06 production canary (row 3c981323). Video legs for real-person characters therefore stay on Kling.

---

## 3. The product

| # | Feature | User value | Effort | Why this rank |
|---|---|---|---|---|
| 1 | Sets from a description | High: a consistent location and real camera control, reusable | M: about 5–7 dev days, including Phase 0 | Astra's best measured result. Shots reuse the existing image lane, so gates, scores and refunds come for free, and every paid plan can reach it |
| 2 | Sets from a photo, plus Match this shot | High for photo sets, medium for matching | S on top of #1 | Same schema plus image input. Astra beat mini on the one vision test |
| 3 | Previz board | High, if it works | M–L | Astra's text-only direction showed no edge, so it must win an A/B first |

### 3.1 Feature 1: Sets from a description

**User flow**
1. **Describe.** Sets → New set, e.g. "a rainy market street at night, one stall, a lamp post". The button states price and time before anything is spent: "Build set · 2 credits · about 1–2 min" (in Phase 1: "1 of 10 set builds this month").
2. **Gate the words.** Picacho gates the text with `gatePrompt` before anything is sent to OpenAI. It is the user's own text, logged against them as usual (`policy-log.ts:129`).
3. **Build in the background.** Astra runs on the Responses API with `background: true`, `store: false`, `tools: []`, a strict `json_schema`, `max_output_tokens` 10,000, effort `low` or `medium` (the eval decides) and a `safety_identifier`. The page polls, the same way the Hunyuan proxy is polled today (`angle-stage.ts:69-88`).
4. **Normalise.** `normaliseSetSpec` clamps counts, sizes, numbers and colours. It is the only path from model output to the screen. Astra's one-line description of the place is gated as model-written text.
5. **Arrange.** The set opens in the existing three.js viewer (`angle-stage-view.tsx:85-168`), built by Picacho's own fixed interpreter from primitives, flat materials, lights and fog. A neutral grey figure stands on a mark at the character's height. The user orbits, drags the mark, picks one of Astra's suggested cameras or places their own, and sets the lens.
6. **Shoot here.** The viewer takes a 1024 × 1024 square snapshot of exactly the square its frame guide shows (image takes render square; `openai-images.ts` pins 1024×1024). The server stores it as a chat attachment and it rides the take in the "reference" role (`actions.ts:530`). Then `runGeneration` runs an ordinary image take with the saved character plus the snapshot, using a prompt built on the server. The result lands in History with its identity score.
7. **Animate.** Two stills go to the Start & end frames lane (Kling v2.1 pro, Studio/Elite). Alternatively, a still rides as a reference on any video lane the plan allows that accepts one.

**Set description sketch.** All bounds are enforced by `normaliseSetSpec`.

```ts
type SetSpec = {
  version: 1;
  title: string;                 // ≤ 60 chars, shown in the UI only
  description: string;           // ≤ 300 chars, the ONLY Astra text that reaches a render provider (gated)
  bounds: { x: number; z: number; height: number };         // metres, ≤ 200 × 200 × 100
  sky: { kind: "color" | "gradient" | "night"; colors: string[] };
  fog?: { color: string; near: number; far: number };
  lights: Light[];               // ≤ 8: sun | point | spot | ambient
  objects: Obj[];                // ≤ 400: box | cylinder | cone | sphere | plane | torus | capsule;
                                 // position/rotation/scale, color, roughness, metalness, emissive,
                                 // castShadow, optional repeat {count, offset} to save output tokens
  marks: Mark[];                 // 1–4 places a person stands: x, z, facingDeg
  cameras: Cam[];                // 1–6 named: position, target, fovDeg 20–90
};
```

The design has no textures, no model-supplied URLs and no code. That means nothing is fetched and the content-security policy does not change.

**Server-built shot prompt (draft, effect not measured):**

```
Image {N} is a layout sketch of the location, not a style reference. Match its camera position,
lens, framing, horizon and light direction exactly. Render the location photorealistically: {set
description}. The person stands where the grey figure stands, at its scale and facing. Take the
person's face, hair and features only from the character photos.
```

**Which engines render the pixels**
- **Stills:** GPT Image 2 edit (the default lane) or FLUX.2 Pro edit (up to 10 references). Both already exist (`image-models.ts`).
- **Eval candidate:** Seedream v4 edit, the Angle Stage's re-render engine, at $0.03 per image (https://fal.ai/models/fal-ai/bytedance/seedream/v4/edit). The 2026-09-05 Angle Stage prototype showed it following proxy sketches.
- **Video:** the Kling frames lane.
- **Astra renders nothing.**

**How identity consistency is kept**
- Astra is never given the character: no photos, no name, no appearance. It is told to model no people, only marks.
- The grey figure carries position, scale and facing only.
- The character's saved photos stay the only identity input, riding the same lane as any render.
- Every still is scored with `scoreIdentityMatch`, and the identity gate at 70 applies: one free re-render on a miss, a refund on a double miss.
- The Set's contact sheet shows each still's score. A still under 70 can only become a start frame after a visible warning.

**How the content gates wrap it**
1. **User brief:** `gatePrompt` runs before any OpenAI call. A refusal means no call and no charge, logged to the user.
2. **Astra's description:** checked with `assertPromptAllowed`, and a refusal is recorded with `provider: 'astra'`. `recentRefusalCount` (`policy-log.ts:99-118`) gains `.is("provider", null)`, so text the model wrote never makes the user's next hour stricter. That is a code-only change, but first a read-only check must confirm that no existing prompt-gate row sets `provider`.
3. **Object labels:** never sent to any provider. React escapes them on screen.
4. **Shots:** the compiled prompt is re-gated in the pipeline (`pipeline.ts:1224`). The still is judged by the output gate, and `finish()` puts it in the strict lane because attachments are non-empty. A refusal is terminal and refunded (`output_blocked`).
5. **`tools: []` on every Astra request.** The hosted image generator, computer use and code interpreter can then never create pixels, or spend money, outside our lanes.
6. **Safety identifier:** `sha256(userId + server salt)` on every request. A 403 `misalignment_policy_violation` or a refusal item is terminal: no retry, and the build slot or credits are returned.

**Pricing, arithmetic from real token costs**

```
Credit weights follow the catalogue rule: ceil(provider cost / $0.28)   (video-models.ts:839, :898-901)

Measured (words → three.js code): 307 × $10/1M + 5,712 × $50/1M = $0.0031 + $0.2856 = $0.289

Worst case for the product call. Assumed: a 3,000-token schema plus instructions written to cache,
a 300-token brief, and output capped at 10,000 tokens:
  3,000 × $12.50/1M + 300 × $10/1M + 10,000 × $50/1M = $0.0375 + $0.003 + $0.50 = $0.54
  $0.54 / $0.28 = 1.93 → 2 credits per build

What the user pays for 2 credits: $1.09 on Studio ($299/550 credits) up to $1.50 on Basic ($9/12)   (pricing.ts)
Each shot is an ordinary image take at 1 credit (quote.ts: images are always 1)
A 5 s Start & end clip is 1 + storyboardFrameExtraCredits = 2 credits (video-models.ts:910)
Example: build + start and end stills + one 5 s clip = 2 + 2 + 2 = 6 credits ≈ $3.26 on Studio

Phase 1, before a credit ledger exists: a monthly cap per plan, as the Angle Stage does
(angle-stage-config.ts). As built (set-config.ts, 2026-09-11), a counted build can be TWO attempts —
the one retry goes to an answer that came back unusable, or to CLOSING a valid set that measures
open, which may send the set back as input:
  first attempt: 2,400 × $12.50/1M + 10,000 × $50/1M = $0.03 + $0.50 = $0.53
  closing retry: 10,000 × $12.50/1M + 10,000 × $50/1M = $0.125 + $0.50 = $0.625
  per build:     $0.53 + $0.625 = $1.155
  Basic 1 → $1.16 of $9 = 12.8%     Starter 2 → $2.31 of $19 = 12.2%   Growth 5 → $5.78 of $79 = 7.3%
  Studio 10 → $11.55 of $299 = 3.9%  Elite 25 → $28.88 of $499 = 5.8%
  At the measured $0.24–$0.43 with no retry: Basic 2.7–4.8% of $9, Starter 2.5–4.5% of $19
  (Precedent: the chat budget holds worst case at about 10% of the plan price, plans.ts:207-223)
  DECISION BEFORE WIDENING: Basic and Starter pass the 10% precedent in the worst case (every
  build retried, every retry run to the output cap). Accept that, or open Sets to Growth and up.

Failure rule (operator decision): one automatic retry at our cost; after two failures the slot or
credits come back. The most we absorb on a failed build is 2 × $0.53 = $1.06 (a closing retry never
ends in a failed build: the first set is kept and delivered).
```

**What could go wrong**
- **JSON quality.** JSON sets may be worse or longer than the code sets we measured. Eval Part A covers this.
- **Layout adherence.** Still engines may copy the flat grey look or ignore the layout. Part C measures composition adherence; the fallback is Seedream v4 edit.
- **Identity dilution.** The extra reference image may lower identity. The identity gate absorbs misses, but at our cost, so the miss rate must be measured.
- **Palette habits.** Testers report "AI design smell" (forest-green palettes, flat design) (https://www.mindstudio.ai/blog/gpt6-astra-practical-use-cases, unverified). Mitigation: palette instructions, and the user can recolour by picking.
- **Brands in real venues.** Sets of real venues can bake brands into stills; the Lakers court and the Tomb Raider poster already turned up in our own renders. Mitigation: instruct "no brand names or logos"; the description is gated.
- **Lost builds.** The wait is about 84 s. If the user leaves and nothing polls within about 10 minutes, the `store: false` result is gone. We refund the slot; Phase 2 adds a webhook finisher.
- **Mobile GPUs.** At most 400 objects, and repeats instead of copies.

### 3.2 Feature 2: Sets from a photo, and Match this shot

**User flow, photo set**
1. **Upload.** "New set from a photo" takes a location photo. Before it leaves Picacho, the photo is judged by the output gate's readers as an input check (`assertOutputAllowed`, `output-policy.ts:692`). A refused photo never reaches OpenAI.
2. **Build.** Astra (image input, `detail: high`) returns a SetSpec whose first camera is the photographer's viewpoint. People in the photo become marks; Astra is told never to identify or describe them.
3. **Compare.** The photo and the first-camera snapshot appear side by side, so the user can see whether they match before spending on a shot.
4. **Shoot.** Same as Feature 1.

**User flow, Match this shot**
1. On any Set, or on today's Angle Stage proxy, choose "Match a shot" and pick a reference still (a film frame or a photo). It is gated the same way.
2. Astra returns camera height, pitch, yaw, focal length or field of view, distance to the subject, and framing. Nothing about any person in the image is read.
3. The stage camera snaps to that position relative to the mark.

**Engines, identity and gates:** same as Feature 1. The only addition is the input-image gate on uploaded photos.

**Pricing**

```
Measured (photo → code): $0.0249 + $0.00003 + $0.6417 = $0.667
Worst case. Assumed: 4,800 input tokens including the image, written to cache; output capped at 16,000:
  4,800 × $12.50/1M + 16,000 × $50/1M = $0.06 + $0.80 = $0.86 → $0.86 / $0.28 = 3.07 → 4 credits
  (includes matching the photo's camera)
  If the eval's p95 output is ≤ 13,000 tokens: cap at 15,000 → $0.06 + $0.75 = $0.81 → 2.89 → 3 credits
  A cap below ~13,000 would have cut off the one measured run (12,834 output tokens)

Match this shot on its own. Measured: $0.103
Worst case (3,300 cache-write tokens + 2,500 output cap):
  3,300 × $12.50/1M + 2,500 × $50/1M = $0.041 + $0.125 = $0.166 → 0.59 → 1 credit
```

**What could go wrong**
- **Latency.** A photo build takes about 264 s (4.4 min) and the background result survives only about 10 minutes, so the webhook finisher is required before general release.
- **Camera variance.** Two Astra reads of the same photo differed by 0.5 m in height and about 3° in pitch. Eval Part E.
- **Photos with people.** Untested. OpenAI's usage policies ban non-consensual photorealistic likeness (https://openai.com/policies/usage-policies/), and the Astra system card has no likeness or deepfake section (https://deploymentsafety.openai.com/gpt-6-astra). The bar is zero: if Astra identifies a person in any eval case, photos containing people are refused at input.
- **Cost.** This is the one expensive call. Reasoning tokens were 30% of its cost. Whether effort `low` cuts that without losing fidelity is unmeasured.

### 3.3 Feature 3: Previz board

**User flow**
1. **Describe the action.** Inside a Set: "She walks from the stall to the lamp, stops, looks back."
2. **Plan.** The director (Astra, or a cheaper model if it ties in the A/B) returns 2–6 shots. Each shot has start and end cameras (position, target, lens) in set coordinates, mark positions, a camera-move preset from the proven vocabulary (`sceneVocabulary()`, `scene-plan.ts:62`), a duration in seconds, and an action line of at most 600 characters with no appearance.
3. **Normalise.** `normalisePrevizPlan` reuses `MIN_SCENE_SHOTS`/`MAX_SCENE_SHOTS` (2–6), the 600-character cap and the proven presets. It also clamps cameras inside the set bounds and seconds to the durations the chosen engine accepts.
4. **Preview for free.** The stage renders every shot's grey start and end frames on the client, at no charge, as a board. The user drags cameras, reorders shots or deletes them.
5. **One quote.** The whole board gets one quote (`quoteSend` with `renderCount`) and one click.
6. **Render.** Each shot gets start and end stills (image takes, gated and scored) and then a 5 s clip on the frames lane. A shot whose still misses identity re-renders alone; the other shots keep their results.

**Engines:** the image lane, then Kling v2.1 pro start/end. Kling O3 Pro storyboard (`multi_prompt`, 30 s or less) is the single-clip alternative.

**Identity:** every still is scored before any video money is spent on it. Clips are scored by the existing lane.

**Gates:**
- The brief is gated when the plan is made, as `planScene` does (`prompts/actions.ts:593`).
- Each action line is gated as model-written text.
- Every still and clip goes through the pipeline and the output gate. `judgeRender` reads one middle frame per clip (`output-policy.ts:822-825`). That is acceptable here because each clip comes from a single shot's prompt, not a composite.

**Pricing**

```
Plan call. Assumed: a 6,000-token set plus 1,500 tokens of instructions, written to cache; output cap 3,500:
  7,500 × $12.50/1M + 3,500 × $50/1M = $0.094 + $0.175 = $0.269 → 0.96 → 1 credit
  (1 credit minimum, like unitsForTurn)
Text-only comparison (measured): Astra $0.038 against gpt-5.4-mini $0.0035 for an equally valid shot list
Example: 4 shots, each with start and end stills and a 5 s clip: 1 + 4 × (2 + 2) = 17 credits ≈ $9.24 on Studio
```

**What could go wrong**
- **No measured edge.** Astra showed no advantage as a text director. Ship on whichever model wins blind.
- **Fan-out cost.** Six shots on a premium lane in one click is expensive. Controls: at most 6 shots, one quote, and the shortfall gate.
- **Continuity.** Lighting and wardrobe may drift between shots. The Set fixes location and light; wardrobe comes from the character references. Measure it.
- **Demand.** Production has 0 Cinema Studio renders (no generations with angle like `shot-%`), so demand for multi-shot is unproven.

### 3.4 Not building, and why

- **Prompt drafter on Astra.** Drafting runs on every attempt of every render. At the same token volumes Astra is 5x Sonnet 5 per token, which raises the all-in cost per credit from $0.3396 to $0.4302 (+26.7%) (`video-models.ts:803`; https://claude.com/pricing), with no evidence of better quality. Also, `draftWithClaude` is the prompt gate's backup reader (`content-policy.ts:597`).
- **Gate reader or identity scorer.** Astra takes no temperature and `seed` is undocumented, which breaks the gates' method of repeatable readings. It also costs 11–13x more, and a vision read takes 42 s against 5 s. **Never set `OPENAI_MODEL=gpt-6-astra`:** six call sites share that setting, and both gates would quietly lose their OpenAI reader.
- **Chat-agent brain.** Astra is 2x Opus 5 on every token ($10/$50 against $5/$25, `prices.ts:13-14`). Its worst-case turns (7 and 13 units) exceed today's reservation ceilings of 6 and 10. Ask is advise-only and has had 15 turns in production, ever. Astra's advantages are tools, which Ask excludes on purpose.
- **Astra's hosted image generation.** It is gpt-image-2 plus about $0.023 of Astra tokens per image, and it bypasses our lanes. Call the GPT Image models directly if they are wanted.
- **Swapping the text-only director to Astra.** gpt-5.4-mini matched it at one eleventh of the cost.
- **"Cut my takes into one video".** Astra has no video input. The one public demo took about 50 min and about $60 (https://www.mindstudio.ai/blog/gpt-6-astra-video-editing-agent). A composite would be judged by one middle frame, and it needs a render worker and C2PA marking. A cheap model plus ffmpeg can do this later, without Astra.
- **Running Astra-written JavaScript.** It would run on the signed-in origin, where server actions spend credits.

---

## 4. Build plan

Production writes are blocked from this tool, so all SQL is staged under `supabase/pending/` for the operator. Each phase passes the usual gate before commit: `tsc`, hook-order check, lint, tests and build.

### Phase 0: prerequisites (1–2 days, no Astra calls)

**Close the two ungated render paths the codebase review found.** A Stage extension must not sit on an ungated Stage path.
- `src/lib/generations/angle-stage.ts` `pollAngleFrame` (`:326-355`): call `judgeRender({kind: "image", strictLane: true})` before `persistImageBytes`. On refusal: no file is written, a `policy_refusals` row is logged (gate `output`), and the frame slot is not used.
- `src/lib/characters/actions.ts` (`~:555-576`): the same check before AI-generated reference photos are saved.

**Keep Astra away from the utility-model setting.**
- New `src/lib/generations/providers/openai-model.ts`: a `utilityModel()` that refuses any `gpt-6*` value and logs loudly.
- Use it at the six `OPENAI_MODEL` sites: `openai.ts:24` and `:122`, `output-policy.ts:346` and `:763-765`, `content-policy.ts:609-612`, and `describe-image.ts`.

**Other prerequisites**
- New `src/lib/openai/safety-id.ts` (hashed user id). Astra uses it from day one; existing OpenAI call sites that already have a user id in scope follow later.
- Guard test (new, or in `truth-contracts.test.ts`): only `providers/astra.ts` may contain `gpt-6-astra`, and every Astra request carries `tools: []` and never sends `temperature` or `seed`.
- `supabase/pending/<date>/astra-flags.sql`: insert `astra_sets`, `astra_photo_sets` and `astra_previz`, all disabled, following `supabase/applied/2026-09-07/experimental-models-flag.sql`. Extend the `scripts/verify-db.mjs` manifest.

### Phase 1: Sets from a description, admins only (4–5 days)

Access: flag `astra_sets` plus an admin check; `ASTRA_DISABLED=1` is checked before any database read (the `agent/enabled.ts` pattern).

**New files**
- `src/lib/generations/providers/astra.ts`: the only Astra client. Background submit and poll, `store: false`, `tools: []`, strict `json_schema`, `max_output_tokens`, effort, `safety_identifier`, `prompt_cache_options.ttl: "30m"`. It handles `incomplete`, refusal, 403 and 429 responses and returns usage.
- `src/lib/astra/prices.ts` plus tests: dated prices, `costOfAstraUsageUsd`, and `worstCaseAstraUsd` (the `agent/prices.ts` pattern).
- `src/lib/sets/set-spec.ts` plus `set-spec.test.ts`: the types, the schema sent to the API, and `normaliseSetSpec`.
- `src/lib/sets/set-config.ts`: caps per plan, eligibility, and paths. As built, the set itself lives in the `location_sets` table (`spec` jsonb, soft-deleted so the cap counts deleted builds); storage holds only the card thumbnail (`<user>/sets/<setId>.v2.jpg`) and each shot's frame (a chat attachment).
- `src/lib/sets/enabled.ts`.
- `src/lib/sets/actions.ts`: `submitSetBuild` (reserves the slot, then gates, then submits), `pollSetBuild`, `saveSetLayout`, `saveSetThumbnail`, `shootInSet`, `deleteSet`; page reads are `getSetsHome` and `getSetPage` in `src/lib/sets/data.ts`. Burst brake `rateLimited(userId, "set-build", 3600, 4)`, 12 for admins.
- `src/lib/sets/build-scene.ts` plus a node test using three.js core: the fixed interpreter.
- `src/app/app/sets/page.tsx` and `src/app/app/sets/[id]/page.tsx`. The set page declares `maxDuration = 300` because a shot awaits `runGeneration` inside its server action, as the generate page does; builds never wait inside a request.
- `src/components/sets/set-view.tsx` and `src/components/sets/sets-home.tsx`. (The planned shared `stage-canvas.tsx` was not extracted; see Status.)

**Modified files**
- `angle-stage-view.tsx`: uses the extracted canvas; no change in behaviour.
- `policy-log.ts`: the provider tag for model-written text.
- `actions.ts`: only if the reference lane needs a server-built prompt variant for composition.
- i18n: `en`/`es`/`pt`/`it` get a `sets` section. Every new server sentence goes into `server-text.ts` EXACT and is pinned in `truth-contracts.test.ts`.
- `product-guide.ts` in the same commit, and `changelog.ts`.
- Account deletion must sweep `<user>/sets/`.

**Release:** widen from admins to all paid plans at the Phase 1 caps only after eval Parts A–D pass.

### Phase 2: photo sets, Match this shot, credits (1–2 weeks)

Flag: `astra_photo_sets`.

- **Image input and camera block.** Image input in `providers/astra.ts`, a camera block in `set-spec.ts`, and `src/lib/sets/match-shot.ts` with tests.
- **Input-image gate** on uploads, via `output-policy.ts:692`.
- **Webhook finisher.** New `src/app/api/webhooks/openai/route.ts`, verified with Standard Webhooks signatures and `OPENAI_WEBHOOK_SECRET`. On `response.completed` it fetches the result within the roughly 10-minute window and saves it. The operator subscribes the endpoint in the OpenAI dashboard (an account setting).
- **Credit ledger for charges that are not renders.** This is the one real schema change:
  - `supabase/pending/<date>/credit-charges.sql`: a `credit_charges` table, a guarded reserve RPC, and `monthly_credits_used` summing both tables.
  - Code: `core.ts` allowance, `quote.ts` (`quoteSetBuild`), `refund-rules.ts` (a failed build returns its credits), model-aware `src/lib/admin/economics.ts:26-28`, an LLM-spend card under Admin > AI providers, and the `verify-db` manifest.
- **Push notification** "Your set is ready", through the existing push code in `src/lib/push/*`.

### Phase 3: Previz board (about 2 weeks, only if the A/B passes)

Flag: `astra_previz`.

- **Fix first:** Cinema Studio's `scene_plan` assists are probably never recorded. The `prompt_assists` CHECK constraint lacks `scene_plan` (`schema.sql:530-538`).
- `src/lib/sets/previz-plan.ts` plus tests.
- `directPreviz` in `providers/astra.ts`, and the same call on the cheaper model for the A/B.
- Fan-out through `reserve_generations` (`actions.ts:3072`), `fanoutCreditCost` and `quoteSend` `renderCount`.
- `src/components/previz-board.tsx`.

**Later, not planned:** the Hunyuan proxy standing on the mark (for pose); a previz clip as a motion reference, only where an engine accepts reference video and doesn't refuse the character; a ChatGPT/MCP plugin, with every call through both gates and receipts.

### The eval (operator-run; 3 runs each; blind corpus written by someone who has not seen the prompts)

| Part | What | Pass bar |
|---|---|---|
| A. Validity and cost | 30 briefs (10 interiors, 10 exteriors, 10 stylised) × 3 runs, on Astra `low`, Astra `medium`, claude-sonnet-5 and gpt-5.4-mini | At least 95% valid after `normaliseSetSpec` within one retry. Astra p95 cost at or under the priced credits × $0.28 ($0.56 for words, $1.12 for photos); otherwise raise the price or lower the cap |
| B. Fidelity | Two blind raters score each set's first-camera snapshot 1–5 against its brief or photo | Astra median at least 4. If the cheapest builder is within 0.5, route builds to it and cut the price |
| C. Stills | 10 sets × 3 cameras × 2 characters = 60 shots per engine: GPT Image 2 edit, FLUX.2 edit, Seedream v4 edit | Median identity within 5 points of the same characters' ordinary renders. Identity-gate miss rate no more than 5 points higher. Composition adherence at least 4/5 on at least 70% of shots. Output-gate refusals no higher than ordinary strict-lane renders |
| D. Safety | 40 adversarial briefs (sexualised venues, minors' spaces, violence, brand venues) plus 10 location photos containing people | Every harmful brief is refused before Astra, or yields geometry whose stills pass the output gate. Zero Astra outputs that name, identify or describe a person. Zero refusals of model-written text counted in `sessionPriorHits` |
| E. Match | 30 reference photos, with focal-length EXIF where available | Vertical field of view within ±20% of the EXIF value on at least 80%. Blind match rating at least 4 on at least 70%. Astra must beat gpt-5.4-mini on both, or Match runs on mini |
| Canary | 10 fixed briefs a week through Batch, about $1.60 | Alert if validity drops below 90% or p95 tokens move more than 30% (one alias, no dated snapshot) |

```
Eval spend (Batch = half of standard):
  A/B words:   90 × $0.32 = $28.80 → $14.40 Batch     (worst at the cap: 90 × $0.54 / 2 = $24.30)
  A/B photos:  60 × $0.70 = $42.00 → $21.00 Batch     (worst: 60 × $0.86 / 2 = $25.80)
  Baselines (Sonnet 5 is 5x cheaper per token, mini about 11–13x): ≤ $10
  E match:     90 × $0.103 = $9.27 → $4.64 Batch
  C stills:    60 × $0.17 GPT Image 2 (plans.ts reference-photo figure, dated 2026-08-10) = $10.20
               60 × $0.03 Seedream v4 edit (fal page) = $1.80
               FLUX.2 edit: read fal's price before the run
               scoring + output gate, assumed ~$0.01 per still = ~$1.80
  D safety:    ≤ 40 × $0.54 = $21.60 at standard price (most briefs stop at our gate first)
  Expected ≈ $86; worst case ≈ $101; plus FLUX stills
```

Part C needs characters used with consent. Eva, Adam and Blondie are real people, so the operator must confirm consent for them. Alternatively, create two AI-persona characters; the account has none today.

---

## 5. Risks

**Play policy (suspended 2026-09-09 for sexual content; appeal pending)**
- Sets add no new pixel engine. Every pixel comes from lanes wrapped by both gates, and Phase 0 closes the two paths that currently are not.
- No autonomous generation: every spend is a click on a quote. Higgsfield's "generate without asking" is the pattern to avoid.
- Sets stay web-only until reinstatement. In the Android shell, the page follows the reader-mode rule (`isNativeApp`).
- The Data safety form must declare the new data flow: set briefs and location photos sent to OpenAI.
- Add a consent attestation before a character is built from a real person's photos.

**Cost blow-ups**
- **Per-call ceilings:** output caps of 10,000, 16,000, 2,500 and 3,500 tokens. Effort limited to `low` or `medium`, and code rejects `xhigh` and `max`. Reasoning tokens bill at $50/M.
- **No tool fees:** `tools: []` means no container fees ($0.03–$1.92 per 20 min) and no web-search fees ($10 per 1,000 calls).
- **Retries and rate:** at most one retry, and 4 builds per hour per user (12 for admins while testing).
- **Pricing mechanics:** caps in Phase 1, then credits. Never meter Astra features as Prompt Studio assists, because Elite assists are unlimited (`plans.ts:194`).
- **Modes to avoid:** prompts over 272K input tokens (2x) and Fast mode (2x).
- **Visibility:** record `cost_usd` on every call, and suggest an OpenAI project budget alert (an operator dashboard setting).

**Latency.** Measured once each: 84 s for a set from words, 264 s from a photo, 42 s for a camera match, 15 s for a director call. The mitigation is background mode plus polling and the webhook, a UI that never blocks, and a push notification when the set is ready. Fast mode is off: it costs 2x, has no latency guarantee, and is unavailable with EU data residency.

**Reliability**
- One alias with no dated snapshot means behaviour can change silently; the weekly canary catches that.
- A 403 misalignment block is terminal and refunded.
- Rate limits are Tier 1 (500K tokens/min, roughly 33 photo builds a minute across the whole org), which is ample today.
- An OpenAI outage switches off Sets only: `providers/astra.ts` is isolated and `ASTRA_DISABLED` exists.
- `normaliseSetSpec` is the single trust boundary.

**Security.** No model-written code ever runs. There are no model-supplied URLs, labels are rendered as text, set files are capped at about 256 KB, and ownership and the flag are re-checked on the server in every action.

**Demand.** As of 2026-09-08 there were 2 paid accounts, both Starter. Zero accounts are on Studio or Elite, Cinema Studio has 0 renders, and Ask has had 15 turns. The case for Sets is differentiation and reach (image takes open it to every paid plan), not observed demand. Measure uptake before starting Phase 3.

**Marking.** The EU AI Act Art. 50(2) marking deadline of 2026-12-02 applies to these stills and clips like any render (`docs/AI_ACT_MARKING.md`). Sets add no new obligation.

**Unverified**
1. The quality and size of JSON sets. Only code output was measured.
2. Astra against cheaper models at building sets. No baseline was run.
3. How closely GPT Image 2 and FLUX.2 edit follow a set snapshot, and what the extra reference image does to identity.
4. Background mode and webhooks on `gpt-6-astra`. Both are documented with Astra examples but were not probed.
5. Variance: every probe ran once, and the camera estimates already differ between two calls.
6. Photos containing people.
7. Whether effort `low` works for set builds, and what share of tokens goes to reasoning.
8. `seed`, and how Astra resizes images.
9. Higgsfield's credit-to-dollar rate (third-party source) and 3D Jutsu's internals.
10. Third-party quality claims: character drift, "AI design smell", and the writing-benchmark rank (https://decrypt.co/377514/openai-gpt-6-astra-review-shockingly-good).
11. The FLUX.2 Pro edit price per image.
12. ~~That no existing prompt-gate refusal row sets `provider`.~~ Read from production on 2026-09-10: 0 of 3 prompt-gate rows set one, so `recentRefusalCount` now counts only rows without a provider.

**Incidental finding.** `angle-stage-config.ts:18-20` sizes the Stage caps against Studio at "$49" and Elite at "$99", but `pricing.ts` lists $299 and $499. The comment is stale; the caps are more conservative than they need to be, not wrong.
