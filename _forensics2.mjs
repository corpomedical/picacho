// READ-ONLY forensics probe (credit-ledger lens). SELECTs + fal GET only. Deleted after use.
import { createClient } from "@supabase/supabase-js";
import { readFileSync, writeFileSync } from "fs";

const env = Object.fromEntries(
  readFileSync("/Users/ahmadkmm/Picacho/.env.local", "utf8")
    .split("\n")
    .filter((l) => l.includes("="))
    .map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1)]),
);
const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL.trim(), env.SUPABASE_SERVICE_ROLE_KEY.trim(), {
  auth: { persistSession: false },
});
const OUT = "/private/tmp/claude-501/-Users-ahmadkmm-Picacho/4f003e35-4402-4ac2-b884-51c42b5d6791/scratchpad";

const since = new Date(Date.now() - 30 * 86400000).toISOString();

const { data: gens, error: gerr } = await sb
  .from("generations")
  .select(
    "id, user_id, created_at, updated_at, status, content_type, video_model_id, model_id, video_duration_seconds, credits_used, purchased_credits_used, free_generation_used, refunded_at, result_url, angle_group_id, angle, prompt_input, pipeline_log, deleted_at, attempts, progress_stage, cancel_requested",
  )
  .gte("created_at", since)
  .order("created_at", { ascending: true })
  .limit(500);
if (gerr) throw gerr;
console.log("pulled generations:", gens.length);

const { data: agent } = await sb.from("agent_usage").select("*").order("created_at");

// fal ledger, 30 days (GET only)
const key = env.FAL_KEY?.trim();
const items = [];
for (let page = 1; page <= 25; page++) {
  const url =
    "https://rest.alpha.fal.ai/requests/?" +
    new URLSearchParams({
      start_time: since,
      end_time: new Date().toISOString(),
      size: "100",
      page: String(page),
    });
  const res = await fetch(url, { headers: { authorization: `Key ${key}` } });
  if (!res.ok) {
    console.log("fal ledger HTTP", res.status);
    break;
  }
  const body = await res.json();
  const batch = body.items ?? [];
  items.push(...batch);
  if (batch.length < 100) break;
}
console.log("fal ledger requests in 30d:", items.length);

writeFileSync(OUT + "/gens.json", JSON.stringify(gens, null, 1));
writeFileSync(OUT + "/agent.json", JSON.stringify(agent, null, 1));
writeFileSync(
  OUT + "/fal.json",
  JSON.stringify(
    items.map((r) => ({
      request_id: r.request_id,
      endpoint: r.endpoint,
      status_code: r.status_code,
      billable_units: r.billable_units,
      cost_nano: r.cost_estimate_nano_usd,
      billing_status: r.billing_status,
      started_at: r.started_at,
      error_type: r.error_type,
    })),
    null,
    1,
  ),
);
console.log("saved to scratchpad");
