// The expression set (operator, 2026-09-18: "All Im trying to achieve is
// real person feature, facial structure and emotions to be 1:1 on every
// generation." → "Run and build. Draft and knock this one out of the park.").
//
// WHAT IT IS. Nine close-ups of one character, kept apart from the five
// photos that make the character (reference_image_urls): the face at rest,
// the teeth, the smile, the laugh, the eyes, both profiles and both
// three-quarter views. Each is the person's own upload or a picture Picacho
// made from their photos. A render sends the ones its shot needs beside
// photo 1 (pickSetForShot): a laugh gets the laugh and the teeth, a profile
// gets the profiles.
//
// WHY THE TEETH COME FIRST. A character's photos may never show the teeth,
// and an image model invents whatever a reference does not show. So the
// teeth close-up is made once and the smile and the laugh are made FROM it
// (chainsFromTeeth): the whole set shares one mouth. Round 2 of the test
// made each close-up separately — three inventions of the same teeth.
//
// WHAT WAS MEASURED (2026-09-18, one AI-made character, GPT Image 2.5, the
// product's own identity scorer plus a teeth-and-expression judge):
//   · one sheet of every view in one picture scored 83.6 against a photo it
//     never saw, photo 1 alone 88.8, and it drew the same profile twice —
//     separate close-ups, never a sheet;
//   · every close-up made here from her photos kept her likeness (86.5–95.5
//     against the held-out photo; her real photos read 90.5–95);
//   · on stills her teeth were ALREADY consistent from photo 1 alone (94–97
//     "the same teeth" between renders): the set did not move that. It
//     raised the smile's expression match 88.5 → 92.1, kept likeness equal
//     (93.1), and ended photo 1's pose being copied into every shot.
//   Untested: video, wide shots, real people — where drift was reported.
//
// Pure and client-safe, relative imports only: the pipeline, the actions,
// the page and the tests all read it as it is.

export const EXPRESSION_SLOTS = [
  "neutral",
  "teeth",
  "smile",
  "laugh",
  "eyes",
  "profile-left",
  "profile-right",
  "three-quarter-left",
  "three-quarter-right",
] as const;
export type ExpressionSlot = (typeof EXPRESSION_SLOTS)[number];

export function isExpressionSlot(value: unknown): value is ExpressionSlot {
  return typeof value === "string" && (EXPRESSION_SLOTS as readonly string[]).includes(value);
}

/** How the page groups them (the draft, board 1). */
export const EXPRESSION_SLOT_GROUPS: readonly { id: "expressions" | "details" | "angles"; slots: readonly ExpressionSlot[] }[] = [
  { id: "expressions", slots: ["neutral", "smile", "laugh"] },
  { id: "details", slots: ["teeth", "eyes"] },
  { id: "angles", slots: ["profile-left", "profile-right", "three-quarter-left", "three-quarter-right"] },
];

/** The order a whole set is made in: the teeth before anything that smiles. */
export const EXPRESSION_BUILD_ORDER: readonly ExpressionSlot[] = [
  "neutral",
  "teeth",
  "smile",
  "laugh",
  "eyes",
  "profile-left",
  "profile-right",
  "three-quarter-left",
  "three-quarter-right",
];

/** The close-ups made FROM the teeth close-up, so every smile has the same teeth. */
export function chainsFromTeeth(slot: ExpressionSlot): boolean {
  return slot === "smile" || slot === "laugh";
}

// The words each close-up is made from — text for the image model, so
// English, like every fixed prompt block. The profiles are named by where
// the nose points in the PICTURE, not by "left" alone: the sheet that asked
// for "left profile, right profile" drew the right one twice (round 1), the
// same words by the nose came out both ways (round 2).
const EXPRESSION_SLOT_PROMPTS: Record<ExpressionSlot, string> = {
  neutral:
    "A close-up portrait of this exact person facing the camera straight on: relaxed, neutral expression, mouth closed, eyes open. Head and shoulders fill the frame. Even, soft studio light on a plain light-grey background.",
  teeth:
    "An extreme close-up of this exact person's mouth in a smile, lips parted to show the teeth, framed from the tip of the nose to the chin. Even, soft studio light.",
  smile:
    "A close-up portrait of this exact person facing the camera straight on, with a broad, natural smile that shows their upper teeth. Head and shoulders fill the frame. Even, soft studio light on a plain light-grey background.",
  laugh:
    "A close-up of this exact person in three-quarter view, their nose pointing toward the left edge of the picture, laughing openly with their teeth showing and their eyes creased. Even, soft studio light on a plain light-grey background.",
  eyes:
    "An extreme close-up of this exact person's eyes and eyebrows looking into the camera, framed from the forehead to the tip of the nose: eye colour, lashes, brows, freckles and skin texture in sharp detail. Even, soft studio light.",
  "profile-left":
    "A head-and-shoulders profile of this exact person seen from their left side: their nose points to the LEFT edge of the picture and their left ear faces the camera. Relaxed expression, mouth closed. Even, soft studio light on a plain light-grey background.",
  "profile-right":
    "A head-and-shoulders profile of this exact person seen from their right side: their nose points to the RIGHT edge of the picture and their right ear faces the camera. Relaxed expression, mouth closed. Even, soft studio light on a plain light-grey background.",
  "three-quarter-left":
    "A close-up of this exact person in three-quarter view, their nose pointing toward the left edge of the picture, with a relaxed expression and the mouth closed. Head and shoulders fill the frame. Even, soft studio light on a plain light-grey background.",
  "three-quarter-right":
    "A close-up of this exact person in three-quarter view, their nose pointing toward the right edge of the picture, with a relaxed expression and the mouth closed. Head and shoulders fill the frame. Even, soft studio light on a plain light-grey background.",
};
const KEEP_EVERY_FEATURE =
  " Keep every feature exactly as it is in the photos — face shape, eyes and eye colour, eyebrows, nose, lips, freckles, skin, hairline and hair. No text.";
const SAME_TEETH =
  " Their teeth, lips and smile are exactly those in the close-up of their mouth: the same teeth — shape, size, spacing, alignment and colour — and the same lips.";

/** What one close-up is made from. `withTeeth`: the set's teeth close-up rides as a reference. */
export function slotPrompt(slot: ExpressionSlot, opts: { withTeeth: boolean }): string {
  return EXPRESSION_SLOT_PROMPTS[slot] + KEEP_EVERY_FEATURE + (chainsFromTeeth(slot) && opts.withTeeth ? SAME_TEETH : "");
}

// ---- the stored set ----

export type ExpressionSlotEntry = {
  /** The storage path in character-references, always inside the owner's folder. */
  path: string;
  /** "upload": the person's own photo. "made": Picacho made it from their photos. */
  source: "upload" | "made";
  /** The product's identity scorer against photo 1, 0–100; null when it could not read. */
  likeness: number | null;
  at: string;
};
export type ExpressionSet = Partial<Record<ExpressionSlot, ExpressionSlotEntry>>;

/**
 * The one door a stored set comes through (expression-set-store.ts reads the
 * column, the page and the render read this). Anything malformed is dropped,
 * and so is any path outside the owner's own folder: a direct PostgREST write
 * could plant another person's path, and the page would sign it.
 */
export function normaliseExpressionSet(raw: unknown, ownerId: string): ExpressionSet {
  const out: ExpressionSet = {};
  if (!raw || typeof raw !== "object" || Array.isArray(raw) || !ownerId) return out;
  for (const [slot, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!isExpressionSlot(slot) || !value || typeof value !== "object") continue;
    const v = value as Record<string, unknown>;
    if (typeof v.path !== "string" || !v.path.startsWith(`${ownerId}/`) || v.path.includes("..") || v.path.length > 400) continue;
    const source = v.source === "upload" ? "upload" : v.source === "made" ? "made" : null;
    if (!source) continue;
    const likeness =
      typeof v.likeness === "number" && Number.isFinite(v.likeness) && v.likeness >= 0 && v.likeness <= 100
        ? Math.round(v.likeness * 10) / 10
        : null;
    out[slot] = { path: v.path, source, likeness, at: typeof v.at === "string" ? v.at.slice(0, 40) : "" };
  }
  return out;
}

/**
 * A close-up Picacho made that reads under this against photo 1 stays on the
 * page but never rides a render: it would teach the render a different face.
 * The real photos read 90.5–95 against a photo none of them was given, and
 * the scorer swings 5.5 points between two readings of one picture — 80
 * keeps every close-up measured on 2026-09-18 (86.5 and up) and stops one
 * that has drifted. A photo the person uploaded is always used: it is them.
 */
export const EXPRESSION_SET_LIKENESS_FLOOR = 80;

export function isUsable(entry: ExpressionSlotEntry | undefined): boolean {
  if (!entry) return false;
  if (entry.source === "upload") return true;
  // Unread (the scorer was down) is not a failed reading: the picture check
  // still passed it, so it is used, and the page says it is unchecked.
  return entry.likeness === null || entry.likeness >= EXPRESSION_SET_LIKENESS_FLOOR;
}

export function usableSlots(set: ExpressionSet): ExpressionSlot[] {
  return EXPRESSION_SLOTS.filter((slot) => isUsable(set[slot]));
}

// ---- matching a shot ----

export const FACE_EXPRESSIONS = ["neutral", "smile", "laugh", "serious", "other"] as const;
export const FACE_ANGLES = ["front", "three-quarter", "profile", "back", "unseen"] as const;
export type FaceExpression = (typeof FACE_EXPRESSIONS)[number];
export type FaceAngle = (typeof FACE_ANGLES)[number];
export type FaceRead = { expression: FaceExpression; angle: FaceAngle };

/**
 * What the drafter is asked, when the character has a set (pipeline.ts). The
 * drafter already reads the whole request to write the prompt; this asks it
 * to NAME the face the finished picture shows, judged from what the request
 * means — the operator's standard for anything that sorts a request: never
 * a list of words ("meaning, not features").
 */
export const FACE_LINE_INSTRUCTION =
  `Then, on its own new line, write exactly "FACE:" followed by two words: how the person's face looks in the finished ` +
  `picture — one of ${FACE_EXPRESSIONS.join(", ")} — and the angle it is seen from — one of ${FACE_ANGLES.join(", ")}. ` +
  `Judge both from what the request means, not from the words it happens to use; write "other unseen" when no face is in the picture.`;

/** "laugh three-quarter" → the read; anything else → null. Tolerant of case, commas and a trailing full stop. */
export function parseFaceLine(value: string): FaceRead | null {
  const words = value
    .toLowerCase()
    .replace(/[.,;:]/g, " ")
    .split(/\s+/)
    .filter(Boolean);
  const expression = words.find((w): w is FaceExpression => (FACE_EXPRESSIONS as readonly string[]).includes(w));
  const angle = words.find((w): w is FaceAngle => (FACE_ANGLES as readonly string[]).includes(w));
  if (!expression || !angle) return null;
  return { expression, angle };
}

/**
 * Takes the FACE line out of the drafter's answer, wherever it landed —
 * before or after its OVERRIDES line — so neither the prompt nor the
 * overrides list ever carries it to the image model.
 */
export function takeFaceLine(answer: string): { text: string; face: FaceRead | null } {
  const lines = answer.split("\n");
  let face: FaceRead | null = null;
  const kept: string[] = [];
  for (const line of lines) {
    // Its own line, in any case — what the drafter is asked for.
    const own = line.match(/^\s*FACE:\s*(.*)$/i);
    if (own) {
      face = face ?? parseFaceLine(own[1]);
      continue;
    }
    // Tacked onto the end of a line of prompt instead: only in the protocol's
    // own capitals, so prose that happens to say "face:" is never cut.
    const inline = line.match(/^(.*\S)\s+FACE:\s*(.*)$/);
    if (inline) {
      const read = parseFaceLine(inline[2]);
      if (read) {
        face = face ?? read;
        kept.push(inline[1]);
        continue;
      }
    }
    kept.push(line);
  }
  return { text: kept.join("\n"), face };
}

/**
 * At most this many close-ups ride with photo 1. Each is ~1,024 input image
 * tokens, $0.0082 at $8 a million (openai-images.ts): measured, photo 1
 * alone cost $0.0611 a render and photo 1 with three close-ups $0.0857
 * (1,024 → 4,096 tokens in). A fifth picture ran past a minute.
 */
export const MAX_SET_PICTURES = 3;

/**
 * Which close-ups a shot gets, in the order they ride. The expression first
 * (its teeth with it), then the angle, then the face at rest for structure —
 * whatever the set has room for and has usable. No read (the person turned
 * drafting off, or the drafter said nothing) sends the face at rest and the
 * teeth: structure, and the one detail a model invents most. No face in the
 * picture sends nothing: photo 1 still rides.
 */
export function pickSetForShot(available: readonly ExpressionSlot[], face: FaceRead | null): ExpressionSlot[] {
  const want: ExpressionSlot[] = [];
  if (!face) {
    want.push("neutral", "teeth");
  } else if (face.angle === "unseen" || face.angle === "back") {
    return [];
  } else {
    if (face.expression === "smile") want.push("smile", "teeth");
    else if (face.expression === "laugh") want.push("laugh", "teeth");
    else if (face.expression === "other") want.push("teeth");
    if (face.angle === "profile") want.push("profile-left", "profile-right");
    else if (face.angle === "three-quarter") want.push("three-quarter-left", "three-quarter-right");
    want.push("neutral");
  }
  const have = new Set(available);
  const out: ExpressionSlot[] = [];
  for (const slot of want) {
    if (have.has(slot) && !out.includes(slot)) out.push(slot);
    if (out.length >= MAX_SET_PICTURES) break;
  }
  return out;
}
