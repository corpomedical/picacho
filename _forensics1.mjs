// READ-ONLY forensics probe (credit-ledger lens). SELECTs only. Deleted after use.
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "fs";

const env = Object.fromEntries(
  readFileSync("/Users/ahmadkmm/Picacho/.env.local", "utf8")
    .split("\n")
    .filter((l) => l.includes("="))
    .map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1)]),
);
const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL.trim(), env.SUPABASE_SERVICE_ROLE_KEY.trim(), {
  auth: { persistSession: false },
});

const since = new Date(Date.now() - 30 * 86400000).toISOString();

// 1. Column introspection (one row each)
for (const t of ["generations", "generation_jobs", "agent_usage"]) {
  const { data, error } = await sb.from(t).select("*").limit(1);
  console.log(`== ${t} columns ==`);
  if (error) console.log("ERR", error.message);
  else console.log(data?.[0] ? Object.keys(data[0]).join(", ") : "(empty)");
}

// 2. Volume in window
const { count } = await sb
  .from("generations")
  .select("id", { count: "exact", head: true })
  .gte("created_at", since);
console.log("\ngenerations in last 30d:", count);

const { count: auCount } = await sb
  .from("agent_usage")
  .select("id", { count: "exact", head: true });
console.log("agent_usage rows (all time):", auCount);
