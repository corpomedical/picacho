// Every enabled Stripe webhook endpoint must live on the canonical origin.
//
// Real incident, 2026-09-09: the endpoint was registered at www.picacho.ai
// on Aug 9. On Aug 12 an audit made the apex canonical with a permanent 308
// from www. Stripe does not follow redirects on webhook POSTs, so every
// subscription event after that bounced — and none fired until the first
// renewal a month later, which sat failing for six hours before anyone saw
// it. This check turns that class of drift into a failed verify.
//
// Skips cleanly without a key (CI, a fresh clone); fails only when it can
// look and finds an endpoint off-canonical.
import { readFileSync, existsSync } from "node:fs";

const CANONICAL = "https://picacho.ai";
if (existsSync(".env.local")) {
  for (const l of readFileSync(".env.local", "utf8").split("\n")) {
    if (!l.includes("=") || l.startsWith("#")) continue;
    const i = l.indexOf("=");
    process.env[l.slice(0, i).trim()] ??= l.slice(i + 1).trim().replace(/^["']|["']$/g, "");
  }
}
const key = process.env.STRIPE_SECRET_KEY;
if (!key) { console.log("stripe endpoint: skipped (no STRIPE_SECRET_KEY)"); process.exit(0); }

const r = await fetch("https://api.stripe.com/v1/webhook_endpoints?limit=20", { headers: { Authorization: `Bearer ${key}` } });
if (!r.ok) { console.error("stripe endpoint: could not list endpoints", r.status); process.exit(1); }
const { data } = await r.json();
const bad = data.filter((e) => e.status === "enabled" && !e.url.startsWith(CANONICAL + "/"));
for (const e of data) console.log(`  ${e.status.padEnd(8)} ${e.url}${bad.includes(e) ? "   <- NOT on " + CANONICAL : ""}`);
if (bad.length) {
  console.error(`stripe endpoint: ${bad.length} enabled endpoint(s) off the canonical origin. A www.→apex 308 makes these fail silently; edit the destination URL in the Stripe dashboard.`);
  process.exit(1);
}
console.log("stripe endpoint: clean");
