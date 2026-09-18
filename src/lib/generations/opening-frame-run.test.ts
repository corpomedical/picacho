import { beforeEach, describe, expect, it, vi } from "vitest";

// makeOpeningFrame spends money — one picture per paint, at most two — so its
// every path is proven here with the painter and the scorer stood in for.
// The policy modules it leans on are the real ones.

type Score = { score: number; notes: string; unusable: boolean; faceVisible: boolean; scorerVersion: string } | null;

let scoreQueue: (Score | Error)[] = [];
let paintFailures = 0;
const painted: { prompt: string; anchor: unknown; size: unknown }[] = [];
const bands: number[] = [];

vi.mock("@/lib/generations/providers/image", () => ({
  generateImage: async (
    _model: string,
    prompt: string,
    anchor: unknown,
    persist: (b64: string) => Promise<string>,
    _onFallback: unknown,
    _budget: unknown,
    _outfit: unknown,
    _prop: unknown,
    _look: unknown,
    _place: unknown,
    onUsage: (u: { usd: number }) => void,
    size: unknown,
  ) => {
    if (paintFailures > 0) {
      paintFailures -= 1;
      throw new Error("OpenAI image API error (500): boom");
    }
    painted.push({ prompt, anchor, size });
    onUsage({ usd: 0.07 });
    return persist(`frame-${painted.length}`);
  },
}));
vi.mock("@/lib/generations/providers/openai", () => ({
  scoreIdentityMatch: async () => {
    const next = scoreQueue.shift();
    if (next instanceof Error) throw next;
    return next ?? null;
  },
}));
vi.mock("@/lib/sets/frame-cut", () => ({
  cutToBand: async (b64: string, band: number) => {
    bands.push(band);
    return b64;
  },
}));
vi.mock("@/lib/generations/identity-gate", async () => await import("./identity-gate"));
vi.mock("@/lib/generations/opening-frame", async () => await import("./opening-frame"));

const { makeOpeningFrame, removeOpeningFrames } = await import("./opening-frame-run");

const scored = (score: number, unusable = false, faceVisible = true): Score => ({
  score,
  notes: "",
  unusable,
  faceVisible,
  scorerVersion: "t",
});

let discarded: string[] = [];
let clock = 0;

function deps(overrides: Partial<Parameters<typeof makeOpeningFrame>[0]> = {}) {
  return {
    videoPrompt: "Eva walks through a market at dawn.",
    aspectRatio: "16:9" as const,
    anchorUrl: "https://example.test/anchor.png",
    identityUrl: "https://example.test/identity.png",
    traitSummary: "hair: black bob",
    threshold: 70,
    deadlineAt: 1_000_000,
    persist: async (b64: string) => `/api/media/generated-images/u/${b64}.png`,
    absolutize: (url: string) => `https://picacho.test${url}`,
    discard: async (url: string) => {
      discarded.push(url);
    },
    now: () => clock,
    ...overrides,
  };
}

beforeEach(() => {
  scoreQueue = [];
  paintFailures = 0;
  painted.length = 0;
  bands.length = 0;
  discarded = [];
  clock = 0;
});

describe("makeOpeningFrame", () => {
  it("opens on the first frame when its face clears the bar", async () => {
    scoreQueue = [scored(86)];
    const out = await makeOpeningFrame(deps());
    expect(out.url).toBe("https://picacho.test/api/media/generated-images/u/frame-1.png");
    expect(out.scores).toEqual([86]);
    expect(painted).toHaveLength(1);
    expect(discarded).toEqual([]);
    expect(out.usd).toBeCloseTo(0.07);
    expect(out.logLine).toContain("face-checked (face 86)");
  });

  it("paints the clip's shape and cuts it to the band", async () => {
    scoreQueue = [scored(90)];
    await makeOpeningFrame(deps({ aspectRatio: "9:16" }));
    expect(painted[0].size).toBe("1024x1536");
    expect(painted[0].anchor).toBe("https://example.test/anchor.png");
    expect(bands).toEqual([9 / 16]);
  });

  it("re-paints once under the bar and keeps the one that cleared it", async () => {
    scoreQueue = [scored(52), scored(81)];
    const out = await makeOpeningFrame(deps());
    expect(painted).toHaveLength(2);
    expect(out.url).toContain("frame-2");
    expect(discarded).toEqual(["/api/media/generated-images/u/frame-1.png"]);
    expect(out.scores).toEqual([52, 81]);
  });

  it("opens on the photo when both frames miss, and keeps neither", async () => {
    scoreQueue = [scored(52), scored(61)];
    const out = await makeOpeningFrame(deps());
    expect(out.url).toBeNull();
    expect(painted).toHaveLength(2);
    expect(discarded.sort()).toEqual([
      "/api/media/generated-images/u/frame-1.png",
      "/api/media/generated-images/u/frame-2.png",
    ]);
    expect(out.logLine).toContain("missed the character's face (face 52, then 61), under 70");
  });

  it("never paints a third time", async () => {
    scoreQueue = [scored(10), scored(12), scored(99)];
    await makeOpeningFrame(deps());
    expect(painted).toHaveLength(2);
  });

  it("treats a blank frame as no picture of anyone, even with a high number", async () => {
    scoreQueue = [scored(95, true), scored(83)];
    const out = await makeOpeningFrame(deps());
    expect(out.url).toContain("frame-2");
    expect(discarded).toEqual(["/api/media/generated-images/u/frame-1.png"]);
  });

  it("never opens on a frame with no face in it — the video would have to invent one", async () => {
    scoreQueue = [scored(88, false, false), scored(84)];
    const out = await makeOpeningFrame(deps());
    expect(out.url).toContain("frame-2");
    expect(out.scores).toEqual([null, 84]);
    expect(discarded).toEqual(["/api/media/generated-images/u/frame-1.png"]);
  });

  it("opens on the photo when neither frame shows the face", async () => {
    scoreQueue = [scored(88, false, false), scored(90, false, false)];
    const out = await makeOpeningFrame(deps());
    expect(out.url).toBeNull();
    expect(painted).toHaveLength(2);
  });

  it("uses an unreadable frame rather than punishing a scorer outage — the clip itself is still checked", async () => {
    scoreQueue = [null];
    const out = await makeOpeningFrame(deps());
    expect(out.url).toContain("frame-1");
    expect(out.logLine).toContain("could not run");
  });

  it("with the gate off, opens on the first frame whatever it scored", async () => {
    scoreQueue = [scored(20)];
    const out = await makeOpeningFrame(deps({ threshold: 0 }));
    expect(out.url).toContain("frame-1");
    expect(painted).toHaveLength(1);
  });

  it("with the gate off, still never opens on a blank frame — the re-paint opens instead", async () => {
    scoreQueue = [scored(40, true), scored(30)];
    const out = await makeOpeningFrame(deps({ threshold: 0 }));
    expect(out.url).toContain("frame-2");
    expect(discarded).toEqual(["/api/media/generated-images/u/frame-1.png"]);
  });

  it("after a blank first frame, an unreadable re-paint is not trusted", async () => {
    scoreQueue = [scored(40, true), null];
    const out = await makeOpeningFrame(deps());
    expect(out.url).toBeNull();
    expect(discarded).toHaveLength(2);
  });

  it("does not start a paint it cannot finish", async () => {
    clock = 1_000_000 - 1_000;
    const out = await makeOpeningFrame(deps());
    expect(out.url).toBeNull();
    expect(painted).toHaveLength(0);
    expect(out.logLine).toContain("No time left");
  });

  it("does not start the re-paint without time for it, and cleans up the miss", async () => {
    scoreQueue = [scored(40)];
    const out = await makeOpeningFrame(
      deps({
        now: () => {
          // The first paint ends with too little time left for another.
          const t = clock;
          clock += 480_000;
          return t;
        },
      }),
    );
    expect(out.url).toBeNull();
    expect(painted).toHaveLength(1);
    expect(discarded).toEqual(["/api/media/generated-images/u/frame-1.png"]);
  });

  it("falls back to the photo when the painter fails, with nothing to clean", async () => {
    paintFailures = 1;
    const out = await makeOpeningFrame(deps());
    expect(out.url).toBeNull();
    expect(discarded).toEqual([]);
    expect(out.logLine).toContain("could not be made");
  });

  it("falls back and cleans up when the re-paint fails after a miss", async () => {
    scoreQueue = [scored(40)];
    paintFailures = 0;
    const d = deps();
    const original = d.persist;
    let calls = 0;
    d.persist = async (b64: string) => {
      calls += 1;
      if (calls === 2) throw new Error("storage down");
      return original(b64);
    };
    const out = await makeOpeningFrame(d);
    expect(out.url).toBeNull();
    expect(discarded).toEqual(["/api/media/generated-images/u/frame-1.png"]);
  });

  it("with no identity photo to read against, the frame is used unread", async () => {
    const out = await makeOpeningFrame(deps({ identityUrl: null }));
    expect(out.url).toContain("frame-1");
    expect(out.scores).toEqual([null]);
  });
});

describe("removeOpeningFrames", () => {
  it("removes this generation's frames and nobody else's", async () => {
    const removed: string[][] = [];
    const listed: { folder: string; search: string }[] = [];
    const admin = {
      storage: {
        from: () => ({
          list: async (folder: string, opts: { search: string }) => {
            listed.push({ folder, search: opts.search });
            return {
              data: [{ name: "gen-1-1.png" }, { name: "gen-1-2.png" }, { name: "gen-12-1.png" }],
              error: null,
            };
          },
          remove: async (paths: string[]) => {
            removed.push(paths);
            return { error: null };
          },
        }),
      },
    };
    await removeOpeningFrames(admin as never, "user-a", "gen-1");
    expect(listed).toEqual([{ folder: "user-a/opening-frames", search: "gen-1" }]);
    expect(removed).toEqual([["user-a/opening-frames/gen-1-1.png", "user-a/opening-frames/gen-1-2.png"]]);
  });

  it("never throws — a cleanup must not cost a finish", async () => {
    const admin = {
      storage: {
        from: () => ({
          list: async () => {
            throw new Error("storage down");
          },
        }),
      },
    };
    await expect(removeOpeningFrames(admin as never, "u", "g")).resolves.toBeUndefined();
  });
});
