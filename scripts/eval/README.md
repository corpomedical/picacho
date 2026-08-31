# The likeness classifier's test set

`classifyRenderStyle` (src/lib/generations/providers/describe-image.ts) decides
whether an image shows a real human being. Two things act on that answer, and
both only ever act on a confident "no": the Seedance 2.5 fence, which warns
that ByteDance refuses photoreal people, and a saved character's stored
`render_style`.

The errors are not symmetrical, and that asymmetry is the whole design:

| wrong answer | what it costs |
|---|---|
| a real person called `illustrated` | the warning is SILENCED, the send goes, ByteDance refuses, the render fails and we refund |
| a mascot called `photoreal` | one warning the person can ignore |
| `null` (unsure) | the warning shows |

So the classifier is allowed to be unsure, and is not allowed to be
confidently wrong in the silencing direction.

## The set

59 images, every one of them real — this account's own character reference
photos and chat attachments as of 2026-08-31. `likeness-corpus.json` is the
manifest; `likeness-truth.json` is the hand-labelled ground truth (36
photoreal, 23 not) plus notes on the genuinely hard ones.

It contains, deliberately: photographed cartoon mascots, a photorealistic
butterfly, a welder in a full helmet with no face visible, four-panel exercise
how-tos, near-black frames, logos, garments with nobody in them, product
grids, crowds, and a lot of ordinary faces.

## What it measured (2026-08-31)

| | one-word prompt (before) | structured prompt (shipped) |
|---|---|---|
| correct | 58/59 | **59/59** |
| silenced a real person | **#28** — a welder in a helmet | **none** |
| needless warnings | none | none |
| identical on repeat runs | yes | yes |

The single miss was the expensive kind, and it is why the shipped prompt makes
the model NAME THE SUBJECT before judging it: "a welder in a helmet" is hard
to then call illustrated, where a prompt that jumps to a verdict lets a hidden
face read as equipment.

A three-sample ensemble with escalation to a stronger model was designed and
REJECTED on this evidence: repeat runs already agree 100%, so paying 3-6x to
detect disagreement that does not occur buys nothing. If a future corpus shows
real instability, that is the next step.

## Re-running it

The images are not in the repo — they are user content, and they live in the
Supabase buckets. Rebuild the corpus by downloading each manifest entry,
normalising it the way lib/attachments/actions.ts does, then call the shipped
`classifyRenderStyle` on each and compare with the truth file. Any change to
the prompt, the model, or the preprocessing should be re-scored here before it
ships, and the row that matters is "silenced a real person" — it has to stay
at zero.
