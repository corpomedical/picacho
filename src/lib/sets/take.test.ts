import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  buildSetTakePrompt,
  isSetTakeEngine,
  retryableTakes,
  SET_TAKE_DEFAULT_ENGINE,
  SET_TAKE_ENGINES,
  stillQuoteInput,
  takeQuoteInput,
  takesCredits,
  type TakeSource,
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

  it("closes the person's words with a full stop, so they never run into the next sentence", () => {
    expect(buildSetTakePrompt("she walks to the car")).toContain("she walks to the car. Keep the person");
    expect(buildSetTakePrompt("she walks to the car!")).toContain("she walks to the car! Keep the person");
    expect(buildSetTakePrompt("she walks to the car.")).not.toContain("car..");
  });
});

// The first real film (2026-09-21): the take's words went through the
// drafter, which rewrote them into vivid sentences of its own and dropped
// the move. They are final now, as a still's are; the gates still run.
describe("the take's words reach the video model as written (actions.ts)", () => {
  const src = readFileSync(join(__dirname, "actions.ts"), "utf8");
  const take = src.slice(src.indexOf("export async function takeInSet("), src.indexOf("// Delete\n"));

  it("sends the take's prompt as final, next to the prompt itself", () => {
    const prompt = take.indexOf('"prompt",\n    buildSetTakePrompt(');
    const final = take.indexOf('fd.set("prompt_is_final", "1");');
    expect(prompt).toBeGreaterThan(-1);
    expect(final).toBeGreaterThan(prompt);
    expect(final).toBeLessThan(take.indexOf("withServerBuiltFrames(() => runGeneration(fd))"));
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

// A film beat whose clip failed renders the clip alone, ending on the frame
// the beat already has (2026-09-16). takeInSet is a "use server" module and
// cannot load here, so its source is read: the reused frame is checked
// exactly like the start, before a take is counted, and nothing is shot.
describe("a take that ends on a still the set already has (actions.ts)", () => {
  const src = readFileSync(join(__dirname, "actions.ts"), "utf8");
  const take = src.slice(src.indexOf("export async function takeInSet("), src.indexOf("// Delete\n"));
  const check = src.slice(src.indexOf("async function finishedStillUrl("), src.indexOf("export async function takeInSet("));

  it("checks the end frame as it checks the start, and both before the take is counted", () => {
    const start = take.indexOf("finishedStillUrl(access.supabase, setId, userId, startId)");
    const end = take.indexOf("finishedStillUrl(access.supabase, setId, userId, reuseId)");
    const counted = take.indexOf('rateLimited(userId, "set-take"');
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    expect(counted).toBeGreaterThan(end);
    expect(take).toContain("if (reuseId && !reusedUrl) return { error: SET_TAKE_BAD_END };");
  });

  it("takes only this set's still, the person's own, finished, an image, not deleted", () => {
    for (const needle of [
      '.eq("set_id", setId)',
      '.eq("generation_id", generationId)',
      '.eq("user_id", userId)',
      'gen.status === "succeeded"',
      "!gen.deleted_at",
      'gen.content_type === "image"',
      "UUID_RE.test(generationId)",
    ]) {
      expect(check, needle).toContain(needle);
    }
  });

  it("shoots a frame only when it does not reuse one", () => {
    const reuse = take.indexOf("if (reuseId && reusedUrl) {");
    const otherwise = take.indexOf("} else {", reuse);
    // The still's body since 2026-09-25 (shootInSet is its wrapper, Cut 1).
    const shoot = take.indexOf("await shootStill(");
    expect(reuse).toBeGreaterThan(-1);
    expect(shoot).toBeGreaterThan(otherwise);
    expect(take.slice(reuse, otherwise)).not.toContain("shootStill");
    expect(take.match(/shootStill\(/g)).toHaveLength(1);
  });
});

// A failed take's clip rendered again between the same two stills
// (2026-09-16), on this visit or a later one: offered once per pair of
// stills, since a second press while the first retry renders — or after it
// came in — would pay for the same clip twice.
describe("retryableTakes", () => {
  const from = (start: string, end: string): TakeSource => ({ start, end, characterId: "p", direction: "", engine: "omni" });
  const takeRow = (id: string, status: string, takeFrom: TakeSource | null) => ({ generationId: id, kind: "take", status, takeFrom });

  it("offers a failed take whose stills are known", () => {
    const shots = [takeRow("t1", "failed", from("a", "b")), takeRow("t2", "failed", null), takeRow("t3", "succeeded", from("c", "d"))];
    expect([...retryableTakes(shots)]).toEqual(["t1"]);
  });

  it("stops offering it once the same clip is rendering or rendered, and offers it again if that fails too", () => {
    const failed = takeRow("t1", "failed", from("a", "b"));
    expect(retryableTakes([takeRow("t2", "generating", from("a", "b")), failed]).size).toBe(0);
    expect(retryableTakes([takeRow("t2", "succeeded", from("a", "b")), failed]).size).toBe(0);
    expect([...retryableTakes([takeRow("t2", "failed", from("a", "b")), failed])].sort()).toEqual(["t1", "t2"]);
    // Another pair of stills is another clip; a still is never a take.
    expect([...retryableTakes([takeRow("t2", "generating", from("a", "c")), failed])]).toEqual(["t1"]);
    expect([...retryableTakes([{ generationId: "s1", kind: "still", status: "failed", takeFrom: from("a", "b") }])]).toEqual([]);
  });
});

// And the take's row keeps what it was rendered from (shot-take.ts),
// marked as a film's when the film rendered it.
describe("what a take keeps (actions.ts, set-view.tsx)", () => {
  const src = readFileSync(join(__dirname, "actions.ts"), "utf8");
  const take = src.slice(src.indexOf("export async function takeInSet("), src.indexOf("// Delete\n"));
  const view = readFileSync(join(__dirname, "../../components/sets/set-view.tsx"), "utf8");

  it("keeps the two stills, the engine sent, the direction and the film mark, once the take's row is in", () => {
    const recorded = take.indexOf("await recordShotTake(admin, key, {");
    expect(recorded).toBeGreaterThan(take.indexOf('if (takeRowError) console.error("takeInSet couldn\'t record the take:"'));
    expect(take.slice(take.indexOf("else {", take.indexOf("if (takeRowError)")), recorded)).toContain("const key = { setId, generationId: clip.id, userId };");
    const kept = take.slice(recorded, take.indexOf("});", recorded));
    for (const needle of ["start: startId,", "end: still.generationId,", "engine: engineKey,", "film: input.film === true,"]) {
      expect(kept, needle).toContain(needle);
    }
    // The engine kept is the engine the clip was sent on.
    expect(take).toContain("const engine = SET_TAKE_ENGINES[engineKey];");
    expect(take).toContain('fd.set("video_model_id", engine.model);');
  });

  it("marks a film's beats as the film's, and nothing else", () => {
    const render = view.slice(view.indexOf("async function renderFilm("), view.indexOf("async function retryClip("));
    const retry = view.slice(view.indexOf("async function retryClip("), view.indexOf("const retryLabel ="));
    const single = view.slice(view.indexOf("async function take("), view.indexOf("function filmAddKeyframe("));
    expect(render).toContain("film: true,");
    expect(retry).not.toContain("film:");
    expect(single).not.toContain("film:");
    expect(view.match(/film: true,/g)).toHaveLength(1);
  });
});

// A take is paid for whole or not at all (2026-09-16): its end still was
// charged before its clip was asked for, so a person who could pay for the
// still and not the clip got a still they had not asked for alone. The
// server now asks the balance for both at once, and a film for its whole
// render, at the prices the buttons show.
describe("what takes cost together", () => {
  it("prices a still as the one image the shot action sends", () => {
    expect(stillQuoteInput().contentType).toBe("image");
    expect(quoteSend(stillQuoteInput()).totalCredits).toBe(1);
  });

  it("adds a clip for each take and a still for each one that shoots its end", () => {
    const still = quoteSend(stillQuoteInput()).totalCredits;
    for (const engine of ["omni", "veo"] as const) {
      const clip = quoteSend(takeQuoteInput(engine)).totalCredits;
      expect(takesCredits(engine, { clips: 1, stills: 1 })).toBe(clip + still);
      expect(takesCredits(engine, { clips: 1, stills: 0 })).toBe(clip);
      expect(takesCredits(engine, { clips: 3, stills: 2 })).toBe(3 * clip + 2 * still);
      expect(takesCredits(engine, { clips: 0, stills: 0 })).toBe(0);
    }
  });
});

describe("a take asks for its whole price first (actions.ts)", () => {
  const src = readFileSync(join(__dirname, "actions.ts"), "utf8");
  const take = src.slice(src.indexOf("export async function takeInSet("), src.indexOf("// Delete\n"));

  it("asks for the still and the clip together, before the still is shot or the take counted", () => {
    const ask = take.indexOf("await checkGenerationAllowance(access.supabase, userId, takesCredits(engineKey, { clips: 1, stills: 1 }), {");
    expect(ask).toBeGreaterThan(-1);
    expect(take.slice(ask, take.indexOf("});", ask))).toContain("skipCooldown: true");
    expect(take).toContain("if (allowance.error) return { error: allowance.error };");
    expect(ask).toBeLessThan(take.indexOf('rateLimited(userId, "set-take"'));
    expect(ask).toBeLessThan(take.indexOf("await shootStill("));
    // Only when a still is to be shot: a reused end leaves the clip, which runGeneration asks for itself.
    expect(take).toMatch(/ if \(!reuseId\) \{\s*const allowance = await checkGenerationAllowance\(/);
    // The engine asked for is the engine the clip is sent on.
    expect(take.indexOf("const engineKey = isSetTakeEngine(input.engine) ? input.engine : SET_TAKE_DEFAULT_ENGINE;")).toBeLessThan(ask);
  });
});

describe("the page prices and asks as the server does (set-view.tsx)", () => {
  const view = readFileSync(join(__dirname, "../../components/sets/set-view.tsx"), "utf8");

  it("shows the prices the server charges", () => {
    expect(view).toContain("const quote = quoteSend(stillQuoteInput());");
    expect(view).toContain("const takeCredits = takesCredits(takeEngine, { clips: 1, stills: 1 });");
    expect(view).toContain("const filmCredits = takesCredits(film.engine, filmJobCount(filmPlan.jobs));");
    expect(view).toContain("formatMsg(s.takeRetryClip, { n: takesCredits(f.engine, { clips: 1, stills: 0 }) })");
  });

  it("asks for a film's whole render before touching the film, and lets go when refused", () => {
    const render = view.slice(view.indexOf("async function renderFilm("), view.indexOf("async function retryClip("));
    const ask = render.indexOf("await checkFilmCredits(setId, film.engine, filmJobCount(plan.jobs))");
    expect(ask).toBeGreaterThan(render.indexOf("filmBusyRef.current = true;"));
    expect(ask).toBeLessThan(render.indexOf("keep(kept);"));
    expect(ask).toBeLessThan(render.indexOf("for (const job of plan.jobs)"));
    const refusedAt = render.indexOf("if (refused) {");
    const refusal = render.slice(refusedAt, render.indexOf("return;", refusedAt));
    expect(refusal).toContain("filmBusyRef.current = false;");
    expect(refusal).toContain("setFilmBusy(null);");
    // The button shows the render begun while the question is out.
    expect(render.indexOf("if (first) setFilmBusy({ beat: first.beat, clipOnly: first.end !== null });")).toBeLessThan(ask);
    // A second press while the question is out is ignored; anything else
    // that stops it is said (filmRenderWhy, 2026-09-21).
    expect(render).toContain("if (filmBusy || filmBusyRef.current) return;");
    expect(render).toContain("setFilmError(filmRenderWhy ?? s.filmWhyLoading);");
  });
});

// A plan without start-and-end-frame video (plans.ts advancedVideoPlan) is
// told before a take is framed or a film asked for, not after a still has
// been paid for (2026-09-16). The server says it too (takeInSet,
// checkFilmCredits); the page only saves the person the framing.
describe("a plan without takes is told first (set-view.tsx)", () => {
  const view = readFileSync(join(__dirname, "../../components/sets/set-view.tsx"), "utf8");
  const between = (from: string, to: string) => view.slice(view.indexOf(from), view.indexOf(to, view.indexOf(from)));

  it("says so instead of starting a take, a film or a retry", () => {
    const take = between("async function take(", "setError(\"\");");
    expect(take).toContain("if (!takesOn) {\n      setError(SET_TAKE_NEEDS_PLAN);\n      return;\n    }");
    const render = between("async function renderFilm(", "const plan = filmPlanNow();");
    // The plan is the first reason Render gives (filmRenderWhy), said on a press.
    expect(render).toContain("if (filmRenderWhy !== null || !api) {");
    expect(view).toContain("const filmRenderWhy: string | null = !takesOn\n    ? localizeServerText(SET_TAKE_NEEDS_PLAN, t)");
    // The retry's own guard: nothing else in flight (the busy ref, 2026-09-17) and the plan.
    expect(view).toContain("if (busy.shooting || busy.taking || busy.editing || busy.matching || !ready || !takesOn) return;");
    expect(view).toContain("const retryable = takesOn ? retryableTakes(shots) : new Set<string>();");
  });

  it("answers Take it somewhere with the plan, and answers Render with the reason beside it", () => {
    const button = between("if (!takesOn) {\n                          setError(SET_TAKE_NEEDS_PLAN);", "{s.takeItSomewhere}");
    expect(button.indexOf("return;")).toBeLessThan(button.indexOf("setTakeStart({"));
    expect(button).toContain("title={takesOn ? undefined : localizeServerText(SET_TAKE_NEEDS_PLAN, t)}");
    // Render is pressable and says why (2026-09-21); shut only while it renders.
    const render = between("onClick={() => void renderFilm()}", "{filmRenderLabel}");
    expect(render).toContain("disabled={Boolean(filmBusy)}");
    expect(render).toContain("title={filmRenderWhy ?? undefined}");
    expect(view).toContain("{!takesOn && <p className=\"px-1 text-xs text-[#c6c9d1]\">{localizeServerText(SET_TAKE_NEEDS_PLAN, t)}</p>}");
  });
});
