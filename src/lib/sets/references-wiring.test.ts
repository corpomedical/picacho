import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import en from "../i18n/messages/en";
import es from "../i18n/messages/es";
import pt from "../i18n/messages/pt";
import itMsgs from "../i18n/messages/it";

// Reference photos on the set page (R1, 2026-09-21): they go on the things
// themselves — a tap on a car opens its card, the card uploads, the strip
// says what rides — and a still draws each thing's sheet before it is
// shot. The Look menu keeps stills only, and says where the photos went.
// Read as source like the page's other tests.

const read = (p: string) => readFileSync(join(__dirname, p), "utf8");
const view = read("../../components/sets/set-view.tsx");
const card = read("../../components/sets/element-card.tsx");
const strip = read("../../components/sets/cast-strip.tsx");
const actions = read("actions.ts");

const fnOf = (source: string, head: string, next: string) => {
  const a = source.indexOf(head);
  expect(a, head).toBeGreaterThan(-1);
  const b = source.indexOf(next, a + head.length);
  expect(b, next).toBeGreaterThan(a);
  return source.slice(a, b);
};

describe("the page's photos", () => {
  it("are listed with the set's page and passed to the page, with the still model", () => {
    expect(read("data.ts")).toContain('elementPhotos: status === "ready" ? forPage(await listElementPhotos(createAdminClient(), access.userId, row.id as string)) : { photos: [], sheets: [] },');
    const page = read("../../app/app/sets/[id]/page.tsx");
    expect(page).toContain("initialElementPhotos={data.elementPhotos}");
    expect(page).toContain("stillModel={data.stillModel}");
  });

  it("upload through the photo preparer and the checked action, onto the thing whose card is open", () => {
    const up = fnOf(view, "async function uploadElementPhoto(", "async function removePhoto(");
    expect(up.indexOf("prepared = await preparePhoto(file);")).toBeLessThan(up.indexOf("addElementPhoto("));
    expect(up).toContain("res = await addElementPhoto(setId, { photoDataUri: prepared.dataUri, element: key });");
    expect(up).toContain('setPhotoPhase("preparing");');
    expect(up).toContain('setPhotoPhase("checking");');
  });

  it("come off at once and go back if the server says no", () => {
    const rm = fnOf(view, "async function removePhoto(", "async function putPhotoOn(");
    expect(rm).toContain("setElementPhotos(before);");
    expect(rm).toContain("res = await removeElementPhoto(setId, refId);");
  });
});

describe("a still", () => {
  it("draws the sheets it will carry before it is shot, from the pose the frame was taken at", () => {
    const shoot = fnOf(view, "async function shoot(", "async function runRigCheck(");
    const prep = shoot.indexOf("await drawSheetsFor(planFor(pose, layoutRef.current.mark).riding)");
    expect(prep).toBeGreaterThan(shoot.indexOf("const frame = apiRef.current?.frame();"));
    expect(prep).toBeLessThan(shoot.indexOf("shootInSet(setId,"));
    expect(shoot).toContain("setShotElements(result.elements);");
    const take = fnOf(view, "async function take(", "function filmPlanNow(");
    expect(take.indexOf("await drawSheetsFor(")).toBeLessThan(take.indexOf("takeInSet(setId,"));
    expect(take).toContain("setShotElements(result.still.elements);");
  });

  it("asks the server to draw only the riding sheets not drawn yet, and asks again for any queued", () => {
    const draw = fnOf(view, "async function drawSheetsFor(", "function showElement(");
    expect(draw).toContain("let need = beforeShoot(riding, sheetHashes);");
    expect(draw).toContain("res = await prepareElementSheets(setId, need);");
    expect(draw).toContain('need = res.sheets.filter((x) => x.status === "queued").map((x) => x.key);');
  });

  it("plans the sheets as the shot does: the same planner, the still model's budget", () => {
    expect(view).toContain('budget: stillModel === "gpt-image" ? ELEMENT_SHEETS_PER_STILL : 0,');
    expect(view).toMatch(/\(pose: Pose \| null, m: Mark, order: readonly string\[\] = elementOrder, shown: typeof spec = spec\) =>\s*planShotSheets\(\{/);
  });

  it("carries no reference photo as its look any more", () => {
    expect(view).not.toMatch(/lookRefId|pickRefLook|addSetReference|removeSetReference|SET_REFS_MAX/);
    expect(actions).not.toMatch(/lookRefId|refAsked|SET_TAKE_PHOTO_DROPPED/);
  });
});

describe("the Look menu", () => {
  it("keeps Off, the latest still and a picked still, and says where the photos went", () => {
    const menu = fnOf(view, "data-look-menu", "data-look-refs-moved");
    expect(menu).toContain("pickLook(null);");
    expect(menu).toContain("pickLook(latestStill);");
    expect(menu).not.toContain("data-look-upload");
    expect(view).toContain("{cast.lookMoved}");
  });
});

describe("the card and the strip", () => {
  it("open from a tap on the stage, and a tap on the ground closes the card", () => {
    expect(view).toMatch(/if \(!hit \|\| \(hit\.kind === "structure" && elementCard\)\) closeElementCard\(\);\s*else openElementCard\(hit\.kind === "structure" \? null : hit\.key\);/);
    expect(view).toContain('{elementCardView("dock")}');
    expect(view).toContain('{!wide && elementCardView("sheet")}');
  });

  it("the card's photos, its add tile and its status line are there to find", () => {
    for (const hook of ["data-element-card", "data-element-kind", "data-el-photo", "data-el-photo-remove", "data-el-add", "data-el-status"]) expect(card).toContain(hook);
    // A thing with no photos says how, never an empty line.
    expect(card).toContain("{status ?? c.photoHint}");
  });

  it("the strip names who rides, the loose photos have a way home, and it clears the gizmo", () => {
    for (const hook of ["data-cast-strip", "data-cast-chip", "data-el-state", "data-cast-empty", "data-cast-loose"]) expect(strip).toContain(hook);
    const foot = fnOf(view, "data-stage-foot", "{figureMoved ? s.figureMovedOut : s.dragHint}");
    expect(foot).toContain('{castShown && castStrip("pointer-events-auto relative max-w-full")}');
    expect(view).toContain('className="pointer-events-none absolute bottom-[104px] left-3.5 right-3.5 z-20 flex flex-col items-start gap-2 md:right-[190px]" data-stage-foot');
  });

  it("Escape closes the card before anything else", () => {
    expect(view).toMatch(/if \(closeCardRef\.current\) closeCardRef\.current\(\);\s*else if \(menuRef\.current\) setMenu\(null\);/);
  });
});

describe("the words", () => {
  it("exist in every language with their placeholders, and say a photo is never a person", () => {
    const keys = Object.keys(en.sets.cast) as (keyof typeof en.sets.cast)[];
    for (const m of [en, es, pt, itMsgs]) {
      for (const key of keys) {
        expect(m.sets.cast[key], key).toBeTruthy();
        for (const ph of en.sets.cast[key].match(/\{\w+\}/g) ?? []) expect(m.sets.cast[key], `${key} ${ph}`).toContain(ph);
      }
      for (const key of ["setRefRefused", "setRefUnchecked", "setRefTooFast", "setElementFull", "setElementGone", "setElementNotAThing", "setElementsTooMany", "setTakeElementDropped"] as const) {
        expect(m.serverText[key], key).toBeTruthy();
      }
    }
    expect(en.sets.cast.photoHint).toContain("Not a person");
  });
});
