// Incident-replay suite for the Send Receipt resolver (P-1 of the composer
// redesign). Every case is a REAL incident from the 2026-08 failure catalog
// (workflow wf_f7d8820c-472) or a latent hazard it surfaced — the resolver
// must answer each one correctly forever. When behavior deliberately changes
// in a later phase, the test changes IN THE SAME COMMIT, never silently.

import { describe, expect, it } from "vitest";
import {
  CHARACTERLESS_MODEL_IDS,
  MODEL_CAPABILITIES,
  estimateSpeechSeconds,
  resolveSendPlan,
  type ResolveInput,
  photorealFallback,
} from "./send-plan";

const base: ResolveInput = {
  contentType: "video",
  modelId: "kling-o3-pro",
  character: {
    name: "Eva",
    referencePhotoCount: 3,
    hasOutfit: false,
    outfitOn: true,
    photoreal: null,
  },
  companionsCount: 0,
  attachments: [],
  anchorPhotoPicked: false,
  advancedMode: "none",
  multiRefCount: 0,
  storyboardStart: false,
  storyboardEnd: false,
  storyboardShotsActive: false,
  continueFromId: null,
  dialogueText: "",
  dialogueVoiceAssigned: false,
  rulesSkipArmed: false,
};

const entry = (plan: ReturnType<typeof resolveSendPlan>, slot: string) =>
  plan.entries.find((e) => e.slot === slot);
const issue = (plan: ReturnType<typeof resolveSendPlan>, code: string) =>
  plan.issues.find((i) => i.code === code);

describe("identity priority ladder (today's real semantics, made visible)", () => {
  it("attachment-anchor-hijack: an attached image replaces the saved face and the receipt says so", () => {
    const plan = resolveSendPlan({
      ...base,
      attachments: [{ id: "a", isImage: true }],
    });
    const id = entry(plan, "identity")!;
    expect(id.source).toBe("attachment");
    expect(id.noteCode).toBe("REPLACES_SAVED_FACE");
  });

  it("anchor-priority-shadowing: the attachment outranks an explicit gallery pick — visibly", () => {
    const plan = resolveSendPlan({
      ...base,
      anchorPhotoPicked: true,
      attachments: [{ id: "a", isImage: true }],
    });
    expect(entry(plan, "identity")!.source).toBe("attachment");
  });

  it("gallery pick anchors when no attachment competes", () => {
    const plan = resolveSendPlan({ ...base, anchorPhotoPicked: true });
    expect(entry(plan, "identity")!.source).toBe("gallery-pick");
  });

  it("characterless send on a reference-requiring model blocks before credits", () => {
    const plan = resolveSendPlan({ ...base, character: null });
    expect(entry(plan, "identity")!.consumption).toBe("absent");
    // The receipt line must NOT claim "generic person" here — this model
    // can't do one (operator, 2026-08-26).
    expect(entry(plan, "identity")!.noteCode).toBe("NEEDS_CHARACTER");
    expect(issue(plan, "NEEDS_REFERENCE_PHOTO")?.severity).toBe("block");
  });

  it("characterless send on a non-requiring model is a visible generic-person entry, not an error", () => {
    const plan = resolveSendPlan({ ...base, character: null, modelId: "kling" });
    expect(entry(plan, "identity")!.noteCode).toBe("GENERIC_PERSON");
    expect(plan.issues).toHaveLength(0);
  });
});

describe("silently-ignored inputs become visible drops", () => {
  it("attachment is dropped (not silently ignored) when multiref is armed", () => {
    const plan = resolveSendPlan({
      ...base,
      modelId: "kling",
      advancedMode: "multiref",
      multiRefCount: 3,
      attachments: [{ id: "a", isImage: true }],
    });
    const drop = plan.entries.find((e) => e.noteCode === "IGNORED_IN_ADVANCED_MODE");
    expect(drop?.consumption).toBe("dropped");
    expect(entry(plan, "identity")!.source).toBe("multiref");
  });

  it("second and later attachments are declared unused — the decorative-chip fiction ends", () => {
    const plan = resolveSendPlan({
      ...base,
      attachments: [
        { id: "a", isImage: true },
        { id: "b", isImage: true },
        { id: "c", isImage: false },
      ],
    });
    const extra = plan.entries.find((e) => e.noteCode === "EXTRA_ATTACHMENT_UNUSED");
    expect(extra?.label).toBe("2");
  });
});

describe("continuation (the ghost-chip family)", () => {
  it("continuation on a Seedance model rides natively", () => {
    const plan = resolveSendPlan({ ...base, modelId: "seedance-2", continueFromId: "gen1" });
    expect(entry(plan, "continuation")!.consumption).toBe("native");
  });

  it("continuation on a non-Seedance model is a visible block with a one-tap clear", () => {
    const plan = resolveSendPlan({ ...base, modelId: "kling-o3-pro", continueFromId: "gen1" });
    expect(entry(plan, "continuation")!.consumption).toBe("dropped");
    expect(issue(plan, "CONTINUE_NEEDS_SEEDANCE")?.action).toBe("clear-continuation");
  });

  it("continuation never appears on an image send (the ghost cannot exist there)", () => {
    const plan = resolveSendPlan({
      ...base,
      contentType: "image",
      modelId: "gpt-image",
      continueFromId: "gen1",
    });
    expect(entry(plan, "continuation")).toBeUndefined();
  });
});

describe("hidden-dialogue-trap: typed dialogue always surfaces", () => {
  it("stale dialogue text is a visible receipt entry even when its field is hidden", () => {
    const plan = resolveSendPlan({ ...base, dialogueText: "Hola!" });
    expect(entry(plan, "dialogue")).toBeDefined();
  });

  it("dialogue without an assigned voice blocks with a one-tap clear", () => {
    const plan = resolveSendPlan({ ...base, dialogueText: "Hola!", dialogueVoiceAssigned: false });
    expect(issue(plan, "DIALOGUE_NEEDS_VOICE")?.action).toBe("clear-dialogue");
  });

  it("dialogue with a voice assigned passes", () => {
    const plan = resolveSendPlan({ ...base, dialogueText: "Hola!", dialogueVoiceAssigned: true });
    expect(plan.issues.find((i) => i.code === "DIALOGUE_NEEDS_VOICE")).toBeUndefined();
  });
});

describe("outfit honesty per model", () => {
  const withOutfit: ResolveInput = {
    ...base,
    character: { ...base.character!, hasOutfit: true, outfitOn: true },
  };

  it("outfit rides natively on Seedance 2.0", () => {
    const plan = resolveSendPlan({ ...withOutfit, modelId: "seedance-2" });
    expect(entry(plan, "outfit")!.consumption).toBe("native");
  });

  it("outfit is described-in-words on the Kling family — the chip caption's truth, structurally", () => {
    const plan = resolveSendPlan({ ...withOutfit, modelId: "kling-o3-pro" });
    expect(entry(plan, "outfit")!.consumption).toBe("described");
    expect(entry(plan, "outfit")!.noteCode).toBe("OUTFIT_DESCRIBED_ONLY");
  });

  it("outfit-off means no outfit entry at all", () => {
    const plan = resolveSendPlan({
      ...withOutfit,
      modelId: "seedance-2",
      character: { ...withOutfit.character!, outfitOn: false },
    });
    expect(entry(plan, "outfit")).toBeUndefined();
  });
});

describe("seedance 2.5 photoreal lane (103-credit incident)", () => {
  it("photo-referenced character on 2.5 warns with the one-tap switch (heuristic, style unknown)", () => {
    const plan = resolveSendPlan({ ...base, modelId: "seedance" });
    expect(issue(plan, "SEEDANCE25_PHOTOREAL")?.action).toBe("switch-photoreal-model");
    expect(issue(plan, "SEEDANCE25_PHOTOREAL")?.severity).toBe("warn");
  });

  // The destination is read from the capability table, not written into the
  // remedy (2026-09-03). These pin the two properties that made the old
  // hardcoded "seedance-2" unsafe when a provider tightened its filter.
  it("the remedy names a target that actually accepts photoreal, and never the model being refused", () => {
    const plan = resolveSendPlan({ ...base, modelId: "seedance" });
    const target = issue(plan, "SEEDANCE25_PHOTOREAL")?.params?.target;
    expect(target).toBeDefined();
    expect(target).not.toBe("seedance");
    expect(MODEL_CAPABILITIES[target as keyof typeof MODEL_CAPABILITIES].photorealPolicy).toBe(
      "accepts",
    );
  });

  it("photorealFallback skips the model you are on and never lands on a rejecting one", () => {
    // Both Seedance lanes reject since 2026-09-03, so the remedy leaves the
    // family entirely — this assertion is what caught the capability flip.
    expect(photorealFallback("seedance")).toBe("kling-o3-pro");
    expect(photorealFallback("seedance-2")).toBe("kling-o3-pro");
    for (const from of ["seedance", "seedance-2", "zzz-unknown-model"]) {
      const target = photorealFallback(from);
      expect(target).toBeTruthy();
      expect(target).not.toBe(from);
      expect(
        MODEL_CAPABILITIES[target as keyof typeof MODEL_CAPABILITIES].photorealPolicy,
      ).toBe("accepts");
    }
  });

  it("a photoreal character on 2.0 now warns too — the lane it used to escape to", () => {
    const plan = resolveSendPlan({ ...base, modelId: "seedance-2" });
    expect(issue(plan, "SEEDANCE25_PHOTOREAL")?.severity).toBe("warn");
    expect(issue(plan, "SEEDANCE25_PHOTOREAL")?.params?.target).toBe("kling-o3-pro");
  });

  it("known-illustrated character on 2.5 passes clean — the heuristic's false positive dies with knowledge", () => {
    const plan = resolveSendPlan({
      ...base,
      modelId: "seedance",
      character: { ...base.character!, photoreal: false },
    });
    expect(issue(plan, "SEEDANCE25_PHOTOREAL")).toBeUndefined();
  });

  it("known-photoreal character on 2.5 warns even with zero saved photos — the heuristic's false negative dies too", () => {
    const plan = resolveSendPlan({
      ...base,
      modelId: "seedance",
      character: { ...base.character!, referencePhotoCount: 0, photoreal: true },
    });
    expect(issue(plan, "SEEDANCE25_PHOTOREAL")).toBeDefined();
  });
});

describe("kling-o3 reference aspect bounds (422-after-reserve incident)", () => {
  it("an extreme-aspect attachment blocks free, before credits", () => {
    const plan = resolveSendPlan({
      ...base,
      modelId: "kling-o3",
      attachments: [{ id: "a", isImage: true, width: 3000, height: 500 }],
    });
    expect(issue(plan, "REF_ASPECT_OUT_OF_RANGE")?.severity).toBe("block");
  });

  it("a normal photo passes; a dimensionless one never blocks (measurement failure is never a wall)", () => {
    const ok = resolveSendPlan({
      ...base,
      modelId: "kling-o3",
      attachments: [{ id: "a", isImage: true, width: 1024, height: 1024 }],
    });
    expect(issue(ok, "REF_ASPECT_OUT_OF_RANGE")).toBeUndefined();
    const unknown = resolveSendPlan({
      ...base,
      modelId: "kling-o3",
      attachments: [{ id: "a", isImage: true }],
    });
    expect(issue(unknown, "REF_ASPECT_OUT_OF_RANGE")).toBeUndefined();
  });
});

describe("multi-person routing", () => {
  it("companions on a multi-person model ride as cast", () => {
    const plan = resolveSendPlan({ ...base, modelId: "kling-o3-pro", companionsCount: 2 });
    expect(entry(plan, "cast")!.consumption).toBe("native");
  });

  it("companions on a single-person model block", () => {
    const plan = resolveSendPlan({ ...base, modelId: "kling-2.5", companionsCount: 1 });
    expect(issue(plan, "MODEL_CANNOT_MULTI_PERSON")?.severity).toBe("block");
  });
});

describe("attachment roles (P2 — the definitive intent capture)", () => {
  it("a clothing-role attachment rides the outfit lane on Seedance, never the face slot", () => {
    const plan = resolveSendPlan({
      ...base,
      modelId: "seedance-2",
      attachments: [{ id: "a", isImage: true, role: "outfit" }],
    });
    expect(entry(plan, "identity")!.source).toBe("character-default");
    const outfit = entry(plan, "outfit")!;
    expect(outfit.source).toBe("attachment");
    expect(outfit.consumption).toBe("native");
  });

  it("an outfit attachment on a person-only model drops VISIBLY (no stored description to fall back on)", () => {
    const plan = resolveSendPlan({
      ...base,
      modelId: "kling-o3-pro",
      attachments: [{ id: "a", isImage: true, role: "outfit" }],
    });
    expect(entry(plan, "outfit")!.consumption).toBe("dropped");
    expect(entry(plan, "outfit")!.noteCode).toBe("OUTFIT_ATTACHMENT_UNSUPPORTED");
  });

  it("a scene-role attachment (the mountain lake) is described — and the face warning cannot exist", () => {
    const plan = resolveSendPlan({
      ...base,
      attachments: [{ id: "a", isImage: true, role: "scene" }],
    });
    expect(entry(plan, "scene")!.consumption).toBe("described");
    expect(entry(plan, "identity")!.source).toBe("character-default");
    expect(plan.entries.find((e) => e.noteCode === "REPLACES_SAVED_FACE")).toBeUndefined();
  });

  it("a per-message outfit attachment outranks the character's saved outfit", () => {
    const plan = resolveSendPlan({
      ...base,
      modelId: "seedance-2",
      character: { ...base.character!, hasOutfit: true, outfitOn: true },
      attachments: [{ id: "a", isImage: true, role: "outfit" }],
    });
    const outfits = plan.entries.filter((e) => e.slot === "outfit");
    expect(outfits).toHaveLength(1);
    expect(outfits[0].source).toBe("attachment");
  });

  it("an explicit 'unused' role neither rides nor nags", () => {
    const plan = resolveSendPlan({
      ...base,
      attachments: [{ id: "a", isImage: true, role: "unused" }],
    });
    expect(entry(plan, "identity")!.source).toBe("character-default");
    expect(plan.entries.find((e) => e.noteCode === "EXTRA_ATTACHMENT_UNUSED")).toBeUndefined();
  });

  it("a role-less attachment keeps the permanent legacy contract: identity, visibly replacing", () => {
    const plan = resolveSendPlan({
      ...base,
      attachments: [{ id: "a", isImage: true }],
    });
    expect(entry(plan, "identity")!.source).toBe("attachment");
    expect(entry(plan, "identity")!.noteCode).toBe("REPLACES_SAVED_FACE");
  });
});

describe("prop role (P5 — animals, vehicles, products)", () => {
  it("a prop photo rides natively on cited-image models — YOUR dog, not 'a dog'", () => {
    const plan = resolveSendPlan({
      ...base,
      modelId: "seedance-2",
      attachments: [{ id: "a", isImage: true, role: "prop" }],
    });
    expect(entry(plan, "prop")!.consumption).toBe("native");
    expect(entry(plan, "identity")!.source).toBe("character-default");
  });

  it("a prop photo on a person-only model degrades to a description, never to silence", () => {
    const plan = resolveSendPlan({
      ...base,
      modelId: "kling-o3-pro",
      attachments: [{ id: "a", isImage: true, role: "prop" }],
    });
    expect(entry(plan, "prop")!.consumption).toBe("described");
  });

  it("prop never touches the face slot", () => {
    const plan = resolveSendPlan({
      ...base,
      attachments: [{ id: "a", isImage: true, role: "prop" }],
    });
    expect(plan.entries.find((e) => e.noteCode === "REPLACES_SAVED_FACE")).toBeUndefined();
  });
});

describe("neutral reference contract (2026-08-25 — the prompt says what the image is for)", () => {
  it("a reference attachment rides natively on extra-image models, prompt-driven", () => {
    const plan = resolveSendPlan({
      ...base,
      modelId: "seedance-2",
      attachments: [{ id: "a", isImage: true, role: "reference" }],
    });
    expect(entry(plan, "reference")!.consumption).toBe("native");
  });

  it("a reference attachment degrades to a prompt description elsewhere — never silence", () => {
    const plan = resolveSendPlan({
      ...base,
      modelId: "kling-o3-pro",
      attachments: [{ id: "a", isImage: true, role: "reference" }],
    });
    expect(entry(plan, "reference")!.consumption).toBe("described");
  });

  it("a reference attachment NEVER touches the face slot — the logo can't become a face", () => {
    const plan = resolveSendPlan({
      ...base,
      attachments: [{ id: "a", isImage: true, role: "reference" }],
    });
    expect(entry(plan, "identity")!.source).toBe("character-default");
    expect(plan.entries.find((e) => e.noteCode === "REPLACES_SAVED_FACE")).toBeUndefined();
  });
});

describe("rules override visibility (generate-anyway drift family)", () => {
  it("an armed rules skip is a visible receipt entry, never a silent flag", () => {
    const plan = resolveSendPlan({ ...base, rulesSkipArmed: true });
    expect(entry(plan, "rulesOverride")).toBeDefined();
  });
});

// Veo identity (2026-08-30). Veo used to be the one model in the catalogue
// that structurally could not hold a face — capability row { max: 0,
// mechanism: "none" }, every render blind text-to-video, receipt honestly
// reading "generic person". That was never a Veo limitation: fal-ai/veo3.1
// is text-to-video only, but fal-ai/veo3.1/image-to-video takes an image_url
// at the SAME per-second price ($0.40/s with audio at 720p/1080p, quoted
// from fal 2026-08-30). fal.ts now routes to the sibling whenever a
// character photo exists. This block had ZERO coverage before today, which
// is why flipping the capability row broke nothing and warned nobody.
describe("Veo identity", () => {
  const veo: ResolveInput = { ...base, modelId: "veo" };

  it("uses the character's saved photo instead of describing them in adjectives", () => {
    const plan = resolveSendPlan(veo);
    expect(entry(plan, "identity")!.source).toBe("character-default");
    expect(entry(plan, "identity")!.consumption).toBe("native");
  });

  it("still renders a generic person when nobody is cast, and does not block", () => {
    // The characterless Veo lane is the one the composer recommends when no
    // character is selected — it must keep working, and keep its full
    // compositional freedom on the text-to-video endpoint.
    const plan = resolveSendPlan({ ...veo, character: null });
    expect(entry(plan, "identity")!.noteCode).toBe("GENERIC_PERSON");
    expect(issue(plan, "NEEDS_REFERENCE_PHOTO")).toBeUndefined();
    expect(plan.issues.filter((i) => i.severity === "block")).toHaveLength(0);
  });

  it("lets an attached photo override the saved face, same as every other lane", () => {
    const plan = resolveSendPlan({ ...veo, attachments: [{ id: "a", isImage: true }] });
    expect(entry(plan, "identity")!.source).toBe("attachment");
  });
});

// Which models genuinely need a character (2026-08-30). identity.required is
// what BLOCKS a send; the composer's chip tint is a separate, deliberately
// narrower rule (CHARACTERLESS_MODEL_IDS — Veo only). Both are asserted so
// neither drifts.
describe("identity.required — what the character chip warns about", () => {
  it("requires a character on every lane that starts from a reference frame", () => {
    // These endpoints are image-to-video or reference-to-video: without a
    // photo there is nothing to start from, and send-plan blocks the send.
    for (const id of ["kling-2.5", "kling-o3", "kling-o3-pro", "seedance", "seedance-2"] as const) {
      expect(MODEL_CAPABILITIES[id].identity.required).toBe(true);
      const plan = resolveSendPlan({ ...base, modelId: id, character: null });
      expect(issue(plan, "NEEDS_REFERENCE_PHOTO")?.severity).toBe("block");
    }
  });

  it("Kling 1.6 and Veo do NOT require one, so neither blocks the send", () => {
    // Note the distinction the composer draws on top of this: only VEO is
    // treated as the characterless lane and left untinted. Kling 1.6 also
    // renders a generic person, but an unpicked character there is still
    // more likely an oversight, so its chip keeps the nudge. See
    // CHARACTERLESS_MODEL_IDS.
    for (const id of ["kling", "veo"] as const) {
      expect(MODEL_CAPABILITIES[id].identity.required).toBe(false);
      const plan = resolveSendPlan({ ...base, modelId: id, character: null });
      expect(issue(plan, "NEEDS_REFERENCE_PHOTO")).toBeUndefined();
      expect(entry(plan, "identity")!.noteCode).toBe("GENERIC_PERSON");
    }
  });
});

describe("CHARACTERLESS_MODEL_IDS — where an empty character chip is normal", () => {
  it("is Veo alone, not every model that merely tolerates no character", () => {
    // Operator, 2026-08-30: "the no tint only applies on Veo, not the rest".
    // Kling 1.6 has identity.required false too, but an unpicked character
    // there is still most likely the 2026-08-21 oversight, so it keeps the
    // nudge. This is positioning, not capability — hence its own list.
    expect(CHARACTERLESS_MODEL_IDS).toEqual(["veo"]);
    expect(CHARACTERLESS_MODEL_IDS).not.toContain("kling");
  });
});

// identity.max also drives whether the composer shows the "which photo
// should this match?" picker (2026-08-30). Since baseline multi-reference
// the four-slot lanes receive the whole gallery, so choosing one is asking a
// question the send no longer has an answer for; on a single-slot lane that
// one photo IS the render's identity and the choice is real.
describe("identity.max — how many photos actually ride", () => {
  it("gives four slots to the elements and citation lanes, so no photo pick is needed", () => {
    for (const id of ["kling", "kling-o3-pro", "seedance", "seedance-2"] as const) {
      expect(MODEL_CAPABILITIES[id].identity.max).toBe(4);
    }
  });

  it("gives ONE slot to the first-frame lanes and Veo, where the pick matters", () => {
    // On these the chosen photo is the render's whole identity — and on the
    // first-frame pair it is also the opening shot of the clip.
    for (const id of ["kling-o3", "kling-2.5", "veo"] as const) {
      expect(MODEL_CAPABILITIES[id].identity.max).toBe(1);
    }
  });

  it("gives ONE slot to both image lanes, which take a single source image", () => {
    for (const id of ["gpt-image", "flux"] as const) {
      expect(MODEL_CAPABILITIES[id].identity.max).toBe(1);
    }
  });
});

// The "scene reference" report (operator, 2026-08-31, with a screenshot):
// they attached an unmistakable portrait of Eva with no character selected,
// and the composer told them it would ride "as a scene reference".
//
// Nothing had looked at the photo. The classifier that once assigned
// Face/Outfit/Scene roles was deleted on 2026-08-25 (see AttachmentRole's
// comment above), every client now stamps role "reference" on every
// attachment, and the word "scene" survived only inside one warning string —
// so a mountain, a logo and a human face all got called a scene.
//
// These pin the two halves shut: the resolver must put a plain attachment in
// the reference slot and never the scene slot, and the copy must not name a
// slot the resolver did not produce.
describe("a characterless send with an attached photo (2026-08-31)", () => {
  // "seedance" is 2.5 — the model in the operator's screenshot, and the one
  // whose likeness check refuses real faces. ("seedance-2" is 2.0.)
  const attached: ResolveInput = {
    ...base,
    modelId: "seedance",
    character: null,
    attachments: [{ id: "a1", isImage: true, role: "reference" }],
  };

  it("uses the photo as the face — the model follows the prompt", () => {
    // The operator's decision: an attachment is neutral and the PROMPT says
    // what it is for, so with no character to take a face from, the attached
    // photo IS the face. Previously this send was blocked outright.
    const plan = resolveSendPlan(attached);
    const identity = plan.entries.find((e) => e.slot === "identity");
    expect(identity?.source).toBe("attachment");
    expect(identity?.consumption).toBe("native");
  });

  it("no longer demands a character for a send that has a face in it", () => {
    expect(resolveSendPlan(attached).issues.map((i) => i.code)).not.toContain(
      "NEEDS_REFERENCE_PHOTO",
    );
  });

  it("charges the one photo to one slot, not two", () => {
    // Promoted to identity, so it must not ALSO be listed as a neutral
    // reference — that would have the receipt describe one upload twice.
    const slots = resolveSendPlan(attached).entries.map((e) => e.slot);
    expect(slots.filter((x) => x === "identity" || x === "reference")).toEqual(["identity"]);
  });

  it("still warns that Seedance 2.5 refuses real faces", () => {
    // The newly-opened lane must not create a coverage gap in the fence: an
    // attached face carries no stored style judgement, so it gets the same
    // assumption as a character with photos and no judgement.
    expect(resolveSendPlan(attached).issues.map((i) => i.code)).toContain(
      "SEEDANCE25_PHOTOREAL",
    );
  });

  it("leaves the character path exactly as it was", () => {
    // With a character selected, the character is still the face and the
    // attachment is still a neutral extra. This is the well-covered path and
    // the decision did not touch it.
    const plan = resolveSendPlan({ ...attached, character: base.character });
    const identity = plan.entries.find((e) => e.slot === "identity");
    expect(identity?.source).not.toBe("attachment");
    expect(plan.entries.map((e) => e.slot)).toContain("reference");
  });

  it("never reaches the scene slot from anything a current client sends", () => {
    // The word "scene" came from one stale string, not a classification —
    // see the copy fix in the same commit. If a future change makes the
    // scene lane reachable again, the copy describing it must be revisited.
    for (const role of ["reference", undefined] as const) {
      const plan = resolveSendPlan({ ...attached, attachments: [{ id: "a1", isImage: true, role }] });
      expect(plan.entries.map((e) => e.slot)).not.toContain("scene");
    }
  });
});

// The empty-name bug the new lane exposed: SEEDANCE25_PHOTOREAL used to
// interpolate the character's name unconditionally, and with the face now
// arriving as an attachment there is no name — it read "if  is photoreal".
// The plan still has to hand the renderer an empty name here, so the copy
// picker branches on it; this pins the plan half of that contract.
describe("the Seedance warning without a character", () => {
  it("carries no name to interpolate", () => {
    const plan = resolveSendPlan({
      ...base,
      modelId: "seedance",
      character: null,
      attachments: [{ id: "a1", isImage: true, role: "reference" }],
    });
    const warn = plan.issues.find((i) => i.code === "SEEDANCE25_PHOTOREAL");
    expect(warn).toBeTruthy();
    expect(warn?.params?.name || "").toBe("");
  });
});

// "What if I upload a picture of a rendered character or mascot, will I get
// the same annoying msg?" (operator, 2026-08-31). Before this, yes — the
// warning fired on any attached photo standing in as the face, because
// nothing knew what was in it. It now asks the upload-time judgement.
describe("an attached face on Seedance 2.5", () => {
  const withStyle = (style?: "photoreal" | "illustrated" | null) =>
    resolveSendPlan({
      ...base,
      modelId: "seedance",
      character: null,
      attachments: [{ id: "a1", isImage: true, role: "reference", style }],
    }).issues.map((i) => i.code);

  it("stays quiet for a mascot or a rendered character", () => {
    expect(withStyle("illustrated")).not.toContain("SEEDANCE25_PHOTOREAL");
  });

  it("still warns for a real face", () => {
    expect(withStyle("photoreal")).toContain("SEEDANCE25_PHOTOREAL");
  });

  it("still warns when the judgement is missing — no coverage gap", () => {
    // Classifier failed, no API key, or an older client that sends no style.
    expect(withStyle(undefined)).toContain("SEEDANCE25_PHOTOREAL");
    expect(withStyle(null)).toContain("SEEDANCE25_PHOTOREAL");
  });

  it("never turns the warning into a block, whatever the answer", () => {
    for (const s of ["illustrated", "photoreal", null, undefined] as const) {
      const plan = resolveSendPlan({
        ...base,
        modelId: "seedance",
        character: null,
        attachments: [{ id: "a1", isImage: true, role: "reference", style: s }],
      });
      expect(plan.issues.filter((i) => i.severity === "block")).toEqual([]);
    }
  });
});

// The storyboard/prompt-cap collision (found 2026-08-31 during the live
// inspection). A storyboard joins up to six shots into ONE prompt string and
// posts it as the user's input; the server rejects input over
// MAX_PROMPT_LENGTH. Those two numbers were 6x1200 and 2000, so any
// storyboard with more than one detailed shot was refused after the person
// had already written every shot.
//
// This pins the arithmetic. It is deliberately written in terms of the real
// constants so that raising either one without checking the other fails here
// rather than in someone's composer.
describe("a full storyboard fits inside the server's prompt cap", () => {
  const MAX_SHOTS = 6;
  const MAX_SHOT_CHARS = 1200; // generate-form.tsx, the shot textarea's maxLength
  const SERVER_CAP = 8000; // actions.ts, MAX_PROMPT_LENGTH

  it("six full shots still fit, with the per-shot prefixes counted", () => {
    // Mirrors the join in generate-form.tsx: `Shot ${i + 1} (${s.seconds}s): `
    const worst = Array.from({ length: MAX_SHOTS }, (_, i) =>
      `Shot ${i + 1} (30s): ${"x".repeat(MAX_SHOT_CHARS)}`,
    ).join("\n");
    expect(worst.length).toBeLessThanOrEqual(SERVER_CAP);
  });

  it("the old cap really did reject a two-shot storyboard", () => {
    // Kept as the regression's own headstone: two detailed shots were already
    // over the 2,000 limit, so this was never an edge case.
    const twoShots = Array.from({ length: 2 }, (_, i) =>
      `Shot ${i + 1} (5s): ${"x".repeat(MAX_SHOT_CHARS)}`,
    ).join("\n");
    expect(twoShots.length).toBeGreaterThan(2000);
  });
});

describe("a dialogue line longer than the clip", () => {
  // The estimator's two constants come from real ElevenLabs v3 renders timed
  // off their own MP3 frame headers on 2026-09-04: "Hello." at 1.07s and a
  // 37-word sentence at 11.55s. These bounds pin the SHAPE of that fit, not
  // the vendor's exact speed — if it is ever re-measured they move with it,
  // deliberately and in the same commit.
  it("lands near the two clips it was fitted to", () => {
    expect(estimateSpeechSeconds("Hello.")).toBeGreaterThan(0.85);
    expect(estimateSpeechSeconds("Hello.")).toBeLessThan(1.35);
    const thirtySeven = Array.from({ length: 37 }, () => "word").join(" ");
    expect(estimateSpeechSeconds(thirtySeven)).toBeGreaterThan(9.5);
    expect(estimateSpeechSeconds(thirtySeven)).toBeLessThan(13.5);
  });

  it("is zero for an empty field, so a blank line can never warn", () => {
    expect(estimateSpeechSeconds("")).toBe(0);
    expect(estimateSpeechSeconds("   \n  ")).toBe(0);
  });

  it("warns with both numbers when the line outruns the clip", () => {
    const plan = resolveSendPlan({
      ...base,
      dialogueText: Array.from({ length: 60 }, () => "word").join(" "),
      dialogueVoiceAssigned: true,
      durationSeconds: 5,
    });
    const i = issue(plan, "DIALOGUE_LONGER_THAN_CLIP");
    expect(i?.severity).toBe("warn");
    expect(i?.params?.clip).toBe("5");
    expect(Number(i?.params?.spoken)).toBeGreaterThan(5);
    // No one-tap remedy on purpose: the honest fixes are "write less" or
    // "choose a longer clip", and both are edits only the person can make.
    expect(i?.action).toBeUndefined();
  });

  it("stays quiet when the line fits inside the clip", () => {
    const plan = resolveSendPlan({
      ...base,
      dialogueText: "Hello.",
      dialogueVoiceAssigned: true,
      durationSeconds: 10,
    });
    expect(issue(plan, "DIALOGUE_LONGER_THAN_CLIP")).toBeUndefined();
  });

  it("stays quiet when no duration is known, rather than inventing one", () => {
    const plan = resolveSendPlan({
      ...base,
      dialogueText: Array.from({ length: 60 }, () => "word").join(" "),
      dialogueVoiceAssigned: true,
      durationSeconds: undefined,
    });
    expect(issue(plan, "DIALOGUE_LONGER_THAN_CLIP")).toBeUndefined();
  });

  it("never fires on an image, which has no clip to outrun", () => {
    const plan = resolveSendPlan({
      ...base,
      contentType: "image",
      dialogueText: Array.from({ length: 60 }, () => "word").join(" "),
      dialogueVoiceAssigned: true,
      durationSeconds: 5,
    });
    expect(issue(plan, "DIALOGUE_LONGER_THAN_CLIP")).toBeUndefined();
  });
});
