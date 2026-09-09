// Measures the OUTPUT gate against real renders.
//
// The set comes from scripts/output-policy-set.mjs: the reviewer's eleven
// renders from 2026-09-09, labelled per PICTURE after a human look (one nude
// must refuse; ten ordinary pictures must allow), and the newest sixty
// succeeded renders by real accounts, which must allow. Both readers' raw
// values are printed for every reviewer case, and the moderation score
// distribution for both groups, so MODERATION_BANDS in output-policy.ts can
// be checked against the numbers rather than remembered.
//
// Exit codes: 0 clean; 1 a wrong verdict (a refused must-allow, or an allowed
// must-refuse); 2 no wrong verdict but some cases were not judged
// ("unavailable" — a reader or the image fetch failed), which is a harness or
// network problem and must never read as a pass.
//
// Run with tsx: `npx tsx scripts/output-policy-eval.mjs /tmp/output-eval.json`.
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

const here = new URL(".", import.meta.url).pathname;
const env = Object.fromEntries(
  readFileSync(`${here}../.env.local`, "utf8").split("\n")
    .filter((l) => l.includes("=") && !l.startsWith("#"))
    .map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, "")]; }),
);
for (const [k, v] of Object.entries(env)) process.env[k] ??= v;
if (!process.env.OPENAI_API_KEY) { console.error("No OPENAI_API_KEY."); process.exit(2); }

const { assertOutputAllowed, decideOutput } = await import(pathToFileURL(`${here}../src/lib/generations/output-policy.ts`).href);
const cases = JSON.parse(readFileSync(process.argv[2] ?? "/tmp/output-eval.json", "utf8"));

// --replay <readings.json>: no network. The readings a previous run dumped
// are re-judged through decideOutput (the same pure function the gate
// calls), so a label or rule change is checked in a second, not a
// re-measurement. Labels come from the set file; readings from the dump.
const replayAt = process.argv.indexOf("--replay");
const replay = replayAt > 0 && process.argv[replayAt + 1]
  ? new Map(JSON.parse(readFileSync(process.argv[replayAt + 1], "utf8")).map((r) => [r.id, r.readings]))
  : null;

const out = [];
const CHUNK = 4;
for (let i = 0; i < cases.length; i += CHUNK) {
  const chunk = cases.slice(i, i + CHUNK);
  const rs = await Promise.all(chunk.map(async (c) => {
    const imageUrl = c.content_type === "video" ? c.poster_url : c.result_url;
    if (!imageUrl) return { ...c, verdict: "no-image", readings: null };
    if (replay) {
      const readings = replay.get(c.id);
      if (!readings) return { ...c, verdict: "error", readings: null, error: "not in the replayed readings" };
      const reason = decideOutput(readings, { strictLane: c.lane === "strict" });
      return { ...c, verdict: reason, readings };
    }
    try {
      // Judged in the lane it rendered in — a strict-lane case gets the
      // strict rule, which is what this run measures the cost of.
      const v = await assertOutputAllowed({ imageUrl, strictLane: c.lane === "strict" });
      return { ...c, verdict: null, readings: v.readings };
    } catch (e) {
      return { ...c, verdict: e?.reason ?? "error", readings: e?.readings ?? null, error: e?.reason ? null : String(e?.message ?? e) };
    }
  }));
  out.push(...rs);
  process.stderr.write(`\r  ${Math.min(i + CHUNK, cases.length)}/${cases.length}`);
}
process.stderr.write("\n");
// Every reading, kept: a counterfactual rule can be computed from this file
// without paying for the readers again (--dump <file>).
const dumpAt = process.argv.indexOf("--dump");
if (dumpAt > 0 && process.argv[dumpAt + 1]) {
  const { writeFileSync } = await import("node:fs");
  writeFileSync(process.argv[dumpAt + 1], JSON.stringify(out, null, 1));
}

const fmt = (r) => {
  const m = r.readings?.moderation, v = r.readings?.vision;
  const ms = m ? `mod ${m.flagged ? "FLAG" : "ok  "} ${m.sexual.toFixed(4)}` : "mod   --    ";
  const vs = v ? `vis nud=${v.sexual_nudity.slice(0,3)} act=${v.sexual_act.slice(0,3)} fram=${v.suggestive_framing.slice(0,3)} min=${v.minor_sexualized.slice(0,3)} ${v.depicted_subject}` : "vis --";
  return `${ms} | ${vs}`;
};

let tp = 0, tn = 0; const fp = [], fn = [], infra = [], border = [];
for (const r of out) {
  if (r.verdict === "unavailable" || r.verdict === "error" || r.verdict === "no-image") { infra.push(r); continue; }
  const refused = Boolean(r.verdict);
  if (r.expected === "borderline") { border.push(r); continue; }
  if (r.expected === "refuse") {
    if (refused) tp++; else fn.push(r);
  } else if (refused) fp.push(r); else tn++;
}
console.log(`\nmust-refuse caught   ${tp}/${tp + fn.length}`);
console.log(`must-allow allowed   ${tn}/${tn + fp.length}`);
if (border.length) console.log(`borderline           ${border.filter((r) => r.verdict).length} refused, ${border.filter((r) => !r.verdict).length} allowed — either is acceptable (${border.length} pictures)`);
if (infra.length) {
  console.log(`not judged           ${infra.length}`);
  for (const r of infra) console.log(`  ${r.verdict.padEnd(11)} ${(r.content_type).padEnd(5)} ${r.id.slice(0, 8)} ${r.error ?? ""} ${(r.content_type === "video" ? r.poster_url : r.result_url) ?? "(no url)"}`);
}

console.log("\n--- the reviewer's renders, by picture ---");
for (const r of out.filter((r) => r.group === "reviewer")) {
  const got = r.verdict ?? "allowed";
  const ok = r.verdict === "unavailable" ? "?" : r.expected === "borderline" ? "~" : (Boolean(r.verdict) === (r.expected === "refuse") ? "✓" : "✗");
  console.log(`  ${ok} want ${r.expected.padEnd(6)} got ${got.padEnd(11)} ${(r.content_type).padEnd(5)} ${fmt(r)}  ${JSON.stringify(r.prompt_input).slice(0, 48)}`);
}
console.log("\n--- wrong verdicts ---");
for (const r of fn) console.log(`  allowed a must-refuse: ${(r.content_type).padEnd(5)} ${fmt(r)}  ${JSON.stringify(r.prompt_input).slice(0, 60)}`);
for (const r of fp) console.log(`  refused a must-allow (${r.verdict}): ${(r.content_type).padEnd(5)} ${fmt(r)}  ${JSON.stringify(r.prompt_input).slice(0, 60)}`);
if (!fp.length && !fn.length) console.log("  (none)");

// THE LANE MEASUREMENT (2026-09-10). Three rules on every strict-lane real
// render, from the same readings: the ordinary lane (HIGH), the strict lane
// as shipped (MEDIUM), and the candidate the operator asked to have measured
// before deciding — refusing at LOW on nudity or framing in the strict lane.
// The candidate is computed here, not in the gate: production carries no
// knob for a rule that has not been chosen.
const BANDS = ["NEGLIGIBLE", "LOW", "MEDIUM", "HIGH"];
const bv = (b) => BANDS.indexOf(b);
const lowRule = (r) => {
  const m = r.moderation, v = r.vision;
  if (!m && !v) return "unavailable";
  if (v && bv(v.minor_sexualized) >= 1) return "minors";
  if (m?.flagged) return "sexual";
  if (!v) return null;
  return bv(v.sexual_nudity) >= 1 || bv(v.suggestive_framing) >= 1 || bv(v.sexual_act) >= 2 ? "sexual" : null;
};
const readable = (r) => r.readings && (r.readings.moderation || r.readings.vision);
const strictReal = out.filter((r) => r.group !== "reviewer" && r.lane === "strict" && r.expected === "allow" && readable(r));
if (strictReal.length) {
  const under = (rule) => strictReal.filter((r) => rule(r.readings));
  const normal = under((rd) => decideOutput(rd, {}));
  const strictMed = under((rd) => decideOutput(rd, { strictLane: true }));
  const strictLow = under((rd) => lowRule(rd));
  console.log(`\n--- the strict lane, on ${strictReal.length} real renders that carried an uploaded photo ---`);
  console.log(`  ordinary rule (HIGH)          refuses ${normal.length}`);
  console.log(`  strict as shipped (MEDIUM)    refuses ${strictMed.length}`);
  console.log(`  candidate strict-at-LOW       refuses ${strictLow.length}`);
  const bands = (cat) => BANDS.map((b) => `${b.slice(0, 3)}=${strictReal.filter((r) => r.readings.vision?.[cat] === b).length}`).join(" ");
  console.log(`  vision nudity  ${bands("sexual_nudity")}`);
  console.log(`  vision framing ${bands("suggestive_framing")}`);
  const show = (list, title) => {
    console.log(`  ${title}:`);
    if (!list.length) console.log("    (none)");
    for (const r of list) console.log(`    ${(r.content_type).padEnd(5)} ${r.id.slice(0, 8)} ${fmt(r)}  ${JSON.stringify(r.prompt_input).slice(0, 70)}`);
  };
  show(strictMed, "refused by the strict rule as shipped (the cost of option 1)");
  show(strictLow.filter((r) => !strictMed.includes(r)), "additionally refused at LOW (the cost of the candidate)");
}
{
  // The reviewer's ten ordinary strict-lane pictures, and — as a proxy when
  // real strict-lane renders are scarce — every real render as if it had
  // been strict: what each rule would refuse, with the pictures listed so
  // they can be looked at.
  const rev = out.filter((r) => r.group === "reviewer" && r.expected === "allow" && readable(r));
  console.log(`\n--- the reviewer's ${rev.length} ordinary pictures (all strict lane): strict-at-MEDIUM refuses ${rev.filter((r) => decideOutput(r.readings, { strictLane: true })).length}, strict-at-LOW refuses ${rev.filter((r) => lowRule(r.readings)).length}`);
  const real = out.filter((r) => r.group !== "reviewer" && r.expected === "allow" && readable(r));
  const med = real.filter((r) => decideOutput(r.readings, { strictLane: true }));
  const low = real.filter((r) => lowRule(r.readings));
  console.log(`--- proxy: all ${real.length} real renders AS IF strict lane — MEDIUM refuses ${med.length}, LOW refuses ${low.length}`);
  for (const r of low) console.log(`    ${med.includes(r) ? "MED+LOW" : "LOW only"} ${(r.content_type).padEnd(5)} ${r.id.slice(0, 8)} lane=${r.lane} ${fmt(r)}  ${JSON.stringify(r.prompt_input).slice(0, 70)}`);
  if (!low.length) console.log("    (none)");
}

// The distribution that pins MODERATION_BANDS.
const scores = (pred) => out.filter((r) => pred(r) && r.readings?.moderation).map((r) => r.readings.moderation.sexual).sort((a, b) => a - b);
const q = (a, p) => a.length ? a[Math.min(a.length - 1, Math.floor(p * a.length))] : NaN;
const bad = scores((r) => r.expected === "refuse"), good = scores((r) => r.expected === "allow");
console.log(`\nmoderation.sexual — must-refuse: min ${bad[0]?.toFixed(3)} max ${bad.at(-1)?.toFixed(3)}`);
console.log(`moderation.sexual — must-allow : max ${good.at(-1)?.toFixed(4)} p95 ${q(good, 0.95).toFixed(4)} p50 ${q(good, 0.5).toFixed(5)}  (n=${good.length})`);
process.exit(fn.length > 0 || fp.length > 0 ? 1 : infra.length > 0 ? 2 : 0);
