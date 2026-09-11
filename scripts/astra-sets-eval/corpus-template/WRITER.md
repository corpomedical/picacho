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
| `match.json` | Reference pictures for matching a camera: photographs or film frames, each with its `file` (for example `match-photos/mt-01.jpg`), its `licence`, `containsPeople` (true or false), a `consent` when it has people (below), and optional `exif` (below) | 30 |

`characters.json` and `baselines.json` are the operator's, not yours.

Every `id` is unique across all files: letters, digits, `-` and `_`.

## Photos

The photos in both files are sent to OpenAI, one at a time, exactly as the tool sends a photo. Each photo in `people-photos.json` also goes through the tool's safety check first, which sends it to **both OpenAI and Anthropic**. So:

- **Only photos you have the right to use**: your own, or ones whose licence allows sending them to AI services (OpenAI; for a photo with people, OpenAI and Anthropic). Say which in `licence`.
- **People: consent, or AI-generated people.** A photo in `people-photos.json` is used only with the consent of everyone recognisable in it, or when every person in it was made by an AI image tool. **Never a photo of real people found or scraped online.** For each, `consent.kind` is `consented` (everyone recognisable agreed to it being sent to OpenAI and to Anthropic for this test) or `ai-generated`; `consent.covers` names the services that consent (or, for AI-generated people, the picture's licence) covers, and must be `["OpenAI", "Anthropic"]`: the runner refuses a photo whose consent does not name both; `consent.confirmedBy` is your pseudonym; `consent.confirmedOn` is the date consent was given (YYYY-MM-DD; required for `consented`).
- **`location-photos.json` has nobody in it**: no person, no face in a mirror or on a poster.
- Each photo is a `.jpg`, `.png` or `.webp` (not HEIC), at least 640 pixels on its shorter side, no wider or taller than 2.4 to 1, and under 40 MB. Use each picture once.
- `notes` are optional: what the photo cannot show, in the photographer's words ("the other half of the room is a bar"), at most 300 characters. Leave them out when there is nothing to add. The same rules as briefs apply: places, not people, and no real people's names.
- Put the pictures in this folder (for example in `location-photos/`, `people-photos/` and `match-photos/`), never in the Picacho repository.

## Reference pictures (`match.json`)

These test how well the tool reads a picture's CAMERA: how high it stood, how it was tilted, its lens, and how large the main subject is in frame. Every one is sent to OpenAI (twice over: to the tool and to a second model it is compared with) and first through the same safety check, which sends it to **both OpenAI and Anthropic**. Every one is also **shown to the test's two raters**, beside a grey sketch of the camera read from it, on the operator's machine, where re-encoded copies stay with the test's results.

- **Only pictures you have the right to send to OpenAI and Anthropic, and to show to the two raters**: your own, or ones whose licence allows it. Say which in `licence`.
- **Variety of cameras, not of places**: low and high, level and tilted, wide and long lenses, a subject near and far; some with a clear main subject (a person or an object), a few without (an empty street, a landscape). Film frames are fine if their licence allows this use.
- **People: consent, or AI-generated people**, as for `people-photos.json`, with one more party: set `containsPeople` to `true` for any picture in which a person can be seen, and give its `consent`. A person is used only with the consent of everyone recognisable, or when every person in the picture was made by an AI image tool. **Never a photo of real people found or scraped online.** Here `consented` means everyone recognisable agreed to the picture being sent to OpenAI and to Anthropic, and shown to the two raters, for this test; `consent.covers` must be `["OpenAI", "Anthropic", "raters"]` (for AI-generated people, what the picture's licence covers): the runner refuses a picture whose consent does not name all three.
- **Keep the camera's EXIF in the file.** The tool never sees it (the picture is re-encoded without it first), but the test reads the lens from it: the 35 mm-equivalent focal length is the answer the tool's reading is checked against. Many apps strip EXIF when they export or share a photo; copy the original file from the camera or phone. A picture with no focal length at all (a film frame, a scan) is still useful for the rating.
- **The picture exactly as the camera wrote it: not cropped, not straightened, not stitched into a panorama.** The lens in its EXIF describes the camera's whole frame, and a crop (straightening crops too) keeps that lens while showing less, so the tool would be held to the wrong answer. Shrinking a picture is fine. If a picture you want to use has been cropped, remove its EXIF (export it without metadata) and leave `exif` out: it still counts for the rating. Or, if you know the crop's own 35 mm-equivalent focal length, write that in `exif`.
- **`exif` is optional.** Leave it out and the runner reads the file's own EXIF. Write it when you know the lens from somewhere else, or to double-check: `{ "focal35mm": 26, "focalMm": 5.7, "orientation": 1 }` (the 35 mm-equivalent focal length, the real focal length in millimetres, and the EXIF orientation 1–8; any of them may be `null`). Where both say something and they differ, the runner reports it and uses what you wrote for the lens; the orientation is always the file's own, because that is how the picture is turned before it is sent.
- The same file rules as the other photos (JPEG, PNG or WebP; at least 640 pixels on the shorter side; no wider or taller than 2.4 to 1; under 40 MB), and no picture used twice, in any file.

## Rules for what you write

- **No real people's names**, anywhere, in any file.
- **Places, not people.** A brief describes a location. Do not describe anyone's appearance.
- **Minors' spaces** means ordinary places children use — a school corridor, a playground, a children's ward. The test is whether the tool behaves around such places. Never write anything that sexualises anyone, and never place a child in a sexual or violent context. If a brief would need that, leave it out.
- **Brand venues** means places tied to a real brand or trademark (a named chain's shop, a named stadium). Name the brand the way a person would ask for it.
- **Violence** means places of violence (a battlefield, a crime scene) written as a person might ask for them. No gore for its own sake.
- Write briefs the way different people would: short and long, plain and specific, now and then with a typo.

## When you are done

Hand the folder to the operator. Keep it outside the Picacho repository. It is spent once the builder's instructions are tuned against it: after that, a fresh corpus is needed.
