import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { VEHICLE_SENTENCE, VEHICLE_SENTENCE_END, describeVehicle, findVehicles, vehicleWords, type Vehicle } from "./vehicles";
import { normaliseSetSpec, type SetObject, type SetSpec } from "./set-spec";
import { kitObjects } from "./kit";
import { buildSetShotPrompt, stripSetShotScaffold } from "./set-shot-prompt";

// Which way a set's vehicles face (2026-09-21, "the vehicle still does not
// know which is the front and the back"), read from the sets Astra built.

const fixture = (name: string): SetSpec => {
  const r = normaliseSetSpec(JSON.parse(readFileSync(join(__dirname, `fixtures-${name}.json`), "utf8")));
  if (!r.ok) throw new Error(name);
  return r.spec;
};

/** The whole set turned about the origin by `deg` around +Y (+Z toward +X), as a yaw of the world. */
const yawed = (spec: SetSpec, deg: number): SetSpec => {
  const a = (deg * Math.PI) / 180;
  const turn = (x: number, z: number): [number, number] => [x * Math.cos(a) + z * Math.sin(a), -x * Math.sin(a) + z * Math.cos(a)];
  return {
    ...spec,
    objects: spec.objects.map((o): SetObject => {
      const [x, z] = turn(o.position[0], o.position[2]);
      const off = o.repeat ? turn(o.repeat.offset[0], o.repeat.offset[2]) : null;
      return {
        ...o,
        position: [x, o.position[1], z],
        rotation: [o.rotation[0], o.rotation[1] + deg, o.rotation[2]],
        repeat: o.repeat && off ? { ...o.repeat, offset: [off[0], o.repeat.offset[1], off[1]] } : null,
      };
    }),
  };
};

describe("finding the vehicles and their fronts", () => {
  it("reads every car Astra built — front at its white headlights, back at its tail lights or wing", () => {
    const race = findVehicles(fixture("race-track"));
    expect(race).toHaveLength(1);
    expect(race[0]).toMatchObject({ label: "car", frontDeg: 0, cues: { headlights: true, tailLights: true, wing: true } });
    for (const name of ["showroom-open", "showroom-closed"]) {
      const cars = findVehicles(fixture(name));
      expect(cars, name).toHaveLength(1);
      // No wing on a showroom car: its sloped rear glass and its tail-light bar are not one.
      expect(cars[0], name).toMatchObject({ label: "car", frontDeg: 0, cues: { headlights: true, tailLights: true, wing: false } });
    }
  });

  it("reads the Kit's car at any facing — its blocks are near-symmetric, its lamps are not", () => {
    for (const facing of [0, 45, 120, 200, 315]) {
      const [car, ...rest] = findVehicles({ objects: kitObjects("car", [3, -2], facing) });
      expect(rest, String(facing)).toEqual([]);
      expect(car, String(facing)).toMatchObject({ label: "car", cues: { headlights: true, tailLights: true, wing: false } });
      expect(car.frontDeg, String(facing)).toBeCloseTo(facing, 0);
      expect(car.x).toBeCloseTo(3, 1);
      expect(car.z).toBeCloseTo(-2, 1);
    }
  });

  it("finds nothing where there is no vehicle — a lone log is not one, nor are hubcaps", () => {
    expect(findVehicles(fixture("beach"))).toEqual([]);
    expect(findVehicles(fixture("rainy-market"))).toEqual([]);
  });

  it("turns with the set: a car yawed a quarter turn faces a quarter turn round", () => {
    for (const deg of [90, 180, 270, 35]) {
      const [car] = findVehicles(yawed(fixture("race-track"), deg));
      expect(car, String(deg)).toBeDefined();
      expect(car.frontDeg, String(deg)).toBeCloseTo(deg % 360, 0);
    }
  });

  it("says nothing when the lamps and the wing disagree, or when nothing marks either end", () => {
    const race = fixture("race-track");
    // The wing moved over the headlights: the two readings now disagree.
    const argued = { ...race, objects: race.objects.map((o) => (o.size[0] > 2 && o.size[1] <= 0.2 && o.position[1] > 1.3 ? { ...o, position: [o.position[0], o.position[1], 1.99] as [number, number, number] } : o)) };
    expect(findVehicles(argued)).toEqual([]);
    // No lamps and no wing: a front cannot be read.
    const bare = { ...race, objects: race.objects.filter((o) => !o.emissive && !(o.size[0] > 2 && o.size[1] <= 0.2 && o.position[1] > 1.3)) };
    expect(findVehicles(bare)).toEqual([]);
  });
});

describe("saying it in the camera's terms", () => {
  const car: Vehicle = { label: "car", x: 0, z: 0, frontDeg: 0, halfLength: 2, cues: { headlights: true, tailLights: true, wing: false } };
  const at = (x: number, z: number) => describeVehicle(car, { position: [x, 1.5, z], target: [0, 0.8, 0], fovDeg: 40 });

  it("names head-on, tail-on, side-on and the quarters, and which side of the frame the front points to", () => {
    expect(at(0, 8)).toBe("faces the camera head-on: we see its front");
    expect(at(0, -8)).toBe("faces straight away from the camera: we see its back");
    // From +X looking back at the car, its front (+Z) is to frame left.
    expect(at(8, 0)).toBe("is side-on to the camera, its front pointing to frame left");
    expect(at(-8, 0)).toBe("is side-on to the camera, its front pointing to frame right");
    expect(at(6, 6)).toBe("is turned three-quarters toward the camera, its front toward frame left");
    // From behind and to its left, looking forward past it: the nose points to frame right.
    expect(at(-6, -6)).toBe("is turned three-quarters away from the camera, its front toward frame right");
  });

  it("speaks only of the vehicles in the frame, the nearest two", () => {
    const race = fixture("race-track");
    const cam = race.cameras[0];
    expect(vehicleWords(race, cam)).toHaveLength(1);
    // Turned right round, the car is behind the camera: nothing is said.
    const behind = { ...cam, target: [2 * cam.position[0] - cam.target[0], cam.target[1], 2 * cam.position[2] - cam.target[2]] as [number, number, number] };
    expect(vehicleWords(race, behind)).toEqual([]);
    expect(vehicleWords(race, null)).toEqual([]);
  });

  it("writes only sentences the strip knows, all round the car, and the strip never takes the person's words", () => {
    const race = fixture("race-track");
    let n = 0;
    for (let deg = 0; deg < 360; deg += 15) {
      const a = (deg * Math.PI) / 180;
      const cam = { position: [9 * Math.sin(a), 2, 9 * Math.cos(a)] as [number, number, number], target: [0, 0.8, 0] as [number, number, number], fovDeg: 40 };
      for (const s of vehicleWords(race, cam)) {
        n++;
        expect(s.endsWith(VEHICLE_SENTENCE_END)).toBe(true);
        expect(s.replace(VEHICLE_SENTENCE, "").trim(), s).toBe("");
        const prompt = buildSetShotPrompt({ description: "A circuit.", direction: "she leans on the car", vehicles: [s] });
        expect(prompt).toContain(s);
        expect(stripSetShotScaffold(prompt)).toBe("A circuit. In this frame: she leans on the car.");
      }
    }
    expect(n).toBeGreaterThan(20);
    // A person's own sentence that merely opens the same way stays.
    expect(stripSetShotScaffold(buildSetShotPrompt({ description: "d", direction: "The car in the sketch is mine." }))).toBe("d In this frame: The car in the sketch is mine.");
  });

  it("rides the shot right after the sketch's own sentences, before the place is described", () => {
    const [s] = vehicleWords(fixture("race-track"), fixture("race-track").cameras[0]);
    const prompt = buildSetShotPrompt({ description: "A circuit at dusk.", direction: "", vehicles: [s] });
    expect(prompt.indexOf("rough stand-in")).toBeLessThan(prompt.indexOf(s));
    expect(prompt.indexOf(s)).toBeLessThan(prompt.indexOf("A circuit at dusk."));
  });

  it("is worked out on the server for every still, against the set and the shot's own camera", () => {
    const actions = readFileSync(join(__dirname, "actions.ts"), "utf8");
    expect(actions).toContain("vehicles: vehicleWords(owned.spec, layout?.camera),");
  });
});
