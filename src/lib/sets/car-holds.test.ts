import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ELEMENT_GREY_SENTENCE, buildSetShotPrompt, withoutElementSentences } from "./set-shot-prompt";
import { SHEET_LANES } from "./elements";
import { SELECTABLE_IMAGE_MODEL_IDS } from "../generations/providers/image-models";

// "It is still not holding the car model. Each rendered image is a
// different car" (2026-09-24). His screenshot: the photo on the Car was a
// yellow car; Astra's blocks and the LOOK still were red; the stills came
// back red, one yellow. Pictures beat the sentence that said the car's own
// photos win. So the car is drawn grey in the sketch, a look that shows it
// stays out, and the still's engine is the person's to pick.

const read = (p: string) => readFileSync(join(__dirname, p), "utf8");
const view = read("../../components/sets/set-view.tsx");
const actions = read("actions.ts");
const lane = read("../generations/actions.ts");

describe("the car in the sketch", () => {
  it("is drawn grey when its own sheet rides, its lamps and dark parts kept so its heading still reads", () => {
    const grey = view.slice(view.indexOf("const greySketch = "), view.indexOf("/** The models flat for the sketch"));
    expect(grey).toContain("if (m.emissiveIntensity > 0 && m.emissive && m.emissive.getHex() !== 0) return;");
    expect(grey).toContain("< 0.03) return;");
    expect(grey).toContain("mesh.material = sketchGrey;");
    // Put back before the browser shows a frame.
    expect(view).toContain("for (const [mesh, was] of greyed) mesh.material = was;");
  });

  it("is grey in every frame a still is shot from: a still, a take's end, a film's beat", () => {
    expect(view.match(/const frame = apiRef\.current\?\.frame\(\{ grey \}\);/g)).toHaveLength(2);
    expect(view).toContain('const frame = job.end ? "" : api.frame({ from: beat.end, grey });');
    expect(view.match(/greyed: grey,/g)).toHaveLength(3);
  });

  it("is said to be grey only when every riding sheet's thing was, and the words go when the sheets cannot ride", () => {
    expect(actions).toContain("const allGrey = elementPlan.riding.length > 0 && elementPlan.riding.every((r) => greyed.has(r.key));");
    const shot = { description: "d", direction: "x", layout: null, elements: ["Sheet 1 is the car on the left."] };
    expect(buildSetShotPrompt({ ...shot, elementsGrey: true })).toContain(ELEMENT_GREY_SENTENCE);
    expect(buildSetShotPrompt(shot)).not.toContain(ELEMENT_GREY_SENTENCE);
    expect(withoutElementSentences(buildSetShotPrompt({ ...shot, elementsGrey: true }))).not.toContain(ELEMENT_GREY_SENTENCE);
  });
});

describe("the look", () => {
  it("stays out when it shows a thing now drawn from its own photos, and the page says so", () => {
    expect(actions).toContain("lookAside = lookCamera === null || elementPlaces(owned.spec, els, lookCamera).some((p) => p.seen && riding.has(p.key));");
    expect(actions).toContain("if (lookAsked && !lookAside) {");
    expect(view).toContain("setLookAside(result.lookAside);");
    expect(view).toContain("{s.lookAside}");
  });
});

describe("the still's engine", () => {
  it("is the composer's own two lanes, remembered in the browser, and sent with every still", () => {
    expect([...SELECTABLE_IMAGE_MODEL_IDS]).toEqual(["gpt-image", "gemini"]);
    expect(view).toContain('window.localStorage.setItem("helios.stillEngine", id);');
    expect(view).toContain("{SELECTABLE_IMAGE_MODEL_IDS.map((id) => (");
    expect(view.match(/stillEngine,\n/g)?.length).toBeGreaterThanOrEqual(3);
    expect(actions).toContain('if (pickedEngine) fd.set("image_model_id", pickedEngine);');
  });

  it("carries the things' sheets on Nano Banana Pro too, rendered in the frame's own shape", () => {
    expect([...SHEET_LANES]).toEqual(["gpt-image", "gemini"]);
    expect(lane).toContain("(SHEET_LANES as readonly string[]).includes(imageModelId)");
    expect(actions).toContain('fd.set("image_aspect", w === h ? "1:1" : w > h ? "3:2" : "2:3");');
  });
});
