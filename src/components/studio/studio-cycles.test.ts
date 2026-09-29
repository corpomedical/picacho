import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/sets/cycles", async () => await import("../../lib/sets/cycles"));
vi.mock("@/lib/stale-deploy", () => ({ isStaleDeployError: (e: unknown) => e instanceof Error && e.message === "stale" }));

const { pressCycles } = await import("./studio-cycles");
const { CYCLES_GONE, CYCLES_SAVE_FAILED, CYCLES_UNREACHABLE } = await import("../../lib/sets/cycles");

// One Blender render press from the Studio (studio-cycles.ts, 2026-09-29):
// the scene goes to its one-time place, the door is asked once, and the
// render is followed by the press's own id — never pressed again.

const PRESS = "33333333-3333-4333-8333-333333333333";
const done = { error: null, state: "done", credits: 0, kind: "still", url: "/api/media/x.png", seconds: 60, renderSeconds: 31, usd: 0.0378, device: "OPTIX" } as const;

function deps(over: Partial<Parameters<typeof pressCycles>[0]> = {}, reads: unknown[] = [done]) {
  const log: string[] = [];
  const queue = [...reads];
  const d = {
    reserve: vi.fn(async (_s: string, i: { pressId: string; size: number }) => (log.push(`reserve ${i.pressId} ${i.size}`), { error: null as null, path: "p.glb", token: "t" })),
    upload: vi.fn(async () => (log.push("upload"), { error: null })),
    render: vi.fn(async (_s: string, i: { pressId: string; job: unknown }) => (log.push(`render ${i.pressId}`), { error: null as null, state: "started" as const })),
    read: vi.fn(async (_s: string, i: { pressId: string }) => (log.push(`read ${i.pressId}`), queue.length > 1 ? queue.shift() : queue[0]) as never),
    alive: () => true,
    unreachable: "Couldn't reach the server",
    refresh: "Refresh the page",
    newId: () => PRESS,
    sleep: async () => {},
    ...over,
  };
  return { d, log };
}
const glb = new Blob([new Uint8Array(64)]);

describe("a Blender render press", () => {
  it("sends the scene, asks once, follows by the same id, and reports each phase", async () => {
    const { d, log } = deps({}, [{ error: null, state: "working", done: 0, total: 0 }, { error: null, state: "working", done: 2, total: 10 }, done]);
    const seen: unknown[] = [];
    const r = await pressCycles(d, "set", { glb, job: { kind: "still" } }, (u) => seen.push(u));
    expect(r).toEqual({ error: null, kind: "still", url: "/api/media/x.png", seconds: 60, renderSeconds: 31, usd: 0.0378, device: "OPTIX" });
    expect(log).toEqual([`reserve ${PRESS} 64`, "upload", `render ${PRESS}`, `read ${PRESS}`, `read ${PRESS}`, `read ${PRESS}`]);
    expect(seen).toEqual([{ phase: "uploading" }, { phase: "starting" }, { phase: "starting" }, { phase: "rendering", done: 2, total: 10 }]);
  });

  it("stops at the door's answer: refused, or the upload failed, with nothing started", async () => {
    const refused = deps({ reserve: vi.fn(async () => ({ error: "Blender renders aren't switched on yet." })) });
    expect(await pressCycles(refused.d, "set", { glb, job: {} }, () => {})).toEqual({ error: "Blender renders aren't switched on yet." });
    expect(refused.d.render).not.toHaveBeenCalled();
    const lost = deps({ upload: vi.fn(async () => ({ error: new Error("net") })) });
    expect(await pressCycles(lost.d, "set", { glb, job: {} }, () => {})).toEqual({ error: CYCLES_SAVE_FAILED });
    expect(lost.d.render).not.toHaveBeenCalled();
  });

  it("follows a start whose answer was lost, and never presses again", async () => {
    const { d } = deps({ render: vi.fn(async () => { throw new Error("connection reset"); }) });
    expect(await pressCycles(d, "set", { glb, job: {} }, () => {})).toMatchObject({ error: null, url: "/api/media/x.png" });
    expect(d.render).toHaveBeenCalledTimes(1);
    const never = deps({ render: vi.fn(async () => { throw new Error("connection reset"); }) }, [{ error: CYCLES_GONE }]);
    expect(await pressCycles(never.d, "set", { glb, job: {} }, () => {})).toEqual({ error: CYCLES_UNREACHABLE });
  });

  it("says a new deploy needs a refresh, and stops quietly once the Studio has closed", async () => {
    const onStale = vi.fn();
    const stale = deps({ render: vi.fn(async () => { throw new Error("stale"); }), onStale });
    expect(await pressCycles(stale.d, "set", { glb, job: {} }, () => {})).toEqual({ error: "Refresh the page" });
    expect(onStale).toHaveBeenCalled();
    const gone = deps({ alive: () => false });
    expect(await pressCycles(gone.d, "set", { glb, job: {} }, () => {})).toEqual({ error: "", left: true });
  });
});
