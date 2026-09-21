import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import en from "../i18n/messages/en";
import es from "../i18n/messages/es";
import pt from "../i18n/messages/pt";
import itMsgs from "../i18n/messages/it";

// Reference photos on the set page and in a shot (2026-09-21), read as
// source like the page's other tests: the Look chip's menu uploads, picks
// and removes them; a shot sends the picked one; the server draws its sheet
// and rides it in the look's own slot.

const read = (p: string) => readFileSync(join(__dirname, p), "utf8");
const view = read("../../components/sets/set-view.tsx");
const actions = read("actions.ts");

describe("in a shot", () => {
  it("rides a reference photo's sheet as the look, only when no earlier still is the look", () => {
    expect(actions).toContain("const refAsked = !lookAsked && UUID_RE.test(refId);");
    const branch = actions.slice(actions.indexOf("} else if (refAsked) {"), actions.indexOf("const framePath = setFramePath("));
    expect(branch).toContain("sourcePath: setRefPhotoPath(userId, setId, refId),");
    expect(branch).toContain("sheetPath: setRefSheetPath(userId, setId, refId),");
    expect(branch).toContain('look = { url: mediaUrl("generated-images", sheet.path) };');
    expect(branch).toContain("lookDropped = true;");
  });

  it("is listed with the set's page, and passed to the page", () => {
    expect(read("data.ts")).toContain('references: status === "ready" ? await listSetReferences(createAdminClient(), access.userId, row.id as string) : [],');
    expect(read("../../app/app/sets/[id]/page.tsx")).toContain("initialReferences={data.references}");
  });
});

describe("on the set page", () => {
  it("makes the Look chip a menu: off, the latest still, the photos, and an upload", () => {
    expect(view).toContain('onClick={() => toggleMenu("look")}');
    const menu = view.slice(view.indexOf("data-look-menu"), view.indexOf("data-look-upload"));
    expect(menu).toContain("pickLook(null);");
    expect(menu).toContain("pickLook(latestStill);");
    expect(menu).toContain("pickRefLook(r.id);");
    expect(menu).toContain("void removeRefPhoto(r.id)");
    expect(view).toContain("references.length < SET_REFS_MAX");
    expect(view).toContain("void uploadLookPhoto(file);");
  });

  it("uploads through the photo preparer and the checked action, then makes the photo the look", () => {
    const up = view.slice(view.indexOf("async function uploadLookPhoto("), view.indexOf("async function removeRefPhoto("));
    expect(up).toContain("prepared = await preparePhoto(file);");
    expect(up).toContain("res = await addSetReference(setId, { photoDataUri: prepared.dataUri });");
    expect(up).toContain("pickRefLook(added.id);");
  });

  it("sends the picked photo with the shot, and a still as the look lets go of it", () => {
    expect(view).toContain("lookRefId: lookShot ? null : (lookRef?.id ?? null),");
    const pick = view.slice(view.indexOf("function pickLook("), view.indexOf("function pickRefLook("));
    expect(pick).toContain("setLookRefId(null);");
  });

  it("says a photo that could not be drawn in its own words, not a still's", () => {
    expect(view).toContain("setLookDroppedPhoto(!lookShot && lookRef !== null);");
    expect(view).toContain("{lookDroppedPhoto ? s.lookRefDropped : s.lookDropped}");
    expect(en.sets.lookRefDropped).not.toContain("cut out");
  });
});

describe("the words", () => {
  it("exist in every language, and say a reference is never a person", () => {
    for (const m of [en, es, pt, itMsgs]) {
      for (const key of ["lookOnPhoto", "lookPhotos", "lookPhotoN", "lookPhotoUpload", "lookPhotoUploading", "lookPhotoRemove", "lookPhotoHint", "lookRefDropped"] as const) {
        expect(m.sets[key], key).toBeTruthy();
      }
      expect(m.sets.lookPhotoN).toContain("{n}");
      expect(m.sets.lookPhotoRemove).toContain("{n}");
      for (const key of ["setRefRefused", "setRefUnchecked", "setRefTooMany", "setRefTooFast"] as const) expect(m.serverText[key], key).toBeTruthy();
    }
    expect(en.sets.lookPhotoHint).toContain("Not a person");
  });
});
