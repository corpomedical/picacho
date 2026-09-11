import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { compareCrop, compareOutputSize, widenFovDeg } from "../../../src/lib/sets/compare.ts";
import { SET_COMPARE_PX } from "../../../src/lib/sets/set-config.ts";
import { REPO_ROOT } from "../lib/util.mts";
import { comparePose } from "./render-sets.mts";
import { stageFiles } from "./stage.mts";
import { checkViewerParity, MIRRORED_LINES, MIRRORED_PHOTO_LINES } from "./viewer-parity.mts";

// B's photo arm draws camera 1 at a photo's shape with the product's own
// compare.ts, served to the snapshot page type-stripped. Nothing here opens
// Chrome: the served module is imported from a temporary file.

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "astra-stage-"));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe("the snapshot page's compare.js", () => {
  it("is the product's compare.ts, type-stripped, and computes what it computes", async () => {
    const served = stageFiles(REPO_ROOT).get("/compare.js");
    expect(served?.type).toBe("text/javascript");
    const file = join(dir, "compare.mjs");
    writeFileSync(file, String(served?.body));
    const js = (await import(pathToFileURL(file).href)) as { compareCrop: typeof compareCrop; widenFovDeg: typeof widenFovDeg; compareOutputSize: typeof compareOutputSize };
    for (const aspect of [1.5, 0.75, 1, 2.4]) expect(js.compareCrop(1024, 1024, aspect)).toEqual(compareCrop(1024, 1024, aspect));
    expect(js.widenFovDeg(45, 1.5)).toBe(widenFovDeg(45, 1.5));
    expect(js.compareOutputSize(1024, 1024 / 1.5, 1024)).toEqual(compareOutputSize(1024, 1024 / 1.5, 1024));
  });

  it("the page imports it and draws a pose's aspect with it", () => {
    const html = readFileSync(join(REPO_ROOT, "scripts/astra-sets-eval/render/snap-page.html"), "utf8");
    expect(html).toContain('import { compareCrop, compareOutputSize, widenFovDeg } from "./compare.js";');
    expect(html).toContain("cam.fov = crop ? widenFovDeg(pose.fovDeg, crop.fovScale) : pose.fovDeg;");
  });

  it("a compare pose is the card pose at the photo's shape, long side SET_COMPARE_PX", () => {
    const spec = { cameras: [{ id: "c1", label: "", position: [0, 1.6, 6], target: [0, 1.4, 0], fovDeg: 40 }] } as unknown as Parameters<typeof comparePose>[0];
    expect(comparePose(spec, 1.5)).toEqual({ poseId: "c1", position: [0, 1.6, 6], target: [0, 1.4, 0], fovDeg: 40, figure: false, aspect: 1.5, px: SET_COMPARE_PX });
  });
});

describe("the mirror check", () => {
  const repo = (lines: readonly string[]) => {
    mkdirSync(join(dir, "src/components/sets"), { recursive: true });
    writeFileSync(join(dir, "src/components/sets/set-view.tsx"), lines.map((l) => `    ${l}`).join("\n"));
    return dir;
  };

  it("asks for the photo lines only when a photo arm is drawn", () => {
    const wordsOnly = repo(MIRRORED_LINES);
    expect(checkViewerParity(wordsOnly).ok).toBe(true);
    const photo = checkViewerParity(wordsOnly, { photo: true });
    expect(photo.ok).toBe(false);
    expect(photo.missing).toEqual([...MIRRORED_PHOTO_LINES]);
    expect(checkViewerParity(repo([...MIRRORED_LINES, ...MIRRORED_PHOTO_LINES]), { photo: true }).ok).toBe(true);
  });
});
