import { describe, expect, it } from "vitest";
import { normaliseSetSpec, type SetSpec } from "../../../src/lib/sets/set-spec.ts";
import type { Combined } from "./blind-sheet.mts";
import type { ShotCharacter, ShotRecord } from "./shots.mts";
import { cBars, cFromRuns, cRatingsOf, cShotsOf, planCShots, probeLines, type FramedSet } from "../parts/c.mts";
import { fixtureJson } from "../parts/simulate.mts";

// Part C's plan of stills (the look arm included), and its bars wired to
// real still rows and the composition sheet's ratings. Synthetic rows; no
// engine, no Chrome.

const spec: SetSpec = (() => {
  const r = normaliseSetSpec(fixtureJson("showroom-closed"));
  if (!r.ok) throw new Error("fixture");
  return r.spec;
})();
const pic = { bytes: Buffer.from([0xff, 0xd8, 0xff, 0]), mime: "image/jpeg" };
const framed = (key: string): FramedSet => ({ key, spec, lifted: false, frames: spec.cameras.slice(0, 3).map((camera) => ({ camera, file: `frames/${key}-${camera.id}.jpg`, picture: pic })) });
const char = (id: string, photo = true): ShotCharacter => ({ id, name: id, traits: { hair: "", distinguishing_features: "", outfit: "", personality: "" }, photo: photo ? pic : null });

describe("C's plan of stills", () => {
  const plan = planCShots({ sets: [framed("s1"), framed("s2")], characters: [char("a"), char("b")], directions: ["d0", "d1", "d2", "d3"], engines: ["gpt-image", "flux", "seedream"], look: true, control: true });
  const all = [...plan.groups.flatMap((g) => [g.first, ...g.rest, ...g.withLook]), ...plan.singles];
  const count = (engine: string, arm: string) => all.filter((r) => r.engine === engine && r.arm === arm).length;

  it("per set, character and engine: camera 1 first, the later cameras on their own sketch, and again carrying the look on GPT Image and FLUX", () => {
    expect(plan.groups).toHaveLength(2 * 2 * 3);
    for (const e of ["gpt-image", "flux", "seedream"]) expect(count(e, "set")).toBe(2 * 2 * 3);
    expect(count("gpt-image", "look")).toBe(2 * 2 * 2);
    expect(count("flux", "look")).toBe(2 * 2 * 2);
    expect(count("seedream", "look")).toBe(0);
    expect(count("gpt-image", "control")).toBe(4);
    expect(count("seedream", "control")).toBe(0);
    for (const g of plan.groups) {
      expect(g.first.camera?.id).toBe(spec.cameras[0].id);
      expect(g.rest.map((r) => r.camera?.id)).toEqual(spec.cameras.slice(1, 3).map((c) => c.id));
      expect(g.withLook.every((r) => r.look === null && r.character.id === g.first.character.id)).toBe(true);
    }
    expect(new Set(all.map((r) => r.shotId)).size).toBe(all.length);
  });

  it("a look shot and its twin differ by the look alone: the same sketch, direction and character on every engine", () => {
    const key = (r: (typeof all)[number]) => `${r.setKey}|${r.camera?.id}|${r.character.id}`;
    const twins = new Map<string, Set<string>>();
    for (const r of all.filter((x) => x.arm !== "control")) twins.set(key(r), (twins.get(key(r)) ?? new Set()).add(r.direction));
    expect([...twins.values()].every((d) => d.size === 1)).toBe(true);
    // Directions rotate over (set, character, camera): shot k takes directions[k % n].
    expect([...twins.values()].map((d) => [...d][0]).slice(0, 5)).toEqual(["d0", "d1", "d2", "d3", "d0"]);
  });

  it("no look without an identity photo (the product's rule), and --no-look / --no-control drop their arms", () => {
    const noPhoto = planCShots({ sets: [framed("s1")], characters: [char("a", false)], directions: ["d"], engines: ["gpt-image"], look: true, control: true });
    expect(noPhoto.groups[0].withLook).toEqual([]);
    const bare = planCShots({ sets: [framed("s1")], characters: [char("a")], directions: ["d"], engines: ["gpt-image", "flux"], look: false, control: false });
    expect(bare.groups.every((g) => g.withLook.length === 0)).toBe(true);
    expect(bare.singles).toEqual([]);
  });
});

const row = (over: Partial<ShotRecord>): ShotRecord => ({
  type: "shot",
  part: "c",
  shotId: "x",
  arm: "set",
  engine: "gpt-image",
  setKey: "s1",
  cameraId: "c2",
  cameraHeightM: 1.6,
  characterId: "a",
  simulated: false,
  prompt: "",
  expectedPrompt: "",
  sentPrompt: null,
  promptParity: true,
  look: null,
  entryGate: "allowed",
  outcome: "rendered",
  reason: null,
  note: null,
  refsRefused: false,
  frameFile: null,
  resultFile: null,
  resultDims: { w: 1024, h: 1024 },
  identity: { score: 80, unusable: false, scorerVersion: "t" },
  identityDecision: "pass",
  engineCalls: 1,
  billedUsd: 0.17,
  costFlag: null,
  ...over,
});
const rated = (source: Record<string, string>, ...ratings: { score: number; objects?: number; younger?: boolean }[]): Combined => ({
  source: { ...source, kind: "c-composition" },
  raters: ratings.length,
  ratings: ratings.map((r, i) => ({ itemId: `i${i}`, raterId: `r${i + 1}`, source, score: r.score, ...(r.objects ? { extras: { objects: r.objects } } : {}), ...(r.younger ? { flags: ["younger"] } : {}) })),
});

describe("C's bars over real stills", () => {
  const set = Array.from({ length: 10 }, (_, i) => row({ shotId: `cs-${i}`, cameraId: `c${(i % 2) + 2}`, setKey: `s${i}`, identity: { score: 78, unusable: false, scorerVersion: "t" } }));
  const controls = Array.from({ length: 4 }, (_, i) => row({ shotId: `cc-${i}`, arm: "control", cameraId: null, cameraHeightM: null, identity: { score: 82, unusable: false, scorerVersion: "t" } }));
  const looks = set.slice(0, 4).map((s, i) => row({ ...s, shotId: `cl-${i}`, arm: "look", look: { fromShotId: "cs-first", sameCharacter: true, savedOutfit: false }, identity: { score: 74, unusable: false, scorerVersion: "t" } }));

  it("wires the rows into barC: identity against the control arm, the miss rate, output refusals and, from the sheet, composition", () => {
    const ratings = cRatingsOf([...set, ...looks].map((s) => rated({ shotId: s.shotId }, { score: 4, objects: s.arm === "look" ? 5 : undefined }, { score: 5, objects: s.arm === "look" ? 4 : undefined })));
    const { bars, reported } = cBars(cShotsOf([...set, ...controls, ...looks], ratings), { engines: ["gpt-image"], exported: null, blocked: new Set() });
    const bar = (id: string) => bars.find((b) => b.id === id);
    expect(bar("C-identity-gpt-image")).toMatchObject({ verdict: "PASS", value: "-4.0" });
    expect(bar("C-identity-gpt-image")?.arithmetic).toContain("the gpt-image control arm, 4 scored of 4 rendered");
    expect(bar("C-miss-gpt-image")?.verdict).toBe("PASS");
    expect(bar("C-composition-gpt-image")).toMatchObject({ verdict: "PASS", n: 10 });
    expect(bar("C-output-gpt-image")?.verdict).toBe("PASS");
    const look = reported.find((b) => b.id === "C-look-objects-gpt-image");
    expect(look).toMatchObject({ verdict: "REPORTED", value: "100.0%", n: 4 });
    const vs = reported.find((b) => b.id === "C-look-identity-gpt-image");
    expect(vs).toMatchObject({ value: "-4.0", n: 4 });
    expect(vs?.arithmetic).toContain("identity median 74.0 with the look vs 78.0 without");
  });

  it("baselines.json's scores stand for an engine when it has them; Seedream is held to GPT Image's", () => {
    const exported = { identity: [{ characterId: "a", engine: "gpt-image", scores: [90, 90, 60], source: "export", readOn: "2026-09-01" }], outputGateStrictLane: { renders: 100, refusals: 2 } };
    const sd = set.map((s) => ({ ...s, engine: "seedream" as const, shotId: `sd-${s.shotId}` }));
    const { bars } = cBars(cShotsOf([...set, ...sd]), { engines: ["gpt-image", "seedream"], exported, blocked: new Set(), composition: false });
    expect(bars.find((b) => b.id === "C-identity-gpt-image")).toMatchObject({ verdict: "FAIL", value: "-12.0" });
    expect(bars.find((b) => b.id === "C-identity-seedream")?.arithmetic).toContain("baselines.json, gpt-image (export, read 2026-09-01)");
    // One baseline score in three is under the threshold: a miss rate of 33.3%.
    expect(bars.find((b) => b.id === "C-miss-gpt-image")?.threshold).toBe("≤ 33.3% + 5 points");
    expect(bars.some((b) => b.id.startsWith("C-composition"))).toBe(false);
  });

  it("an engine with no still in hand is UNDETERMINED, and a BLOCKED arm never passes", () => {
    const { bars } = cBars(cShotsOf([...set, ...controls]), { engines: ["gpt-image", "flux"], exported: null, blocked: new Set(["gpt-image"]) });
    expect(bars.find((b) => b.id === "C-flux")?.verdict).toBe("UNDETERMINED");
    expect(bars.filter((b) => b.id.endsWith("-gpt-image")).every((b) => b.verdict !== "PASS")).toBe(true);
  });

  it("report reads every C run's rows and the sheets' extras and flags; a fal refusal of the references is BLOCKED", () => {
    const flux = row({ shotId: "cs-f", engine: "flux", outcome: "error", refsRefused: true, identity: { score: null, unusable: false, scorerVersion: null }, identityDecision: null });
    const combined = [rated({ shotId: "cs-0" }, { score: 4, younger: true }, { score: 2 })];
    const r = cFromRuns([{ rows: [...set, ...controls, flux] as unknown as Record<string, unknown>[], manifest: { baselines: null } }], combined);
    expect(r.blocked).toEqual(["flux"]);
    expect(r.bars.find((b) => b.id === "C-seedream")?.verdict).toBe("UNDETERMINED");
    expect(r.bars.filter((b) => b.id.endsWith("-flux")).every((b) => b.verdict !== "PASS")).toBe(true);
    expect(r.reported.find((b) => b.id === "C-heights-gpt-image")?.arithmetic).toContain('"looks younger" ticked on 1/1 rated');
    expect(cRatingsOf(combined).get("cs-0")).toEqual({ scores: [4, 2], objects: [], younger: 1 });
  });
});

describe("the probe's lines", () => {
  const seen = { hosts: new Set(["api.openai.com", "fal.run", "v3.fal.media"]), blocked: [], simulated: false };

  it("FLUX accepted or BLOCKED, Seedream's square at 1024 or not, the gates, the scorer and the hosts", () => {
    const ok = probeLines([row({ engine: "gpt-image" }), row({ engine: "flux" }), row({ engine: "seedream", promptParity: null })], seen);
    expect(ok.join("\n")).toMatch(/flux: data: references ACCEPTED/);
    expect(ok.join("\n")).toMatch(/seedream: image_size "square_hd" came back 1024×1024: square at 1024 ✓/);
    expect(ok.join("\n")).toMatch(/identity scorer answered on 3\/3 rendered/);
    expect(ok.join("\n")).toMatch(/only allowed hosts, nothing blocked/);
    const bad = probeLines(
      [row({ engine: "flux", outcome: "error", refsRefused: true, note: "fal.ai (Flux) error (422): x" }), row({ engine: "seedream", resultDims: { w: 1536, h: 1024 } })],
      { hosts: new Set(["api.openai.com", "example.com"]), blocked: [{ host: "db.supabase.co" }], simulated: false },
    );
    expect(bad.join("\n")).toMatch(/data: references REFUSED .* the FLUX arm is BLOCKED/);
    expect(bad.join("\n")).toMatch(/NOT 1024×1024/);
    expect(bad.join("\n")).toMatch(/NOT ONLY ALLOWED HOSTS \(example\.com, blocked db\.supabase\.co\)/);
    expect(probeLines([], { ...seen, simulated: true })[0]).toMatch(/SIMULATED/);
  });
});
