#!/usr/bin/env node
// Tell Bing (and every other IndexNow engine: Yandex, Seznam, Naver, Yep)
// which picacho.ai pages exist or changed. Written 2026-09-22.
//
// Why: Google is not the only door any more. ChatGPT search, Copilot,
// DuckDuckGo and Yahoo answer from Bing's index, and Bing takes URLs straight
// from the site through IndexNow, no account needed: the key file below,
// served from our own domain, is the proof that we own it.
//
//   node scripts/indexnow.mjs              every URL in the live sitemap
//   node scripts/indexnow.mjs /pricing /es one or more paths
//   node scripts/indexnow.mjs --dry-run    print what would be sent
//
// Send a page again only when its words change (the same rule as
// src/lib/page-dates.ts); engines ignore repeats and may slow a site that
// pings for nothing.

const HOST = "picacho.ai";
const ORIGIN = `https://${HOST}`;
// Public by design: IndexNow reads it from the file of the same name.
const KEY = "e4932d2e0f558cc54f9c437a526f9be1";
const KEY_LOCATION = `${ORIGIN}/${KEY}.txt`;
const ENDPOINT = "https://api.indexnow.org/indexnow";

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const paths = args.filter((a) => !a.startsWith("--"));

async function sitemapUrls() {
  const res = await fetch(`${ORIGIN}/sitemap.xml`);
  if (!res.ok) throw new Error(`sitemap answered ${res.status}`);
  const xml = await res.text();
  return [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1].trim());
}

const urls = paths.length
  ? paths.map((p) => (p.startsWith("http") ? p : `${ORIGIN}${p.startsWith("/") ? p : `/${p}`}`))
  : await sitemapUrls();

const foreign = urls.filter((u) => new URL(u).host !== HOST);
if (foreign.length) {
  console.error(`Not on ${HOST}, so IndexNow would refuse the batch:\n  ${foreign.join("\n  ")}`);
  process.exit(1);
}

// The engines fetch this file to check the key. If the deploy that adds it
// isn't live yet, they answer 403 and forget the batch, so look first.
const keyRes = await fetch(KEY_LOCATION);
const keyBody = keyRes.ok ? (await keyRes.text()).trim() : "";
if (keyBody !== KEY) {
  console.error(`${KEY_LOCATION} answered ${keyRes.status}${keyRes.ok ? " with the wrong text" : ""}. Push the commit that adds it, wait for the deploy, then run this again.`);
  process.exit(1);
}

console.log(`${urls.length} URL${urls.length === 1 ? "" : "s"} for ${HOST}:`);
for (const u of urls) console.log(`  ${u}`);
if (dryRun) {
  console.log("Dry run: nothing sent.");
  process.exit(0);
}

const res = await fetch(ENDPOINT, {
  method: "POST",
  headers: { "content-type": "application/json; charset=utf-8" },
  body: JSON.stringify({ host: HOST, key: KEY, keyLocation: KEY_LOCATION, urlList: urls }),
});
const text = await res.text().catch(() => "");
// 200 = received; 202 = received, the key is still being checked.
const meaning = {
  200: "received",
  202: "received; the key is still being checked",
  400: "bad request",
  403: "key not accepted (is the key file live?)",
  422: "a URL doesn't belong to the host, or the key doesn't match",
  429: "too many requests; try again later",
}[res.status] ?? "unexpected answer";
console.log(`IndexNow answered ${res.status}: ${meaning}${text ? `\n${text}` : ""}`);
process.exit(res.status === 200 || res.status === 202 ? 0 : 1);
