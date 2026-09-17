import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// The recce action's order, read as source (a "use server" module cannot
// load here — the photo.test.ts pattern). What these pins hold:
//
//   brake → re-encode → the read → the tail gated as MODEL text under
//   provider "astra" → the read picks the frame → reserve (missing column
//   answers with its own sentence) → notes gated as the person's → the
//   picture gated in the strict lane → store → the photo build WITH the
//   tail. And the reserve mirror must not drift from actions.ts's.

const source = readFileSync(join(__dirname, "recce-actions.ts"), "utf8");
const actionsSource = readFileSync(join(__dirname, "actions.ts"), "utf8");
// The order pins read the submit's own body, so an import or a helper's
// definition above it never stands in for the call.
const body = source.slice(source.indexOf("export async function submitSetRecceBuild"));

const at = (needle: string) => {
  const i = body.indexOf(needle);
  expect(i, `expected the action to contain: ${needle}`).toBeGreaterThan(-1);
  return i;
};

describe("submitSetRecceBuild, as source", () => {
  it("is admins only, behind its own switch, on the shared burst brake", () => {
    expect(at("if (!access.isAdmin) return { error: SETS_NOT_OPEN }")).toBeLessThan(at("isRecceEnabled"));
    at('rateLimited(userId, "set-build"');
  });

  it("re-encodes every frame before the read, and reads before anything is reserved or sent", () => {
    const brake = at('rateLimited(userId, "set-build"');
    const reencode = at("reencodeFrames(frameBytes)");
    const read = at("askRecceRead(");
    const reserve = at("reserveRecceRow(");
    const submit = at("submitAstraJob(");
    expect(brake).toBeLessThan(reencode);
    expect(reencode).toBeLessThan(read);
    expect(read).toBeLessThan(reserve);
    expect(reserve).toBeLessThan(submit);
  });

  it("gates the tail as model text, logged under the provider, before any spend", () => {
    const gate = at("assertPromptAllowed({ prompt: tail, hasRealPersonReference: true })");
    expect(gate).toBeLessThan(at("reserveRecceRow("));
    at('provider: "astra"');
  });

  it("the read picks the frame; the frame passes the picture check in the strict lane before it is stored or sent", () => {
    const pick = at("normaliseSetPhoto(frameBytes[read.placeFrame])");
    const check = at("assertOutputAllowed({ imageUrl: dataUrl, strictLane: true");
    const store = at('.upload(setPhotoPath(userId, setId), photo.jpeg');
    const submit = at("submitAstraJob(");
    expect(pick).toBeLessThan(check);
    expect(check).toBeLessThan(store);
    expect(store).toBeLessThan(submit);
  });

  it("reserves with the photo columns AND the recce column, and a missing column answers with its own sentence", () => {
    at("...photoSourceColumns(userId, setId, photo.sha256)");
    at("...recceColumns(read, seconds, times)");
    at("reserved.missingColumn ? SET_RECCE_NEEDS_DATABASE");
  });

  it("sends the photo build with the tail appended, at the photo caps", () => {
    at('setAstraRequest(photoBuildInput(dataUrl, notes, tail), openAiSafetyId(userId), "photo")');
  });

  it("recomputes the times server-side: only pictures and a length are trusted from the browser", () => {
    at("const times = sampleTimes(seconds, reencoded.length)");
  });

  it("its reserve mirrors actions.ts's reserveBuildRow line for line where it counts", () => {
    // Not importable (exporting it would make it a callable action), so the
    // two must move together: these are the lines the cap's race rests on.
    for (const line of [
      '.insert({ ...extra, user_id: access.userId, brief: RESERVED, status: "building", attempts: 0 })',
      '.select("id, created_at")',
      "countSetBuildsThisMonth(access.userId, access.periodStart, row.created_at as string)",
      "if (upToMine > access.monthlyLimit) {",
      "setMonthlyCapMessage(upToMine - 1)",
    ]) {
      expect(source, `recce reserve should contain: ${line}`).toContain(line);
      expect(actionsSource, `actions.ts reserve should contain: ${line}`).toContain(line);
    }
  });
});
