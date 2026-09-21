# Helios films: why they fail, and what to build instead (v2.1)

**Decision document v2.1, 2026-09-21, for the operator** (v2 plus the independent checker's eight fixes: a prop in the proof, the $35 cap stated as a hard stop, Motion Control limits, Luma depth, stop rules for repaints and P5, BytePlus blockers, Blockout's distribution caveat, one timing). Version 1 drew on seven research reports, each checked by a fact-checker, plus the Picacho code (read only) and our own records. A reviewer then checked v1 and asked for 13 corrections. This version applies all 13. Every fact they depend on was re-read at its source today. Section 3 is new and covers your reference photos. Nothing was built and nothing was spent to write this.

Labels used throughout:
- **VERIFIED:** read at the original source today (a vendor's page or schema, our own code, or a measurement recorded in our code), unless another date is given.
- **REPORTED:** from a secondary source, or from one of our own notes that wasn't re-read at its source today.
- **INFERRED:** reasoning, not a measurement.

**Recommendation in one line:** don't bring Blender into Picacho. Instead, give our own 3D stage things that move, people who walk and a reference photo on every person, car and object. The browser records that rehearsal, and an AI video engine that accepts real faces re-shoots it. Prove the re-shoot on you first. The first paid step costs $0.78, the path I expect to a GO costs about $2.46, and the whole proof stops at a $35 hard cap you approve.

## What changed from v1

1. **Your reference photos have their own section (§3).** Every person, car and object on the stage can carry its own photos, shown on the element and not hidden in the Look menu. §3 covers people (always through a Picacho character, with consent), cars and objects. It says how many photos each engine can take, and that the app tells you when something doesn't fit instead of dropping it silently. Your car's photo is now part of the proof.
2. **Kling O3 Reference can't start from our painted frame.** Its schema has no first-frame field (re-read today). The painted frame can only go in as a style picture, so I expect it to lose the rehearsal's framing.
3. **The bake-off order has changed.** LTX render-to-real goes first ($0.27). Kling O3 Edit is next ($0.84), because it's the engine we already use that held a person through a full turn while keeping the camera. Kling V3 Motion Control ($0.84) and Kling O3 Reference ($0.84) follow. Luma goes last, and only as a motion candidate followed by the face pass.
4. **Two more engines were checked and stay out.** Gemini Omni's video edit takes only a video, a sentence and a resolution: no photo and no start frame. Luma Ray 3.14 isn't on fal, and Luma's own API doesn't sell it.
5. **The proof runs on you.** You give consent and 4 photos of yourself in one outfit. It doesn't run on Eva: we don't know whether she's a real person, and her photos wear three different outfits, which is the known cause of the clothes changing. The separate "real person" step (v1's P5) is folded in.
6. **The money is stated honestly.**
   - The painted frame is budgeted at $0.17, not $0.08.
   - Engines never billed on our key carry a ×2 budget cap.
   - A result must pass twice before GO, and every run has a time limit.
   - The first paid step costs $0.78, the path I expect to a GO about $2.46, and the worst listed path $33.66; I'm asking for a $35 hard cap that stops everything and asks you again.
7. **Seedance isn't completely closed.** BytePlus has a route where each real person passes a live face check. It's built in Picacho but switched off, and it's blocked by company verification, EU data transfer and price. It's listed as option E and parked.
8. **The stand-ins come from our own code.** Blockout generates its people, vehicles and motions in code and is licensed Apache-2.0, with a credit required. That means no 3D files and no need to change your 2026-09-15 rule against them. Blockout itself can also make the test clip in hours, if you agree to install it.
9. **The build estimate is more honest.** Building the test clip inside Picacho is most of Phase 1. The build is 5–9 weeks after a passing proof, not 5–6, and the missing work is listed.
10. **Three labels are fixed.**
    - "Competitors all do it this way" is narrowed to the tools that make video of characters.
    - Higgsfield's Blender add-on is VERIFIED.
    - Willison's timings were re-read and stand.

## The short answer

1. The people "using Astra on Blender" run Blender on their own computer. Astra writes Python for it, and Blender draws every pixel. Astra itself only writes text. (VERIFIED)
2. The tools that make video of characters all work the same way: Higgsfield's 3D Jutsu and its Blender add-on, Intangible, Dreamina's Blender add-on and the open-source Blockout. They animate the scene in 3D, record it as a rough video and hand that video to an AI video model to follow (VERIFIED; §1). Most "Astra + Blender" showcase pieces are something else: plain Blender renders of buildings, objects and camera moves, with no people (VERIFIED).
3. Helios never makes that video. It paints two photos and asks a video model to imagine what happens between them.
   - That can't drive a car or walk a person. On a big camera move the model fades or cuts.
   - That is the root cause. It isn't Astra (we use the same model), and it isn't the prompts or the looks. (VERIFIED in our code and in the 2026-09-21 Eva film)
4. **What to build is a rehearsal stage.**
   - Stand-ins really move in our three.js stage: a car on a route, people with real walk cycles and a camera on a path.
   - Every person, car and object can carry its own reference photos, shown on it (§3).
   - The browser records the rehearsal as a video.
   - An AI video model that accepts real faces re-shoots it with your real character and your real car.
   - Our face lock checks the result.
   - No Blender and no GPU servers are needed.
5. One question is unproven, and it decides everything. Can an engine that accepts real faces turn a grey rehearsal into real-looking footage while keeping the motion, the person and the car? Nobody has published a test. The proof in §6 settles it, on you, before any build.
6. Seedance is the engine behind Higgsfield's final pass, and it refused real faces on every route we tested. The one exception is BytePlus's own face-check route: built in Picacho, switched off, and blocked (§1). So we copy their method but not their engine.
7. **Your reference photos.**
   - Today there is one upload, hidden in the Look menu. It takes one photo per shot, it's for things only, and it reaches only the painted still.
   - v2 puts photos on every person, car and object on the stage. Each photo goes as far as each engine allows, and the app says where each one went (§3).

## 1. Why they get results and Helios doesn't

**The plain version:**
- They film a rehearsal and ask the AI to re-shoot it.
- We give the AI a start photo and an end photo and ask it to imagine everything in between.
- Imagining between two photos can't make a car drive down a road or a person walk across a room. When the two photos are far apart, the model fades or cuts instead.
- We chose this design on 2026-09-15 and put films on top of it that same night.
- The fixes since then made the photos better: the same person and the same car in every beat. None of them could add the missing motion.

### What "Astra on Blender" actually is

- **Astra only writes text.** Astra (gpt-6-astra) takes text and images in and gives text out. It makes no 3D and no video (VERIFIED, OpenAI's model page). It can call an image tool, but a separate image model draws that picture (VERIFIED).
- **OpenAI's own showcase.** Astra worked in the Codex app, wrote Blender Python, ran Blender in the background, looked at test renders and fixed its scripts (VERIFIED).
  - Blender's Cycles renderer drew a 30-second house tour: 900 frames at 1080p, with scanned textures from Poly Haven.
  - Only the camera moves. There are no people and no vehicles.
- **Simon Willison's test.** He ran the same loop on a Mac. His three rounds took 2 min 39 s, 3 min 51 s and 5 min 59 s, and each ended in a Blender render (VERIFIED, re-read today).
- **OpenAI hosts no Blender for Astra.**
  - Our own one-off probe found no Blender in OpenAI's sandbox. That is our record; OpenAI's docs say nothing either way.
  - OpenAI's Codex models page lists Astra as unavailable in Codex cloud (VERIFIED).
  - Installing Blender's Python module in OpenAI's hosted shell is untested and probably impossible. bpy 5.2.2 needs Python 3.13, the shell runs 3.11, and it has no internet access by default (the facts are VERIFIED at PyPI and in OpenAI's shell guide; the conclusion is INFERRED).
  - So the creators run Blender on their own machines (INFERRED). We don't need it.
- **What comes out:** buildings, objects, a steam train, stylised and game characters, and fly-throughs. We found no public showcase that is a photoreal film of a specific real person (REPORTED).
- **For video with people, the popular routes end in an AI video model.**
  - Dreamina's own Blender add-on sends a plain grey "clay" render to Seedance 2.5, which uses it for the camera move and for where the main objects are (VERIFIED).
  - A published Astra tutorial used Blender only for the rehearsal and Gemini Omni Flash 1.1 for the final look (VERIFIED). Its character was an anime avatar, so no real face had to survive.
  - The difference matters. They give Omni a moving animation to restyle. We give the same Omni two photos to connect.
- **Their results aren't clean either.**
  - That tutorial warns of retries on faces, cloth and cut timing (VERIFIED).
  - A tester of Higgsfield's Blender add-on reports that a shot without a blocked-out animation burned about 5,000 credits and never came out usable, while blocked-out shots held their positions across cuts (REPORTED).

### What the working tools do

The tools that make video of characters all follow the same three steps:
1. Animate the scene in 3D: a camera path, objects that move, and figures with a skeleton playing walk or run clips.
2. Record it as a rough video, grey or simply lit.
3. Give that video to an AI video model as the motion to follow, with pictures of the character and the place for the look.

| Product | How the motion gets in | Evidence |
|---|---|---|
| Higgsfield 3D Jutsu (browser, launched 2026-09-04/05) | A timeline with a playhead. Motion comes from camera paths, animated Mixamo characters or imported animated 3D models. The grey rehearsal becomes a reference clip, sent with character and location pictures. | VERIFIED (their blog). The blog names no video engine; one showcase post says Seedance 2.5 (REPORTED). |
| Higgsfield Blender add-on (blog dated 2026-08-20) | A skeleton plus keyframes on ordinary Blender bones. The Video tab sends the Blender viewport to Seedance 2.5. | VERIFIED (their blog: "Seedance 2.5 fed straight from your viewport"). The tester's details above are REPORTED. |
| Intangible (web) | Keyframes for the camera, objects and character poses on one timeline. A "Video (from scene)" mode feeds the animation to the model frame by frame. Its docs say Luma Ray 3.14 follows authored motion most strictly. | VERIFIED |
| Dreamina / CapCut Blender add-on | A clay render goes to Seedance 2.5 as a reference video. | VERIFIED (the vendor's own page) |
| Blockout (open source, three.js, Apache-2.0) | People, animals, vehicles and props are all generated in code. Actors walk numbered floor marks. It has 39 camera moves, 194 character motions and 33 action paths including car chases, and exports a reference video plus a depth video for Seedance, Veo, Kling, LTX and Wan. | VERIFIED (its README, re-read today) |

Two things stand out:
- Even Higgsfield's Blender add-on doesn't let Blender make the final picture. It hands the viewport to an AI model.
- Astra isn't the secret ingredient. In 3D Jutsu it is one of 30+ assistant models you can pick, at about 17 credits a message, and the free default isn't Astra (VERIFIED).

### Why Helios fails

- **Our set format can't describe motion.** It has no timeline, no keyframes for objects, no skeletons and no imported figures. The stand-in is a faceless mannequin with four fixed poses (VERIFIED: `set-spec.ts`, `build-scene.ts`).
- **How a film is made today.** A Helios film has up to 3 beats. For each beat, GPT Image 2.5 paints a new end photo. Then Gemini Omni (5 s) or Veo 3.1 (8 s) gets two photos plus one sentence about the camera (VERIFIED: `film.ts`, `take.ts`, `moves.ts`).
- **The motion we already have never reaches the model.** Our stage flies the camera along each move's true path in the free preview, but those frames are never sent to the video model (VERIFIED).
- **The 2026-09-21 Eva film on the Scarlet Circuit set** now has the same person and the same car in every beat (VERIFIED, our measurement). But:
  - Beat 1 cuts hard at about 4.5 s. The frame-difference check shows a spike of 68, where normal motion reads 5–10.
  - Beat 2 cross-fades for about 3 s on a 35° arc at 135 mm.
  - The outfit changes every beat: racing suit, tank top, jeans, white top.
- **Why this happens (INFERRED).** With only two end points, fading or cutting is the model's easiest answer when the photos are far apart. Each end photo is painted from scratch, so anything not carried over, such as clothes, gets redrawn.
- **How we got here (VERIFIED).**
  - On 2026-09-15 we copied 3D Jutsu's workspace but deliberately left out rigged figures, imported models and the timeline, with the note "Sets is stills" (`docs/ASTRA_SETS.md` line 292, commit 106ebf9).
  - Takes and films were then built on that stills design between 01:23 and 02:56 the same night (commits 9918570, 6b2e951, df66af4).
- **The difference is the tool Astra drives, not Astra.** They give Astra Blender, a full animation program. We give Astra a JSON format with no way to describe motion.

### Where it really is harder for us

- **Seedance takes real faces only through BytePlus's own face check.**
  - Direct uploads of real people were refused in our 2026-09-06 production test, on both fal and BytePlus. BytePlus's docs, read 2026-09-19, still refuse them (VERIFIED, our records).
  - BytePlus does offer one sanctioned route. The person passes a live face check, and their checked photos become an asset Seedance 2.5 may use, including alongside a reference video (REPORTED, our 2026-09-19 reading of BytePlus's docs).
  - Picacho already built this route (commit eb40164) behind the switch `face_verification`. It is off and has never run end to end.
  - It's blocked by BytePlus company verification, by the fact that faces would have to go to BytePlus's Malaysia region (its EU region has no Seedance and no face assets), and by price. This is option E in §2 (REPORTED).
- **Higgsfield's route for real people is one we ruled out.** Our 2026-09-03 research found that Higgsfield reaches Seedance for real people through a BytePlus partnership and a trained "Soul ID". The Soul ID's generated portrait is sent instead of the real photo (REPORTED, not re-read today). We ruled that out because sending a generated look-alike of a real person to an engine that refuses real people defeats a safeguard against unauthorised use of someone's likeness. Option E is different: it is the vendor's own consent check.
- **So the re-shoot engine must accept real faces.**
  - Our model table marks Kling O3 Pro, Kling O3, Kling 2.5, MiniMax H3 and Gemini Omni as accepting photoreal faces, and every Seedance lane as refusing (VERIFIED: `send-plan.ts`). Kling O3 Edit and Kling V3 Motion Control have both taken Eva's photos in Recast (VERIFIED, `recast.ts` records).
  - We haven't read LTX's (via fal) or Luma's terms on real people. That is step F1 in §6.
  - None of these engines has been tested on a grey rehearsal, by us or by anyone who has published a test.

## 2. What exactly to build

**In one sentence:** a rehearsal stage. You, or Astra, block out the shot with stand-ins that really move, and every person, car and object can carry its own photos. Picacho records the rehearsal, an AI video model re-shoots it as real-looking footage with your real character and your real car, and the face lock checks it.

**Do we need Blender? No.**
- What you want from Blender is its timeline (things move over time) and its skeletons (people walk). Our stage can have both: three.js, which the stage already uses, plays skeleton animation and moves things along curves (VERIFIED).
- Blender's renderer can't draw a user's real face anyway. That is why even Higgsfield's Blender add-on hands its viewport to an AI model.

### The options compared

| | **A. Rehearsal stage + AI re-shoot (recommended)** | B. Real Blender on rented GPUs + AI face pass | C. Both | D. Keep today's two-photo films and keep fixing |
|---|---|---|---|---|
| Car, people and camera move | Yes: animated in our stage, recorded as a video | Yes: animated in Blender | Yes | No |
| The user's real face | From the AI pass: Kling's element photos, or the painted frame | Still needs the AI pass, because Blender can't draw a real face | Same as B | Yes, but only in still photos |
| A real-looking place | From the AI pass; unproven on grey input | Real light and textures from Blender | Best input | Painted photos |
| New systems | None: the browser, today's app on Vercel, today's fal account | A Python GPU worker on Modal or RunPod, a job queue, a translator from our scene to Blender, an asset store. Editing still needs A's editor. | A plus B, and keeping two copies of every scene identical | None |
| Vendor cost per 5 s shot | $0.44–$2.09 (§5) | GPU $0.22–$0.63 (INFERRED), plus the face pass at $0.84 | More than B | $0.67 |
| Biggest risk | Grey input may not become believable footage | Render time on real sets is unknown, there is a second system to run, and the face is still unsolved | The most work | Can't reach the goal |
| Verdict | **Build, if the proof passes** | Not now; only if the proof shows our stage's input is too crude | Not now | Stop |

**Option E: Seedance through BytePlus's face check (built, switched off).**
- **How it works.** Each real person does a one-minute live face check on BytePlus. Their photos then become a verified asset that Seedance 2.5 may use together with our rehearsal as a reference video: up to 30 s out and up to 50 references (REPORTED, our 2026-09-19 reading of BytePlus's docs).
- **Where it stands in Picacho.** Built in commit eb40164, switch `face_verification` off, never run end to end (REPORTED, our records).
- **What blocks it (REPORTED):**
  - BytePlus company verification.
  - Faces would go to BytePlus's Malaysia region. That needs a data-transfer agreement and an impact assessment first.
  - The face-check page is in Chinese and English only.
  - Every real person in a shot must do their own check.
  - The asset API page is marked "invited users only".
  - BytePlus support said real-person asset calls may bill on an "enhanced line", so $1.24–$4.84 may understate.
- **Price with a video input:** $1.24–$4.84 per 5 s at 720p (REPORTED, BytePlus's price page read 2026-09-19).
- **Verdict:** parked. It isn't a look-alike workaround, but it's slower and dearer to open than A. Revisit only if the proof fails, and after the legal groundwork.

**Which pixels users see:**
- **Blender alone** gives real light but CG mannequins. That fails the product.
- **An AI pass over our recorded rehearsal** takes the motion from the rehearsal and the face from the character's photos. This is unproven on grey input.
- **Both together** only makes sense if the proof shows our input is too crude and the cheaper fixes (extra painted frames, depth guidance) also fail.

### The recommended pipeline, end to end

1. **Set (exists).** Astra writes the location as checked JSON: blocks, lights, marks and cameras. The change: it also names the things that matter ("the red car", "the lamp") as elements, so photos and motion can attach to them. Today objects are unnamed blocks, and cars are found by their tyres (VERIFIED: `vehicles.ts`).
2. **Motion plan (new).** It is saved beside the set and checked by the same kind of gatekeeper as the set (`normaliseSetSpec`). Astra writes JSON, never code.
   - **Vehicles:** a named group of the set's own blocks, which is the car Astra already builds. The plan gives a route of points on the ground and a speed or arrival time. The car turns along the route and its wheels spin with the distance travelled.
   - **People:** stand-ins with skeletons, generated in our own code (ported from Blockout, §2 "Parts"). They do named actions on the timeline: walk from mark to mark, run, stop, sit, stand up, turn, gesture.
   - **Camera:** today's 14 moves, plus drawn paths, keyframes every second, lens changes, and new "follow the car" and "mounted on the car" moves. Today's list has no follow move.
   - **Timeline:** 3–15 s per shot at 24 fps, which is the engines' limit. It extends today's sequencer (camera, figure, sun, light, takes) with one row per moving thing.
3. **References (new, §3).** Each stand-in is played by a Picacho character. Each car or object can carry up to 4 photos, and each is redrawn once as a four-view sheet.
4. **Rehearsal (new, in the browser, free).** three.js plays it live: skeleton clips for people, routes for vehicles and the camera path.
5. **Recording (new, in the browser, free).**
   - Step through the timeline one frame at a time and render each frame through the stage's existing `frame()` path.
   - Encode an MP4 with the browser's built-in video encoder (WebCodecs) through the free Mediabunny library.
   - Record at 1280×720 or larger, 24 fps, 3–15 s. That fits the engines' input limits: Kling O3: 720–3840 px, mp4/mov, 3–15 s, ≤200 MB; Kling V3 Motion Control: 340–3850 px, 3–30.05 s, ≤100 MB (VERIFIED, schemas).
   - Record a depth video as well, for LTX reference-video-to-video (`control_video_url`). Luma derives its own depth from the rehearsal.
   - The browser uploads straight to storage, and the server re-measures the file, as Recast already does.
6. **Look frame (exists, extended).** GPT Image 2.5 paints the rehearsal's first frame with the character, every element's sheet and the location photo. It takes up to 16 pictures per request (VERIFIED, OpenAI's API reference), and today's identity bar of 70 still applies. Extra painted frames for the middle and end are added only if the proof shows they're needed.
7. **Re-shoot (new wiring, existing vendor).** The engine the proof picks runs as an ordinary video job on fal, with credits, webhooks and refunds, the way Recast takes run. What each engine gets (VERIFIED, schemas read today):
   - **Kling O3 Edit / O3 Reference:** the rehearsal, plus the people and the hero car as "elements", plus the painted frame as a style picture. That's at most 4 in total.
   - **Kling V3 Motion Control:** the painted frame as its picture, plus the rehearsal as the motion.
   - **LTX render-to-real:** the rehearsal, plus the painted frame as frame 0.
   - **Luma Ray 3.2:** the rehearsal, plus the painted frame as frame 0, with depth, trajectory and pose controls. The face pass then follows.
8. **Check (exists, extended).** The face lock scores the start, middle and end. It checks one face today; Phase 3 extends it to several. If the face misses, and the proof showed this works, Kling O3 Edit re-does the face with the character's photos. That engine keeps its input's camera and motion by design.
9. **Film (exists).** Up to 15 s in one take where the engine allows it. Otherwise, shots are joined with our existing MP4 join.

### Where Astra fits

- It writes the set (as today), names its elements, and writes the motion plan from your words, for example "the car pulls away while she walks to the door". JSON only, checked before use.
- It can look at rehearsal frames and correct its own plan: write, rehearse, look, fix. That is the loop OpenAI ran with Blender, with our stage in Blender's place.
- It can reshape a block car from its reference photo (long bonnet, low roof, rear wing) inside the checked JSON (INFERRED, §3.3).
- It writes the engine's prompt from the known scene and the references.
- It never draws, and it never runs code for users. Hobbyists let an AI run Python inside their own Blender, but the popular bridge for that has no login by default. It isn't something to open to users.

### What runs where

| Where | What |
|---|---|
| The user's browser | Editing, gizmos, the timeline, reference uploads, rehearsal playback, frame-by-frame recording, MP4 encoding, upload |
| Vercel (today's app) | Astra and GPT Image calls, checking plans and photos, storage, sending jobs to fal, webhooks, face lock, credits |
| Supabase storage (today's) | Reference photos and their sheets, as today; rehearsal clips |
| fal (today's vendor) | The re-shoot engine and the Kling O3 Edit face pass |
| OpenAI (today's vendor) | Astra, GPT Image 2.5 and the four-view sheets |
| New GPU servers | None |

### Parts, and why these engines

- **OpenAI:** gpt-6-astra and GPT Image 2.5 Sunburst. Both are already in use.
- **fal, re-shoot candidates, in bake-off order:**
  1. LTX-2.3 render-to-real: built to turn 3D renders into real-looking video. It is the cheapest.
  2. Kling O3 Edit Pro: already wired into Recast. It held a person through a full turn on our key while keeping the clip's camera and motion (VERIFIED, `recast.ts` records).
  3. Kling V3 Motion Control Pro: already wired into Recast. The painted frame performs the rehearsal's motion.
  4. Kling O3 Reference Pro: a new endpoint in the Kling family. It has no start frame.
  5. Luma Ray 3.2 video-to-video: already wired into Recast. It is a motion candidate only, because its face control takes no photo.
- **The face pass** is Kling O3 Edit Pro.
- **Free libraries:** three.js (in use) and Mediabunny for MP4 (MPL-2.0). For keyframes, use three.js's own tracks or @theatre/core (Apache-2.0). Don't use Theatre's Studio editor, which is AGPL.
- **Stand-ins and motions:** generated in our own code, ported from Blockout (Apache-2.0). We must keep its NOTICE file and credit "Sam Wasserman (wassermanproductions.com)" in our docs and on an about/credits screen (VERIFIED, its NOTICE). No 3D files enter Picacho, so the Quaternius, Mixamo and Meshy licence questions from v1 fall away. Which Blockout files to port is F1 work. Its README says its Windows/macOS ports need "upstream/trademark permission" for commercial distribution, and its Windows FFmpeg is GPL. We port only the procedural code, never ship its builds or its name.
- **Cars:** the set's own block cars, plus their reference photos (§3). No model files, no marketplace licences, no brands.
- **Engines left out, and why:**

| Engine | Why it's out |
|---|---|
| Seedance (fal, BytePlus direct uploads) | Refuses real faces (VERIFIED, our records). Its one sanctioned route is option E. |
| Veo 3.1 | Can only extend its own clips; it can't take a video in to follow (VERIFIED) |
| Gemini Omni Flash 1.1 edit | Takes only a video, a sentence and a resolution. With no photo and no start frame, it can't carry you, your car or our painted look (VERIFIED, schema read today). The tutorial that used it restyled an anime avatar, which needs no identity. |
| Luma Ray 3.14 | fal's video-to-video catalogue lists only Ray 3.2 and Ray 2, and guessed endpoints return 404. Luma's API page sells Ray 3.2 only. Luma says Ray 3.14 is a Dream Machine model and "References (Character) aren't supported in Ray3.14" (VERIFIED). |
| MiniMax H3 Max | Takes 9 reference pictures, but it re-imagines its reference video, so it won't hold a car's route (our 2026-09-20 notes, REPORTED). It stays in Recast. |
| Wan Animate Replace | Retired; it lost the face on back views (VERIFIED, `recast.ts` record) |

Later alternates, if needed:
- **Happy Horse video edit** held Eva through a full turn, but billed double its page price: $2.81 per 10 s (VERIFIED, `recast.ts` record).
- **Other photo-taking editors** from our 2026-09-19 fal survey (all REPORTED):
  - Wan 2.7 edit-video: one photo, 2–10 s, bills both input and output seconds.
  - SCAIL-2 replacement: up to 10 s, 512–704p, 16 fps, $0.20/s.
  - Bernini-R reference-edit: about 7.5 s, up to 1280 px.
- **DreamActor v2** costs $0.05/s and held Eva well, but took over 20 minutes for 3 s (VERIFIED, `recast.ts` record).
- **Other engines:** Wan VACE depth ($0.40 per 5 s), Runway Aleph 2 ($1.40 per 5 s; a new vendor), Moonvalley Marey ($2.00 per 5 s).
- **Higgsfield's own API:** real-person acceptance is unproven, it needs your account, and it must never be used as a look-alike workaround.

### Decisions this needs from you

1. **Stand-ins from our own code.** Port Blockout's generated people, vehicles and motions, and show its credit on an about/credits screen. Your 2026-09-15 rule against foreign 3D files stays as it is.
2. **How the proof's test clip is made (F2).**
   - Blockout on your Mac takes hours. You download and run an unsigned open-source app, or build it from source, and only with your yes.
   - Or it is built inside a throwaway copy of Picacho, which takes several days and is most of Phase 1.
3. **The proof itself.** Paid steps run one at a time, each with its price, inside a $35 cap. They run on you (4 photos of you in one outfit, with your consent) and on a photo of a car you may use.
4. **References.**
   - Build cut R1 now (photos on every car and object, several per picture, visible on the stage, for stills and painted frames), or wait for the proof?
   - Should Picacho ask for consent when a person character is made from photos? Today the character form asks for nothing (§3.2).
5. **What paying users see in the meantime.** Helios films have been open to every paid plan since 2026-09-19 and can show the same fades and cuts. My suggestion (INFERRED) is to label Film as a preview, or limit it to small moves, until the rehearsal path ships.

## 3. References: person, vehicles, objects

**What you asked for (twice):** every person, car and object on the stage can carry its own reference photo, shown on that element, and the film keeps each of them looking like their photos.

**Where it stands today (VERIFIED: commit 55ad908, `set-config.ts`, `reference-actions.ts`, `look-sheet.ts`, `actions.ts`):**
- **Hidden in a menu.** There is one place to add reference photos: the Look chip's menu, under "Reference photos". A set holds up to 6.
- **One per shot.** Each shot uses one reference at most. If a still's look is also picked, the still wins and the photo isn't used.
- **Things only.** The menu says references are for things, not people. The photo is redrawn as a four-view design sheet with no people in it. A person in the photo isn't refused; the sheet simply leaves them out.
- **Still only.** It reaches only the painted still. The video engines never see it; they see two painted stills.
- **Test page only.** The feature has been proven only on a test page. No paid render has used a reference photo yet.
- **Characters are separate.** A character holds up to 20 photos and 2 outfit photos (VERIFIED: `characters/actions.ts`).

So you're right on all three counts: it's hidden, it takes one photo per shot, and it's for things only.

### 3.1 What you'll see

This is a design (INFERRED). Following your options-first rule, a clickable mockup on the real set page comes before any build.
- **An element card.** Tap anything on the stage (the car, a stand-in, a lamp) and its card opens: a bottom sheet on a phone, a side panel on a computer.
- **A Reference row.** The card has a "+ Photo" button (camera or camera roll on a phone; drag or paste on a computer) and shows the photos already added.
- **Up to 4 photos per element:** one front photo and up to 3 more angles. That's the shape Kling's element slot takes: "The frontal image of the element" plus "1-3" more (VERIFIED, fal schema).
- **Visible on the stage.** A small thumbnail floats on each element that has a reference, so you can see what's covered at a glance. A stand-in shows its character's face.
- **A Cast and props strip** above Shoot and Render lists every element with a reference, in priority order. You can drag to reorder, or tap to jump to the element.
- **A status on every chip.** Each chip says where its reference goes: "picture and video", "picture only", or why it isn't used. Nothing is dropped silently.
- **The Look menu keeps** "latest still" and "picked still". Its "Reference photos" part moves onto the elements.
- **What it needs:**
  - **Named elements in the set,** so a car is one element and not 40 blocks. Astra writes the groups and names, and the set's gatekeeper checks them (for example, that a car group has tyres). The Drive phase moves the same groups, so this one piece of work serves both.
  - **Phone support.** The uploader reuses the page's existing photo preparer. The limit of 20 uploads an hour (VERIFIED) may need raising.

### 3.2 People

- **A person's reference is always a Picacho character, never a loose photo.** The character carries identity photos, outfit photos, the expression set and the consent rules.
- **On the stage:** tap a stand-in, then "Who plays this person?". Pick one of your characters, or choose "New character" right there. That opens the existing Characters form from inside Helios.
- **Consent.**
  - Picacho's Content Policy forbids depicting "any real, identifiable person … without their explicit, verifiable consent". A character based on yourself counts as you confirming it's you (VERIFIED: `content-policy.ts`).
  - The character form itself asks for nothing today (VERIFIED: no consent step in `character-form.tsx`).
  - **Proposal (your decision):** when a person is made from photos, require a tick: "This is me" or "I have this person's permission", linked to the policy.
- **Outfit lock.**
  - For a film, a character's 4 element photos must show one outfit.
  - Eva's 4 photos wear 3 outfits, and each render picked one. With 4 same-outfit photos, the outfit held across pieces (REPORTED, our 2026-09-19 notes).
  - The card asks for "4 photos in the same clothes: front, left, right, back" and warns when they differ.
- **How identity reaches each engine:**
  - **Painted frame (GPT Image 2.5):** the character's photo and close-ups (VERIFIED, production).
  - **Kling O3 Edit and O3 Reference:** an `element` made of a front photo and 1–3 more (VERIFIED schema). For Edit, this is proven on real footage (VERIFIED record).
  - **Kling V3 Motion Control:** the painted frame as its world picture, plus one face element, which is allowed only in 'video' orientation (VERIFIED schema).
  - **LTX and Luma:** no identity field. Identity reaches them only through painted frames (VERIFIED schema).
- **Face lock.** It scores start, middle and end against one character (VERIFIED). Mystique switches it off when more than one face is cast (VERIFIED: `recast/actions.ts` lines 1010–1014). Several people per shot needs a lock that matches each face to its own character. That is a Phase 3 work item.
- **Several people in one painted still** isn't possible in Helios today. A set shot takes one character (VERIFIED: `shootInSet`). The picture assembler also drops the look and place pictures when more than one person is sent (VERIFIED: `image-references.ts`). Both are work items.

### 3.3 Vehicles and objects

**(a) In the painted frame**
- **The tested path stays.** Each reference photo is redrawn once as a four-view sheet and reused after that (VERIFIED code). A sheet drawn from a still's cutout measured $0.0586 (VERIFIED record). A sheet drawn from a photo costs more and hasn't been measured, so it is budgeted at $0.17.
- **What's new: every element's sheet goes in at once.** Each one is named in the prompt by where it stands, for example "the car at the kerb, facing camera-right, is the car in sheet 2". `vehicles.ts` already writes each car's facing in camera terms (VERIFIED).
- **Room.**
  - GPT Image takes up to 16 pictures per request (VERIFIED: OpenAI's API reference).
  - Today a set shot uses up to about 7: the sketch, the person's photo, close-ups, the look and the place photo (INFERRED count).
  - That leaves about 9 pictures for element sheets (INFERRED).
- **Cost.** A fourth picture moved one still from $0.0767 to $0.0798 (VERIFIED: `docs/ASTRA_SETS.md` line 426). Each extra sheet should cost well under a cent per still (INFERRED from that one measurement).
- **Evidence.** A sheet made from an earlier still kept a race car's design from front and back in paid stills on 2026-09-14 (VERIFIED record in `look-sheet.ts`). Several sheets in one still is UNPROVEN.

**(b) In the re-shoot engine** (schemas read today, VERIFIED)

| Engine | Where a car or object photo can go | Limit |
|---|---|---|
| Kling O3 Edit | `elements` ("Elements (characters/objects) to include": a front photo plus 1–3 angles), or `image_urls` ("Reference images for style/appearance") | "Maximum 4 total (elements + reference images) when using video" |
| Kling O3 Reference | Same as Edit | Same |
| Kling V3 Motion Control | Only inside the painted frame (`image_url`: "The characters, backgrounds, and other elements in the generated video are based on this reference image") | 1 picture; + 1 face element only in 'video' orientation (none in 'image', which P1c uses) |
| LTX render-to-real | Only inside the painted first frame | 1 |
| LTX reference-video-to-video | Painted first, middle and end frames | 3 |
| Luma Ray 3.2 | A painted start frame, or up to 64 painted guide frames | No reference field |
| MiniMax H3 Max (not in the plan) | `reference_image_urls` | 9 (12 files in all) |

- The painted frame is the one carrier every engine accepts. Kling is the only candidate that also takes the car's photos directly.
- A car's four angles come from your own photos, or are cut from its four-view sheet. A car or object as a Kling element is allowed by the schema but UNPROVEN in any render.

**(c) Building the stand-in's shape from the photo (image-to-3D): not now.**
- **Prices on fal (VERIFIED):**
  - TRELLIS.2: $0.25–$0.35.
  - Tripo H3.1: $0.20 without textures, $0.30–$0.40 with, plus $0.20 for detailed geometry.
  - Hunyuan 3D v3.1 Pro: $0.375, plus $0.15 for PBR materials and $0.15 for multi-view.
  - Meshy v7: $0.80 untextured, $1.20 textured.
- **Licences:**
  - **Hunyuan:** Tencent's licence for Hunyuan3D 2.1 "DOES NOT APPLY IN THE EUROPEAN UNION, UNITED KINGDOM AND SOUTH KOREA" and forbids using its outputs outside its territory (VERIFIED). fal marks the v3.1 partner endpoint "Commercial use", but its terms for EU customers are unread, so avoid it.
  - **Meshy:** paid-plan customers own their outputs. Free-plan outputs belong to Meshy under CC BY 4.0. API outputs are deleted after 3 days (VERIFIED, terms updated 2026-09-19).
  - **Tripo:** free-plan outputs are public under CC BY 4.0, and paid plans get commercial rights (REPORTED; Tripo's terms pages blocked our readers).
  - **fal:** labels all of them "Commercial use" (VERIFIED). How each vendor's terms carry through fal is unread.
- **Why not now:**
  1. The rehearsal's job is motion, size and position. The look comes from the painted frame and from Kling's elements. Whether a block car is good enough is exactly what P1's car check tests.
  2. A photo-made mesh is foreign geometry in the browser, against your 2026-09-15 trust rule. A photo of a branded car would also become a copyable 3D model of it.
  3. Generated meshes come as one piece (INFERRED), so the wheels can't turn for the Drive phase. The block car has real tyres (VERIFIED: `vehicles.ts`).
  4. Each element adds cost, a wait, and the licence questions above.
- **Instead (INFERRED):** Astra reshapes the block car from the photo inside the checked JSON. Astra set builds measured $0.29–$0.67 per call (REPORTED, `docs/ASTRA_SETS.md`).
- **When to revisit:** only if P1 shows the engine keeps the block car's boxy shape. Then test TRELLIS.2 (MIT licence, $0.30) as its own small step.

### 3.4 How many references fit in one shot

**Priority rule:** people first, in cast order. Then the element you pin as the hero, usually the car. Then the painted frame as a style picture. Then other objects, by how much of the frame they fill. The plan shows before Render, and nothing is dropped silently.

| Where it goes | Pictures per shot | Order |
|---|---|---|
| Painted frame (GPT Image 2.5) | Up to 16 (VERIFIED) | Sketch, each person's photos, one sheet per car or object, location photo |
| Kling O3 Edit or O3 Reference | 4 in all (VERIFIED) | People as elements, the hero car as an element, the painted frame, then other objects |
| Kling V3 Motion Control | 1 picture; + 1 face element only in 'video' orientation (VERIFIED) | The painted frame carries everything |
| LTX, Luma | Painted frames only (VERIFIED) | The painted frame(s) carry everything |

Worked examples for Kling's 4:
- You + your car + the painted frame = 3. It fits, with one slot spare for a prop.
- You + a friend + the car + the painted frame = 4. It fits.
- Add a bag and it's 5. The bag rides in the painted frame only, and its chip says "picture only" before you press Render.
- Three people + the car: one person can't ride in the video engine. The app stops before spending and asks you either to take one out, or to keep them "picture only". Their face may drift, and the face lock can't vouch for them.

**Counts and storage:**
- In the painted frame, each element costs one picture (its sheet). In Kling, it costs one slot, because its photos travel together as one element.
- A set holds 6 photos today (VERIFIED). With 4 per element that cap has to rise, for example to 24 (INFERRED).
- Today references need no database change (VERIFIED). Tying a photo to its element can ride in the file name, so there is still no database change (INFERRED).

### 3.5 What's proven and what isn't

| Part | Status |
|---|---|
| A reference photo uploads, is checked and is kept | Test harness only (VERIFIED, commit 55ad908) |
| A reference photo becomes a four-view sheet and rides a still | Test harness only; no paid render yet (VERIFIED) |
| A sheet from an earlier still keeps a car's design from front and back | VERIFIED in paid stills, 2026-09-14 |
| Several named sheets in one still | UNPROVEN |
| Two or more people in one Helios still | Not possible today (VERIFIED) |
| Your photos in a still | VERIFIED (production stills, identity bar 70) |
| A person as a Kling element keeps a face through a turn | VERIFIED on real footage; UNTESTED on a grey rehearsal |
| A car or object as a Kling element | Allowed by the schema (VERIFIED); UNPROVEN in any render |
| Added pictures (outfit, product) in Kling's image slots | Wired in Mystique (commit c6df848); UNPROVEN in a real take (REPORTED, notes) |
| A car stays like its photo through a moving shot | UNPROVEN; tested in P1, check 2 |
| One-outfit photos keep the clothes | Held across Kling Edit pieces on 2026-09-19 (REPORTED, notes); UNPROVEN on a rehearsal |

### 3.6 References in the proof and in the build order

- **In P1:** the car uses your car photo and a prop uses its own photo. Their sheets ride in the painted frame, and in every Kling run the car rides as element 2 and the prop as element 3. Check 2 ("Car and prop") includes "each matches its photo".
- **In P5 (optional):** four references plus the painted frame, one more than Kling can take, to see the "picture only" rule work.
- **Cut R1** (for stills and painted frames) doesn't depend on the video proof and can start with your yes. It covers photos on every car and object, visible on the stage, several sheets per picture, choosing a character per stand-in, and the consent tick.
- **R2** (people and the hero car as Kling elements in the re-shoot) arrives with Phases 1–2. Several people per shot arrives with Phase 3.

## 4. What is proven and what is not

| What the plan relies on | Status | Evidence |
|---|---|---|
| The tools that make video of characters get their motion from an animated 3D scene recorded as a video | VERIFIED for 3D Jutsu's blog, the Higgsfield Blender add-on, Intangible, Dreamina and Blockout | §1 sources |
| Most Astra + Blender showcase pieces are plain Blender renders | VERIFIED | awesome-gpt-6-astra, OpenAI blog |
| Astra writes text only; in the Blender demos, Blender makes the pixels | VERIFIED | OpenAI model page, OpenAI blog, Willison |
| OpenAI hosts no Blender or GPUs for Astra | VERIFIED by absence in their docs, plus our probe. Installing bpy in the hosted shell is UNTESTED and probably impossible. | Codex models page, hosted-shell guide, PyPI, ASTRA_SETS.md §1.1 |
| Our stage renders any camera position on demand and knows each move's true path | VERIFIED | `set-view.tsx` (`frame`), `moves.ts` (`poseAlong`) |
| The browser can encode frames into an MP4 | VERIFIED: WebCodecs works in Chrome 94+, Firefox 130+, Safari 16.4+ and the Android WebView 151+; Mediabunny exists | caniuse, MDN, Mediabunny |
| Recording works on our stage, on phones and inside the Android app | UNTESTED | F2 (route B), Phase 4 |
| three.js plays skeleton clips and moves things along curves | VERIFIED | three.js docs and demo |
| Stand-ins and motions we may ship | Licence VERIFIED: Blockout's are generated in code, Apache-2.0, with a credit duty. How they're built inside, and the porting effort, are UNKNOWN. | Blockout README and NOTICE; F1 |
| A car with no licence question | VERIFIED: the set's own block cars | `vehicles.ts` |
| Kling O3 Reference's inputs | VERIFIED: video 3–15 s, 720–3840 px, mp4/mov, up to 200 MB; elements plus images up to 4; duration 3–15; **no first-frame field** | fal schema |
| Kling O3 Edit's inputs | VERIFIED: the same video limits and 4-reference cap; no first frame; no duration field (its output follows the input) | fal schema |
| Kling V3 Motion Control's inputs | VERIFIED: one world picture plus the motion video; 10 s max in 'image' orientation, 30 s in 'video'; one face element in 'video' only; the video "should contain a realistic style character" | fal schema |
| Kling O3 Edit keeps camera and motion and holds a person through a turn | VERIFIED on real footage: 559 s per 10 s, 389 s per 5.5 s, 1,182 s per 15 s. UNTESTED on grey input. | `recast.ts`, `chain.ts` records |
| Any real-face engine turns a grey rehearsal into real footage while keeping motion, a real face and the car | UNPROVEN | P1 |
| Kling accepts photoreal faces on our routes | VERIFIED for O3 Edit and V3 Motion Control (Recast) and for O3 Pro, O3 and 2.5 (`send-plan.ts`). INFERRED for Reference. | code, records |
| LTX render-to-real keeps layout and camera | The vendor's claim is VERIFIED as written; unmeasured. Identity only through frame 0 (VERIFIED). Its safety checker is on by default, and flagged output is replaced with black (VERIFIED, fal docs). Whether a flagged run is billed is UNKNOWN. | fal schema, model card, fal docs |
| Luma Ray 3.2 follows depth, trajectory and up to 64 guide frames | VERIFIED; defaults to 540p | Luma docs, fal schema |
| Luma holds our character's face | UNPROVEN and unlikely. Its face control takes no photo (VERIFIED), and on real clips it replaced the person at every strength (VERIFIED record). | `recast.ts` |
| Gemini Omni's video edit can carry a character | No: no photo field, no start frame (VERIFIED) | fal schema |
| Luma Ray 3.14 is available to us | No (VERIFIED) | fal catalogue, Luma API page, Luma news |
| GPT Image 2.5 paints the real character into a stage frame | VERIFIED (production stills, identity bar 70) | ASTRA_SETS.md, our records |
| GPT Image takes up to 16 pictures per request | VERIFIED | OpenAI API reference |
| Face lock on the finished video | VERIFIED (commit 7c57f66, live proof). The refund-on-miss switch is OFF. It checks one face per video. | code, records |
| Clothes stay the same through one take | UNPROVEN. The known cause of drift is mixed-outfit photos (REPORTED, notes). P1 uses one-outfit photos. | P1 |
| All of it works on a real person's face | UNPROVEN; P1 runs on you | P1 |
| Astra writes good motion plans from words | UNPROVEN. It writes sets today. | Phase 2 |
| Seedance for real people | Closed to direct uploads (VERIFIED, records 2026-09-06 and 2026-09-19). BytePlus's verified-person route is built but has never run (REPORTED). | option E |
| Real Blender on rented GPUs works (fallback only) | VERIFIED: bpy 5.2.2 is on PyPI, and Modal has a working example. Render times and costs for our sets are INFERRED only. | PyPI, Modal |

### Claims dropped because fact-checking failed them

| Claim as first made | What the check found |
|---|---|
| Higgsfield's Blender add-on "launched 2026-08-25" | Its blog is dated 2026-08-20 (the changelog says Aug 21). Aug 25 was a demo on X. |
| 3D Jutsu lets you keyframe any object | Its blog only names camera paths, animated characters and imported animated models as sources of motion. |
| 3D Jutsu always finishes with Seedance 2.5 | One showcase post says so. The blog names no engine. |
| Nobody gets pixels out of Astra | Astra can call an image tool, but a separate model draws that picture. |
| OpenAI's Astra demos ran on the creator's machine | That is inferred; OpenAI doesn't say it. |
| Recast has five engines that take a video plus a character | Three do: Kling O3 Edit, Kling V3 Motion Control and H3 Max. Wan Animate Replace is retired, and Luma takes no character photo. |
| Helios has no video export | It exports the joined AI film. What's missing is recording the 3D stage. |
| Helios objects have no identity | Objects can be pointed at by number (gaze and focus already do this). What's missing is any field that moves them. |
| Kling O3 Reference states no input limits | Its API tab does state them. |
| Intangible has no spline paths | Its Motion Paths page documents them; its own docs contradict each other. |
| All Astra + Blender tutorials describe a rehearsal plus an AI pass | Many showcase pieces are finished Blender renders. |
| Runway's Seedance accepts real faces | Secondary sources only; the primary page was blocked. |
| RunPod's RTX 4090 costs $0.34/h | That is the Community Cloud rate. Secure Cloud is $0.74/h. |
| Blender can't run on Vercel | It can, as a Python function, but with no GPU, 4 GB of memory and an 800 s limit it's unfit. |
| **New:** Kling O3 Reference can start from our painted frame | Its schema has no first-frame field; its `image_urls` are "for style/appearance". |
| **New:** One painted frame keeps the clothes through a Kling take | Kling Edit and Reference take no start frame. Clothes come from the element photos, and mixed-outfit photos make them drift. |
| **New:** Seedance is closed to us, full stop | BytePlus's verified-person route exists and is built, switched off. |
| **New:** Our API key can't run Blender | Untested; probably impossible (bpy needs Python 3.13, the hosted shell has 3.11). |
| **New:** Every competitor makes video the rehearsal way | True for the tools that make video of characters. Most Astra + Blender showcase pieces are plain Blender renders. |
| **New:** Luma Ray 3.14 is an option for us | It isn't on fal or on Luma's API. |

### Conflicts

Settled today:
- **Luma's price.** fal charges $1.08 per 5 s at 720p. Luma's own API charges $1.44. Both are VERIFIED; they're different sellers, and we buy through fal.
- **Quaternius's licence** is moot: procedural stand-ins don't need it.

Still open:
- 3D Jutsu's final engine: one post says Seedance 2.5; the blog doesn't say.
- Intangible's spline paths: its docs contradict each other.
- Tripo's terms: its pages blocked us.
- Hunyuan 3D v3.1's terms for EU customers of fal.
- Whether fal bills a run its safety checker blacks out.

## 5. Costs

These are vendor prices only; Picacho's credit prices are a separate decision. Prices were read on fal's pages on 2026-09-21 unless noted. Before each paid run, fal's pricing API is read for that engine, and after it, fal's bill for that request. One engine once billed double its page price.

### Per 5-second shot

| Step | Unit price | Arithmetic | Cost |
|---|---|---|---|
| Rehearsal and recording | Runs on the user's device | none | $0.00 |
| Painted first frame (GPT Image 2.5) | Budget $0.17 (`IMAGE_COST_USD`); measured $0.0767–$0.0798 on 2026-09-14 | one still | $0.17 |
| Reference sheet, per car or object (once, then reused) | Budget $0.17; a sheet from a still's cutout measured $0.0586 | one per element | $0.17, once |
| Astra motion plan (optional) | $10 per 1M tokens in, $50 per 1M out | 6k–13k × $10/M + 1k–3k × $50/M | $0.11–$0.28 (token sizes INFERRED) |
| LTX-2.3 render-to-real, 720p | $0.0024075 per megapixel | 1280 × 720 × 121 frames = 111.5 MP, billed as 112 × $0.0024075 | $0.27 |
| Kling O3 Edit Pro | $0.168/s | 5 × $0.168 | $0.84 |
| Kling V3 Motion Control Pro | $0.168/s | 5 × $0.168 | $0.84 |
| Kling O3 Reference Pro | $0.168/s | 5 × $0.168 | $0.84 |
| Luma Ray 3.2, 720p | $1.08 per 5 s on fal | none | $1.08 |
| Face pass: Kling O3 Edit Pro (only if needed) | $0.168/s | 5 × $0.168 | $0.84 |

**Totals per 5 s shot, without Astra.** Sheets aren't counted, because they're made once per element.

| Route | Arithmetic | Total |
|---|---|---|
| LTX alone | $0.17 + $0.27 | $0.44 |
| LTX + face pass | $0.44 + $0.84 | $1.28 |
| Kling O3 Edit, Motion Control or Reference alone | $0.17 + $0.84 | $1.01 |
| Luma + face pass | $0.17 + $1.08 + $0.84 | $2.09 |
| Today's Omni beat (for comparison) | $0.17 + 5 × $0.10 | $0.67 |
| Today's Veo beat (8 s, audio on) | $0.17 + 8 × $0.40 | $3.37 |

Each Kling engine has a Standard tier at $0.126/s ($0.63 per 5 s). If a Kling engine wins on Pro, one later test on Standard is worth it.

### Per 15-second film

| Route | Arithmetic | Total |
|---|---|---|
| Kling O3 Edit, one 15 s take | 15 × $0.168 + $0.17 | $2.69 |
| Kling V3 Motion Control, 'image' orientation: 10 s + 5 s joined | 15 × $0.168 + 2 × $0.17 | $2.86 |
| Kling O3 Reference, one 15 s take | 15 × $0.168 + $0.17 | $2.69 |
| LTX, three 5 s shots (it maxes out near 6 s at 720p) | 3 × ($0.27 + $0.17) | $1.32 |
| LTX, with a face pass over all 15 s | $1.32 + 15 × $0.168 | $3.84 |
| Luma, 10 s + 5 s at 720p, with a face pass | $2.16 + $1.08 + 2 × $0.17 + 15 × $0.168 | $6.10 |
| Today's 3-beat film (for comparison) | 3 × $0.67 | $2.01 |

If Astra writes all three shots, add 3 × $0.11–$0.28 = $0.33–$0.84.

### How long a user waits

| Engine | Measured | Source |
|---|---|---|
| Kling O3 Edit Pro | 389 s for about 5.4 s; 559 s for 10 s; 1,182 s for 15 s | `chain.ts`, `recast.ts` records (VERIFIED) |
| Kling V3 Motion Control Pro | 152 s for 3 s | `recast.ts` record (VERIFIED) |
| Luma Ray 3.2 | 153 s for 3 s | `recast.ts` record (VERIFIED) |
| LTX (both endpoints), Kling O3 Reference | Not measured | none |

- A two-pass route (LTX, then the Kling face pass) adds about 6.5 minutes per 5 s shot, plus LTX's own time (INFERRED).
- For a 15 s film, the face pass alone takes about 20 minutes (INFERRED from 1,182 s).
- Our job runner writes a job off at 45 minutes (VERIFIED, `recast.ts`).

### Option B for comparison

These figures are INFERRED by scaling Modal's simple demo scene; a real set could render several times slower.

| GPU | Arithmetic | Per film-second | 5 s | 15 s |
|---|---|---|---|---|
| Modal L40S | 8.29 s per 1080p frame × 24 frames = 199 GPU-seconds × $0.000542 = $0.108, + about $0.017 for CPU and memory | $0.125 | $0.63 | $1.88 |
| RunPod serverless RTX 4090 (flex rate $1.10/h = $0.000306/s) | 5.9 s × 24 = 141 GPU-seconds × $0.000306 | $0.043 | $0.22 | $0.65 |

- Both need the face pass on top: +$0.84 for 5 s, +$2.52 for 15 s.
- Time: a 10 s shot is 240 frames × 8.3 s ≈ 33 min on one L40S, or about 3.3 min split across 10.
- The GPU bill isn't the problem. The problem is a second system to build and run, with the face still unsolved.

### Build effort in phases

These sizes are INFERRED, with a wide range. Recent cuts were quick: the reference upload (55ad908) took a morning, and Mystique's cuts took about a day each. But those reused existing parts. A frame-exact recorder, skeleton stand-ins that walk to marks and a timeline that works on phones are all new in this codebase. No build of the rehearsal starts before the proof passes.

| Phase | What you'll see | Size |
|---|---|---|
| 0. Proof | Bake-off results and a go/no-go decision | Free steps: 1–2 days with Blockout, or 4–6 days building the test clip in Picacho. Paid steps: one run at a time. Money: §6. |
| R1. References, cut 1 (independent of the proof; your call) | A photo on every car and object, shown on the stage; several sheets in one painted picture; a character chosen per stand-in; the consent tick | About 1 week |
| 1. Film the rehearsal | Camera moves happen for real in the video, with no fades or cuts. The stage records itself (desktop first), and one engine is wired in as an ordinary video job with credits, webhooks and refunds. The face lock runs. Your person and your hero car ride as elements if the winner is a Kling engine. | 1–2 weeks (less if F2 was built in Picacho) |
| 2. Drive | Named elements. Pick the car, draw its route, set its speed; the wheels spin. The camera can follow it or ride on it. Astra lays routes from words. | 1–2 weeks |
| 3. Walk | Skeleton stand-ins ported from Blockout replace today's 4-pose figure. They walk, run, sit and turn along marks without sliding feet. Several people per shot and per painted picture. A face lock that checks several faces. | 2–3 weeks |
| 4. Films | 15 s films in one take or as joined shots; pricing; refunds and webhooks for jobs that use two engines; a timeline that works on phones; recording inside the Android app (WebCodecs is supported in its WebView but untested there); upload limits; opening it to plans | 1–2 weeks |

- Total: about 5–9 weeks after a passing proof, plus about a week for R1.
- One-time asset cost: $0, because the stand-ins are generated in code.
  - Fallback, only if porting Blockout fails: about $2.60 for one Meshy rig plus 20 clips on fal ($0.20 + 20 × $0.12).
  - That fallback carries the ownership questions in §3.3.

## 6. Proof plan (before any build)

**Rules:**
- **Order.** Free steps come first. Paid steps run cheapest first, one at a time, each only after your yes, with its price stated.
- **Prices.** Before each paid run, I read fal's pricing API for that engine. It's free but needs our fal key. After the run, I read fal's bill for that request. If they differ, I stop and tell you.
- **Budget caps.** The "cap" columns below budget two engines at twice their page price, because they have never been billed on our key: LTX and Kling O3 Reference. Luma is budgeted the same way, because its earlier runs left no per-run bill on record. Kling O3 Edit and Kling V3 Motion Control have already billed at their page price on our key (VERIFIED, `recast.ts` records).
- **Rules before runs.** The pass/fail rules are written down before anything runs (F3).
- **Two passes for GO.** A result must pass twice, with the same inputs run again, before it counts as GO.
- **On you, not Eva.** Everything runs on you: your character, made with your consent from 4 photos of you in one outfit.
- **Settings are set explicitly, never left to defaults:**
  - LTX: `generate_audio: false` (the default is on).
  - LTX reference-video-to-video: `enable_prompt_expansion: false` (the default is on).
  - Luma: `resolution: "720p"` (the default is 540p).
  - Kling O3 Reference: `duration` set to the rehearsal's length.
  - The rehearsal is exactly 5 s, because Kling Edit and Motion Control follow the input's length and Kling bills by rounded output seconds (REPORTED, our notes).
- **Vendors' safety checkers stay on.** We never switch a vendor's safety layer off to get a render through.
- **Nothing ships.** The work happens in a throwaway copy of the code.
- **Hard cap:** $35 for the whole of Phase 0. Nothing runs past it without a new yes.

### Free steps

**F0: balances.** Check the fal and OpenAI balances first; past proof runs drained them partway through. $0.

**F1: read the fine print at the source (about an hour).**
- a. fal's pricing API for the five candidate engines.
- b. Blockout: which files hold its people, vehicles and motions, how they're built (skinned or jointed), and confirm there are no third-party assets inside.
- c. Kling's, LTX's (via fal) and Luma's terms on using a consenting real person's likeness. Any engine that refuses real people is out, and a painted frame is never used to get around a refusal.
- d. fal: is a run that the safety checker blacks out still billed? fal's docs say flagged images are "replaced with a black image of the same dimensions" (VERIFIED). They don't say whether you pay.
- e. Only if we ever run LTX ourselves (not planned): the 3DREAL adapter's "other" licence and LTX's community-licence threshold.

Pass means at least one candidate engine's terms allow a consenting real person, and Blockout's stand-ins are clean to port. $0.

**F2: the test rehearsal.** The clip for both routes is the same:
- The car drives 10–20 m along a curve.
- A stand-in walks between two marks.
- The camera does the same 35° arc at 135 mm that Omni cross-faded.
- A prop (e.g. a bag) is carried by the walker or sits on a mark.
- Lit and Depth videos, 1280×720, 24 fps, 121 frames (5 s).

Two ways to make it (your pick):
- **A. Blockout on your Mac.** This takes hours. It needs your yes to download and run an unsigned open-source app, or to build it from source. The macOS build is unsigned; running it requires clearing quarantine (`xattr -cr`), only with your yes. The painted frame is then made from Blockout's first frame by the same code Helios uses, run from a test script.
- **B. A throwaway copy of Picacho, on the Scarlet Circuit set (484d7cf2)** where the film failed. It needs a skinned figure that walks between marks, the car on a route with spinning wheels, and a frame-by-frame recorder with WebCodecs. That is most of Phase 1, so several days. It also times a recording on a phone and inside the Android app.

My suggestion is A for the proof; B's work becomes Phase 1 after a GO. $0.

**F3: the score sheet,** written before any paid run. Every result gets seven checks:
1. **Camera:** the move happens with no cut and no fade, by the frame-difference check that caught beat 1's cut (a spike of 68 where normal is 5–10). The last frame matches the rehearsal's framing.
2. **Car and prop:** the car follows the route from start to end and stays the same car; each matches its reference photo in shape, colour and details. You judge them side by side with the photos, in the first, middle and last frames.
3. **Person:** walks with moving legs along the marks, with no gliding and no extra people. A grey mannequin surviving the pass, or a stranger replacing you, fails this check.
4. **Face:** face lock of 70 or more at the start, middle and end, wherever the face shows.
5. **Clothes:** the same outfit as your one-outfit photos in the first and last frame.
6. **Place:** it looks real, judged by you side by side with the painted first frame.
7. **Wait:** a 5 s shot is finished within 10 minutes and a 15 s film within 30 minutes (INFERRED targets; you can change them). Anything past the runner's 45-minute write-off fails outright.

A full pass means all seven. A motion pass means checks 1–3 and 7. $0.

**F4: your inputs.**
- A character made from 4 photos of you in one outfit (front, left, right, back), with your consent, through the existing Characters page.
- One photo of a car you're allowed to use; your own car is simplest.
- One photo of a prop you're allowed to use (a bag, a helmet).
$0.

Each run comes back with the clip, the frame-difference chart, the first, middle and last frames next to the painted frame and the car photo, the face-lock scores, the wait time and the real bill.

### Paid steps

**P1: the bake-off.** Every engine gets the same rehearsal, the same painted frame and the same references. Engines run in the order below, and P1 stops at the first engine that passes all seven checks. That engine then runs a second time, and GO needs both runs to pass. If the second run fails, P1 continues down the list. Any engine that gets a motion pass keeps its result for P2.

| Step | What runs | Price | Cap | Running total (price / cap) |
|---|---|---|---|---|
| Prep 1 | Your car's four-view sheet (GPT Image 2.5) | $0.17 | $0.17 | $0.17 / $0.17 |
| Prep 1b | The prop's four-view sheet (GPT Image 2.5) | $0.17 | $0.17 | $0.34 / $0.34 |
| Prep 2 | Painted first frame: rehearsal frame 0 + you + the car and prop sheets. One repaint (+$0.17) if it scores under 70; if the repaint also scores under 70, P1 stops and reports — no engine runs on a frame under 70. | $0.17 | $0.17 | $0.51 / $0.51 |
| P1a | **LTX-2.3 render-to-real:** Lit rehearsal + painted frame as frame 0; `strong-v2`; 720p; 121 frames; audio off | $0.27 | $0.54 | $0.78 / $1.05 |
| P1b | **Kling O3 Edit Pro:** Lit rehearsal + you (element 1: 4 one-outfit photos) + the car (element 2: 4 views) + the prop (element 3) + the painted frame as style picture. That's 4 of 4 slots. | $0.84 | $0.84 | $1.62 / $1.89 |
| P1c | **Kling V3 Motion Control Pro:** the painted frame as its picture + the Lit rehearsal as the motion. 'image' orientation, which the schema says is "better for following camera movements". It allows no face element, so you ride only in the painted frame. The schema also asks for a "realistic style character" in the motion video, which our grey mannequin isn't. | $0.84 | $0.84 | $2.46 / $2.73 |
| P1d | **Kling O3 Reference Pro:** the same inputs as P1b, `duration: "5"`. I expect it to fail check 1's framing, because it makes "new shots" and takes no start frame. | $0.84 | $1.68 | $3.30 / $4.41 |
| P1e | **Luma Ray 3.2, as a motion candidate only:** Lit rehearsal + painted frame as start frame; depth, trajectory and pose controls; 720p; 5 s | $1.08 | $2.16 | $4.38 / $6.57 |

| Result | What it means |
|---|---|
| **GO** | An engine passes all seven checks, twice. Build Phase 1 on it. |
| **PARTIAL** | No engine passes all seven, but at least one passes motion (checks 1–3 and 7). Go to P2. |
| **NO-GO** | No engine passes motion. Go to P3. No build. |

**P2: the face pass** (only after PARTIAL). Kling O3 Edit Pro runs over the best motion result, with you as element 1 and the car as element 2. 5 × $0.168 = **$0.84**. Like everything else it must pass twice, so the second time re-runs the motion engine and the face pass. P2 in all costs $1.95–$2.76 at page prices, or $2.22–$3.84 at cap.

| Result | What it means |
|---|---|
| **GO** | All seven checks, twice, with camera and motion unchanged. Build with two passes: +$0.84 per 5 s shot, and about 6.5 minutes more wait per 5 s shot. |
| **NO-GO** | The face can't be carried. Stop and re-decide: option E or option C. |

**P3: richer input** (only after NO-GO), still with no servers. Paint the middle and end frames too (2 × $0.17 = $0.34), then run:
- (Same rule as Prep 2: a middle or end frame that scores under 70 after one repaint stops P3.)
- LTX reference-video-to-video, driven by our exact depth video (`control_video_url` with `skip_control_preprocess: true`) and the three painted frames: $0.27 (fal's own 5 s, 720p example), cap $0.54.
- Luma Ray 3.2 with the three painted frames as guide frames at frames 0, 60 and 120, depth and trajectory on, 720p: $1.08, cap $2.16.
- P3 costs **$1.69**, with a cap of $3.04.

| Result | What it means |
|---|---|
| **Motion passes** | Go to P2 for the face. If that passes, build with three painted frames per shot (+$0.34 per shot). |
| **NO-GO** | Our grey stage is too crude an input. Only then look at real rendering (option C). Its first test is one Cycles render on Modal, whose Starter plan includes $30 a month of free compute but needs your signup. |

**P4: 15 seconds** (after GO, before Phase 4). The winning pipeline runs on a 15 s rehearsal with three camera moves, the car and the walker. One retry is allowed.

| Winner | Arithmetic | Price | Cap |
|---|---|---|---|
| Kling O3 Edit, one take | 15 × $0.168 + $0.17 | $2.69 | $2.69 |
| Kling V3 Motion Control, 'image' orientation as proven in P1c: 10 s + 5 s joined | 15 × $0.168 + 2 × $0.17 | $2.86 | $2.86 |
| Kling O3 Reference, one take | 15 × $0.168 + $0.17 | $2.69 | $5.21 |
| LTX three shots + face pass | 3 × ($0.27 + $0.17) + $2.52 | $3.84 | $4.65 |
| Luma 10 s + 5 s, three painted frames per shot, + face pass | $2.16 + $1.08 + 6 × $0.17 + $2.52 | $6.78 | $10.02 |

GO means the same face, clothes and car for all 15 s, with clean joins, inside the 30-minute limit.

**P5: references at the limit** (optional, Kling winners only, before Phase 3). The shot has you, a second character (a consenting person or an AI-made one), the car and a prop: four references plus the painted frame, one more than Kling's 4. This checks that the plan shows who goes "picture only" before any spend, and what happens to that element. Painted frame $0.17 + prop sheet $0.17 + one Kling run $0.84 = **$1.18**. Pass = before any spend, the plan shows exactly one element as "picture only" and names it; the Kling run carries the other four; the picture-only element is judged side by side with its photo in the first, middle and last frames (reported, not a GO gate). Fail = anything dropped without its chip saying so.

### Total spend

| Path | Arithmetic | Price | Cap |
|---|---|---|---|
| First paid step only (you stop after it) | $0.17 + $0.17 + $0.17 + $0.27 | $0.78 | $1.05 |
| Cheapest GO: LTX passes twice | $0.51 + 2 × $0.27 | $1.05 | $1.59 |
| The GO I expect (INFERRED): LTX fails the face check, Kling O3 Edit passes twice | $0.51 + $0.27 + 2 × $0.84 | $2.46 | $2.73 |
| The whole Phase 0 I expect: the line above + P4 on Kling O3 Edit | $2.46 + $2.69 | $5.15 | $5.42 |
| P1 with no winner: all five engines once, one repaint | $0.68 + $0.27 + 3 × $0.84 + $1.08 | $4.55 | $6.74 |
| Worst listed path: P1 with no winner, P3, P2, P4 on the dearest route, P4 once more | $0.68 + $6.06 + $3.04 + $3.84 + 2 × $10.02 | — | $33.66 |
| Optional P5 | $0.17 + $0.17 + $0.84 | $1.18 | $1.18 |

- **$35 is a hard cap.** The worst listed path is $33.66 (plus P5, $34.84). A run of first-pass-then-fail results in P1 could reach about $37.86; the cap stops everything at $35 and asks you again.
- v1 said $1.75–$11.71. That range had no retries, no second passing run, no ×2 budget and an $0.08 painted frame.

## 7. What not to build, and what to stop doing

### Stop

1. **Stop fixing the two-photo film.** No more prompt sentences, move words, look tweaks or engine swaps for it; it can't move a car or a person. Keep it for shots where little moves until Phase 1 replaces it.
2. **Don't run the offered Veo and smaller-arc tests.** They tune the part we're replacing. Park the outfit test (change B). For films, one-outfit photos take its place in P1.
3. **Stop comparing Helios to "Astra on Blender" posts as if they were films of real people.** The gap to close is motion. On identity, we already ask for more than they show.
4. **Stop trying new video methods on live renders first.** Every new method gets one small probe, with its pass rules written before it runs.
5. **Stop testing with Eva, and with any photo set that mixes outfits.** Her real-or-AI status is unknown, and mixed outfits are a known cause of drift.

### Don't build

1. **Blender on our servers:** a GPU worker, a scene-to-Blender translator, an asset store. It adds light and texture, but not motion (our stage can move things) and not identity (Blender can't draw your face). Revisit only if P3 fails.
2. **Astra writing Python that runs for users.** Astra writes checked JSON, and nothing it writes is executed.
3. **Seedance for real people through any look-alike workaround.** No generated or painted portrait of a real person is ever sent to an engine that refuses real people. BytePlus's own face-check route (option E) isn't a workaround; it's parked.
4. **Photoreal 3D avatars of users** (LHM, LAM, Avaturn, MetaHuman). We found no evidence they reach a real likeness, and the AI pass carries the face.
5. **Theatre.js's Studio editor in front of users,** because it is AGPL. Use three.js's own keyframes or @theatre/core behind our own timeline.
6. **Branded cars or marketplace models in the browser stage,** from TurboSquid, BlenderKit or Sketchfab's Standard licence. Anyone can pull the file out of a browser, which those licences forbid, and brands carry trademark risk.
7. **Tencent's Hunyuan3D 2.1 or HY-Motion on our own machines,** because their licences exclude the EU. Also avoid Hunyuan 3D on fal until its EU terms are read, and tools built on the SMPL-X body model without a commercial licence.
8. **A Blender plugin or desktop app.** That is Higgsfield's route; our users are in a browser and on phones.
9. **World models (Genie 3, Odyssey, World Labs Marble) as the engine.** They make places, not directed cars and people, and they take no character photos.
10. **3D models made from reference photos (image-to-3D), for now.** Reasons in §3.3.
11. **Switching off a vendor's safety checker** to get a render through.

## 8. Sources

All web pages were read on 2026-09-21. "Snippet" means we read only a search-result extract; "blocked" means the page refused our readers.

**OpenAI and Astra**
- https://developers.openai.com/api/docs/models/gpt-6-astra
- https://developers.openai.com/blog/architectural-visualization-with-astra (no date shown on the page)
- https://learn.chatgpt.com/docs/models (Codex cloud is marked unsupported for gpt-6-astra in the raw page data)
- https://developers.openai.com/api/docs/guides/tools-shell
- https://til.simonwillison.net/llms/blender-coding-agents-macos (re-read today; created 2026-09-05)
- https://github.com/simonw/gpt-6-astra-blender-pelican-bicycle
- https://github.com/ahujasid/blender-mcp
- https://www.blender.org/lab/mcp-server/
- https://kingy.ai/blog/blender-openai-astra-complete-guide/ (secondary)
- https://blog.neural4d.com/user-guide/gpt-6-astra-blender-mcp/ (secondary)
- https://github.com/magiccreator-ai/awesome-gpt-6-astra
- https://developers.openai.com/api/reference/resources/images/methods/edit (new: "For GPT image models, you can provide up to 16 images")

**How competitors make motion**
- https://higgsfield.ai/blog/higgsfield-3d-jutsu
- https://higgsfield.ai/creator-hub/changelog
- https://x.com/higgsfield_ai/status/2096088339548115037 (snippet)
- https://higgsfield.ai/plugins/blender
- https://higgsfield.ai/blog/higgsfield-blender-plugin
- https://erikataranto.com/en/blog/higgsfield-blender (secondary)
- https://gachoki.com/block-in-blender-finish-with-ai/ (secondary)
- https://help.intangible.ai/compose/animation
- https://help.intangible.ai/visualize/generate-video.md
- https://help.intangible.ai/visualize/ai-models.md (re-read today: "Ray 3.2 for final quality, Ray 3.14 for iteration")
- https://help.intangible.ai/build/motion-paths.md
- https://www.intangible.ai/pricing
- https://dreamina.capcut.com/resource/gpt-6-astra-review
- https://aituts.com/gpt6-astra-animation/
- https://flick.art/blog/blender-ai-filmmaking
- https://github.com/wassermanproductions/blockout
- https://raw.githubusercontent.com/wassermanproductions/blockout/HEAD/README.md (new)
- https://raw.githubusercontent.com/wassermanproductions/blockout/HEAD/NOTICE (new)
- https://api.github.com/repos/wassermanproductions/blockout (new: Apache-2.0, last push 2026-08-05)

**Re-shoot engines**
- https://fal.ai/models/fal-ai/kling-video/o3/pro/video-to-video/reference (and its API tab)
- https://fal.ai/api/openapi/queue/openapi.json?endpoint_id=fal-ai/kling-video/o3/pro/video-to-video/reference (new: no first-frame field)
- https://fal.ai/models/fal-ai/kling-video/o3/standard/video-to-video/reference
- https://fal.ai/models/fal-ai/kling-video/o3/pro/video-to-video/edit
- https://fal.ai/api/openapi/queue/openapi.json?endpoint_id=fal-ai/kling-video/o3/pro/video-to-video/edit (new)
- https://fal.ai/models/fal-ai/kling-video/o3/standard/video-to-video/edit (new)
- https://fal.ai/api/openapi/queue/openapi.json?endpoint_id=fal-ai/kling-video/v3/pro/motion-control (new)
- https://fal.ai/models/fal-ai/kling-video/v3/pro/motion-control (new: $0.168/s)
- https://fal.ai/models/fal-ai/kling-video/v3/standard/motion-control (new: $0.126/s)
- https://fal.ai/models/fal-ai/ltx-2.3-quality/render-to-real
- https://fal.ai/api/openapi/queue/openapi.json?endpoint_id=fal-ai/ltx-2.3-quality/render-to-real
- https://huggingface.co/fal/LTX-2.3-3DREAL-LoRA
- https://fal.ai/models/fal-ai/ltx-2.3-quality/reference-video-to-video
- https://fal.ai/api/openapi/queue/openapi.json?endpoint_id=fal-ai/ltx-2.3-quality/reference-video-to-video
- https://docs.agents.lumalabs.ai/guides/videos/editing/
- https://docs.agents.lumalabs.ai/api/resources/generations (new: only ray-3.2 listed)
- https://docs.lumalabs.ai/docs/video-generation (new: ray-2 and ray-flash-2 only)
- https://lumalabs.ai/api (new: sells Ray3.2; V2V 5 s = $0.72 / $1.44 / $2.16 at 540p / 720p / 1080p)
- https://lumalabs.ai/news/ray3_14 (new: "References (Character) aren't supported in Ray3.14")
- https://fal.ai/models/luma/agent/ray/v3.2/video-to-video
- https://fal.ai/api/openapi/queue/openapi.json?endpoint_id=luma/agent/ray/v3.2/video-to-video
- https://fal.ai/models/minimax/h3-max/reference-to-video
- https://fal.ai/api/openapi/queue/openapi.json?endpoint_id=minimax/h3-max/reference-to-video (new)
- https://fal.ai/models/bytedance/seedance-2.5/reference-to-video
- https://fal.ai/models/google/gemini-omni-flash/v1.1/edit
- https://fal.ai/api/openapi/queue/openapi.json?endpoint_id=google/gemini-omni-flash/v1.1/edit (new: prompt, video_url and resolution only)
- https://fal.ai/api/openapi/queue/openapi.json?endpoint_id=google/gemini-omni-flash/v1.1/reference-to-video (new)
- https://fal.ai/models/google/gemini-omni-flash/v1.1/image-to-video (new: $0.10/s at 720p)
- https://fal.ai/models/fal-ai/veo3.1/first-last-frame-to-video (new: $0.40/s with audio)
- https://fal.ai/models/fal-ai/wan-vace-14b/depth
- https://fal.ai/models/moonvalley/marey/motion-transfer
- https://fal.ai/api/models?categories=video-to-video (206 endpoints; Veo extend only; Luma Ray 3.2 and Ray 2 only)
- https://fal.ai/api/models (new: the whole catalogue, 1,500 entries, scanned for Luma and image-to-3D)
- https://fal.ai/docs/documentation/model-apis/model-arguments (new: flagged images are replaced with black)
- https://docs.dev.runwayml.com/api/
- https://docs.dev.runwayml.com/guides/pricing/
- https://docs.dev.runwayml.com/guides/models/

**Motion, figures, assets and image-to-3D**
- https://threejs.org/docs/#api/en/animation/AnimationMixer
- https://threejs.org/examples/webgl_animation_skinning_blending.html
- https://threejs.org/docs/#api/en/extras/curves/CatmullRomCurve3
- https://quaternius.com/packs/universalanimationlibrary.html
- https://quaternius.com/license.html
- https://helpx.adobe.com/creative-cloud/faq/mixamo-faq.html (blocked; terms taken from snippets)
- https://fal.ai/models/fal-ai/meshy/rigging/multi-animation
- https://docs.meshy.ai/en/api/pricing
- https://www.meshy.ai/terms-of-use (new: output ownership, updated 2026-09-19)
- https://fal.ai/models/meshy/v7/image-to-3d (new)
- https://developers.tripo3d.ai/en/pricing
- https://fal.ai/models/tripo3d/h3.1/image-to-3d (new)
- https://www.tripo3d.ai/terms (new; blocked)
- https://www.tripo3d.ai/help/privacy-policy/how-to-use-tripo-models-commercially (new; blocked, snippet only)
- https://fal.ai/models/fal-ai/hunyuan-3d/v3.1/pro/image-to-3d (new)
- https://polyhaven.com/license
- https://sketchfab.com/licenses
- https://www.turbosquid.com/help/en/articles/9937426-associated-brands-information (snippet)
- https://fal.ai/models/fal-ai/trellis-2
- https://huggingface.co/tencent/Hunyuan3D-2.1/blob/main/LICENSE
- https://huggingface.co/tencent/Hunyuan3D-2.1/raw/main/LICENSE (new: re-read; excludes the EU, UK and South Korea)
- https://github.com/Tencent-Hunyuan/HY-Motion-1.0/blob/master/License.txt
- https://smpl-x.is.tue.mpg.de/modellicense.html (snippet)

**Recording in the browser**
- https://raw.githubusercontent.com/Fyrd/caniuse/main/features-json/webcodecs.json (re-read today: Android WebView 151 yes)
- https://developer.mozilla.org/en-US/docs/Web/API/VideoEncoder
- https://github.com/Vanilagy/mediabunny
- https://github.com/theatre-js/theatre
- https://registry.npmjs.org/@theatre/studio

**Blender on servers (option B)**
- https://pypi.org/project/bpy/
- https://modal.com/docs/examples/blender_video
- https://modal.com/pricing
- https://modal.com/docs/guide/sandbox-resources
- https://www.runpod.io/pricing
- https://lambda.ai/pricing
- https://opendata.blender.org/benchmarks/query/?compute_type=OPTIX&group_by=device_name&blender_version=4.5.0&response_type=datatables
- https://www.blender.org/about/license/
- https://vercel.com/docs/functions/limitations
- https://c.pgdm.ch/notes/eevee-docker-gpu/
- https://projects.blender.org/blender/blender/issues/128418 (title only)

**Our own code and records** (read 2026-09-21)
- `/Users/ahmadkmm/Picacho/docs/ASTRA_SETS.md`:
  - §1.1: our probe found no Blender in OpenAI's sandbox.
  - Line 292: the 2026-09-15 exclusion.
  - Lines 276–282: the first-film diagnosis.
  - Lines 284–290: reference photos.
  - Line 426: GPT Image 2.5 cost, including a fourth picture.
- Sets code:
  - `/Users/ahmadkmm/Picacho/src/lib/sets/set-spec.ts`
  - `/Users/ahmadkmm/Picacho/src/lib/sets/film.ts`
  - `/Users/ahmadkmm/Picacho/src/lib/sets/take.ts`
  - `/Users/ahmadkmm/Picacho/src/lib/sets/moves.ts`
  - `/Users/ahmadkmm/Picacho/src/lib/sets/vehicles.ts`
  - `/Users/ahmadkmm/Picacho/src/lib/sets/sequencer.ts`
  - `/Users/ahmadkmm/Picacho/src/lib/sets/actions.ts` (`shootInSet`: one character, one `lookRefId`)
  - `/Users/ahmadkmm/Picacho/src/lib/sets/reference-actions.ts`
  - `/Users/ahmadkmm/Picacho/src/lib/sets/references.ts`
  - `/Users/ahmadkmm/Picacho/src/lib/sets/look-sheet.ts`
  - `/Users/ahmadkmm/Picacho/src/lib/sets/set-config.ts` (`SET_REFS_MAX` = 6)
  - `/Users/ahmadkmm/Picacho/src/components/sets/set-view.tsx`
  - `/Users/ahmadkmm/Picacho/src/components/sets/set-editor.tsx`
- `/Users/ahmadkmm/Picacho/src/lib/generations/providers/image-references.ts`: several people drop the extra pictures.
- `/Users/ahmadkmm/Picacho/src/lib/generations/providers/openai-images.ts`
- `/Users/ahmadkmm/Picacho/src/lib/generations/providers/video-models.ts`: Omni and Veo prices.
- `/Users/ahmadkmm/Picacho/src/lib/generations/chain.ts`: Kling O3 Edit timings.
- `/Users/ahmadkmm/Picacho/src/lib/recast/recast.ts`: engines, input limits, request bodies, timings, ledger reads.
- `/Users/ahmadkmm/Picacho/src/lib/recast/actions.ts`: the face lock only with one face, lines 1010–1014.
- `/Users/ahmadkmm/Picacho/src/lib/recast/recast-brief.ts`
- `/Users/ahmadkmm/Picacho/src/lib/generations/send-plan.ts`: which engines accept photoreal faces.
- `/Users/ahmadkmm/Picacho/src/lib/characters/actions.ts`: 20 photos, 2 outfit photos.
- `/Users/ahmadkmm/Picacho/src/components/character-form.tsx`: no consent step.
- `/Users/ahmadkmm/Picacho/src/lib/i18n/legal/content-policy.ts`: "Real people & likeness".
- `/Users/ahmadkmm/Picacho/src/lib/admin/economics.ts`: `IMAGE_COST_USD` = $0.17.
- Commits:
  - From 2026-09-15: 106ebf9, 9918570, 6b2e951, df66af4.
  - 55ad908: reference photos.
  - eb40164: face verification.
  - c6df848: added images in Mystique.
  - 7c57f66: face lock.
- Our memory records, under `/Users/ahmadkmm/.claude/projects/-Users-ahmadkmm-Picacho/memory/`:
  - `picacho-astra-sets.md`: the 2026-09-21 films and reference photos.
  - `genjutsu-answer-draft.md`: Kling O3 Edit probes, one-outfit test, fal ledger, the 2026-09-19 engine survey.
  - `picacho-open-items.md`: the Seedance refusal, Higgsfield's route and the look-alike rule.
  - `byteplus-seedance-access.md`: option E, prices, EU region.
  - `picacho-face-lock.md`
  - `helios-launch.md`
  - `helios-blender-expectation.md`: your rule: prove before spending, no guess renders.
- The reviewer's critique of v1: `/private/tmp/claude-501/-Users-ahmadkmm-Picacho/5c72005e-715b-4022-879d-e6310b3a91f8/scratchpad/research-critic.md`