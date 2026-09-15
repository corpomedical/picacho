import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { lookCutoutKeys } from "../../../scripts/lib/storage-references.mjs";
import { setLookCutoutPath, setLookSheetPath } from "./set-config";

// The look sends only the objects (2026-09-12). The shot action and the
// deletes are "use server" modules, which cannot load here, so they are read
// as source: what the look's rows may become on the way to the image model,
// and what happens to the camera and the cutouts around them.

const read = (p: string) => readFileSync(join(__dirname, p), "utf8");
const fnOf = (source: string, name: string) => {
  const start = source.indexOf(`export async function ${name}(`);
  expect(start, name).toBeGreaterThan(-1);
  const end = source.indexOf("\nexport async function", start + 10);
  return source.slice(start, end < 0 ? undefined : end);
};
// Code only: what the comments say is not what the code does.
const code = (s: string) => s.replace(/^\s*\/\/.*$/gm, "");

const actions = read("actions.ts");
const shoot = code(fnOf(actions, "shootInSet"));

describe("shootInSet: the look", () => {
  it("reads the look's still only after checking it is a finished shot of this set in the person's own folder", () => {
    expect(shoot).toContain('const lookAsked = UUID_RE.test(lookId);');
    expect(shoot).toMatch(/\.from\("location_set_shots"\)\s*\.select\("generation_id"\)\s*\.eq\("set_id", setId\)\s*\.eq\("generation_id", lookId\)\s*\.eq\("user_id", userId\)/);
    expect(shoot).toContain('lookTake && lookTake.status === "succeeded" && !lookTake.deleted_at');
    expect(shoot).toContain("lookStoragePath(lookTake.result_url, userId)");
  });

  it("cuts only after the burst brake, reading the still's camera in a query of its own", () => {
    const brake = shoot.indexOf('rateLimited(userId, "set-shot"');
    const cut = shoot.indexOf("await lookCutout({");
    expect(brake).toBeGreaterThan(-1);
    expect(cut).toBeGreaterThan(brake);
    expect(shoot).toContain("camera: (await readShotCameras(access.supabase, setId, userId, [lookId])).get(lookId) ?? null,");
    expect(shoot).toContain("stillPath: lookPath,");
    expect(shoot).toContain("spec: owned.spec,");
  });

  it("sends only ever the object sheet drawn from the cutout: the one look URL is the sheet's, and the still's is never made", () => {
    const lookUrls = [...shoot.matchAll(/mediaUrl\("generated-images", ([^)]+)\)/g)].map((m) => m[1]);
    // Two generated-images URLs since 2026-09-15: the sheet, and a photo
    // set's source photograph — which rides under the SCENE role, never the
    // look's, so the look lane still carries the sheet alone.
    expect(lookUrls).toEqual(["sheet.path", "photoSource.path"]);
    expect(shoot).toContain('...(sourcePhotoUrl ? [{ url: sourcePhotoUrl, role: "scene" as const }] : []),');
    expect(shoot).not.toMatch(/mediaUrl\([^)]*lookPath/);
    expect(shoot).not.toMatch(/mediaUrl\([^)]*cut\.path/);
    // The sheet is drawn from this shot's own cutout, and look is set in one
    // place, to the sheet, and rides as the "look" role.
    expect(shoot).toContain("const sheet = await lookSheet({ admin, userId, setId, lookGenerationId: lookId, cutoutPath: cut.path });");
    expect(shoot.match(/\blook = /g)).toHaveLength(1);
    expect(shoot).toContain('look = { url: mediaUrl("generated-images", sheet.path) };');
    expect(shoot).toContain('let look: { url: string } | null = null;');
    expect(shoot).toContain('...(look ? [{ url: look.url, role: "look" }] : []),');
    // The still's own path goes to the cutout step and nowhere else.
    expect(shoot.match(/\blookPath\b/g)?.length).toBe(4); // declared, assigned, tested, handed to lookCutout
  });

  it("every way the look can fail drops it, says so in the answer, and logs only the reason", () => {
    // A chosen look that is not a finished still of the set, any failure of
    // the cut (lookCutout's reasons: no camera, the still unreadable, the
    // people unknown, nothing to cut, the cut failed, an empty or whole-frame
    // mask, storage), and any failure of the sheet (lookSheet's: storage, the
    // render refused or failed).
    expect(shoot).toContain(': { ok: false, reason: "not a finished still of this set" };');
    const branch = shoot.slice(shoot.indexOf("if (!cut.ok) {"), shoot.indexOf("const framePath"));
    expect(branch).toContain("lookDropped = true;");
    expect(branch).toContain("console.warn(`[sets] shot without its look: ${cut.reason}`);");
    expect(branch).toContain("console.warn(`[sets] shot without its look: ${sheet.reason}`);");
    expect(branch.match(/lookDropped = true;/g)).toHaveLength(2);
    // Dropping is only ever that: the shot goes on without it.
    expect(branch).not.toMatch(/return \{ error/);
    expect(shoot).toMatch(/hasLookObjects,\s*lookDropped,\s*format: rig\.format,\s*checks: rigCheckItems\(rig\),\s*};/);
  });

  it("leaves the rest of the shot as it was: the prompt, its refusal attribution, the frame", () => {
    expect(shoot).toContain("description: owned.spec.description,");
    expect(shoot).toContain("lifted: input.lifted === true,");
    expect(shoot).toContain("sourcePhoto: sourcePhotoUrl !== null,");
    expect(shoot).toContain('const modelOnlyPrompt = buildSetShotPrompt({ ...shot, direction: "" });');
    expect(shoot).toContain('const result = await withModelWrittenPrompt({ modelOnlyPrompt, provider: "astra" }, () => runGeneration(fd));');
    expect(shoot).toContain('{ url: mediaUrl("chat-attachments", framePath), role: "reference" },');
    expect(shoot).toContain('fd.set("prompt_is_final", "1");');
  });
});

describe("shootInSet: the camera", () => {
  it("records the frame's camera after the shot's row, in an update of its own whose failure is ignored", () => {
    const insert = shoot.indexOf('.insert({ set_id: setId, generation_id: result.id, user_id: userId });');
    const record = shoot.indexOf("await recordShotCamera(admin, { setId, generationId: result.id, userId }, camera)");
    expect(insert).toBeGreaterThan(-1);
    expect(record).toBeGreaterThan(insert);
    // Built from the layout exactly as the page sent it — the stage's pose
    // and the figure's mark — never from the normalised layout, whose camera
    // is held to the set's reach; and only when the row went in.
    expect(shoot).toMatch(
      /const camera = shotError\s*\?\s*null\s*:\s*shotCameraOf\(input\.layout, input\.canvasAspect, rigFrame\.cut \? \{ render: rigFrame\.renderAspect, band: rigFrame\.bandAspect \} : null\);/,
    );
    expect(shoot).not.toMatch(/shotCameraOf\(layout/);
    // Nothing about it can fail the shot: its answer is only reported.
    expect(shoot).toContain("const recorded = camera ? await recordShotCamera(");
    expect(shoot.slice(record, shoot.indexOf("return {", record))).not.toMatch(/return \{ error/);
  });

  it("offers the new still as a look only when there is something to cut out of it, by the rule the set page reads", () => {
    expect(shoot).toContain("const hasLookObjects = recorded && camera !== null && seesLookObjects(owned.spec, camera);");
  });
});

describe("the cutouts go with what they were made from", () => {
  it("deleting a set removes its cutouts, after the set is marked gone", () => {
    const del = code(fnOf(actions, "deleteSet"));
    const gone = del.indexOf("if (!gone?.length) continue;");
    expect(del.indexOf("await removeSetLookCutouts(admin, userId, setId);")).toBeGreaterThan(gone);
  });

  it("deleting a still in History removes the cutouts cut from it", () => {
    const gens = readFileSync(join(__dirname, "../generations/actions.ts"), "utf8");
    const del = code(fnOf(gens, "deleteGeneration"));
    expect(del).toMatch(/await removeLookCutoutsOf\(\s*supabase,\s*userData\.user\.id,\s*rows\.map\(\(r\) => r\.id as string\),\s*\);/);
  });

  it("the storage audit counts a live set's cutouts and object sheets as referenced, at the names the product gives them", () => {
    const sets = [
      { id: "set-live", deleted_at: null },
      { id: "set-gone", deleted_at: "2026-09-12T00:00:00Z" },
    ];
    const shots = [
      { set_id: "set-live", generation_id: "g1", user_id: "u1" },
      { set_id: "set-gone", generation_id: "g2", user_id: "u1" },
    ];
    expect(lookCutoutKeys(sets, shots)).toEqual([setLookCutoutPath("u1", "set-live", "g1"), setLookSheetPath("u1", "set-live", "g1")]);
  });
});

describe("the set page reads cameras on their own", () => {
  const data = code(read("data.ts"));
  it("in a query of their own, so the contact sheet never names a column that may not exist", () => {
    expect(data).toContain("const cameras = await readShotCameras(db, setId, access.userId, ids);");
    expect(data).toContain('.select("generation_id, created_at")');
  });

  it("offers a still as a look only when there is something to cut out of it, from its camera and the set", () => {
    expect(data).toContain("return Boolean(spec && camera && seesLookObjects(spec, camera));");
    expect(data).toContain("hasLookObjects: lendsLook(g.id as string),");
  });
});
