// Does production actually have what supabase/pending-*/ says it should?
//
// Schema truth lives in three places — the live DB (operator hand-pastes
// SQL), the pending-*/ files, and the schema.sql snapshot — with nothing
// mechanical forcing agreement (2026-09-05 audit). The class already caused
// a money bug: the plan check constraint lacked 'basic' while the site sold
// Basic. This script is the mechanical check: a curated manifest of the
// LOAD-BEARING objects each pending directory creates, probed read-only
// against the live database. Run it after applying SQL, or before a deploy
// that depends on one:
//
//   node scripts/verify-db.mjs
//
// CURATED, not parsed: each entry names the artifacts the app actually
// selects/calls. When you add a pending file, add its artifacts here — the
// checklist is the point.
//
// READ-ONLY by construction: columns are probed with select+limit=0; RPCs
// are probed by calling them with a deliberately unknown argument, which
// PostgREST rejects BEFORE execution — a function that exists answers with
// a signature hint naming it, a missing one doesn't. Nothing is written.

import fs from "node:fs";

const env = Object.fromEntries(
  fs
    .readFileSync(new URL("../.env.local", import.meta.url), "utf8")
    .split("\n")
    .filter((l) => l.includes("=") && !l.startsWith("#"))
    .map((l) => [l.slice(0, l.indexOf("=")).trim(), l.slice(l.indexOf("=") + 1).trim()]),
);
const BASE = env.NEXT_PUBLIC_SUPABASE_URL;
const KEY = env.SUPABASE_SERVICE_ROLE_KEY;
if (!BASE || !KEY) throw new Error("Supabase env missing from .env.local");
const h = { apikey: KEY, authorization: `Bearer ${KEY}` };

// table -> columns the app reads. One probe per table (all columns at once).
const COLUMNS = {
  profiles: [
    "plan", "plan_status", "plan_source", "plan_currency", "plan_interval",
    "bonus_credits", "purchased_credits", "free_generation_last_at",
    "referred_by", "referral_rewarded_at", "marketing_opt_out", "status",
    "stripe_customer_id", "stripe_subscription_id", "current_period_start",
  ],
  generations: [
    "angle_group_id", "angle", "attachments", "cancel_requested", "deleted_at",
    "featured_at", "match_score", "video_model_id", "model_id",
    "video_duration_seconds", "purchased_credits_used", "free_generation_used",
    "pipeline_log", "progress_stage", "poster_url",
  ],
  push_tokens: ["token", "platform", "last_seen_at", "locale"],
  character_profiles: [
    "reference_image_urls", "outfit_image_urls", "outfit_description",
    "render_style", "voice_id", "voice_tone_tags", "motion_style", "project_id",
  ],
  generation_jobs: ["stage", "provider_request_id", "advance_lock", "advance_locked_at", "payload", "resume", "last_polled_at"],
  community_posts: ["media_url", "hidden_at", "hearts_count", "views_count", "username", "caption"],
  community_hearts: ["post_id", "user_id"],
  community_views: ["post_id", "user_id"],
  generation_reports: ["reason", "details", "source", "created_at"],
  generation_layers: ["generation_id", "z_index"],
  credit_purchases: ["stripe_session_id", "refunded_at"],
  api_keys: ["key_hash"],
  api_rate_hits: ["scope"],
  admin_push_subscriptions: ["endpoint"],
  notes: ["title", "body"],
  products: ["image_paths"],
  app_settings: ["key", "value"],
  feature_flags: ["key", "enabled"],
  voice_presets: ["label"],
};

// RPCs the app calls (schema.sql + pending files).
const RPCS = [
  "api_rate_check",
  "reserve_generations",
  "claim_job_advance",
  "spend_daily_free_generation",
  "spend_purchased_credits",
  "add_purchased_credits",
  "monthly_credits_used",
  "share_to_community",
  "record_community_view",
  "report_community_post",
  "username_available",
  "auth_email_status",
  "blast_recipient_emails",
];

// Storage buckets both code rosters expect (see truth-contracts.test.ts).
const BUCKETS = [
  "character-references",
  "generated-images",
  "generated-videos",
  "chat-attachments",
  "upscale-sources",
  "layer-sources",
];

let missing = 0;
const bad = (msg) => {
  missing += 1;
  console.log(`  MISSING  ${msg}`);
};
const ok = (msg) => console.log(`  ok       ${msg}`);

async function main() {
  console.log(`Verifying ${BASE}\n`);

  console.log("columns:");
  for (const [table, cols] of Object.entries(COLUMNS)) {
    const res = await fetch(`${BASE}/rest/v1/${table}?select=${cols.join(",")}&limit=0`, { headers: h });
    if (res.ok) {
      ok(`${table} (${cols.length} columns)`);
      continue;
    }
    const body = await res.json().catch(() => ({}));
    if (body.code === "42P01") {
      bad(`table ${table} does not exist`);
    } else if (body.code === "42703") {
      // Narrow it down: probe each column alone.
      for (const col of cols) {
        const one = await fetch(`${BASE}/rest/v1/${table}?select=${col}&limit=0`, { headers: h });
        if (!one.ok) bad(`${table}.${col}`);
      }
    } else {
      bad(`${table}: unexpected ${res.status} ${JSON.stringify(body).slice(0, 120)}`);
    }
  }

  console.log("\nfunctions:");
  for (const name of RPCS) {
    // A deliberately unknown argument: PostgREST rejects before execution.
    // If the function exists under any signature, the error's hint/message
    // names it with its real parameters; if not, there is nothing to name.
    const res = await fetch(`${BASE}/rest/v1/rpc/${name}`, {
      method: "POST",
      headers: { ...h, "content-type": "application/json" },
      body: JSON.stringify({ ___probe: true }),
    });
    const body = await res.json().catch(() => ({}));
    const text = `${body.message ?? ""} ${body.hint ?? ""}`;
    const exists =
      res.ok || new RegExp(`public\\.${name}\\s*\\(`).test(text) || /perhaps you meant/i.test(text);
    if (exists) ok(name);
    else bad(`function ${name} — ${String(body.message ?? res.status).slice(0, 100)}`);
  }

  console.log("\nbuckets:");
  const bres = await fetch(`${BASE}/storage/v1/bucket`, { headers: h });
  const buckets = bres.ok ? (await bres.json()).map((b) => b.name ?? b.id) : [];
  for (const b of BUCKETS) {
    if (buckets.includes(b)) ok(b);
    else bad(`bucket ${b}`);
  }

  console.log(
    missing === 0
      ? "\nEverything the manifest names exists in production."
      : `\n${missing} MISSING — find the pending file that creates it and run it.`,
  );
  process.exit(missing === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
