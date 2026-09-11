import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { setBuildInput } from "../../../src/lib/sets/set-builder-prompt.ts";
import { RETRY_SMALLER } from "../../../src/lib/sets/build-retry.ts";
import { advanceBuild, buildRecord, ConfigAbort, leftPending, startBuild, startPhotoBuild, type AttemptMeta, type FlowDeps, type TransportResult, type WordsVerdict } from "./build-flow.mts";
import { closureOf } from "./context.mts";
import { REPO_ROOT } from "./util.mts";

// Parity with the build tick (sets/build-tick.ts, which pollSetBuild runs),
// on the product's own recorded Astra sets and the real three.js closure
// measure.

const fixture = (name: string) => readFileSync(join(REPO_ROOT, `src/lib/sets/fixtures-${name}.json`), "utf8");
const CLOSED = fixture("showroom-closed");
const OPEN = fixture("showroom-open");
// A lone box on a big floor: open on every bearing, far more open than OPEN.
const WIDE_OPEN = JSON.stringify({ bounds: { x: 20, z: 20, height: 5 }, objects: [{ shape: "box", position: [0, 0.5, 5], size: [1, 1, 1] }], marks: [{ label: "", x: 0, z: 0, facingDeg: 0 }] });
// A closed set whose cameras were taken out: the normaliser gives it a stand-in camera 1.
const NO_CAMERAS = JSON.stringify({ ...(JSON.parse(CLOSED) as Record<string, unknown>), cameras: [] });

const usage = { input_tokens: 1800, output_tokens: 5000 };
const done = (text: string): TransportResult => ({ state: "done", text, usage });
const failed = (kind: "refused" | "incomplete" | "failed" | "expired" | "cancelled"): TransportResult => ({ state: "failed", kind, detail: kind, usage });
const meta: AttemptMeta = { transport: "simulated", billedUsd: 0.1, standardUsd: 0.2 };

function deps(words: WordsVerdict[] = []): FlowDeps & { calls: number } {
  const d = {
    calls: 0,
    closureOf,
    async judgeWords(): Promise<WordsVerdict> {
      d.calls += 1;
      return words.shift() ?? "allowed";
    },
  };
  return d;
}

async function run(answers: TransportResult[], words: WordsVerdict[] = []) {
  const s = startBuild("b1", "a quiet showroom with one red car");
  const d = deps(words);
  const inputs: string[] = [];
  for (const a of answers) {
    if (!s.next) break;
    inputs.push(s.next.input);
    await advanceBuild(s, a, meta, d);
  }
  return { s, inputs, d };
}

describe("advanceBuild, as pollSetBuild", () => {
  it("a closed set is delivered after one attempt", async () => {
    const { s } = await run([done(CLOSED)]);
    expect(s.final).toMatchObject({ status: "delivered", use: "answer", openAtDelivery: 0, fromAttempt: 1 });
    expect(s.attempts).toBe(1);
    expect(s.next).toBeNull();
  });

  it("an open set is sent back as a mend that starts with the brief and carries the set", async () => {
    const s = startBuild("b1", "a quiet showroom with one red car");
    await advanceBuild(s, done(OPEN), meta, deps());
    expect(s.next?.kind).toBe("retry-close-mend");
    expect(s.next?.input.startsWith(setBuildInput("a quiet showroom with one red car"))).toBe(true);
    expect(s.next?.input).toContain("Previous set:");
    expect(s.draft).not.toBeNull();
    expect(s.draftOpen).toBeGreaterThan(0);
  });

  it("the mend closes it: the mend is delivered", async () => {
    const { s } = await run([done(OPEN), done(CLOSED)]);
    expect(s.final).toMatchObject({ status: "delivered", use: "answer", openAtDelivery: 0, fromAttempt: 2 });
  });

  it("a mend that comes back more open loses to the draft; a tie goes to the mend", async () => {
    const worse = await run([done(OPEN), done(WIDE_OPEN)]);
    expect(worse.s.final).toMatchObject({ status: "delivered", use: "draft", fromAttempt: 1 });
    const tie = await run([done(OPEN), done(OPEN)]);
    expect(tie.s.final).toMatchObject({ status: "delivered", use: "answer", fromAttempt: 2 });
  });

  it("a mend that is invalid, refused, incomplete or cancelled leaves the draft", async () => {
    for (const second of [done("not json"), failed("refused"), failed("incomplete"), failed("cancelled")]) {
      const { s } = await run([done(OPEN), second]);
      expect(s.final).toMatchObject({ status: "delivered", use: "draft" });
    }
  });

  it("an invalid answer is retried with the plain input; an incomplete one asks for smaller", async () => {
    const invalid = await run([done("{ nope"), done(CLOSED)]);
    expect(invalid.inputs[1]).toBe(setBuildInput("a quiet showroom with one red car"));
    expect(invalid.s.log.map((a) => a.kind)).toEqual(["first", "retry-plain"]);
    expect(invalid.s.log[0].outcome).toBe("not_json");
    expect(invalid.s.final).toMatchObject({ status: "delivered", use: "answer" });
    const incomplete = await run([failed("incomplete"), done(CLOSED)]);
    expect(incomplete.inputs[1]).toBe(setBuildInput("a quiet showroom with one red car") + RETRY_SMALLER);
    expect(incomplete.s.log[1].kind).toBe("retry-smaller");
  });

  it("failed and expired answers retry plain; two failures end the build", async () => {
    const { s } = await run([failed("failed"), failed("expired")]);
    expect(s.log.map((a) => a.kind)).toEqual(["first", "retry-plain"]);
    expect(s.final).toEqual({ status: "failed", failure: "expired" });
  });

  it("a refusal or a cancellation is never retried", async () => {
    expect((await run([failed("refused"), done(CLOSED)])).s.final).toEqual({ status: "failed", failure: "refused" });
    expect((await run([failed("cancelled"), done(CLOSED)])).s.final).toEqual({ status: "failed", failure: "cancelled" });
  });

  it("the words gate refusing the first answer ends the build, with no retry", async () => {
    const { s, d } = await run([done(OPEN), done(CLOSED)], [{ refused: "sexual" }]);
    expect(s.final).toMatchObject({ status: "failed", failure: "refused" });
    expect(s.attempts).toBe(1);
    expect(d.calls).toBe(1);
  });

  it("the words gate refusing the mend's words delivers the draft", async () => {
    const { s } = await run([done(OPEN), done(CLOSED)], ["allowed", { refused: "minors" }]);
    expect(s.final).toMatchObject({ status: "delivered", use: "draft" });
  });

  it("words gate unavailable carries on, flagged", async () => {
    const { s } = await run([done(CLOSED)], ["unavailable"]);
    expect(s.final).toMatchObject({ status: "delivered" });
    expect(s.log[0].words).toBe("unavailable");
  });

  it("a plain retry whose submit is refused ends refused; one lost on the wire or rejected is not run, not the first failure", async () => {
    const refused = await run([done("x"), { state: "submit-failed", kind: "refused", detail: "403 misalignment" }]);
    expect(refused.s.final).toMatchObject({ status: "failed", failure: "refused" });
    const down = await run([failed("incomplete"), { state: "submit-failed", kind: "unavailable", detail: "503" }]);
    expect(down.s.final).toMatchObject({ status: "failed", failure: "not_run:transport" });
    expect((down.s.final as { note?: string }).note).toMatch(/came back incomplete and its retry never ran/);
    const rejected = await run([done("x"), { state: "submit-failed", kind: "bad_request", detail: "400" }]);
    expect(rejected.s.final).toMatchObject({ status: "failed", failure: "not_run:rejected" });
  });

  it("a first attempt the API rejects (a 400) is not run, never an invalid build", async () => {
    const { s } = await run([{ state: "submit-failed", kind: "bad_request", detail: "400 unsupported_parameter" }]);
    expect(s.final).toMatchObject({ status: "failed", failure: "not_run:rejected" });
    const rec = buildRecord(s, { part: "a", builder: "astra-low", provider: "openai", run: 1, briefId: "x", category: "interior", simulated: false, specFile: null });
    expect(rec.notRun).toBe("rejected");
  });

  it("an attempt that was never sent (budget, Ctrl-C) stays pending, first attempt or retry", async () => {
    for (const kind of ["budget", "stopped"] as const) {
      const first = await run([{ state: "submit-failed", kind, detail: "stop" }]);
      expect(first.s.final).toBeNull();
      expect(first.s.next?.kind).toBe("first");
      expect(first.s.log).toHaveLength(0);
      const retry = await run([done("{ nope"), { state: "submit-failed", kind, detail: "stop" }]);
      expect(retry.s.final).toBeNull();
      expect(retry.s.next?.kind).toBe("retry-plain");
      expect(retry.s.attempts).toBe(1);
    }
    expect(leftPending({ state: "submit-failed", kind: "budget", detail: "" })).toBe(true);
    expect(leftPending({ state: "submit-failed", kind: "unavailable", detail: "" })).toBe(false);
  });

  it("an attempt the runner cancelled at Ctrl-C is voided: billed, not counted, still pending", async () => {
    const interrupted: TransportResult = { state: "failed", kind: "cancelled", detail: "cancelled by the runner", usage, interrupted: true };
    const s = startBuild("b3", "a quiet showroom with one red car");
    await advanceBuild(s, interrupted, meta, deps());
    expect(s.final).toBeNull();
    expect(s.next?.kind).toBe("first");
    expect(s.attempts).toBe(0);
    expect(leftPending(interrupted)).toBe(true);
    // --resume sends it again: the real first attempt counts, the void does not.
    await advanceBuild(s, done(CLOSED), meta, deps());
    const rec = buildRecord(s, { part: "a", builder: "astra-low", provider: "openai", run: 1, briefId: "x", category: "interior", simulated: false, specFile: null });
    expect(rec.firstValid).toBe(true);
    expect(rec.billedUsd).toBeCloseTo(0.2, 12);
    expect(rec.standardUsd).toBeCloseTo(0.2, 12);
    expect(rec.outputTokens).toBe(5000);
  });

  it("a closing retry that cannot start delivers the set in hand", async () => {
    const { s } = await run([done(OPEN), { state: "submit-failed", kind: "rate_limited", detail: "429" }]);
    expect(s.final).toMatchObject({ status: "delivered", use: "draft", fromAttempt: 1 });
  });

  it("a first submit lost on the wire is not run; a config error stops everything", async () => {
    const lost = await run([{ state: "submit-failed", kind: "rate_limited", detail: "429" }]);
    expect(lost.s.final).toMatchObject({ status: "failed", failure: "not_run:transport" });
    const rec = buildRecord(lost.s, { part: "a", builder: "astra-low", provider: "openai", run: 1, briefId: "x", category: "interior", simulated: false, specFile: null });
    expect(rec.notRun).toBe("transport");
    const s = startBuild("b2", "a place");
    await expect(advanceBuild(s, { state: "submit-failed", kind: "config", detail: "401" }, meta, deps())).rejects.toBeInstanceOf(ConfigAbort);
  });

  it("an attempt the runner abandoned as stale ends like production's stale branch", async () => {
    const lost = await run([{ state: "failed", kind: "expired", detail: "15 min", usage: null, stale: true }]);
    expect(lost.s.final).toMatchObject({ status: "failed", failure: "lost" });
    const withDraft = await run([done(OPEN), { state: "failed", kind: "expired", detail: "15 min", usage: null, stale: true }]);
    expect(withDraft.s.final).toMatchObject({ status: "delivered", use: "draft" });
  });

  it("a text build keeps the normaliser's stand-in camera: only a photo build needs its own", async () => {
    const { s } = await run([done(NO_CAMERAS)]);
    expect(s.final).toMatchObject({ status: "delivered", fromAttempt: 1 });
  });

  it("the record sums both attempts' cost and tokens", async () => {
    const { s } = await run([done(OPEN), done(CLOSED)]);
    const rec = buildRecord(s, { part: "a", builder: "astra-low", provider: "openai", run: 1, briefId: "x", category: "interior", simulated: true, specFile: "specs/b1.json" });
    expect(rec.billedUsd).toBeCloseTo(0.2, 12);
    expect(rec.standardUsd).toBeCloseTo(0.4, 12);
    expect(rec.outputTokens).toBe(10_000);
    expect(rec.firstValid).toBe(true);
    expect(rec.validWithinRetry).toBe(true);
    expect(rec.openAtDelivery).toBe(0);
  });
});

describe("advanceBuild for a photo build, as pollSetBuild's photo branch", () => {
  const source = { photoId: "ph-01", notes: "the other half is a bar", sha256: "a".repeat(64) };
  async function runPhoto(answers: TransportResult[], words: WordsVerdict[] = []) {
    const s = startPhotoBuild("al-ph-01-r1", source);
    const d = deps(words);
    const nexts: NonNullable<typeof s.next>[] = [];
    for (const a of answers) {
      if (!s.next) break;
      nexts.push(s.next);
      await advanceBuild(s, a, meta, d);
    }
    return { s, nexts };
  }

  it("starts as the product's first photo attempt: no text input, the photo's source only", () => {
    const s = startPhotoBuild("al-ph-01-r1", source);
    expect(s.next).toEqual({ input: "", kind: "first" });
    expect(s.photo).toEqual(source);
    expect(s.brief).toBe(source.notes);
  });

  it("an answer without Astra's own first camera is invalid, and retried plain with the photo", async () => {
    const { s, nexts } = await runPhoto([done(NO_CAMERAS), done(CLOSED)]);
    expect(s.log[0].outcome).toBe("no_first_camera");
    expect(s.log[0].notes).toContain("default_camera");
    // No words are judged on a set that is not valid for a photo.
    expect(s.log[0].words).toBeUndefined();
    expect(nexts[1]).toEqual({ input: "", kind: "retry-plain", retry: { why: "again", tooLong: false } });
    expect(s.final).toMatchObject({ status: "delivered", use: "answer", fromAttempt: 2 });
    const rec = buildRecord(s, { part: "a", builder: "astra-low", provider: "openai", run: 1, briefId: "ph-01", category: "interior", simulated: false, specFile: null });
    expect(rec.firstValid).toBe(false);
    expect(rec.validWithinRetry).toBe(true);
  });

  it("two answers without a first camera end the build invalid", async () => {
    const { s } = await runPhoto([done(NO_CAMERAS), done(NO_CAMERAS)]);
    expect(s.final).toEqual({ status: "failed", failure: "invalid" });
  });

  it("an open set is sent back with the photo: the mend's reason carries the open sides and the set", async () => {
    const { s, nexts } = await runPhoto([done(OPEN), done(CLOSED)]);
    const close = nexts[1];
    expect(close.kind).toBe("retry-close-mend");
    expect(close.input).toBe("");
    expect(close.retry).toMatchObject({ why: "close", openSides: expect.any(Array) });
    expect(close.retry?.why === "close" && close.retry.previous.title).toBe(s.draft?.title);
    expect(s.final).toMatchObject({ status: "delivered", use: "answer", fromAttempt: 2 });
  });

  it("an incomplete answer asks for smaller; a refusal is never retried", async () => {
    const incomplete = await runPhoto([failed("incomplete"), done(CLOSED)]);
    expect(incomplete.nexts[1]).toEqual({ input: "", kind: "retry-smaller", retry: { why: "again", tooLong: true } });
    expect((await runPhoto([failed("refused"), done(CLOSED)])).s.final).toEqual({ status: "failed", failure: "refused" });
  });

  it("keeps the photo's bytes out of the state that goes to state.json", async () => {
    const { s } = await runPhoto([done(OPEN)]);
    expect(JSON.stringify(s)).not.toMatch(/data:image/);
  });
});
