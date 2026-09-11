import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { ASTRA_MODEL } from "../../../src/lib/generations/providers/astra.ts";
import { EVAL_DIR } from "./util.mts";

// Only src/lib/generations/providers/astra.ts may name the Astra model
// (astra-guard.test.ts fences src/). This fences the eval runner the same
// way: the id is obtained by import — so this file holds no literal either —
// and no file here may contain it, or set OPENAI_MODEL.

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    const rel = relative(EVAL_DIR, p);
    if (rel === "out" || rel === "corpus" || name === "node_modules") return [];
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

describe("the eval runner never names the Astra model", () => {
  const files = walk(EVAL_DIR);

  it("finds the files it fences", () => {
    expect(files.some((f) => f.endsWith("run.mts"))).toBe(true);
    expect(files.some((f) => f.endsWith("snap-page.html"))).toBe(true);
    expect(ASTRA_MODEL.length).toBeGreaterThan(0);
  });

  it("no file here contains the model id", () => {
    const offenders = files.filter((f) => readFileSync(f, "utf8").includes(ASTRA_MODEL)).map((f) => relative(EVAL_DIR, f));
    expect(offenders).toEqual([]);
  });

  it("no file here assigns OPENAI_MODEL", () => {
    const assign = [/\.OPENAI_MODEL\s*(\?\?|\|\||&&)?=(?!=)/, /\[\s*["'`]OPENAI_MODEL["'`]\s*\]\s*(\?\?|\|\||&&)?=(?!=)/];
    const offenders = files.filter((f) => /\.(m?ts|m?js|json|html)$/.test(f)).filter((f) => assign.some((re) => re.test(readFileSync(f, "utf8")))).map((f) => relative(EVAL_DIR, f));
    expect(offenders).toEqual([]);
  });
});
