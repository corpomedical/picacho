import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// The render lane carries a set's things' design sheets (R1, 2026-09-21):
// a new attachment role only a set shot sends, riding last, beside a photo
// of the person, on GPT Image only, capped at the shot's budget, fenced by
// the look's own note, and through the identity re-render too. Read as
// source: these files load the provider SDKs.

const read = (p: string) => readFileSync(join(__dirname, p), "utf8");
const actions = read("actions.ts");
const pipeline = read("pipeline.ts");
const image = read("providers/image.ts");
const gate = read("identity-gate-run.ts");

describe("the render lane's element sheets", () => {
  it("takes the role from a set shot, every sheet in order, never as a composer attachment", () => {
    expect(actions).toContain('["reference", "identity", "outfit", "scene", "prop", "look", "element", "unused"].includes(');
    expect(actions).toContain('const elementAttachmentUrls = attachmentRoles?.filter((a) => a.role === "element").map((a) => a.url) ?? [];');
    expect(actions).toContain('a.role !== "look" && a.role !== "element"');
  });

  it("sends them only on a set shot, beside the person, on GPT Image, capped at the shot's budget", () => {
    const guard = actions.slice(actions.indexOf("const elementImageUrls ="), actions.indexOf("elementSheetsSent = elementImageUrls?.length ?? 0;"));
    for (const cond of ["isSetShot &&", "referenceImageUrl &&", 'contentType === "image" &&', "!wantsMultiCharacter &&", "!storyboardShots &&", 'imageModelId === "gpt-image"']) {
      expect(guard, cond).toContain(cond);
    }
    expect(guard).toContain(".slice(0, ELEMENT_SHEETS_PER_STILL)");
    expect(actions).toContain("...(elementSheetsSent > 0 ? { elementSheets: elementSheetsSent } : {}),");
  });

  it("passes them to the pipeline and the identity re-render, and the pipeline fences them like the look", () => {
    expect(actions.match(/\n\s+elementImageUrls,\n/g)).toHaveLength(2);
    expect(pipeline).toContain("const elementsActive = Boolean(options.elementImageUrls?.length && !usingMultiCharacterImages && options.referenceImageUrl);");
    expect(pipeline).toContain("look: lookActive || placeActive || elementsActive,");
    expect(pipeline).toContain("elementsActive ? options.elementImageUrls : null,");
    expect(image).toContain("elements: elementImageUrls,");
    expect(gate).toContain("deps.rerender.elementImageUrls ?? null,");
  });
});
