import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// A still names each thing's sheet (R1, 2026-09-21). The shot action is a
// "use server" module, which cannot load here, so it is read as source:
// where the sheets are planned, when a film's beat stops, and in what
// order they ride.

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
const take = code(fnOf(actions, "takeInSet"));

describe("shootInSet: the things' sheets", () => {
  it("plans after the burst brake and before anything is uploaded, reading the still's model", () => {
    const brake = shoot.indexOf('rateLimited(userId, "set-shot"');
    const plan = shoot.indexOf("elementPlan = planShotSheets({");
    expect(brake).toBeGreaterThan(-1);
    expect(plan).toBeGreaterThan(brake);
    expect(plan).toBeLessThan(shoot.indexOf("const framePath"));
    expect(shoot).toContain('access.supabase.from("app_settings").select("value").eq("key", "image_model").maybeSingle()');
    expect(shoot).toContain('budget: stillModel === "gpt-image" ? ELEMENT_SHEETS_PER_STILL : 0,');
  });

  it("stops a film's beat whose sheet is not drawn before the frame is uploaded or anything is charged", () => {
    const stop = shoot.indexOf("return { error: SET_TAKE_ELEMENT_DROPPED };");
    expect(stop).toBeGreaterThan(shoot.indexOf("elementPlan = planShotSheets({"));
    expect(stop).toBeLessThan(shoot.indexOf(".upload(framePath"));
    expect(stop).toBeLessThan(shoot.indexOf("runGeneration(fd)"));
    expect(shoot).toContain('if (input.elementsRequired === true && elementPlan.statuses.some((e) => e.status === "no-sheet")) {');
  });

  it("names the sheets in the words and sends them, in plan order, last, as elements", () => {
    expect(shoot).toContain("elements: elementPlan.sentences,");
    const roles = shoot.slice(shoot.indexOf('"attachment_roles"'), shoot.indexOf("const result = await withModelWrittenPrompt"));
    const element = roles.indexOf('...elementPlan.riding.map((r) => ({ url: mediaUrl("generated-images", setElementSheetPath(userId, setId, r.hash)), role: "element" as const })),');
    expect(element).toBeGreaterThan(roles.indexOf('role: "scene"'));
  });

  it("says a sheet the render lane did not send was not sent", () => {
    expect(shoot).toMatch(/e\.status === "rode" && \(e\.sheet \?\? 0\) > \(result\.elementSheets \?\? 0\) \? \{ key: e\.key, status: "not-sent" as const \} : e/);
  });

  it("a film's beat carries its things, and a single take's end still goes without a missing one", () => {
    expect(take).toContain("elementOrder: input.elementOrder,");
    expect(take).toContain("elementsRequired: input.film === true,");
  });
});
