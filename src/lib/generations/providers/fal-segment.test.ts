import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SAM2_ENDPOINT, SAM2_TIMEOUT_MS, segmentWithBoxes, stillMime } from "./fal-segment";

// SAM 2 on fal for a Set's look (2026-09-12): the request is the measured
// one, and nothing that goes wrong reaches the shot as anything but null.
// No real call is ever made: fetch is a fake throughout.

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]);
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 16]);
const WEBP = Buffer.concat([Buffer.from("RIFF"), Buffer.from([0, 0, 0, 0]), Buffer.from("WEBPVP8 ")]);
const BOXES = [
  { x_min: 0, y_min: 476, x_max: 1023, y_max: 967, object: 22, copy: 0 },
  { x_min: 0, y_min: 302, x_max: 511, y_max: 487, object: 40, copy: 0 },
];
const CUT = Buffer.concat([PNG, Buffer.from("the cut")]);
const answer = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

let calls: { url: string; init: RequestInit }[] = [];
let reply: (init: RequestInit) => Promise<Response>;
const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

beforeEach(() => {
  calls = [];
  reply = async () => answer({ image: { url: `data:image/png;base64,${CUT.toString("base64")}`, width: 1024, height: 1024 } });
  vi.stubEnv("FAL_KEY", "test-key");
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

describe("segmentWithBoxes", () => {
  it("sends the measured request: the still inline, one box each, a PNG mask applied, the answer inline", async () => {
    const out = await segmentWithBoxes(PNG, BOXES);
    expect(out?.equals(CUT)).toBe(true);
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe(SAM2_ENDPOINT);
    expect(SAM2_ENDPOINT).toBe("https://fal.run/fal-ai/sam2/image");
    expect(calls[0].init.method).toBe("POST");
    expect(calls[0].init.headers).toMatchObject({ authorization: "Key test-key", "content-type": "application/json" });
    const body = JSON.parse(String(calls[0].init.body));
    expect(body).toEqual({
      image_url: `data:image/png;base64,${PNG.toString("base64")}`,
      // Only the corners: which object a box was drawn round stays here.
      box_prompts: [
        { x_min: 0, y_min: 476, x_max: 1023, y_max: 967 },
        { x_min: 0, y_min: 302, x_max: 511, y_max: 487 },
      ],
      apply_mask: true,
      output_format: "png",
      sync_mode: true,
    });
  });

  it("names a JPEG or WebP still as what it is", async () => {
    await segmentWithBoxes(JPEG, BOXES);
    await segmentWithBoxes(WEBP, BOXES);
    expect(JSON.parse(String(calls[0].init.body)).image_url.startsWith("data:image/jpeg;base64,")).toBe(true);
    expect(JSON.parse(String(calls[1].init.body)).image_url.startsWith("data:image/webp;base64,")).toBe(true);
    expect(stillMime(Buffer.from("GIF89a"))).toBeNull();
  });

  it("is null, and calls nothing, with no key, no picture or no box", async () => {
    vi.stubEnv("FAL_KEY", "");
    expect(await segmentWithBoxes(PNG, BOXES)).toBeNull();
    vi.stubEnv("FAL_KEY", "test-key");
    expect(await segmentWithBoxes(Buffer.from("not a picture"), BOXES)).toBeNull();
    expect(await segmentWithBoxes(PNG, [])).toBeNull();
    // Not boxes: fractions, negatives, empty or upside down.
    expect(
      await segmentWithBoxes(PNG, [
        { x_min: 0.5, y_min: 0, x_max: 10, y_max: 10 },
        { x_min: -1, y_min: 0, x_max: 10, y_max: 10 },
        { x_min: 10, y_min: 0, x_max: 10, y_max: 10 },
        { x_min: 0, y_min: 20, x_max: 10, y_max: 10 },
      ]),
    ).toBeNull();
    expect(calls).toEqual([]);
  });

  it("is null when fal says no, or answers in any other shape", async () => {
    const bad: (() => Response)[] = [
      () => answer({ detail: "Unprocessable" }, 422),
      () => answer({ detail: "boom" }, 500),
      () => new Response("not json", { status: 200 }),
      () => answer({}),
      () => answer({ image: { url: "https://v3.fal.media/files/cut.png" } }),
      () => answer({ image: { url: `data:image/jpeg;base64,${JPEG.toString("base64")}` } }),
      () => answer({ image: { url: `data:image/png;base64,${Buffer.from("not a png").toString("base64")}` } }),
      () => answer(null),
    ];
    for (const r of bad) {
      reply = async () => r();
      expect(await segmentWithBoxes(PNG, BOXES)).toBeNull();
    }
    expect(calls).toHaveLength(bad.length);
  });

  it("is null when fal does not answer in time — never a throw into the shot", async () => {
    expect(SAM2_TIMEOUT_MS).toBe(30_000);
    reply = (init) =>
      new Promise((_, reject) => {
        init.signal?.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "AbortError" })));
      });
    expect(await segmentWithBoxes(PNG, BOXES, { timeoutMs: 20 })).toBeNull();
    reply = async () => {
      throw new TypeError("fetch failed");
    };
    expect(await segmentWithBoxes(PNG, BOXES)).toBeNull();
  });

  it("stops waiting at the deadline when the answer's body stalls after its headers, not only when the headers are late", async () => {
    // fal answers 200 at once, then the megabytes of base64 never finish
    // arriving. The body ends only when the request's own signal aborts, as
    // Node's fetch ends it; a deadline that lapsed with the headers would
    // leave this read hanging.
    reply = (init) =>
      Promise.resolve(
        new Response(
          new ReadableStream<Uint8Array>({
            start(stream) {
              stream.enqueue(new TextEncoder().encode('{"image":{"url":"data:image/png;base64,iVBOR'));
              init.signal?.addEventListener("abort", () => stream.error(Object.assign(new Error("aborted"), { name: "AbortError" })));
            },
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
      );
    const hung = Symbol("hung");
    const out = await Promise.race([
      segmentWithBoxes(PNG, BOXES, { timeoutMs: 20 }),
      new Promise<typeof hung>((resolve) => setTimeout(() => resolve(hung), 1_000)),
    ]);
    expect(out).toBeNull();
    expect(calls[0].init.signal?.aborted).toBe(true);
  });

  it("logs what went wrong by its kind, never the picture or fal's words", async () => {
    reply = async () => answer({ detail: "echo of the request: data:image/png;base64,AAAA" }, 422);
    await segmentWithBoxes(PNG, BOXES);
    const logged = warn.mock.calls.flat().join(" ");
    expect(logged).toContain("422");
    expect(logged).not.toContain("base64");
    expect(logged).not.toContain("echo");
  });
});
