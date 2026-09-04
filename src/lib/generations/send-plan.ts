// The Send Receipt resolver (2026-08-25, operator: "a definite solution to
// all problems" → "Ship them all").
//
// This module is the ONE place that answers "what is this send, actually?" —
// which photo anchors the face, where the outfit rides, what the chosen
// model can and cannot consume, and what should stop the send before money
// moves. The composer renders its answer as the always-visible receipt
// strip; the server re-resolves through this same module (log-only in P0,
// authoritative later). The scattered if-cascade across submitPrompt,
// actions.ts and fal.ts — the root of every composer incident in the
// catalog — is being drained into here, phase by phase.
//
// DESIGN RULES (from the adversarial review — binding):
//  - Pure and dependency-free: no imports, no I/O, no Next.js. The inputs
//    are a serializable snapshot (ResolveInput); server-only facts arrive
//    as fields of that snapshot, never read from inside.
//  - MODEL_CAPABILITIES is transcribed from what providers/fal.ts and
//    providers/image.ts ACTUALLY SEND — never from provider docs. Every
//    model must declare itself: the Record type is exhaustive over the ids
//    the product ships, so adding a model without declaring capabilities
//    fails tsc.
//  - Issues are typed codes + params. The UI maps codes to the four
//    locales; this module never emits an English sentence.
//  - Mirrors before it moves: in P0 this resolver REPLICATES today's
//    semantics (attachment outranks gallery pick outranks saved photo;
//    advanced modes silently suppress attachments — now visibly). Behavior
//    changes are later phases, each its own commit.

// ---------------------------------------------------------------------------
// Capability matrix
// ---------------------------------------------------------------------------

export type VideoModelId =
  | "kling"
  | "kling-2.5"
  | "kling-o3"
  | "gemini-omni"
  | "kling-o3-pro"
  | "minimax-h3"
  | "seedance"
  | "seedance-2"
  | "veo"
  | "wan-turbo";
export type ImageModelId = "gpt-image" | "flux";

export type ModelCapabilities = {
  kind: "video" | "image";
  identity: {
    /** how many identity reference images the adapter actually binds */
    max: number;
    /** the mechanism the adapter uses — determines what "identity" even means */
    mechanism: "elements" | "citation" | "first-frame" | "edit-source" | "none";
    /** provider hard-requires a reference image (pre-credit reject exists) */
    required: boolean;
  };
  /** native extra-image outfit lane (seedance @ImageN citation, GPT extra edit image) */
  outfitImage: boolean;
  /** prior-clip continuation via video reference */
  continuation: boolean;
  /** product-reachable start/end frame slots */
  startEndFrames: boolean;
  /** kling-o3-pro multi_prompt storyboard */
  storyboard: boolean;
  /** several DIFFERENT people in one render */
  multiPerson: boolean;
  /** how aspect is controlled: a real param, an AI reframe of the photo, or not at all */
  aspectControl: "param" | "reframe" | "none";
  /** provider-enforced bounds on the reference photo's own aspect (kling-o3 family) */
  refAspectBounds?: { min: number; max: number };
  /**
   * Whether the provider will accept a reference image that reads as a real
   * person. BOTH Seedance lanes reject as of 2026-09-03: 2.5 always has, and
   * 2.0 joined it — not on the strength of two refusals, but on ByteDance's
   * own documentation, which states the Seedance 2.0 series does not support
   * direct uploads of reference images containing real-person faces and
   * points at a verified asset library instead.
   */
  photorealPolicy: "rejects" | "accepts";
  /** combined image budget across identity + outfit (seedance / o3-pro slice-to-4) */
  imageBudget?: number;
};

// Transcribed from providers/fal.ts + providers/image.ts / openai-images.ts /
// fal-image.ts — line references in the 2026-08-25 capability audit
// (workflow wf_f7d8820c-472). Update this table WHEN THE ADAPTER CHANGES,
// in the same commit.
export const MODEL_CAPABILITIES: Record<VideoModelId | ImageModelId, ModelCapabilities> = {
  kling: {
    kind: "video",
    identity: { max: 4, mechanism: "elements", required: false },
    outfitImage: false,
    continuation: false,
    startEndFrames: true,
    storyboard: false,
    multiPerson: true,
    aspectControl: "param",
    photorealPolicy: "accepts",
  },
  "kling-2.5": {
    kind: "video",
    identity: { max: 1, mechanism: "first-frame", required: true },
    outfitImage: false,
    continuation: false,
    startEndFrames: false,
    storyboard: false,
    multiPerson: false,
    aspectControl: "reframe",
    photorealPolicy: "accepts",
  },
  "kling-o3": {
    kind: "video",
    identity: { max: 1, mechanism: "first-frame", required: true },
    outfitImage: false,
    continuation: false,
    startEndFrames: false,
    storyboard: false,
    multiPerson: false,
    aspectControl: "reframe",
    refAspectBounds: { min: 0.4, max: 2.5 },
    photorealPolicy: "accepts",
  },
  "kling-o3-pro": {
    kind: "video",
    identity: { max: 4, mechanism: "elements", required: true },
    outfitImage: false,
    continuation: false,
    startEndFrames: false,
    storyboard: true,
    multiPerson: true,
    aspectControl: "param",
    refAspectBounds: { min: 0.4, max: 2.5 },
    photorealPolicy: "accepts",
    imageBudget: 4,
  },
  "minimax-h3": {
    kind: "video",
    // Five, not the endpoint's own nine: the 6th reference image onward is
    // billed at $0.08 each and the catalogue prices this lane per second
    // only. See the identityBudget note in providers/fal.ts.
    identity: { max: 5, mechanism: "citation", required: true },
    // No extra-image outfit lane wired yet. The endpoint could carry one —
    // its reference list is flat and cited by order, exactly like Seedance's
    // — but the outfit citation line and the budget arithmetic that goes
    // with it are their own change, and claiming the capability here would
    // make the composer offer a slot fal.ts never fills.
    outfitImage: false,
    // Not wired, though the endpoint takes up to 3 reference VIDEOS: the
    // continuation surcharge in video-models.ts is derived from ByteDance's
    // published with-video multiplier, and H3 publishes no equivalent rule.
    // Charging Seedance's discount against MiniMax's prices is exactly the
    // guess the 2026-08-31 continuation audit was cleaning up after.
    continuation: false,
    startEndFrames: false,
    storyboard: false,
    multiPerson: false,
    // A real aspect_ratio parameter (adaptive/21:9/16:9/4:3/1:1/3:4/9:16),
    // so no reframe workaround — same as O3 Pro, unlike O3 standard.
    aspectControl: "param",
    photorealPolicy: "accepts",
    imageBudget: 5,
  },
  seedance: {
    kind: "video",
    identity: { max: 4, mechanism: "citation", required: true },
    outfitImage: true,
    continuation: true,
    startEndFrames: false,
    storyboard: false,
    multiPerson: true,
    aspectControl: "param",
    photorealPolicy: "rejects",
    imageBudget: 4,
  },
  "seedance-2": {
    kind: "video",
    identity: { max: 4, mechanism: "citation", required: true },
    outfitImage: true,
    continuation: true,
    startEndFrames: false,
    storyboard: false,
    multiPerson: true,
    aspectControl: "param",
    photorealPolicy: "rejects",
    imageBudget: 4,
  },
  veo: {
    kind: "video",
    // Changed 2026-08-30. This row used to read { max: 0, mechanism: "none" }
    // — Veo was the one model in the catalogue that structurally could not
    // hold a face, and the send receipt correctly said "generic person" on
    // every Veo render. That was never a Veo limitation: fal-ai/veo3.1 is
    // text-to-video only, but fal-ai/veo3.1/image-to-video takes an
    // image_url, at the SAME per-second price. fal.ts now routes to the
    // sibling endpoint whenever a character photo exists.
    //
    // max 1, not 4: that endpoint takes one image_url and has no reference
    // array (schema confirmed 2026-08-30), which is also why
    // baselineIdentityReferences declines Veo and the multi-photo path never
    // reaches it. mechanism "first-frame" because the photo opens the clip,
    // same real trade as Kling O3 and 2.5. required false because a
    // characterless Veo render still takes the text-to-video branch and
    // keeps its full compositional freedom.
    identity: { max: 1, mechanism: "first-frame", required: false },
    outfitImage: false,
    continuation: false,
    startEndFrames: false,
    storyboard: false,
    multiPerson: false,
    aspectControl: "param",
    photorealPolicy: "accepts",
  },
  "gemini-omni": {
    kind: "video",
    // CITATION, not first-frame — the identity rides as <IMAGE_REF_n> in the
    // prompt (fal's reference-to-video lane), so the clip does not open
    // frozen in the photographed pose. That is a deliberate choice of lane:
    // the image-to-video sibling exists and costs exactly the same, and it
    // would have put the photo in frame one. See the branch in fal.ts.
    //
    // max 4 to match every other citation lane here (Seedance, Kling
    // elements, O3 Pro). fal actually allows 10 with NO per-image
    // surcharge — the price is output seconds only — so this can be raised
    // for free if a test render shows more references hold the face better.
    // It is capped at the house number rather than the endpoint's, because
    // more references is an unverified quality bet, not a free win.
    identity: { max: 4, mechanism: "citation", required: false },
    outfitImage: false,
    // The reference lane takes up to 3 reference_video_urls, which is a
    // continuation path — but continuationExtraCredits is derived from
    // ByteDance's published with-video multiplier and Gemini posts no
    // equivalent rule. Charging Seedance's discount against Google's prices
    // is exactly the guess the 2026-08-31 continuation audit cleaned up.
    continuation: false,
    startEndFrames: false,
    storyboard: false,
    multiPerson: false,
    aspectControl: "param",
    photorealPolicy: "accepts",
    imageBudget: 4,
  },
  "wan-turbo": {
    kind: "video",
    // Exactly Veo's shape above, and for the same reason: two sibling
    // endpoints at ONE price, so a character photo costs nothing to honour.
    // max 1 because image-to-video takes a single image_url and has no
    // reference array (openapi confirmed 2026-09-01) — which also makes
    // baselineIdentityReferences decline it, so a multi-photo character
    // sends its primary photo and nothing else. required false because the
    // text-to-video lane runs perfectly well with no photo, which matters
    // more here than anywhere: this is the free tier, and a first-run
    // account that has not built a character yet must still get its render.
    identity: { max: 1, mechanism: "first-frame", required: false },
    outfitImage: false,
    continuation: false,
    // The image-to-video lane does take an end_image_url, so this could
    // become true — but the storyboard surcharge and the composer slot are
    // their own change, and claiming it here would offer a slot fal.ts
    // never fills.
    startEndFrames: false,
    storyboard: false,
    multiPerson: false,
    aspectControl: "param",
    photorealPolicy: "accepts",
  },
  "gpt-image": {
    kind: "image",
    identity: { max: 1, mechanism: "edit-source", required: false },
    outfitImage: true,
    continuation: false,
    startEndFrames: false,
    storyboard: false,
    multiPerson: true,
    aspectControl: "none",
    photorealPolicy: "accepts",
  },
  // FLUX.2 Pro since 2026-08-26 — /edit takes a reference ARRAY like the
  // GPT lane, so the receipt tells the same story on both image models.
  flux: {
    kind: "image",
    identity: { max: 1, mechanism: "edit-source", required: false },
    outfitImage: true,
    continuation: false,
    startEndFrames: false,
    storyboard: false,
    multiPerson: true,
    aspectControl: "none",
    photorealPolicy: "accepts",
  },
};

// Baseline multi-reference (2026-08-30).
//
// Every ordinary render used to hand the model exactly ONE photo, because
// actions.ts resolved a single anchor (reference_image_urls[0], or the one
// the person tapped) and nothing ever populated the plural field outside the
// Studio-gated advanced panel. buildVideoRequest in fal.ts has always been
// written to take four — `referenceImageUrls.slice(0, 4)` — so a character
// with eight saved photos was being described to a four-reference model by
// one of them.
//
// This decides, from the capability matrix rather than a hand-kept model
// list, which sends should carry the character's whole gallery:
//
//   kling, kling-o3-pro   "elements"    max 4  -> yes
//   seedance, seedance-2  "citation"    max 4  -> yes
//   kling-o3, kling-2.5   "first-frame" max 1  -> NO. The photo IS frame
//                                                 one; a second has nowhere
//                                                 to go and would silently
//                                                 replace the composition.
//   veo                   "none"        max 0  -> NO. Receives no image.
//   gpt-image, flux       "edit-source" max 1  -> NO. One source image.
//
// The preferred photo always leads, so the model's primary identity signal
// is byte-identical to what it was before this existed and the extra photos
// can only ADD. Returns [] when multi-reference does not apply, which the
// caller reads as "keep the single-anchor path exactly as it was".
export function baselineIdentityReferences(
  modelId: string,
  gallery: readonly string[],
  preferredPath?: string | null,
): string[] {
  const caps = MODEL_CAPABILITIES[modelId as VideoModelId | ImageModelId];
  const max = caps?.identity.max ?? 0;
  if (max <= 1) return [];
  const clean = gallery.filter((p): p is string => Boolean(p));
  if (clean.length < 2) return [];
  const primary = preferredPath && clean.includes(preferredPath) ? preferredPath : clean[0];
  return [primary, ...clean.filter((p) => p !== primary)].slice(0, max);
}

// The lane the product presents as "no character needed" (2026-08-30).
//
// Deliberately NOT derived from identity.required. Kling 1.6 also renders a
// generic person perfectly well (required: false), but an unpicked character
// there is still far more likely to be an oversight than a choice — that is
// the 2026-08-21 incident, where someone created a character, never selected
// it, and sent a character-less render without realising. Veo is different
// because the composer actively recommends it as the way to render without a
// character, so an empty selector there is the intended state.
//
// A positioning decision, in other words, not a capability — which is why it
// lives as its own list instead of being inferred from the table above.
// Consumed by the composer to decide whether to warm the character chip.
export const CHARACTERLESS_MODEL_IDS: readonly string[] = ["veo"];

// ---------------------------------------------------------------------------
// Input snapshot
// ---------------------------------------------------------------------------

/** Attachment roles. Since 2026-08-25 ("discard the classifier" decision)
 * new clients send exactly ONE role: "reference" — the attachment rides to
 * the model neutrally and the USER'S PROMPT says what it's for. The older
 * explicit roles remain accepted from transitional clients, and role
 * undefined is the permanent legacy contract (identity/face override). */
export type AttachmentRole = "reference" | "identity" | "outfit" | "scene" | "prop" | "unused";

export type ResolveInput = {
  contentType: "image" | "video";
  /** the FINAL model — after any server-side pin/reroute when resolved there */
  modelId: string;
  character: null | {
    name: string;
    referencePhotoCount: number;
    hasOutfit: boolean;
    outfitOn: boolean;
    /** character_profiles.render style once P3 lands; null/undefined = unknown */
    photoreal?: boolean | null;
  };
  companionsCount: number;
  attachments: {
    id: string;
    isImage: boolean;
    width?: number;
    height?: number;
    /** See ChatAttachment.style — absent means unknown, which never silences. */
    style?: "photoreal" | "illustrated" | null;
    role?: AttachmentRole;
  }[];
  anchorPhotoPicked: boolean;
  advancedMode: "none" | "multiref" | "storyboard";
  multiRefCount: number;
  storyboardStart: boolean;
  storyboardEnd: boolean;
  /** kling-o3-pro shot-list storyboard (a different feature from start/end frames) */
  storyboardShotsActive: boolean;
  continueFromId: string | null;
  dialogueText: string;
  dialogueVoiceAssigned: boolean;
  durationSeconds?: number;
  aspect?: string | null;
  rulesSkipArmed: boolean;
};

// ---------------------------------------------------------------------------
// Output
// ---------------------------------------------------------------------------

export type PlanSlot =
  | "identity"
  | "outfit"
  | "scene"
  | "prop"
  | "reference"
  | "continuation"
  | "frames"
  | "cast"
  | "dialogue"
  | "storyboard"
  | "rulesOverride";

export type PlanSource =
  | "attachment"
  | "gallery-pick"
  | "character-default"
  | "character-outfit"
  | "multiref"
  | "storyboard-frames"
  | "prior-clip"
  | "typed"
  | "none";

/** consumption: what actually happens to this input on the chosen model */
export type PlanConsumption = "native" | "described" | "dropped" | "absent";

export type PlanEntry = {
  slot: PlanSlot;
  source: PlanSource;
  consumption: PlanConsumption;
  /** typed note code for UI copy (i18n-mapped); never a sentence */
  noteCode?: PlanNoteCode;
  /** display name where relevant (character name etc.) */
  label?: string;
};

export type PlanNoteCode =
  | "REPLACES_SAVED_FACE"
  | "IGNORED_IN_ADVANCED_MODE"
  | "EXTRA_ATTACHMENT_UNUSED"
  | "OUTFIT_DESCRIBED_ONLY"
  | "GENERIC_PERSON"
  | "NEEDS_CHARACTER"
  | "OUTFIT_BUDGET_DROPPED"
  | "OUTFIT_ATTACHMENT_UNSUPPORTED";

export type IssueCode =
  | "NEEDS_REFERENCE_PHOTO"
  | "CONTINUE_NEEDS_SEEDANCE"
  | "DIALOGUE_NEEDS_VOICE"
  | "SEEDANCE25_PHOTOREAL"
  | "DIALOGUE_LONGER_THAN_CLIP"
  | "DIALOGUE_CUE_PAST_CLIP"
  | "REF_ASPECT_OUT_OF_RANGE"
  | "MODEL_CANNOT_MULTI_PERSON";

/**
 * Roughly how long a dialogue line will take to say, in seconds.
 *
 * MEASURED, not guessed. Two real ElevenLabs v3 renders on 2026-09-04, timed
 * off their own MP3 frame headers:
 *   "Hello."                       1 word,  6 chars  -> 1.07 s
 *   a 37-word sentence           37 words, 198 chars -> 11.55 s
 * Fitting a line through those two gives 3.44 words/second with a 0.78 s
 * fixed cost — the lead-in and tail silence a one-word clip is almost
 * entirely made of.
 *
 * It is a TWO-POINT fit and it is only ever used to decide whether to show a
 * warning, never to bill, block or trim anything. v3 is expressive: emotion
 * tags, punctuation and language all move the real number. Treat ±20% as
 * ordinary and keep the copy hedged ("about").
 */
export const SPEECH_FIXED_SECONDS = 0.8;
export const SPEECH_WORDS_PER_SECOND = 3.4;

// Relative, not "@/": this module is loaded by vitest, which resolves no
// aliases here — the same trap provider-url.ts documents.
export { parseDialogueCue } from "./dialogue-cue";
import { parseDialogueCue } from "./dialogue-cue";

export function estimateSpeechSeconds(text: string): number {
  const words = text.trim().split(/\s+/).filter(Boolean).length;
  if (words === 0) return 0;
  return SPEECH_FIXED_SECONDS + words / SPEECH_WORDS_PER_SECOND;
}

export type PlanIssue = {
  severity: "block" | "warn";
  code: IssueCode;
  params?: Record<string, string>;
  /** one-tap remedies the UI can wire */
  action?: "switch-photoreal-model" | "remove-attachment" | "clear-dialogue" | "clear-continuation" | "pick-character";
};

export type SendPlan = {
  modelId: string;
  contentType: "image" | "video";
  entries: PlanEntry[];
  issues: PlanIssue[];
};

// ---------------------------------------------------------------------------
// The resolver
// ---------------------------------------------------------------------------

// Where a photoreal send goes when the selected model refuses real faces.
//
// Ordered by how much of the refused send survives the move, then by cost:
// seedance-2 keeps the citation identity lane, outfit photos and clip
// continuation; kling-o3-pro keeps 4 reference images and is less than half
// the per-second price; the rest trade features for cheapness. The FIRST
// entry whose table row still says "accepts" wins.
//
// A list, not a literal (2026-09-03). The remedy used to hardcode
// "seedance-2" in three places, which was fine only while that row said
// "accepts". The day a provider tightens its likeness filter, a hardcoded
// remedy becomes a button offering to move you to the model that just
// refused you — so the destination is now read from the same table the
// warning is read from, and disappears when nothing accepts.
const PHOTOREAL_FALLBACK_ORDER = [
  "seedance-2",
  "kling-o3-pro",
  "kling-2.5",
  "minimax-h3",
  "kling",
] as const;

export function photorealFallback(fromModelId: string): string | null {
  for (const id of PHOTOREAL_FALLBACK_ORDER) {
    if (id === fromModelId) continue;
    const caps = (MODEL_CAPABILITIES as Record<string, ModelCapabilities | undefined>)[id];
    if (caps?.photorealPolicy === "accepts") return id;
  }
  return null;
}

export function resolveSendPlan(input: ResolveInput): SendPlan {
  const caps = (MODEL_CAPABILITIES as Record<string, ModelCapabilities | undefined>)[
    input.contentType === "image" ? input.modelId || "gpt-image" : input.modelId
  ];
  const entries: PlanEntry[] = [];
  const issues: PlanIssue[] = [];
  const character = input.character;
  const characterName = character?.name ?? "";
  const hasSavedPhotos = (character?.referencePhotoCount ?? 0) > 0;
  // Roles (P2): an attachment occupies the identity slot only when its role
  // says so — or when it carries no role at all, which is the permanent
  // legacy contract (old native shells, pre-classification sends). Outfit
  // and scene roles route to their own lanes; "unused" is an explicit
  // opt-out that never rides and never nags.
  const firstImageAttachment = input.attachments.find(
    (a) => a.isImage && (a.role === undefined || a.role === "identity"),
  );
  const outfitAttachment = input.attachments.find((a) => a.isImage && a.role === "outfit");
  const sceneAttachment = input.attachments.find((a) => a.isImage && a.role === "scene");
  const propAttachment = input.attachments.find((a) => a.isImage && a.role === "prop");
  const referenceAttachment = input.attachments.find((a) => a.isImage && a.role === "reference");
  // THE MODEL FOLLOWS THE PROMPT (operator, 2026-08-31).
  //
  // The 2026-08-25 decision made every attachment a NEUTRAL reference whose
  // meaning comes from the user's prompt. The identity ladder below was
  // never updated to match, so the one role that decision created was the
  // one role that could not supply a face — attach a portrait with no
  // character selected and the send was blocked, telling you to pick a
  // character you might not have. That is the classifier deciding for you
  // again, only with a hardcoded answer instead of a model's.
  //
  // So a neutral attachment now stands in for identity — but ONLY when
  // nothing else can supply one. With a character selected, the character's
  // own photo is still the face and the attachment stays a neutral extra:
  // that path works, is well covered, and nobody asked to change it.
  const identityFromSaved =
    (input.anchorPhotoPicked && hasSavedPhotos) ||
    (hasSavedPhotos && caps != null && caps.identity.mechanism !== "none");
  const referenceAsIdentity =
    !firstImageAttachment && !identityFromSaved && referenceAttachment ? referenceAttachment : undefined;
  const advanced = input.contentType === "video" ? input.advancedMode : "none";
  const isMulti = input.companionsCount > 0;

  // --- cast (several different characters in one render) ------------------
  if (isMulti && character) {
    entries.push({
      slot: "cast",
      source: "character-default",
      consumption: caps && !caps.multiPerson ? "dropped" : "native",
      label: characterName,
    });
    if (caps && !caps.multiPerson) {
      issues.push({ severity: "block", code: "MODEL_CANNOT_MULTI_PERSON", params: { model: input.modelId } });
    }
  }

  // --- identity ------------------------------------------------------------
  // Today's real priority ladder (actions.ts ~1006-1041): attachment wins,
  // then the explicit gallery pick, then the character's photo [0]. In
  // multiref/storyboard/companion modes the attachment is silently ignored —
  // the receipt makes that visible instead of silent.
  if (!isMulti) {
    if (advanced === "multiref") {
      entries.push({ slot: "identity", source: "multiref", consumption: "native", label: characterName });
      if (firstImageAttachment) {
        entries.push({
          slot: "identity",
          source: "attachment",
          consumption: "dropped",
          noteCode: "IGNORED_IN_ADVANCED_MODE",
        });
      }
    } else if (advanced === "storyboard") {
      entries.push({ slot: "frames", source: "storyboard-frames", consumption: "native" });
      if (firstImageAttachment) {
        entries.push({
          slot: "identity",
          source: "attachment",
          consumption: "dropped",
          noteCode: "IGNORED_IN_ADVANCED_MODE",
        });
      }
    } else if (firstImageAttachment) {
      entries.push({
        slot: "identity",
        source: "attachment",
        consumption: "native",
        noteCode: hasSavedPhotos ? "REPLACES_SAVED_FACE" : undefined,
        label: characterName || undefined,
      });
    } else if (referenceAsIdentity) {
      // Your photo, your prompt, no character required.
      entries.push({
        slot: "identity",
        source: "attachment",
        consumption: "native",
      });
    } else if (input.anchorPhotoPicked && hasSavedPhotos) {
      entries.push({ slot: "identity", source: "gallery-pick", consumption: "native", label: characterName });
    } else if (hasSavedPhotos && caps && caps.identity.mechanism !== "none") {
      entries.push({ slot: "identity", source: "character-default", consumption: "native", label: characterName });
    } else {
      entries.push({
        slot: "identity",
        source: "none",
        consumption: "absent",
        // Two different truths (operator, 2026-08-26: "clicking through the
        // AI models, they all say Face: generic person"): on a model that
        // can genuinely render a generic person, say that; on a model whose
        // identity input is REQUIRED, a generic send is impossible and the
        // line must say what's actually needed instead.
        noteCode: caps?.identity.required ? "NEEDS_CHARACTER" : "GENERIC_PERSON",
        label: characterName || undefined,
      });
      if (caps?.identity.required) {
        issues.push({
          severity: "block",
          code: "NEEDS_REFERENCE_PHOTO",
          params: { model: input.modelId, name: characterName },
          action: character ? undefined : "pick-character",
        });
      }
    }
  }

  // Attachments that neither carry a consuming role nor were explicitly
  // opted out are decorative — say so instead of pretending.
  const consumed = new Set([
    firstImageAttachment,
    outfitAttachment,
    sceneAttachment,
    propAttachment,
    referenceAttachment,
  ]);
  const extraCount = input.attachments.filter(
    (a) => !consumed.has(a) && a.role !== "unused",
  ).length;
  if (extraCount > 0) {
    entries.push({
      slot: "identity",
      source: "attachment",
      consumption: "dropped",
      noteCode: "EXTRA_ATTACHMENT_UNUSED",
      label: String(extraCount),
    });
  }

  // --- outfit --------------------------------------------------------------
  // A per-message outfit attachment outranks the character's saved outfit
  // for this send. It only rides on models whose endpoints take an extra
  // clothing image (there is no stored description to fall back on for a
  // one-off attachment) — elsewhere it drops VISIBLY.
  const identityPresent = () =>
    entries.some((e) => e.slot === "identity" && e.consumption === "native");
  if (outfitAttachment && !isMulti && advanced === "none") {
    const nativeLane =
      Boolean(caps?.outfitImage) && identityPresent() && !input.storyboardShotsActive;
    entries.push({
      slot: "outfit",
      source: "attachment",
      consumption: nativeLane ? "native" : "dropped",
      noteCode: nativeLane ? undefined : "OUTFIT_ATTACHMENT_UNSUPPORTED",
    });
  } else if (character?.hasOutfit && character.outfitOn && !isMulti && advanced === "none") {
    const nativeLane =
      Boolean(caps?.outfitImage) && identityPresent() && !input.storyboardShotsActive;
    entries.push({
      slot: "outfit",
      source: "character-outfit",
      consumption: nativeLane ? "native" : "described",
      noteCode: nativeLane ? undefined : "OUTFIT_DESCRIBED_ONLY",
      label: characterName,
    });
  }

  // --- scene ---------------------------------------------------------------
  // A scene-role photo is vision-described into the prompt server-side —
  // prompt text works on every model, so this lane is universal.
  if (sceneAttachment && advanced === "none") {
    entries.push({ slot: "scene", source: "attachment", consumption: "described" });
  }

  // --- neutral reference ---------------------------------------------------
  // The current contract: the attachment goes to the model as-is where the
  // model can take an extra image (cited on Seedance, extra edit image on
  // GPT), and is vision-described into the prompt elsewhere — in BOTH cases
  // the user's own prompt says what to do with it. Identity always comes
  // from the character, never from a reference attachment.
  // Skipped when this same photo was promoted to identity above: it is the
  // face now, and listing it twice would have the receipt charge one
  // attachment to two slots.
  if (referenceAttachment && !referenceAsIdentity && advanced === "none") {
    const nativeLane = Boolean(caps?.outfitImage) && !input.storyboardShotsActive;
    entries.push({
      slot: "reference",
      source: "attachment",
      consumption: nativeLane ? "native" : "described",
    });
  }

  // --- prop ----------------------------------------------------------------
  // A prop-role photo (dog, car, product — any THING that should appear):
  // on cited-image models the actual photo rides beside the identity refs —
  // YOUR dog, not "a dog" — and elsewhere it is vision-described into the
  // prompt, so the lane always delivers something.
  if (propAttachment && !isMulti && advanced === "none") {
    const nativeLane =
      Boolean(caps?.outfitImage) && identityPresent() && !input.storyboardShotsActive;
    entries.push({
      slot: "prop",
      source: "attachment",
      consumption: nativeLane ? "native" : "described",
    });
  }

  // --- continuation --------------------------------------------------------
  if (input.continueFromId && input.contentType === "video") {
    const ok = Boolean(caps?.continuation);
    entries.push({ slot: "continuation", source: "prior-clip", consumption: ok ? "native" : "dropped" });
    if (!ok) {
      issues.push({
        severity: "block",
        code: "CONTINUE_NEEDS_SEEDANCE",
        params: { model: input.modelId },
        action: "clear-continuation",
      });
    }
  }

  // --- dialogue ------------------------------------------------------------
  // The hidden-dialogue-trap made visible: typed dialogue ALWAYS ships, so
  // it is ALWAYS on the receipt — even (especially) when its field is not
  // rendered.
  if (input.contentType === "video" && input.dialogueText.trim().length > 0) {
    entries.push({ slot: "dialogue", source: "typed", consumption: "native" });
    if (!input.dialogueVoiceAssigned) {
      issues.push({
        severity: "block",
        code: "DIALOGUE_NEEDS_VOICE",
        params: { name: characterName },
        action: "clear-dialogue",
      });
    }

    // THE DIALOGUE NEVER SETS THE VIDEO'S LENGTH (operator rule, 2026-09-05:
    // "The Dialogue box does not define the length of the video, period").
    // job-runner enforces it at lipsync time by measuring the real audio and
    // cutting it at the clip's end when it runs long. This warning is the
    // courtesy that goes with that rule: it fires BEFORE the send, names both
    // numbers, and lets the person shorten the line or lengthen the clip
    // while it is still free to do either.
    //
    // A warn rather than a block, and no one-tap remedy: the honest fixes
    // are edits only the person can make.
    // A leading "(11s)" cue moves the line, so the thing measured against the
    // clip is where the line ENDS: cue + speech. The estimator sees only the
    // words — the cue is stripped before TTS and becomes leading silence at
    // lipsync time (job-runner), so it is placement, not speech.
    const cue = parseDialogueCue(input.dialogueText);
    const spokenSeconds = estimateSpeechSeconds(cue.spokenText);
    if (input.durationSeconds) {
      if (cue.startSeconds && cue.startSeconds + spokenSeconds > input.durationSeconds) {
        issues.push({
          severity: "warn",
          code: "DIALOGUE_CUE_PAST_CLIP",
          params: {
            start: String(cue.startSeconds),
            clip: String(input.durationSeconds),
          },
        });
      } else if (!cue.startSeconds && spokenSeconds > input.durationSeconds) {
        issues.push({
          severity: "warn",
          code: "DIALOGUE_LONGER_THAN_CLIP",
          params: {
            spoken: String(Math.round(spokenSeconds)),
            clip: String(input.durationSeconds),
          },
        });
      }
    }
  }

  // --- storyboard shot list ------------------------------------------------
  if (input.storyboardShotsActive) {
    entries.push({ slot: "storyboard", source: "typed", consumption: caps?.storyboard ? "native" : "dropped" });
  }

  // --- rules override ------------------------------------------------------
  if (input.rulesSkipArmed) {
    entries.push({ slot: "rulesOverride", source: "typed", consumption: "native" });
  }

  // --- model-policy issues -------------------------------------------------
  // Seedance 2.5 photoreal lane. Precision rule (P3+): when the character's
  // photoreal flag is KNOWN, key on it; when unknown (null/undefined), fall
  // back to today's referencePhotos-length heuristic — the rule must never
  // have a coverage gap (adversarial-review requirement).
  if (
    input.contentType === "video" &&
    caps?.photorealPolicy === "rejects" &&
    !isMulti
  ) {
    const photorealKnown = character?.photoreal === true;
    // Same "never leave a coverage gap" rule, extended to the lane opened
    // above: a face that arrived as an attachment has no stored style
    // judgement at all, so it falls to the same assumption a character with
    // photos and no judgement gets — assume a real person, and warn. Without
    // this, the newly-unblocked send would walk into a ByteDance refusal
    // with nothing on screen having mentioned it.
    // A face that arrived as an attachment: warn unless the upload-time
    // classifier positively said it is not a real person. Unknown still
    // warns — the rule must never have a coverage gap — but a mascot or a
    // rendered character no longer gets told it might be refused for looking
    // too human.
    const attachedFaceMightBeReal =
      Boolean(referenceAsIdentity) && referenceAsIdentity?.style !== "illustrated";
    const heuristic =
      (character?.photoreal == null && hasSavedPhotos) || attachedFaceMightBeReal;
    if (photorealKnown || heuristic) {
      // No accepting model left = warn with no remedy, rather than a button
      // that moves you nowhere useful.
      const target = photorealFallback(input.modelId);
      issues.push({
        severity: "warn",
        code: "SEEDANCE25_PHOTOREAL",
        params: target ? { name: characterName, target } : { name: characterName },
        ...(target ? { action: "switch-photoreal-model" as const } : {}),
      });
    }
  }

  // Reference-aspect bounds (kling-o3 family): only checkable when the
  // candidate identity image carries dimensions (upload metadata, P1+).
  if (caps?.refAspectBounds && firstImageAttachment?.width && firstImageAttachment?.height) {
    const ratio = firstImageAttachment.width / firstImageAttachment.height;
    if (ratio < caps.refAspectBounds.min || ratio > caps.refAspectBounds.max) {
      issues.push({
        severity: "block",
        code: "REF_ASPECT_OUT_OF_RANGE",
        params: {
          model: input.modelId,
          min: String(caps.refAspectBounds.min),
          max: String(caps.refAspectBounds.max),
        },
        action: "remove-attachment",
      });
    }
  }

  return { modelId: input.modelId, contentType: input.contentType, entries, issues };
}
