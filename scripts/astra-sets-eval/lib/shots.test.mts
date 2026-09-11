import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { RealPipelineOptions } from "../../../src/lib/generations/pipeline.ts";
import { LOOK_REFERENCE_NOTE, referenceNotes } from "../../../src/lib/generations/providers/reference-notes.ts";
import { OUTPUT_BLOCKED_ISSUE, REFUSED_BEFORE_RENDER_ISSUE } from "../../../src/lib/generations/refund-rules.ts";
import { IMAGE_REQUEST_REFUSED, IMAGE_RESULT_REFUSED } from "../../../src/lib/generations/providers/refusal-messages.ts";
import { buildSetShotPrompt } from "../../../src/lib/sets/set-shot-prompt.ts";
import { cleanText, normaliseSetLayout, normaliseSetSpec, type SetSpec } from "../../../src/lib/sets/set-spec.ts";
import { NetGuard, withNetContext } from "./net-guard.mts";
import { MIRRORED, missingMirrors, pipelinePrompt } from "./pipeline-strings.mts";
import { makePriceBook, type ExternalPrices } from "./prices.mts";
import { SEEDREAM_SQUARE, type SeedreamInput } from "./seedream.mts";
import {
  BLOCKED_NOTE,
  classifyEngineError,
  lookRides,
  pipelineOutcome,
  reasonBySentence,
  RenderTap,
  renderEngineOf,
  runShots,
  shoot,
  shotPrompt,
  traitSummary,
  type Engine,
  type ShotCharacter,
  type ShotDeps,
  type ShotEnv,
  type ShotRequest,
} from "./shots.mts";
import { SpendGuard } from "./spend-guard.mts";
import type { LedgerInput } from "./ledger.mts";
import { fixtureJson } from "../parts/simulate.mts";

// One still, sent the way the product sends a Set's shot, over scripted
// product functions: the pipeline, the gates, the scorer and Seedream are
// fakes, and the net guard's "live" calls go to a fake fetch — nothing
// leaves the process.

const spec: SetSpec = (() => {
  const r = normaliseSetSpec(fixtureJson("rainy-market"));
  if (!r.ok) throw new Error("fixture");
  return r.spec;
})();
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
const JPEG = (n: number) => Buffer.from([0xff, 0xd8, 0xff, n]);
const character: ShotCharacter = {
  id: "char-a",
  name: "Test Persona",
  traits: { hair: "short grey hair", distinguishing_features: "a scar over one eyebrow", outfit: "a green coat", personality: "calm" },
  photo: { bytes: JPEG(1), mime: "image/jpeg" },
};
const EMPTY: ExternalPrices = { models: {}, images: { "flux-2-pro-edit": null, "seedream-v4-edit": null }, judgementCeilings: {} };
const PRICED: ExternalPrices = { ...EMPTY, images: { "flux-2-pro-edit": { usdPerImage: 0.05, source: "https://example.test/flux", readOn: "2026-01-01" }, "seedream-v4-edit": null } };

class Refusal extends Error {
  constructor(readonly reason: string) {
    super(reason);
  }
}
class OutputRefusal extends Error {
  constructor(readonly reason: string) {
    super(reason);
  }
}

let root: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "astra-shots-"));
  mkdirSync(join(root, "stills"), { recursive: true });
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

type Calls = {
  gate: { prompt: string; o: { hasRealPersonReference: boolean; priorHits: number } }[];
  pipeline: { prompt: string; options: RealPipelineOptions; maxAttempts: number | undefined }[];
  composedGate: { prompt: string; hasRealPersonReference?: boolean; sessionPriorHits?: number }[];
  seedream: SeedreamInput[];
  judge: { url: string; strictLane?: boolean; promptScores?: unknown }[];
  scored: string[];
};

/** A live-mode net guard over a fake fetch: `status` answers each engine call. */
function fakeNet(status: (url: string) => number = () => 200) {
  const sent: string[] = [];
  const net = new NetGuard({
    mode: "live",
    realFetch: (async (input: RequestInfo | URL) => {
      const url = String(input);
      sent.push(url);
      return new Response(JSON.stringify({ ok: true }), { status: status(url), headers: { "content-type": "application/json" } });
    }) as typeof fetch,
  });
  return { net, sent };
}

/**
 * Scripted product functions. The fake pipeline does what runRealPipeline
 * does with a still: one render call through the guard carrying the prompt
 * plus referenceNotes (as pipeline.ts appends them), then persistImage.
 */
function fakeDeps(net: NetGuard, over: Partial<ShotDeps> & { sendPrompt?: (prompt: string, notes: string) => string; render?: (o: RealPipelineOptions) => "ok" | "fail" } = {}) {
  const calls: Calls = { gate: [], pipeline: [], composedGate: [], seedream: [], judge: [], scored: [] };
  const deps: ShotDeps = {
    entryGate: async (prompt, o) => (calls.gate.push({ prompt, o }), { verdict: "allowed", scores: {} }),
    assertPromptAllowed: (async (i: { prompt: string; hasRealPersonReference?: boolean; sessionPriorHits?: number }) => (calls.composedGate.push(i), { sexual_nudity: "NEGLIGIBLE" })) as unknown as ShotDeps["assertPromptAllowed"],
    promptRefusal: (e) => (e instanceof Refusal ? e.reason : null),
    promptReasonOf: reasonBySentence({ sexual: "PROMPT SEXUAL", unavailable: "PROMPT UNAVAILABLE" }),
    runRealPipeline: (async (prompt: string, _c: unknown, options: RealPipelineOptions, maxAttempts?: number) => {
      calls.pipeline.push({ prompt, options, maxAttempts });
      const notes = referenceNotes({ outfit: false, attached: Boolean(options.propImageUrl), look: Boolean(options.lookImageUrl && options.referenceImageUrl), identity: Boolean(options.referenceImageUrl) });
      const sent = over.sendPrompt ? over.sendPrompt(prompt, notes) : prompt + notes;
      const flux = options.imageModelId === "flux";
      const url = flux ? "https://fal.run/fal-ai/flux-2-pro/edit" : "https://api.openai.com/v1/images/edits";
      let body: FormData | string;
      if (flux) body = JSON.stringify({ prompt: sent });
      else {
        body = new FormData();
        body.set("prompt", sent);
      }
      const res = await net.fetch(url, { method: "POST", body });
      if (!res.ok || over.render?.(options) === "fail") {
        const detail = flux ? `fal.ai (Flux) error (${res.status}): {"detail":"bad image_urls"}` : `OpenAI image API error (${res.status}): x`;
        return { attempts: [{ attempt: 1, steps: [{ step: "generate", detail }], passed: false, issues: ["provider_error"], compiledPrompt: prompt }], succeeded: false, finalPrompt: prompt, resultUrl: null };
      }
      const resultUrl = await (options.persistImage as (b: string) => Promise<string>)(PNG.toString("base64"));
      return { attempts: [{ attempt: 1, steps: [], passed: true, issues: [], compiledPrompt: prompt }], succeeded: true, finalPrompt: prompt, resultUrl };
    }) as unknown as ShotDeps["runRealPipeline"],
    judgeRender: (async (i: { url: string; strictLane?: boolean; promptScores?: unknown }) => (calls.judge.push(i), { allowed: true })) as unknown as ShotDeps["judgeRender"],
    outputRefusal: (e) => (e instanceof OutputRefusal ? e.reason : null),
    outputReasonOf: reasonBySentence({ sexual: "OUTPUT SEXUAL", minors: "OUTPUT MINORS", unavailable: "OUTPUT UNAVAILABLE" }),
    scoreIdentityMatch: (async (result: string) => (calls.scored.push(result), { score: 82, notes: "", unusable: false, scorerVersion: "test/1" })) as unknown as ShotDeps["scoreIdentityMatch"],
    seedream: async (input) => {
      calls.seedream.push(input);
      await net.fetch("https://queue.fal.run/fal-ai/bytedance/seedream/v4/edit", { method: "POST", body: JSON.stringify({ prompt: input.prompt }) });
      return { ok: true, url: "https://v3.fal.media/files/out.png", requestId: "r1" };
    },
    download: async () => ({ bytes: PNG, mime: "image/png" }),
    ...over,
  };
  return { deps, calls };
}

function envOf(net: NetGuard, deps: ShotDeps | null, o: { dry?: boolean; external?: ExternalPrices; maxUsd?: number } = {}) {
  const events: LedgerInput[] = [];
  const guard = new SpendGuard({ maxUsd: o.maxUsd ?? 1e9, sink: (e) => events.push(e) });
  const tap = new RenderTap();
  tap.install(net);
  const env: ShotEnv = {
    dry: o.dry ?? false,
    runDir: root,
    net,
    guard,
    book: makePriceBook({ external: o.external ?? EMPTY, gptImageUsd: 0.17 }),
    deps,
    tap,
    stopping: () => guard.stopped !== null,
    stopWhy: () => "stopped",
    progress: () => {},
    blocked: new Set(),
    sim: { n: 0 },
  };
  return { env, events, guard };
}

const request = (over: Partial<ShotRequest> = {}): ShotRequest => ({
  part: "c",
  shotId: "cs-set1-c1-char-a-gpt-image",
  arm: "set",
  engine: "gpt-image",
  setKey: "set1",
  spec,
  camera: spec.cameras[0],
  frame: { bytes: JPEG(2), mime: "image/jpeg" },
  frameFile: "frames/set1-c1.jpg",
  lifted: true,
  direction: "looks back over one shoulder",
  character,
  look: null,
  priorHits: 0,
  ...over,
});

describe("what the stills copy from the product", () => {
  it("a look rides only where runGeneration and the pipeline let it: a still, one character, GPT Image or FLUX, beside an identity photo", () => {
    expect(lookRides({ engine: "gpt-image", identityPhoto: true, characters: 1 })).toBe(true);
    expect(lookRides({ engine: "flux", identityPhoto: true, characters: 1 })).toBe(true);
    expect(lookRides({ engine: "seedream", identityPhoto: true, characters: 1 })).toBe(false);
    expect(lookRides({ engine: "gpt-image", identityPhoto: false, characters: 1 })).toBe(false);
    expect(lookRides({ engine: "gpt-image", identityPhoto: true, characters: 2 })).toBe(false);
    expect(lookRides({ engine: "flux", identityPhoto: true, characters: 1, contentType: "video" })).toBe(false);
    expect(lookRides({ engine: "flux", identityPhoto: true, characters: 1, storyboard: true })).toBe(false);
  });

  it("the shot prompt is buildSetShotPrompt's, the look sentences included for a look shot", () => {
    const mark = spec.marks[0];
    const layout = normaliseSetLayout({ markId: mark.id, mark, camera: { position: spec.cameras[0].position, target: spec.cameras[0].target, fovDeg: spec.cameras[0].fovDeg } }, spec);
    const look = { sameCharacter: true, savedOutfit: false };
    const withLook = shotPrompt({ ...request(), look });
    expect(withLook).toBe(buildSetShotPrompt({ description: spec.description, direction: "looks back over one shoulder", lifted: true, layout, look }));
    expect(withLook).toContain("One reference photo is an earlier still from this same set");
    expect(withLook).toContain("The person in it is the same person");
    expect(shotPrompt(request())).not.toContain("earlier still");
    expect(shotPrompt({ ...request(), arm: "control", camera: null })).toBe(cleanText(`looks back over one shoulder. ${spec.description}`, 500));
  });

  it("the engine gets the prompt and the pipeline's notes: the sketch, the look when it rides, then the person", () => {
    expect(pipelinePrompt("P")).toBe("P" + referenceNotes({ outfit: false, attached: true, look: false, identity: true }));
    expect(pipelinePrompt("P", { look: true })).toContain(LOOK_REFERENCE_NOTE);
    expect(pipelinePrompt("P", { look: true }).indexOf(LOOK_REFERENCE_NOTE)).toBeLessThan(pipelinePrompt("P", { look: true }).indexOf("Every other reference photo is the person"));
  });

  it("the scorer's trait summary is runGeneration's", () => {
    expect(traitSummary(character.traits)).toBe("hair: short grey hair; distinguishing features: a scar over one eyebrow");
    expect(traitSummary({ hair: "", distinguishing_features: "" })).toBe("");
  });

  // Synthetic sources: the real files are read at run time, never by the
  // suite, so a product commit is never blocked by the eval.
  it("the mirrored lines match with their whitespace folded, and a changed line is named", () => {
    const files = new Map<string, string>();
    for (const m of MIRRORED) files.set(m.file, `${files.get(m.file) ?? ""}\n    ${m.text.replace(/ /g, "\n      ")}\n`);
    expect(missingMirrors((f) => files.get(f) ?? null)).toEqual([]);
    const look = MIRRORED.find((m) => m.label.startsWith("runGeneration: a look rides")) as (typeof MIRRORED)[number];
    const changed = new Map(files);
    changed.set(look.file, (changed.get(look.file) as string).replace('"flux")', '"flux-3")'));
    expect(missingMirrors((f) => changed.get(f) ?? null)).toEqual([look.label]);
    expect(missingMirrors(() => null)).toHaveLength(MIRRORED.length);
  });
});

describe("what a pipeline result means", () => {
  const reasons = { promptReasonOf: reasonBySentence({ sexual: "PS", unavailable: "PU" }), outputReasonOf: reasonBySentence({ sexual: "OS", minors: "OM", unavailable: "OU" }) };
  const failed = (issues: string[], steps: { step: string; detail: string }[], over: Record<string, unknown> = {}) => ({ succeeded: false, resultUrl: null, attempts: [{ issues, steps }], ...over });

  it("reads each gate's refusal back from its sentence, and an unavailable gate is no refusal", () => {
    expect(pipelineOutcome({ succeeded: true, resultUrl: "data:x", attempts: [] }, reasons).outcome).toBe("rendered");
    expect(pipelineOutcome(failed(["content_policy"], [], { contentPolicyBlock: "PS" }), reasons)).toMatchObject({ outcome: "prompt_blocked", reason: "sexual" });
    expect(pipelineOutcome(failed(["content_policy"], [], { contentPolicyBlock: "PU" }), reasons).outcome).toBe("unjudged");
    expect(pipelineOutcome(failed([OUTPUT_BLOCKED_ISSUE], [{ step: "validate", detail: "OM" }]), reasons)).toMatchObject({ outcome: "output_blocked", reason: "minors" });
    expect(pipelineOutcome(failed([OUTPUT_BLOCKED_ISSUE], [{ step: "validate", detail: "OU" }]), reasons).outcome).toBe("unjudged");
  });

  it("tells the image model's own refusal from an error, and a fal refusal of the references from a content refusal", () => {
    expect(pipelineOutcome(failed(["provider_error", REFUSED_BEFORE_RENDER_ISSUE], [{ step: "generate", detail: IMAGE_REQUEST_REFUSED }]), reasons)).toMatchObject({ outcome: "provider_refused", reason: "before render" });
    expect(pipelineOutcome(failed(["provider_error"], [{ step: "generate", detail: IMAGE_RESULT_REFUSED }]), reasons)).toMatchObject({ outcome: "provider_refused", reason: "after render" });
    expect(pipelineOutcome(failed(["provider_error"], [{ step: "generate", detail: 'fal.ai (Flux) error (422): {"detail":[{"type":"content_policy_violation"}]}' }]), reasons).outcome).toBe("provider_refused");
    const refs = pipelineOutcome(failed(["provider_error"], [{ step: "generate", detail: 'fal.ai (Flux) error (422): {"detail":"image_urls: could not load data:image/jpeg;base64,/9j/AAAA"}' }]), reasons);
    expect(refs).toMatchObject({ outcome: "error", refsRefused: true });
    expect(refs.note).not.toContain("/9j/");
    expect(classifyEngineError("fal.ai (Flux) error (401): no key")).toMatchObject({ outcome: "error", refsRefused: false });
    expect(classifyEngineError("fal.ai (Seedream) error (400): x")).toMatchObject({ refsRefused: true, status: 400 });
    expect(pipelineOutcome(failed(["cancelled"], [], { cancelled: true }), reasons).outcome).toBe("not_run");
  });

  it("knows which live calls render a picture", () => {
    expect(renderEngineOf("api.openai.com", "/v1/images/edits", "POST")).toBe("gpt-image");
    expect(renderEngineOf("api.openai.com", "/v1/chat/completions", "POST")).toBeNull();
    expect(renderEngineOf("fal.run", "/fal-ai/flux-2-pro/edit", "POST")).toBe("flux");
    expect(renderEngineOf("queue.fal.run", "/fal-ai/bytedance/seedream/v4/edit", "POST")).toBe("seedream");
    expect(renderEngineOf("queue.fal.run", "/fal-ai/bytedance/seedream/v4/edit/requests/abc/status", "GET")).toBeNull();
    expect(renderEngineOf("v3.fal.media", "/files/a.png", "GET")).toBeNull();
  });
});

describe("one still, per engine", () => {
  it("GPT Image: the parity route, references served from memory, 2 renders reserved and one settled", async () => {
    const { net } = fakeNet();
    const { deps, calls } = fakeDeps(net);
    const { env, events } = envOf(net, deps);
    const r = await shoot(env, request());
    expect(r).toMatchObject({ outcome: "rendered", entryGate: "allowed", promptParity: true, sentPrompt: null, engineCalls: 1, billedUsd: 0.17, identityDecision: "pass" });
    expect(r.identity).toEqual({ score: 82, unusable: false, scorerVersion: "test/1" });
    expect(calls.gate).toEqual([{ prompt: r.prompt, o: { hasRealPersonReference: true, priorHits: 0 } }]);
    const { options, maxAttempts, prompt } = calls.pipeline[0];
    expect(prompt).toBe(r.prompt);
    expect(maxAttempts).toBe(1);
    expect(options).toMatchObject({ contentType: "image", imageModelId: "gpt-image", hasAttachedReference: true, strictContentLane: true, skipRefinement: true, brandRules: [], lookImageUrl: null });
    expect(options.policyAudit).toBeUndefined();
    // openai-images.ts fetches http(s) only: the pictures are local routes.
    for (const u of [options.referenceImageUrl, options.propImageUrl]) expect(u).toMatch(/^https:\/\/eval\.invalid\/ref\/[0-9a-f]{64}\.jpg$/);
    expect(Buffer.from(await (await net.fetch(options.referenceImageUrl as string)).arrayBuffer())).toEqual(character.photo?.bytes);
    // Reserved at GENERATE_RETRIES × $0.17, settled at the one render the tap saw.
    const reserve = events.find((e) => e.ev === "reserve");
    expect(reserve).toMatchObject({ kind: "gpt-image", worstUsd: 0.34 });
    expect(events.find((e) => e.ev === "settle")).toMatchObject({ actualUsd: 0.17 });
    expect(r.resultFile).toBe("stills/cs-set1-c1-char-a-gpt-image.png");
    expect(readFileSync(join(root, r.resultFile as string))).toEqual(PNG);
    expect(calls.scored[0]).toMatch(/^data:image\/png;base64,/);
  });

  it("FLUX: fal gets data: references; an unpriced engine's render is a metered ledger line", async () => {
    const { net } = fakeNet();
    const { deps, calls } = fakeDeps(net);
    const { env, events } = envOf(net, deps);
    const r = await shoot(env, request({ engine: "flux", shotId: "cs-flux" }));
    expect(r).toMatchObject({ outcome: "rendered", engineCalls: 1, billedUsd: null, promptParity: true });
    expect(calls.pipeline[0].options.referenceImageUrl).toMatch(/^data:image\/jpeg;base64,/);
    expect(calls.pipeline[0].options.propImageUrl).toMatch(/^data:image\/jpeg;base64,/);
    expect(events.filter((e) => e.ev === "reserve")).toEqual([]);
    expect(events.filter((e) => e.ev === "meter")).toEqual([expect.objectContaining({ model: "flux (per image)", usd: null, ref: "cs-flux" })]);
    // Priced once external-prices.json has fal's figure: reserved and settled like GPT Image.
    const other = fakeNet().net;
    const priced = envOf(other, fakeDeps(other).deps, { external: PRICED });
    const p = await shoot(priced.env, request({ engine: "flux", shotId: "cs-flux-2" }));
    expect(p.billedUsd).toBeCloseTo(0.05, 12);
    expect(priced.events.find((e) => e.ev === "reserve")).toMatchObject({ kind: "flux", worstUsd: 0.1 });
  });

  it("flags the prompt the engine actually received when it is not the shot prompt and the pipeline's notes", async () => {
    const { net } = fakeNet();
    const { deps } = fakeDeps(net, { sendPrompt: (prompt, notes) => `${prompt} and something else${notes}` });
    const { env } = envOf(net, deps);
    const r = await shoot(env, request());
    expect(r.promptParity).toBe(false);
    expect(r.sentPrompt).toContain("and something else");
    expect(r.expectedPrompt).toBe(pipelinePrompt(r.prompt));
  });

  it("Seedream: the composed prompt, gated as a compiled prompt, the identity then the sketch as data: URIs, the square size, judged in the strict lane", async () => {
    const { net } = fakeNet();
    const { deps, calls } = fakeDeps(net);
    const { env } = envOf(net, deps);
    const r = await shoot(env, request({ engine: "seedream", shotId: "cs-sd" }));
    const composed = pipelinePrompt(r.prompt);
    expect(r).toMatchObject({ outcome: "rendered", expectedPrompt: composed, promptParity: true, engineCalls: 1, billedUsd: null });
    expect(calls.composedGate).toEqual([{ prompt: composed, hasRealPersonReference: true, sessionPriorHits: 0 }]);
    expect(calls.seedream[0].prompt).toBe(composed);
    expect(calls.seedream[0].imageSize).toBe(SEEDREAM_SQUARE);
    expect(calls.seedream[0].imageUrls.map((u) => u.slice(0, 23))).toEqual(["data:image/jpeg;base64,", "data:image/jpeg;base64,"]);
    expect(calls.seedream[0].imageUrls[0]).toBe(`data:image/jpeg;base64,${character.photo?.bytes.toString("base64")}`);
    expect(calls.judge[0]).toMatchObject({ strictLane: true, promptScores: { sexual_nudity: "NEGLIGIBLE" } });
    expect(calls.pipeline).toEqual([]);
  });

  it("Seedream: an output refusal keeps its reason and never keeps the picture", async () => {
    const { net } = fakeNet();
    const { deps } = fakeDeps(net, { judgeRender: (async () => Promise.reject(new OutputRefusal("sexual"))) as unknown as ShotDeps["judgeRender"] });
    const { env } = envOf(net, deps);
    const r = await shoot(env, request({ engine: "seedream", shotId: "cs-sd-x" }));
    expect(r).toMatchObject({ outcome: "output_blocked", reason: "sexual", resultFile: null, identityDecision: null });
    expect(existsSync(join(root, "stills/cs-sd-x.png"))).toBe(false);
  });

  it("GPT Image and FLUX: the pipeline's output refusal keeps its reason (read from its sentence) and never keeps the picture it persisted", async () => {
    const { net } = fakeNet();
    const runRealPipeline = (async (_p: string, _c: unknown, options: RealPipelineOptions) => {
      await (options.persistImage as (b: string) => Promise<string>)(PNG.toString("base64"));
      return {
        attempts: [{ attempt: 1, steps: [{ step: "validate", detail: "OUTPUT MINORS" }], passed: false, issues: [OUTPUT_BLOCKED_ISSUE], compiledPrompt: "" }],
        succeeded: false,
        finalPrompt: "",
        resultUrl: null,
      };
    }) as unknown as ShotDeps["runRealPipeline"];
    const { deps, calls } = fakeDeps(net, { runRealPipeline });
    const r = await shoot(envOf(net, deps).env, request({ shotId: "cs-blocked" }));
    expect(r).toMatchObject({ outcome: "output_blocked", reason: "minors", resultFile: null, identityDecision: null });
    expect(existsSync(join(root, "stills/cs-blocked.png"))).toBe(false);
    expect(calls.scored).toEqual([]);
  });

  it("the entry gate: a refusal stops the still before anything is reserved or sent; an unavailable gate is unjudged", async () => {
    const { net, sent } = fakeNet();
    const refused = fakeDeps(net, { entryGate: async () => ({ verdict: { refused: "minors" }, scores: undefined }) });
    const a = envOf(net, refused.deps);
    expect(await shoot(a.env, request())).toMatchObject({ outcome: "prompt_blocked", entryGate: "refused:minors", reason: "minors", engineCalls: 0 });
    expect(refused.calls.pipeline).toEqual([]);
    expect(a.events).toEqual([]);
    const down = fakeDeps(net, { entryGate: async () => ({ verdict: "unavailable", scores: undefined }) });
    expect((await shoot(envOf(net, down.deps).env, request())).outcome).toBe("unjudged");
    expect(sent).toEqual([]);
  });

  it("a control is an ordinary render: no sketch, the drafter on, the lenient lane", async () => {
    const { net } = fakeNet();
    const { deps, calls } = fakeDeps(net);
    const { env } = envOf(net, deps);
    const r = await shoot(env, request({ arm: "control", shotId: "cc-1", camera: null, frame: null, frameFile: null }));
    expect(r).toMatchObject({ outcome: "rendered", expectedPrompt: null, promptParity: null, cameraId: null });
    expect(calls.gate[0].o).toEqual({ hasRealPersonReference: false, priorHits: 0 });
    expect(calls.pipeline[0].options).toMatchObject({ hasAttachedReference: false, strictContentLane: false, skipRefinement: false });
    expect(calls.pipeline[0].options.propImageUrl).toBeUndefined();
  });

  it("identity: a score under the threshold is a miss ('retry'), with no re-render; a scorer that fails is not measured", async () => {
    const { net } = fakeNet();
    const low = fakeDeps(net, { scoreIdentityMatch: (async () => ({ score: 60, notes: "", unusable: false, scorerVersion: "t" })) as unknown as ShotDeps["scoreIdentityMatch"] });
    const r = await shoot(envOf(net, low.deps).env, request());
    expect(r).toMatchObject({ identityDecision: "retry", engineCalls: 1 });
    expect(low.calls.pipeline).toHaveLength(1);
    const broken = fakeDeps(net, { scoreIdentityMatch: (async () => Promise.reject(new Error("timeout"))) as unknown as ShotDeps["scoreIdentityMatch"] });
    expect(await shoot(envOf(net, broken.deps).env, request())).toMatchObject({ identity: { score: null }, identityDecision: "pass" });
  });

  it("books a render sent with no answer, and bills nothing for one answered with a refusal", async () => {
    let n = 0;
    const flaky = new NetGuard({
      mode: "live",
      realFetch: (async () => {
        n += 1;
        if (n === 1) throw new TypeError("socket hang up");
        return new Response("{}", { status: 400, headers: { "content-type": "application/json" } });
      }) as typeof fetch,
    });
    const tap = new RenderTap();
    tap.install(flaky);
    for (let i = 0; i < 2; i++) {
      const form = new FormData();
      form.set("prompt", "p");
      await withNetContext({ ref: "s1" }, () => flaky.fetch("https://api.openai.com/v1/images/edits", { method: "POST", body: form })).catch(() => null);
    }
    expect(tap.rendersOf("s1")).toMatchObject({ answered: 0, unknown: 1 });
  });

  it("stops at the budget: a still that cannot be reserved is never sent", async () => {
    const { net, sent } = fakeNet();
    const { deps } = fakeDeps(net);
    const { env } = envOf(net, deps, { maxUsd: 0.2 });
    const r = await shoot(env, request());
    expect(r).toMatchObject({ outcome: "not_run", entryGate: "allowed" });
    expect(r.note).toMatch(/^budget/);
    expect(sent).toEqual([]);
    expect((await shoot(env, request({ shotId: "next" }))).note).toMatch(/^not reached/);
  });
});

describe("many stills", () => {
  const group = (engine: Engine) => ({
    first: request({ engine, shotId: `cs-c1-${engine}` }),
    rest: [request({ engine, shotId: `cs-c2-${engine}`, camera: spec.cameras[1] ?? spec.cameras[0] })],
    withLook: [request({ engine, shotId: `cl-c2-${engine}`, arm: "look", camera: spec.cameras[1] ?? spec.cameras[0] })],
  });

  it("the later cameras carry camera 1's still as the look, as shootInSet sends it", async () => {
    const { net } = fakeNet();
    const { deps, calls } = fakeDeps(net);
    const { env } = envOf(net, deps);
    const records = await runShots(env, { groups: [group("gpt-image")], singles: [], concurrency: 2, onRecord: () => {} });
    const look = records.find((r) => r.arm === "look");
    expect(look).toMatchObject({ outcome: "rendered", look: { fromShotId: "cs-c1-gpt-image", sameCharacter: true, savedOutfit: false }, promptParity: true });
    expect(look?.prompt).toContain("earlier still from this same set");
    expect(look?.expectedPrompt).toContain(LOOK_REFERENCE_NOTE);
    const sentLook = calls.pipeline.find((c) => c.prompt === look?.prompt)?.options.lookImageUrl as string;
    expect(sentLook).toMatch(/^https:\/\/eval\.invalid\/ref\//);
    // The look is camera 1's still itself.
    expect(Buffer.from(await (await net.fetch(sentLook)).arrayBuffer())).toEqual(readFileSync(join(root, "stills/cs-c1-gpt-image.png")));
    const twin = records.find((r) => r.shotId === "cs-c2-gpt-image");
    expect(twin?.look).toBeNull();
    expect(calls.pipeline.find((c) => c.prompt === twin?.prompt)?.options.lookImageUrl).toBeNull();
  });

  it("with no first still, the look shots are recorded and never sent", async () => {
    const { net } = fakeNet();
    const { deps, calls } = fakeDeps(net, { render: (o) => (o.lookImageUrl === null && o.propImageUrl && calls.pipeline.length === 1 ? "fail" : "ok") });
    const { env } = envOf(net, deps);
    const records = await runShots(env, { groups: [group("gpt-image")], singles: [], concurrency: 1, onRecord: () => {} });
    expect(records.find((r) => r.shotId === "cs-c1-gpt-image")?.outcome).toBe("error");
    expect(records.find((r) => r.arm === "look")).toMatchObject({ outcome: "not_run", note: expect.stringMatching(/made no still to carry/) });
    expect(calls.pipeline).toHaveLength(2);
  });

  it("a fal refusal of the data: references BLOCKS that engine: its later stills are never sent", async () => {
    const { net } = fakeNet((url) => (url.startsWith("https://fal.run/") ? 422 : 200));
    const { deps, calls } = fakeDeps(net);
    const { env } = envOf(net, deps);
    const records = await runShots(env, { groups: [group("flux")], singles: [], concurrency: 1, onRecord: () => {} });
    expect(records[0]).toMatchObject({ outcome: "error", refsRefused: true });
    expect(env.blocked.has("flux")).toBe(true);
    expect(records.filter((r) => r.note === BLOCKED_NOTE).map((r) => r.shotId)).toEqual(["cs-c2-flux"]);
    expect(records.find((r) => r.arm === "look")?.outcome).toBe("not_run");
    expect(calls.pipeline).toHaveLength(1);
  });

  it("the dry run's engine hands the frame back as the still, calls nothing, and books the worst case", async () => {
    const { net, sent } = fakeNet();
    const { env, events } = envOf(net, null, { dry: true });
    const records = await runShots(env, { groups: [group("gpt-image")], singles: [], concurrency: 1, onRecord: () => {} });
    expect(records.map((r) => r.outcome)).toEqual(["rendered", "rendered", "rendered"]);
    expect(records.every((r) => r.simulated && r.billedUsd === 0.34)).toBe(true);
    expect(readFileSync(join(root, records[0].resultFile as string))).toEqual(JPEG(2));
    expect(events.filter((e) => e.ev === "settle")).toHaveLength(3);
    expect(sent).toEqual([]);
    // The fake output gate refuses every fifth still.
    const more = await runShots(env, { groups: [group("flux"), group("seedream")], singles: [], concurrency: 1, onRecord: () => {} });
    expect(more.filter((r) => r.outcome === "output_blocked")).toHaveLength(1);
  });
});
