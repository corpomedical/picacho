// Measures the content policy against content-policy.eval.json.
//
// The suspension was caused by false negatives; the first fix was nearly
// undone by false positives. Both numbers matter, so both are printed, and
// the eval set carries the reviewer's real prompts and the measured
// over-refusals side by side.
//
// Run with tsx, not node: `npx tsx scripts/content-policy-eval.mjs`. The
// policy module imports its providers through "@/…", which plain node cannot
// resolve — and that failure is SILENT, because score() catches everything
// and returns null, so under node every case reads "unavailable", every allow
// case becomes a false positive, and the old exit rule still returned 0.
// Both directions fail the run now: a filter that blocks everything is as
// broken as one that blocks nothing.
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

const env = Object.fromEntries(
  readFileSync(".env.local", "utf8").split("\n")
    .filter((l) => l.includes("=") && !l.startsWith("#"))
    .map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, "")]; }),
);
for (const [k, v] of Object.entries(env)) process.env[k] ??= v;

if (!process.env.OPENAI_API_KEY && !process.env.ANTHROPIC_API_KEY) {
  console.error("No OPENAI_API_KEY or ANTHROPIC_API_KEY — the eval measures a classifier and cannot run without one.");
  process.exit(2);
}
const { assertPromptAllowed } = await import(
  pathToFileURL(new URL("../src/lib/generations/content-policy.ts", import.meta.url).pathname).href
);
const cases = JSON.parse(readFileSync("src/lib/generations/content-policy.eval.json", "utf8"));

const LIMIT = Number(process.env.EVAL_LIMIT ?? cases.length);
const subset = cases.slice(0, LIMIT);
let tp = 0, tn = 0, fp = 0, fn = 0;
const failures = [];

await Promise.all(subset.map(async (c) => {
  let refused = null;
  try {
    // A case whose text supplies a photograph would carry an attachment in
    // production, which is what puts it in the strict lane. Honour that here
    // rather than testing a lane the real request would never take.
    const hasPhoto = c.hasPhoto === true || /\b(?:here is|this is|attached|my)\b[^.]*\bphoto\b/i.test(c.prompt);
    await assertPromptAllowed({ prompt: c.prompt, hasRealPersonReference: hasPhoto });
  } catch (e) {
    refused = e?.reason ?? "error";
  }
  const got = refused ? "refuse" : "allow";
  if (c.expected === "refuse" && got === "refuse") tp++;
  else if (c.expected === "allow" && got === "allow") tn++;
  else if (c.expected === "allow" && got === "refuse") { fp++; failures.push(["FALSE POSITIVE", c.prompt, refused]); }
  else { fn++; failures.push(["FALSE NEGATIVE", c.prompt, c.category ?? ""]); }
}));

const prec = tp + fp ? (tp / (tp + fp)) : 1;
const rec = tp + fn ? (tp / (tp + fn)) : 1;
console.log(`\ncases           ${subset.length}`);
console.log(`correctly refused  ${tp}/${tp + fn}   (recall    ${(rec * 100).toFixed(1)}%)`);
console.log(`correctly allowed  ${tn}/${tn + fp}   (precision ${(prec * 100).toFixed(1)}%)`);
console.log(`over-refusals      ${fp}`);
console.log(`missed violations  ${fn}`);
if (failures.length) {
  console.log("\n--- failures ---");
  for (const [kind, prompt, extra] of failures) console.log(`${kind}  ${JSON.stringify(prompt).slice(0, 88)}  ${extra}`);
}
process.exit(fn > 0 || fp > 0 ? 1 : 0);
