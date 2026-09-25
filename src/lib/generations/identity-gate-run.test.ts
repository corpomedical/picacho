import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// The likeness gate's plumbing, for a Helios lab still (2026-09-16). The lab
// grades a still after the cut — grain, a camcorder's smear, black and white
// — and scored after the lab, home video read 32 and Silver Print 16 on a
// frame that read 72 untouched. So a lab still is scored by its NEGATIVE, the
// frame before the lab (generations/actions.ts storeSetImage → scoreAs), and
// its re-render is stored through the same cut and lab (rerender.persist).
// A mistake here re-renders — and pays for — every lab still, so the paths
// are held here with the scorer and the renderer stood in for.
//
// The module imports through "@/", which this suite does not resolve, so
// every such import is given its stand-in (the policy itself is the real one).

const scores = new Map<string, number>();
const scored: string[] = [];
vi.mock("@/lib/generations/providers/openai", () => ({
  scoreIdentityMatch: vi.fn(async (imageUrl: string) => {
    scored.push(imageUrl);
    const score = scores.get(imageUrl);
    return score === undefined ? null : { score, notes: `scored ${imageUrl}`, unusable: false, scorerVersion: "test" };
  }),
}));
const rendered: string[] = [];
vi.mock("@/lib/generations/providers/image", () => ({
  generateImage: vi.fn(async (...args: unknown[]) => {
    const persist = args[3] as (base64: string) => Promise<string>;
    const url = await persist("second-render-base64");
    rendered.push(url);
    return url;
  }),
}));
vi.mock("@/lib/generations/core", () => ({
  persistGeneratedImage: vi.fn(async () => "/plain/second.png"),
}));
vi.mock("@/lib/generations/identity-gate", async () => await import("./identity-gate"));

import { GATE_WALL_CLOCK_BUDGET_MS, runImageIdentityGate, type GateDeps } from "./identity-gate-run";
import { OPENAI_IMAGE_TIMEOUT_MS } from "./providers/openai-images";

const ABS = (u: string) => `https://picacho.test${u}`;

/** A gate run for a still at /print/first.png, with the character's bar at 70. */
function deps(over: Partial<GateDeps> = {}): GateDeps {
  return {
    userId: "u1",
    resultUrl: "/print/first.png",
    absoluteResultUrl: ABS("/print/first.png"),
    identityPhotoUrl: "https://picacho.test/identity.jpg",
    traitSummary: "",
    threshold: 70,
    rerender: { modelId: "gpt-image-2", compiledPrompt: "a still", referenceImageUrl: null },
    elapsedMs: 0,
    absolutize: ABS,
    ...over,
  };
}

beforeEach(() => {
  scores.clear();
  scored.length = 0;
  rendered.length = 0;
});

describe("a lab still under the likeness gate", () => {
  it("is scored by its negative, so the lab's look is not taken for a lost face", async () => {
    scores.set(ABS("/neg/first.jpg"), 72);
    scores.set(ABS("/print/first.png"), 16);
    const out = await runImageIdentityGate(
      deps({ scoreAs: (u) => (u === "/print/first.png" ? "/neg/first.jpg" : null) }),
    );
    expect(scored).toEqual([ABS("/neg/first.jpg")]);
    expect(out.matchScore).toBe(72);
    expect(out.retries).toBe(0);
    expect(out.resultUrl).toBe("/print/first.png");
    expect(rendered).toEqual([]);
  });

  it("scores the still itself when it has no negative — a still shot without the lab, or one whose negative was not kept", async () => {
    scores.set(ABS("/print/first.png"), 81);
    const withoutLab = await runImageIdentityGate(deps());
    const negativeLost = await runImageIdentityGate(deps({ scoreAs: () => null }));
    expect(scored).toEqual([ABS("/print/first.png"), ABS("/print/first.png")]);
    expect(withoutLab.matchScore).toBe(81);
    expect(negativeLost.matchScore).toBe(81);
  });

  it("stores a re-render through the shot's own cut and lab, and scores that one by its negative too", async () => {
    // The first negative misses the bar; the re-render's negative clears it.
    scores.set(ABS("/neg/first.jpg"), 40);
    scores.set(ABS("/neg/second.jpg"), 83);
    scores.set(ABS("/print/second.png"), 20);
    const negatives = new Map([["/print/first.png", "/neg/first.jpg"]]);
    const persist = vi.fn(async () => {
      // What storeSetImage does: the print stored, its negative kept beside it.
      negatives.set("/print/second.png", "/neg/second.jpg");
      return "/print/second.png";
    });
    const out = await runImageIdentityGate(
      deps({
        scoreAs: (u) => negatives.get(u) ?? null,
        rerender: { modelId: "gpt-image-2", compiledPrompt: "a still", referenceImageUrl: null, persist },
      }),
    );
    expect(persist).toHaveBeenCalledWith("second-render-base64");
    expect(scored).toEqual([ABS("/neg/first.jpg"), ABS("/neg/second.jpg")]);
    expect(out.retries).toBe(1);
    expect(out.resultUrl).toBe("/print/second.png");
    expect(out.matchScore).toBe(83);
    expect(out.discardedUrl).toBe("/print/first.png");
  });

  it("without a persist of its own, a re-render is stored plainly — as any render outside a set is", async () => {
    scores.set(ABS("/print/first.png"), 40);
    scores.set(ABS("/plain/second.png"), 90);
    const out = await runImageIdentityGate(deps());
    expect(rendered).toEqual(["/plain/second.png"]);
    expect(out.resultUrl).toBe("/plain/second.png");
  });
});

// And the wiring that hands the gate those two things (actions.ts is a
// "use server" module, which cannot load here, so its source is read).
describe("the gate's clock (2026-09-25)", () => {
  // elapsedMs now counts from the request's first line (or a Helios press's,
  // server-press.ts), so the budget is what is left of the platform's 300 s
  // after one more full render and its scoring, storing and last write.
  it("leaves room for one more full render inside the request's 300 s", () => {
    expect(GATE_WALL_CLOCK_BUDGET_MS).toBe(300_000 - OPENAI_IMAGE_TIMEOUT_MS - 25_000);
    expect(GATE_WALL_CLOCK_BUDGET_MS).toBe(125_000);
  });

  it("re-renders a miss inside the budget, and delivers it as it is past it", async () => {
    scores.set(ABS("/print/first.png"), 40);
    scores.set(ABS("/plain/second.png"), 90);
    const inTime = await runImageIdentityGate(deps({ elapsedMs: GATE_WALL_CLOCK_BUDGET_MS }));
    expect(inTime.retries).toBe(1);
    rendered.length = 0;
    const late = await runImageIdentityGate(deps({ elapsedMs: GATE_WALL_CLOCK_BUDGET_MS + 1 }));
    expect(late.retries).toBe(0);
    expect(late.settledAt).toBeNull();
    expect(late.resultUrl).toBe("/print/first.png");
    expect(rendered).toEqual([]);
  });
});

describe("the set shot's side of it (generations/actions.ts)", () => {
  const src = readFileSync(join(__dirname, "actions.ts"), "utf8");

  it("stores the first render and the re-render through the same cut and lab", () => {
    expect(src).toContain("persistImage: (base64) => storeSetImage(userData.user!.id, base64),");
    expect(src).toContain("persist: (base64: string) => storeSetImage(userData.user!.id, base64),");
  });

  it("gives the gate the negative of each still the lab developed, and nothing for the rest", () => {
    expect(src).toContain("scoreAs: (u: string) => setNegatives.get(u) ?? null,");
    // A negative is named only once it is really stored beside its still.
    const store = src.slice(src.indexOf("const storeSetImage = async"), src.indexOf("// Every chat-attachment storage path"));
    expect(store).toMatch(/if \(error\) console\.warn\([^)]*\);\s*else setNegatives\.set\(url, mediaUrl\("generated-images", negativePath\)\);/);
  });

  it("says in the log what the lab made, or that it could not", () => {
    expect(src).toContain("detail: setNegatives.has(resultUrl)");
    expect(src).toContain("? labLine(setLab)");
  });
});
