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

describe("where it is wired (read as source)", () => {
  const read = (p: string) => readFileSync(join(__dirname, p), "utf8");

  it("runGeneration's entry gate (gatePrompt) and the pipeline's gate both ask it, and skip it for an outage", () => {
    for (const [file, prompt] of [
      ["policy-log.ts", "input.prompt"],
      ["pipeline.ts", "reviewedPrompt"],
    ] as const) {
      const src = read(file);
      expect(src, file).toContain(`await refusalProviderFor(${prompt}, (text) => refusedOnItsOwn(text,`);
      expect(src, file).toContain("...(provider ? { provider } : {}),");
      expect(src, file).toMatch(/reason === "unavailable"\s*\?\s*null/);
    }
  });

  it("the second judgement is the same gate, the same lane, no session history", () => {
    const src = read("policy-log.ts");
    const fn = src.slice(src.indexOf("export async function refusedOnItsOwn("));
    expect(fn).toContain("assertPromptAllowed({ prompt: text, hasRealPersonReference: strictLane, sessionPriorHits: 0 })");
    expect(fn).toContain('return err.reason !== "unavailable";');
  });

  it("only a Set shot sets it, around its own runGeneration call, with the direction taken out", () => {
    const sets = read("../sets/actions.ts");
    expect(sets).toContain('const modelOnlyPrompt = buildSetShotPrompt({ ...shot, direction: "" });');
    expect(sets).toContain('fd.set("prompt", buildSetShotPrompt({ ...shot, direction }));');
    expect(sets).toContain('withModelWrittenPrompt({ modelOnlyPrompt, provider: "astra" }, () => runGeneration(fd))');
  });

  it("no request can set it: runGeneration reads nothing of the kind from its form", () => {
    const gen = read("actions.ts");
    expect(gen).not.toMatch(/withModelWrittenPrompt|modelOnlyPrompt|model_written/);
  });
});
