import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LOOK_PEOPLE_GROW, LOOK_PEOPLE_INSTRUCTIONS, LOOK_PEOPLE_MAX, LOOK_PEOPLE_MODEL, findPeople, readPeople } from "./look-people";

// Where the people are in a still (2026-09-14): asked of the vision model,
// answered in numbers only, and anything but an answer is "unknown" — which
// is no look. No real call is ever made: fetch is a fake throughout.

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]);
const answer = (content: unknown, status = 200) =>
  new Response(JSON.stringify({ choices: [{ message: { content } }] }), { status, headers: { "content-type": "application/json" } });

let calls: { url: string; init: RequestInit }[] = [];
let reply: (init: RequestInit) => Promise<Response>;
const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

beforeEach(() => {
  calls = [];
  reply = async () => answer('{"people":[{"x0":0.68,"y0":0.27,"x1":0.98,"y1":0.95}]}');
  vi.stubEnv("OPENAI_API_KEY", "test-key");
  vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return reply(init);
  });
  warn.mockClear();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("readPeople", () => {
  it("reads the boxes, grown by LOOK_PEOPLE_GROW each way and clipped to the frame", () => {
    expect(LOOK_PEOPLE_GROW).toBe(0.05);
    expect(readPeople('{"people":[{"x0":0.68,"y0":0.27,"x1":0.98,"y1":0.95}]}')).toEqual([
      { u0: 0.63, v0: 0.22, u1: 1, v1: 1 },
    ]);
    // Nobody is an answer; prose round the JSON is tolerated; more than LOOK_PEOPLE_MAX are cut off.
    expect(readPeople('{"people":[]}')).toEqual([]);
    expect(readPeople('Sure: {"people":[{"x0":0.1,"y0":0.1,"x1":0.2,"y1":0.3}]} done')).toHaveLength(1);
    const crowd = { people: Array.from({ length: 12 }, (_, i) => ({ x0: i * 0.05, y0: 0.1, x1: i * 0.05 + 0.04, y1: 0.5 })) };
    expect(readPeople(JSON.stringify(crowd))).toHaveLength(LOOK_PEOPLE_MAX);
  });

  it("is not an answer when the shape is wrong, a number is not a fraction, or a box is inside out", () => {
    for (const bad of ["", "not json", "{}", '{"people":"none"}', '{"people":[{"x0":0.1,"y0":0.1,"x1":0.2}]}',
      '{"people":[{"x0":1.2,"y0":0.1,"x1":1.5,"y1":0.3}]}', '{"people":[{"x0":"0.1","y0":0.1,"x1":0.2,"y1":0.3}]}',
      '{"people":[{"x0":0.5,"y0":0.1,"x1":0.2,"y1":0.3}]}', '{"people":[null]}']) {
      expect(readPeople(bad), bad).toBeNull();
    }
  });
});

describe("findPeople", () => {
  it("asks the output gate's reader, the still inline at full detail, for numbers only, deterministically", async () => {
    expect(LOOK_PEOPLE_MODEL).toBe("gpt-5.4-mini");
    expect(await findPeople(PNG, "image/png")).toEqual([{ u0: 0.63, v0: 0.22, u1: 1, v1: 1 }]);
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe("https://api.openai.com/v1/chat/completions");
    expect(calls[0].init.headers).toMatchObject({ authorization: "Bearer test-key" });
    const body = JSON.parse(String(calls[0].init.body));
    expect(body.model).toBe(LOOK_PEOPLE_MODEL);
    expect(body.temperature).toBe(0);
    expect(typeof body.seed).toBe("number");
    expect(body.messages[0]).toEqual({ role: "system", content: LOOK_PEOPLE_INSTRUCTIONS });
    expect(body.messages[1].content[1]).toEqual({ type: "image_url", image_url: { url: `data:image/png;base64,${PNG.toString("base64")}`, detail: "high" } });
    // The instructions ask for boxes and forbid describing anyone.
    expect(LOOK_PEOPLE_INSTRUCTIONS).toContain('{"people":[]}');
    expect(LOOK_PEOPLE_INSTRUCTIONS).toContain("Never name, identify or describe anyone");
  });

  it("is unknown — null, never a throw — with no key, a refusal, an unreadable answer or no answer in time", async () => {
    vi.stubEnv("OPENAI_API_KEY", "");
    expect(await findPeople(PNG, "image/png")).toBeNull();
    expect(calls).toEqual([]);
    vi.stubEnv("OPENAI_API_KEY", "test-key");
    reply = async () => answer("", 429);
    expect(await findPeople(PNG, "image/png")).toBeNull();
    reply = async () => answer("I see a man in a brown jacket.");
    expect(await findPeople(PNG, "image/png")).toBeNull();
    reply = async () => new Response("not json", { status: 200 });
    expect(await findPeople(PNG, "image/png")).toBeNull();
    reply = (init) =>
      new Promise((_, reject) => {
        init.signal?.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "AbortError" })));
      });
    expect(await findPeople(PNG, "image/png", { timeoutMs: 20 })).toBeNull();
    // Nobody in the picture is an answer, not unknown.
    reply = async () => answer('{"people":[]}');
    expect(await findPeople(PNG, "image/png")).toEqual([]);
  });

  it("logs by kind only, never the model's words", async () => {
    reply = async () => answer("The person at the right wears a brown jacket.");
    await findPeople(PNG, "image/png");
    const logged = warn.mock.calls.flat().join(" ");
    expect(logged).toContain("not boxes");
    expect(logged).not.toContain("jacket");
  });
});
