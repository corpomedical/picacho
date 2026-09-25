import sharp from "sharp";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import {
  CANDIDATES_MAX,
  OCR_ENDPOINT,
  OCR_MAX_IMAGES,
  linesFromResponse,
  normaliseLabelCandidate,
  proposeLabelCandidates,
  readLabelText,
} from "./ocr";

// Label candidates from Cloud Vision. No real network: fetch is stubbed, and
// every assertion about the request is about what would leave the server.

let photo: Buffer;
beforeAll(async () => {
  photo = await sharp({ create: { width: 600, height: 600, channels: 3, background: { r: 240, g: 240, b: 240 } } })
    .jpeg()
    .toBuffer();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

function visionReply(texts: (string | { error: string })[]) {
  return texts.map((t) =>
    typeof t === "string"
      ? { fullTextAnnotation: { text: t }, textAnnotations: [{ description: t }] }
      : { error: { code: 3, message: t.error } },
  );
}

/** A fetch that answers each call with the next reply, and records what was sent. */
function stubFetch(replies: { status: number; body?: unknown }[]) {
  const sent: { url: string; init: RequestInit }[] = [];
  let i = 0;
  const fn = vi.fn(async (url: string, init: RequestInit) => {
    sent.push({ url, init });
    const reply = replies[Math.min(i++, replies.length - 1)];
    return new Response(JSON.stringify(reply.body ?? {}), { status: reply.status, headers: { "content-type": "application/json" } });
  });
  vi.stubGlobal("fetch", fn);
  return { fn, sent };
}

describe("not configured", () => {
  it("answers { configured: false } and sends nothing when GOOGLE_VISION_API_KEY is absent", async () => {
    vi.stubEnv("GOOGLE_VISION_API_KEY", "");
    const { fn } = stubFetch([{ status: 200 }]);
    expect(await readLabelText([photo])).toEqual({ configured: false });
    expect(await readLabelText([photo], { apiKey: null })).toEqual({ configured: false });
    expect(fn).not.toHaveBeenCalled();
  });
});

describe("the request", () => {
  it("sends the photo as bytes with the key in a header, never in the URL", async () => {
    const { sent } = stubFetch([{ status: 200, body: { responses: visionReply(["ACME\nCOLD BREW"]) } }]);
    const out = await readLabelText([photo], { apiKey: "secret-key-123" });
    expect(out).toMatchObject({ configured: true, ok: true, candidates: ["ACME", "COLD BREW"], imagesRead: 1 });
    expect(sent).toHaveLength(1);
    expect(sent[0].url).toBe(OCR_ENDPOINT);
    expect(sent[0].url).not.toContain("secret-key-123");
    expect((sent[0].init.headers as Record<string, string>)["x-goog-api-key"]).toBe("secret-key-123");
    const body = JSON.parse(String(sent[0].init.body));
    expect(body.requests).toHaveLength(1);
    expect(body.requests[0].features).toEqual([{ type: "TEXT_DETECTION" }]);
    expect(typeof body.requests[0].image.content).toBe("string");
    expect(body.requests[0].image.source).toBeUndefined();
  });

  it("reads at most 5 photos a product", async () => {
    const { fn } = stubFetch([{ status: 200, body: { responses: visionReply(["ACME"]) } }]);
    await readLabelText(Array.from({ length: 8 }, () => photo), { apiKey: "k" });
    expect(fn).toHaveBeenCalledTimes(OCR_MAX_IMAGES);
  });
});

describe("failures are answers, never throws", () => {
  it("a refused key, a busy service and a broken reply each say so", async () => {
    stubFetch([{ status: 403, body: { error: { message: "API not enabled" } } }]);
    expect(await readLabelText([photo], { apiKey: "k" })).toEqual({ configured: true, ok: false, reason: "refused", candidates: [] });
    stubFetch([{ status: 429 }]);
    expect(await readLabelText([photo], { apiKey: "k" })).toMatchObject({ ok: false, reason: "busy" });
    stubFetch([{ status: 500 }]);
    expect(await readLabelText([photo], { apiKey: "k" })).toMatchObject({ ok: false, reason: "unavailable" });
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("socket hang up"); }));
    expect(await readLabelText([photo], { apiKey: "k" })).toMatchObject({ ok: false, reason: "unavailable" });
  });

  it("one photo's error does not cost the others", async () => {
    stubFetch([
      { status: 200, body: { responses: visionReply([{ error: "bad image" }]) } },
      { status: 200, body: { responses: visionReply(["SOLSTAD"]) } },
    ]);
    const out = await readLabelText([photo, photo], { apiKey: "k" });
    expect(out).toMatchObject({ ok: true, candidates: ["SOLSTAD"], imagesRead: 1 });
  });

  it("bytes that are not a picture are not sent", async () => {
    const { fn } = stubFetch([{ status: 200, body: { responses: visionReply(["X"]) } }]);
    expect(await readLabelText([Buffer.from("nope")], { apiKey: "k" })).toMatchObject({ ok: true, candidates: [], imagesRead: 0 });
    expect(fn).not.toHaveBeenCalled();
  });
});

describe("candidates", () => {
  it("are cleaned: NFC and full-width letters, invisibles and bidi removed, stray punctuation trimmed, meaningful endings kept", () => {
    expect(normaliseLabelCandidate("  ＡＣＭＥ  ")).toBe("ACME");
    expect(normaliseLabelCandidate("CO​LD‮ BREW")).toBe("CO LD BREW");
    expect(normaliseLabelCandidate("“Solstad”.")).toBe("Solstad");
    expect(normaliseLabelCandidate("100%")).toBe("100%");
    expect(normaliseLabelCandidate("ACME™")).toBe("ACME™");
    expect(normaliseLabelCandidate("• NEW •")).toBe("NEW");
    expect(normaliseLabelCandidate("hidden\u{e0041}\u{e0042}tag")).toBe("hiddentag");
  });

  it("are 2 to 80 characters with at least 2 letters or digits", () => {
    expect(normaliseLabelCandidate("5")).toBeNull();
    expect(normaliseLabelCandidate("5%")).toBeNull();
    expect(normaliseLabelCandidate("---")).toBeNull();
    expect(normaliseLabelCandidate("XL")).toBe("XL");
    expect(normaliseLabelCandidate("a".repeat(80))).toHaveLength(80);
    expect(normaliseLabelCandidate("a".repeat(81))).toBeNull();
    expect(normaliseLabelCandidate(42)).toBeNull();
  });

  it("rank words seen on more photos first, then reading order, deduped ignoring case, at most 24", () => {
    const out = proposeLabelCandidates([
      ["Ingredients", "ACME", "Cold Brew"],
      ["acme", "330 ml"],
      ["ACME", "cold brew"],
    ]);
    expect(out).toEqual(["ACME", "Cold Brew", "Ingredients", "330 ml"]);
    const many = proposeLabelCandidates([Array.from({ length: 60 }, (_, i) => `WORD ${i}`)]);
    expect(many).toHaveLength(CANDIDATES_MAX);
    expect(many[0]).toBe("WORD 0");
  });

  it("linesFromResponse reads the full text, falls back to the first annotation, and refuses an error", () => {
    expect(linesFromResponse({ fullTextAnnotation: { text: "A1\nB2\n\n" } })).toEqual(["A1", "B2"]);
    expect(linesFromResponse({ textAnnotations: [{ description: "ONLY HERE" }] })).toEqual(["ONLY HERE"]);
    expect(linesFromResponse({})).toEqual([]);
    expect(linesFromResponse({ error: { code: 7 } })).toBeNull();
    expect(linesFromResponse(null)).toBeNull();
  });
});
