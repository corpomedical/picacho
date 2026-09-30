// The identity scorer's words and the reading of its answer (scorer p3,
// 2026-09-30). Alias-free and pure so both are tested on their own;
// providers/openai.ts sends them.
//
// WHY P3. The operator's rooftop picture of Eva (history 5c348c0e, Nano
// Banana Pro, full body) was a different woman — rounder face, fuller
// cheeks, another nose — and p2 scored it 96. p2 asked how convincingly the
// picture showed "the same person", listed the character's saved traits
// ("copper-red hair, freckles, hazel-green eyes") and weighed face and HAIR
// most, so any freckled redhead with green eyes passed. A test set that day
// (23 pictures, scored against Eva's saved photo): her own saved photos and
// close-ups 85–98 under p2, and seven lookalikes drawn from her trait words
// alone 81–94. Nothing separated them.
//
// What p3 asks instead, each part measured on that set:
//   - the FACE DESIGN of a character: its facial structure, feature by
//     feature. Hair, freckles, skin tone, eye colour and the rest are named
//     as never raising the score. No trait summary is sent: the words are
//     the look every lookalike shares.
//   - several reference pictures of the character (up to three), not one.
//   - a character's face, never "verification of a real person": gpt-5.5
//     REFUSED that wording on 14 of 66 readings ("I can't help verify
//     whether two face images show the same person"), which would have left
//     pictures unscored. The character wording: 0 refusals in 220 readings.
// Result on the same set with gpt-5.5 and three references (three runs):
// Eva's photos 76–100, close-up lookalikes 38–62, full-body lookalikes
// 66–84. Small faces in a full-body shot are still the hard case: the
// rooftop read 66–78, one full-body lookalike 70–84, while Eva's lowest
// photo read 76–82.
//
// It also asks where the face is (faceBox), which costs nothing extra in the
// same call and tells the caller how small the face was.

/** The most reference pictures one reading carries. */
export const IDENTITY_MAX_REFERENCES = 3;
/** A reading's ceiling on answer tokens: the longest seen on the p3 test set was 583 (median 396). */
export const IDENTITY_MAX_ANSWER_TOKENS = 1500;
/**
 * How long one reading may take. gpt-5.5 answered in ~14 s (median) with
 * three references on the p3 test set; the identity gate's clock
 * (identity-gate-run.ts) leaves room for this whole timeout.
 */
export const IDENTITY_TIMEOUT_MS = 40_000;

export type IdentityPromptInput = {
  /** How many reference pictures precede the new one (1–3). */
  references: number;
  /** The new picture may hold several people: judge the one most like the character. */
  severalPeople?: boolean;
  /** Language for the one sentence in `notes`, e.g. "Español". Absent = English. */
  notesLanguage?: string;
};

export function identityScorePrompt(input: IdentityPromptInput): string {
  const n = Math.min(IDENTITY_MAX_REFERENCES, Math.max(1, Math.round(input.references)));
  const opening =
    n > 1
      ? `The first ${n} images are saved reference pictures of one character. The last is a new picture meant to show that same character. `
      : "The first image is the saved reference picture of a character. The second is a new picture meant to show that same character. ";
  return (
    opening +
    (input.severalPeople
      ? "The new picture may hold other people too: judge the one whose face is most like this character's, and give that face's box. "
      : "") +
    "Score 0-100 how faithfully the new picture reproduces this character's FACE DESIGN (as the references show it): the specific facial structure that tells this character apart from other characters who share the same general look. " +
    "Hair colour and style, freckles, skin tone, eye colour, apparent age, makeup, expression, clothing, lighting, pose and setting are shared by many different characters or change from picture to picture: they must never raise the score. " +
    "Compare the facial structure feature by feature, allowing for angle, expression and lighting: overall face shape and width, jaw and chin, cheekbones and cheeks, forehead, eye shape, size and spacing, eyelids, brow shape and position, nose (bridge, width, tip, nostrils), lips and mouth shape, and the proportions between them. " +
    "Scale: 90-100 this character's face, unmistakably; 75-89 this character's face with small differences that angle or expression explain; 50-74 resembles the character but at least one structural feature is off, so it reads as a lookalike; 25-49 a different face of the same general type; 0-24 clearly a different face. " +
    "Set faceVisible to false when too little of the face in the new picture can be seen to judge its structure (from behind, turned away, covered, too small or blurred). Set unusable to true only for a blank, black or corrupted image. " +
    "Also give faceBox: the tight box round the judged face in the new picture (hairline to chin, ear to ear) as [ymin, xmin, ymax, xmax] on a 0-1000 scale of that picture, or null when no face shows. " +
    'Reply with ONLY minified JSON: {"faceBox": <[ymin,xmin,ymax,xmax] or null>, "score": <integer 0-100>, "notes": "<one short sentence naming the facial features that differ, or an empty string>", "unusable": <true|false>, "faceVisible": <true|false>}' +
    (input.notesLanguage ? ` Write the "notes" sentence in ${input.notesLanguage}.` : "")
  );
}

/** [ymin, xmin, ymax, xmax] on a 0–1000 scale of the scored picture. */
export type FaceBox = readonly [number, number, number, number];

export type IdentityReading = {
  score: number;
  notes: string;
  unusable: boolean;
  faceVisible: boolean;
  faceBox: FaceBox | null;
};

/** A box only when it is four in-range numbers with a real area; anything else is no box. */
export function parseFaceBox(raw: unknown): FaceBox | null {
  if (!Array.isArray(raw) || raw.length !== 4) return null;
  const v = raw.map((x) => Number(x));
  if (v.some((x) => !Number.isFinite(x) || x < 0 || x > 1000)) return null;
  const [ymin, xmin, ymax, xmax] = v;
  if (ymax <= ymin || xmax <= xmin) return null;
  return [ymin, xmin, ymax, xmax];
}

/** How tall the face is, as a share of the picture's height (0–1), or null with no box. */
export function faceHeightShare(box: FaceBox | null): number | null {
  return box ? (box[2] - box[0]) / 1000 : null;
}

/** The scorer's reply, bounded; null when it is not a usable reading. */
export function parseIdentityReply(text: string | undefined | null): IdentityReading | null {
  const match = text?.match(/\{[\s\S]*\}/);
  if (!match) return null;
  let parsed: { score?: unknown; notes?: unknown; unusable?: unknown; faceVisible?: unknown; faceBox?: unknown };
  try {
    parsed = JSON.parse(match[0]);
  } catch {
    return null;
  }
  const score = Math.round(Number(parsed.score));
  if (parsed.score === null || !Number.isFinite(score) || score < 0 || score > 100) return null;
  return {
    score,
    notes: typeof parsed.notes === "string" ? parsed.notes.slice(0, 300) : "",
    unusable: parsed.unusable === true,
    // Only an explicit false counts (p2's rule, kept): a reply that leaves it
    // out is read as a face that was seen and scored.
    faceVisible: parsed.faceVisible !== false,
    faceBox: parseFaceBox(parsed.faceBox),
  };
}

/**
 * Several readings of ONE picture made into one (scorer p3). A single
 * gpt-5.5 reading of the same picture moved by a median of 4 points and up
 * to 14 across three runs on the test set, enough to put a lookalike above
 * one of Eva's own photos in one run of three; the mean of two readings kept
 * every one of Eva's photos above every lookalike in all three pairings.
 *
 *   score        the mean of the readings that saw a face (all of them when none did)
 *   faceVisible  true when any reading saw a face to judge
 *   unusable     only when every reading says so (it auto-fails and refunds a render)
 *   notes        the lowest-scoring reading's: it names what differs
 *   faceBox      the first reading that gave one
 */
export function combineIdentityReadings(readings: readonly (IdentityReading | null)[]): IdentityReading | null {
  const valid = readings.filter((r): r is IdentityReading => r !== null);
  if (valid.length === 0) return null;
  const seen = valid.filter((r) => r.faceVisible);
  const counted = seen.length > 0 ? seen : valid;
  const lowest = counted.reduce((a, b) => (b.score < a.score ? b : a));
  return {
    score: Math.round(counted.reduce((sum, r) => sum + r.score, 0) / counted.length),
    notes: lowest.notes,
    unusable: valid.every((r) => r.unusable),
    faceVisible: seen.length > 0,
    faceBox: valid.find((r) => r.faceBox !== null)?.faceBox ?? null,
  };
}
