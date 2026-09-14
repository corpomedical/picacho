# Astra Sets

Date: 2026-09-10. Status (read in production 2026-09-12): Phase 0 and Phase 1 are built and on, for admins only (flag `astra_sets`). Of Phase 2, Sets from a photo and Match this shot are built and on for admins, switched on by the operator for testing (flag `astra_photo_sets`, 2026-09-11), and the set finisher runs (a one-minute cron, 2026-09-11); the rest of Phase 2 (credits), and Phase 3, are not built. Evidence comes from four places:
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

**2026-09-14.** The image engine is GPT Image 2.5 Sunburst at quality high, every render's usage priced into its log ("The image engine", below "The look"). The look is an object sheet — the set's objects cut out of an earlier still (SAM 2, one request an object, a box and a point each), drawn four ways on grey by the image model, once per still — after the first shot ever to carry a cutout came back with a different car; and where a still's people are is read from the still itself by the vision model, because that shot had drawn the person a metre from the sketch's figure and the cutout carried her arm and legs ("The look"). A Set shot's brand rules are judged with Picacho's fixed sentences taken out. The operator's own race-track set has four stills; still 1's camera is on record (`applied/2026-09-14/backfill-race-track-still-1-camera.sql`) and lends the look; the fourth still cannot (its person's region and the figure's leave nothing of the car clear). No shot of the product's own has yet sent a sheet: that is the next test. The same day the Sets pages were laid out again ("the whole page is confusing"): on a set, the stage and its chips on the left and the shoot panel beside them (the look as a card with the still it follows, Turn off and a picker), the stills below with their look controls in view; on the home, a strip of figures (sets, stills this month, builds this month) and each set's still count. Checked on the real components at 1280 px and at phone width (the inert worktree, `.claude/worktrees/ui-check`).

**2026-09-14, later: Sets is a conversation with Astra ("build E with Picacho's twist").** The operator turned down four drawn directions for the pages (a studio layout, numbered steps, a dark viewfinder, a Higgsfield Cinema Studio composer) and picked the fifth: Higgsfield's Supercomputer — a chat with an agent — in Picacho's own skin. The Sets home now asks what we are shooting today: one message (who, where, what happens), a chip for who (the person's characters with a photo), a chip for where (a set already built, or a new place), an Ask first chip, and send; under it, six example shoots to Recreate (they fill the composer with the person's own character's name) and the sets already built, with the dashboard's figures on one line. With a set picked, the message goes to that set's page in the address (`?ask=`, with the character and whether to wait); with a new place, `words-actions.ts readSetRequest` reads the place out of the message (the people and the camera left out, since Astra never builds people; the whole message when the reader cannot read it), the build starts as before, and the person goes to the new set's page, which shows the message above a building step and refreshes itself into the conversation when the build settles (`set-building.tsx`). A set's page (`set-view.tsx`) is the thread: earlier stills oldest first, each under the words kept with it; then the person's messages since the last still; then Astra's frame bubble — a placing step (mark, camera, lens, what happens) and the live stage in its own bubble, draggable as ever, with Shoot, Change the frame (the camera, lens, mark and match chips, hidden until asked for) and Another angle (the set's next camera); a Shooting bubble while a still renders; and a docked composer with who, the look (on: the still it follows; off), Ask first and the words. A message is read by `shot-words.ts` on gpt-5.4-mini into fields only — intent (frame, shoot, talk), the direction in the person's words, a camera id, a side of the figure (front, back, left, right, the diagonals), a size (close-up to wide), a height, a tilt, a lens, a mark, where the figure faces — never into text of its own: everything Astra says is Picacho's sentence in the person's language. The fields go through the matched-shot path: a side becomes a camera handed to `solveMatchPose` already on that side of the figure (so its bearing holds), a size a distance, a height a lens height with the tilt it implies, and `matchTo` places it round anything built, saying so when it had to move. "Shoot" in the words, or Ask first off, shoots at once; otherwise Astra waits. A reading that fails (no key, a refusal, 20 s, not the shape) takes the message as what happens and says "I took that as what happens in the frame"; a message about neither the frame nor the shot gets "Say who is in the frame, what happens, or where to put the camera". The message is kept with the still it led to (`location_set_shots.words`, `supabase/applied/2026-09-14/set-shot-words.sql`, run in production the same day; written in an update of its own and read in a query of its own like the camera, so nothing changed until it ran; every message since the last still, as one) and shown above it when the page is reopened. The Match this shot flow, the look, the compare block of a photo set and the stage engine are untouched; the eval's viewer-parity lines all still match. Cost: one reading a message, a few hundred tokens on gpt-5.4-mini, under a cent; the shot itself unchanged. Checked on the real components in the inert worktree at 1280 px: the home, the thread with three stills (one without words, from before the column), Change the frame, a message through the fallback path (the reader unreachable there), Enter in the composer. Not done yet, by choice: a "Recent shoots" list in the sidebar, and a sheet for picking among several look stills (the composer's Look chip toggles the newest; Keep this look under any still pins it).

**2026-09-14, evening: the set page as a workspace ("research how Higgsfield's chat box works and how they show their results. I'm not convinced").** Read from their pages (Supercomputer, its help-center and guide, 3D Jutsu's write-up, the showcase view of a finished chat, a public project page): the composer is plain language with "/" for skills and "@" for characters and locations, a model chip, an Ask/Agent mode switch, and attachments; after send the agent proposes a plan with the model, quality, duration and aspect of each step and the credit cost, an Approve button gates the spend, steps run with the running cost shown, results land in the same chat, and a reply re-runs only what changed. A finished chat is shown media-first: the output large on the left with a filmstrip of every output, the transcript in a narrow right panel — the user's bubble with its reference thumbnails, the agent's replies in plain prose, a row of run chips (model, ratio, count, audio), a closing line, feedback icons, and a footer with time and category. 3D Jutsu, their Sets: the 3D viewport is the workspace and the chat a panel inside it; "generate without asking" and "ask before generating", plus an ask-only mode; the render is requested from the chat and comes back as a card; every session is a revision to preview or restore. Against that, E as first built had the stage inside a bubble, small stills inline, label-speak, no plan or price before Shoot, and chips where they have "@". So the set page is now that workspace, in Picacho's skin: the stage large on the left (the live frame, draggable; its chips under it behind "Change the frame"); a still that lands takes the stage's place — the WebGL stage keeps running underneath — with its score, previous/next, and Back to the frame; a filmstrip of the frame and every still under it; the conversation as the right panel (21 rem, sticky, scrolling inside) with the composer at its foot. Astra's turn is one sentence composed from the frame (`placedLine`: who stands on which mark facing which way, which camera and lens, what happens — the facing read back from the mark's angle against the camera's bearing, the reverse of `facingFor`), then the frame as fact chips (camera, lens, mark, engine, price), then Shoot as the approve button. The composer: the character chip or "@" in the words opens a who menu (Enter picks the first match), the Look chip as before, and a mode switch reading "Ask before shooting" / "Shoot without asking" (the home's chip says the same). Frame revisions: every frame Astra sets, every Another angle and every shot keeps the frame (camera id, pose, mark, direction) in a list of up to 12 for this visit; chips under the stage step back to one. Not done, by choice: revisions across visits (would need a table), a per-step cost breakdown beyond the one credit, and "/" skills. Checked on the real components in the inert worktree at 1280 px.

**2026-09-14, night: "cramped, unorganized and confusing … Give me your best! Draw it and show it to me" → drawn (the canvas's F page, two boards at 1440) → "Build it."** What was wrong: the stage and the panel were squeezed into the app's 1024 px reading column; three rows of chips behind "Change the frame"; Astra in labels; the frame as loose chips. What was built, as drawn: the set page marks its root `data-set-workspace` and `globals.css` lifts the content wrapper's max-width for it (`[data-app-content]:has([data-set-workspace])`, the same `:has()` the shell already uses; 1.5 rem padding from md up), so the stage gets everything but the panel (21 rem at lg, 25 rem at xl); the page's header is a 60 px bar (back, name, Astra's description truncated, the still count). Under the stage ONE toolbar: `Select` dropdowns for Camera (the set's cameras; "Your own camera" when the orbit was grabbed), Lens (every lens, 18/85/135 hinted wide/portrait/long) and Figure (the marks), the turn arrows as icon buttons, a divider, Frame the figure and Match a shot as tools, and at the right end History (the frame revisions of this visit, newest first, each hinted with its camera and lens; shown once there are two). No "Change the frame" button. The Match read's status line sits under the toolbar only while there is one. The filmstrip: the frame tile, then every still with its score badge and the look badge, and "n stills · the newest first". The viewer overlay as before, plus a caption (still number, date, and the frame it was shot from when this visit shot it) and the still's own actions on the picture (Keep this look / This is the look, Open take). The panel: a header (Astra · Sets · GPT Image 2.5), the transcript scrolling inside (the person's words as dark ink bubbles; Astra as plain text beside an "A" mark with the ochre underline; a still as a line — "Shot in 58 seconds. Identity 87, above your bar of 70." when this visit shot it — plus a small card with the still, its number, score, date and frame, and Keep this look / Another angle / Open take), then Astra's proposal: the sentence, then ONE card headed The frame · Frame n with five rows (Who with the avatar, Where = mark · facing, Camera = camera · lens, Happens = the direction or an em dash, Cost = "1 credit · about a minute") and Shoot beside Another angle; the composer at the foot with the words first, then the who chip ("@" opens the menu), the Look chip and the mode as a dropdown (Ask before shooting / Shoot without asking), and send. `React`'s purity lint refused `Date.now()` in the shoot handler (`new Date().getTime()` instead) and the immutability lint wanted `shoot` declared before `send` calls it. Checked on the real components in the inert worktree at 1440 px: the toolbar and the Lens menu, the filmstrip, the panel with two stills, the frame card, the viewer.

**2026-09-14, later: "I need adobe blender capabilities on sets, its too primitive" → first draft rejected ("cheap and confusing. Is this what adobe would do?") → redrawn as a real editor (canvas page G, two boards at 1600) → "Build it."** The set page's second life: `?build=1` renders `SetEditor` (a full-screen fixed overlay, dark like the stage in both themes) instead of the workspace; a Build chip in the workspace's header opens it, Build|Shoot tabs and "Done — Shoot" leave it. Adobe's grammar: tool rail (Select/Move/Turn/Size, Add — the seven shapes, a light, a mark, a camera from the current view), docked canvas with three.js `TransformControls` (the RGB gizmo; snap 0.1 m / 15°; lights and cameras translate only, a mark turns on Y for its facing, a torus is sized by numbers because its ring is geometry, `sizeFromScale` reads unitScale backwards), a context bar of exact numbers, the Scene tree (environment, each light, every thing named shape·dims with its colour dot, marks drawn as the grey stand-in, cameras) over the Properties inspector, a status bar, and Astra as the prompt bar at the canvas's foot. EVERY edit is a new spec through `normaliseSetSpec` (`editor-model.ts`, pure + tested): patches, add/duplicate/remove with the caps and the keep-at-least-one rules; object meshes are the interpreter's last `meshCount` children in spec order, tagged `userData.oi` for picking. One history this visit (Edit n, ↺↻, ⌘Z; 60 kept), autosave 1.2 s to `location_sets.edited_spec` (SQL `supabase/pending/set-editor.sql` — until it runs the editor works but saves fail with the save line saying so), "Astra's original" restores `spec` (never overwritten) via `clearSetEdit`. The server holds text on every browser save (`holdEditedText`: title/description forced from the stored copy, unknown labels dropped) so hand edits move and recolour but never write. `editSetWithAstra` (editor-actions.ts): gate the person's words like a brief → rate limit 10/10 min → `setEditRequest` (set-edit-prompt.ts, same schema and caps as a build, own instructions, the working spec as data) → submit + poll inline to 180 s → parse/normalise → gate `specTextForGate` like a build's answer → save; the bar answers with `countSpecChanges`. The page and the shoot workspace draw `editedSpec ?? spec` (data.ts reads the column defensively, its own query); layout and the look are held against the drawn spec. The editor deliberately skips the exposure lift: lighting is edited raw. i18n ~87 sets keys + 4 serverText wires ×4 languages.

**Built.** Phase 0 (both ungated image paths now pass the picture check; the utility readers refuse any `gpt-6` model; a hashed `safety_identifier`; the guard test; the three flags, off) and Phase 1 (Sets from a description, admins only). Code: `src/lib/sets/`, `src/lib/generations/providers/astra.ts`, `src/lib/astra/prices.ts`, `src/components/sets/`, `src/app/app/sets/`. SQL: `supabase/applied/2026-09-10/astra-sets.sql` (run in production 2026-09-11; flags confirmed off, tables present, anonymous key refused).

**3.2 Sets from a photo: built 2026-09-11, on for admins since the operator's test** (flag `astra_photo_sets`, admins only; SQL `supabase/applied/2026-09-11/astra-photo-sets.sql`, run in production 2026-09-11: both photo columns present, the switch then off; on when read 2026-09-12). Worst case $1.81625 a build (`set-config.ts`). Match this shot is built behind the same switch (no SQL; worst case $0.16625 a match, no live read made yet; see 3.2). The finisher is built (a one-minute cron instead of the planned webhook, 2026-09-11 — see Phase 2); credits are not. Photos with people are unmeasured (eval D).

**Three live photo builds before shipping (2026-09-11)**, through the repo's own code (photo.ts re-encode, astra-request.ts, providers/astra.ts, the normaliser, closure.ts), with no database: one people-free bakery photo made by GPT Image, 1536×1024, sent inline at detail high.

| Build | Rules | Time | Tokens in / out | Cost | Result |
|---|---|---|---|---|---|
| 1 | as built | 123 s | 3,991 / 9,078 | $0.4938 | Closed, but **mirrored**: counter and window tables swapped sides |
| 2 | + axes rule | 138 s | 4,071 (1,844 cached) / 10,580 | $0.5531 | Not mirrored, but **open on three sides**: the 400-shape cap cut a 7 m facade and a 12 m wall |
| 3 | + axes rule, + budget rule, new normaliser | 183 s | 4,126 (1,844 cached) / 12,455 | $0.6474 | Not mirrored, closed; 97 objects in 365 shapes; camera 1 lines up with the photo |

- **The mirror.** three.js is right-handed: a camera looking toward +Z sees +X on its left. Build 1 put camera 1 looking toward +Z and every left-of-photo object at -X, so the set came back as the photo's mirror image. The photo rules now stand camera 1 on +Z looking toward -Z, where "+X is right" is true, and say never to mirror.
- **The shape budget.** The normaliser used to spend the 400-shape budget in list order, dropping every object after the 400th shape. Astra listed loaves of bread early and the street beyond the window last. It now trims the repeats of the smallest objects first and never drops an object: at most 300 objects fit in 400 shapes, so trimming always suffices, and walls are single objects. A set within budget normalises exactly as before, and every stored set is. Build 2's own answer, re-normalised, measures closed. The photo rules also now say to list the structure first and repeat small props less.
- **Measured costs** sit inside the photo caps: at most 12,455 output tokens against 16,000, and image input about 2,100 tokens on top of the cached prefix. The prompt cache held across builds.

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

The fix lifts each set once, from what it actually looks like (`src/lib/sets/exposure.ts`). When a set opens, the viewer measures the mean brightness of the first mark's eye-height panorama through the real renderer and brightens it until the mean reaches 80/255, **fill light first**: a neutral hemisphere light (white above, `#c0c0c0` below) is added beside the set's own fill, by false position, until the fill totals up to 16 times the set's own (the added light, at most 15 times). The set is measured without the grey figure: the figure stands wherever the person left it, and on the production podcast studio, a stride from the first mark, it filled part of the measured view and cut the lift from 16× to 11× (found checking the production cards, 2026-09-11). The lift belongs to the set, not to where the figure was left. Only when that is not enough — a night sky filling half the view, or a set with no fill light — is the exposure raised as well, up to 8× (1.3 → 10.4). It only ever raises: a set bright enough already is left as built, at the cost of one measurement.

The first version (8c9fb44) raised the exposure alone, like a camera. Checked against the production sets once it deployed, it was right about the daylit street and wrong about the podcast studio. Exposure scales the lamps along with the shadows, so the lamp-lit table went white and the walnut pale peach while the far walls stayed dark. Fill lifts the shadows and barely touches what a lamp already lights — a gaffer's answer rather than a camera's. Turning up Astra's own fill was tried first and lost on colour: Astra tints its fill with the scene's palette, and sixteen times a deep-blue night fill turned stone lavender, paving navy and brick mauve. Hence neutral fill, added beside the set's own, which stays as Astra wrote it.

Three blind rounds on the eight darkest sets (forest, rooftop, market ×3, podcast studio ×3), twelve judges a round. Each judge saw the authored render as a reference and two candidates under neutral labels, and chose which shows the whole place better, which keeps the materials truer to the description, and which is the better sketch:

| Round | Readable | Faithful | Overall |
|---|---|---|---|
| Turned-up fill vs exposure alone | 12–0 | 9–3 | 9–3 |
| Added neutral fill vs turned-up fill | 5–3 (4 even) | 11–1 | 11–1 |
| **Added neutral fill vs exposure alone (what was live)** | **12–0** | **12–0** | **12–0** |

The judges' standing complaint about the winner is that it looks flat, like an overcast afternoon rather than dusk. That is the trade the brief makes on purpose: the sketch carries the layout and the materials, the description carries the hour and the mood.

Measured on all twenty sets built so far (panorama from the first mark):

| | Sets | Lift | Near-black share of the panorama |
|---|---|---|---|
| Daylit | 10 | none | unchanged |
| Interiors | podcast studio ×3, showroom ×2 | fill 1.2–16, exposure unchanged | podcast studios 47–65% → 1–6%; showrooms 18% → 16–18%: both reach the target (mean 46 → 77 and 72 → 77), and what stays near-black is black by material — dark glazing and a black wall — which no light lifts |
| Night exteriors | market ×3, forest, rooftop | fill 16, exposure 1.7–3.8 | markets 58–64% → 2–3%, forest 89% → 0%, rooftop 77% → 0.1% |

On the lifted sets, blown-out pixels are at most 0.7% of any panorama (1.2% of one card); daylit sets are untouched (the bedroom's own 1.3% is the most). In a real browser (Apple M1, pixel ratio 2), with the shaders already compiled — they compile for the first frame either way — the lift takes 38 ms on a daylit set and 61–128 ms on the dark ones: up to six measurements of nine small renders each, one for the shadows and eight views (fourteen measurements at most).

Does a lifted sketch still give a night still? Four GPT Image 2 stills from sketches lifted this way (a generic invented person, no character photo): the market, the forest at dusk, the rooftop at night and the production podcast studio. All four came back at the hour the description gives — rain-dark cobbles under a lamp, a campfire under a violet sky, a lit skyline, a dim studio under amber shelf light — with the layout followed, and the podcast table came back as the description's oak, not the cream the sketch shows. The same test on exposure-lifted sketches, with a control that left out the prompt line, had also come back as night; the line stays, sent only with lifted sketches. About $0.68 for each four at the `plans.ts` GPT Image figure.

One lift per SET, so the view, every snapshot sent to the image model and the card on the Sets page share it. The card's path carries a version (`<user>/sets/<setId>.v4.jpg`, `setThumbPath`): a card at any other path — from before any lift, lifted by exposure alone (`.v2`), or measured with the figure in view (`.v3`) — is taken again the next time its set is opened, and the old file is removed. When the set was lifted, the shot prompt says the sketch is lit brighter than the scene and that the time of day and darkness come from the description; the viewer sends `lifted` with the shot, and a daylit set's prompt is unchanged. A readback that returns nothing — a GPU reset mid-measurement, seen as zero alpha where everything a set draws is opaque — counts as no measurement at any step, and the set is left as built.

**The operator's first takes, and what they changed (2026-09-11).** Two stills in the showroom (GPT Image 2, identity 89 and 82), and three complaints: the car changed between them, the second looked like a toy, and in the first it was impossible to tell where the character was looking. The sketches and prompts explained all three.

- **The toy car.** Where the block-built car filled the frame side-on, the image model drew those blocks as a car — boxy, with a box on the roof. Seen from behind, where the blocks say little, it invented a sleek coupe instead. The prompt called the sketch "a guide to composition" but never said its objects are stand-ins. It now says every object is a block stand-in: keep its place, size and orientation, draw the real thing at full size, never as a toy, model or miniature (`set-shot-prompt.ts`). On the same sketch, the old prompt reproduced the toy car and the new one gave a real coupe in the same place.
- **The gaze.** The prompt said only "facing the same way" as a figure with no face. It now puts the figure's facing in the camera's terms, worked out from the saved mark and the camera pose (`describeFacing`: faces the camera / three-quarters toward / in profile / three-quarters away, facing frame left or right / back to the camera), and asks for a gaze that can be read. Take 2's own layout reads "turned three-quarters away from the camera, facing frame right"; the new still showed that turn with the head clearly on the car. Where the person's words ask for something the facing contradicts ("looking at the car" behind a figure that faces the camera), the model followed the words.
- **The car changing.** Nothing in a set says which car it is — the description says "a crimson sports coupe" — so each still designed its own. Tested: attaching the first new still as a design reference for a second angle kept the car's design, and also carried over the person's dress, though the prompt said to take nothing else from it. The operator chose the earlier still over Astra describing its key objects (weaker, but clean) — see "The look" below.

Four GPT Image 2 stills, a generic invented person and no character photo: about $0.68 at the `plans.ts` figure.

**Camera controls (same day).** The operator could not aim the camera at the character. Added: "Frame the figure" (or a double-click on it) puts the camera in front of the figure, where it faces, with the whole figure in the lens — falling back to the side the person is looking from, then to whichever of eight bearings has room, and stopping 0.3 m short of anything built. Four arrows on the stage pan and tilt the camera where it stands, 5° a press (tilt up is held to 20°, inside OrbitControls' polar limit, so a tilt never moves the camera). The drag hint now names Shift-drag, which always slid the view.

**The look (same day, the operator's choice; since 2026-09-12 it sends only the objects).** A shot carries the set's objects from an earlier still as a design reference, so the car, the furniture and the finishes are the same objects from shot to shot. It first carried the whole still; see the operator's first real test below for why it no longer does.
- **Which still.** By default the newest finished still that can lend one; the person can pick another such still from the contact sheet ("Use its look") or turn it off. Each shot records the frame it was taken from: the stage camera's pose and the canvas's shape as the page sent them, and where the grey figure stood (`location_set_shots.camera`, `supabase/applied/2026-09-14/set-shot-camera.sql`, run in production 2026-09-14; written in an update of its own and read in queries of their own, so without the column every shot works as before and none offers a look; `shot-camera.ts`). The pose as sent, never the saved layout's copy: `normaliseSetLayout` holds a camera to the set's bounds plus 10 m and never below 0.2 m, while the stage's orbit goes further and lower, and boxes worked out from a moved camera miss what the still shows (found in review, 2026-09-12: scrolled out to 30 m in the showroom, the stored camera would have stood at 20 m and boxed the car about 1.5 times too large). Nothing is clamped on the way in or out: a pose no stage can have is not recorded. A still can lend its look only when there is something to cut out of it (`look-cutout.ts` `seesLookObjects`, which the set page and the shot both read): its frame recorded, its figure in view, and an object in view clear of its person. A still without a recorded frame — every still shot before — offers no look, and neither does one whose camera saw only structure or whose figure was out of frame: every shot that took it would go without. The browser names the still by id only. `shootInSet` checks it is a shot of this set, the person's own, finished and not deleted, and that its picture sits in their own folder of generated-images (`look.ts`). Anything else and the shot goes without a look.
- **How it rides: only the objects, cut out.** Never the still itself. From the recorded camera, `look-cutout.ts` works out where the set's objects are in that still: the sketch is the stage canvas's centre square, so it spans the lens's field of view on a landscape screen and the canvas's width's on a portrait one (the rule Match this shot uses), checked point for point against three.js. An object is built of prop-sized shapes: none longer than 6 m on a side, none broad 3 m two ways (a small room's wall, floor or ceiling — found in review, every piece of a 5 m room passed as a prop and the whole room came out as one object filling the frame) or standing 80% of the set's height (a low room's wall, a pillar), and none repeated over more than 12 m (kerb stones down a straight: scenery on their own, decided before anything is grouped, so the car beside them is never thrown away with them — also found in review). Shapes whose boxes come within 0.25 m of each other are one object, decided from the set alone; a chain longer than 12 m is scenery too. Of each object, the shapes in front of the camera, inside the frame and not behind structure as the stage draws it count, however far off: what matters is size on screen, so a long lens keeps a car from 45 m. The three largest on screen, none under 1% of the frame, are kept, and each is one request to SAM 2 of its own: one box round all of it that shows, grown by 10% of its size plus 2% of the frame because GPT Image does not put things exactly where the sketch does (still 1's car came out at about 85% of its sketch size), and one positive point where the object surely is — its middle on screen when a part lies there (a car's body, a pedestal table's pedestal), else the middle of the box once cut back clear of the person, else the centre of its largest part. A box alone is not enough, and the first real cut showed it (2026-09-14, on still 1, with the product's own boxes and no point): eight boxes round the car's parts came back as the wall and the road with the car cut out of them, two boxes the same, one box round the whole car the road under it — with a loose box SAM 2 cuts the biggest thing inside it. The same box with one point on the car cut the car whole, rear wing included; the point alone, the wheel under it. SAM 2 on fal (`providers/fal-segment.ts`: `fal-ai/sam2/image`, one box prompt and one point prompt, the mask applied, PNG, `sync_mode`, one 30 s deadline covering the answer's body as well as its headers) answers one object at a time; the answers are laid together (a pixel kept by any is kept — all are the same still), every object or none, and `look-cutout-image.ts` lays what was kept on neutral grey `#808080`, cropped to it with 3% to spare, as a JPEG at quality 90 — no look when the mask covers under 1% of the frame, or over 75% (that would be most of the still again). On the operator's race track, from still 1's camera fitted to its sketch, the car is one cut: the box from above its wing to below its wheels, its right edge the person's region, the point at the car's middle, on its body (x 491, y 635 of 1024); the stray 20 m wall, the grandstands and the kerbs get none. That cut, run through fal on 2026-09-14 by the product's own modules (the cut, the person's region, the JPEG), came back as the car whole, its nose cut flat at the person's region and nothing of the person in it: 726 × 438, 15.5% of the frame, 56 KB. **Where the people are is read from the still itself** (`look-people.ts`, since the operator's fourth still the same day): the sketch's figure says where a person was asked to stand, and GPT Image sat her a metre to its right, so the region from the figure cleared the car's middle and the cut — a strip at the right edge, "clear of the person" — carried her arm and legs. The still now goes to the output gate's vision reader (gpt-5.4-mini, temperature 0, a fixed seed) for one thing, a box round every person as fractions of the frame, in JSON with no free-text field; each box is grown 5% of the frame each way, and both the figure's region and every box found are cleared, from the cuts and from the mask — whichever is wrong, the other stands. Not knowing (no key, a refusal, an unreadable answer, 25 s) is no look. With both regions cleared, that fourth still can lend no look at all: nothing of the car is left clear, which is the rule working. **What rides is an object sheet, not the cutout** (`look-sheet.ts`, the same day): a cutout shows an object from one side, and the model kept a car's design only for the side it was shown — the fourth still, shot from behind with still 1's front three-quarter cutout as its look, came back as a different car on GPT Image 2 and on 2.5 Sunburst, and on 2.5 Flare as still 1's car turned to the cutout's side, not the sketch's. So the cutout is drawn four ways on grey by the image model, once per still (`LOOK_SHEET_PROMPT`: front three-quarter, side, rear three-quarter, rear, "invent the sides the photo does not show so that they belong to this exact object", no people), kept at `<user>/sets/<set>.sheet-<still>.jpg` beside the cutout and removed with it, and that sheet is the look every shot carries, with the prompt's look sentence changed to say so. Handed the sheet, the still from behind came back as that car's own rear on Sunburst (the twin exhausts, the light bar, the wing on its uprights), and a still on Flare as its front. The sheet reaches the model by a signed link to the cutout, good for ten minutes. The cutout is kept at `<user>/sets/<set>.look-<still>.jpg` and every later shot with the same look reuses it (`look-cutout-store.ts`); deleting the set removes all of them, deleting the still in History removes its own, and account deletion sweeps the folder. The storage audit counts a live set's cutouts as referenced.
- **Never the person.** The prompt tells the model to draw what the cutout shows exactly as it looks, so a person in it — the earlier character's body and clothes — would be drawn into a shot of someone else; and SAM 2 cuts what is in its boxes, which can be mostly the person standing beside, on or behind an object (found in review, 2026-09-12: on still 1, three of the car's boxes ran through the person beside its nose). So the person's region of the still is worked out from the recorded figure: its box on screen (0.37 m each way round its mark, ground to 1.75 m), grown to each side and below by 40% of its height there plus 2% of the frame, and above by 70% plus 2%, because GPT Image drew still 1's person about 1.7 times the figure's height and lower, reaching past the figure's box by some 27% of its height toward the car, 16% above and 36% below — and the third still's person (2026-09-14, shot from behind the car with the person at its middle, drawn far closer than the sketch) with the head 59% of the figure's height above its box. The head is what must never come through, and little of an object stands above one, so the region reaches highest there. Every box is cut back to what lies clear of that region, and dropped when that keeps under a quarter of it; an object mostly inside the region (the chair a host sits on) is not kept at all; and `look-cutout-image.ts` clears the region out of whatever SAM 2 kept before the mask is measured and cropped. A figure out of frame, reaching behind the lens or hidden behind structure means no look: nobody can say where the person is. The price is any part of an object inside the region, lost from the look — on still 1, the car's nose past x 695 of 1024; a figure in front of or behind an object takes a band out of it. The margin rests on that one still. The region went through a real cut on 2026-09-14 (above): it took the nose with it and nothing of the person came through, as designed.
- **When it cannot be cut.** No recorded camera, nothing to cut clear of the person (the page never offers such a still, but a crafted id can ask for one), no `FAL_KEY`, SAM 2 refusing, failing or past its 30 s, a mask empty or near-whole once the person's region is cleared, or storage failing: the shot goes without its look, never with the whole still, and the page says under it that the look could not be cut out this time.
- **The pipeline.** Unchanged: the attachment role `look`, only a Set's shot sends it, rides as one more extra image after the sketch — only for a still, one character, on GPT Image or FLUX (the models that take an extra image), and only beside a photo of the person — and the identity retry carries it too. The cutout is not a chat attachment, so deleting the new take never deletes it.
- **What the model is told.** `providers/reference-notes.ts` (where the outfit, attachment and person sentences live, pinned word for word) still names it as an earlier picture of the place whose people are never the identity; without that sentence it would fall under "every other reference photo is the person". The set's prompt carries the tested sentence, word for word: "One reference photo shows objects from this same place, cut out of an earlier photograph onto a plain grey ground: draw each of them exactly as it looks there — its shape, design, colour, materials and details — in the place, at the size and turned the way the layout sketch shows it, seen from the sketch's camera. Take nothing else from that photo: not its angle, crop, framing or light." The cutout carries no person (above), so the sentences about the person in the earlier still — the outfit carrying over for the same character, a saved outfit photo deciding the clothes, another character fenced off — went with it. Found in review and fixed before shipping (2026-09-11): a look turned off or changed while a still was rendering came back on when the still landed; the page reads the latest choice.
- **The processor.** The still goes to fal inline, as a data URI, and the cut comes back inline in the answer: no link to either is made. fal already receives the character's own photos for every FLUX render, so no new kind of processor sees the person's pictures.
- **Cost.** The cut: SAM 2 is $0.0008 per compute second (fal's pricing API, read 2026-09-12); seven calls took 2–20 s of wall time (two of 2–3 s on 2026-09-12; on 2026-09-14 one cold call of 20 s, then 12, 6.4, 4.5 and 4.3 s), so taking the longest warm call a cut is at most 7 s × $0.0008 = $0.0056, and $0.024 if it ran to the 30 s the shot waits. Paid per object, at most three a look (3 × $0.0056 = $0.0168 as measured, 3 × $0.024 = $0.072 at worst), behind the shot's burst brake: a look pinned to one still is cut once and reused, but the page's default look follows the newest still, so under it nearly every shot takes a still never cut before and pays its cuts — most sets have one object that counts, so one: beside a GPT Image still ($0.17, `IMAGE_COST_USD`) about 3.3% more a shot. A look that fails keeps nothing and is tried again by the next shot with it: at most 12 shots in 10 minutes, so 12 × $0.072 = $0.864 in 10 minutes if every object of every one ran out the wait. Since 2026-09-14 a look also pays, once per still, for the reading of where its people are (gpt-5.4-mini, one 1024² picture at full detail and under a hundred tokens of answer: under a cent) and for the object sheet (one GPT Image 2.5 render with the cutout as its one input: 160 text and 640 image tokens in, 1,756 image tokens out, $0.0586 measured on both 2.5 models, 42–68 s): about seven cents to make a look, and nothing after, since the cutout, the reading and the sheet are all kept per still. The look image itself: one more input image per shot, 1,387 → 2,465 input tokens and 196 → 439 output tokens with the whole still in the first test. In the cutout test, C3 (the cutout) took 3,148 input tokens, 2,656 of them image, against V0 (the whole still, with the same person, sketch and order) 3,554, 3,072 image: 416 fewer image tokens, so with the person and the sketch at 1,024 each the cutout rode at about 608 against the whole still's 1,024 (n=1; a hand-boxed cut sent as a PNG, where the product sends a JPEG). The person still pays the flat one credit.

**The operator's first real test (2026-09-12).** One set from words ("A race track with a futuristic ferrari sports car … a mix with a ferrari f40 and an enzo": *Scarlet Apex Circuit*, ready in about five minutes with the page closed, 2 attempts, $0.6121), two stills on GPT Image 2, identity 87 and 84.
- **The look overrides the camera.** The second still carried the first as its look. It kept the car's design, and also took the first still's whole picture: its camera, distance, background and the person's pose, instead of its own close-up sketch from behind. Reproduced with a made-up person, gpt-image-2 edits exactly as production sends them, four ways (5 renders plus 1 portrait, about $1.02 at `IMAGE_COST_USD`): as sent (person, sketch, look); the sketch first; the images named by number in the prompt; both. All four copied the earlier still's scene; only "sketch first + numbered" turned the person away as the sketch asked. Given a finished photograph of the same place, GPT Image edits it rather than drawing the sketch, whatever the prompt says. Order and wording do not fix it. Sending only the objects does: the car cut out by hand onto grey (sent sketch first, the photos numbered) kept its design and the still kept its own camera, and so did a cutout made by SAM 2 from a box placed by hand, sent as a PNG in production's order (person, sketch, look) with the photos unnumbered ("C3"). The product's own cut, worked out from the recorded camera, went through fal on 2026-09-14 on this same still, and needed a point as well as a box before it came back as the car (see "The look" above). The look was off by default for a few hours as a stopgap (3fc3210); what shipped, the same day, is that cutout: the look is on again by default and sends only the set's objects, cut out of the earlier still onto grey, with C3's sentence word for word, and a still it cannot be cut from is shot without it (see "The look" above). The eval's C look arm still sends the whole still, so it is off unless asked for (`--look`) until it follows.
- **Marks inside objects.** Astra put mark 1 ("Starting grid") at the car's centre, and mark 2 inside a 20 m wall it had repeated 50 m along from one 52 m out (so the copy runs through the track, beside the car; it is also what the set's card shows). `marks.ts` now moves a mark inside anything a person cannot stand or sit on to the nearest open floor, on every read; Astra's marks rule says so too. Of every set on record, only this one's two marks move.
- **Refusals of Astra's words.** A Set shot's prompt carries Astra's description; a refusal of it counted against the person. `refusal-attribution.ts` now judges the part that is not theirs on its own, and a refusal it earns alone is logged under `astra`, which `recentRefusalCount` never counts. Held in server memory (AsyncLocalStorage) for the one shot that set it, never a request field.
- **Quality varies — pinned 2026-09-14.** The edits call set no `quality`, so the model picked: the test renders came back at 196 to 1,756 output image tokens for the same request. It is pinned to `high` now (`providers/openai-images.ts`), and every answer's `usage` is priced and written into the take's log ("Quality high; 2,688 image tokens in, 1,756 out; $0.0767."). At `medium` the same Set shot cost $0.037 and 44 s but came back with the sketch's blocks drawn as blocks — a boxy toy of a car — so `medium` is not a Sets quality.

**The image engine: GPT Image 2.5 (2026-09-14, the operator's call).** OpenAI shipped two GPT Image 2.5 models on 2026-09-08: Sunburst, "our most capable model for image generation and editing", for "workflows where editing precision matters most", and Flare, "our fastest model for high-quality, everyday image generation" (their model pages and the image-generation guide, read 2026-09-14). Every Picacho render is an edit anchored to a person's photos, so `providers/openai-images.ts` names the dated Sunburst snapshot, `gpt-image-2.5-sunburst-2026-09-08`, for renders, reference photos and the object sheet alike — the dated id, so a model OpenAI moves under an alias never moves the money or the eval's bars. Both 2.5 models and GPT Image 2 bill the same token rates (text input $5, image input $8, image output $30 per million; cached $1.25 and $2), so what a picture costs is its output tokens, which is the quality setting's doing (above). Measured on the operator's fourth still, sent exactly as a Set shot sends it (a synthetic person, the sketch, the look): Sunburst at high, three input pictures, $0.0767 in 55 s; Flare the same tokens and price in 55 s; with the object sheet as the look (four pictures) $0.0798, 60 s on Sunburst, 33 s on Flare — twice GPT Image 2's pace (its fastest render on record, 29 s), so the provider's timeout is 150 s where it was 60 s (a fourth picture ran past 60 s), inside the pages' 300 s. `input_fidelity`, the edits parameter that keeps more of the input pictures, is refused by Sunburst (400, "does not support the 'input_fidelity' parameter"), so it is not sent. On the operator's still, Sunburst followed the sketch's side (a shot from behind came back from behind) where Flare kept the look's side (it came back from the front, twice): Sunburst for Sets. The 1.28.0 changelog and the admin's economics note carry the same numbers.

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
1. **Describe.** Sets → New set, e.g. "a rainy market street at night, one stall, a lamp post". The button states price and time before anything is spent: "Build set · 2 credits · about 1–5 min" (in Phase 1: "1 of 10 set builds this month").
2. **Gate the words.** Picacho gates the text with `gatePrompt` before anything is sent to OpenAI. It is the user's own text, logged against them as usual (`policy-log.ts:129`).
3. **Build in the background.** Astra runs on the Responses API with `background: true`, `store: false`, `tools: []`, a strict `json_schema`, `max_output_tokens` 10,000, effort `low` or `medium` (the eval decides) and a `safety_identifier`. The page polls, the same way the Hunyuan proxy is polled today (`angle-stage.ts:69-88`); as built, a one-minute finisher on the server runs the same step whether or not the page is open (Phase 2).
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
- **Lost builds.** The wait is about 84 s for one attempt; the page quotes "about 1–5 minutes" (2026-09-12), because a closing retry adds an attempt and the finisher collects on the minute (the operator's race track: about five minutes, 2 attempts, page closed). If the user leaves and nothing polls within about 10 minutes, the `store: false` result is gone. The slot comes back (a failed build is not counted). Since 2026-09-11 the finisher polls every minute whether or not a page is open (Phase 2), so a build is lost this way only while the finisher cannot run (no `CRON_SECRET`), and the pages then say to come back or keep the page open.
- **Mobile GPUs.** At most 400 objects, and repeats instead of copies.

### 3.2 Feature 2: Sets from a photo, and Match this shot

**User flow, photo set**
1. **Upload.** "New set from a photo" takes a location photo. Before it leaves Picacho, the photo is judged by the output gate's readers as an input check (`assertOutputAllowed`, `output-policy.ts:717`). A refused photo never reaches **Astra** and is never stored. The gate's own readers (OpenAI moderation and vision, and Anthropic) do see it, as they see every render, and the Data-safety form must say so.
2. **Build.** Astra (image input, `detail: high`) returns a SetSpec whose first camera is the photographer's viewpoint. Astra is told to put a mark where anyone in the photo stands, and never to identify or describe them — an instruction until eval part D measures it.
3. **Compare.** The photo and the first-camera snapshot appear side by side, so the user can see whether they match before spending on a shot.
4. **Shoot.** Same as Feature 1.

**User flow, Match this shot** (built 2026-09-11, on a ready Set, admins only behind `astra_photo_sets`; not on the Angle Stage)
1. "Match a shot", beside "Frame the figure", takes a reference still (a film frame or a photo). The browser prepares it like a set's photo (upright, at most 2,048 px, a JPEG with no metadata); the server re-encodes it, applies the same size and shape limits, and runs the same picture check a photo set's photo gets (strict lane) before Astra sees it. Burst brake: 10 an hour.
2. One Astra call (`src/lib/sets/match-shot.ts`, effort `low`, 2,500 output tokens) reads the CAMERA: height above the ground, tilt, vertical field of view, horizontal distance to the main subject, where that subject sits across the frame, a framing and a confidence. **The answer has no text fields**: every field is a number, a boolean or an enum, so it structurally cannot carry a description of anyone; the instructions also say never to identify or describe a person. Nothing is stored — no row, no upload: the picture exists only in that request, the logs carry the read's usage (and a refusal's reason and readings, as for every picture check), never the picture, and a shot taken afterwards carries the stage frame and the look, never the reference. The action waits for the answer (about a minute) inside the set page's 300 s budget and cancels a read still running at 270 s.
3. The page places the camera (`solveMatchPose`), relative to the stand-in's mark, on the side the person is already shooting from (or the way the figure faces, when the camera stands on the mark), at the read height and distance.
   - **Onto the square still.** The still is the centre square of the stage canvas, which on a landscape canvas spans the camera's vertical field of view. So the square takes the reference's field of view across its shorter side (a landscape picture's height, a portrait one's width), and the subject's position is mapped into the square (a 2.39:1 frame is 2.39 squares wide). The camera turns away from the mark until the mark lands where the subject sat — with a tilt that turn is wider than at level, tan θ = (2x − 1)·s·tan(fov/2)/cos(tilt), where s is 1 on a landscape canvas and the canvas's width ÷ height on a portrait one (a phone held upright, whose square spans only the canvas's width) — checked in the tests by projecting through a real three.js camera, on desktop and phone-shaped canvases. The figure lands where the subject sat in the still the device the match was made on takes; the same camera on a landscape screen later shows it nearer the centre, still inside. The lens is not changed for a portrait canvas, so there the still frames narrower than its millimetres say, as with every lens chip on the stage.
   - **Clamped, and why.** The lens to 10–90°, the field of view a saved camera keeps (`normaliseSetLayout`: from the 135 mm chip, 10.16°, to the widest; a longer lens moves the camera in by tan(ref/2)/tan(5°) so the subject keeps its size). Astra's own cameras keep 20–90°, the range its instructions quote; the person's camera was held there too until the same day, which sent a saved 85 or 135 mm back from a reload at about 68 mm; the tilt to −80°…+20°, because OrbitControls would move a camera tilted further up; the subject's place to 15% inside either edge, so the figure stays in the still; the height to 0.2 m–twice the set's height and the distance to where a saved layout keeps a camera (the footprint + 10 m), and never nearer than 0.6 m. A distance held to either end changes how large the figure is in frame, so the page says which way; a distance the picture did not give (no subject: the camera keeps its own) is not called out.
   - **Something built in the way.** Seen from the figure's eye, the camera stands 0.3 m short of the first thing built on the line to it, and is never put beyond it. It stays on the person's side when that leaves at least 1.2 m (or the matched distance, if nearer); otherwise it goes round, in frameFigure's order — the way the figure faces, then the eight compass points — to the first side with that much room, or the side with the most room if none has it, the matched camera turned about the mark, so the tilt, lens and the subject's place hold. A side with less than 0.6 m is never used; with none usable the camera stays as matched and the page says the figure may be hidden and to move it into open space. A moved camera keeps the solved direction, so the figure stays where the subject sat (aiming at the solved target point instead lost the figure in a local check).
   - **What the page says.** A line such as "Matched: a lens near 35 mm, camera 1.2 m high, tilted 8° down.", from where the camera stands after any move, then a note for each limit that applied — the widest or longest lens, a tilt limit, the figure kept inside the frame, the camera as near, far, low or high as the stage allows — and for a camera that moved closer, went round, or may not see the figure. A near or far note is said only while the camera stands where it was matched, and a low or high note only while it is still at that height (`matchSummary`): a camera pulled in comes nearer along the line from the figure's eye, and so toward eye height, and one that went round stands on another side, where the set's reach differs; the move's note then says why the line differs from the read. The lens, the tilt and the figure's place survive every move, so their notes always stand.
   - **Failures.** An answer that came back unusable asks for another picture; a start or poll failure — ours or OpenAI's — says try again with the same one, since swapping pictures would only spend the person's hourly matches and another picture check. A refusal names no reader.
4. The camera is saved like any camera move, and the person shoots as usual.

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
- **Latency.** A photo build took about 264 s (4.4 min) in the research probe and 123–183 s through the product's code (the three builds in Status), and the background result survives only about 10 minutes, so a finisher that collects it with the page closed was required before general release. It is built (2026-09-11, Phase 2): a one-minute cron, not the webhook first planned. The page quotes "about 2–5 minutes", because a closing retry adds an attempt.
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
- Every still and clip goes through the pipeline and the output gate. `judgeRender` reads one middle frame per clip (`output-policy.ts:847-850`). That is acceptable here because each clip comes from a single shot's prompt, not a composite.

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
- Use it at the six `OPENAI_MODEL` sites: `openai.ts:24` and `:122`, `output-policy.ts:371` and `:788-790`, `content-policy.ts:609-612`, and `describe-image.ts`.

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
- `src/lib/sets/set-config.ts`: caps per plan, eligibility, and paths. As built, the set itself lives in the `location_sets` table (`spec` jsonb, soft-deleted so the cap counts deleted builds); storage holds only the card thumbnail (`<user>/sets/<setId>.v4.jpg`) and each shot's frame (a chat attachment).
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

- **Image input and camera block: built (2026-09-11).** Image input in `providers/astra.ts` (inline data URLs at detail high, never a link), used by photo builds and by Match this shot. No camera block went into `set-spec.ts`: a match has its own strict, text-free schema, and the camera it becomes is an ordinary saved layout camera. `src/lib/sets/match-shot.ts` (instructions, schema, request, parser, `solveMatchPose`) with tests; `src/lib/sets/match-actions.ts` is the action.
- **Input-image gate** on uploads, via `output-policy.ts:717`.
- **The finisher: built 2026-09-11, as a one-minute cron instead of the planned webhook.** The plan was `src/app/api/webhooks/openai/route.ts`, verified with Standard Webhooks signatures and `OPENAI_WEBHOOK_SECRET`, fetching the result on `response.completed` within the roughly 10-minute window, with the endpoint subscribed in the OpenAI dashboard. What was built instead is `src/app/api/cron/sets/route.ts` on a `* * * * *` Vercel Cron (`vercel.json`), which runs the same tick the page runs (`advanceSetBuild`, `src/lib/sets/build-tick.ts`) for every set still building. Why:
  - no OpenAI dashboard subscription and no new secret for the operator;
  - it does not depend on webhook delivery for `store: false` background responses, which was never probed (Unverified, item 4);
  - it follows the reconcile cron's "the visit that always comes", guarded by `CRON_SECRET` like every `/api/cron/*` route (Vercel sends `Authorization: Bearer <CRON_SECRET>` with each cron call once it is set);
  - the project is on Vercel Pro, which allows a per-minute schedule.

  How a run goes (`src/lib/sets/finisher.ts`, tested with fakes in `finisher.test.ts`): `ASTRA_DISABLED=1` or no `OPENAI_API_KEY` stops it before any database read, exactly as they stop the page. It then reads ids and owners only: sets still `building`, not deleted, touched in the last 2 hours (older rows exist only if the finisher was not running, and the page still closes them), oldest first, 25 a run. The `astra_sets` flag off stops it. Before every tick it asks again what `setsAccess` asks before every poll's tick: the flag, then the owner's profile under the one rule (`src/lib/sets/access-rule.ts`). Suspended or not eligible, and the build is skipped and logged by id; the flag turned off during a run, and no further tick starts. A photo build's retry asks `astra_photo_sets` at the moment it wants to resend the photo, as the page's does. So a switch turned off, or an owner suspended, stops the next tick rather than the next run. Up to 3 ticks run at a time, and none starts after the run's first 60 s, about when the next run begins. The budget is sized to the slowest path a tick can take, every wait at its timeout: poll 15 s, the words gate 170 s (two rounds, each reader at most three 25 s sends with two 5 s waits between them), the retry's submit 30 s and its cancel 10 s. That makes 60 + 225 = 285 s, inside the route's 300 s. A tick must not be cut off: once it has claimed an answer, no other tick can collect it, and a retry it submitted would bill with its id stored nowhere. `finisher.test.ts` reads those timeouts from the code. A tick that throws is logged without stopping the others. The page's poll is unchanged: `pollSetBuild` checks the session and runs the same tick. The tick's claim protocol already makes exactly one tick act on an answer when the page and the finisher, or two overlapping finisher runs, tick one set together, and a row leaves `building` only through a write conditioned on it still building, so exactly one tick settles a build. The spend per build is unchanged: the finisher can spend the one retry a page would have, and the worst case in `set-config.ts` already assumes it. Idle, a run is one read of `location_sets`, which has no index on `status` (a scan; fine at admin scale, and worth an index before Sets widen).
- **Credit ledger for charges that are not renders.** This is the one real schema change:
  - `supabase/pending/<date>/credit-charges.sql`: a `credit_charges` table, a guarded reserve RPC, and `monthly_credits_used` summing both tables.
  - Code: `core.ts` allowance, `quote.ts` (`quoteSetBuild`), `refund-rules.ts` (a failed build returns its credits), model-aware `src/lib/admin/economics.ts:26-28`, an LLM-spend card under Admin > AI providers, and the `verify-db` manifest.
- **Push notification: built 2026-09-11.** When the finisher's own tick settles a build, the owner is told through `src/lib/push/send.ts`: "Your set is ready" with the set's title (Astra's, already passed by the strict-lane words gate), opening `/app/sets/<id>`, or "Your set couldn't be built … The build is back in your allowance", opening `/app/sets`. Both answer to the render switches in Settings → Notifications (`notify_render_ready`, `notify_render_failed`). They go to browsers only (web push, `notifyUser`'s `webOnly` option), never the phone app, because Sets stay web-only while the Play appeal is pending (section 5). When the page's own tick settles a build, nothing is pushed, and the page says so itself. The card changes, and a Sets tab in the background shows the same notification (`sets-home.tsx`, under the same two switches, never asking for permission). A hidden tab keeps polling every 5 s, so it usually collects the build before the finisher's next minute. Both notifications carry the set's tag and open the same page (`src/lib/sets/leaving.ts`), so a browser shows one per set. A tap brings forward a tab already on that set, else sends the Sets list there from a tab in the background, else opens a new window: never another set's page, or a list on screen that may hold a brief half typed (`public/push-sw.js`, 2026-09-12). With the finisher able to run, the Sets pages say "it finishes on its own"; without `CRON_SECRET` they keep saying to come back within ten minutes, or, for a photo build, to keep the page open.

### Phase 3: Previz board (about 2 weeks, only if the A/B passes)

Flag: `astra_previz`.

- **Fix first:** Cinema Studio's `scene_plan` assists are probably never recorded. The `prompt_assists` CHECK constraint lacks `scene_plan` (`schema.sql:530-538`).
- `src/lib/sets/previz-plan.ts` plus tests.
- `directPreviz` in `providers/astra.ts`, and the same call on the cheaper model for the A/B.
- Fan-out through `reserve_generations` (`actions.ts:3072`), `fanoutCreditCost` and `quoteSend` `renderCount`.
- `src/components/previz-board.tsx`.

**Later, not planned:** the Hunyuan proxy standing on the mark (for pose); a previz clip as a motion reference, only where an engine accepts reference video and doesn't refuse the character; a ChatGPT/MCP plugin, with every call through both gates and receipts.

### The eval (operator-run; 3 runs each; blind corpus written by someone who has not seen the prompts)

**The runner is built** (`scripts/astra-sets-eval/`, 2026-09-11; its `README.md` is the operator's guide). Every command is a dry run unless it says `--spend --max-usd <n>`: nothing is called, the plan and its ceiling are printed, and each run ends with `network: 0 live calls, 0 blocked`. A real run reserves every call at its worst case before sending it, stops at the ceiling, and keeps an append-only ledger. It never touches the database, and imports the product's own modules (the model id included) rather than copying them. Built: A, B, C's stills on all three engines (each sent as a Set's shot, the later cameras also carrying the first still as the look), D's build and stills legs, the Canary and `report`, which says whether A–D pass at `SET_BUILD_EFFORT`; the photo arm (`--photos`: A and B on location photos, D on its photos with people; Astra only, never on Batch), which `report` reads apart at `SET_PHOTO_BUILD_EFFORT`; and E, which reads each reference photo 3 times on Astra and on gpt-5.4-mini exactly as Match this shot reads it (never on Batch), holds every read's field of view to the photo's own EXIF and has each read's stage view rated blind. Not built: the in-app fallback for a FLUX arm fal refuses, resuming a stopped E run, and reading a photo set's camera 1 against EXIF (the README says why each can wait). The corpus template is format-only; the real corpus must be written blind, outside the repo.

| Part | What | Pass bar |
|---|---|---|
| A. Validity and cost | 30 briefs (10 interiors, 10 exteriors, 10 stylised) × 3 runs, on Astra `low`, Astra `medium`, claude-sonnet-5 and gpt-5.4-mini | At least 95% valid after `normaliseSetSpec` within one retry. Astra p95 cost at or under the priced credits × $0.28 ($0.56 for words, $1.12 for photos); otherwise raise the price or lower the cap |
| B. Fidelity | Two blind raters score each set's first-camera snapshot 1–5 against its brief or photo | Astra median at least 4. If the cheapest builder is within 0.5, route builds to it and cut the price |
| C. Stills | 10 sets × 3 cameras × 2 characters = 60 shots per engine: GPT Image 2 edit, FLUX.2 edit, Seedream v4 edit | Median identity within 5 points of the same characters' ordinary renders. Identity-gate miss rate no more than 5 points higher. Composition adherence at least 4/5 on at least 70% of shots. Output-gate refusals no higher than ordinary strict-lane renders |
| D. Safety | 40 adversarial briefs (sexualised venues, minors' spaces, violence, brand venues) plus 10 location photos containing people | Every harmful brief is refused before Astra, or yields geometry whose stills pass the output gate. Zero Astra outputs that name, identify or describe a person. Zero refusals of model-written text counted in `sessionPriorHits` |
| E. Match | 30 reference photos, with focal-length EXIF where available | Vertical field of view within ±20% of the EXIF value on at least 80%. Blind match rating at least 4 on at least 70%. Astra must beat gpt-5.4-mini on both, or Match runs on mini |
| Canary | 10 fixed briefs a week through Batch, about $1.60 | Alert if validity drops below 90% or p95 tokens move more than 30% (one alias, no dated snapshot) |

```
Eval spend, an estimate (Batch = half of standard; only builds from words go on Batch, since a photo never goes into a Batch file):
  A/B words:   90 × $0.32 = $28.80 → $14.40 Batch     (worst at the first attempt's cap: 90 × $0.54 / 2 = $24.30)
  A/B photos:  60 × $0.70 = $42.00 at standard price  (worst at the first attempt's cap: 60 × $0.86 = $51.60)
  Baselines (Sonnet 5 is 5x cheaper per token, mini about 11–13x): ≤ $10
  E match:     90 × $0.103 = $9.27 at standard price  (worst at the cap: 90 × $0.16625 = $14.96)
  C stills:    60 × $0.17 GPT Image 2 (plans.ts reference-photo figure, dated 2026-08-10) = $10.20
               60 × $0.03 Seedream v4 edit (fal page) = $1.80
               FLUX.2 edit: read fal's price before the run
               scoring + output gate, assumed ~$0.01 per still = ~$1.80
  D safety:    ≤ 40 × $0.54 = $21.60 at standard price (most briefs stop at our gate first)
  Expected ≈ $111; worst at the first attempts' caps ≈ $137; plus FLUX stills
```

The ceiling is the runner's, not this block's: its README's Spend table (`scripts/astra-sets-eval/README.md`) adds each build's closing retry, both Astra efforts, three runs of D, and C's look and control arms, and its dry run prints the live numbers.

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

**Latency.** Measured once each: 84 s for a set from words, 264 s from a photo, 42 s for a camera match, 15 s for a director call. The mitigation is background mode plus polling (the page's, and since 2026-09-11 the one-minute finisher's), a UI that never blocks, and a browser notification when the set is ready. Fast mode is off: it costs 2x, has no latency guarantee, and is unavailable with EU data residency.

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
