// Every model Picacho runs, by the product it runs in, and which of them the
// operator can switch (operator, 2026-10-02: "I want to see which models are
// being used and in which products we offer and I want the ability to switch
// models. I want a full control panel with all the necessary features." He
// picked layout A, a new Models page, and every switch in the first build).
//
// Three kinds of entry:
//
//   MENUS — the model lists customers choose from. Each item can be offered or
//     taken off the menu (model_controls.off). Turning one off hides it where
//     customers pick and the server refuses it, so an old page can't send it.
//     Some items are locked on: the free tier's video model, Luna, a menu's
//     last item.
//
//   JOBS — models that run unseen. Each switch lists only models verified to
//     answer that job's exact request on 2026-10-02 (probed with the real
//     keys): the policy readers send temperature 0 and a seed, which gpt-5.5
//     and gpt-6 refuse, so they offer gpt-5.4-mini and gpt-5.4 only; the
//     Claude jobs send thinking off, which each Claude model spells its own
//     way (claudeThinkingOff below). Haiku 4.5 is left out: it retires from
//     2026-10-15.
//
//   FIXED — jobs with one model that fits today, shown so the map is whole,
//     each with the reason.
//
// Pure and alias-free: tests import it, and so does the client page.

export type ProductKey =
  | "video"
  | "picture"
  | "aly"
  | "voice"
  | "recast"
  | "helios"
  | "effects"
  | "live"
  | "edit"
  | "voices"
  | "press"
  | "safety";

export const PRODUCTS: readonly { key: ProductKey; name: string }[] = [
  { key: "video", name: "Generate · Video" },
  { key: "picture", name: "Generate · Picture" },
  { key: "aly", name: "Aly chat & Light" },
  { key: "voice", name: "Aly voice" },
  { key: "recast", name: "Recast" },
  { key: "helios", name: "Helios Studio" },
  { key: "effects", name: "Effects" },
  { key: "live", name: "Live" },
  { key: "edit", name: "Edit Bay & Director's Cut" },
  { key: "voices", name: "Character voices" },
  { key: "press", name: "Press Tour & product checks" },
  { key: "safety", name: "Safety & moderation" },
];

// ---------------------------------------------------------------------------
// Jobs

export type ModelOption = { id: string; label: string };

export type JobKey =
  | "claude_writer"
  | "policy_reader"
  | "face_check"
  | "output_arbiter"
  | "product_second_opinion"
  | "effects_supervisor"
  | "aly_claude"
  | "voice_replies"
  | "studio_readers";

export type JobSlot = {
  key: JobKey;
  /** Every product this job serves; the page lists it under each. */
  products: readonly ProductKey[];
  job: string;
  /** What runs when nothing is picked (an env override may sit between, see `env`). */
  default: string;
  options: readonly ModelOption[];
  /** The environment variable that chose this before the panel (still honoured under a pick). */
  env?: string;
  /** Shown beside the switch: what to watch after changing it. */
  warn?: string;
};

const SONNET_5: ModelOption = { id: "claude-sonnet-5", label: "Claude Sonnet 5" };
const OPUS_5_5: ModelOption = { id: "claude-opus-5-5", label: "Claude Opus 5.5" };
const MINI_5_4: ModelOption = { id: "gpt-5.4-mini", label: "GPT-5.4 mini" };
const GPT_5_4: ModelOption = { id: "gpt-5.4", label: "GPT-5.4" };
const GPT_5_5: ModelOption = { id: "gpt-5.5", label: "GPT-5.5" };

export const JOB_SLOTS: readonly JobSlot[] = [
  {
    key: "claude_writer",
    products: ["video", "press", "safety"],
    job: "Writes the render prompt, plans Prompt Studio and Press Tour scenes, backs up the policy reader",
    default: SONNET_5.id,
    options: [SONNET_5, OPUS_5_5],
  },
  {
    key: "policy_reader",
    products: ["safety", "video", "picture", "press"],
    job: "Reads prompts and pictures for policy and brand rules, describes images",
    default: MINI_5_4.id,
    options: [MINI_5_4, GPT_5_4],
    env: "OPENAI_MODEL",
    warn: "A safety reader: a new model changes what gets refused. Watch refusals for a day. GPT-5.4 costs about 3.3 times as much a reading. The second vote at a band edge always uses the other of the two.",
  },
  {
    key: "face_check",
    products: ["video", "safety"],
    job: "Face check on character renders (the identity score)",
    default: GPT_5_5.id,
    options: [GPT_5_5, GPT_5_4, MINI_5_4],
    env: "IDENTITY_SCORER_MODEL",
    warn: "The face gate at 70 was tuned on GPT-5.5, and GPT-5.4 mini once rated a lookalike above Eva's own photo. Every score is stamped with its model, so scores before and after a switch don't compare.",
  },
  {
    key: "output_arbiter",
    products: ["safety"],
    job: "Settles disputed finished pictures (the arbiter)",
    default: SONNET_5.id,
    options: [SONNET_5, OPUS_5_5],
    warn: "A safety reader: watch what gets held back for a day after switching.",
  },
  {
    key: "product_second_opinion",
    products: ["press"],
    job: "Second opinion when a product check is unsure",
    default: SONNET_5.id,
    options: [SONNET_5, OPUS_5_5],
  },
  {
    key: "effects_supervisor",
    products: ["effects"],
    job: "Writes each effect's instruction and checks the result",
    default: OPUS_5_5.id,
    options: [OPUS_5_5, SONNET_5],
  },
  {
    key: "aly_claude",
    products: ["aly"],
    job: "The model behind the Claude brain (Think harder stays Claude Opus 5.5)",
    default: SONNET_5.id,
    options: [SONNET_5, OPUS_5_5],
    warn: "Opus 5.5 costs twice as much a message; each answer is priced by the model that wrote it.",
  },
  {
    key: "voice_replies",
    products: ["voices"],
    job: "Spoken replies in the composer's voice mode",
    default: "tts-1",
    options: [
      { id: "tts-1", label: "OpenAI TTS-1" },
      { id: "gpt-4o-mini-tts", label: "GPT-4o mini TTS" },
    ],
  },
  {
    key: "studio_readers",
    products: ["helios", "recast"],
    job: "Reads shot words, rigs, recces, people in looks, and uploaded Recast clips",
    default: MINI_5_4.id,
    options: [MINI_5_4, GPT_5_4],
    warn: "GPT-5.4 costs about 3.3 times as much a reading; the Studio's reading budgets stay the same.",
  },
];

export function jobSlot(key: string): JobSlot | null {
  return JOB_SLOTS.find((s) => s.key === key) ?? null;
}

/** The label people read for a model id, from any job's options, else the id. */
export function modelOptionLabel(id: string): string {
  for (const s of JOB_SLOTS) {
    const o = s.options.find((x) => x.id === id);
    if (o) return o.label;
  }
  return id;
}

/**
 * The thinking-off field each Claude model accepts (probed 2026-10-02):
 * Sonnet 5 and Haiku 4.5 take {type:"disabled"}; Opus 5.5 and Fable 5.1
 * refuse it ("Use thinking.type.adaptive") and answer without thinking when
 * the field is left out. (Sonnet 5.5 wants {type:"between_tools"}; it is
 * not offered, its price isn't in the repo.)
 */
export function claudeThinkingOff(model: string): { thinking?: { type: "disabled" } } {
  if (/^claude-(opus-5-5|fable)/.test(model)) return {};
  return { thinking: { type: "disabled" } };
}

/** List prices per 1M tokens (in / out), from the repo's own tables (aly-chat/brains.ts RATES, read there). */
export const CLAUDE_USD_PER_M: Readonly<Record<string, { input: number; output: number }>> = {
  "claude-sonnet-5": { input: 2, output: 10 },
  "claude-opus-5-5": { input: 4, output: 20 },
};

export function claudeUsd(model: string, inputTokens: number, outputTokens: number): number {
  const r = CLAUDE_USD_PER_M[model] ?? CLAUDE_USD_PER_M["claude-opus-5-5"];
  return (inputTokens * r.input + outputTokens * r.output) / 1_000_000;
}

// ---------------------------------------------------------------------------
// Fixed jobs (shown, not switchable)

export type FixedJob = { products: readonly ProductKey[]; job: string; model: string; why: string };

export const FIXED_JOBS: readonly FixedJob[] = [
  { products: ["video"], job: "Lip sync", model: "Sync Lipsync 2 Pro", why: "The only lip-sync engine wired in." },
  { products: ["video"], job: "Upscale", model: "FLUX video upscale", why: "The only upscaler wired in." },
  { products: ["picture"], job: "Opening frame for character videos", model: "GPT Image 2.5", why: "Built around GPT Image's reference photos." },
  { products: ["picture"], job: "Layers split", model: "Seedream 5 layerize", why: "The only layer splitter wired in." },
  { products: ["aly"], job: "Luna, the everyday brain, and chat titles", model: "GPT-6 Luna", why: "Luna is one model; the brain menu holds the others." },
  { products: ["aly"], job: "Think harder", model: "Claude Opus 5.5", why: "Your call on 2026-10-01: Think harder stays Opus 5.5." },
  { products: ["aly"], job: "GPT and Gemini brains", model: "GPT-6 Sol · Gemini 3.8 Flash", why: "One model per brain, priced in brains.ts." },
  { products: ["voice"], job: "Aly's brain", model: "Claude Opus 5.5", why: "Her per-turn thinking and effort are built on Opus 5.5." },
  { products: ["voice"], job: "\"Said to her?\" gate", model: "GPT-6 Luna", why: "Haiku dropped 8 of 66 real turns in the 2026-10-01 test; Luna dropped none." },
  { products: ["voice"], job: "Hears you", model: "GPT-4o mini transcribe", why: "Priced and timed for it." },
  { products: ["voice"], job: "Aly's voice", model: "ElevenLabs v4 Turbo · GPT-4o mini TTS backup", why: "Pick her voice in Admin → Voices." },
  { products: ["voice"], job: "Talk mode", model: "GPT Live 1", why: "The only live voice model." },
  { products: ["recast"], job: "Mystique face lock", model: "Face check model", why: "Follows the face check switch." },
  { products: ["helios"], job: "Builds the set (Astra)", model: "GPT-6 Astra", why: "Astra has its own client." },
  { products: ["helios"], job: "Cuts out looks", model: "SAM 2", why: "The only cutout model wired in." },
  { products: ["helios"], job: "Builds things from photos", model: "TRELLIS.2", why: "The only builder wired in." },
  { products: ["helios"], job: "Angle Stage", model: "Hunyuan3D 2 · Seedream 4 edit", why: "Built around these two." },
  { products: ["helios"], job: "Cycles renders", model: "Blender Cycles on Modal", why: "A renderer, not a model." },
  { products: ["live"], job: "Realtime take", model: "MiniMax H3 Max Director", why: "The only realtime director model." },
  { products: ["edit"], job: "Director's Cut editor", model: "Claude Opus 5.5", why: "A saved agent at Anthropic: a switch means re-creating it with the setup script." },
  { products: ["edit"], job: "Transcribes clips", model: "Whisper", why: "Needs word timings, which only Whisper returns." },
  { products: ["edit"], job: "Renders exports", model: "HeyGen HyperFrames", why: "A renderer, not a model." },
  { products: ["voices"], job: "Character dialogue", model: "ElevenLabs v4 (new) · v3 (older characters)", why: "Each character keeps the engine its voice was made on." },
  { products: ["voices"], job: "Voice design", model: "ElevenLabs voice design v3", why: "The only voice designer." },
  { products: ["voices"], job: "Composer mic", model: "Whisper", why: "Reads the clip length from Whisper's detailed answer to price it." },
  { products: ["press"], job: "Film lane", model: "Kling O3", why: "The only film lane validated for Press Tour." },
  { products: ["press"], job: "Product judge", model: "Gemini 3.1 Flash-Lite", why: "The confidence line was set on it; PRODUCT_JUDGE_MODEL overrides." },
  { products: ["press"], job: "Reads labels", model: "Google Cloud Vision", why: "The only OCR wired in." },
  { products: ["effects"], job: "Effect engines", model: "Chosen by each effect", why: "Turn engines on or off in the menu above." },
  { products: ["safety"], job: "Image moderation", model: "OpenAI omni-moderation", why: "OpenAI's own moderation endpoint." },
  { products: ["safety"], job: "Real-person check", model: "BytePlus visual validate", why: "ByteDance's sanctioned route for real faces." },
];

// ---------------------------------------------------------------------------
// Customer menus

export type MenuKey = "video" | "picture" | "aly_brains" | "recast" | "effects" | "models_3d" | "helios_takes" | "music" | "press_stills";

export type MenuItem = {
  id: string;
  label: string;
  provider: string;
  detail?: string;
  /** Why it can't be turned off, when it can't. */
  locked?: string;
};

export type MenuDef = { key: MenuKey; product: ProductKey; label: string };

export const MENUS: readonly MenuDef[] = [
  { key: "video", product: "video", label: "Video models customers choose from" },
  { key: "picture", product: "picture", label: "Picture models customers choose from" },
  { key: "aly_brains", product: "aly", label: "Brains in the chat's brain menu" },
  { key: "recast", product: "recast", label: "Recast engines (one per job and plan)" },
  { key: "models_3d", product: "helios", label: "3D model engines" },
  { key: "helios_takes", product: "helios", label: "Set take engines" },
  { key: "effects", product: "effects", label: "Effect engines (each effect uses one)" },
  { key: "music", product: "edit", label: "Music engines in the Edit Bay" },
  { key: "press_stills", product: "press", label: "Press Tour picture engines" },
];

export function menuDef(key: string): MenuDef | null {
  return MENUS.find((m) => m.key === key) ?? null;
}

// ---------------------------------------------------------------------------
// The stored choices (app_settings.model_controls, JSON)

export const MODEL_CONTROLS_KEY = "model_controls";

export type ModelControls = {
  /** Job key → picked model id. */
  jobs: Partial<Record<JobKey, string>>;
  /** Menu key → item ids taken off that menu. */
  off: Partial<Record<MenuKey, string[]>>;
};

export const EMPTY_CONTROLS: ModelControls = { jobs: {}, off: {} };

/** Reads the stored JSON, keeping only what is valid today; anything else reads as no choice. */
export function parseModelControls(raw: string | null | undefined): ModelControls {
  if (!raw) return { jobs: {}, off: {} };
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return { jobs: {}, off: {} };
  }
  const out: ModelControls = { jobs: {}, off: {} };
  const d = (data ?? {}) as { jobs?: Record<string, unknown>; off?: Record<string, unknown> };
  for (const [k, v] of Object.entries(d.jobs ?? {})) {
    const slot = jobSlot(k);
    if (slot && typeof v === "string" && slot.options.some((o) => o.id === v)) out.jobs[slot.key] = v;
  }
  for (const [k, v] of Object.entries(d.off ?? {})) {
    const menu = menuDef(k);
    if (menu && Array.isArray(v)) out.off[menu.key] = [...new Set(v.filter((x): x is string => typeof x === "string"))].slice(0, 50);
  }
  return out;
}

/** The picked model for a job, or null when none is picked (the caller's env/default then answers). */
export function pickedJobModel(controls: ModelControls, key: JobKey): string | null {
  const slot = jobSlot(key);
  const v = controls.jobs[key];
  return slot && v && slot.options.some((o) => o.id === v) ? v : null;
}

/** Whether customers are offered this item. Anything not taken off is offered. */
export function isOffered(controls: ModelControls, menu: MenuKey, id: string): boolean {
  return !(controls.off[menu] ?? []).includes(id);
}

export function offeredIds<T extends string>(controls: ModelControls, menu: MenuKey, ids: readonly T[]): T[] {
  return ids.filter((id) => isOffered(controls, menu, id));
}
