// Cinema Studio's shot list: the shape of a scene, and the rules that turn a
// language model's JSON into something safe to spend money on.
//
// Alias-free and side-effect-free so it can be unit-tested — same reasoning as
// identity-gate.ts, refund-rules.ts and video-resolution.ts. This module is
// the boundary where free-form model output becomes N paid renders, which
// makes it exactly the code that must be provable without a network.
//
// THE IDEA. Today one prompt is one render. Here someone describes a scene in
// a sentence, a director model decomposes it into a shot list, and each shot
// renders anchored to the same character. What makes the result read as ONE
// scene rather than N unrelated clips is a deliberate constraint borrowed
// from how shot lists actually work:
//
//   the LOOK is chosen once and holds across every shot
//   the CAMERA MOVE changes shot to shot
//
// A scene that re-picked its grade every shot would look like a showreel, not
// a sequence. cinema-presets.ts already enforces one preset per category, so
// a shot simply sends [its own move, the scene's look] and gets a compiled
// block in a deterministic craft order.

import { CINEMA_PRESETS, getCinemaPreset, type CinemaPreset } from "./cinema-presets";

/**
 * Shot-count bounds.
 *
 * The floor is 2 because one shot is not a scene — it is the product's
 * ordinary render, and routing it through here would charge a director call
 * for nothing.
 *
 * The ceiling is 6, and it is a MONEY limit rather than a craft one. Every
 * shot is a full paid render: six shots on a premium video lane is six times
 * that lane's per-render cost in one click, which is more than a whole
 * month's allowance on the smaller plans. Six is already generous; the
 * composer must show the total before anything is spent.
 */
export const MIN_SCENE_SHOTS = 2;
export const MAX_SCENE_SHOTS = 6;

/** Hard cap on a shot's prompt, so one runaway generation can't bloat a row. */
export const MAX_SHOT_PROMPT_CHARS = 600;
export const MAX_SCENE_TITLE_CHARS = 80;

export type SceneShot = {
  /** What happens in this shot, in the model's own words. */
  prompt: string;
  /** A proven "move" preset id, or null when the director didn't pick one. */
  movePresetId: string | null;
  /** Clamped to a duration the chosen render model actually accepts. */
  seconds: number;
};

export type ScenePlan = {
  title: string;
  /** ONE proven "look" preset for the whole scene — the consistency anchor. */
  lookPresetId: string | null;
  shots: SceneShot[];
};

/** What the director model is allowed to choose from. Proven presets only. */
export function sceneVocabulary(): { moves: CinemaPreset[]; looks: CinemaPreset[] } {
  const proven = CINEMA_PRESETS.filter((p) => p.proven !== false);
  return {
    moves: proven.filter((p) => p.category === "move"),
    looks: proven.filter((p) => p.category === "look"),
  };
}

/**
 * Resolves a preset id the director proposed, but only within one category.
 *
 * getCinemaPreset already refuses unknown and unproven ids. The extra
 * category check is what stops a director that answered "noir" in the move
 * slot from silently costing the scene its camera work: resolvePresetBlocks
 * keeps one preset PER CATEGORY, so a look in the move slot would be
 * de-duplicated against the scene look and the shot would simply have no
 * camera direction at all — a quiet quality loss with no error anywhere.
 */
function presetInCategory(id: unknown, category: CinemaPreset["category"]): string | null {
  if (typeof id !== "string" || !id.trim()) return null;
  const preset = getCinemaPreset(id.trim());
  return preset && preset.category === category ? preset.id : null;
}

function cleanText(value: unknown, max: number): string {
  if (typeof value !== "string") return "";
  return value.replace(/\s+/g, " ").trim().slice(0, max);
}

export type NormaliseOptions = {
  /** Durations the chosen model actually accepts, ascending. */
  allowedSeconds: readonly number[];
  /** Used when the director proposes a length the model can't render. */
  defaultSeconds: number;
};

/**
 * Turns whatever the director model returned into a plan that is safe to
 * render, or null when there is no usable scene in it.
 *
 * Every rule here is defensive on purpose. This input is model output: it can
 * carry invented preset ids, a duration the endpoint would reject, twenty
 * shots, an empty prompt, or the wrong types entirely. None of those should
 * reach a paid render, and none of them should throw either — a director that
 * returns something odd should degrade to a shorter scene or to nothing,
 * never to a crash mid-spend.
 */
export function normaliseScenePlan(raw: unknown, opts: NormaliseOptions): ScenePlan | null {
  if (!raw || typeof raw !== "object") return null;
  const obj = raw as Record<string, unknown>;

  const rawShots = Array.isArray(obj.shots) ? obj.shots : [];
  const lookPresetId = presetInCategory(obj.lookPresetId, "look");

  const shots: SceneShot[] = [];
  for (const entry of rawShots) {
    if (shots.length >= MAX_SCENE_SHOTS) break;
    if (!entry || typeof entry !== "object") continue;
    const e = entry as Record<string, unknown>;
    const prompt = cleanText(e.prompt, MAX_SHOT_PROMPT_CHARS);
    // A shot with no prompt is not a shot. Dropped rather than rendered as an
    // empty string, which would spend a credit on whatever the model felt
    // like producing.
    if (!prompt) continue;

    const proposed = Number(e.seconds);
    const seconds = opts.allowedSeconds.includes(proposed) ? proposed : opts.defaultSeconds;

    shots.push({
      prompt,
      movePresetId: presetInCategory(e.movePresetId, "move"),
      seconds,
    });
  }

  if (shots.length < MIN_SCENE_SHOTS) return null;

  return {
    title: cleanText(obj.title, MAX_SCENE_TITLE_CHARS) || "Untitled scene",
    lookPresetId,
    shots,
  };
}

/**
 * The preset ids to send with one shot: its own move, plus the scene's look.
 *
 * Order matters only for readability — resolvePresetBlocks sorts into a fixed
 * craft order (camera, then light, then FX) regardless of what it is handed,
 * so the compiled prompt is deterministic.
 */
export function shotPresetIds(plan: ScenePlan, shot: SceneShot): string[] {
  return [shot.movePresetId, plan.lookPresetId].filter((id): id is string => Boolean(id));
}

/**
 * What the whole scene will cost, in credits.
 *
 * Takes the per-duration weight as a function rather than importing the model
 * catalogue, which keeps this module free of the "@/" imports vitest cannot
 * resolve — and, more usefully, means the composer and the server compute the
 * total through the SAME code. A quote that disagrees with the charge is the
 * defect this shape exists to make impossible.
 */
export function scenePlanCreditCost(
  plan: ScenePlan,
  weightForSeconds: (seconds: number) => number,
): number {
  return plan.shots.reduce((total, shot) => total + weightForSeconds(shot.seconds), 0);
}

/** Total runtime of the finished scene, for display. */
export function scenePlanSeconds(plan: ScenePlan): number {
  return plan.shots.reduce((total, shot) => total + shot.seconds, 0);
}

/**
 * The director's brief.
 *
 * Built here rather than inline at the call site so it is testable, and so
 * the vocabulary it offers can never drift from the vocabulary the renderer
 * accepts — both read sceneVocabulary(), which reads the same proven-preset
 * filter getCinemaPreset enforces. A brief that offered a drafted preset
 * would produce shots that silently lose their look.
 */
export function buildDirectorInstructions(input: {
  idea: string;
  characterName: string | null;
  shotCount: number;
  allowedSeconds: readonly number[];
}): string {
  const { moves, looks } = sceneVocabulary();
  const subject = input.characterName ? `the character "${input.characterName}"` : "the subject";
  const shots = Math.min(Math.max(input.shotCount, MIN_SCENE_SHOTS), MAX_SCENE_SHOTS);

  return [
    "You are a director planning a short sequence. Break the idea below into a shot list.",
    "",
    `IDEA: ${input.idea}`,
    "",
    `Plan exactly ${shots} shots featuring ${subject}. The same person appears in every shot.`,
    "",
    "Rules:",
    `- Each shot's "prompt" describes what happens IN THAT SHOT, in one or two plain sentences. Do not describe the person's appearance — that is handled separately and repeating it will fight the character reference.`,
    "- Shots must run in narrative order and read as one continuous scene, not as variations on the same moment.",
    `- "movePresetId" must be one of these camera moves, or null: ${moves.map((m) => m.id).join(", ")}.`,
    "- Vary the camera move between consecutive shots.",
    `- "lookPresetId" is ONE grade for the WHOLE scene, chosen once from: ${looks.map((l) => l.id).join(", ")}. Use null if none fits.`,
    `- "seconds" must be one of: ${input.allowedSeconds.join(", ")}.`,
    `- "title" is a short scene name, under ${MAX_SCENE_TITLE_CHARS} characters.`,
    "",
    "Reply with JSON only, no commentary:",
    '{"title":"...","lookPresetId":"...","shots":[{"prompt":"...","movePresetId":"...","seconds":5}]}',
  ].join("\n");
}

/**
 * What a FAN-OUT costs: one credit weight, N renders.
 *
 * Trivial arithmetic, deliberately given a name and a home, because the
 * composer and the server were doing it differently and one of them was
 * wrong. Today generate-form.tsx quotes `selectedCreditCost` — the price of
 * ONE render — while runMultiAngleGeneration charges
 * `angleIds.length * creditWeight`. A five-angle Seedance batch therefore
 * shows 9 credits and takes 45, and because the affordability check compares
 * the same per-render number, someone who cannot afford the batch gets no
 * warning at all: they are refused after pressing send, which the action's
 * own comment calls "the worst moment to learn it".
 *
 * Both sides call this now, so a quote that disagrees with the charge would
 * have to be a deliberate edit rather than a drift.
 */
export function fanoutCreditCost(perRenderWeight: number, renderCount: number): number {
  const weight = Number.isFinite(perRenderWeight) ? Math.max(0, Math.trunc(perRenderWeight)) : 0;
  const count = Number.isFinite(renderCount) ? Math.max(0, Math.trunc(renderCount)) : 0;
  return weight * count;
}
