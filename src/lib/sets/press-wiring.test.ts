import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import en from "../i18n/messages/en";
import es from "../i18n/messages/es";
import pt from "../i18n/messages/pt";
import itMsgs from "../i18n/messages/it";
import { localizeServerText, MAPPED_SERVER_STRINGS } from "../i18n/server-text";
import { SET_PRESS_RUNNING, SET_SHOT_NO_TIME, SET_TAKE_TOO_FAST } from "./messages";

// Helios Cut 1 (operator, 2026-09-25: "GO ahead"): a press is claimed
// before anything else happens, the rows it reserves take their ids from
// it, the limiters count it once as it is about to pay, and a render that
// could not finish inside the request's 300 s is not started. The actions
// are a "use server" module, which cannot load here, so they are read as
// source, like the page's other tests.

const actions = readFileSync(join(__dirname, "actions.ts"), "utf8");
const shoot = actions.slice(actions.indexOf("export async function shootInSet("), actions.indexOf("export type TakeResult"));
const take = actions.slice(actions.indexOf("export async function takeInSet("), actions.indexOf("// Delete\n"));
const shootWrapper = actions.slice(actions.indexOf("export async function shootInSet("), actions.indexOf("async function shootStill("));
const takeWrapper = actions.slice(actions.indexOf("export async function takeInSet("), actions.indexOf("async function takeWork("));
const at = (source: string, needle: string) => {
  const i = source.indexOf(needle);
  expect(i, needle).toBeGreaterThan(-1);
  return i;
};

describe("a still's press (shootInSet)", () => {
  it("starts its clock, checks who is asking and whose set it is, then claims the press", () => {
    expect(at(shoot, "const startedAt = Date.now();")).toBeLessThan(at(shoot, "await setsAccess()"));
    expect(at(shoot, "readyOwnedSpec(setId, access.userId)")).toBeLessThan(at(shoot, "runPress("));
    const press = shoot.slice(at(shoot, "runPress("), shoot.indexOf(");\n}", at(shoot, "runPress(")));
    expect(press).toContain('kind: "shot"');
    expect(press).toContain("deadlineAt: startedAt + REPEAT_FOLLOW_DEADLINE_MS");
  });

  it("claims it before anything is counted, drawn, uploaded or charged", () => {
    const claim = at(shoot, "runPress(");
    for (const later of ['rateLimited(userId, "set-shot"', "await lookCutout({", ".upload(framePath", "runGeneration(fd)"]) {
      expect(claim, later).toBeLessThan(at(shoot, later));
    }
  });

  it("hands the body the press id as the still's row id, and nothing a take alone may set", () => {
    expect(shootWrapper).toContain("shootStill(access, setId, owned, input, { startedAt, generationId: pressId })");
    expect(shootWrapper).not.toMatch(/beforePaid|skipShotBrake/);
    expect(at(shoot, 'fd.set("generation_id", opts.generationId)')).toBeLessThan(at(shoot, "withModelWrittenPrompt("));
    expect(shoot).toContain("if (opts.generationId) fd.set(\"generation_id\", opts.generationId);");
  });

  it("the body is not an action: only the two wrappers can reach it", () => {
    expect(actions).toContain("\nasync function shootStill(");
    expect(actions).toContain("\nasync function takeWork(");
    expect(actions).not.toMatch(/export async function (shootStill|takeWork)\(/);
    // Where the older pins expect them: the still before the take's type, the take before the delete.
    expect(actions.indexOf("async function shootStill(")).toBeLessThan(actions.indexOf("export type TakeResult"));
    expect(actions.indexOf("async function takeWork(")).toBeLessThan(actions.indexOf("// Delete\n"));
  });
});

describe("a take's press (takeInSet)", () => {
  it("asks the plan, the set and claims the press before anything else", () => {
    const first = at(take, "finishedStillUrl(");
    for (const earlier of [
      "if (!setTakesEligible(access.plan, access.isAdmin)) return { error: SET_TAKE_NEEDS_PLAN };",
      "readyOwnedSpec(setId, access.userId)",
      "const ledgerId = pressId === null || (film && beat === null) ? null : pressLedgerId(pressId, beat);",
      'kind: "take"',
    ]) {
      expect(at(take, earlier), earlier).toBeLessThan(first);
    }
    // Only a film's beats skip the 3-second cooldown (review, 2026-09-25):
    // a single take and a clip tried again keep it, as any send does.
    expect(takeWrapper).toContain("withServerPress({ startedAt, skipCooldown: ctx.render !== null }, () =>");
    expect(takeWrapper).not.toContain("skipCooldown: true");
    expect(takeWrapper).toContain("render: film && pressId !== null && beat !== null ? { pressId, beat } : null");
  });

  it("counts a Render once only when this delivery holds its claim", () => {
    // Untracked (the ledger's SQL not run, or the claim failed), every beat
    // is counted, as before Cut 1 (review, 2026-09-25).
    expect(takeWrapper).toContain('takeWork(access, setId, owned, input, claim.kind === "claimed" ? ctx : { ...ctx, render: null })');
  });

  it("gives the end still and the clip their ids from the press", () => {
    expect(takeWrapper).toContain("clipId: ledgerId ? pressClipId(ledgerId) : null");
    expect(take).toContain("generationId: ctx.stillId,");
    expect(at(take, "if (ctx.clipId) fd.set(\"generation_id\", ctx.clipId);")).toBeLessThan(at(take, "withServerBuiltFrames(() => runGeneration(fd))"));
  });
});

describe("a delivery that records the same shot twice", () => {
  it("counts a duplicate as recorded, for a still and a take", () => {
    expect(shoot).toContain(".insert({ set_id: setId, generation_id: result.id, user_id: userId });");
    expect(shoot).toContain('const shotError = shotInsertError?.code === "23505" ? null : shotInsertError;');
    expect(shoot).toContain("const camera = shotError ? null : frameCamera;");
    expect(take).toContain('const takeRowError = takeInsertError?.code === "23505" ? null : takeInsertError;');
    expect(take).toContain('if (takeRowError) console.error("takeInSet couldn\'t record the take:"');
  });

  it("and a deleted set's presses go with it, once the set is marked gone", () => {
    const del = actions.slice(actions.indexOf("export async function deleteSet("));
    expect(at(del, "await clearSetPresses(admin, setId, userId);")).toBeGreaterThan(at(del, "if (!gone?.length) continue;"));
  });

  it("runs every press in server memory exactly twice: one still, one take", () => {
    expect(actions.split("withServerPress(").length - 1).toBe(2);
  });
});

describe("the limiters count a press once, as it is about to pay (S3)", () => {
  it("no longer counts a take before its free stops", () => {
    expect(take).not.toContain('if (await rateLimited(userId, "set-take", 60 * 10, SET_TAKES_PER_10_MIN)) return { error: SET_SHOOT_TOO_FAST };');
    expect(take).not.toContain("SET_SHOOT_TOO_FAST");
  });

  it("asks the take's limiter through one brake, skipped for a Render already counted", () => {
    const brake = at(take, "const takeBrake = async ()");
    expect(brake).toBeGreaterThan(at(take, "if (allowance.error) return { error: allowance.error };"));
    const body = take.slice(brake, take.indexOf("};", brake));
    expect(body).toContain("if (renderCounted) return null;");
    expect(body).toContain('rateLimited(userId, "set-take", 60 * 10, SET_TAKES_PER_10_MIN)) ? SET_TAKE_TOO_FAST : null;');
    expect(take).toContain("const renderCounted = ctx.render ? await renderPaidBefore(access.supabase, userId, { ...ctx.render, setId }) : false;");
    expect(take.match(/takeBrake\b/g)).toHaveLength(3); // defined, and used twice
    expect(take).toContain("beforePaid: takeBrake,");
    expect(take).toContain("skipShotBrake: renderCounted,");
  });

  it("brakes a kept end's clip after its face stop and before the clip", () => {
    const braked = at(take, "const braked = await takeBrake();");
    expect(braked).toBeGreaterThan(at(take, "takeError: SET_TAKE_OFF_FACE_KEPT_END"));
    expect(braked).toBeLessThan(at(take, "withServerBuiltFrames("));
    expect(take).toContain("if (braked) return { error: braked };");
  });

  it("brakes a still after its look stop and just before its frame is uploaded", () => {
    expect(shoot).toContain('if (!opts.skipShotBrake && (await rateLimited(userId, "set-shot", 60 * 10, 12))) return { error: SET_SHOOT_TOO_FAST };');
    const paid = at(shoot, "if (opts.beforePaid)");
    expect(paid).toBeGreaterThan(at(shoot, "SET_TAKE_LOOK_CANT : SET_TAKE_LOOK_DROPPED"));
    expect(paid).toBeLessThan(at(shoot, ".upload(framePath"));
    expect(shoot.slice(paid, at(shoot, ".upload(framePath"))).toContain("if (stop) return { error: stop };");
  });
});

describe("a render that could not finish is not started (S5)", () => {
  it("a still, after its look stop and before the brake and the upload", () => {
    const guard = at(shoot, "if (Date.now() - opts.startedAt > SET_STILL_START_BY_MS) return { error: SET_SHOT_NO_TIME };");
    expect(guard).toBeGreaterThan(at(shoot, "SET_TAKE_LOOK_CANT : SET_TAKE_LOOK_DROPPED"));
    expect(guard).toBeLessThan(at(shoot, "if (opts.beforePaid)"));
    expect(guard).toBeLessThan(at(shoot, ".upload(framePath"));
  });

  it("a clip, after its end frame is known and before it is sent", () => {
    const guard = at(take, "if (Date.now() - ctx.startedAt > SET_TAKE_CLIP_START_BY_MS) return { error: null, still, reusedEnd, takeGenerationId: null, takeError: SET_TAKE_FAILED };");
    expect(guard).toBeGreaterThan(at(take, "if (!endUrl)"));
    expect(guard).toBeLessThan(at(take, "withServerBuiltFrames("));
  });
});

describe("the new sentences", () => {
  it("are server sentences the page translates, in every language, and say nothing was charged", () => {
    for (const [msg, key] of [
      [SET_PRESS_RUNNING, "setPressRunning"],
      [SET_TAKE_TOO_FAST, "setTakeTooFast"],
      [SET_SHOT_NO_TIME, "setShotNoTime"],
    ] as const) {
      expect(MAPPED_SERVER_STRINGS).toContain(msg);
      for (const m of [en, es, pt, itMsgs]) {
        expect(m.serverText[key], key).toBeTruthy();
        expect(localizeServerText(msg, m), key).toBe(m.serverText[key]);
      }
      expect(en.serverText[key]).toBe(msg);
    }
    expect(SET_TAKE_TOO_FAST).toContain("Nothing was charged");
    expect(SET_SHOT_NO_TIME).toContain("nothing was charged");
    expect(SET_PRESS_RUNNING).toContain("nothing more is charged");
    expect(SET_PRESS_RUNNING).not.toMatch(/couldn't|try again/i);
  });
});
