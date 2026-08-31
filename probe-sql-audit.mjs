// READ-ONLY audit probe. Deleted after use. No data is modified:
// - RPC probes call functions with an EMPTY body; every probed function has
//   required args, so PostgREST returns PGRST202 (schema-cache miss) WITHOUT
//   executing anything. The hint/message reveals the live signature.
// - Table probes are SELECTs only.
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "fs";

const env = Object.fromEntries(
  readFileSync("/Users/ahmadkmm/Picacho/.env.local", "utf8")
    .split("\n")
    .filter((l) => l.includes("="))
    .map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1)]),
);
const url = env.NEXT_PUBLIC_SUPABASE_URL.trim();
const key = env.SUPABASE_SERVICE_ROLE_KEY.trim();
const sb = createClient(url, key, { auth: { persistSession: false } });

const fns = [
  "reserve_generation",
  "reserve_generations",
  "record_agent_units",
  "record_prompt_assist",
  "spend_daily_free_generation",
  "refund_daily_free_generation",
  "spend_purchased_credits",
  "add_purchased_credits",
  "decrement_purchased_credits",
  "clawback_credit_purchase",
  "record_credit_purchase",
  "record_model_failure",
  "api_rate_check",
  "claim_job_advance",
  "spend_free_reference_generation",
  "reserve_reference_image_generation",
  "refund_free_reference_generation",
  "insert_saved_prompt_capped",
  "insert_brand_rules_capped",
  "create_api_key_capped",
  "monthly_credits_used",
  "share_to_community",
  "record_community_view",
  "report_community_post",
  "auth_email_status",
  "admin_user_auth_activity",
  "spend_free_generation",
  "reward_referral_on_success",
];

for (const f of fns) {
  // Empty body -> no zero-arg overload exists for these -> PGRST202, never executed.
  const { error } = await sb.rpc(f, {});
  if (!error) {
    console.log(`${f}: !! CALL SUCCEEDED (zero-arg overload exists?)`);
    continue;
  }
  console.log(`${f}: code=${error.code} msg=${error.message} hint=${error.hint ?? ""}`);
}

// Type probe: referred_by uuid vs text. Filtering with a non-uuid literal
// errors 22P02 only if the column is uuid. Pure read.
{
  const { error } = await sb
    .from("profiles")
    .select("id", { head: true, count: "exact" })
    .eq("referred_by", "not-a-uuid");
  console.log("referred_by non-uuid filter ->", error ? `${error.code}: ${error.message}` : "no error (column is text)");
}

// promo_rep column existence
{
  const { error } = await sb.from("profiles").select("promo_rep", { head: true }).limit(1);
  console.log("promo_rep column ->", error ? `${error.code}: ${error.message}` : "exists");
}

// Referral reward evidence: how many profiles were rewarded, bonus_credits spread.
{
  const { count: rewarded } = await sb
    .from("profiles")
    .select("id", { head: true, count: "exact" })
    .not("referral_rewarded_at", "is", null);
  const { count: referred } = await sb
    .from("profiles")
    .select("id", { head: true, count: "exact" })
    .not("referred_by", "is", null);
  const { data: bonuses } = await sb
    .from("profiles")
    .select("bonus_credits, plan, referral_rewarded_at, created_at")
    .gt("bonus_credits", 0)
    .order("bonus_credits", { ascending: false })
    .limit(20);
  console.log("profiles referral_rewarded_at set:", rewarded, "| referred_by set:", referred);
  console.log("bonus_credits>0 rows:", JSON.stringify(bonuses));
}

// community_posts: did the 2026-08-31 share fn lose the match_score snapshot?
{
  const { data, error } = await sb
    .from("community_posts")
    .select("created_at, match_score, character_name")
    .order("created_at", { ascending: false })
    .limit(10);
  console.log("community_posts latest:", error ? error.message : JSON.stringify(data));
}

// agent_usage: any rows stuck at mode='reserved' (reservation never settled)?
{
  const { data, error } = await sb
    .from("agent_usage")
    .select("mode, units, cost_usd, created_at")
    .eq("mode", "reserved")
    .order("created_at", { ascending: false })
    .limit(10);
  const { count } = await sb.from("agent_usage").select("id", { head: true, count: "exact" });
  console.log("agent_usage total:", count, "| stuck 'reserved':", error ? error.message : JSON.stringify(data));
}

// negative balances / weirdness
{
  const { data: negP } = await sb.from("profiles").select("id, purchased_credits").lt("purchased_credits", 0).limit(5);
  const { data: negB } = await sb.from("profiles").select("id, bonus_credits").lt("bonus_credits", 0).limit(5);
  console.log("negative purchased_credits:", JSON.stringify(negP), "negative bonus:", JSON.stringify(negB));
}
console.log("done");
