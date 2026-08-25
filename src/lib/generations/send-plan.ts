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
  | "kling-o3-pro"
  | "seedance"
  | "seedance-2"
  | "veo";
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
  /** ByteDance 2.5 rejects photoreal people; everything else accepts */
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
    photorealPolicy: "accepts",
    imageBudget: 4,
  },
  veo: {
    kind: "video",
    identity: { max: 0, mechanism: "none", required: false },
    outfitImage: false,
    continuation: false,
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
  flux: {
    kind: "image",
    identity: { max: 1, mechanism: "first-frame", required: false },
    outfitImage: false,
    continuation: false,
    startEndFrames: false,
    storyboard: false,
    multiPerson: false,
    aspectControl: "none",
    photorealPolicy: "accepts",
  },
};

// ---------------------------------------------------------------------------
// Input snapshot
// ---------------------------------------------------------------------------

/** A future attachment role (P2). P0 attachments carry no role yet. */
export type AttachmentRole = "identity" | "outfit" | "scene" | "unused";

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
  | "OUTFIT_BUDGET_DROPPED";

export type IssueCode =
  | "NEEDS_REFERENCE_PHOTO"
  | "CONTINUE_NEEDS_SEEDANCE"
  | "DIALOGUE_NEEDS_VOICE"
  | "SEEDANCE25_PHOTOREAL"
  | "REF_ASPECT_OUT_OF_RANGE"
  | "MODEL_CANNOT_MULTI_PERSON";

export type PlanIssue = {
  severity: "block" | "warn";
  code: IssueCode;
  params?: Record<string, string>;
  /** one-tap remedies the UI can wire */
  action?: "switch-seedance-2" | "remove-attachment" | "clear-dialogue" | "clear-continuation" | "pick-character";
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

export function resolveSendPlan(input: ResolveInput): SendPlan {
  const caps = (MODEL_CAPABILITIES as Record<string, ModelCapabilities | undefined>)[
    input.contentType === "image" ? input.modelId || "gpt-image" : input.modelId
  ];
  const entries: PlanEntry[] = [];
  const issues: PlanIssue[] = [];
  const character = input.character;
  const characterName = character?.name ?? "";
  const hasSavedPhotos = (character?.referencePhotoCount ?? 0) > 0;
  const firstImageAttachment = input.attachments.find((a) => a.isImage);
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
    } else if (input.anchorPhotoPicked && hasSavedPhotos) {
      entries.push({ slot: "identity", source: "gallery-pick", consumption: "native", label: characterName });
    } else if (hasSavedPhotos && caps && caps.identity.mechanism !== "none") {
      entries.push({ slot: "identity", source: "character-default", consumption: "native", label: characterName });
    } else {
      entries.push({
        slot: "identity",
        source: "none",
        consumption: "absent",
        noteCode: "GENERIC_PERSON",
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

  // Extra attachments beyond the first image are decorative today — say so.
  const extraCount = input.attachments.filter((a) => a !== firstImageAttachment).length;
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
  if (character?.hasOutfit && character.outfitOn && !isMulti && advanced === "none") {
    const identityPresent = entries.some(
      (e) => e.slot === "identity" && e.consumption === "native",
    );
    const nativeLane = Boolean(caps?.outfitImage) && identityPresent && !input.storyboardShotsActive;
    entries.push({
      slot: "outfit",
      source: "character-outfit",
      consumption: nativeLane ? "native" : "described",
      noteCode: nativeLane ? undefined : "OUTFIT_DESCRIBED_ONLY",
      label: characterName,
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
    const heuristic = character?.photoreal == null && hasSavedPhotos;
    if (photorealKnown || heuristic) {
      issues.push({
        severity: "warn",
        code: "SEEDANCE25_PHOTOREAL",
        params: { name: characterName },
        action: "switch-seedance-2",
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
