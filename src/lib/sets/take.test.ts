import { describe, expect, it } from "vitest";
import {
  buildSetTakePrompt,
  isSetTakeEngine,
  SET_TAKE_DEFAULT_ENGINE,
  SET_TAKE_ENGINES,
  takeQuoteInput,
} from "./take";
import { quoteSend } from "../generations/quote";
import { FILM_MOVE_WORDS, FILM_TEXTURE_WORDS } from "./moves";
import { MODEL_CAPABILITIES } from "../generations/send-plan";
import { getVideoModel, isValidDuration } from "../generations/providers/video-models";

// A take is a start-and-end-frame render at one fixed length per engine:
// the test pins each engine's model and seconds to what the action sends,
// that every engine really has a frame lane (the capability the server
// gate checks), the prompt's fixed sentences round the person's words, and
// that the quote the page shows is the one the server will charge.

describe("the take's request", () => {
  it("offers Omni as the take and Veo as the premium take", () => {
    expect(SET_TAKE_DEFAULT_ENGINE).toBe("omni");
    expect(SET_TAKE_ENGINES.omni.model).toBe("gemini-omni");
    expect(SET_TAKE_ENGINES.omni.seconds).toBe(5);
    expect(SET_TAKE_ENGINES.veo.model).toBe("veo");
    expect(SET_TAKE_ENGINES.veo.seconds).toBe(8);
    expect(isSetTakeEngine("omni")).toBe(true);
    expect(isSetTakeEngine("veo")).toBe(true);
    expect(isSetTakeEngine("kling")).toBe(false);
  });

  it("only names engines whose model has a real start/end-frame lane, at a length it sells", () => {
    for (const engine of Object.values(SET_TAKE_ENGINES)) {
      expect(MODEL_CAPABILITIES[engine.model as keyof typeof MODEL_CAPABILITIES].startEndFrames).toBe(true);
      expect(isValidDuration(getVideoModel(engine.model), engine.seconds)).toBe(true);
    }
  });

  it("quotes each engine at its own model and length", () => {
    const omni = takeQuoteInput();
    expect(omni.contentType).toBe("video");
    expect(omni.videoModelId).toBe("gemini-omni");
    expect(omni.videoDurationSeconds).toBe(5);
    expect(omni.framePicked).toBe(true);
    const veo = takeQuoteInput("veo");
    expect(veo.videoModelId).toBe("veo");
    expect(veo.videoDurationSeconds).toBe(8);
    // The premium take costs more — that is what makes it the premium take.
    expect(quoteSend(veo).totalCredits).toBeGreaterThan(quoteSend(omni).totalCredits);
  });

  it("prices the frame lane like the server — no surcharge where the lane bills its base rate", () => {
    for (const engine of ["omni", "veo"] as const) {
      const withFrame = quoteSend(takeQuoteInput(engine));
      const without = quoteSend({ ...takeQuoteInput(engine), framePicked: false });
      expect(withFrame.totalCredits).toBeGreaterThan(0);
      // Omni's and Veo's frame lanes bill the same per-second rate as their
      // base lanes (fal, read 2026-09-15), so framePicked must not inflate
      // the quote the way Kling's pricier storyboard endpoint did.
      expect(withFrame.totalCredits).toBe(without.totalCredits);
    }
  });

  it("wraps the person's words in the move, and stands without them", () => {
    const said = buildSetTakePrompt("she walks to the car and leans on it");
    expect(said).toContain("from the first frame to the last frame");
    expect(said).toContain("she walks to the car and leans on it");
    expect(said).toContain("exactly as the frames show them");
    const silent = buildSetTakePrompt("");
    expect(silent).toContain("carries the moment naturally");
  });

  it("cleans the direction like the shot action does", () => {
    const dirty = buildSetTakePrompt("a b   c");
    expect(dirty).toContain("a b c");
  });
});

describe("the take's words for a film beat's move (Helios Cinema)", () => {
  it("says the path and the textures between the frames, before the person's direction", () => {
    const prompt = buildSetTakePrompt("she freezes", { move: "dolly-zoom", textures: ["handheld"] });
    expect(prompt).toContain(FILM_MOVE_WORDS["dolly-zoom"]);
    expect(prompt).toContain(FILM_TEXTURE_WORDS.handheld);
    expect(prompt.indexOf(FILM_MOVE_WORDS["dolly-zoom"])).toBeLessThan(prompt.indexOf("she freezes"));
    expect(buildSetTakePrompt("she freezes")).not.toContain("Camera:");
  });
});

