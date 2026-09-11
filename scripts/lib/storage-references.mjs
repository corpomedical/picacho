// The one definition of "which stored objects does something still point at".
//
// Extracted from audit-storage.mjs on 2026-09-09 so that the purge script and
// the audit cannot disagree: the audit took FOUR corrections to get this set
// right (see its header), and a second copy of the logic in a script that
// DELETES is exactly where a fifth mistake would be expensive. Both import
// this. Change it here, and only here.
//
// Read-only: it lists tables and it lists buckets. Nothing in this file
// writes.
import fs from "node:fs";

export function loadEnv() {
  const env = Object.fromEntries(
    fs.readFileSync(new URL("../../.env.local", import.meta.url), "utf8")
      .split("\n")
      .filter((l) => l.includes("=") && !l.startsWith("#"))
      .map((l) => [l.slice(0, l.indexOf("=")).trim(), l.slice(l.indexOf("=") + 1).trim()]),
  );
  if (!env.NEXT_PUBLIC_SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error("Supabase env missing from .env.local");
  }
  return env;
}

export function makeClient(env) {
  const BASE = env.NEXT_PUBLIC_SUPABASE_URL;
  const KEY = env.SUPABASE_SERVICE_ROLE_KEY;
  const h = { apikey: KEY, authorization: `Bearer ${KEY}`, "content-type": "application/json" };
  const rest = async (q) => (await fetch(`${BASE}/rest/v1/${q}`, { headers: h })).json();
  return { BASE, headers: h, rest };
}

/** Storage key out of any URL shape we have ever stored, or null. */
export function storageKey(value) {
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

/**
 * Every storage key some row still points at. Four owners, not one (that was
 * correction one), every select names only columns that exist or uses *
 * (correction two), and ?v= is stripped from bare keys (correction four).
 * Correction three — a watermarked copy counts as referenced when its
 * sibling original does — lives in isReferenced below.
 */
// Every row, not the first page. PostgREST caps a response at 1,000 rows
// regardless of `limit`, and a set that silently stops there is a purge that
// starts deleting referenced files the day a table outgrows a page. Ordered
// by id so pages cannot overlap or skip while rows are being inserted.
async function allRows(rest, table, select) {
  const out = [];
  const PAGE = 1000;
  for (let offset = 0; ; offset += PAGE) {
    const rows = await rest(`${table}?select=${select}&order=id.asc&limit=${PAGE}&offset=${offset}`);
    out.push(...rows);
    if (rows.length < PAGE) return out;
  }
}

// THE BUCKETS THIS SET IS VALID FOR. It reads the columns that point into
// these four, and no others — character-references is pointed at by
// character_profiles.reference_image_urls / outfit_image_urls, which this
// does NOT read, so a caller that audits that bucket against this set would
// see every character photo as unreferenced. Callers must check.
export const REFERENCE_SET_COVERS = new Set([
  "generated-images",
  "generated-videos",
  "chat-attachments",
  "layer-sources",
]);

export async function referencedKeys(rest) {
  const referenced = new Set();
  const add = (v) => {
    const k = storageKey(v);
    if (k) referenced.add(k);
  };
  for (const g of await allRows(rest, "generations", "id,result_url,poster_url,attachments")) {
    add(g.result_url);
    add(g.poster_url);
    for (const a of g.attachments ?? []) add(a);
  }
  for (const r of await allRows(rest, "user_reels", "id,storage_path,poster_path")) {
    add(r.storage_path);
    add(r.poster_path);
  }
  for (const c of await allRows(rest, "community_posts", "id,media_url")) add(c.media_url);
  for (const l of await allRows(rest, "generation_layers", "id,storage_path")) add(l.storage_path);
  // A Set's card and, for a set built from a photo, the photo (2026-09-11).
  // Read with * so this works before supabase/pending/astra-photo-sets.sql
  // adds the photo column (naming it would fail the whole read until then).
  // Both are bare keys in generated-images.
  for (const s of await allRows(rest, "location_sets", "*")) {
    add(s.thumb_path);
    add(s.source_photo_path);
  }
  return referenced;
}

export function isReferenced(referenced, path) {
  if (referenced.has(path)) return true;
  const wm = path.match(/^(.+)\/wm\/(.+)$/);
  return wm ? referenced.has(`${wm[1]}/${wm[2]}`) : false;
}

/** Every object in a bucket, recursively, with size and created_at. */
export async function listAll(client, bucket, prefix = "", depth = 0, out = []) {
  if (depth > 3) return out;
  const res = await fetch(`${client.BASE}/storage/v1/object/list/${bucket}`, {
    method: "POST",
    headers: client.headers,
    body: JSON.stringify({ prefix, limit: 1000, offset: 0, sortBy: { column: "name", order: "asc" } }),
  });
  const items = await res.json();
  if (!Array.isArray(items)) return out;
  for (const it of items) {
    const path = prefix ? `${prefix}/${it.name}` : it.name;
    // A null id is how the list API reports a folder.
    if (it.id === null) await listAll(client, bucket, path, depth + 1, out);
    else out.push({ path, size: it.metadata?.size ?? 0, createdAt: it.created_at ?? null });
  }
  return out;
}

export const mb = (n) => (n / 1048576).toFixed(1);
