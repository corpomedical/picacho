// Does production actually have what supabase/applied/ and supabase/pending/
// say it should?
//
// Schema truth lives in three places — the live DB (operator hand-pastes
// SQL), the SQL files under supabase/ (applied/<date>/ once run, pending/
// until then — see supabase/README.md), and the schema.sql snapshot — with
// nothing mechanical forcing agreement (2026-09-05 audit). The class already caused
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
    // Settings redesign (applied/2026-09-11): the notification switches and
    // the low-credit stamp, then the composer defaults. Every reader is
    // fail-open, which is exactly why a missing column would go unnoticed.
    "notify_render_ready", "notify_render_failed", "notify_low_credits", "low_credit_notified_at",
    "default_video_model", "default_aspect_ratio", "default_video_duration", "video_sound",
    "full_name",
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
  // Browser push for every account and community blocking (applied/2026-09-11).
  user_push_subscriptions: ["endpoint", "user_id", "p256dh", "auth", "locale", "last_used_at"],
  community_blocks: ["blocker_id", "blocked_id", "blocked_username"],
  // The refusal log both content gates write (applied/2026-09-11).
  policy_refusals: ["user_id", "gate", "reason", "strict_lane", "created_at"],
  notes: ["title", "body"],
  products: ["image_paths"],
  app_settings: ["key", "value"],
  feature_flags: ["key", "enabled"],
  voice_presets: ["label"],
  // The dashboard reel and the revealed-preference signals (2026-09-07). These
  // had ZERO coverage here, and user_reels is the exact table that already
  // caused this class of outage: `clips` was selected by name before its
  // migration ran, PostgREST failed the WHOLE query, and every user's reel
  // silently fell back to the example band. clips is listed FIRST for that
  // reason — it is the column a half-applied migration leaves behind.
  user_reels: [
    "user_id", "storage_path", "poster_path", "clips", "clip_generation_ids",
    "character_profile_id", "duration_seconds", "byte_size", "built_at",
  ],
  generation_signals: ["generation_id", "user_id", "kind", "created_at"],
  // The onboarding drip's claim table (2026-09-08): the cron inserts here
  // FIRST so two runs cannot both mail one person, and drip_candidates
  // excludes anyone with a row. A missing table fails the claim and skips
  // everyone — silently, since a failed claim reads as "already claimed".
  drip_sends: ["user_id", "template", "sent_at"],
  // Astra Sets (applied/2026-09-10/astra-sets.sql). Every column the actions write is
  // listed: the service role writes them, so a missing one fails a build
  // mid-flight rather than at the page.
  // The last two are Sets from a photo (pending/astra-photo-sets.sql): until
  // they exist a photo build is refused before anything is spent, and text
  // sets are untouched — but the switch must not be flipped without them.
  location_sets: [
    "user_id", "status", "brief", "title", "description", "spec", "layout",
    "response_id", "attempts", "failure", "cost_usd", "thumb_path", "updated_at", "deleted_at",
    "source_photo_path", "source_photo_sha256",
  ],
  location_set_shots: ["set_id", "generation_id", "user_id", "created_at"],
};

// Feature-flag rows the code reads by key. A missing row reads as OFF
// everywhere (every reader defaults closed), which is why nobody would
// notice — the switch simply never appears in Admin > Feature flags.
const FLAGS = ["astra_sets", "astra_photo_sets", "astra_previz", "experimental_models", "chat_agent", "voice_mode"];

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
  "drip_candidates",
];

// Functions the ANON key must NOT be able to execute (2026-09-09). Every one
// is SECURITY DEFINER and reads or moves money or personal data on behalf of
// an arbitrary user id; the app reaches them through the service role only.
// PostgreSQL grants EXECUTE to PUBLIC on creation and anon inherits from
// PUBLIC, so a function is private only if a REVOKE named public — the day
// this list was written, drip_candidates() had been "revoked" from anon and
// authenticated but not public, and answered the anon key with other
// people's email addresses. Probed by CALLING each with the anon key and
// arguments that match nothing (random uuids): a private function answers
// 42501 before running; a mis-granted one would run against no row.
const PRIVATE_RPCS = [
  "add_purchased_credits",
  "admin_user_auth_activity",
  "api_rate_check",
  "auth_email_status",
  "blast_recipient_emails",
  "claim_job_advance",
  "clawback_credit_purchase",
  "create_api_key_capped",
  "decrement_purchased_credits",
  "drip_candidates",
  "increment_free_generations",
  "insert_brand_rules_capped",
  "insert_saved_prompt_capped",
  "monthly_credits_used",
  "record_agent_units",
  "record_credit_purchase",
  "record_model_failure",
  "record_prompt_assist",
  "refund_daily_free_generation",
  "refund_free_reference_generation",
  "reserve_generation",
  "reserve_generations",
  "reserve_reference_image_generation",
  "spend_daily_free_generation",
  "spend_free_generation",
  "spend_free_reference_generation",
  "spend_purchased_credits",
];
// And the one the signup form needs BEFORE anyone is signed in.
const ANON_CALLABLE_RPCS = ["username_available"];

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
    // 42P01 from Postgres; PGRST205 when PostgREST's schema cache has no
    // such table, which is how a never-created table answers today.
    if (body.code === "42P01" || body.code === "PGRST205") {
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

  console.log("\nfeature flags:");
  const fres = await fetch(`${BASE}/rest/v1/feature_flags?select=key&key=in.(${FLAGS.join(",")})`, { headers: h });
  const present = fres.ok ? (await fres.json()).map((r) => r.key) : [];
  for (const f of FLAGS) {
    if (present.includes(f)) ok(f);
    else bad(`feature flag ${f}`);
  }

  console.log("\nbuckets:");
  const bres = await fetch(`${BASE}/storage/v1/bucket`, { headers: h });
  const buckets = bres.ok ? (await bres.json()).map((b) => b.name ?? b.id) : [];
  for (const b of BUCKETS) {
    if (buckets.includes(b)) ok(b);
    else bad(`bucket ${b}`);
  }

  // --- privileges: what the anon key can execute ---------------------------
  const ANON = env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const anonHeaders = { apikey: ANON, authorization: `Bearer ${ANON}`, "content-type": "application/json" };
  const schemaSql = fs.readFileSync(new URL("../supabase/schema.sql", import.meta.url), "utf8");
  const valueFor = (type) =>
    /uuid\[\]/.test(type) ? [crypto.randomUUID()]
    : /uuid/.test(type) ? crypto.randomUUID()
    : /int|numeric/.test(type) ? 1
    : /bool/.test(type) ? false
    : /timestamp/.test(type) ? "2026-01-01T00:00:00Z"
    : /jsonb/.test(type) ? {}
    : /text\[\]/.test(type) ? ["probe"]
    : "probe";
  const argsFor = (fn) => {
    const m = schemaSql.match(new RegExp(`CREATE OR REPLACE FUNCTION public\\.${fn}\\(([^)]*)\\)`));
    if (!m) return null;
    const out = {};
    for (const part of m[1].split(",").map((x) => x.trim()).filter(Boolean)) {
      const a = part.match(/^(\w+)\s+([^=]+?)(?:\s+DEFAULT.*)?$/);
      if (a) out[a[1]] = valueFor(a[2]);
    }
    return out;
  };
  const anonCall = async (fn) => {
    const res = await fetch(`${BASE}/rest/v1/rpc/${fn}`, {
      method: "POST",
      headers: anonHeaders,
      body: JSON.stringify(argsFor(fn) ?? {}),
    });
    return { status: res.status, text: (await res.text()).replace(/\s+/g, " ") };
  };

  console.log("\nanon key may NOT execute:");
  for (const fn of PRIVATE_RPCS) {
    if (argsFor(fn) === null) { bad(`${fn} — no signature in schema.sql, cannot probe`); continue; }
    const r = await anonCall(fn);
    if (/42501/.test(r.text)) ok(fn);
    // Status only, never the body: an exposed function's body IS the leak
    // (drip_candidates answered with real email addresses), and a verifier's
    // output ends up in terminals and logs.
    else bad(`${fn} EXPOSED to the anon key — answered ${r.status} with ${r.text.length} bytes`);
  }
  console.log("\nanon key MUST be able to execute:");
  for (const fn of ANON_CALLABLE_RPCS) {
    const r = await anonCall(fn);
    if (/42501/.test(r.text)) bad(`${fn} blocked for anon — signup's availability check would fail`);
    else ok(fn);
  }

  console.log(
    missing === 0
      ? "\nEverything the manifest names exists in production."
      : `\n${missing} PROBLEM(S) — a missing object needs its pending file run; an EXPOSED function needs its revoke.`,
  );
  process.exit(missing === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
