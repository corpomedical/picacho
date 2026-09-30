import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/sets/press-follow", async () => await import("../../lib/sets/press-follow"));
vi.mock("@/lib/sets/studio-recast", async () => await import("../../lib/sets/studio-recast"));
vi.mock("@/lib/stale-deploy", () => ({ isStaleDeployError: (e: unknown) => e instanceof Error && e.message === "stale" }));

const { pressStudioRecast, wakeableSleep } = await import("./studio-recast");

// One "Video with your character" press (studio-recast.ts, 2026-09-30):
// Recast's reserve → upload → read → start, in that order, with the press's
// own sendId; Stop before the start sends nothing; an answer lost on the way
// is followed by that id and never pressed again.

const SEND = "44444444-4444-4444-8444-444444444444";
const READ = { title: "t", motion: "m", world: "w", people: [{ tag: "A", where: "centre", does: "walks", lead: true }], keeps: [], cuts: [], framing: "wide", sound: "silent", headVisible: true, confidence: "high" };

function deps(over: Record<string, unknown> = {}, reads: unknown[] = [{ error: null, state: "working", progress: "Rendering" }, { error: null, state: "done", url: "/api/media/take.mp4" }]) {
  const log: string[] = [];
  const queue = [...reads];
  const d = {
    reserve: vi.fn(async (_s: string, i: { size: number; type: string }) => (log.push(`reserve ${i.type} ${i.size}`), { error: null as null, path: "u/clip.mp4", contentType: "video/mp4" })),
    upload: vi.fn(async (_p: string, _t: string, _c: Blob, onShare: (s: number) => void) => (log.push("upload"), onShare(1), "sent" as const)),
    inspect: vi.fn(async (_s: string, i: { path: string }) => (log.push(`inspect ${i.path}`), { error: null as null, path: "u/clip.mp4", seconds: 5, frames: 120, width: 1280, height: 720, read: READ as never })),
    start: vi.fn(async (_s: string, i: Record<string, unknown>) => (log.push(`start ${i.sendId}`), { error: null as null, ids: [String(i.sendId)] })),
    read: vi.fn(async (_s: string, i: { id: string }) => (log.push(`read ${i.id}`), (queue.length > 1 ? queue.shift() : queue[0]) as never)),
    discard: vi.fn(async (_s: string, i: { path: string }) => void log.push(`discard ${i.path}`)),
    alive: () => true,
    stopped: () => false,
    unreachable: "unreachable",
    refresh: "refresh",
    changed: "changed",
    failed: "failed",
    neverStarted: "never started",
    unchecked: "unchecked",
    stillGoing: "still going",
    sleep: async () => {},
    ...over,
  };
  return { d, log };
}
const press = (over: Record<string, unknown> = {}) => ({
  sendId: SEND,
  clip: new Blob([new Uint8Array(4000)], { type: "video/mp4" }),
  type: "video/mp4",
  characterId: "c1",
  photoCount: 4,
  engine: "kling-edit" as const,
  seconds: 5,
  credits: 3,
  direction: "From 0 s to 3 s they walk to the red car.",
  figuresX: [0.02],
  chosen: 0,
  ...over,
});

describe("pressStudioRecast", () => {
  it("records → uploads → Recast reads it → starts once with the press's id → follows it to the finished video", async () => {
    const { d, log } = deps();
    const phases: string[] = [];
    const out = await pressStudioRecast(d as never, "set-1", press(), (u) => phases.push(u.phase));
    expect(out).toEqual({ error: null, id: SEND, url: "/api/media/take.mp4" });
    expect(log).toEqual(["reserve video/mp4 4000", "upload", "inspect u/clip.mp4", `start ${SEND}`, `read ${SEND}`, `read ${SEND}`]);
    expect(d.start).toHaveBeenCalledTimes(1);
    expect(d.start.mock.calls[0][1]).toEqual({
      sendId: SEND,
      path: "u/clip.mp4",
      characterId: "c1",
      engine: "kling-edit",
      seconds: 5,
      direction: "From 0 s to 3 s they walk to the red car.",
      read: READ,
      castTag: "A",
    });
    expect([...new Set(phases)]).toEqual(["uploading", "reading", "starting", "rendering"]);
  });

  it("Stop before the start sends nothing, and the recording is let go", async () => {
    let stop = false;
    const { d, log } = deps({ stopped: () => stop, upload: vi.fn(async () => ((stop = true), "sent" as const)) });
    const out = await pressStudioRecast(d as never, "set-1", press(), () => {});
    expect(out).toEqual({ error: "", stopped: true });
    expect(d.start).not.toHaveBeenCalled();
    expect(log).toContain("discard u/clip.mp4");
  });

  it("a refusal is said in Recast's words and nothing is followed", async () => {
    const { d } = deps({ start: vi.fn(async () => ({ error: "Recasting is in private testing." })) });
    const out = await pressStudioRecast(d as never, "set-1", press(), () => {});
    expect(out).toEqual({ error: "Recasting is in private testing." });
    expect(d.read).not.toHaveBeenCalled();
  });

  it("a refusal before the start (Recast's reserve) sends nothing further", async () => {
    const { d } = deps({ reserve: vi.fn(async () => ({ error: "Recasting is in private testing." })) });
    expect(await pressStudioRecast(d as never, "set-1", press(), () => {})).toEqual({ error: "Recasting is in private testing." });
    expect(d.upload).not.toHaveBeenCalled();
    expect(d.start).not.toHaveBeenCalled();
  });

  it("a lost answer is followed by the press's id, never pressed again", async () => {
    const { d, log } = deps({ start: vi.fn(async () => { log.push("start"); throw new Error("Failed to fetch"); }) });
    const out = await pressStudioRecast(d as never, "set-1", press(), () => {});
    expect(out).toEqual({ error: null, id: SEND, url: "/api/media/take.mp4" });
    expect(d.start).toHaveBeenCalledTimes(1);
    expect(log.filter((l) => l.startsWith("read")).every((l) => l === `read ${SEND}`)).toBe(true);
  });

  it("a lost answer that never reached the server says so once the request has surely ended", async () => {
    let t = 0;
    const { d } = deps({ start: vi.fn(async () => { throw new Error("Failed to fetch"); }), now: () => t, sleep: async (ms: number) => void (t += ms) }, [{ error: null, state: "none" }]);
    expect(await pressStudioRecast(d as never, "set-1", press(), () => {})).toEqual({ error: "never started" });
    expect(d.start).toHaveBeenCalledTimes(1);
  });

  it("a recording shorter than the range, or a price that moved, sends nothing", async () => {
    const short = deps({ inspect: vi.fn(async () => ({ error: null, path: "u/clip.mp4", seconds: 4.8, frames: 115, width: 1280, height: 720, read: null })) });
    expect(await pressStudioRecast(short.d as never, "set-1", press(), () => {})).toEqual({ error: "changed" });
    expect(short.d.start).not.toHaveBeenCalled();
    const moved = deps();
    expect(await pressStudioRecast(moved.d as never, "set-1", press({ credits: 2 }), () => {})).toEqual({ error: "changed" });
    expect(moved.d.start).not.toHaveBeenCalled();
    expect(moved.log).toContain("discard u/clip.mp4");
  });

  it("the follow never stops on a read that errs, throws or hangs — only on done, stopped or failed", async () => {
    let n = 0;
    const answers = [
      () => ({ error: null, state: "working", progress: "Rendering your video" }),
      () => ({ error: "Your session expired — please log in again." }),
      () => { throw new Error("Failed to fetch"); },
      () => new Promise(() => {}),
      () => ({ error: null, state: "working", progress: "Rendering your video" }),
      () => ({ error: null, state: "done", url: "/api/media/take.mp4" }),
    ];
    const { d } = deps({ readTimeoutMs: 5, read: vi.fn(async () => answers[Math.min(n++, answers.length - 1)]()) });
    const seen: string[] = [];
    const out = await pressStudioRecast(d as never, "set-1", press(), (u) => u.phase === "rendering" && seen.push(`${u.id}:${u.progress}`));
    expect(out).toEqual({ error: null, id: SEND, url: "/api/media/take.mp4" });
    expect(n).toBe(6);
    // The window has the take's id from the first moment it renders (its History link).
    expect(seen[0]).toBe(`${SEND}:`);
  });

  it("gives up on reads only after many in a row fail, and says the last reason", async () => {
    const { d } = deps({}, [{ error: "Recasting is in private testing." }]);
    expect(await pressStudioRecast(d as never, "set-1", press(), () => {})).toEqual({ error: "Recasting is in private testing.", id: SEND });
    expect(d.read.mock.calls.length).toBe(12);
  });

  it("the wait between reads ends the moment a hidden tab is shown again", async () => {
    const doc = Object.assign(new EventTarget(), { visibilityState: "hidden" });
    vi.stubGlobal("document", doc);
    try {
      const t0 = Date.now();
      const waiting = wakeableSleep(60_000);
      doc.visibilityState = "visible";
      doc.dispatchEvent(new Event("visibilitychange"));
      await waiting;
      expect(Date.now() - t0).toBeLessThan(1000);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("the Studio is not restarted by a page re-render (Recast's start revalidates, and the page is sent again)", async () => {
    const { readFileSync } = await import("node:fs");
    const src = readFileSync(new URL("./helios-studio.tsx", import.meta.url), "utf8");
    expect(src).toContain("}, [setId, unreachable, locale, cyclesOn]);");
    expect(src).toContain("spec: specRef.current");
  });

  it("a take that failed says why, and whether it cost anything", async () => {
    const { d } = deps({}, [{ error: null, state: "failed", reason: null, refused: true, charged: false }]);
    expect(await pressStudioRecast(d as never, "set-1", press(), () => {})).toEqual({ error: "failed", id: SEND, charged: false });
  });
});
