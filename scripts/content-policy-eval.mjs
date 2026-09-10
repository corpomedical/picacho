// Measures the content policy against its labelled corpora.
//
// The suspension was caused by false negatives; the first fix was nearly
// undone by false positives. Both numbers matter, so both are printed and
// EITHER fails the run — a filter that blocks everything is as broken as one
// that blocks nothing.
//
// Run with tsx, not node: `npx tsx scripts/content-policy-eval.mjs`. The
// policy imports its providers through "@/…", which plain node cannot
// resolve — and that failure is SILENT (score() catches everything and
// returns null), so under node every case reads "unavailable".
//
//   default     content-policy.eval.json     79 labelled cases: the reviewer's
//               session, measured over-refusals, grey cases from the published
//               rulebooks, and the strict-lane band cases.
//   --benign    + content-policy.benign.json  320 prompts written blind to the
//               policy across eight domains, all expected allow. Costs ~320
//               classifier calls; run before shipping a threshold change.
//
// Requests are chunked and "unavailable" is retried once and counted APART
// from policy verdicts: a 429 that fails closed looks exactly like a refusal
// and would otherwise inflate the one number this exists to measure.
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

const here = new URL(".", import.meta.url).pathname;
const env = Object.fromEntries(
  readFileSync(`${here}../.env.local`, "utf8").split("\n")
    .filter((l) => l.includes("=") && !l.startsWith("#"))
    .map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, "")]; }),
);
for (const [k, v] of Object.entries(env)) process.env[k] ??= v;
if (!process.env.ANTHROPIC_API_KEY) { console.error("ANTHROPIC_API_KEY is required: both gates read with two model families, and a run without the second is not the production configuration."); process.exit(2); }
if (!process.env.OPENAI_API_KEY && !process.env.ANTHROPIC_API_KEY) {
  console.error("No OPENAI_API_KEY or ANTHROPIC_API_KEY — the eval measures a classifier and cannot run without one.");
  process.exit(2);
}

const { assertPromptAllowed } = await import(pathToFileURL(`${here}../src/lib/generations/content-policy.ts`).href);
const dir = `${here}../src/lib/generations/`;
const cases = JSON.parse(readFileSync(`${dir}content-policy.eval.json`, "utf8"));
if (process.argv.includes("--benign")) {
  for (const r of JSON.parse(readFileSync(`${dir}content-policy.benign.json`, "utf8"))) cases.push({ ...r, expected: "allow" });
}

const judge = async (c) => {
  try { await assertPromptAllowed({ prompt: c.prompt, hasRealPersonReference: c.hasPhoto === true }); return null; }
  catch (e) { return e?.reason ?? "error"; }
};

// --runs N: the whole set is judged N times and the verdicts compared per
// case; a verdict that differs between runs of the same prompt is the
// failure the vote exists to remove (2026-09-11).
const runsAt = process.argv.indexOf("--runs");
const RUNS = runsAt > 0 ? Number(process.argv[runsAt + 1]) : 1;
if (!Number.isInteger(RUNS) || RUNS < 1) { console.error("--runs needs a whole number"); process.exit(2); }
const perRun = [];
let out = [];
for (let run = 1; run <= RUNS; run++) {
if (RUNS > 1) process.stderr.write(`run ${run}/${RUNS}\n`);
out = [];
for (let i = 0; i < cases.length; i += 6) {
  // Six at a time: twelve plus the votes at the edges saturates the org's
  // 200k tokens-per-minute limit on gpt-5.4-mini (2026-09-11), and a 429
  // that outlasts the retries reads as an outage in the numbers.
  const chunk = cases.slice(i, i + 6);
  const verdicts = await Promise.all(chunk.map(judge));
  for (let j = 0; j < chunk.length; j++) {
    let v = verdicts[j];
    if (v === "unavailable") { await new Promise((r) => setTimeout(r, 1500)); v = await judge(chunk[j]); }
    out.push({ ...chunk[j], verdict: v });
  }
  process.stderr.write(`\r  ${Math.min(i + 6, cases.length)}/${cases.length}`);
}
process.stderr.write("\n");
perRun.push(out);
}
if (RUNS > 1) {
  const infraVerdicts = new Set(["unavailable", "error"]);
  const byPrompt = new Map();
  for (const run of perRun) run.forEach((r, i) => byPrompt.set(i, [...(byPrompt.get(i) ?? []), r]));
  const judgedEveryRun = [...byPrompt.values()].filter((rs) => rs.every((r) => !infraVerdicts.has(String(r.verdict))));
  const unstable = judgedEveryRun.filter((rs) => new Set(rs.map((r) => String(r.verdict))).size > 1);
  console.log(`\n--- stability over ${RUNS} runs: ${judgedEveryRun.length - unstable.length}/${judgedEveryRun.length} judged prompts gave the same verdict every time${byPrompt.size - judgedEveryRun.length ? `; ${byPrompt.size - judgedEveryRun.length} not judged in every run` : ""} ---`);
  for (const rs of unstable) console.log(`  UNSTABLE ${rs.map((r) => r.verdict ?? "allowed").join(" / ")}  ${JSON.stringify(rs[0].prompt).slice(0, 80)}`);
}

const infra = out.filter((r) => r.verdict === "unavailable" || r.verdict === "error");
const judged = out.filter((r) => !infra.includes(r));
let tp = 0, tn = 0; const fp = [], fn = [];
for (const r of judged) {
  const refused = Boolean(r.verdict);
  if (r.expected === "refuse") {
    if (refused) tp++; else fn.push(r);
  } else if (refused) fp.push(r); else tn++;
}
const prec = tn + fp.length ? tn / (tn + fp.length) : 1;
const rec = tp + fn.length ? tp / (tp + fn.length) : 1;
console.log(`\ncases              ${judged.length}${infra.length ? `   (${infra.length} infrastructure failures excluded)` : ""}`);
console.log(`correctly refused  ${tp}/${tp + fn.length}   (recall    ${(rec * 100).toFixed(1)}%)`);
console.log(`correctly allowed  ${tn}/${tn + fp.length}   (precision ${(prec * 100).toFixed(1)}%)`);
console.log(`over-refusals      ${fp.length}`);
console.log(`missed violations  ${fn.length}`);
const by = {};
for (const r of judged) { const k = r.domain ?? (r.hasPhoto ? "strict-lane" : "eval"); by[k] ??= { n: 0, wrong: 0 }; by[k].n++; if (fp.includes(r) || fn.includes(r)) by[k].wrong++; }
for (const [k, v] of Object.entries(by)) console.log(`  ${k.padEnd(16)} ${String(v.wrong).padStart(3)} wrong / ${String(v.n).padStart(3)}`);
if (fp.length || fn.length) {
  console.log("\n--- failures ---");
  for (const r of fp) console.log(`FALSE POSITIVE  [${r.verdict}]  ${JSON.stringify(r.prompt).slice(0, 96)}`);
  for (const r of fn) console.log(`FALSE NEGATIVE  ${(r.category ?? "").padEnd(24)}  ${JSON.stringify(r.prompt).slice(0, 96)}`);
}
process.exit(fn.length > 0 || fp.length > 0 ? 1 : 0);
