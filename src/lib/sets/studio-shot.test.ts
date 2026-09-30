import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { formatFrame } from "./rig";
import { normaliseSetLayout } from "./set-spec";
import { STUDIO_FORMAT_RIG, studioRenderFovDeg, studioRigFormat, studioShotInput, type StudioShotScene } from "./studio-shot";

// Helios Studio stage 3 (2026-09-29): "Photo with your character" sends the
// Studio's shot camera through the set page's own Shoot. What it sends is
// pinned here: the format the photo is cut to, a view whose BAND shows what
// the Studio's frame shows, the stand-in's mark, the moved things, and the
// press itself — one id per press, followed and never sent twice when the
// answer is lost. No paid call: the server is stood in for.

const scene = (over: Partial<StudioShotScene> = {}): StudioShotScene => ({
  format: "16:9 · HD",
  camera: { position: [4, 1.6, 6], forward: [0, 0, -1], fovDeg: 37.85, focusM: 7 },
  figure: { x: 1.2, z: -0.5, facingDeg: -90 },
  markId: "m1",
  moved: [],
  ...over,
});

describe("studioShotInput", () => {
  it("maps the Studio's formats to the photo formats; 4:5 and anything unknown go square", () => {
    expect(studioRigFormat("16:9 · HD")).toBe("wide");
    expect(studioRigFormat("2.39:1 · Scope")).toBe("scope");
    expect(studioRigFormat("9:16 · Vertical")).toBe("vertical");
    expect(studioRigFormat("1:1 · Square")).toBe("square");
    expect(studioRigFormat("4:5 · Portrait")).toBe("square");
    expect(studioRigFormat("toString")).toBe("square");
    expect(Object.keys(STUDIO_FORMAT_RIG)).toHaveLength(5);
  });

  it("widens the view so the band shows the Studio frame top to bottom", () => {
    const wide = formatFrame("wide");
    const f = studioRenderFovDeg(40, wide);
    // tan(half) scales with the render's height over the band's.
    expect(Math.tan((f * Math.PI) / 360)).toBeCloseTo(Math.tan((40 * Math.PI) / 360) * (wide.renderH / wide.bandH), 9);
    // A band as tall as the render (square, vertical) keeps the lens's own view.
    expect(studioRenderFovDeg(40, formatFrame("square"))).toBeCloseTo(40, 9);
    expect(studioRenderFovDeg(40, formatFrame("vertical"))).toBeCloseTo(40, 9);
  });

  it("says the camera, the mark and the frame's shape the way the set page's Shoot does", () => {
    const out = studioShotInput(scene());
    expect(out.rig).toEqual({ format: "wide" });
    expect(out.frame).toEqual(formatFrame("wide"));
    expect(out.canvasAspect).toBeCloseTo(1536 / 1024, 9);
    expect(out.layout.markId).toBe("m1");
    expect(out.layout.mark).toEqual({ x: 1.2, z: -0.5, facingDeg: 270 });
    expect(out.layout.pose).toBe("stand");
    // The posed figure's nearest stand pose rides the layout (Helios Studio people, 2026-09-30).
    expect(studioShotInput(scene({ figure: { x: 1.2, z: -0.5, facingDeg: -90, pose: "sit" } })).layout.pose).toBe("sit");
    expect(out.layout.gaze).toBeNull();
    expect(out.layout.camera.position).toEqual([4, 1.6, 6]);
    expect(out.layout.camera.target).toEqual([4, 1.6, -1]);
    expect(out.layout.camera.fovDeg).toBeCloseTo(out.renderFovDeg, 2);
    // A focus closer than a metre still aims a metre out.
    expect(studioShotInput(scene({ camera: { position: [0, 1, 0], forward: [0, 0, 2], fovDeg: 30, focusM: 0.2 } })).layout.camera.target).toEqual([0, 1, 1]);
  });

  it("is a layout the server keeps as sent (normaliseSetLayout), on a set wide enough to hold it", () => {
    const spec = {
      bounds: { x: 20, z: 20, height: 6 },
      marks: [{ id: "m1", x: 0, z: 0, facingDeg: 0 }],
      cameras: [{ id: "c1", position: [0, 1.6, 6], target: [0, 1.4, 0], fovDeg: 40 }],
      objects: [],
    } as unknown as Parameters<typeof normaliseSetLayout>[1];
    const out = studioShotInput(scene());
    const kept = normaliseSetLayout(out.layout, spec);
    expect(kept?.camera).toEqual(out.layout.camera);
    expect(kept?.mark).toEqual(out.layout.mark);
  });

  it("sends at most three moved things, rounded", () => {
    const moved = [1, 2, 3, 4].map((i) => ({ key: `v_0000000${i}_0_0`, x: i + 0.00041, z: -i, turnDeg: 12.345 }));
    const out = studioShotInput(scene({ moved }));
    expect(out.movers).toHaveLength(3);
    expect(out.movers[0]).toEqual({ key: "v_00000001_0_0", x: 1, z: -1, turnDeg: 12.3 });
  });
});

vi.mock("@/lib/sets/press-follow", async () => await import("./press-follow"));
vi.mock("@/lib/stale-deploy", async () => await import("../stale-deploy"));

const { pressStudioStill } = await import("../../components/studio/studio-press");

describe("pressStudioStill — one press, one charge", () => {
  const words = { neverStarted: "never", stillGoing: "going", unchecked: "unchecked", inHistory: "history", refresh: "refresh" };
  const answer = { error: null, generationId: "g1", succeeded: true, resultUrl: "https://x/y.jpg" };
  let sent: { setId: string; input: Record<string, unknown> }[];
  let reads: string[];
  beforeEach(() => {
    sent = [];
    reads = [];
  });
  const base = (shoot: (setId: string, input: Record<string, unknown>) => Promise<unknown>, read?: () => Promise<unknown>) => ({
    shoot: async (setId: string, input: Record<string, unknown>) => {
      sent.push({ setId, input });
      return (await shoot(setId, input)) as never;
    },
    read: async (_s: string, i: { pressId: string }) => {
      reads.push(i.pressId);
      return (await (read ?? (async () => ({ error: null, state: "unknown" })))()) as never;
    },
    alive: () => true,
    words,
    sleep: async () => {},
  });
  const input = { frameDataUri: "data:image/jpeg;base64,/9j/", characterId: "c1", direction: "", layout: {}, beat: true };

  it("sends the frame once with a fresh press id and hands back the answer", async () => {
    const r = await pressStudioStill(base(async () => answer), "s1", input);
    expect(r).toEqual(answer);
    expect(sent).toHaveLength(1);
    expect(sent[0].setId).toBe("s1");
    expect(sent[0].input).toMatchObject(input);
    expect(sent[0].input.pressId).toMatch(/^[0-9a-f-]{36}$/);
    const again = await pressStudioStill(base(async () => answer), "s1", input);
    expect(again).toEqual(answer);
    expect(sent[1].input.pressId).not.toBe(sent[0].input.pressId);
  });

  it("follows a lost answer by its id and never sends it again", async () => {
    const phases: string[] = [];
    const deps = {
      ...base(
        async () => {
          throw new Error("Failed to fetch");
        },
        async () => ({ error: null, state: "answered", kind: "shot", answer }),
      ),
      onPhase: (p: string) => phases.push(p),
      now: (() => {
        let t = 0;
        return () => (t += 25_000);
      })(),
    };
    const r = await pressStudioStill(deps, "s1", input);
    expect(r).toEqual(answer);
    expect(sent).toHaveLength(1);
    expect(reads.every((id) => id === sent[0].input.pressId)).toBe(true);
    expect(phases).toContain("checking");
  });

  it("says a new deploy at once, without following", async () => {
    let stale = 0;
    const deps = {
      ...base(async () => {
        throw new Error('Server Action "abc" was not found on the server.');
      }),
      onStale: () => (stale += 1),
      now: () => 1_000,
    };
    expect(await pressStudioStill(deps, "s1", input)).toEqual({ error: "refresh" });
    expect(stale).toBe(1);
    expect(reads).toHaveLength(0);
  });

  it("passes a refusal through in its own words", async () => {
    expect(await pressStudioStill(base(async () => ({ error: "Pick a character." })), "s1", input)).toEqual({ error: "Pick a character." });
    expect(sent).toHaveLength(1);
  });
});

describe("the wiring", () => {
  const read = (p: string) => readFileSync(join(__dirname, "../../..", p), "utf8");
  it("the Studio is priced by the set page's own quote and presses the set page's own Shoot", () => {
    const wrapper = read("src/components/studio/helios-studio.tsx");
    expect(wrapper).toContain("credits: quoteSend(stillQuoteInput()).totalCredits");
    expect(wrapper).toContain("shoot: shootInSet,");
    expect(wrapper).toContain("read: readSetPress,");
    expect(read("src/app/app/sets/[id]/page.tsx")).toContain("characters={data.characters}");
  });
  it("the engine shows the price on the button, sends the band-cut frame, and leaves the set page's arrangement alone", () => {
    const engine = read("src/components/studio/studio-engine.ts");
    expect(engine).toContain("const castLabel = () => `${CAST_TITLE} · ${credits(opts.render.credits)}`;");
    expect(engine).toContain("for (const b of letterbox(fr)) ctx.fillRect(b.x, b.y, b.w, b.h);");
    // the payload is built in studio-cast.ts since the clean traced frame (2026-09-30); beat still rides on every send
    expect(engine).toContain("const input = studioCastInput(");
    expect(read("src/components/studio/studio-cast.ts")).toContain("    beat: true,\n");
    expect(engine).toContain("if (!R || !f || !c || c.likenessNeeded || cast.busy) return;");
    expect(read("src/components/studio/studio-markup.ts")).toContain('data-act=\\"renderCast\\"');
  });
});
