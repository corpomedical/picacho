// Measures the content policy against content-policy.eval.json.
//
// The suspension was caused by false negatives; the first fix was nearly
// undone by false positives. Both numbers matter, so both are printed, and
// the eval set carries the reviewer's real prompts and the measured
// over-refusals side by side. Run: node scripts/content-policy-eval.mjs
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

const env = Object.fromEntries(
  readFileSync(".env.local", "utf8").split("\n")
    .filter((l) => l.includes("=") && !l.startsWith("#"))
    .map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, "")]; }),
);
for (const [k, v] of Object.entries(env)) process.env[k] ??= v;

const { assertPromptAllowed } = await import(
  pathToFileURL("/Users/ahmadkmm/Picacho/src/lib/generations/content-policy.ts").href
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
process.exit(fn > 0 ? 1 : 0);
