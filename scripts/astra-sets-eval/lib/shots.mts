// The stills: C's engine leg and D's stills leg (design §6.5).
//
// One still is ONE ordinary image take, sent the way the product sends a
// Set's shot (sets/actions.ts shootInSet → runGeneration → runRealPipeline),
// without the database:
//
//   1. the prompt    buildSetShotPrompt over the set's description, the
//                    direction, the lift and the layout (the figure on the
//                    first mark, the camera's pose). A look shot's prompt
//                    carries the look sentences: the same character, and no
//                    saved outfit photo (the corpus has none). A control is
//                    an ordinary render: the direction and the description,
//                    nothing attached.
//   2. entry gate    assertPromptAllowed on that prompt, as runGeneration's
//                    gatePrompt judges it: the strict lane when an attachment
//                    rides (every set shot), sessionPriorHits explicit.
//   3. the engine    GPT Image 2 and FLUX.2 through runRealPipeline itself,
//                    the parity route: the identity photo, then the sketch
//                    as the attached reference, then the look (image.ts's
//                    order); the prompt final (no drafter), the strict lane,
//                    no brand rules, one attempt (GENERATE_RETRIES renders at
//                    most). Its compiled-prompt gate and its output gate
//                    (judgeRender) run inside it, as in production.
//                    Seedream v4 edit is not a product lane. The composed
//                    route sends the prompt with the pipeline's two notes,
//                    gated first as the pipeline gates a compiled prompt,
//                    then judges the picture with judgeRender (strict lane).
//                    Neither route logs anything: no policyAudit, no
//                    gatePrompt, so the gates inside see sessionPriorHits 0.
//   4. parity        the net guard's tap: what the engine actually received
//                    must be the shot prompt plus the pipeline's notes, or
//                    the shot is flagged (pipeline drift).
//   5. identity      scoreIdentityMatch against the character's photo, then
//                    identityGateDecision at DEFAULT_IDENTITY_THRESHOLD: a
//                    "retry" is a miss; there is no free re-render. A picture
//                    the scorer calls unusable (a blank or black frame) is
//                    runGeneration's non-delivery: the take fails and its
//                    URL is cleared before any gate decision
//                    (identity-gate-run.ts, actions.ts), so here it is
//                    "unusable": deleted, never scored against a bar, never
//                    carried as a look (shootInSet takes only a succeeded
//                    take).
//
// A STOP. The run's stop is asked after the entry gate answers (it takes
// seconds) and handed to the pipeline as its checkCancelled, which it asks
// before its attempt and again after its gate on the compiled prompt, right
// before the render: the product's own Stop checkpoints. The composed route
// asks before it sends Seedream. A still the stop reaches is not run.
//
// REFERENCES. openai-images.ts fetches each reference and refuses anything
// but http(s), so GPT Image gets every picture as https://eval.invalid/ref/…,
// served from memory by the net guard. fal fetches its own, so FLUX and
// Seedream get data: URIs. Nothing is uploaded anywhere: if fal refuses the
// data: references (`c --probe` asks), that engine's arm is BLOCKED and the
// rest of its shots are not sent. A look shot's request is the largest (the
// identity, the sketch and the earlier still): fal refusing it blocks that
// engine's look arm alone, and the set arm goes on.
//
// MONEY. A GPT Image still reserves GENERATE_RETRIES renders at
// IMAGE_COST_USD before anything is sent, and settles by the renders the
// tap saw: each answered 2xx is billed; each sent with no answer is booked
// too, flagged, since it may have been made and billed. An answered refusal
// bills nothing only where that is measured: a refusal before rendering
// (OpenAI's ledger, refund-rules.ts). GPT Image's output-stage refusal
// answers 400 for a picture already drawn, and whether OpenAI bills it is
// unmeasured (refund-rules.ts), so it is booked as one render, flagged; the
// reservation covers it. FLUX and Seedream are reserved the same way once
// external-prices.json prices them; until then each render is a metered
// ledger line with no price (--allow-unpriced). The gates, the drafter and
// the scorer are metered by the tap.
//
// PICTURES. A still the output gate refused is deleted: the product never
// shows one, and the eval keeps its count and reason only. A still that
// passed stays in the run's stills/ (a consented or AI-persona face: on this
// machine only). No brief, prompt or photo is ever logged: progress is ids.
//
// THE DRY RUN'S ENGINE (simulateShot) hands the frame back as the still (a
// control, which has no frame, its character's photo). No gate, engine or
// scorer is called; the fake output gate refuses every fifth still, so the
// refusal paths run too; and a priced engine's money is reserved and settled
// at the worst case, so the simulated spend equals the ceiling.

import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { CharacterForPipeline, RealPipelineOptions } from "../../../src/lib/generations/pipeline.ts";
import { DEFAULT_IDENTITY_THRESHOLD, identityGateDecision } from "../../../src/lib/generations/identity-gate.ts";
import { OUTPUT_BLOCKED_ISSUE, REFUSED_BEFORE_RENDER_ISSUE } from "../../../src/lib/generations/refund-rules.ts";
import { IMAGE_REQUEST_REFUSED, IMAGE_RESULT_REFUSED } from "../../../src/lib/generations/providers/refusal-messages.ts";
import { fetchWithTimeout } from "../../../src/lib/generations/providers/fetch-with-timeout.ts";
import { buildSetShotPrompt } from "../../../src/lib/sets/set-shot-prompt.ts";
import { cleanText, normaliseSetLayout, type SetCamera, type SetSpec } from "../../../src/lib/sets/set-spec.ts";
import { SET_DIRECTION_MAX_CHARS } from "../../../src/lib/sets/set-config.ts";
import type { Engine } from "./cli.mts";
import { withNetContext, type NetGuard } from "./net-guard.mts";
import { GENERATE_RETRIES, pipelinePrompt } from "./pipeline-strings.mts";
import type { PriceBook } from "./prices.mts";
import { SEEDREAM_EDIT_ENDPOINT, SEEDREAM_SQUARE, type SeedreamInput, type SeedreamResult } from "./seedream.mts";
import type { SpendGuard } from "./spend-guard.mts";
import { Semaphore, sha256 } from "./util.mts";
import { NOT_REACHED, type GateReading, type NotReached } from "./words-gate.mts";

export type { Engine };

export type ShotArm = "set" | "look" | "control";
export type ShotOutcome =
  | "rendered"
  /** Our prompt gate refused: runGeneration's entry gate, or the pipeline's gate on the compiled prompt. */
  | "prompt_blocked"
  /** Our output gate refused the picture on what it shows. */
  | "output_blocked"
  /** The image model's own safety system refused (before or after drawing). */
  | "provider_refused"
  /** A gate could not run ("unavailable"): not a refusal, not a pass. */
  | "unjudged"
  /** No picture and no refusal: a provider error, a timeout, an unreadable answer. */
  | "error"
  /** Rendered and passed the output gate, but the scorer found it unusable (a blank or black frame): runGeneration fails such a take. */
  | "unusable"
  /** Never sent: the run stopped, the budget, no first still to carry, or the engine's arm BLOCKED. */
  | "not_run";

export type ShotPicture = { bytes: Buffer; mime: string };
export type ShotTraits = { hair: string; distinguishing_features: string; outfit: string; personality: string };
export type ShotCharacter = { id: string; name: string; traits: ShotTraits; photo: ShotPicture | null };

/** The earlier still a look shot carries, and what the product's shootInSet says about it. */
export type LookSource = { fromShotId: string; still: ShotPicture; sameCharacter: boolean; savedOutfit: boolean };

export type ShotRequest = {
  part: "c" | "d";
  shotId: string;
  arm: ShotArm;
  engine: Engine;
  setKey: string;
  spec: SetSpec;
  /** The camera the sketch was taken from; null for a control. */
  camera: SetCamera | null;
  /** The sketch (the frame with the grey figure), and its file in the run; null for a control. */
  frame: ShotPicture | null;
  frameFile: string | null;
  lifted: boolean;
  direction: string;
  character: ShotCharacter;
  look: LookSource | null;
  /** A later camera's still, in either arm: camera 1's still of the same set, character and engine (the composition sheet shows it beside this one). */
  firstShotId?: string | null;
  /** sessionPriorHits for the entry gate (D with --escalate carries the counted refusals). */
  priorHits: number;
};

export type ShotRecord = {
  type: "shot";
  part: "c" | "d";
  shotId: string;
  arm: ShotArm;
  engine: Engine;
  setKey: string;
  cameraId: string | null;
  cameraHeightM: number | null;
  characterId: string;
  simulated: boolean;
  /** The still's own prompt (the shot prompt, or a control's words before the drafter). */
  prompt: string;
  /** What the engine should receive: the prompt plus the pipeline's notes (null for a control: the drafter writes it). */
  expectedPrompt: string | null;
  /** What the tap saw the engine receive, kept only when it differs from expectedPrompt. */
  sentPrompt: string | null;
  /** The tap's prompt equals expectedPrompt; null when nothing was sent, for a control, or in a dry run. */
  promptParity: boolean | null;
  look: { fromShotId: string; sameCharacter: boolean; savedOutfit: boolean } | null;
  /** A later camera's still, in either arm: camera 1's still of its set, character and engine; null for camera 1, a control, or D. */
  firstShotId: string | null;
  entryGate: "allowed" | `refused:${string}` | "unavailable" | "not-reached" | "not-run";
  outcome: ShotOutcome;
  /** The refusing gate's reason (a prompt or output reason, or the provider stage). */
  reason: string | null;
  note: string | null;
  /** fal answered 4xx to a request it could not use (not a content refusal): its data: references, most likely. */
  refsRefused: boolean;
  frameFile: string | null;
  resultFile: string | null;
  resultDims: { w: number; h: number } | null;
  identity: { score: number | null; unusable: boolean; scorerVersion: string | null };
  identityDecision: "pass" | "retry" | null;
  /** Renders booked for the still: answered 2xx, sent with no answer, and a picture GPT Image drew and then refused at its output stage. */
  engineCalls: number;
  /** What those renders cost at the engine's price; null while the engine is unpriced. */
  billedUsd: number | null;
  costFlag: string | null;
};

type RunRealPipeline = typeof import("../../../src/lib/generations/pipeline.ts").runRealPipeline;
type JudgeRender = typeof import("../../../src/lib/generations/output-policy.ts").judgeRender;
type ScoreIdentityMatch = typeof import("../../../src/lib/generations/providers/openai.ts").scoreIdentityMatch;
type AssertPromptAllowed = typeof import("../../../src/lib/generations/content-policy.ts").assertPromptAllowed;

/** The product's functions a real still calls: main.mts imports them behind the net guard; the tests pass fakes. */
export type ShotDeps = {
  /** runGeneration's entry gate on the still's prompt (words-gate.mts makeShotGate): retries, stop-aware. */
  entryGate: (prompt: string, o: { hasRealPersonReference: boolean; priorHits: number }, ref: string) => Promise<GateReading | NotReached>;
  /** The pipeline's own gate on a compiled prompt, for the composed route. */
  assertPromptAllowed: AssertPromptAllowed;
  /** A ContentPolicyRefusal's reason, or null for any other error. */
  promptRefusal: (err: unknown) => string | null;
  /** The pipeline reports a prompt refusal by its sentence (contentPolicyBlock): which reason wrote it. */
  promptReasonOf: (userMessage: string) => string | null;
  runRealPipeline: RunRealPipeline;
  judgeRender: JudgeRender;
  /** An OutputPolicyRefusal's reason, or null for any other error. */
  outputRefusal: (err: unknown) => string | null;
  /** The pipeline reports an output refusal by its sentence (the step detail): which reason wrote it. */
  outputReasonOf: (userMessage: string) => string | null;
  scoreIdentityMatch: ScoreIdentityMatch;
  seedream: (input: SeedreamInput) => Promise<SeedreamResult>;
  /** A GET through the net guard (a fal.media picture). */
  download: (url: string) => Promise<ShotPicture | null>;
};

// ---------------------------------------------------------------------------
// Pure pieces: the prompt, the look's conditions, the engine's references,
// what a pipeline result means.
// ---------------------------------------------------------------------------

/** runGeneration's trait summary for the identity scorer (generations/actions.ts; checked at run start). */
export function traitSummary(t: Pick<ShotTraits, "hair" | "distinguishing_features">): string {
  return [t.hair ? `hair: ${t.hair}` : null, t.distinguishing_features ? `distinguishing features: ${t.distinguishing_features}` : null].filter(Boolean).join("; ");
}

/**
 * Whether a look rides a still, as the product decides it: runGeneration
 * sends the look only for a still, one character, no storyboard, on GPT
 * Image or FLUX, and beside an identity photo; the pipeline adds it only
 * beside one identity photo (lookActive). The same conditions, checked
 * against both files at run start (pipeline-strings.mts).
 */
export function lookRides(o: { engine: Engine; identityPhoto: boolean; characters: number; contentType?: "image" | "video"; storyboard?: boolean }): boolean {
  return o.identityPhoto && (o.contentType ?? "image") === "image" && o.characters === 1 && !o.storyboard && (o.engine === "gpt-image" || o.engine === "flux");
}

/** A still's own prompt: shootInSet's for a set or look shot; for a control, the direction and the description, as a person might type them. */
export function shotPrompt(
  req: Pick<ShotRequest, "arm" | "spec" | "camera" | "lifted" | "direction"> & { look: Pick<LookSource, "sameCharacter" | "savedOutfit"> | null },
): string {
  if (req.arm === "control") return cleanText(`${req.direction.replace(/[\s.]+$/, "")}. ${req.spec.description}`, 500);
  const mark = req.spec.marks[0];
  const camera = req.camera ? { position: req.camera.position, target: req.camera.target, fovDeg: req.camera.fovDeg } : null;
  const layout = normaliseSetLayout({ markId: mark.id, mark, camera }, req.spec);
  return buildSetShotPrompt({
    description: req.spec.description,
    direction: cleanText(req.direction, SET_DIRECTION_MAX_CHARS),
    lifted: req.lifted,
    layout,
    look: req.look ? { sameCharacter: req.look.sameCharacter, savedOutfit: req.look.savedOutfit } : null,
  });
}

/** What the engine should receive: the pipeline's notes after the prompt (the composed route sends the same). Null for a control. */
export function expectedEnginePrompt(req: Pick<ShotRequest, "arm" | "engine" | "look">, prompt: string): string | null {
  if (req.arm === "control") return null;
  return pipelinePrompt(prompt, { look: req.engine !== "seedream" && req.look !== null });
}

export function dataUri(p: ShotPicture): string {
  return `data:${p.mime};base64,${p.bytes.toString("base64")}`;
}

/**
 * A gate's reason read back from the sentence it wrote for the person
 * (content-policy.ts refusalMessages, output-policy.ts outputRefusalMessages):
 * the pipeline reports its gates' refusals by that sentence only. Where two
 * reasons share a sentence (the output gate's minors and self-harm), the
 * first key stands for both.
 */
export function reasonBySentence(messages: Readonly<Record<string, string>>): (sentence: string) => string | null {
  const by = new Map<string, string>();
  for (const [reason, sentence] of Object.entries(messages)) if (!by.has(sentence)) by.set(sentence, reason);
  return (sentence) => by.get(sentence) ?? null;
}

/** A GET through the net guard (a fal.media picture), or null when it does not come back. */
export async function downloadPicture(url: string): Promise<ShotPicture | null> {
  try {
    const res = await fetchWithTimeout(url, { method: "GET" }, 30_000);
    if (!res.ok) return null;
    const bytes = Buffer.from(await res.arrayBuffer());
    return bytes.length ? { bytes, mime: sniffImage(bytes).mime } : null;
  } catch {
    return null;
  }
}

/** What a picture's bytes are (the engines answer PNG, JPEG or WebP). */
export function sniffImage(bytes: Uint8Array): { mime: string; ext: string } {
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return { mime: "image/png", ext: "png" };
  if (bytes[0] === 0xff && bytes[1] === 0xd8) return { mime: "image/jpeg", ext: "jpg" };
  if (bytes.length > 12 && String.fromCharCode(...bytes.slice(0, 4)) === "RIFF" && String.fromCharCode(...bytes.slice(8, 12)) === "WEBP") return { mime: "image/webp", ext: "webp" };
  return { mime: "image/png", ext: "png" };
}

/** The references an engine is handed: GPT Image reads URLs (served from memory), fal reads data: URIs. */
export function referenceFor(engine: Engine, p: ShotPicture, net: Pick<NetGuard, "setLocalRoute">): string {
  if (engine !== "gpt-image") return dataUri(p);
  return net.setLocalRoute(`ref/${sha256(p.bytes)}.${sniffImage(p.bytes).ext}`, { body: p.bytes, contentType: p.mime });
}

/** Which engine a live call renders on (a POST that bills a picture), or null. */
export function renderEngineOf(host: string, path: string, method: string): Engine | null {
  if (method !== "POST") return null;
  if (host === "api.openai.com" && (path === "/v1/images/edits" || path === "/v1/images/generations")) return "gpt-image";
  if (host === "fal.run") return "flux";
  if (host === "queue.fal.run" && path === `/${SEEDREAM_EDIT_ENDPOINT}`) return "seedream";
  return null;
}

/** The most renders one still can make: the pipeline's generate retries, or one queue job. */
export function maxRendersOf(engine: Engine): number {
  return engine === "seedream" ? 1 : GENERATE_RETRIES;
}

/** No data: URI (a photo) and no more than a line of a provider's error in a results row. */
export function safeDetail(s: string): string {
  return s.replace(/data:[a-z/+.-]+;base64,[A-Za-z0-9+/=]*/gi, "data:…").slice(0, 240);
}

// fal's refusal tokens and the provider sentences (pipeline.ts SAFETY_REJECTION's own).
const CONTENT_REFUSAL = /content[_ ]polic|sensitivecontentdetected|safety|nsfw|moderation|likeness/i;
// fal answering 4xx to a request it could not use, that is no content refusal and no key problem.
const REFS_REFUSED_STATUS = new Set([400, 404, 413, 415, 422]);

/** An engine's failure: its own safety refusal, or an error — and whether fal refused the request's references. */
export function classifyEngineError(detail: string): { outcome: "provider_refused" | "error"; refsRefused: boolean; status: number | null } {
  const m = /^fal\.ai \((?:Flux|Seedream)\) error \((\d{3})\)/.exec(detail);
  const status = m ? Number(m[1]) : null;
  if (detail === IMAGE_REQUEST_REFUSED || detail === IMAGE_RESULT_REFUSED || CONTENT_REFUSAL.test(detail)) return { outcome: "provider_refused", refsRefused: false, status };
  return { outcome: "error", refsRefused: status !== null && REFS_REFUSED_STATUS.has(status), status };
}

export type PipelineView = {
  succeeded: boolean;
  resultUrl: string | null;
  contentPolicyBlock?: string;
  cancelled?: boolean;
  attempts: readonly { steps: readonly { step: string; detail: string }[]; issues: readonly string[] }[];
};

type EngineVerdict = { outcome: ShotOutcome; reason: string | null; note: string | null; refsRefused: boolean };

function lastStepDetail(r: PipelineView, step: string): string | null {
  const a = r.attempts[r.attempts.length - 1];
  const s = a ? [...a.steps].reverse().find((x) => x.step === step) : undefined;
  return s ? s.detail : null;
}

/**
 * What a runRealPipeline result means for a still. The pipeline reports its
 * gates' refusals by the sentence it wrote for the person, and marks the
 * attempt; the reason is read back from the sentence (content-policy.ts and
 * output-policy.ts export them).
 */
export function pipelineOutcome(r: PipelineView, o: { promptReasonOf: (m: string) => string | null; outputReasonOf: (m: string) => string | null }): EngineVerdict {
  const v = (outcome: ShotOutcome, reason: string | null, note: string | null, refsRefused = false): EngineVerdict => ({ outcome, reason, note, refsRefused });
  if (r.succeeded && r.resultUrl) return v("rendered", null, null);
  if (r.cancelled) return v("not_run", null, "not reached: the run stopped, and the pipeline's checkpoint kept the render from being sent");
  if (r.contentPolicyBlock) {
    const reason = o.promptReasonOf(r.contentPolicyBlock) ?? "refused";
    return reason === "unavailable" ? v("unjudged", null, "the pipeline's prompt gate could not run") : v("prompt_blocked", reason, "the pipeline's gate on the compiled prompt");
  }
  const issues = r.attempts[r.attempts.length - 1]?.issues ?? [];
  if (issues.includes(OUTPUT_BLOCKED_ISSUE)) {
    const reason = o.outputReasonOf(lastStepDetail(r, "validate") ?? "") ?? "refused";
    return reason === "unavailable" ? v("unjudged", null, "the output gate could not read the picture") : v("output_blocked", reason, "the output gate");
  }
  if (issues.includes(REFUSED_BEFORE_RENDER_ISSUE)) return v("provider_refused", "before render", "the image model's safety system, before drawing");
  const detail = lastStepDetail(r, "generate") ?? "";
  const c = classifyEngineError(detail);
  if (c.outcome === "provider_refused") return v("provider_refused", detail === IMAGE_RESULT_REFUSED ? "after render" : "provider", "the image model's safety system");
  return v("error", null, safeDetail(detail) || "no picture and no reason", c.refsRefused);
}

// ---------------------------------------------------------------------------
// The tap: renders and prompts per still, from the net guard.
// ---------------------------------------------------------------------------

type RenderCount = { answered: number; unknown: number; hosts: Map<string, number> };

/** Counts each still's renders (by its net-context ref) and keeps the prompt its engine received. */
export class RenderTap {
  private readonly renders = new Map<string, RenderCount>();
  private readonly prompts = new Map<string, string>();
  /** Every live host the run's calls reached (the probe lists them). */
  readonly hosts = new Set<string>();

  install(net: Pick<NetGuard, "onLiveResponse" | "onPromptTap">): () => void {
    const prevResponse = net.onLiveResponse;
    const prevPrompt = net.onPromptTap;
    net.onLiveResponse = (r) => {
      prevResponse?.(r);
      this.hosts.add(r.host);
      // An answered 4xx or 5xx is not counted here: an error or a refusal
      // before rendering made no picture. The one answered refusal that
      // follows a drawn picture (GPT Image's output stage) is booked by
      // shoot(), from the pipeline's verdict.
      const billable = r.status === -1 || (r.status >= 200 && r.status < 300);
      if (!billable || !r.ctx.ref || !renderEngineOf(r.host, r.path, r.method)) return;
      const c = this.renders.get(r.ctx.ref) ?? { answered: 0, unknown: 0, hosts: new Map<string, number>() };
      if (r.status === -1) c.unknown += 1;
      else c.answered += 1;
      c.hosts.set(r.host, (c.hosts.get(r.host) ?? 0) + 1);
      this.renders.set(r.ctx.ref, c);
    };
    net.onPromptTap = (t) => {
      prevPrompt?.(t);
      if (t.ctx.ref) this.prompts.set(t.ctx.ref, t.prompt);
    };
    return () => {
      net.onLiveResponse = prevResponse;
      net.onPromptTap = prevPrompt;
    };
  }

  rendersOf(ref: string): RenderCount {
    return this.renders.get(ref) ?? { answered: 0, unknown: 0, hosts: new Map() };
  }

  promptOf(ref: string): string | null {
    return this.prompts.get(ref) ?? null;
  }
}

// ---------------------------------------------------------------------------
// One still.
// ---------------------------------------------------------------------------

export type ShotEnv = {
  dry: boolean;
  runDir: string;
  net: NetGuard;
  guard: SpendGuard;
  book: PriceBook;
  /** The product's functions; null in a dry run. */
  deps: ShotDeps | null;
  tap: RenderTap;
  stopping: () => boolean;
  stopWhy: () => string;
  progress: (m: string) => void;
  /** What fal refused data: references for (blockKey): an engine ("flux"), or its look arm alone ("flux:look"). No further still is sent there. */
  blocked: Set<string>;
  /** The dry run's rotation for the fake output gate. */
  sim: { n: number };
};

export const BLOCKED_NOTE = "the engine's arm is BLOCKED: fal refused the data: references (nothing is uploaded; see the README)";
export const LOOK_BLOCKED_NOTE = "the engine's look arm is BLOCKED: fal refused a look shot's data: references (three pictures); the set arm goes on";

/**
 * What a fal refusal of a still's data: references blocks. A look shot's
 * request is the largest (the identity, the sketch and the earlier still),
 * so its refusal blocks that engine's look arm alone; a set shot's or a
 * control's (two pictures, or one) blocks the engine, the look included.
 */
export function blockKey(engine: Engine, arm: ShotArm): string {
  return arm === "look" ? `${engine}:look` : engine;
}

/** Why a still is not sent on a blocked engine or arm, or null when it may be. */
export function blockedNote(blocked: ReadonlySet<string>, engine: Engine, arm: ShotArm): string | null {
  if (blocked.has(engine)) return BLOCKED_NOTE;
  return arm === "look" && blocked.has(blockKey(engine, "look")) ? LOOK_BLOCKED_NOTE : null;
}

/** How a still ends when the scorer calls its picture unusable: runGeneration's non-delivery. */
export const UNUSABLE_NOTE =
  "the scorer found the picture unusable (a blank or black frame): runGeneration fails such a take and clears its URL before any identity decision (identity-gate-run.ts, actions.ts), so it is not delivered, not scored against a bar, and never a look";

/** The settle's flag for GPT Image's output-stage refusal, booked as one render. */
export const OUTPUT_STAGE_FLAG =
  "GPT Image refused the picture at its output stage: one was drawn, and whether OpenAI bills it is unmeasured (refund-rules.ts), so it is booked";

function baseRecord(req: ShotRequest, prompt: string, expected: string | null, simulated: boolean): ShotRecord {
  return {
    type: "shot",
    part: req.part,
    shotId: req.shotId,
    arm: req.arm,
    engine: req.engine,
    setKey: req.setKey,
    cameraId: req.camera?.id ?? null,
    cameraHeightM: req.camera ? req.camera.position[1] : null,
    characterId: req.character.id,
    simulated,
    prompt,
    expectedPrompt: expected,
    sentPrompt: null,
    promptParity: null,
    look: req.look ? { fromShotId: req.look.fromShotId, sameCharacter: req.look.sameCharacter, savedOutfit: req.look.savedOutfit } : null,
    firstShotId: req.firstShotId ?? null,
    entryGate: "not-run",
    outcome: "not_run",
    reason: null,
    note: null,
    refsRefused: false,
    frameFile: req.frameFile,
    resultFile: null,
    resultDims: null,
    identity: { score: null, unusable: false, scorerVersion: null },
    identityDecision: null,
    engineCalls: 0,
    billedUsd: null,
    costFlag: null,
  };
}

/** A still that was never sent, recorded with why. */
export function notRunShot(req: ShotRequest, note: string, simulated: boolean): ShotRecord {
  const prompt = shotPrompt(req);
  return { ...baseRecord(req, prompt, expectedEnginePrompt(req, prompt), simulated), note };
}

/** A look shot whose first still never came: recorded with the look it would have carried, never sent. */
export function lookNotRun(req: ShotRequest, first: Pick<ShotRecord, "shotId" | "outcome">, o: { sameCharacter: boolean; simulated: boolean }): ShotRecord {
  const look = { sameCharacter: o.sameCharacter, savedOutfit: false };
  const r = baseRecord(req, shotPrompt({ ...req, look }), null, o.simulated);
  return { ...r, look: { fromShotId: first.shotId, ...look }, note: `shot 1 (${first.shotId}) made no still to carry (${first.outcome})` };
}

async function dimsOf(bytes: Buffer): Promise<{ w: number; h: number } | null> {
  try {
    const { default: sharp } = await import("sharp");
    const m = await sharp(bytes).metadata();
    return m.width && m.height ? { w: m.width, h: m.height } : null;
  } catch {
    return null;
  }
}

function writeStill(runDir: string, shotId: string, p: ShotPicture): string {
  const file = `stills/${shotId}.${sniffImage(p.bytes).ext}`;
  writeFileSync(join(runDir, file), p.bytes);
  return file;
}

export function readPicture(runDir: string, file: string): ShotPicture | null {
  const path = join(runDir, file);
  if (!existsSync(path)) return null;
  const bytes = readFileSync(path);
  return { bytes, mime: sniffImage(bytes).mime };
}

/**
 * Reserve a still's worst case (GENERATE_RETRIES renders, or one queue job)
 * at the engine's price. An unpriced engine has nothing to reserve, so it
 * asks the guard's stop itself: a priced one's reserve is refused once the
 * guard has stopped.
 */
function reserveRenders(env: Pick<ShotEnv, "guard" | "book">, req: ShotRequest): { ticket: string | null; unit: number | null } | { refused: string } {
  const unit = env.book.image(req.engine);
  if (unit === null) return env.guard.stopped ? { refused: `stopped (${env.guard.stopped.reason})` } : { ticket: null, unit: null };
  const r = env.guard.reserve(req.engine, unit * maxRendersOf(req.engine), req.shotId);
  return r.ok ? { ticket: r.ticket, unit } : { refused: r.reason };
}

/** GPT Image's output-stage refusal: a 400 the tap does not bill, for a picture already drawn. */
export function refusedAfterRender(engine: Engine, v: Pick<EngineVerdict, "outcome" | "reason">): boolean {
  return engine === "gpt-image" && v.outcome === "provider_refused" && v.reason === "after render";
}

/**
 * Settle a still's renders: the tap's answered 2xx and sent-with-no-answer,
 * and `afterRender` more (GPT Image's output-stage refusal, a picture drawn
 * and then refused), each booked; an unpriced engine's go on the ledger as
 * metered lines.
 */
function settleRenders(
  env: Pick<ShotEnv, "guard">,
  req: ShotRequest,
  money: { ticket: string | null; unit: number | null },
  c: RenderCount,
  afterRender: number,
): Pick<ShotRecord, "engineCalls" | "billedUsd" | "costFlag"> {
  const n = c.answered + c.unknown + afterRender;
  const flags = [c.unknown ? `${c.unknown} render(s) sent with no answer: booked, as they may have been made and billed` : null, afterRender ? OUTPUT_STAGE_FLAG : null].filter((x): x is string => x !== null);
  const flag = flags.length ? flags.join("; ") : null;
  if (money.ticket !== null && money.unit !== null) {
    const billed = n * money.unit;
    env.guard.settle(money.ticket, billed, billed, `${n} render(s) × $${money.unit} (${req.engine})${flag ? `; ${flag}` : ""}`, { renders: c.answered, unknown: c.unknown, refusedAfterRender: afterRender });
    return { engineCalls: n, billedUsd: billed, costFlag: flag };
  }
  const hosts = new Map(c.hosts);
  if (afterRender) hosts.set("api.openai.com", (hosts.get("api.openai.com") ?? 0) + afterRender);
  for (const [host, k] of hosts) {
    for (let i = 0; i < k; i++) env.guard.meter({ host, model: `${req.engine} (per image)`, usage: { images: 1 }, usd: null, tag: `${req.engine}-render: unpriced`, ref: req.shotId });
  }
  return { engineCalls: n, billedUsd: null, costFlag: flag };
}

type Rendered = { verdict: EngineVerdict; picture: ShotPicture | null; file: string | null };

/** GPT Image and FLUX: the pipeline itself, sent as runGeneration sends a Set's shot. */
async function pipelineRoute(env: ShotEnv, deps: ShotDeps, req: ShotRequest, prompt: string): Promise<Rendered> {
  let kept: { file: string; picture: ShotPicture } | null = null;
  // The pipeline hands a GPT picture's bytes (and a FLUX picture it
  // downloaded) to persistImage and judges what it returns: here, the
  // picture written to stills/ and returned as a data URL.
  const persistImage = async (base64: string): Promise<string> => {
    const bytes = Buffer.from(base64, "base64");
    const picture = { bytes, mime: sniffImage(bytes).mime };
    if (kept) rmSync(join(env.runDir, kept.file), { force: true });
    kept = { file: writeStill(env.runDir, req.shotId, picture), picture };
    return dataUri(picture);
  };
  const identity = req.character.photo ? referenceFor(req.engine, req.character.photo, env.net) : null;
  const attached =
    req.arm === "control"
      ? { hasAttachedReference: false, strictContentLane: false, skipRefinement: false }
      : {
          propImageUrl: req.frame ? referenceFor(req.engine, req.frame, env.net) : null,
          lookImageUrl: req.look ? referenceFor(req.engine, req.look.still, env.net) : null,
          hasAttachedReference: true,
          strictContentLane: true,
          skipRefinement: true,
        };
  const options: RealPipelineOptions = { contentType: "image", imageModelId: req.engine, referenceImageUrl: identity, persistImage, brandRules: [], ...attached };
  const character: CharacterForPipeline = { name: req.character.name, traits: req.character.traits };
  const drop = () => {
    const k = kept as { file: string; picture: ShotPicture } | null;
    if (k) rmSync(join(env.runDir, k.file), { force: true });
  };
  let result: Awaited<ReturnType<RunRealPipeline>>;
  try {
    // The run's stop as runGeneration's Stop: asked before the attempt and
    // again after the compiled-prompt gate, right before the render.
    result = await deps.runRealPipeline(prompt, character, options, 1, async () => env.stopping());
  } catch (err) {
    // A picture written before the pipeline gave out was never judged: it is not kept.
    drop();
    throw err;
  }
  const verdict = pipelineOutcome(result, deps);
  const done = kept as { file: string; picture: ShotPicture } | null;
  if (verdict.outcome !== "rendered") {
    drop();
    return { verdict, picture: null, file: null };
  }
  if (done && result.resultUrl === dataUri(done.picture)) return { verdict, picture: done.picture, file: done.file };
  // FLUX's own download failed inside image.ts: the pipeline judged the fal URL itself.
  const got = result.resultUrl ? await deps.download(result.resultUrl) : null;
  if (!got) return { verdict: { outcome: "error", reason: null, note: "the rendered picture could not be downloaded", refsRefused: false }, picture: null, file: null };
  return { verdict, picture: got, file: writeStill(env.runDir, req.shotId, got) };
}

/** Seedream: the prompt with the pipeline's notes, gated as a compiled prompt, sent through fal's queue, judged as a render. */
async function composedRoute(env: ShotEnv, deps: ShotDeps, req: ShotRequest, prompt: string): Promise<Rendered> {
  const v = (outcome: ShotOutcome, reason: string | null, note: string | null, refsRefused = false): Rendered => ({ verdict: { outcome, reason, note, refsRefused }, picture: null, file: null });
  const composed = pipelinePrompt(prompt);
  let promptScores: Awaited<ReturnType<AssertPromptAllowed>>;
  try {
    promptScores = await deps.assertPromptAllowed({ prompt: composed, hasRealPersonReference: true, sessionPriorHits: 0 });
  } catch (err) {
    const reason = deps.promptRefusal(err);
    if (reason === null || reason === "unavailable") return v("unjudged", null, "the gate on the composed prompt could not run");
    return v("prompt_blocked", reason, "the gate on the composed prompt (the pipeline's compiled-prompt gate)");
  }
  // The pipeline's own checkpoint before a render (pipelineRoute's checkCancelled).
  if (env.stopping()) return v("not_run", null, `not reached: the run stopped (${env.stopWhy()})`);
  if (!req.character.photo || !req.frame) return v("error", null, "no identity photo or sketch to send");
  const sent = await deps.seedream({ prompt: composed, imageUrls: [dataUri(req.character.photo), dataUri(req.frame)], imageSize: SEEDREAM_SQUARE });
  if (!sent.ok) {
    const c = classifyEngineError(sent.detail);
    return c.outcome === "provider_refused" ? v("provider_refused", "provider", "the image model's safety system") : v("error", null, safeDetail(`${sent.stage}: ${sent.detail}`), c.refsRefused);
  }
  const picture = await deps.download(sent.url);
  if (!picture) return v("error", null, "the rendered picture could not be downloaded");
  const file = writeStill(env.runDir, req.shotId, picture);
  try {
    await deps.judgeRender({ url: dataUri(picture), kind: "image", promptScores, sessionPriorHits: 0, strictLane: true });
  } catch (err) {
    const reason = deps.outputRefusal(err);
    rmSync(join(env.runDir, file), { force: true });
    if (reason === null || reason === "unavailable") return v("unjudged", null, "the output gate could not read the picture");
    return v("output_blocked", reason, "the output gate");
  }
  return { verdict: { outcome: "rendered", reason: null, note: null, refsRefused: false }, picture, file };
}

/**
 * The identity score (best effort, as the product's: a scorer that fails is
 * "not measured") and the gate's decision. An unusable picture gets none:
 * runImageIdentityGate returns before deciding, and the take fails.
 */
async function identityOf(deps: ShotDeps, req: ShotRequest, still: ShotPicture): Promise<Pick<ShotRecord, "identity" | "identityDecision">> {
  let identity: ShotRecord["identity"] = { score: null, unusable: false, scorerVersion: null };
  if (req.character.photo) {
    try {
      const s = await withNetContext({ tag: "identity-scorer", ref: req.shotId, settled: false }, () =>
        deps.scoreIdentityMatch(dataUri(still), dataUri(req.character.photo as ShotPicture), traitSummary(req.character.traits)),
      );
      if (s) identity = { score: typeof s.score === "number" && Number.isFinite(s.score) ? s.score : null, unusable: Boolean(s.unusable), scorerVersion: s.scorerVersion ?? null };
    } catch {
      // identity-gate-run.ts: a scoring hiccup never affects the take.
    }
  }
  if (identity.unusable) return { identity, identityDecision: null };
  const d = identityGateDecision({ score: identity.score, threshold: DEFAULT_IDENTITY_THRESHOLD, retriesUsed: 0 });
  return { identity, identityDecision: d.action === "retry" ? "retry" : "pass" };
}

/** The dry run's engine: the frame (a control: its character's photo) handed back as the still. */
async function simulateShot(env: ShotEnv, req: ShotRequest, base: ShotRecord): Promise<ShotRecord> {
  const unit = env.book.image(req.engine);
  let money: Pick<ShotRecord, "engineCalls" | "billedUsd" | "costFlag"> = { engineCalls: 0, billedUsd: null, costFlag: null };
  if (unit !== null) {
    const worst = unit * maxRendersOf(req.engine);
    const r = env.guard.reserve(req.engine, worst, req.shotId);
    if (!r.ok) return { ...base, entryGate: "allowed", outcome: "not_run", note: `budget: ${r.reason}` };
    env.guard.settle(r.ticket, worst, worst, "simulated: the worst case", null);
    money = { engineCalls: 0, billedUsd: worst, costFlag: "simulated" };
  }
  const n = env.sim.n++;
  if (n % 5 === 4) return { ...base, ...money, entryGate: "allowed", outcome: "output_blocked", reason: "simulated", note: "the simulated output gate (every fifth still)" };
  const source = req.frame ?? req.character.photo;
  if (!source) return { ...base, ...money, entryGate: "allowed", outcome: "error", note: "simulated: no frame or photo to hand back" };
  // Nothing scored it: identityGateDecision reads that as "not measured".
  const decision = identityGateDecision({ score: null, threshold: DEFAULT_IDENTITY_THRESHOLD, retriesUsed: 0 });
  return {
    ...base,
    ...money,
    entryGate: "allowed",
    outcome: "rendered",
    resultFile: writeStill(env.runDir, req.shotId, source),
    resultDims: await dimsOf(source.bytes),
    identityDecision: decision.action === "retry" ? "retry" : "pass",
    note: req.frame ? "simulated: the frame handed back as the still" : "simulated: the character's photo handed back as the still",
  };
}

/** One still, end to end. Never throws for a provider's answer: every way it can end is a row. */
export async function shoot(env: ShotEnv, req: ShotRequest): Promise<ShotRecord> {
  const prompt = shotPrompt(req);
  const base = baseRecord(req, prompt, expectedEnginePrompt(req, prompt), env.dry);
  if (env.stopping()) return { ...base, note: `not reached: the run stopped (${env.stopWhy()})` };
  const blocked = blockedNote(env.blocked, req.engine, req.arm);
  if (blocked) return { ...base, note: blocked };
  if (env.dry) return simulateShot(env, req, base);
  const deps = env.deps;
  if (!deps) throw new Error(`${req.shotId}: a real still needs the product's functions`);

  const gate = await deps.entryGate(prompt, { hasRealPersonReference: req.arm !== "control", priorHits: req.priorHits }, req.shotId);
  if (gate === NOT_REACHED) return { ...base, entryGate: "not-reached", note: `not reached: the run stopped (${env.stopWhy()})` };
  if (gate.verdict === "unavailable") return { ...base, entryGate: "unavailable", outcome: "unjudged", note: "the entry gate could not run" };
  if (typeof gate.verdict === "object") return { ...base, entryGate: `refused:${gate.verdict.refused}`, outcome: "prompt_blocked", reason: gate.verdict.refused, note: "runGeneration's entry gate" };
  // The gate takes seconds, and a stop may land meanwhile. An unpriced
  // engine reserves nothing, so the guard's refusal alone would not stop it.
  if (env.stopping()) return { ...base, entryGate: "allowed", note: `not reached: the run stopped (${env.stopWhy()})` };

  const money = reserveRenders(env, req);
  if ("refused" in money) return { ...base, entryGate: "allowed", note: `budget: ${money.refused}` };
  let rendered: Rendered;
  try {
    rendered = await withNetContext({ tag: `shot-${req.engine}`, ref: req.shotId, settled: false }, () =>
      req.engine === "seedream" ? composedRoute(env, deps, req, prompt) : pipelineRoute(env, deps, req, prompt),
    );
  } catch (err) {
    rendered = { verdict: { outcome: "error", reason: null, note: safeDetail(err instanceof Error ? `${err.name}: ${err.message}` : String(err)), refsRefused: false }, picture: null, file: null };
  }
  const spent = settleRenders(env, req, money, env.tap.rendersOf(req.shotId), refusedAfterRender(req.engine, rendered.verdict) ? 1 : 0);
  const sent = env.tap.promptOf(req.shotId);
  const parity = base.expectedPrompt === null || sent === null ? null : sent === base.expectedPrompt;
  const row: ShotRecord = {
    ...base,
    ...spent,
    entryGate: "allowed",
    outcome: rendered.verdict.outcome,
    reason: rendered.verdict.reason,
    note: rendered.verdict.note,
    refsRefused: rendered.verdict.refsRefused,
    promptParity: parity,
    sentPrompt: parity === false ? sent : null,
    resultFile: rendered.file,
  };
  if (rendered.verdict.refsRefused && req.engine !== "gpt-image") env.blocked.add(blockKey(req.engine, req.arm));
  if (rendered.verdict.outcome !== "rendered" || !rendered.picture) return row;
  const judged = await identityOf(deps, req, rendered.picture);
  if (judged.identity.unusable) {
    // runGeneration's non-delivery: the take fails and its URL is cleared.
    if (rendered.file) rmSync(join(env.runDir, rendered.file), { force: true });
    return { ...row, ...judged, outcome: "unusable", note: UNUSABLE_NOTE, resultFile: null };
  }
  return { ...row, resultDims: await dimsOf(rendered.picture.bytes), ...judged };
}

// ---------------------------------------------------------------------------
// Many stills: camera 1 first, then the later cameras on their own sketch
// and again carrying camera 1's still as the look.
// ---------------------------------------------------------------------------

export type ShotGroup = {
  /** Camera 1's still: the look the later cameras carry. */
  first: ShotRequest;
  /** The later cameras on their own sketch (the no-look arm). */
  rest: ShotRequest[];
  /** The later cameras again, to carry `first`'s still as the look (their look is filled when it exists). */
  withLook: ShotRequest[];
};

export async function runShots(
  env: ShotEnv,
  o: { groups: readonly ShotGroup[]; singles: readonly ShotRequest[]; concurrency: number; onRecord: (r: ShotRecord) => void },
): Promise<ShotRecord[]> {
  const sem = new Semaphore(o.concurrency);
  const out: ShotRecord[] = [];
  const keep = (r: ShotRecord) => {
    out.push(r);
    o.onRecord(r);
    env.progress(`${r.shotId} ${r.outcome}`);
    return r;
  };
  const one = (req: ShotRequest) => sem.use(() => shoot(env, req)).then(keep);
  await Promise.all([
    ...o.groups.map(async (g) => {
      const first = await one(g.first);
      // shootInSet carries only a succeeded take: a still that rendered and was delivered (not refused, not unusable).
      const still = first.outcome === "rendered" && first.resultFile ? readPicture(env.runDir, first.resultFile) : null;
      await Promise.all([
        ...g.rest.map(one),
        ...g.withLook.map((req) => {
          // shootInSet: the look is the same character's when the earlier still is theirs.
          const sameCharacter = req.character.id === g.first.character.id;
          return still
            ? one({ ...req, look: { fromShotId: first.shotId, still, sameCharacter, savedOutfit: false } })
            : Promise.resolve(keep(lookNotRun(req, first, { sameCharacter, simulated: env.dry })));
        }),
      ]);
    }),
    ...o.singles.map(one),
  ]);
  return out;
}
