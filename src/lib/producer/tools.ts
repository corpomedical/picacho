import {
  VIDEO_MODELS,
  getDefaultDurationSeconds,
  getDurationCreditWeight,
  isValidDuration,
  isDormantVideoModel,
  requiresReferenceImage,
} from "../generations/providers/video-models";

// The Producer's tools (2026-09-24). Alias-free so the validation can be
// unit-tested.
//
// THE LIST IS STATIC AND ORDERED. Opus 5.5 ties its thinking to the exact
// request prefix — tools, then system, then every earlier message — and the
// prompt cache is a prefix match too. A tool list that changed between turns
// (a filter per plan, a sort, a new description) would quietly throw both
// away. So: the same tools, byte for byte, on every turn of every
// conversation. Anything per-person goes in the conversation, never here.
//
// NONE OF THEM SPENDS. prepare_send fills in a send and hands it to the person
// as a card; the composer's own receipt and the person's own tap are the only
// way a credit moves (operator, 2026-09-24: "Prepares, you send"). The set
// tools (2026-09-25, operator: "The assistant should be able to fix these
// things and know how to do them") change a set's Build copy — free and
// undoable — and never shoot (lib/producer/set-tools.ts).

export const TOOL_NAMES = {
  search: "search_renders",
  look: "look_at_render",
  prepare: "prepare_send",
  voice: "voice_control",
  memory: "memory",
  readSet: "read_set",
  fixSet: "fix_set_thing",
  undoSet: "undo_set_change",
} as const;

// What voice_control can do (2026-09-25, operator: the mic and speaker stay on
// "until the user manually turns it off or tells it to turn off"). The model
// decides from what the person MEANS — "that's all for now", "you can stop
// listening", "quiet please" — never from a word list.
export const VOICE_ACTIONS = ["end_voice", "mute_replies", "unmute_replies"] as const;
export type VoiceAction = (typeof VOICE_ACTIONS)[number];

export function isVoiceAction(v: unknown): v is VoiceAction {
  return typeof v === "string" && (VOICE_ACTIONS as readonly string[]).includes(v);
}

const nullableString = { type: ["string", "null"] } as const;
const nullableInt = { type: ["integer", "null"] } as const;

export const PRODUCER_TOOLS = [
  {
    name: TOOL_NAMES.search,
    description:
      "Search the person's own renders (newest first). Every filter is optional: pass null for the ones you don't need. `text` matches words in what they asked for and in the score notes. Returns up to `limit` rows (max 20) with id, date, kind, model, length, status, score, credits and the words they asked for.",
    strict: true,
    input_schema: {
      type: "object",
      additionalProperties: false,
      required: ["text", "character", "kind", "score_below", "score_at_least", "days", "limit"],
      properties: {
        text: { ...nullableString, description: "Words to find in the request or the score notes." },
        character: { ...nullableString, description: "A character's name, as the person calls them." },
        // anyOf, not type ["string","null"] + an enum with null in it: the
        // API's strict-schema check refuses that pairing (400, found by a
        // free count_tokens run of this exact list, 2026-09-24).
        kind: { anyOf: [{ type: "string", enum: ["image", "video"] }, { type: "null" }] },
        score_below: { ...nullableInt, description: "Only renders that scored below this (0-100)." },
        score_at_least: { ...nullableInt, description: "Only renders that scored at least this (0-100)." },
        days: { ...nullableInt, description: "Only the last N days." },
        limit: { ...nullableInt, description: "How many rows, 1-20. Default 10." },
      },
    },
  },
  {
    name: TOOL_NAMES.look,
    description:
      "Look at one finished render with your own eyes: an image render's picture, or a video's poster frame, plus its score and notes. Use it when a score is low or the person asks what went wrong. Each look costs the person a little, so look only when it helps.",
    strict: true,
    input_schema: {
      type: "object",
      additionalProperties: false,
      required: ["render_id"],
      properties: {
        render_id: { type: "string", description: "The id from search_renders or the renders list." },
      },
    },
  },
  {
    name: TOOL_NAMES.prepare,
    description:
      "Prepare ONE send for the person to review. It does not render and spends nothing: the person gets a card that opens the composer with everything filled in, where they check the receipt and press Send themselves. Call it once per shot. Returns the credit cost, or an error saying what to fix.",
    strict: true,
    input_schema: {
      type: "object",
      additionalProperties: false,
      required: ["kind", "character_id", "prompt", "video_model_id", "seconds", "label"],
      properties: {
        kind: { type: "string", enum: ["image", "video"] },
        character_id: { ...nullableString, description: "The character's id, or null for a shot with no character." },
        prompt: { type: "string", description: "What to render, in plain words, as the person would type it." },
        video_model_id: { ...nullableString, description: "For a video: the model id from the catalogue. Null for an image." },
        seconds: { ...nullableInt, description: "For a video: a length that model offers. Null for its default." },
        label: { type: "string", description: "A short name for the shot, e.g. 'Close-up at golden hour'." },
      },
    },
  },
  {
    name: TOOL_NAMES.voice,
    description:
      "Turn the voice conversation off, or stop or restart reading your answers aloud. Use it only when the person asks for that, in whatever words they use: end_voice closes the microphone and the speaker (say a short goodbye first), mute_replies keeps listening but stops speaking your answers, unmute_replies starts speaking them again.",
    strict: true,
    input_schema: {
      type: "object",
      additionalProperties: false,
      required: ["action"],
      properties: {
        action: { type: "string", enum: ["end_voice", "mute_replies", "unmute_replies"] },
      },
    },
  },
  {
    name: TOOL_NAMES.readSet,
    description:
      "Read one of their Helios 3D sets as it stands now: its things by the names the set page uses (Car, Car 2, Object 3), whether each car stands on its wheels or is upside down, how high each sits off the floor, which are drawn from a 3D model file, and the render ids of the newest stills taken from it (look_at_render shows one). Free. If the app's note says they are on a set's page (/app/sets/<id>), pass that id; null means the set their newest still came from, else their newest set.",
    strict: true,
    input_schema: {
      type: "object",
      additionalProperties: false,
      required: ["set_id"],
      properties: {
        set_id: { ...nullableString, description: "The set's id, or null (see above)." },
      },
    },
  },
  {
    name: TOOL_NAMES.fixSet,
    description:
      "Fix one thing in one of their Helios sets, as a whole: upright stands a car back on its wheels (a half turn about its own length, so it faces the same way, then set on the floor); turn turns it about an axis through its centre; move moves it; floor sets its lowest point on the floor. Free, saved to the set's Build copy (Astra's original is kept); undo_set_change puts it back. Existing stills don't change: a new still (Shoot, 1 credit, their press) shows the fix. Read the set first.",
    strict: true,
    input_schema: {
      type: "object",
      additionalProperties: false,
      required: ["set_id", "thing", "action", "axis", "degrees", "move"],
      properties: {
        set_id: { ...nullableString, description: "The set's id from read_set, or null for the same set read_set picks." },
        thing: { type: "string", description: "The thing's key from read_set, or its name there (\"Car\", \"Car 2\")." },
        action: { type: "string", enum: ["upright", "turn", "move", "floor"] },
        axis: {
          anyOf: [{ type: "string", enum: ["x", "y", "z"] }, { type: "null" }],
          description: "For turn: y turns it to face another way; x and z tip it over. Null otherwise.",
        },
        degrees: { type: ["number", "null"], description: "For turn: -360 to 360. Null otherwise." },
        move: {
          anyOf: [
            {
              type: "object",
              additionalProperties: false,
              required: ["x", "y", "z"],
              properties: { x: { type: "number" }, y: { type: "number" }, z: { type: "number" } },
            },
            { type: "null" },
          ],
          description: "For move: metres to move it by (x across, y up, z along). Null otherwise.",
        },
      },
    },
  },
  {
    name: TOOL_NAMES.undoSet,
    description:
      "Put back the set as it was before your last change to it (fix_set_thing, or a previous undo — so undoing twice redoes). Free.",
    strict: true,
    input_schema: {
      type: "object",
      additionalProperties: false,
      required: ["set_id"],
      properties: {
        set_id: { ...nullableString, description: "The set whose change to undo, or null for your last change to any set." },
      },
    },
  },
  { type: "memory_20250818", name: TOOL_NAMES.memory },
] as const;

// ---------------------------------------------------------------------------
// prepare_send

export type PreparedSend = {
  id: string;
  label: string;
  kind: "image" | "video";
  characterId: string | null;
  characterName: string | null;
  prompt: string;
  modelId: string | null;
  modelName: string | null;
  seconds: number | null;
  credits: number;
  href: string;
};

// The composer accepts 5,000 characters; a prepared shot is a sentence or
// three, and a longer one is a sign the model is writing an essay into it.
export const MAX_PREPARED_PROMPT = 1500;

/** The composer link that opens a prepared send, filled in and unsent. */
export function composerHref(p: {
  kind: "image" | "video";
  characterId: string | null;
  prompt: string;
  modelId: string | null;
  seconds: number | null;
}): string {
  const q = new URLSearchParams();
  q.set("type", p.kind);
  if (p.characterId) q.set("character", p.characterId);
  if (p.kind === "video" && p.modelId) q.set("model", p.modelId);
  if (p.kind === "video" && p.seconds) q.set("seconds", String(p.seconds));
  q.set("prompt", p.prompt);
  return `/app/generate?${q.toString()}`;
}

/**
 * Checks one prepare_send call against the person's own cast and the real
 * catalogue. Returns the card, or an error the model can correct from.
 */
export function validatePreparedSend(
  input: Record<string, unknown>,
  cast: { id: string; name: string }[],
  newId: () => string,
): { card: PreparedSend } | { error: string } {
  const kind = input.kind === "image" || input.kind === "video" ? input.kind : null;
  if (!kind) return { error: "kind must be image or video." };

  const prompt = typeof input.prompt === "string" ? input.prompt.trim() : "";
  if (!prompt) return { error: "The prompt is empty." };
  if (prompt.length > MAX_PREPARED_PROMPT) {
    return { error: `Keep the prompt under ${MAX_PREPARED_PROMPT} characters.` };
  }

  const label =
    (typeof input.label === "string" ? input.label.trim() : "").slice(0, 80) || prompt.slice(0, 60);

  let characterId: string | null = null;
  let characterName: string | null = null;
  if (typeof input.character_id === "string" && input.character_id.trim()) {
    const found = cast.find((c) => c.id === input.character_id);
    if (!found) return { error: "That character id isn't one of theirs. Use an id from the cast list." };
    characterId = found.id;
    characterName = found.name;
  }

  if (kind === "image") {
    const card: PreparedSend = {
      id: newId(),
      label,
      kind,
      characterId,
      characterName,
      prompt,
      modelId: null,
      modelName: null,
      seconds: null,
      credits: 1,
      href: "",
    };
    card.href = composerHref(card);
    return { card };
  }

  const modelId = typeof input.video_model_id === "string" ? input.video_model_id : "";
  const model = VIDEO_MODELS.find((m) => m.id === modelId);
  if (!model || isDormantVideoModel(model.id)) {
    const ids = VIDEO_MODELS.filter((m) => !isDormantVideoModel(m.id)).map((m) => m.id);
    return { error: `Unknown video model. Use one of: ${ids.join(", ")}.` };
  }
  if (requiresReferenceImage(model) && !characterId) {
    return { error: `${model.name} starts from a picture, so it needs a character. Pick one, or a text-to-video model.` };
  }

  let seconds = getDefaultDurationSeconds(model);
  if (input.seconds !== null && input.seconds !== undefined) {
    const s = Number(input.seconds);
    if (!isValidDuration(model, s)) {
      return {
        error: `${model.name} offers ${model.durations.map((d) => `${d.seconds}s`).join(", ")}.`,
      };
    }
    seconds = s;
  }

  const card: PreparedSend = {
    id: newId(),
    label,
    kind,
    characterId,
    characterName,
    prompt,
    modelId: model.id,
    modelName: model.name,
    seconds,
    credits: getDurationCreditWeight(model, seconds),
    href: "",
  };
  card.href = composerHref(card);
  return { card };
}

// ---------------------------------------------------------------------------
// search_renders

export type SearchFilters = {
  text: string | null;
  character: string | null;
  kind: "image" | "video" | null;
  scoreBelow: number | null;
  scoreAtLeast: number | null;
  days: number | null;
  limit: number;
};

function intOrNull(v: unknown, min: number, max: number): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = Math.round(Number(v));
  if (!Number.isFinite(n)) return null;
  return Math.min(max, Math.max(min, n));
}

/** Tool input → bounded filters. Anything out of range is clamped, not trusted. */
export function readSearchFilters(input: Record<string, unknown>): SearchFilters {
  const text = typeof input.text === "string" ? input.text.trim().slice(0, 80) : "";
  const character = typeof input.character === "string" ? input.character.trim().slice(0, 60) : "";
  return {
    text: text || null,
    character: character || null,
    kind: input.kind === "image" || input.kind === "video" ? input.kind : null,
    scoreBelow: intOrNull(input.score_below, 0, 101),
    scoreAtLeast: intOrNull(input.score_at_least, 0, 100),
    days: intOrNull(input.days, 1, 365),
    limit: intOrNull(input.limit, 1, 20) ?? 10,
  };
}

/**
 * The person's words, reduced to what can sit inside a PostgREST or() filter
 * as a quoted ILIKE value: letters, digits, spaces and a few joiners. Quotes,
 * commas, parentheses and the LIKE wildcards are dropped rather than escaped —
 * this is a search box, and a stray comma must not become filter syntax.
 */
export function searchText(text: string): string {
  return text
    .replace(/[^\p{L}\p{N} '\-.]/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 60);
}
