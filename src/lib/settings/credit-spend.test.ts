import { describe, expect, it } from "vitest";
import { classifySpend, spendKind } from "./credit-spend";
import { resolveSettingsTab, settingsHref } from "./tabs";

describe("where the credits went", () => {
  const helios = new Set(["take-1"]);

  it("names each render by what the person did", () => {
    expect(spendKind({ id: "take-1", content_type: "video", model_id: "kling-o3-pro", credits_used: 5 }, helios)).toBe("helios");
    expect(spendKind({ id: "u", content_type: "video", model_id: "flux-upscale", credits_used: 2 }, helios)).toBe("upscales");
    expect(spendKind({ id: "l", content_type: "image", model_id: "seedream-layerize", credits_used: 1 }, helios)).toBe("layers");
    expect(spendKind({ id: "m", content_type: "video", model_id: "recast-kling-edit", credits_used: 8 }, helios)).toBe("mystique");
    expect(spendKind({ id: "v", content_type: "video", model_id: "kling-o3-pro", credits_used: 3 }, helios)).toBe("videos");
    expect(spendKind({ id: "i", content_type: "image", model_id: "gpt-image", credits_used: 1 }, helios)).toBe("images");
  });

  it("adds them up, largest first, and leaves out refunds and empty kinds", () => {
    const parts = classifySpend(
      [
        { id: "v1", content_type: "video", model_id: "kling-o3-pro", credits_used: 5 },
        { id: "v2", content_type: "video", model_id: "kling-o3-pro", credits_used: 3 },
        { id: "take-1", content_type: "video", model_id: "kling-o3-pro", credits_used: 5 },
        { id: "i1", content_type: "image", model_id: "gpt-image", credits_used: 1 },
        // A refunded render keeps its row with credits_used set to 0.
        { id: "r", content_type: "video", model_id: "kling-o3-pro", credits_used: 0 },
      ],
      helios,
    );
    expect(parts).toEqual([
      { kind: "videos", credits: 8 },
      { kind: "helios", credits: 5 },
      { kind: "images", credits: 1 },
    ]);
  });
});

describe("the settings tabs", () => {
  it("answers to every name it had before the redesign", () => {
    expect(resolveSettingsTab("usage", { saved: "1" })).toEqual({ tab: "billing", redirect: "/app/settings?tab=billing&saved=1" });
    expect(resolveSettingsTab("account")).toEqual({ tab: "profile", redirect: "/app/settings?tab=profile" });
    expect(resolveSettingsTab("notifications")).toEqual({
      tab: "preferences",
      redirect: "/app/settings?tab=preferences#notifications",
    });
    expect(resolveSettingsTab("brand").redirect).toBe("/app/settings?tab=generation#brand-rules");
    expect(resolveSettingsTab("support").tab).toBe("help");
    expect(resolveSettingsTab("appearance").tab).toBe("preferences");
  });

  it("keeps the ones that did not change, and opens on the overview", () => {
    expect(resolveSettingsTab("security")).toEqual({ tab: "security", redirect: null });
    expect(resolveSettingsTab("privacy")).toEqual({ tab: "privacy", redirect: null });
    expect(resolveSettingsTab("generation")).toEqual({ tab: "generation", redirect: null });
    expect(resolveSettingsTab(undefined)).toEqual({ tab: "overview", redirect: null });
    expect(resolveSettingsTab("nonsense")).toEqual({ tab: "overview", redirect: null });
    expect(settingsHref("overview")).toBe("/app/settings");
    expect(settingsHref("billing")).toBe("/app/settings?tab=billing");
  });
});
