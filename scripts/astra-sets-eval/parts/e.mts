// Part E: Match this shot. BLOCKED: src/lib/sets/match-shot.ts does not
// exist, and this runner makes none of E's model calls yet. (Astra has taken
// photos since Sets from a photo, 2026-09-11 — astra-request.ts
// photoBuildRequest — so a photo set's camera 1 could be read against EXIF.)
// What is built now: the ground truth (exif-fov.mts), the bar (pass-bars
// barE), and the corpus check of match.json. The EXIF reader, both builders'
// calls and E's rating sheet wait with the network leg.

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { writeManifest, writeSummary } from "../lib/context.mts";
import { HarnessError } from "../lib/util.mts";
import type { PartModule } from "./common.mts";

export const E_BLOCKED = "BLOCKED: E's model calls are not built in this runner; match-shot.ts does not exist";

/** The doc's own Match-this-shot figures, quoted with their line numbers (never retyped). */
export function docFigures(repoRoot: string): string[] {
  const p = join(repoRoot, "docs/ASTRA_SETS.md");
  if (!existsSync(p)) return ["docs/ASTRA_SETS.md not found"];
  const lines = readFileSync(p, "utf8").split("\n");
  const at = lines.findIndex((l) => l.includes("Match this shot on its own"));
  if (at < 0) return ["docs/ASTRA_SETS.md: the Match-this-shot figures were not found"];
  const out: string[] = [];
  for (let i = at; i < lines.length && i < at + 4 && lines[i].trim() && !lines[i].trim().startsWith("```"); i++) {
    out.push(`docs/ASTRA_SETS.md:${i + 1}  ${lines[i].trim()}`);
  }
  return out;
}

export const partE: PartModule = {
  needs: () => ({ match: false }),

  plan(ctx) {
    return { blocked: E_BLOCKED, notes: docFigures(ctx.repoRoot) };
  },

  async run(ctx) {
    if (!ctx.dry) throw new HarnessError(`${E_BLOCKED}. Nothing was called.`);
    const withExif = ctx.corpus.data.match.filter((m) => m.exif?.focal35mm).length;
    const out = [
      `E ${ctx.runId}  (DRY RUN)`,
      `  ${E_BLOCKED}`,
      ...docFigures(ctx.repoRoot).map((l) => `  ${l}`),
      `  match.json: ${ctx.corpus.data.match.length} photos, ${withExif} with a 35 mm-equivalent focal length`,
      "  built: verticalFovDegFrom35mm (lib/exif-fov.mts) and barE (lib/pass-bars.mts); deferred: the EXIF reader, both builders' calls, E's sheet",
    ];
    for (const l of out) ctx.out(l);
    writeSummary(ctx, out.join("\n"), { part: "e", blocked: E_BLOCKED });
    writeManifest(ctx);
    return 0;
  },
};
