import { describe, expect, it } from "vitest";
import { develop, labLine, negativePathFor, normaliseLabLooks } from "./lab";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { isReferenced } from "../../../scripts/lib/storage-references.mjs";

// The lab's darkroom: one door for what a request names, the negative's
// place beside its still, and a develop that returns the print and the frame
// as it came.

type SharpFn = (typeof import("sharp"))["default"];
let sharp: SharpFn | null = null;
try {
  sharp = (await import("sharp")).default;
} catch {
  sharp = null;
}

describe("normaliseLabLooks", () => {
  it("lets through only the lab's own looks", () => {
    expect(normaliseLabLooks({ stock: "film16" })).toEqual({ stock: "film16", lens: null, silver: false });
    expect(normaliseLabLooks({ lens: "anamorphic", silver: true })).toEqual({ stock: null, lens: "anamorphic", silver: true });
    expect(normaliseLabLooks({ stock: "film35", lens: "halation", silver: true })).toEqual({ stock: "film35", lens: "halation", silver: true });
  });

  it("is nothing for junk, unknown ids, or looks the lab leaves alone", () => {
    for (const junk of [null, undefined, "film16", 7, [], {}, { stock: "70mm" }, { lens: "fisheye" }, { silver: "yes" }, { stock: "digital", lens: "clean" }]) {
      expect(normaliseLabLooks(junk)).toBeNull();
    }
  });
});

describe("negativePathFor", () => {
  it("keeps a still's negative beside it, in the owner's own folder", () => {
    expect(negativePathFor("u1/0c797549-d63c-49d6-a1b8-de896bcec023.png")).toBe("u1/negatives/0c797549-d63c-49d6-a1b8-de896bcec023.jpg");
  });

  it("has no negative for anything but a still at the top of its owner's folder", () => {
    for (const p of ["u1/sets/s.look-x.jpg", "u1/negatives/x.jpg", "u1/x.jpg", "x.png", "u1/a/b.png", ""]) expect(negativePathFor(p)).toBeNull();
  });
});

describe("labLine", () => {
  it("says what the lab made in plain words", () => {
    expect(labLine({ stock: "film16", lens: "vintage", silver: true })).toBe("Developed in the lab after the cut: 16 mm film, a vintage lens, black and white.");
  });
});

describe.skipIf(!sharp)("develop", () => {
  it("returns the developed print at the still's size, and the negative as the frame came in", async () => {
    const still = await sharp!({ create: { width: 48, height: 20, channels: 3, background: { r: 200, g: 40, b: 30 } } }).png().toBuffer();
    const { print, negative } = await develop(still.toString("base64"), { stock: null, lens: null, silver: true });
    const printed = await sharp!(Buffer.from(print, "base64")).raw().toBuffer({ resolveWithObject: true });
    expect([printed.info.format, printed.info.width, printed.info.height]).toEqual(["raw", 48, 20]);
    const [r, g, b] = printed.data;
    expect(Math.abs(r - g)).toBeLessThanOrEqual(3);
    expect(Math.abs(b - g)).toBeLessThanOrEqual(3);
    // The negative is still the red frame: the scorer and the look read it, not the print.
    const meta = await sharp!(negative).metadata();
    expect([meta.format, meta.width, meta.height]).toEqual(["jpeg", 48, 20]);
    const neg = await sharp!(negative).raw().toBuffer();
    expect(neg[0]).toBeGreaterThan(170);
    expect(neg[1]).toBeLessThan(80);
  });
});

// A negative lives and dies with its still (2026-09-16): the storage audit
// counts it as the still's, and every place a still's file is removed takes
// the negative with it — or it would sit in the bucket, unreferenced.
describe("a negative, kept and cleared with its still", () => {
  const still = "u1/0c797549-d63c-49d6-a1b8-de896bcec023.png";

  it("is referenced exactly when its still is, by the audit's own rule", () => {
    const negative = negativePathFor(still)!;
    expect(isReferenced(new Set([still]), negative)).toBe(true);
    expect(isReferenced(new Set(["u1/another.png"]), negative)).toBe(false);
    expect(isReferenced(new Set([still]), "u1/negatives/another.jpg")).toBe(false);
  });

  it("goes with its still when the likeness gate throws a render away, and when a still is deleted", () => {
    const actions = readFileSync(join(__dirname, "..", "generations", "actions.ts"), "utf8");
    expect(actions).toContain("const loserNegative = negativePathFor(loserPath);");
    expect(actions).toContain(".remove(loserNegative ? [loserPath, loserNegative] : [loserPath]);");
    expect(actions).toContain("const negativePaths = imagePaths.map(negativePathFor).filter((p): p is string => Boolean(p));");
    expect(actions).toContain('await supabase.storage.from("generated-images").remove([...imagePaths, ...negativePaths]);');
  });
});

describe("what the rig check reads", () => {
  it("is the negative, as the look cutout reads it", () => {
    // A still the lab developed is judged on the frame the image model drew,
    // not on the print the lab made of it: Silver Print turns the print
    // black and white, and every era's colour block would read "missed",
    // with a pushed reshoot that cannot land (2026-09-17).
    const actions = readFileSync(join(__dirname, "rig-actions.ts"), "utf8");
    expect(actions).toContain("const negative = negativePathFor(path);");
    expect(actions.indexOf("download(negative)")).toBeLessThan(actions.indexOf("download(path)"));
    // And the print is still read when there is no negative (a still shot before the lab).
    expect(actions).toContain("if (!blob) {");
  });
});
