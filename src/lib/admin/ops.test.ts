import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { AdminErrorBanner } from "../../components/admin-error-banner";

// The admin's actions live in ops.ts (2026-09-28 admin redesign); the
// website's server actions redirect with the line an op returns, and the
// banner shows only lines it knows — anything else reads "Something went
// wrong". So every fixed line an op can return must be one the banner knows.
const source = readFileSync(join(__dirname, "ops.ts"), "utf8");
const shown = (error: string): string => AdminErrorBanner({ error })?.props.children;
const GENERIC = shown("anything the banner doesn't know");

describe("every line an admin op returns reaches the page", () => {
  // Success lines (ok(...)) never reach the error banner.
  const okLines = new Set(
    [...source.matchAll(/\bok\(([^;]*?)\);/g)].flatMap((m) => [...m[1].matchAll(/"((?:[^"\\]|\\.)*)"/g)].map((x) => x[1])),
  );
  const lines = [
    ...[...source.matchAll(/\bno\(\s*"((?:[^"\\]|\\.)*)"\s*\)/g)].map((m) => JSON.parse(`"${m[1]}"`)),
    ...[...source.matchAll(/\bno\(\s*'([^']*)'\s*\)/g)].map((m) => m[1]),
    ...[...source.matchAll(/\?\s*"((?:[^"\\]|\\.)*)"\s*:/g)].map((m) => JSON.parse(`"${m[1]}"`)),
    ...[...source.matchAll(/:\s*"((?:[^"\\]|\\.)*)",?\s*\)/g)].map((m) => JSON.parse(`"${m[1]}"`)),
    "Run supabase/applied/2026-09-29/admin-activity.sql in Supabase first, then try again.",
  ]
    .filter((t) => t.length > 12)
    .filter((t) => !okLines.has(t));

  it("finds the lines", () => {
    expect(lines.length).toBeGreaterThan(15);
  });

  it.each(lines)("%s", (line) => {
    expect(shown(line)).not.toBe(GENERIC);
  });
});
