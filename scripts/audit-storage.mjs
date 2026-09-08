// Which stored objects does nothing point at any more?
//
// READ-ONLY by construction: it lists and it compares. It never deletes, and
// it should not learn to — an object this says is unreferenced may simply be
// referenced by something the manifest below has not been taught about yet,
// which is exactly what happened three times while writing it.
//
//   node scripts/audit-storage.mjs
//
// Getting the REFERENCED set right is the whole job, and the FOUR corrections
// it took are encoded here so nobody has to rediscover them. Each one made the
// orphan figure smaller; the first answer was three times the real one:
//
//   1. generations is not the only owner. user_reels holds storage_path and
//      poster_path, community_posts holds media_url, and generation_layers
//      holds storage_path. Counting only generations reported reel artifacts
//      as garbage.
//   2. community_posts has NO poster_url column. Selecting one made PostgREST
//      fail the WHOLE query — the same trap that once blanked every user's
//      reel. Every select here names only columns that exist, or uses *.
//   3. A watermarked copy at <user>/wm/<file> is referenced by the GALLERY,
//      which finds it by matching the ORIGINAL's filename rather than through
//      any stored column (src/app/gallery/page.tsx). Comparing full paths
//      reported 47.7 MB of the public gallery as orphaned. A wm object counts
//      as referenced when its sibling original does.
//
//   4. Some bare keys keep their ?v= signature (generations.attachments does),
//      so the query has to be stripped from those too. Without it
//      chat-attachments reported 59 of 59 objects unreferenced — the matcher,
//      not the data.
//
// First run, 2026-09-08: 289 objects / 835.5 MB across the three readable
// buckets, of which 78 objects / 109.9 MB unreferenced.
//
// 72 MB of that is chat-attachments, and it has an explanation rather than a
// bug behind it: generations.attachments only started recording what a send
// carried on 2026-08-31, so every photo uploaded before that has no row
// pointing at it and never will. Exactly ONE generation in the database
// records an attachment. These are user-uploaded photos with no owner row —
// reachable only by a capability URL nobody holds, but real files belonging
// to real people, which is a retention question rather than a cost one at
// this size.
//
// layer-sources reads as empty. Confirm that is true before concluding it,
// rather than assuming the bucket is unused.
import fs from "node:fs";

const env = Object.fromEntries(
  fs.readFileSync(new URL("../.env.local", import.meta.url), "utf8")
    .split("\n")
    .filter((l) => l.includes("=") && !l.startsWith("#"))
    .map((l) => [l.slice(0, l.indexOf("=")).trim(), l.slice(l.indexOf("=") + 1).trim()]),
);
const BASE = env.NEXT_PUBLIC_SUPABASE_URL;
const KEY = env.SUPABASE_SERVICE_ROLE_KEY;
if (!BASE || !KEY) throw new Error("Supabase env missing from .env.local");
const h = { apikey: KEY, authorization: `Bearer ${KEY}`, "content-type": "application/json" };

const rest = async (q) => (await fetch(`${BASE}/rest/v1/${q}`, { headers: h })).json();

/** Storage key out of any URL shape we have ever stored, or null. */
function storageKey(value) {
  if (typeof value !== "string") return null;
  const m =
    value.match(/\/api\/media\/[^/]+\/([^?]+)/) ||
    value.match(/\/object\/(?:sign|public)\/[^/]+\/([^?]+)/);
  if (m) return decodeURIComponent(m[1]);
  // Bare keys are stored directly in some columns (attachments, layers) — and
  // some of them KEEP their ?v= signature, so the query has to come off here
  // too or nothing matches. That is correction four: chat-attachments first
  // reported 59 of 59 objects unreferenced, which was this bug and not the
  // data.
  return value.startsWith("http") ? null : decodeURIComponent(value.split("?")[0]);
}

const referenced = new Set();
const add = (v) => {
  const k = storageKey(v);
  if (k) referenced.add(k);
};

for (const g of await rest("generations?select=*&limit=2000")) {
  add(g.result_url);
  add(g.poster_url);
  for (const a of g.attachments ?? []) add(a);
}
for (const r of await rest("user_reels?select=*")) {
  add(r.storage_path);
  add(r.poster_path);
}
for (const c of await rest("community_posts?select=*&limit=2000")) add(c.media_url);
for (const l of await rest("generation_layers?select=*&limit=2000")) add(l.storage_path);

async function listAll(bucket, prefix = "", depth = 0, out = []) {
  if (depth > 3) return out;
  const res = await fetch(`${BASE}/storage/v1/object/list/${bucket}`, {
    method: "POST",
    headers: h,
    body: JSON.stringify({ prefix, limit: 1000, offset: 0, sortBy: { column: "name", order: "asc" } }),
  });
  const items = await res.json();
  if (!Array.isArray(items)) return out;
  for (const it of items) {
    const path = prefix ? `${prefix}/${it.name}` : it.name;
    // A null id is how the list API reports a folder.
    if (it.id === null) await listAll(bucket, path, depth + 1, out);
    else out.push({ path, size: it.metadata?.size ?? 0 });
  }
  return out;
}

const isReferenced = (path) => {
  if (referenced.has(path)) return true;
  const wm = path.match(/^(.+)\/wm\/(.+)$/);
  return wm ? referenced.has(`${wm[1]}/${wm[2]}`) : false;
};

const mb = (n) => (n / 1048576).toFixed(1);
console.log(`referenced keys: ${referenced.size}`);
let orphanBytes = 0;
let orphanCount = 0;

for (const bucket of ["generated-videos", "generated-images", "chat-attachments", "layer-sources"]) {
  const objects = await listAll(bucket);
  if (!objects.length) {
    console.log(`\n${bucket}: empty or unreadable`);
    continue;
  }
  const orphans = objects.filter((o) => !isReferenced(o.path));
  orphanBytes += orphans.reduce((a, b) => a + b.size, 0);
  orphanCount += orphans.length;
  console.log(
    `\n${bucket}: ${objects.length} objects, ${mb(objects.reduce((a, b) => a + b.size, 0))} MB`,
  );
  console.log(`  unreferenced: ${orphans.length} (${mb(orphans.reduce((a, b) => a + b.size, 0))} MB)`);
  for (const o of orphans.slice(0, 10)) console.log(`     ${mb(o.size).padStart(7)} MB  ${o.path}`);
  if (orphans.length > 10) console.log(`     … and ${orphans.length - 10} more`);
}

console.log(`\nTOTAL unreferenced: ${orphanCount} objects, ${mb(orphanBytes)} MB`);
console.log("Nothing was deleted. Confirm an object is truly unowned before removing it.");
