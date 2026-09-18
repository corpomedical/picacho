# The expression set

**What the operator asked for (2026-09-18):** "All Im trying to achieve is real person feature, facial structure and emotions to be 1:1 on every generation." Then: "Run and build. Draft and knock this one out of the park."

**The draft:** the Expression Set canvas (https://claude.ai/artifact/Uq4DKHZbbtBiBdDMqM43cp): the character page's new section, how a shot uses it, the phone view.

## What it is

Nine close-ups of one character, kept apart from the five photos that make the character:

| Group | Close-ups |
|---|---|
| Expressions | neutral, smile, laugh |
| Details | teeth, eyes |
| Angles | left profile, right profile, 3/4 left, 3/4 right |

Each is the person's own upload (free) or a picture Picacho made from their photos (one AI photo from the plan's monthly allowance, through the same lane as every AI character photo: allowance reserved first and refunded on any failure, the prompt gate, the picture check). Every one is scored by the product's identity scorer against photo 1; a made close-up under 80 stays on the page but never rides a render. An upload always rides, since it is the person, and the page warns if it reads as someone else.

## How a render uses it

1. The drafter, the same model that already reads every request to write the prompt, is asked one more thing when the character has a set: `FACE:` followed by the expression (neutral, smile, laugh, serious, other) and the angle (front, three-quarter, profile, back, unseen) the finished picture shows, judged by what the request means, never by a word list.
2. `pickSetForShot` turns that into close-ups: a smile gets the smile and the teeth, a laugh the laugh and the teeth, a profile both profiles, a three-quarter both three-quarters, then the face at rest for structure. At most three ride. No read sends the face at rest and the teeth. No face in the picture sends nothing.
3. They ride right after photo 1, before any outfit, prop, look or place photo, with one sentence saying what they are and that the teeth, lips and expression must be exactly those in the close-ups.
4. The render's History line says which rode and how the face was read.

Only on a single-character image anchored to the character's own saved photo. An attached photo is that message's face.

## Why teeth come first

A character's photos may never show the teeth, and an image model invents what no reference shows, a new set every time. The teeth close-up is made once, and the smile and the laugh are made from it, so the whole set shares one mouth.

## What was measured (2026-09-18, one AI-made character, $4.97 all told)

(Round 1 $1.8532, round 2 $1.4314, round 3 $1.4166 plus $0.2696 to judge it again after dropped connections, each from the answers' own usage; at most one more picture, about $0.08, may have been billed on a connection that dropped before it answered.)

Four photos of the character from the operator; photo 1 is what the product sends today, and one photo was held back as the fair judge, since a render copies whatever reference it was given.

**Round 1: one sheet of every view vs today.** 7 scenes × 3 setups, judged against the held-out photo:

| Setup | Likeness | $/render |
|---|---|---|
| Photo 1 alone (today) | 88.8 | 0.0611 |
| The sheet alone | 83.6 | 0.0653 |
| 3 photos + the sheet | 87.5 | 0.0979 |

The sheet drew the same profile twice, and the renders made from it faced the same wrong way. The one sheet failed hardest on the profile shot (47.5). **Never one sheet: separate close-ups.**

**Round 2: separate close-ups, checked, matched.** All eight made from two of her photos kept her likeness (86.5–95.5 against the held-out photo; her real photos read 90.5–95), and the profiles came out both ways once named by where the nose points. Matched renders: 88.1, a tie with today within the judge's own swing (5.5 points between two readings of one picture).

**Round 3: consistency, the thing asked for.** A smiling close-up and a laughing medium shot, four renders each, today vs the set, with a teeth/lips/expression judge and every pair of renders compared:

| | Likeness | Teeth vs set | Expression vs set | Same teeth across renders |
|---|---|---|---|---|
| Smile, today | 93.1 | 89.0 | 88.5 | 96.7 |
| Smile, set | 93.1 | 89.6 | 92.1 | 95.9 |
| Laugh, today | 93.9 | 92.0 | 91.6 | 94.3 |
| Laugh, set | 92.4 | 86.3 | 87.3 | 94.0 |

On stills, this character's teeth were already consistent from photo 1 alone. Her photos show none, so the model falls back on the same default teeth every time, and at full resolution the eye agrees. The set did not move that. It raised the smile's expression match, kept likeness equal, and ended the copying of photo 1's pose: today's four "smiles" were one selfie four times, the set's were four real angles.

**Not measured, and where the reported drift most likely lives:** video (mouths in motion), wide shots (a face a few dozen pixels across), and real people whose teeth are their own. For a real person, only a real photo of their smile carries their real teeth: the page says so.

## Cost

A close-up is one AI photo from the plan's allowance (measured $0.0736 each to make). A render carrying three close-ups: $0.0857 against $0.0611 for photo 1 alone (1,024 → 4,096 input image tokens at $8 a million, openai-images.ts), still under the $0.17 an image credit is priced on.

## Where it lives

- `src/lib/characters/expression-set.ts`: the slots, the prompts, the one door for the stored set, the likeness floor, the FACE read and `pickSetForShot`.
- `src/lib/characters/expression-set-store.ts`: the only module that names `character_profiles.expression_set`.
- `src/lib/characters/expression-actions.ts`: make, upload, remove. Nothing is spent before the set is known to be writable.
- `src/components/expression-set-panel.tsx`: the section on the character page.
- `supabase/pending/character-expression-set.sql`: the column and the ownership trigger reaching it. The code runs without it.

## Next

1. The operator runs the SQL, makes a set for a character, and shoots the same smiling and laughing shots as round 3 in the product: the History line shows which close-ups rode.
2. Video: Kling elements and Seedance take four references. Give them photo 1 plus the set's picks instead of the first four photos, and the opening frame (opening-frame.ts) a still made with the set.
3. The face-detail pass for wide shots: redraw the face region at full size with the set.
4. The per-character trained model, if 1:1 has to mean guaranteed: priced and decided separately.
