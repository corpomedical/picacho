import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

// How the expression set is wired (2026-09-19), read as source: the pieces
// are server actions and a pipeline that call providers. What these hold is
// the promises the code makes in its comments.

const root = join(__dirname, "../..");
const read = (p: string) => readFileSync(join(root, p), "utf8");
const pipeline = read("lib/generations/pipeline.ts");
const generations = read("lib/generations/actions.ts");
const characters = read("lib/characters/actions.ts");
const setActions = read("lib/characters/expression-actions.ts");
const page = read("app/app/character/[id]/page.tsx");

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.(ts|tsx)$/.test(name) && !/\.test\.(ts|tsx)$/.test(name)) out.push(full);
  }
  return out;
}

describe("the column", () => {
  it("is named by one module only, so no other statement can fail on a database without it", () => {
    const naming = walk(root)
      .filter((file) => readFileSync(file, "utf8").includes("expression_set"))
      .map((file) => relative(root, file));
    expect(naming).toEqual(["lib/characters/expression-set-store.ts"]);
  });

  it("is read off rows loaded with select(\"*\") through the store, never by name", () => {
    expect(page).toContain("expressionSetOfRow(profile, userData.user.id)");
    expect(generations).toContain("expressionSetOfRow(character, userData.user.id)");
  });
});

describe("a render", () => {
  it("asks the drafter to read the face only when the character has a set", () => {
    expect(pipeline).toContain("(expressionSetSlots.length > 0 ? `\\n\\n${FACE_LINE_INSTRUCTION}` : \"\")");
  });

  it("takes the FACE line out before the overrides are split, so it reaches neither", () => {
    const take = pipeline.indexOf("takeFaceLine(rawDraftResponse)");
    const split = pipeline.indexOf("splitOverrides(faceTaken.text)");
    expect(take).toBeGreaterThan(-1);
    expect(split).toBeGreaterThan(take);
    expect(pipeline).not.toContain("splitOverrides(rawDraftResponse)");
  });

  it("sends the picked close-ups beside the character's own photo only, and says what they are", () => {
    expect(pipeline).toContain("!usingMultiCharacterImages && options.referenceImageUrl && options.expressionSet");
    expect(pipeline).toContain("pickSetForShot(expressionSetSlots, faceRead)");
    expect(pipeline).toContain("expressionSet: setUrls.length > 0,");
    expect(pipeline).toContain("setUrls.length > 0 ? setUrls : null,");
  });

  it("is offered the set only on a single-character image anchored to the character's saved photo", () => {
    expect(generations).toContain(
      'if (contentType === "image" && !wantsMultiCharacter && character && referenceImageUrl && !attachmentReferenceUrl) {',
    );
    // Only close-ups that pass the likeness floor are signed at all.
    expect(generations).toContain("const slots = usableSlots(set);");
    expect(generations).toContain("expressionSet: expressionSetLinks,");
  });
});

describe("making a close-up", () => {
  it("asks whether the set can be kept before anything is spent", () => {
    const make = setActions.slice(setActions.indexOf("export async function makeExpressionSlot"));
    const probe = make.indexOf("probeExpressionSet(");
    const spend = make.indexOf("generateReferenceImage(request)");
    expect(probe).toBeGreaterThan(-1);
    expect(spend).toBeGreaterThan(probe);
  });

  it("goes through the AI photo lane — its allowance, gate, picture check and refund — made from several pictures", () => {
    expect(setActions).toContain('request.set("expression_slot", slot);');
    expect(characters).toContain('const forExpressionSet = ((formData.get("expression_slot") as string | null) ?? "").trim().length > 0;');
    expect(characters).toContain("anchorPaths.slice(0, forExpressionSet ? 4 : 1)");
    // Every other AI photo is still made from the first photo alone.
    expect(characters).toContain("const references: string | string[] | null = referenceUrls.length > 1 ? referenceUrls : anchorUrl;");
  });

  it("never lands in the character's five photos", () => {
    expect(characters).toContain("if (characterId && !forExpressionSet) {");
  });

  it("makes a smile or a laugh from the set's teeth, when the set has usable ones", () => {
    expect(setActions).toContain("const withTeeth = chainsFromTeeth(slot) && teeth !== null;");
    expect(setActions).toContain("probe.set.teeth && isUsable(probe.set.teeth)");
  });
});

describe("deleting a character", () => {
  it("removes the set's files with it, read in the store's own query", () => {
    expect(characters.match(/const setPaths = Object\.values\(await readExpressionSet\(supabase, id, data\.user\.id\)\)/g)).toHaveLength(2);
    expect(characters.match(/\.\.\.setPaths,/g)).toHaveLength(2);
  });
});
