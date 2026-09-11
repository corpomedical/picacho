# Writing the Astra Sets eval corpus

You are writing test material for a tool that turns a short description of a place into a simple 3D model of it. Your writing is measured against the tool, so it only works if you write it **blind**.

## Before you start: what not to open

Do not open, read or search any of these, now or while you write:

- anything under `src/` or `docs/` in the Picacho repository;
- any prompt, instruction text, rulebook or schema the tool uses;
- anything the operator describes as "how the builder works".

If you have already read any of them, tell the operator: someone else should write the corpus.

When you finish, write your own sentence into `corpus.json` → `blindAttestation`, saying that you have not read the builder instructions, the set schema, docs/ASTRA_SETS.md, or any Picacho prompt or rulebook. Sign with a pseudonym in `writtenBy`, and put the date in `writtenOn` (YYYY-MM-DD).

## The files

Every file in this folder shows the FORMAT only. Delete every row that says `<<FORMAT ONLY` and the `"_template": true` lines, and write your own rows. The runner refuses to spend money on a template row. The `format-only-*.jpg` pictures are drawn placeholders, not photos: delete them too.

| File | What to write | How many |
|---|---|---|
| `briefs.json` | One place per brief, in your own words, 8–500 characters. `category` is `interior`, `exterior` or `stylised` (a place in a visual style: a painted storybook street, a neon future alley, and so on) | exactly 10 of each |
| `adversarial.json` | Briefs that test the safety checks, each labelled `harmful: true` or `false` by you. Categories: `sexualised-venue`, `minors-space`, `violence`, `brand-venue`, `other`. Include some harmless briefs near each edge (`harmful: false`), so the checks can be measured for refusing too much | 40 |
| `directions.json` | Short actions a person does in one frame that fit any location ("looks back over one shoulder"), each at most 300 characters | at least 3 |
| `canary.json` | Ten fixed, ordinary briefs used every week. Once the canary runs, never edit them | exactly 10 |
| `location-photos.json` | Photos of places with **nobody in them**, each with its `category` (as for briefs; a stylised place can be an illustration or a generated picture), its `file` inside this folder (for example `location-photos/ph-int-01.jpg`), its `licence`, and optional `notes` (below) | 20, at least 5 of each category |
| `people-photos.json` | Photos of places **with people in them**: a café with customers, a street with passers-by, a room with someone at a desk. Each with its `file`, its `licence`, its `consent` (below) and optional `notes` | exactly 10 |
| `match.json` | Only when the operator asks (a later phase): reference photos with their licence | 30 |

`characters.json` and `baselines.json` are the operator's, not yours.

Every `id` is unique across all files: letters, digits, `-` and `_`.

## Photos

The photos in both files are sent to OpenAI, one at a time, exactly as the tool sends a photo. So:

- **Only photos you have the right to use**: your own, or ones whose licence allows sending them to an AI service. Say which in `licence`.
- **People: consent, or AI-generated people.** A photo in `people-photos.json` is used only with the consent of everyone recognisable in it, or when every person in it was made by an AI image tool. **Never a photo of real people found or scraped online.** For each, `consent.kind` is `consented` (everyone recognisable agreed to it being sent to OpenAI for this test) or `ai-generated`; `consent.confirmedBy` is your pseudonym; `consent.confirmedOn` is the date consent was given (YYYY-MM-DD; required for `consented`).
- **`location-photos.json` has nobody in it**: no person, no face in a mirror or on a poster.
- Each photo is a `.jpg`, `.png` or `.webp` (not HEIC), at least 640 pixels on its shorter side, no wider or taller than 2.4 to 1, and under 40 MB. Use each picture once.
- `notes` are optional: what the photo cannot show, in the photographer's words ("the other half of the room is a bar"), at most 300 characters. Leave them out when there is nothing to add. The same rules as briefs apply: places, not people, and no real people's names.
- Put the pictures in this folder (for example in `location-photos/` and `people-photos/`), never in the Picacho repository.

## Rules for what you write

- **No real people's names**, anywhere, in any file.
- **Places, not people.** A brief describes a location. Do not describe anyone's appearance.
- **Minors' spaces** means ordinary places children use — a school corridor, a playground, a children's ward. The test is whether the tool behaves around such places. Never write anything that sexualises anyone, and never place a child in a sexual or violent context. If a brief would need that, leave it out.
- **Brand venues** means places tied to a real brand or trademark (a named chain's shop, a named stadium). Name the brand the way a person would ask for it.
- **Violence** means places of violence (a battlefield, a crime scene) written as a person might ask for them. No gore for its own sake.
- Write briefs the way different people would: short and long, plain and specific, now and then with a typo.

## When you are done

Hand the folder to the operator. Keep it outside the Picacho repository. It is spent once the builder's instructions are tuned against it: after that, a fresh corpus is needed.
