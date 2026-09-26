import { describe, expect, it } from "vitest";
import { azimuthOf, bladesWords, hourFromAzimuth, measureMetres, normaliseRack, rackWords, scaleBar, sunDirection, thingWords } from "./furniture";
import { sunAt } from "./time-of-day";
import { normaliseSetSpec } from "./set-spec";
import showroomOpen from "./fixtures-showroom-open.json";

// The viewport's furniture (board J1, cut C): the sun's direction and the
// hour a dragged sun lands on, the scale bar, the measure tool, the iris's
// blades and a beat's rack of focus.

describe("the sun", () => {
  it("points where sunAt says, east at sunrise and west at sunset", () => {
    const [x, y, z] = sunDirection(6);
    expect(x).toBeGreaterThan(0.9);
    expect(y).toBeGreaterThan(0);
    expect(Math.abs(z)).toBeLessThan(0.1);
    const [wx] = sunDirection(18);
    expect(wx).toBeLessThan(-0.9);
    expect(Math.hypot(...sunDirection(12))).toBeCloseTo(1, 6);
  });

  it("lands a dragged sun on the hour of its azimuth, to the quarter hour, and never past the day", () => {
    expect(hourFromAzimuth(90)).toBe(6);
    expect(hourFromAzimuth(180)).toBe(12);
    expect(hourFromAzimuth(270)).toBe(18);
    expect(hourFromAzimuth(135)).toBe(9);
    expect(hourFromAzimuth(140)).toBe(9.25);
    expect(hourFromAzimuth(40)).toBe(6);
    expect(hourFromAzimuth(300)).toBe(18);
    expect(hourFromAzimuth(-90)).toBe(18);
    // Round trip through sunAt for every daylight quarter hour.
    for (let h = 6; h <= 18; h += 0.25) {
      const [x, , z] = sunDirection(h);
      expect(hourFromAzimuth(azimuthOf(x, z))).toBeCloseTo(h, 6);
    }
    expect(azimuthOf(1, 0)).toBe(90);
    expect(azimuthOf(0, -1)).toBe(180);
    // A quarter hour is 3.75° of azimuth: the sun lands within that of where it was dropped.
    expect(Math.abs(sunAt(hourFromAzimuth(200)).azimuthDeg - 200)).toBeLessThan(3.75);
  });
});

describe("the scale and the measure", () => {
  it("picks a round length that fits the bar", () => {
    expect(scaleBar(100)).toEqual({ metres: 1, px: 100 });
    expect(scaleBar(20)).toEqual({ metres: 5, px: 100 });
    expect(scaleBar(400)).toEqual({ metres: 0.25, px: 100 });
    expect(scaleBar(3)).toEqual({ metres: 20, px: 60 });
    expect(scaleBar(0)).toEqual({ metres: 1, px: 0 });
    expect(scaleBar(0.1)).toEqual({ metres: 100, px: 10 });
  });

  it("measures along the ground to the centimetre", () => {
    expect(measureMetres({ x: 0, z: 0 }, { x: 3, z: 4 })).toBe(5);
    expect(measureMetres({ x: 1, z: 1 }, { x: 1, z: 1 })).toBe(0);
    expect(measureMetres({ x: 0, z: 0 }, { x: 1.234, z: 0 })).toBe(1.23);
  });
});

describe("the blades and the rack", () => {
  const spec = (() => {
    const r = normaliseSetSpec(showroomOpen);
    if (!r.ok) throw new Error("fixture");
    return r.spec;
  })();

  it("say nothing without blades, and shape the blur's highlights with them", () => {
    expect(bladesWords(null)).toBe("");
    expect(bladesWords(5)).toContain("5 blades");
    expect(bladesWords(5)).toContain("five-sided");
    expect(bladesWords(9)).toContain("round");
    expect(bladesWords(11)).toContain("perfectly round");
  });

  it("read a rack off stored data only when it points at something the set has", () => {
    expect(normaliseRack(null, 3)).toBeNull();
    expect(normaliseRack({ to: "figure" }, 3)).toEqual({ to: "figure" });
    expect(normaliseRack({ to: "object", index: 2 }, 3)).toEqual({ to: "object", index: 2 });
    expect(normaliseRack({ to: "object", index: 3 }, 3)).toBeNull();
    expect(normaliseRack({ to: "object", index: 1.5 }, 3)).toBeNull();
    expect(normaliseRack({ to: "car" }, 3)).toBeNull();
  });

  // Helios Cut 4, step A9: the thing's key rides beside the block number (object-ref.ts).
  it("keeps a thing's key beside the block, and a rack stored without one loads byte for byte", () => {
    const key = "o_0a1b2c3d_12_-40";
    expect(normaliseRack({ to: "object", index: 2, key }, 3)).toEqual({ to: "object", index: 2, key });
    expect(JSON.stringify(normaliseRack({ to: "object", index: 2 }, 3))).toBe('{"to":"object","index":2}');
    expect(JSON.stringify(normaliseRack({ to: "object", index: 2, key: "the car" }, 3))).toBe('{"to":"object","index":2}');
    expect(normaliseRack({ to: "object", index: 3, key }, 3)).toBeNull();
    expect(rackWords({ to: "object", index: 0, key }, spec)).toBe(rackWords({ to: "object", index: 0 }, spec));
  });

  it("names the thing by its shape and size, and says which way the focus travels", () => {
    const o = spec.objects[0];
    expect(thingWords(o)).toMatch(/^the [a-z]+ [\d.]+ × [\d.]+ × [\d.]+ m$/);
    expect(rackWords(null, spec)).toBe("");
    expect(rackWords({ to: "figure" }, spec)).toContain("racks back onto the person");
    expect(rackWords({ to: "object", index: 0 }, spec)).toContain(`from the person to ${thingWords(o)}`);
    expect(rackWords({ to: "object", index: 999 }, spec)).toBe("");
  });
});
