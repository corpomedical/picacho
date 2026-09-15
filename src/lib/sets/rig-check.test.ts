import { afterEach, describe, expect, it, vi } from "vitest";
import { checkRig, normaliseRigCheck, readRigCheck, rigCheckInstructions, rigCheckQuestion } from "./rig-check";

// The rig check reads the still back against the words its rig sent: one
// verdict per look asked, in the order asked, or nothing at all.

const asks = [
  { item: "light" as const, words: "Light: contre-jour." },
  { item: "lens" as const, words: "An anamorphic lens." },
];

describe("readRigCheck", () => {
  it("keeps one verdict per asked look, in the asked order, and ignores the rest", () => {
    const text =
      'Sure: {"checks":[{"item":"lens","landed":false,"evidence":"Round bokeh, no flare."},' +
      '{"item":"light","landed":true,"evidence":"Sun behind the person."},{"item":"era","landed":true,"evidence":"x"}]}';
    expect(readRigCheck(text, ["light", "lens"])).toEqual([
      { item: "light", landed: true, evidence: "Sun behind the person." },
      { item: "lens", landed: false, evidence: "Round bokeh, no flare." },
    ]);
  });

  it("is no answer when a look is left out, a verdict is not a boolean, or it is not JSON", () => {
    expect(readRigCheck('{"checks":[{"item":"light","landed":true}]}', ["light", "lens"])).toBeNull();
    expect(readRigCheck('{"checks":[{"item":"light","landed":"yes"},{"item":"lens","landed":false}]}', ["light", "lens"])).toBeNull();
    expect(readRigCheck("the light landed", ["light"])).toBeNull();
  });

  it("cleans and cuts the evidence", () => {
    const long = "a".repeat(400);
    const got = readRigCheck(`{"checks":[{"item":"light","landed":true,"evidence":"${long}"}]}`, ["light"]);
    expect(got![0].evidence.length).toBeLessThanOrEqual(120);
  });
});

describe("normaliseRigCheck", () => {
  it("keeps stored verdicts it knows, or nothing", () => {
    expect(normaliseRigCheck({ checkedAt: "t", verdicts: [{ item: "focus", landed: true, evidence: "sharp" }, { item: "mood", landed: true }] })).toEqual({
      checkedAt: "t",
      verdicts: [{ item: "focus", landed: true, evidence: "sharp" }],
    });
    for (const junk of [null, {}, { verdicts: [] }, "x"]) expect(normaliseRigCheck(junk)).toBeNull();
  });
});

describe("what the reader is asked", () => {
  it("judges what the picture shows, in the person's language, and describes no one", () => {
    const text = rigCheckInstructions("pt");
    expect(text).toContain("never what it was meant to show");
    expect(text).toContain("in Portuguese");
    expect(text).toContain("Never describe anyone's face, body, age, clothing or identity");
    expect(rigCheckInstructions("xx")).toContain("in English");
    expect(rigCheckQuestion(asks)).toBe("The looks this still was asked for:\n- light: Light: contre-jour.\n- lens: An anamorphic lens.");
  });
});

describe("checkRig", () => {
  const key = process.env.OPENAI_API_KEY;
  afterEach(() => {
    vi.unstubAllGlobals();
    if (key === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = key;
  });

  it("sends the still inline at full detail, at temperature 0, and reads the verdicts", async () => {
    process.env.OPENAI_API_KEY = "k";
    const fetch = vi.fn(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body));
      expect(body.temperature).toBe(0);
      expect(body.messages[1].content[1].image_url.detail).toBe("high");
      expect(body.messages[1].content[1].image_url.url.startsWith("data:image/png;base64,")).toBe(true);
      return new Response(
        JSON.stringify({ choices: [{ message: { content: '{"checks":[{"item":"light","landed":true,"evidence":"e"},{"item":"lens","landed":false,"evidence":"f"}]}' } }] }),
        { status: 200 },
      );
    });
    vi.stubGlobal("fetch", fetch);
    const got = await checkRig(Buffer.from("png"), "image/png", asks, "en");
    expect(got).toEqual([
      { item: "light", landed: true, evidence: "e" },
      { item: "lens", landed: false, evidence: "f" },
    ]);
  });

  it("fails open, quietly: no key or a refusal is null, never a throw", async () => {
    delete process.env.OPENAI_API_KEY;
    expect(await checkRig(Buffer.from("png"), "image/png", asks, "en")).toBeNull();
    process.env.OPENAI_API_KEY = "k";
    vi.stubGlobal("fetch", vi.fn(async () => new Response("no", { status: 400 })));
    expect(await checkRig(Buffer.from("png"), "image/png", asks, "en")).toBeNull();
    expect(await checkRig(Buffer.from("png"), "image/png", [], "en")).toEqual([]);
  });
});
