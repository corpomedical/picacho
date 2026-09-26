import { describe, expect, it } from "vitest";
import { DEFAULT_WHEEL_STYLE, WHEEL_STYLES, WHEEL_STYLE_LABELS, parseWheelStyle, usageFraction, wheelGeometry } from "./wheel-style";

describe("the lamp's wheel", () => {
  it("defaults to Filament, the one picked first", () => {
    expect(DEFAULT_WHEEL_STYLE).toBe("filament");
    expect(WHEEL_STYLE_LABELS.filament.name).toBe("Filament");
  });

  it("offers exactly the two he asked for, each with a name and a line", () => {
    expect([...WHEEL_STYLES]).toEqual(["filament", "blossom"]);
    for (const style of WHEEL_STYLES) {
      expect(WHEEL_STYLE_LABELS[style].name.length).toBeGreaterThan(0);
      expect(WHEEL_STYLE_LABELS[style].line.length).toBeGreaterThan(0);
    }
  });

  it("reads a stored style, and anything else (no column yet, NULL, an unknown one) as the default", () => {
    expect(parseWheelStyle("blossom")).toBe("blossom");
    expect(parseWheelStyle("filament")).toBe("filament");
    expect(parseWheelStyle(undefined)).toBe("filament");
    expect(parseWheelStyle(null)).toBe("filament");
    expect(parseWheelStyle("orbit")).toBe("filament");
    expect(parseWheelStyle(3)).toBe("filament");
  });

  it("reaches far enough for the top control's name, a little less on a phone", () => {
    const desk = wheelGeometry("filament", false);
    const phone = wheelGeometry("filament", true);
    // The top control sits a radius above the lamp; half of it and its name are above that.
    expect(desk.reach).toBeGreaterThanOrEqual(desk.radius + 21 + 18);
    expect(phone.reach).toBeLessThan(desk.reach);
    const bloom = wheelGeometry("blossom", false);
    expect(bloom.reach).toBeGreaterThan(bloom.radius);
    expect(wheelGeometry("blossom", true).reach).toBeLessThan(bloom.reach);
  });

  it("fills with the month's use, and reads a missing allowance as spent", () => {
    expect(usageFraction(0, 2500)).toBe(0);
    expect(usageFraction(1250, 2500)).toBe(0.5);
    expect(usageFraction(3000, 2500)).toBe(1);
    expect(usageFraction(-5, 2500)).toBe(0);
    expect(usageFraction(10, 0)).toBe(1);
  });
});
