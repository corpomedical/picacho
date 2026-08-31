import { createClient } from "@supabase/supabase-js";
import fs from "node:fs";
const env = Object.fromEntries(fs.readFileSync(".env.local","utf8").split("\n").filter(l=>l.includes("=")&&!l.trim().startsWith("#")).map(l=>{const i=l.indexOf("=");return [l.slice(0,i).trim(), l.slice(i+1).trim().replace(/^["']|["']$/g,"")];}));
const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {auth:{persistSession:false}});
for (const col of ["id","model_id","kind","consecutive_failures","failing_user_ids","trip_count","tripped_at","retry_after","last_error","last_success_at","last_failure_at","updated_at"]) {
  const {error} = await db.from("model_health").select(col).limit(1);
  console.log("model_health."+col, error? "ERR: "+error.message : "ok");
}
// does the RPC exist?
const r = await db.rpc("record_model_failure", {p_model_id:"__probe_nonexistent__"});
console.log("rpc record_model_failure ->", r.error ? r.error.message : "NO ERROR (would have written!)");
const c = await db.rpc("claim_job_advance", {});
console.log("rpc claim_job_advance ->", c.error ? c.error.message : "ok");
// generations columns
const {data: g} = await db.from("generations").select("*").limit(1);
console.log("generations columns:", g && g[0] ? Object.keys(g[0]).join(",") : "none");
