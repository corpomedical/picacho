import { describe, expect, it } from "vitest";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { MAX_ATTEMPTS_PER_STILL, parseStills } from "./campaign-machine";
import { parseAssembly, parseRenditions, RENDITION_KINDS } from "./cut-state";
import { MAX_MOMENTS, MAX_TAKES_PER_SHOT, parseShots } from "./shots";

// press_campaigns bounds its jsonb columns with CHECKs on the text form
// (press-tour-03-campaigns.sql, press-tour-03b-film.sql). The machine writes
// those columns every step, and a write the CHECK refuses is not an error
// anyone sees: the step answers "unavailable" and the cron tries the same
// step again every minute until the ad is closed as late. So each bound must
// sit above the most its parser can ever hand back, with every string at the
// parser's own maximum and every list at its cap. (Integration, 2026-09-26:
// a 30 s ad with every shot filmed five times came to about 58 KB against
// 03b's first 32 KB bound.)

const repo = join(__dirname, "..", "..", "..");
const root = join(repo, "supabase");

function sqlFile(name: string): string {
  const found = [join(root, "pending", name), ...readdirSync(join(root, "applied")).map((d) => join(root, "applied", d, name))].find((p) => existsSync(p));
  if (!found) throw new Error(`${name} not found`);
  return readFileSync(found, "utf8");
}

/** The bound in force after 03 then 03b: the last CHECK written for the column, in run order. */
function boundOf(column: string): number {
  let bound: number | null = null;
  const re = new RegExp(`octet_length\\(${column}::text\\) <= (\\d+)`, "g");
  for (const sql of [sqlFile("press-tour-03-campaigns.sql"), sqlFile("press-tour-03b-film.sql")]) {
    for (const m of sql.matchAll(re)) bound = Number(m[1]);
  }
  if (bound === null) throw new Error(`no size bound for ${column}`);
  return bound;
}

/** Postgres prints jsonb as text with a space after every colon and comma; this over-counts, never under. */
function pgTextBytes(value: unknown): number {
  const json = JSON.stringify(value);
  return Buffer.byteLength(json) + (json.match(/[:,]/g) ?? []).length;
}

/** Longer than any parser keeps, so the parser's own cut decides the length. */
const long = (n: number) => "x".repeat(n + 100);
const uuid = (i: number) => `11111111-1111-4111-8111-${String(i).padStart(12, "0")}`;
const SHOTS_PER_AD = 6; // a 30 s ad (quote.ts: 5 s a shot)

describe("press_campaigns size bounds hold everything the machine can write", () => {
  it("shots: 6 shots, each at MAX_TAKES_PER_SHOT takes of MAX_MOMENTS moments, every string at its maximum", () => {
    let k = 0;
    const raw = Array.from({ length: SHOTS_PER_AD }, (_, s) => ({
      shot: s + 1,
      chosen: 1,
      decision: "refilming",
      takes: Array.from({ length: MAX_TAKES_PER_SHOT + 2 }, (_, t) => ({
        n: t + 1,
        rowId: uuid(k++),
        kind: "refilm",
        status: "checked",
        credits: 2,
        job: { requestId: long(200), statusUrl: "https://" + long(600), responseUrl: "https://" + long(600), cancelUrl: "https://" + long(600), label: long(80) },
        submittedAt: long(40),
        video: long(1200),
        seconds: 5.041666666666667,
        face: "didnt_match",
        product: "product_missing",
        reason: long(200),
        moments: Array.from({ length: MAX_MOMENTS + 2 }, (_, m) => ({
          atSeconds: 12.345678 + m,
          face: "didnt_match",
          product: "didnt_match",
          reason: long(200),
          detail: { read: long(80), expected: long(80), label: "didnt_match", logo: "not_readable", shape: "didnt_match", colour: "not_readable" },
        })),
        escalations: 2,
        corner: "right",
        note: long(200),
        at: long(40),
        doneAt: long(40),
        error: long(300),
        cause: "provider",
      })),
    }));
    const parsed = parseShots(raw, SHOTS_PER_AD);
    expect(parsed.every((s) => s.takes.length === MAX_TAKES_PER_SHOT)).toBe(true);
    expect(pgTextBytes(parsed)).toBeLessThanOrEqual(boundOf("shots"));
  });

  it("stills: 6 stills at MAX_ATTEMPTS_PER_STILL attempts, every string at its maximum", () => {
    let k = 0;
    const raw = Array.from({ length: SHOTS_PER_AD }, (_, s) => ({
      shot: s + 1,
      keep: 1,
      decision: "approved",
      attempts: Array.from({ length: MAX_ATTEMPTS_PER_STILL + 2 }, (_, a) => ({
        n: a + 1,
        rowId: uuid(k++),
        kind: "repaint",
        status: "painted",
        credits: 1,
        path: long(512),
        face: "didnt_match",
        product: "product_missing",
        reason: long(300),
        fits: true,
        faceScore: 0.12345678901234567,
        escalations: 2,
        note: long(200),
        at: long(40),
        doneAt: long(40),
        error: long(300),
      })),
    }));
    const parsed = parseStills(raw, SHOTS_PER_AD);
    expect(parsed.every((s) => s.attempts.length === MAX_ATTEMPTS_PER_STILL)).toBe(true);
    expect(pgTextBytes(parsed)).toBeLessThanOrEqual(boundOf("stills"));
  });

  it("assembly: every segment the parser keeps, every path at its maximum", () => {
    const parsed = parseAssembly({
      locale: "pt",
      captions: true,
      segments: Array.from({ length: 20 }, (_, i) => ({ shot: i + 1, take: 5, rowId: long(64), clean: long(512), tagged: long(512), seconds: 5.041666666666667 })),
      endCard: long(512),
      endCardDone: true,
      failures: 99,
      parked: true,
      lastError: long(400),
      cleaned: true,
    });
    expect(parsed.segments.length).toBeGreaterThan(SHOTS_PER_AD);
    expect(pgTextBytes(parsed)).toBeLessThanOrEqual(boundOf("assembly"));
  });

  it("renditions: both files, every string at its maximum", () => {
    const one = { path: long(512), sha256: "a".repeat(64), seconds: 31.5, bytes: 123456789, signed: true, signedAt: long(40), reason: long(300), settled: true };
    const parsed = parseRenditions(Object.fromEntries(RENDITION_KINDS.map((k) => [k, one])));
    expect(Object.keys(parsed).sort()).toEqual([...RENDITION_KINDS].sort());
    expect(pgTextBytes(parsed)).toBeLessThanOrEqual(boundOf("renditions"));
  });
});
