import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SET_COMPARE_PX } from "../../../src/lib/sets/set-config.ts";
import { bSheetItem, bSheetKind, drawsFromRun, partB, readRun } from "../parts/b.mts";
import { fixtureText } from "../parts/simulate.mts";
import { parseCli, type Flags } from "./cli.mts";
import { sha256 } from "./util.mts";

// B from an A photo run: each set's camera 1 drawn at its photo's shape and
// laid beside the photo the A run sent, on a sheet report reads as the
// photo arm's. The A runs here are synthetic directories; nothing renders.

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "astra-bphotos-"));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

type Shot = { id: string; width: number; height: number };

/** An A run on disk: one delivered set per photo (or per brief, for a words run), each photo kept in photos/. */
function aRun(name: string, o: { photos: boolean; shots: Shot[] }): string {
  const run = join(dir, name);
  mkdirSync(join(run, "specs"), { recursive: true });
  mkdirSync(join(run, "photos"), { recursive: true });
  const photoFiles: Record<string, unknown> = {};
  const rows = o.shots.map((s) => {
    const buildId = `al-${s.id}-r1`;
    writeFileSync(join(run, `specs/${buildId}.json`), fixtureText("showroom-closed"));
    if (o.photos) {
      const bytes = Buffer.from(`the re-encoded bytes of ${s.id}`);
      writeFileSync(join(run, `photos/${s.id}.jpg`), bytes);
      photoFiles[s.id] = { sha256: sha256(bytes), width: s.width, height: s.height, file: `photos/${s.id}.jpg` };
    }
    return { type: "build", buildId, builder: "astra-low", run: 1, briefId: s.id, status: "delivered", specFile: `specs/${buildId}.json` };
  });
  writeFileSync(join(run, "manifest.json"), JSON.stringify({ part: "a", photos: o.photos, complete: true, simulated: false, ...(o.photos ? { photoFiles } : {}) }));
  writeFileSync(join(run, "results.jsonl"), rows.map((r) => JSON.stringify(r)).join("\n") + "\n");
  return run;
}

function metaOf(d: ReturnType<typeof drawsFromRun>, key: string) {
  const m = d.meta.get(key);
  if (!m) throw new Error(`nothing drawn for ${key}`);
  return m;
}

const flagsFor = (argv: string[]): Flags => {
  const p = parseCli(["b", dir, ...argv]);
  if (!p.ok || p.cli.cmd !== "part") throw new Error(p.ok ? "cli" : p.error);
  return p.cli.flags;
};

describe("B from an A photo run", () => {
  const shots = [
    { id: "ph-int-01", width: 1536, height: 1024 },
    { id: "ph-ext-01", width: 1024, height: 1536 },
  ];

  it("draws camera 1 at each photo's own shape (width / height), long side SET_COMPARE_PX", () => {
    const run = aRun("a-photo", { photos: true, shots });
    const drawn = drawsFromRun(run, readRun(run), { photos: true, briefs: new Map() });
    expect(drawn.jobs.map((j) => [j.key, j.poses[0].aspect, j.poses[0].px, j.poses[0].figure])).toEqual([
      ["al-ph-int-01-r1", 1.5, SET_COMPARE_PX, false],
      ["al-ph-ext-01-r1", 1024 / 1536, SET_COMPARE_PX, false],
    ]);
    expect(metaOf(drawn, "al-ph-ext-01-r1")).toEqual({ builder: "astra-low", run: 1, briefId: "ph-ext-01", photo: join(run, "photos/ph-ext-01.jpg") });
  });

  it("lays the photo first and camera 1 beside it, on the photo arm's sheet", () => {
    const run = aRun("a-photo", { photos: true, shots });
    const drawn = drawsFromRun(run, readRun(run), { photos: true, briefs: new Map() });
    const item = bSheetItem("al-ph-int-01-r1", metaOf(drawn, "al-ph-int-01-r1"), "/frames/al-ph-int-01-r1-c1.jpg");
    expect(item.images).toEqual([
      { role: "photo", path: join(run, "photos/ph-int-01.jpg") },
      { role: "snapshot", path: "/frames/al-ph-int-01-r1-c1.jpg" },
    ]);
    expect(item.text).toBeUndefined();
    expect(bSheetKind(true)).toBe("b-photo");
    expect(bSheetKind(false)).toBe("b-fidelity");
  });

  it("rates a set only beside the bytes the A run sent: a photo changed or gone stops B", () => {
    const run = aRun("a-photo", { photos: true, shots });
    writeFileSync(join(run, "photos/ph-ext-01.jpg"), "another picture");
    expect(() => drawsFromRun(run, readRun(run), { photos: true, briefs: new Map() })).toThrow(/is not the photo the A run sent/);
    rmSync(join(run, "photos/ph-ext-01.jpg"));
    expect(() => drawsFromRun(run, readRun(run), { photos: true, briefs: new Map() })).toThrow(/is not the photo the A run sent/);
    const words = aRun("a-words", { photos: false, shots });
    expect(() => drawsFromRun(words, readRun(words), { photos: true, briefs: new Map() })).toThrow(/kept no photo for ph-int-01/);
  });

  it("a words run's sets are drawn from their first camera with the brief, as before", () => {
    const run = aRun("a-words", { photos: false, shots: [{ id: "int-01", width: 0, height: 0 }] });
    const drawn = drawsFromRun(run, readRun(run), { photos: false, briefs: new Map([["int-01", "a quiet showroom"]]) });
    expect(drawn.jobs[0].poses[0].aspect).toBeUndefined();
    expect(bSheetItem("al-int-01-r1", metaOf(drawn, "al-int-01-r1"), "/s.jpg")).toMatchObject({ text: "a quiet showroom", images: [{ role: "snapshot", path: "/s.jpg" }] });
  });
});

describe("partB.resolveFlags", () => {
  it("follows its A run's arm, and refuses --photos against a words run", () => {
    const photoRun = aRun("a-photo", { photos: true, shots: [{ id: "ph-1", width: 1536, height: 1024 }] });
    const wordsRun = aRun("a-words", { photos: false, shots: [{ id: "int-01", width: 0, height: 0 }] });
    const resolve = partB.resolveFlags as (f: Flags) => Flags;
    expect(resolve(flagsFor(["--from-run", photoRun])).photos).toBe(true);
    expect(resolve(flagsFor(["--from-run", wordsRun])).photos).toBe(false);
    expect(() => resolve(flagsFor(["--from-run", wordsRun, "--photos"]))).toThrow(/is a words run; its sets have no photo/);
    // No A run: a dry run keeps its own --photos.
    expect(resolve(flagsFor(["--photos"])).photos).toBe(true);
  });
});
