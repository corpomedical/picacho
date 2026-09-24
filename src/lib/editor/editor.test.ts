import { describe, expect, it, vi } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { planDuration, validatePlan, type ClipInfo, type EditPlan, type Shot } from "./plan";
import { captionLines, placeWords, readBack, shotStarts, snapShotsToWords, type Word } from "./timeline";
import { compileComposition, escapeHtml } from "./compile";
import {
  analyzeArgs,
  parseProbe,
  parseSceneChanges,
  parseSilences,
  segmentArgs,
  sheetInterval,
  sheetIntervalFor,
  tileTime,
} from "./analyze";
import { buildZip } from "./zip";
import { parseTranscript } from "./transcribe";
import { directEdit, transcriptText, DirectorError } from "./director";
import { readRender, startRender, uploadBundle } from "./heygen";
import { opusCostUsd, renderCostUsd, whisperCostUsd } from "./prices";

const talk: ClipInfo = { duration: 30, hasVideo: true, hasAudio: true, width: 1920, height: 1080 };
const song: ClipInfo = { duration: 120, hasVideo: false, hasAudio: true, width: 0, height: 0 };

function shot(over: Partial<Shot> = {}): Shot {
  return { clip: 0, from: 0, to: 2, zoom: 1, focusX: 0.5, focusY: 0.5, transitionIn: "cut", volume: 1, ...over };
}

function plan(over: Partial<EditPlan> = {}): EditPlan {
  return { summary: "", aspect: "16:9", look: "clean", captions: "off", shots: [shot()], texts: [], music: null, ...over };
}

describe("validatePlan", () => {
  it("accepts a plan that fits the footage and repairs small slips silently", () => {
    const { plan: p, errors } = validatePlan(
      { ...plan(), shots: [shot({ from: -0.2, to: 30.1, zoom: 3, focusX: 2 })] },
      [talk],
    );
    expect(errors).toEqual([]);
    expect(p.shots[0]).toMatchObject({ from: 0, to: 30, zoom: 1.5, focusX: 1 });
  });

  it("reports a shot past the clip's end, a missing clip, a too-short shot and an audio-only picture", () => {
    const { errors } = validatePlan(
      {
        ...plan(),
        shots: [shot({ to: 31 }), shot({ clip: 5 }), shot({ from: 1, to: 1.2 }), shot({ clip: 1 })],
      },
      [talk, song],
    );
    expect(errors).toHaveLength(4);
    expect(errors[0]).toContain("only 30 s long");
    expect(errors[1]).toContain("does not exist");
    expect(errors[2]).toContain("shorter than 0.4");
    expect(errors[3]).toContain("no picture");
  });

  it("trims a text that overhangs the end, refuses one that starts after it", () => {
    const { plan: p, errors } = validatePlan(
      {
        ...plan({ shots: [shot({ to: 4 })] }),
        texts: [
          { text: "Hello", start: 3, duration: 5, kind: "title" },
          { text: "Late", start: 9, duration: 1, kind: "callout" },
        ],
      },
      [talk],
    );
    expect(p.texts).toEqual([{ text: "Hello", start: 3, duration: 1, kind: "title" }]);
    expect(errors.join(" ")).toContain("after the edit ends");
  });

  it("falls back to safe enums and needs a sounding clip for music", () => {
    const { plan: p, errors } = validatePlan({ ...plan(), aspect: "4:3", look: "neon", music: { clip: 0, from: 0, volume: 0.4 } }, [
      { ...talk, hasAudio: false },
    ]);
    expect(p.aspect).toBe("16:9");
    expect(p.look).toBe("clean");
    expect(errors.join(" ")).toContain("music bed");
  });

  it("rejects nonsense without throwing", () => {
    expect(validatePlan(null, [talk]).errors).toContain("The plan has no shots.");
  });
});

describe("timeline", () => {
  const words: Word[] = [
    { text: "Hello", start: 1.0, end: 1.4 },
    { text: "there", start: 1.5, end: 1.9 },
    { text: "friends", start: 2.0, end: 2.6 },
  ];

  it("lays shots end to end", () => {
    expect(shotStarts([shot({ from: 5, to: 7 }), shot({ from: 0, to: 1.5 }), shot({ from: 3, to: 4 })])).toEqual([0, 2, 3.5]);
  });

  it("moves a cut inside a word to the nearer edge and leaves cuts in silence alone", () => {
    const [a, b, c] = snapShotsToWords(
      [shot({ from: 1.1, to: 2.5 }), shot({ from: 1.35, to: 2.1 }), shot({ from: 0.5, to: 1.45 })],
      [words],
    );
    expect(a).toMatchObject({ from: 0.96, to: 2.68 }); // keeps "Hello", finishes "friends"
    expect(b).toMatchObject({ from: 1.4, to: 2.0 }); // skips most-lost "Hello", stops before "friends"
    expect(c).toMatchObject({ from: 0.5, to: 1.45 }); // both points in silence
  });

  it("places heard words in output time, drops words cut across an edge", () => {
    const placed = placeWords({ shots: [shot({ from: 1.45, to: 2.7 }), shot({ from: 0.9, to: 1.45 })] }, [words]);
    expect(placed.map((w) => [w.text, w.start])).toEqual([
      ["there", 0.05],
      ["friends", 0.55],
      ["Hello", 1.35],
    ]);
  });

  it("reads the cut back shot by shot", () => {
    const text = readBack({ shots: [shot({ from: 0.9, to: 2.0 }), shot({ from: 10, to: 12 })] }, [words]);
    expect(text).toContain("#1 @0.00s clip 0 0.90–2.00 (1.10s): Hello there");
    expect(text).toContain("#2 @1.10s clip 0 10.00–12.00 (2.00s): (no speech)");
  });

  it("breaks caption lines at shot changes, pauses and length", () => {
    const placed = placeWords({ shots: [shot({ from: 0.9, to: 2.7 })] }, [words]);
    const lines = captionLines(placed, { maxChars: 12 });
    expect(lines.map((l) => l.words.map((w) => w.text).join(" "))).toEqual(["Hello there", "friends"]);
    expect(lines[0].end).toBeLessThanOrEqual(lines[1].start);
  });
});

describe("compileComposition", () => {
  const p = plan({
    captions: "words",
    look: "bold",
    shots: [shot({ from: 0.9, to: 2.7, transitionIn: "fade" }), shot({ from: 10, to: 12, zoom: 1.2, focusX: 0.3 })],
    texts: [{ text: `<script>alert("x")</script> & co`, start: 0, duration: 2, kind: "title" }],
  });
  const media = [
    { src: "media/shot-000.mp4", mediaStart: 0.5, hasAudio: true },
    { src: "media/shot-001.mp4", mediaStart: 0.5, hasAudio: true },
  ];
  const words: Word[] = [
    { text: "Hello", start: 1.0, end: 1.4 },
    { text: "there", start: 1.5, end: 1.9 },
  ];

  it("is deterministic and carries every shot with its trim", () => {
    const a = compileComposition({ plan: p, transcripts: [words], shotMedia: media, music: null });
    expect(a).toBe(compileComposition({ plan: p, transcripts: [words], shotMedia: media, music: null }));
    expect(a).toContain(`data-composition-id="main" data-start="0" data-duration="3.8"`);
    expect(a).toContain(`id="v1" class="clip shot" src="media/shot-001.mp4" data-start="1.8" data-duration="2" data-media-start="0.5"`);
    expect(a).toContain("transform:scale(1.2);transform-origin:30% 50%");
    expect(a).toContain(`tl.fromTo("#v0", { opacity: 0 }`);
  });

  it("escapes every customer or model word and keeps it out of the script", () => {
    const html = compileComposition({ plan: p, transcripts: [words], shotMedia: media, music: null });
    expect(html).not.toContain("<script>alert");
    expect(html).toContain("&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt; &amp; co");
    const script = html.slice(html.lastIndexOf("<script>"));
    expect(script).not.toContain("alert");
    expect(script).not.toContain("HELLO");
  });

  it("highlights each spoken word in the words caption style", () => {
    const html = compileComposition({ plan: p, transcripts: [words], shotMedia: media, music: null });
    expect(html).toContain(`<span id="c0w0">HELLO</span> <span id="c0w1">THERE</span>`);
    expect(html).toContain(`tl.set("#c0w0", { color: "#ffe600" }, 0.1);`);
  });

  it("marks silent shots silent instead of muted, and lays a music bed under the whole edit", () => {
    const html = compileComposition({
      plan: { ...p, captions: "off", music: { clip: 1, from: 12, volume: 0.25 } },
      transcripts: [words],
      shotMedia: [media[0], { ...media[1], hasAudio: false }],
      music: { src: "media/music.m4a", mediaStart: 0 },
    });
    expect(html).not.toContain(" muted");
    expect(html).toMatch(/id="v1"[^>]*data-volume="0"/);
    expect(html).toContain(`<audio id="music" class="clip" src="media/music.m4a" data-start="0" data-duration="3.8" data-media-start="0" data-has-audio="true" data-volume="0.25"`);
  });

  it("refuses mismatched media", () => {
    expect(() => compileComposition({ plan: p, transcripts: [], shotMedia: [media[0]], music: null })).toThrow();
  });

  it("escapes the five dangerous characters", () => {
    expect(escapeHtml(`<a href="x">'&'</a>`)).toBe("&lt;a href=&quot;x&quot;&gt;&#39;&amp;&#39;&lt;/a&gt;");
  });
});

describe("analyze", () => {
  it("chooses sheet intervals that respect the per-clip and whole-job budgets", () => {
    expect(sheetInterval(30)).toBe(1);
    expect(sheetInterval(1800)).toBe(3);
    expect(sheetIntervalFor(60, 60)).toBe(1);
    expect(sheetIntervalFor(60, 3600)).toBe(3); // 3600 s over 60 sheets × 20 tiles
    expect(tileTime(2, 5, 3)).toBe(135);
  });

  it("reads ffmpeg's banner, including a rotated phone clip", () => {
    const banner = `  Duration: 00:01:02.50, start: 0.000000, bitrate: 5814 kb/s
  Stream #0:0[0x1](und): Video: h264 (High) (avc1 / 0x31637661), yuv420p(tv, bt709), 1920x1080, 9000 kb/s, 29.97 fps, 30 tbr (default)
    Side data:
      displaymatrix: rotation of -90.00 degrees
  Stream #0:1[0x2](und): Audio: aac (LC) (mp4a / 0x6134706D), 48000 Hz, stereo, fltp, 192 kb/s (default)`;
    expect(parseProbe(banner)).toEqual({ duration: 62.5, hasVideo: true, hasAudio: true, width: 1080, height: 1920, fps: 29.97 });
    expect(parseProbe("  Duration: 00:00:10.00\n  Stream #0:0: Audio: mp3, 44100 Hz")).toMatchObject({ hasVideo: false, hasAudio: true, duration: 10 });
  });

  it("parses shot changes and silences, closing a silence that runs to the end", () => {
    const err = `[Parsed_showinfo_3 @ 0x1] n:   0 pts:  12288 pts_time:4.52   duration:512
[Parsed_showinfo_3 @ 0x1] n:   1 pts:  24576 pts_time:9.01 duration:512
[silencedetect @ 0x2] silence_start: 1.2
[silencedetect @ 0x2] silence_end: 2.05 | silence_duration: 0.85
[silencedetect @ 0x2] silence_start: 28.4`;
    expect(parseSceneChanges(err)).toEqual([4.52, 9.01]);
    expect(parseSilences(err, 30)).toEqual([
      { start: 1.2, end: 2.05 },
      { start: 28.4, end: 30 },
    ]);
  });

  it("decodes once: sheets, scene scan, speech and silence from one ffmpeg call", () => {
    const args = analyzeArgs("in.mov", { interval: 2, hasVideo: true, hasAudio: true, sheetPattern: "s-%03d.jpg", audioOut: "a.mp3" });
    expect(args.filter((a) => a === "-i")).toHaveLength(1);
    expect(args.join(" ")).toContain("fps=1/2:round=down,tile=5x4");
    expect(args.join(" ")).toContain("silencedetect=noise=-35dB:d=0.35");
    expect(args).toContain("a.mp3");
    const silent = analyzeArgs("in.mov", { interval: 1, hasVideo: true, hasAudio: false, sheetPattern: "s-%03d.jpg", audioOut: "a.mp3" });
    expect(silent).not.toContain("a.mp3");
  });

  it("cuts a segment with handles and reports where the shot starts inside it", () => {
    expect(segmentArgs("in.mov", "o.mp4", { from: 10, to: 14, pad: 0.5, maxEdge: 1920, hasAudio: true })).toMatchObject({
      mediaStart: 0.5,
    });
    const atZero = segmentArgs("in.mov", "o.mp4", { from: 0.2, to: 3, pad: 0.5, maxEdge: 1920, hasAudio: false });
    expect(atZero.mediaStart).toBe(0.2);
    expect(atZero.args).not.toContain("0:a:0");
    expect(atZero.args.slice(atZero.args.indexOf("-ss"), atZero.args.indexOf("-ss") + 2)).toEqual(["-ss", "0.000"]);
  });
});

describe("buildZip", () => {
  it("writes an archive the system unzip reads back byte for byte", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "zip-test-"));
    try {
      const html = new TextEncoder().encode("<html>ok</html>");
      const bin = new Uint8Array(70_000).map((_, i) => (i * 31) % 256);
      const zip = buildZip([
        { name: "index.html", data: html },
        { name: "media/shot-000.mp4", data: bin },
      ]);
      writeFileSync(path.join(dir, "b.zip"), zip);
      const listing = execFileSync("unzip", ["-t", path.join(dir, "b.zip")]).toString();
      expect(listing).toContain("No errors detected");
      expect(execFileSync("unzip", ["-p", path.join(dir, "b.zip"), "index.html"]).toString()).toBe("<html>ok</html>");
      expect(Buffer.compare(execFileSync("unzip", ["-p", path.join(dir, "b.zip"), "media/shot-000.mp4"]), Buffer.from(bin))).toBe(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("refuses a path that climbs out of the bundle", () => {
    expect(() => buildZip([{ name: "../x", data: new Uint8Array(1) }])).toThrow();
  });
});

describe("transcripts", () => {
  it("keeps timed words and drops broken ones", () => {
    expect(
      parseTranscript({
        language: "english",
        words: [
          { word: " Hi", start: 0.1, end: 0.3 },
          { word: "", start: 1, end: 2 },
          { word: "back", start: 2, end: 1 },
          { word: "there", start: 0.4, end: 0.8 },
        ],
      }),
    ).toEqual({
      language: "english",
      words: [
        { text: "Hi", start: 0.1, end: 0.3 },
        { text: "there", start: 0.4, end: 0.8 },
      ],
    });
    expect(parseTranscript("nope")).toEqual({ language: null, words: [] });
  });

  it("gives the director phrases split at pauses with each word's time", () => {
    const text = transcriptText([
      { text: "Hi", start: 0.1, end: 0.3 },
      { text: "there", start: 0.4, end: 0.8 },
      { text: "Again", start: 2.0, end: 2.4 },
    ]);
    expect(text.split("\n")).toEqual(["    [0.10–0.80] Hi@0.10 there@0.40", "    [2.00–2.40] Again@2.00"]);
  });
});

describe("directEdit", () => {
  const clip = { ...talk, name: "take1.mov", interval: 1, sheets: [new Uint8Array([0xff, 0xd8])], sceneChanges: [], silences: [] };
  const words: Word[] = [{ text: "Hello", start: 1.0, end: 1.4 }];

  function fakeClient(replies: unknown[], stops: string[] = []) {
    const seen: unknown[] = [];
    let i = 0;
    const client = {
      messages: {
        stream: vi.fn((params: { messages: unknown[] }) => {
          seen.push(structuredClone(params.messages));
          const reply = replies[i];
          const stop = stops[i] ?? "end_turn";
          i += 1;
          return {
            finalMessage: async () => ({
              content: [{ type: "text", text: JSON.stringify(reply) }],
              stop_reason: stop,
              usage: { input_tokens: 1000, output_tokens: 500, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
            }),
          };
        }),
      },
    };
    return { client: client as never, seen };
  }

  it("fixes a plan that overruns the footage, then reviews it, and snaps cuts to words", async () => {
    const bad = plan({ shots: [shot({ from: 0, to: 40 })] });
    const good = plan({ shots: [shot({ from: 1.2, to: 5 })] });
    const { client, seen } = fakeClient([bad, good, good]);
    const out = await directEdit({ brief: "tighten it", clips: [clip], transcripts: [words], aspect: "9:16", targetSeconds: 20 }, client);
    expect(out.turns).toBe(3);
    expect(out.plan.aspect).toBe("9:16"); // the door's choice wins
    expect(out.plan.shots[0].from).toBe(0.96); // 1.2 fell inside "Hello"
    expect(JSON.stringify(seen[1])).toContain("only 30 s long");
    expect(JSON.stringify(seen[2])).toContain("as the viewer will hear it");
    expect(out.costUsd).toBeCloseTo(3 * (1000 * 4 + 500 * 20) / 1e6, 6);
  });

  it("keeps the pre-review plan when the review answer does not fit", async () => {
    const good = plan({ shots: [shot({ from: 3, to: 6 })] });
    const { client } = fakeClient([good, plan({ shots: [] })]);
    const out = await directEdit({ brief: "", clips: [clip], transcripts: [words], aspect: "16:9", targetSeconds: null }, client);
    expect(out.plan.shots).toHaveLength(1);
  });

  it("stops on a refusal and says what it cost", async () => {
    const { client } = fakeClient([{}], ["refusal"]);
    await expect(directEdit({ brief: "", clips: [clip], transcripts: [words], aspect: "16:9", targetSeconds: null }, client)).rejects.toMatchObject({
      kind: "refused",
    });
  });

  it("gives up after two fixes", async () => {
    const bad = plan({ shots: [shot({ to: 99 })] });
    const { client } = fakeClient([bad, bad, bad]);
    await expect(
      directEdit({ brief: "", clips: [clip], transcripts: [words], aspect: "16:9", targetSeconds: null }, client),
    ).rejects.toBeInstanceOf(DirectorError);
  });
});

describe("heygen", () => {
  it("uploads direct-to-storage, retries the not-ready complete, and renders from the asset", async () => {
    vi.stubEnv("HEYGEN_API_KEY", "hg_test");
    const calls: { url: string; method: string; body?: unknown; headers: Record<string, string> }[] = [];
    let completes = 0;
    const fetchFn = vi.fn(async (url: string, init: RequestInit) => {
      const headers = init.headers as Record<string, string>;
      calls.push({ url, method: String(init.method), body: typeof init.body === "string" ? JSON.parse(init.body) : undefined, headers });
      const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status });
      if (url.endsWith("/v3/assets/direct-uploads")) return json(200, { data: { asset_id: "asst_1", upload_url: "https://s3.example/put", upload_headers: { "x-amz-acl": "private" } } });
      if (url === "https://s3.example/put") return new Response("", { status: 200 });
      if (url.endsWith("/complete")) return ++completes < 2 ? json(409, { error: { code: "not_ready", message: "later" } }) : json(200, { data: { asset_id: "asst_1" } });
      if (url.endsWith("/v3/hyperframes/renders")) return json(202, { data: { render_id: "r_1" } });
      if (url.endsWith("/v3/hyperframes/renders/r_1")) return json(200, { data: { status: "completed", video_url: "https://cdn/v.mp4", duration: 12 } });
      return json(404, {});
    });
    const zip = buildZip([{ name: "index.html", data: new Uint8Array([60]) }]);
    const asset = await uploadBundle(zip, { filename: "edit.zip", fetchFn: fetchFn as never });
    expect(asset).toBe("asst_1");
    expect(calls[0].headers["x-api-key"]).toBe("hg_test");
    expect(calls[0].body).toMatchObject({ filename: "edit.zip", content_type: "application/zip", size_bytes: zip.byteLength });
    expect(calls[1].headers).toMatchObject({ "content-type": "application/zip", "x-amz-acl": "private" });
    expect(calls[1].headers["x-api-key"]).toBeUndefined(); // our key never goes to the storage URL

    const id = await startRender(asset, { aspect: "9:16", callbackUrl: "https://picacho.ai/api/webhooks/heygen/s", fetchFn: fetchFn as never });
    expect(id).toBe("r_1");
    expect(calls.at(-1)!.body).toMatchObject({ project: { type: "asset_id", asset_id: "asst_1" }, aspect_ratio: "9:16", resolution: "1080p" });

    expect(await readRender("r_1", { fetchFn: fetchFn as never })).toEqual({ status: "completed", videoUrl: "https://cdn/v.mp4", duration: 12, failure: null });
    vi.unstubAllEnvs();
  });
});

describe("prices", () => {
  it("costs each step from the dated unit prices", () => {
    expect(opusCostUsd({ input_tokens: 100_000, output_tokens: 20_000 })).toBeCloseTo(0.4 + 0.4, 6);
    expect(opusCostUsd({ cache_read_input_tokens: 100_000 })).toBeCloseTo(0.02, 6);
    expect(whisperCostUsd(300)).toBeCloseTo(0.03, 6);
    expect(renderCostUsd(60)).toBeCloseTo(0.1, 6);
    expect(planDuration({ shots: [shot({ from: 0, to: 1.5 }), shot({ from: 2, to: 3 })] })).toBe(2.5);
  });
});
