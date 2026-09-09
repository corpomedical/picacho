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

const { assertOutputAllowed } = await import(pathToFileURL(`${here}../src/lib/generations/output-policy.ts`).href);
const cases = JSON.parse(readFileSync(process.argv[2] ?? "/tmp/output-eval.json", "utf8"));

const out = [];
const CHUNK = 4;
for (let i = 0; i < cases.length; i += CHUNK) {
  const chunk = cases.slice(i, i + CHUNK);
  const rs = await Promise.all(chunk.map(async (c) => {
    const imageUrl = c.content_type === "video" ? c.poster_url : c.result_url;
    if (!imageUrl) return { ...c, verdict: "no-image", readings: null };
    try {
      const v = await assertOutputAllowed({ imageUrl });
      return { ...c, verdict: null, readings: v.readings };
    } catch (e) {
      return { ...c, verdict: e?.reason ?? "error", readings: e?.readings ?? null, error: e?.reason ? null : String(e?.message ?? e) };
    }
  }));
  out.push(...rs);
  process.stderr.write(`\r  ${Math.min(i + CHUNK, cases.length)}/${cases.length}`);
}
process.stderr.write("\n");

const fmt = (r) => {
  const m = r.readings?.moderation, v = r.readings?.vision;
  const ms = m ? `mod ${m.flagged ? "FLAG" : "ok  "} ${m.sexual.toFixed(4)}` : "mod   --    ";
  const vs = v ? `vis nud=${v.sexual_nudity.slice(0,3)} act=${v.sexual_act.slice(0,3)} fram=${v.suggestive_framing.slice(0,3)} min=${v.minor_sexualized.slice(0,3)} ${v.depicted_subject}` : "vis --";
  return `${ms} | ${vs}`;
};

let tp = 0, tn = 0; const fp = [], fn = [], infra = [];
for (const r of out) {
  if (r.verdict === "unavailable" || r.verdict === "error" || r.verdict === "no-image") { infra.push(r); continue; }
  const refused = Boolean(r.verdict);
  if (r.expected === "refuse") refused ? tp++ : fn.push(r); else refused ? fp.push(r) : tn++;
}
console.log(`\nmust-refuse caught   ${tp}/${tp + fn.length}`);
console.log(`must-allow allowed   ${tn}/${tn + fp.length}`);
if (infra.length) {
  console.log(`not judged           ${infra.length}`);
  for (const r of infra) console.log(`  ${r.verdict.padEnd(11)} ${(r.content_type).padEnd(5)} ${r.id.slice(0, 8)} ${r.error ?? ""} ${(r.content_type === "video" ? r.poster_url : r.result_url) ?? "(no url)"}`);
}

console.log("\n--- the reviewer's renders, by picture ---");
for (const r of out.filter((r) => r.group === "reviewer")) {
  const got = r.verdict ?? "allowed";
  const ok = r.verdict === "unavailable" ? "?" : (Boolean(r.verdict) === (r.expected === "refuse") ? "✓" : "✗");
  console.log(`  ${ok} want ${r.expected.padEnd(6)} got ${got.padEnd(11)} ${(r.content_type).padEnd(5)} ${fmt(r)}  ${JSON.stringify(r.prompt_input).slice(0, 48)}`);
}
console.log("\n--- wrong verdicts ---");
for (const r of fn) console.log(`  allowed a must-refuse: ${(r.content_type).padEnd(5)} ${fmt(r)}  ${JSON.stringify(r.prompt_input).slice(0, 60)}`);
for (const r of fp) console.log(`  refused a must-allow (${r.verdict}): ${(r.content_type).padEnd(5)} ${fmt(r)}  ${JSON.stringify(r.prompt_input).slice(0, 60)}`);
if (!fp.length && !fn.length) console.log("  (none)");

// The distribution that pins MODERATION_BANDS.
const scores = (pred) => out.filter((r) => pred(r) && r.readings?.moderation).map((r) => r.readings.moderation.sexual).sort((a, b) => a - b);
const q = (a, p) => a.length ? a[Math.min(a.length - 1, Math.floor(p * a.length))] : NaN;
const bad = scores((r) => r.expected === "refuse"), good = scores((r) => r.expected === "allow");
console.log(`\nmoderation.sexual — must-refuse: min ${bad[0]?.toFixed(3)} max ${bad.at(-1)?.toFixed(3)}`);
console.log(`moderation.sexual — must-allow : max ${good.at(-1)?.toFixed(4)} p95 ${q(good, 0.95).toFixed(4)} p50 ${q(good, 0.5).toFixed(5)}  (n=${good.length})`);
process.exit(fn.length > 0 || fp.length > 0 ? 1 : infra.length > 0 ? 2 : 0);
