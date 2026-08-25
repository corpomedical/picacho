// Incident-replay suite for the Send Receipt resolver (P-1 of the composer
// redesign). Every case is a REAL incident from the 2026-08 failure catalog
// (workflow wf_f7d8820c-472) or a latent hazard it surfaced — the resolver
// must answer each one correctly forever. When behavior deliberately changes
// in a later phase, the test changes IN THE SAME COMMIT, never silently.

import { describe, expect, it } from "vitest";
import { resolveSendPlan, type ResolveInput } from "./send-plan";

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
    expect(issue(plan, "SEEDANCE25_PHOTOREAL")?.action).toBe("switch-seedance-2");
    expect(issue(plan, "SEEDANCE25_PHOTOREAL")?.severity).toBe("warn");
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

describe("rules override visibility (generate-anyway drift family)", () => {
  it("an armed rules skip is a visible receipt entry, never a silent flag", () => {
    const plan = resolveSendPlan({ ...base, rulesSkipArmed: true });
    expect(entry(plan, "rulesOverride")).toBeDefined();
  });
});
