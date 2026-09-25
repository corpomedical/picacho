import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import raceTrack from "./fixtures-race-track.json";
import { STAND_IN_HEIGHT_M, fovForLens } from "./build-scene";
import { formatFrame } from "./rig";
import { normaliseSetSpec } from "./set-spec";
import { SET_MAX_TILT_DOWN_DEG, SET_MAX_TILT_UP_DEG } from "./set-config";
import {
  askShotWords,
  facingFor,
  hasCameraWords,
  HEIGHT_M,
  HEIGHT_TILT_DEG,
  parseShotWords,
  shotWordsInstructions,
  sideUnit,
  SIZE_DISTANCE_M,
  wordsToMatch,
} from "./shot-words";

// A person's words about a shot, read into a frame (Astra chat, 2026-09-14).

vi.spyOn(console, "warn").mockImplementation(() => {});

const n = normaliseSetSpec(raceTrack);
if (!n.ok) throw new Error("the race track fixture no longer normalises");
const spec = n.spec;
const stage = { spec, askPlace: false };
const camera2 = spec.cameras[1] ?? spec.cameras[0];
const mark2 = spec.marks[1] ?? spec.marks[0];

const answer = (fields: Record<string, unknown>) =>
  JSON.stringify({
    intent: "frame",
    direction: "",
    camera_id: null,
    side: null,
    size: null,
    height: null,
    tilt_deg: null,
    lens_mm: null,
    mark_id: null,
    facing: null,
    ...fields,
  });

describe("parseShotWords", () => {
  it("reads every field, holding the ids to the set and the lens to the listed ones", () => {
    const words = parseShotWords(
      answer({
        intent: "shoot",
        direction: "  She leans on the car and looks back. ",
        camera_id: camera2.id,
        side: "back_left",
        size: "close_up",
        height: "low",
        tilt_deg: 12.4,
        lens_mm: 50,
        mark_id: mark2.id,
        facing: "away",
      }),
      stage,
    );
    expect(words).toEqual({
      intent: "shoot",
      direction: "She leans on the car and looks back.",
      place: null,
      cameraId: camera2.id,
      side: "back_left",
      size: "close_up",
      height: "low",
      tiltDeg: 12,
      lensMm: 50,
      markId: mark2.id,
      facing: "away",
    });
  });

  it("is null for anything not said, unknown ids and words it does not know, and a tilt is held to the stage's", () => {
    const words = parseShotWords(
      answer({
        intent: "wave",
        camera_id: "c99",
        side: "above",
        size: "huge",
        height: "kneeling",
        tilt_deg: -200,
        lens_mm: 40,
        mark_id: "m99",
        facing: "up",
        place: "a beach",
      }),
      stage,
    );
    expect(words).toEqual({
      intent: "frame",
      direction: "",
      place: null,
      cameraId: null,
      side: null,
      size: null,
      height: null,
      tiltDeg: -SET_MAX_TILT_DOWN_DEG,
      lensMm: null,
      markId: null,
      facing: null,
    });
    expect(parseShotWords(answer({ tilt_deg: 90 }), stage)?.tiltDeg).toBe(SET_MAX_TILT_UP_DEG);
    expect(parseShotWords(answer({ tilt_deg: "5" }), stage)?.tiltDeg).toBeNull();
  });

  it("cuts a direction to what a shot's direction may be, and reads a place only on the home", () => {
    const long = "x".repeat(400);
    expect(parseShotWords(answer({ direction: long }), stage)?.direction.length).toBe(300);
    expect(parseShotWords(answer({ place: " a rainy market street " }), { spec: null, askPlace: true })?.place).toBe(
      "a rainy market street",
    );
    expect(parseShotWords(answer({ place: "   " }), { spec: null, askPlace: true })?.place).toBeNull();
    // Without a set there are no cameras or marks to name.
    expect(parseShotWords(answer({ camera_id: camera2.id, mark_id: mark2.id }), { spec: null, askPlace: true })).toMatchObject({
      cameraId: null,
      markId: null,
    });
  });

  it("tolerates text round the object, and is null for anything that is not one", () => {
    expect(parseShotWords(`Sure:\n\`\`\`json\n${answer({ intent: "talk" })}\n\`\`\``, stage)?.intent).toBe("talk");
    for (const bad of ["", "shoot it", "[1,2]", "{not json", "null"]) expect(parseShotWords(bad, stage), bad).toBeNull();
  });

  it("reads a change to the place itself as an edit (the workspace hands it to Astra)", () => {
    expect(parseShotWords(answer({ intent: "edit" }), stage)?.intent).toBe("edit");
  });
});

describe("shotWordsInstructions", () => {
  it("names the set's cameras and marks, the lenses, the characters and the shape", () => {
    const text = shotWordsInstructions({ spec, characters: ["Eva", "Marco"], askPlace: false });
    for (const c of spec.cameras) expect(text).toContain(`${c.id}: ${c.label || c.id}`);
    for (const m of spec.marks) expect(text).toContain(`${m.id}: ${m.label || m.id}`);
    expect(text).toContain("18, 24, 35, 50, 85, 135 mm");
    expect(text).toContain("Eva, Marco");
    expect(text).toContain('"facing":null}');
    expect(text).toContain('"edit" when they ask to change the PLACE ITSELF');
    expect(text).not.toContain('"place"');
    expect(text).toContain("Never describe the person.");
    // A side is the CAMERA's, relative to the person — nothing else in a set
    // has a front the camera can be placed by (objects carry no facing at
    // all). "A front view of the vehicle" used to come back as side: front,
    // which stands the camera in front of the PERSON, and the vehicle came
    // back from whatever side that happened to be (the operator, 2026-09-18).
    expect(text).toContain("where the camera stands relative to THE PERSON");
    expect(text).toContain("when they name the side of something else — the front of the car, behind the building, the back of the room — leave side null");
  });

  // Changed on purpose, and only here (Helios Cut 2, step 1, 2026-09-25):
  // "relight" and "now golden hour" were listed as edits, so the hour of
  // day went to a paid rewrite of the whole set by Astra. The time of day,
  // the light and the look are never Astra's.
  it("never reads the time of day, the light or the look as a change to the set", () => {
    const text = shotWordsInstructions({ spec, characters: [], askPlace: false });
    const intent = text.split("\n").find((l) => l.startsWith("- intent:"));
    expect(intent).toBe(
      '- intent: "shoot" when they ask to take the picture now (shoot, go, take it, do it, one more); "frame" when they set up the shot: who, what happens, where the camera stands; "edit" when they ask to change the PLACE ITSELF — recolour, add, remove or move what is built (make the walls red, add a row of flags, remove the car) — never for the camera or the person, never the time of day, the light or the look; "talk" when the words are about none of these.',
    );
    expect(text).not.toMatch(/relight|golden hour/i);
  });

  it("asks for the place only on the home, where there is no set", () => {
    const text = shotWordsInstructions({ spec: null, characters: [], askPlace: true });
    expect(text).toContain('"facing":null,"place":null}');
    expect(text).toContain("- place:");
    expect(text).not.toContain("cameras (id: name)");
  });
});

describe("hasCameraWords", () => {
  it("is whether anything moves the camera", () => {
    const none = { cameraId: null, side: null, size: null, height: null, tiltDeg: null, lensMm: null };
    expect(hasCameraWords(none)).toBe(false);
    expect(hasCameraWords({ ...none, lensMm: 35 })).toBe(true);
    expect(hasCameraWords({ ...none, tiltDeg: 0 })).toBe(true);
    expect(hasCameraWords({ ...none, side: "back" })).toBe(true);
  });
});

describe("sideUnit", () => {
  it("is in front of a figure facing +Z at +Z, behind it at −Z, and on its right at −X", () => {
    // + 0 folds a negative zero into zero.
    const r = (v: [number, number]) => v.map((x) => Math.round(x * 1000) / 1000 + 0);
    expect(r(sideUnit("front", 0))).toEqual([0, 1]);
    expect(r(sideUnit("back", 0))).toEqual([0, -1]);
    expect(r(sideUnit("right", 0))).toEqual([-1, 0]);
    expect(r(sideUnit("left", 0))).toEqual([1, 0]);
    const d = Math.round(Math.SQRT1_2 * 1000) / 1000;
    expect(r(sideUnit("back_left", 0))).toEqual([d, -d]);
    // Turned to face +X: its front is +X, behind it is −X.
    expect(r(sideUnit("front", 90))).toEqual([1, 0]);
    expect(r(sideUnit("back", 90))).toEqual([-1, 0]);
  });
});

describe("wordsToMatch", () => {
  const mark = { x: 2, z: 3, facingDeg: 0 };
  const current = { position: [2, 1.6, 8] as [number, number, number], target: [2, 1, 3] as [number, number, number], fovDeg: 44.7 };
  const none = { side: null, size: null, height: null, tiltDeg: null, lensMm: null } as const;

  it("stands back by the band's share, so a size word means the same person in the picture", () => {
    // A size is how large the figure stands in the PICTURE, and every format
    // but the square is cut to a band on the server (frame-cut.ts): Scope
    // keeps 643 of the render's 1024 rows, so the square's 1.4 m close-up
    // came back an extreme close-up and its "full" cut the head off (found
    // reviewing Helios, fixed 2026-09-18).
    const scope = formatFrame("scope");
    const share = { heightShare: scope.bandH / scope.renderH };
    const { match: m } = wordsToMatch({ ...none, size: "close_up" }, { mark, current, frame: share });
    expect(m.subjectDistanceM).toBeCloseTo(SIZE_DISTANCE_M.close_up / share.heightShare, 6);
    expect(m.subjectDistanceM ?? 0).toBeGreaterThan(SIZE_DISTANCE_M.close_up);
    // The whole figure stays whole in a Scope "full": 1.75 m inside the band.
    const full = wordsToMatch({ ...none, size: "full" }, { mark, current, frame: share }).match;
    const shown = 2 * (full.subjectDistanceM ?? 0) * Math.tan((full.verticalFovDeg * Math.PI) / 360) * share.heightShare;
    expect(shown).toBeGreaterThan(STAND_IN_HEIGHT_M);
    // The square, the classic and the upright frame keep the plain distance.
    for (const format of ["square", "classic", "vertical"] as const) {
      const fr = formatFrame(format);
      const got = wordsToMatch({ ...none, size: "close_up" }, { mark, current, frame: { heightShare: fr.bandH / fr.renderH } });
      expect(got.match.subjectDistanceM, format).toBe(SIZE_DISTANCE_M.close_up);
    }
    // And left out entirely, nothing changes.
    expect(wordsToMatch({ ...none, size: "close_up" }, { mark, current }).match.subjectDistanceM).toBe(SIZE_DISTANCE_M.close_up);
  });

  it("stands the camera on the side asked for, at the size's distance, at the height's lens height", () => {
    const { match, from } = wordsToMatch({ ...none, side: "back", size: "close_up", height: "low" }, { mark, current });
    expect(from.position).toEqual([2, HEIGHT_M.low, 3 - SIZE_DISTANCE_M.close_up]);
    expect(match).toMatchObject({
      subjectFound: true,
      cameraHeightM: HEIGHT_M.low,
      pitchDeg: HEIGHT_TILT_DEG.low,
      subjectDistanceM: SIZE_DISTANCE_M.close_up,
      subjectX: 0.5,
      verticalFovDeg: current.fovDeg,
    });
  });

  it("keeps the person's own bearing, distance, height, tilt and lens for anything the words leave out", () => {
    const { match, from } = wordsToMatch({ ...none, lensMm: 85 }, { mark, current });
    expect(from.position).toEqual([2, 1.6, 8]);
    expect(match.subjectDistanceM).toBe(5);
    expect(match.cameraHeightM).toBe(1.6);
    // The current camera looks a little down at the mark: that tilt holds.
    expect(match.pitchDeg).toBeCloseTo(-Math.asin(0.6 / Math.hypot(5, 0.6)) / (Math.PI / 180), 3);
    expect(match.verticalFovDeg).toBeCloseTo(fovForLens(85), 6);
    expect(from.fovDeg).toBeCloseTo(fovForLens(85), 6);
  });

  it("a tilt said outright wins over the height's own", () => {
    expect(wordsToMatch({ ...none, height: "high", tiltDeg: 3 }, { mark, current }).match.pitchDeg).toBe(3);
    expect(wordsToMatch({ ...none, height: "high" }, { mark, current }).match.pitchDeg).toBe(HEIGHT_TILT_DEG.high);
  });

  it("from a camera standing on the mark, stands in front of the figure", () => {
    const onMark = { ...current, position: [2.05, 1.6, 3.05] as [number, number, number] };
    const { from } = wordsToMatch({ ...none, size: "full" }, { mark, current: onMark });
    expect(from.position).toEqual([2, 1.6, 3 + SIZE_DISTANCE_M.full]);
  });
});

describe("facingFor", () => {
  const mark = { x: 0, z: 0 };
  const camera = { position: [0, 1.5, 5] as [number, number, number], target: [0, 1, 0] as [number, number, number], fovDeg: 40 };
  it("faces the camera, away from it, or to the picture's left or right", () => {
    expect(facingFor("camera", mark, camera)).toBe(0);
    expect(facingFor("away", mark, camera)).toBe(180);
    // The camera looks along −Z (heading 180°); its right is −X, which a figure faces at 270°.
    expect(facingFor("right", mark, camera)).toBe(90);
    expect(facingFor("left", mark, camera)).toBe(270);
  });
});

describe("askShotWords", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("sends the instructions and the words to the reader, JSON only, and hands back its text", async () => {
    vi.stubEnv("OPENAI_API_KEY", "sk-test");
    let sent: { url: string; body: Record<string, unknown> } | null = null;
    const fetchFn = (async (url: string | URL | Request, init?: RequestInit) => {
      sent = { url: String(url), body: JSON.parse(String(init?.body)) };
      return new Response(JSON.stringify({ choices: [{ message: { content: answer({ intent: "shoot" }) } }] }), { status: 200 });
    }) as typeof fetch;
    const text = await askShotWords("INSTRUCTIONS", "shoot", { fetchFn });
    expect(text).toBe(answer({ intent: "shoot" }));
    expect(sent).not.toBeNull();
    const body = sent!.body as { model: string; messages: { role: string; content: string }[]; temperature: number; response_format: unknown };
    expect(sent!.url).toBe("https://api.openai.com/v1/chat/completions");
    expect(body.model).toBe("gpt-5.4-mini");
    expect(body.messages).toEqual([
      { role: "system", content: "INSTRUCTIONS" },
      { role: "user", content: "shoot" },
    ]);
    expect(body.temperature).toBe(0);
    expect(body.response_format).toEqual({ type: "json_object" });
  });

  it("fails open: no key, a refusal, a throw, an answer without text", async () => {
    vi.stubEnv("OPENAI_API_KEY", "");
    expect(await askShotWords("i", "w", { fetchFn: (async () => new Response("{}")) as typeof fetch })).toBeNull();
    vi.stubEnv("OPENAI_API_KEY", "sk-test");
    expect(await askShotWords("i", "w", { fetchFn: (async () => new Response("no", { status: 429 })) as typeof fetch })).toBeNull();
    expect(
      await askShotWords("i", "w", {
        fetchFn: (async () => {
          throw new Error("network");
        }) as typeof fetch,
      }),
    ).toBeNull();
    expect(
      await askShotWords("i", "w", { fetchFn: (async () => new Response(JSON.stringify({ choices: [{ message: {} }] }))) as typeof fetch }),
    ).toBeNull();
  });
});

// Measure the reader before changing it (Helios Cut 2, step 0, 2026-09-25):
// nothing recorded what a reading used, so whether this model spends hidden
// reasoning on it (describe-image.ts says gpt-5.4-mini can) was argued,
// never read. Every reading now logs its token counts — and never a word.
describe("what a reading used, logged without its words", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  const MESSAGE = "Eva leans on the purple-elephant car";
  const ANSWER = answer({ intent: "frame", direction: "Eva leans on the purple-elephant car" });
  const reply = (body: unknown) => (async () => new Response(JSON.stringify(body), { status: 200 })) as typeof fetch;

  it("logs one line with the token counts and how the answer ended", async () => {
    vi.stubEnv("OPENAI_API_KEY", "sk-test");
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    const fetchFn = reply({
      choices: [{ message: { content: ANSWER }, finish_reason: "stop" }],
      usage: {
        prompt_tokens: 712,
        completion_tokens: 58,
        prompt_tokens_details: { cached_tokens: 0 },
        completion_tokens_details: { reasoning_tokens: 0 },
      },
    });
    expect(await askShotWords("INSTRUCTIONS", MESSAGE, { fetchFn })).toBe(ANSWER);
    expect(info).toHaveBeenCalledTimes(1);
    expect(info).toHaveBeenCalledWith("[sets] reader usage", {
      model: "gpt-5.4-mini",
      prompt: 712,
      cached: 0,
      completion: 58,
      reasoning: 0,
      finish: "stop",
    });
  });

  it("logs a reading the cap emptied too, and nulls for anything not reported", async () => {
    vi.stubEnv("OPENAI_API_KEY", "sk-test");
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    const emptied = reply({ choices: [{ message: { content: "" }, finish_reason: "length" }], usage: { prompt_tokens: 700, completion_tokens: 400, completion_tokens_details: { reasoning_tokens: 400 } } });
    await askShotWords("i", MESSAGE, { fetchFn: emptied });
    expect(info).toHaveBeenLastCalledWith("[sets] reader usage", { model: "gpt-5.4-mini", prompt: 700, cached: null, completion: 400, reasoning: 400, finish: "length" });
    await askShotWords("i", MESSAGE, { fetchFn: reply({ choices: [{ message: { content: ANSWER } }] }) });
    expect(info).toHaveBeenLastCalledWith("[sets] reader usage", { model: "gpt-5.4-mini", prompt: null, cached: null, completion: null, reasoning: null, finish: null });
    // A finish reason that is not the provider's own short word is not kept.
    await askShotWords("i", MESSAGE, { fetchFn: reply({ choices: [{ message: { content: ANSWER }, finish_reason: MESSAGE }] }) });
    expect(info).toHaveBeenLastCalledWith("[sets] reader usage", expect.objectContaining({ finish: null }));
  });

  it("never logs the message, the instructions or the answer — whatever happens", async () => {
    vi.stubEnv("OPENAI_API_KEY", "sk-test");
    const logged: unknown[][] = [];
    for (const level of ["info", "warn", "log", "error", "debug"] as const) {
      vi.spyOn(console, level).mockImplementation((...args: unknown[]) => void logged.push(args));
    }
    const fetchFns = [
      reply({ choices: [{ message: { content: ANSWER }, finish_reason: "stop" }], usage: { prompt_tokens: 1, completion_tokens: 1 } }),
      (async () => new Response(ANSWER, { status: 500 })) as typeof fetch,
      (async () => {
        throw new Error(MESSAGE);
      }) as typeof fetch,
    ];
    for (const fetchFn of fetchFns) await askShotWords("SECRET INSTRUCTIONS", MESSAGE, { fetchFn });
    expect(logged.length).toBeGreaterThan(0);
    const all = JSON.stringify(logged);
    expect(all).not.toContain("purple-elephant");
    expect(all).not.toContain("SECRET INSTRUCTIONS");
  });
});

// Source pin (§7.2 of the Cut 2 spec): no console call in the reader's two
// files is handed the words — a variable named for them, that is; the
// strings a line says are its own.
describe("the reader's files log no words", () => {
  const WORDS = /\b(text|message|messages|turns|answer|content|instructions|input|words|parsed|data)\b/;
  /** Each console call's arguments, with its string literals taken out (a template keeps its ${} parts). */
  const consoleArgs = (source: string): string[] => {
    const out: string[] = [];
    for (const m of source.matchAll(/console\.(log|info|warn|error|debug)\(/g)) {
      let depth = 1;
      let i = (m.index ?? 0) + m[0].length;
      const start = i;
      while (depth > 0 && i < source.length) {
        const ch = source[i++];
        if (ch === "(") depth++;
        else if (ch === ")") depth--;
      }
      const args = source.slice(start, i - 1);
      const expressions = args
        // The one reader of the answer allowed in a log: it keeps counts only (pinned below).
        .replace(/readerUsageOf\(data, SHOT_WORDS_MODEL\)/g, "")
        // A database error's own message ("timeout") is the database's, not the person's.
        .replace(/\b(\w*[Ee]rror)\.message\b/g, "$1")
        .replace(/`([^`]*)`/g, (_all, body: string) => [...body.matchAll(/\$\{([^}]*)\}/g)].map((e) => e[1]).join(" "))
        .replace(/"(?:[^"\\]|\\.)*"/g, "")
        .replace(/'(?:[^'\\]|\\.)*'/g, "");
      out.push(expressions);
    }
    return out;
  };

  it("hands every console call counts, codes and error names only", () => {
    for (const file of ["shot-words.ts", "words-actions.ts"]) {
      const calls = consoleArgs(readFileSync(join(__dirname, file), "utf8"));
      expect(calls.length, file).toBeGreaterThan(0);
      for (const args of calls) expect(args, `${file}: console(${args})`).not.toMatch(WORDS);
    }
  });

  it("logs the usage line from the counts alone", () => {
    const src = readFileSync(join(__dirname, "shot-words.ts"), "utf8");
    expect(src).toContain('console.info("[sets] reader usage", readerUsageOf(data, SHOT_WORDS_MODEL));');
    const usageOf = src.slice(src.indexOf("export function readerUsageOf("), src.indexOf("\n}\n", src.indexOf("export function readerUsageOf(")));
    expect(usageOf).not.toMatch(/\bmessage\b|\bcontent\b/);
  });
});

// The Sets home reads a new place out of the message before it builds
// (words-actions.ts readSetRequest) — a paid call. At the month's build cap
// the build is refused whatever the reader says, so the reader is not asked
// (2026-09-16: Enter at the cap ran it, though the send button was off).
// A "use server" module cannot load here, so its source is read.
describe("the Sets home's place reader, at the build cap", () => {
  const src = readFileSync(join(__dirname, "words-actions.ts"), "utf8");
  const body = src.slice(src.indexOf("export async function readSetRequest("));

  it("counts the month's builds, against the person's own limit, before it asks the model", () => {
    const access = body.indexOf("await setsAccess()");
    const count = body.indexOf("countSetBuildsThisMonth(userId, access.periodStart)");
    const ask = body.indexOf("askShotWords(");
    expect(access).toBeGreaterThan(-1);
    expect(count).toBeGreaterThan(access);
    expect(ask).toBeGreaterThan(count);
    expect(body).toContain("if (access.monthlyLimit >= 0) {");
  });

  it("does not ask when the count cannot be read, or the cap is reached — and lets the build say why", () => {
    expect(body).toContain("if (used === null || used >= access.monthlyLimit) return { error: null, words: null };");
  });
});
