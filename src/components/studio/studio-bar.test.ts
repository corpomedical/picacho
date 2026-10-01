import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { BAR_HTML, BAR_SHEET_TAB, selectChip, toggleChip } from "./studio-bar";
import { STUDIO_TEXT } from "./studio-text";
import { studioTranslator } from "./studio-i18n";
import { pressEngineBuild, type EngineBuildDoors } from "./studio-model";
import { ANIM_CHIPS, BAR_MODES, BAR_PLACEHOLDERS, CAMERA_PRESETS } from "../../lib/sets/studio-bar";
import { MODEL_ENGINES, MODEL_KIND_GROUPS, MODEL_DEFAULT_OPTIONS, modelBuildPrice, modelInputProblem } from "../../lib/sets/model-engines";
import { STUDIO_MODEL_BUILD_FAILED, STUDIO_MODEL_ENGINE_UNKNOWN, STUDIO_MODEL_STILL_STARTING } from "../../lib/sets/messages";

// The prompt bar (2026-10-01, operator: "Finalizing the UI to look and work like this"): its words in four languages,
// and its 3D Model press — one build per press, followed until it lands.

const LOCALES = ["es", "pt", "it"] as const;
/** Brand and engine names, and Blender's own kept words, are the same in every language. */
const SAME = new Set(["Hunyuan 3D v3.1 Pro", "Meshy 7.1", "Tripo v2.5", "TRELLIS.2", "PBR", "HD", "Tri", "Quad", "Auto", "Rigging", "· {0}"]);

describe("the bar's words in four languages", () => {
  const strings = () => {
    const html = BAR_HTML.replace(/<svg[\s\S]*?<\/svg>/g, "");
    const texts = [...html.matchAll(/>([^<>]+)</g)].map((m) => m[1].replace(/\s+/g, " ").trim()).filter((t) => /[A-Za-z]{2}/.test(t));
    const labels = [...html.matchAll(/\b(?:title|placeholder|aria-label)="([^"]*)"/g)].map((m) => m[1].trim()).filter((t) => /[A-Za-z]{2}/.test(t));
    const dynamic = [
      ...BAR_MODES.map((m) => m.label),
      ...Object.values(BAR_PLACEHOLDERS),
      ...CAMERA_PRESETS.flatMap((p) => [p.label, p.line]),
      ...ANIM_CHIPS.map((c) => c.label),
      ...MODEL_KIND_GROUPS.map((g) => g.label),
      ...MODEL_ENGINES.map((e) => e.note),
      ...MODEL_ENGINES.flatMap((e) => (["text", "image", "multi"] as const).filter((k) => e.endpoints[k]).flatMap((k) => modelBuildPrice(e, k, { ...MODEL_DEFAULT_OPTIONS, pbr: true, rig: true, quad: true, polycount: 50_000, textures: e.has.textures.at(-1)! }).map((l) => l.what))),
      ...MODEL_ENGINES.flatMap((e) => (["text", "image", "multi"] as const).map((k) => modelInputProblem(e, { kind: k, prompt: "", images: {}, options: MODEL_DEFAULT_OPTIONS })).filter((x): x is string => !!x)),
      STUDIO_MODEL_BUILD_FAILED,
      STUDIO_MODEL_ENGINE_UNKNOWN,
      STUDIO_MODEL_STILL_STARTING,
      "· fal's price, read 2026-10-01. Picacho pays it; no credits are taken. Up to 10 builds an hour.",
      "Through the shot camera · 27 mm · 16:9 · HD. The stand-in marks where your character stands.",
      "Records frames 1–240 through the shot camera, then Recast re-shoots it with your character in the figure's place. Stop before it is sent costs nothing.",
      "It writes the shot camera's keys over frames 1–120 (one step ⌘Z undoes) and looks through it.",
      "From frame 12 (the playhead). Each is one step ⌘Z undoes; the figure's Move panel lists them. Or write it and Astra plans it.",
      "49 camera keys",
      "from $0.375",
      "Camera · Orbit · 25 keys on frames 1–240 · ⌘Z undoes it",
      "Building the model · 12 s — usually a minute or two. It lands on the stage when it's ready.",
      ...[...BAR_SHEET_TAB.matchAll(/>([^<>]+)</g)].map((m) => m[1].trim()).filter((t) => /[A-Za-z]{2}/.test(t)),
    ];
    return [...new Set([...texts, ...labels, ...dynamic])];
  };

  it("every word the bar shows has Spanish, Portuguese and Italian (brand names stay)", () => {
    const all = strings();
    expect(all.length).toBeGreaterThan(60);
    for (const loc of LOCALES) {
      const tr = studioTranslator(loc);
      // Italian writes "Video" and "Camera" as English does.
      const left = all.filter((t) => tr(t) === t && !SAME.has(t) && !/^(Hunyuan|Meshy|Tripo|TRELLIS)/.test(t) && !(loc === "it" && ["Video", "Camera"].includes(t)));
      expect(left, loc).toEqual([]);
    }
  });

  it("the rows are whole: four languages each, the same {n} values, no English key twice", () => {
    const seen = new Set<string>();
    for (const row of STUDIO_TEXT) {
      const k = row[0].replace(/\s+/g, " ");
      expect(seen.has(k), k).toBe(false);
      seen.add(k);
    }
    expect(studioTranslator("es")("Scene builder")).toBe("Constructor de escenas");
    expect(studioTranslator("pt")("3D Model")).toBe("Modelo 3D");
    expect(studioTranslator("it")("49 camera keys")).toBe("49 chiavi della camera");
  });

  it("chips are buttons that say their state, selects say their name", () => {
    expect(toggleChip("rig", "Rigging", true)).toContain('aria-pressed="true"');
    expect(selectChip("pbTopo", "", [["tri", "Tri"]], "tri", "", "Topology")).toContain('aria-label="Topology"');
  });
});

describe("the 3D Model press (pressEngineBuild)", () => {
  const H = { requestId: "req-12345678", statusUrl: "s", responseUrl: "r" };
  const doors = (over: Partial<EngineBuildDoors>, log: string[]): EngineBuildDoors => ({
    start: async (_s, input) => { log.push(`start ${input.pressId}`); return { error: null, engine: "meshy-7.1", kind: "multi", rig: true, key: null, handle: H, usd: 1.4 }; },
    poll: async (_s, input) => { log.push(`poll ${input.engine} ${input.rig}`); return log.filter((l) => l.startsWith("poll")).length < 3 ? { error: null, state: "working" } : { error: null, state: "done", file: "f.glb", url: "u" }; },
    alive: () => true,
    sleep: async () => {},
    now: () => 0,
    waitMs: 1000,
    pollMs: 1,
    failed: "failed",
    unreachable: "unreachable",
    ...over,
  });
  const input = { engine: "meshy-7.1", kind: "multi" as const, prompt: "", images: { front: "a", back: "b" }, options: {}, target: { new: true as const } };

  it("starts once under the press id, asks after it with what the start answered, and lands as a Studio file", async () => {
    const log: string[] = [], phases: string[] = [];
    const r = await pressEngineBuild(doors({}, log), "set", "press-1", input, (p) => phases.push(p));
    expect(r).toEqual({ error: null, file: { file: "f.glb", url: "u" } });
    expect(log).toEqual(["start press-1", "poll meshy-7.1 true", "poll meshy-7.1 true", "poll meshy-7.1 true"]);
    expect(phases).toEqual(["photo", "building", "placing"]);
  });

  it("a start that throws is asked again with the SAME press id (the server answers a resend with the same build)", async () => {
    const log: string[] = [];
    let n = 0;
    const r = await pressEngineBuild(doors({ start: async (_s, i) => { log.push(i.pressId); if (n++ === 0) throw new Error("lost"); return { error: null, engine: "meshy-7.1", kind: "multi", rig: false, key: "c_1", handle: H, usd: 1.2 }; }, poll: async () => ({ error: null, state: "done", thing: { key: "c_1", url: "u", flip: false } }) }, log), "set", "press-2", input, () => {});
    expect(log).toEqual(["press-2", "press-2"]);
    expect(r).toEqual({ error: null, thing: { key: "c_1", url: "u", flip: false } });
  });

  it("says the door's refusal, or unreachable, and stops at the wait", async () => {
    expect(await pressEngineBuild(doors({ start: async () => ({ error: "admins only" }) }, []), "s", "p", input, () => {})).toEqual({ error: "admins only" });
    expect(await pressEngineBuild(doors({ start: async () => { throw new Error("x"); } }, []), "s", "p", input, () => {})).toEqual({ error: "unreachable" });
    let t = 0;
    expect(await pressEngineBuild(doors({ now: () => (t += 600), poll: async () => ({ error: null, state: "working" }) }, []), "s", "p", input, () => {})).toEqual({ error: "failed" });
  });
});

describe("the doors behind it (model-actions.ts)", () => {
  const src = readFileSync(join(__dirname, "../../lib/sets/model-actions.ts"), "utf8");
  const body = (fn: string) => { const a = src.indexOf(`export async function ${fn}(`); return src.slice(a, src.indexOf("\nexport ", a + 10) > 0 ? src.indexOf("\nexport ", a + 10) : undefined); };

  it("start: setsAccess, the admins switch, the set, the engine and input, the press ticket, the hourly limit, the word and picture gates — in that order — then fal", () => {
    const s = body("startStudioModelBuild");
    const order = [
      "await setsAccess()",
      "!access.isAdmin && !STUDIO_MODEL_ENGINES_FOR_ALL",
      "setIsTheirs(admin, access.userId, setId)",
      "modelInputProblem(engine",
      "writeModelTicket(ticketPath, ticket, false)",
      'rateLimited(access.userId, "thing-build", 60 * 60, THING_BUILDS_PER_HOUR)',
      "gatePrompt({ prompt, userId: access.userId",
      "checkReferencePhoto(access.userId, parsed.bytes)",
      "submitModelBuild(engine",
    ];
    let at = -1;
    for (const o of order) { const i = s.indexOf(o); expect(i, o).toBeGreaterThan(at); at = i; }
    // A repeat delivery of the press is answered from its ticket — never a second build.
    expect(s).toContain("followModelTicket(ticketPath)");
    // Only the re-encoded JPEG of each photo is sent, never the browser's bytes.
    expect(s).toContain("images[v] = `data:image/jpeg;base64,${photo.jpeg.toString(\"base64\")}`;");
  });

  it("poll: the same gates, only fal's queue for this engine's endpoint, the engine's own .glb, kept on the thing or as a Studio file", () => {
    const s = body("pollStudioModelBuild");
    expect(s.indexOf("await setsAccess()")).toBeLessThan(s.indexOf("STUDIO_MODEL_ENGINES_FOR_ALL"));
    expect(s).toContain("modelHandleAllowed(endpoint, input.handle)");
    expect(s).toContain("modelResultGlb(engine, input.rig === true, result)");
    expect(s).toContain("removeOthers(admin, access.userId, setId as string, key, path)");
  });

  it("no credits are taken: nothing to give back when a build fails (Picacho pays fal)", () => {
    const s = body("startStudioModelBuild") + body("pollStudioModelBuild");
    expect(s).not.toMatch(/credit|charge|refund/i);
  });
});
