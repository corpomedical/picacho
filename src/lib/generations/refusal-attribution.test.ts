import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { decideRefusalProvider } from "./refusal-attribution-core";
import { refusalProviderFor, withModelWrittenPrompt } from "./refusal-attribution";

// Whose words a refused prompt was (refusal-attribution.ts, 2026-09-12).
// A Set shot's prompt is Astra's description plus Picacho's sentences plus,
// sometimes, the person's direction; only a refusal of their words may make
// their next hour stricter.

const WRITTEN = { modelOnlyPrompt: "A sunlit racing circuit. The person stands where the grey figure stands.", provider: "astra" };
const WITH_DIRECTION = "A sunlit racing circuit. What happens: she leans on the car. The person stands where the grey figure stands.";

describe("the decision", () => {
  it("no model-written part known: every refusal is the person's, and nothing is judged twice", async () => {
    const judge = vi.fn(async () => true);
    expect(await decideRefusalProvider(null, WITH_DIRECTION, judge)).toBeNull();
    expect(judge).not.toHaveBeenCalled();
  });

  it("nothing of theirs in the prompt: the model's, with no second judgement", async () => {
    const judge = vi.fn(async () => false);
    expect(await decideRefusalProvider(WRITTEN, WRITTEN.modelOnlyPrompt, judge)).toBe("astra");
    expect(judge).not.toHaveBeenCalled();
  });

  it("the model's part refused on its own: the model's", async () => {
    const judge = vi.fn(async () => true);
    expect(await decideRefusalProvider(WRITTEN, WITH_DIRECTION, judge)).toBe("astra");
    expect(judge).toHaveBeenCalledWith(WRITTEN.modelOnlyPrompt);
  });

  it("the model's part passes on its own: the person's words made the difference, and it counts", async () => {
    expect(await decideRefusalProvider(WRITTEN, WITH_DIRECTION, async () => false)).toBeNull();
  });

  it("a second judgement that fails leaves it the person's, as it was before this existed", async () => {
    expect(
      await decideRefusalProvider(WRITTEN, WITH_DIRECTION, async () => {
        throw new Error("classifier down");
      }),
    ).toBeNull();
  });
});

describe("the server-memory context", () => {
  it("is seen inside the call that set it, through awaits, and nowhere else", async () => {
    const refused = async () => true;
    const inside = withModelWrittenPrompt(WRITTEN, async () => {
      await new Promise((r) => setTimeout(r, 5));
      return refusalProviderFor(WITH_DIRECTION, refused);
    });
    // A request running at the same moment, outside it, sees nothing.
    const outside = refusalProviderFor(WITH_DIRECTION, refused);
    expect(await inside).toBe("astra");
    expect(await outside).toBeNull();
  });
});

// These pin, exactly, every line the eval reads to decide whether a refused
// Set shot's prompt is attributed (scripts/astra-sets-eval, pass-bars.mts
// shotPromptLogging): a product change to one fails here first, never only
// in the eval.
describe("where it is wired (read as source)", () => {
  const read = (p: string) => readFileSync(join(__dirname, p), "utf8");
  /** One exported function's text, to the next top-level export. */
  const fn = (src: string, decl: string) => {
    const at = src.indexOf(decl);
    expect(at, decl).toBeGreaterThanOrEqual(0);
    const next = src.indexOf("\nexport ", at + 1);
    return src.slice(at, next < 0 ? undefined : next);
  };

  it("runGeneration's entry gate (gatePrompt) and the pipeline's gate both ask it, in their own lane, with their own history, and log what it answers", () => {
    for (const [file, body, ask] of [
      [
        "policy-log.ts",
        fn(read("policy-log.ts"), "export async function gatePrompt("),
        "await refusalProviderFor(input.prompt, (text) => refusedOnItsOwn(text, input.hasRealPersonReference === true, priorHits));",
      ],
      [
        "pipeline.ts",
        read("pipeline.ts"),
        "await refusalProviderFor(reviewedPrompt, (text) => refusedOnItsOwn(text, options.strictContentLane === true, priorHits));",
      ],
    ] as const) {
      const at = body.indexOf(ask);
      expect(at, file).toBeGreaterThanOrEqual(0);
      // The log after the ask carries the provider it answered.
      const log = body.slice(body.indexOf("recordPolicyRefusal(", at));
      expect(log.slice(0, log.indexOf("});")), file).toContain("...(provider ? { provider } : {}),");
      // An outage is never judged twice.
      expect(body.slice(0, at), file).toMatch(/reason === "unavailable"\s*\?\s*null\s*:\s*$/);
    }
  });

  it("the second judgement is the same gate, the same lane, the same session history", () => {
    const alone = fn(read("policy-log.ts"), "export async function refusedOnItsOwn(");
    expect(alone).toContain("assertPromptAllowed({ prompt: text, hasRealPersonReference: strictLane, sessionPriorHits })");
    expect(alone).toContain('return err.reason !== "unavailable";');
  });

  it("only a Set shot sets it, around its own runGeneration call, with the direction taken out", () => {
    const shoot = fn(read("../sets/actions.ts"), "export async function shootInSet(");
    expect(shoot).toContain('const modelOnlyPrompt = buildSetShotPrompt({ ...shot, direction: "" });');
    expect(shoot).toContain('fd.set("prompt", buildSetShotPrompt({ ...shot, direction }));');
    expect(shoot).toContain('withModelWrittenPrompt({ modelOnlyPrompt, provider: "astra" }, () => runGeneration(fd))');
  });

  it("the wrapper hands the decision to the core, over an async-local store", () => {
    const src = read("refusal-attribution.ts");
    expect(src).toContain('import { decideRefusalProvider, type ModelWrittenPrompt } from "./refusal-attribution-core";');
    expect(src).toContain("const context = new AsyncLocalStorage<ModelWrittenPrompt>();");
    expect(fn(src, "export async function refusalProviderFor(")).toContain("return decideRefusalProvider(context.getStore() ?? null, prompt, refusedAlone);");
    expect(fn(src, "export function withModelWrittenPrompt<T>(")).toContain("return context.run(written, fn);");
  });

  it("no request can set it: runGeneration reads nothing of the kind from its form", () => {
    const gen = read("actions.ts");
    expect(gen).not.toMatch(/withModelWrittenPrompt|modelOnlyPrompt|model_written/);
  });
});
