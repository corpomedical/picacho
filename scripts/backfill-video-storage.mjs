// Backfill generations.result_url (and the community snapshot) onto our own
// storage — the videos made before 2026-09-04.
//
// WHY THIS EXISTS. Until 2026-09-04 a finished video was never copied
// anywhere: the collect path wrote the provider's own CDN url straight into
// generations.result_url. fal support, asked directly that day: "If not set,
// by default we can only guarantee 7 days, even though they may stay longer."
// Two changes shipped in response — every submit now asks for no expiration,
// and every new video is copied into the private generated-videos bucket — but
// neither touches a row that already exists.
//
// AND THE COMMUNITY FEED IS THE HALF THAT IS EASY TO MISS. community_posts
// SNAPSHOTS media_url at share time. Its schema note says that is safe because
// "media URLs are the app's non-expiring signed /api/media capabilities, so a
// snapshot never goes stale" — true for images, which were always persisted,
// and FALSE for video, which snapshotted the provider's url. So a shared video
// post holds its own copy of exactly the link on the seven-day guarantee, and
// a backfill that rewrites only generations would leave the feed pointing at
// the old one. This walks both, in that order, per row.
//
// MEASURED BEFORE WRITING THIS, 2026-09-04: 58 pre-deploy video rows, 54 of
// them past the seven-day mark, and ZERO confirmed dead — three of the oldest
// urls (2026-08-07, 28 days) still return 200 with real mp4 bytes. So this is
// not a rescue of lost files; it is taking the files off someone else's
// goodwill while they are all still there.
//
// SAFE TO RE-RUN. Idempotent by construction: it only selects rows whose
// result_url still starts with http, and a row it has already moved starts
// with /api/media/ and is never selected again. A run that dies halfway leaves
// the rows it finished finished. Nothing is deleted from the provider — their
// copy stays where it is, which is what makes a failed row harmless.
//
// WHAT IT SKIPS, and says so:
//   * mock://generated-result — mock-provider runs, not real videos (there are
//     two, from 2026-08-04). Anything not starting with http is skipped.
//   * soft-deleted rows (deleted_at) — the file is already gone by policy.
//   * anything already on /api/media/.
//   * a url the provider no longer serves — recorded as dead, left alone. The
//     row keeps its url rather than being blanked: a link that might come back
//     is worth more than a row that definitely shows nothing.
//
// Usage, from the repo root:
//   node scripts/backfill-video-storage.mjs          # report only, writes nothing
//   node scripts/backfill-video-storage.mjs --apply  # download, upload, rewrite

import fs from "node:fs";
import crypto from "node:crypto";

const APPLY = process.argv.includes("--apply");

const env = Object.fromEntries(
  fs
    .readFileSync(new URL("../.env.local", import.meta.url), "utf8")
    .split("\n")
    .filter((l) => l.includes("=") && !l.startsWith("#"))
    .map((l) => [l.slice(0, l.indexOf("=")).trim(), l.slice(l.indexOf("=") + 1).trim()]),
);

const BASE = env.NEXT_PUBLIC_SUPABASE_URL;
const KEY = env.SUPABASE_SERVICE_ROLE_KEY;
const SIGNING = env.MEDIA_SIGNING_SECRET || env.SUPABASE_SERVICE_ROLE_KEY;

if (!BASE || !KEY) throw new Error("Supabase env missing from .env.local");

const h = { apikey: KEY, authorization: `Bearer ${KEY}`, "content-type": "application/json" };

// Must match hmac() in src/lib/media/url.ts EXACTLY — base64url, truncated to
// 24. A url minted with a different digest, a different truncation or a
// different secret 403s at /api/media, and the failure would look exactly like
// "the backfill lost the videos". The self-check below proves it rather than
// trusting this comment.
function mediaSig(bucket, path) {
  return crypto.createHmac("sha256", SIGNING).update(`${bucket}/${path}`).digest("base64url").slice(0, 24);
}
function mediaUrl(bucket, path) {
  const encoded = path.split("/").map(encodeURIComponent).join("/");
  return `/api/media/${bucket}/${encoded}?v=${mediaSig(bucket, path)}`;
}

const MAX_BYTES = 200 * 1024 * 1024;

// PROVE THE SIGNATURE BEFORE WRITING ANYTHING.
//
// The app prefers MEDIA_SIGNING_SECRET and falls back to the service-role key.
// If production has the dedicated secret set and this machine does not, every
// url this script mints is signed under the wrong key — the rows would be
// rewritten to addresses that 403, and the videos would be, in effect, lost by
// the thing sent to save them.
//
// So: take a real image row that is ALREADY on /api/media, re-mint its url
// from its own storage path with the local secret, and ask production for it.
// If the two secrets agree the fetch is a 200. Anything else aborts.
async function assertSignatureMatchesProduction(site) {
  const probe = await fetch(
    `${BASE}/rest/v1/generations?select=result_url&content_type=eq.image&status=eq.succeeded` +
      `&result_url=like./api/media/generated-images/*&limit=1`,
    { headers: h },
  ).then((r) => r.json());
  const sample = Array.isArray(probe) && probe[0]?.result_url;
  if (!sample) {
    console.log("No existing /api/media image row to check the signature against — skipping the check.");
    return;
  }
  const path = decodeURIComponent(sample.split("?")[0].replace("/api/media/generated-images/", ""));
  const minted = `${site}${mediaUrl("generated-images", path)}`;
  const res = await fetch(minted, { method: "HEAD" });
  if (res.ok) {
    console.log(`Signature check: OK (${res.status}) — urls minted here verify in production.\n`);
    return;
  }
  throw new Error(
    `Signature check FAILED (${res.status}).\n` +
      `A url minted on this machine does not verify against ${site}, which means the signing secret\n` +
      `here differs from production's. Copy production's MEDIA_SIGNING_SECRET into .env.local and\n` +
      `re-run. Nothing has been written.`,
  );
}

async function main() {
  const site = (env.NEXT_PUBLIC_SITE_URL || "https://picacho.ai").replace(/\/$/, "");
  if (APPLY) await assertSignatureMatchesProduction(site);

  const url =
    `${BASE}/rest/v1/generations` +
    `?select=id,user_id,result_url,created_at` +
    `&content_type=eq.video&status=eq.succeeded&deleted_at=is.null` +
    `&result_url=like.http*&order=created_at.asc`;
  const rows = await fetch(url, { headers: h }).then((r) => r.json());
  if (!Array.isArray(rows)) throw new Error(`Unexpected response: ${JSON.stringify(rows).slice(0, 300)}`);

  console.log(`${rows.length} video rows still pointing at a provider CDN.`);
  console.log(APPLY ? "APPLYING — downloading, uploading, rewriting.\n" : "DRY RUN — nothing will be written.\n");

  let moved = 0, dead = 0, failed = 0, posts = 0, bytes = 0;

  for (const row of rows) {
    const label = `${row.id.slice(0, 8)} ${String(row.created_at).slice(0, 10)}`;

    // HEAD first: a dead provider url is the one case worth reporting loudly,
    // and it costs nothing to find out before pulling megabytes.
    let head;
    try {
      head = await fetch(row.result_url, { method: "HEAD", redirect: "follow" });
    } catch (err) {
      console.log(`  ${label}  UNREACHABLE  ${err.message}`);
      failed += 1;
      continue;
    }
    if (!head.ok) {
      console.log(`  ${label}  DEAD (${head.status}) — left as it is`);
      dead += 1;
      continue;
    }
    const declared = Number(head.headers.get("content-length") ?? "0");
    if (declared > MAX_BYTES) {
      console.log(`  ${label}  TOO BIG (${declared} bytes) — left as it is`);
      failed += 1;
      continue;
    }

    if (!APPLY) {
      console.log(`  ${label}  would move (${declared || "unknown"} bytes)`);
      moved += 1;
      continue;
    }

    try {
      const res = await fetch(row.result_url);
      if (!res.ok) throw new Error(`GET ${res.status}`);
      const buf = Buffer.from(await res.arrayBuffer());
      if (buf.byteLength > MAX_BYTES) throw new Error(`${buf.byteLength} bytes over cap`);

      const contentType = res.headers.get("content-type") ?? "video/mp4";
      const ext = contentType.includes("quicktime") ? "mov" : "mp4";
      const path = `${row.user_id}/${crypto.randomUUID()}.${ext}`;

      const up = await fetch(`${BASE}/storage/v1/object/generated-videos/${path}`, {
        method: "POST",
        headers: { apikey: KEY, authorization: `Bearer ${KEY}`, "content-type": contentType },
        body: buf,
      });
      if (!up.ok) throw new Error(`upload ${up.status}: ${(await up.text()).slice(0, 200)}`);

      const next = mediaUrl("generated-videos", path);

      // The generation first. If the community update below fails, the feed
      // still points at the provider url, which is alive — the state this row
      // was already in. The reverse order would point the feed at a file the
      // generation had not yet been rewritten to own.
      const g = await fetch(`${BASE}/rest/v1/generations?id=eq.${row.id}`, {
        method: "PATCH",
        headers: { ...h, prefer: "return=minimal" },
        body: JSON.stringify({ result_url: next }),
      });
      if (!g.ok) throw new Error(`generations patch ${g.status}`);

      // Then the snapshot, matched on the OLD url so a post that was already
      // updated, or one that never carried this url, is left alone.
      const c = await fetch(
        `${BASE}/rest/v1/community_posts?generation_id=eq.${row.id}&media_url=eq.${encodeURIComponent(row.result_url)}`,
        {
          method: "PATCH",
          headers: { ...h, prefer: "return=representation" },
          body: JSON.stringify({ media_url: next }),
        },
      );
      if (!c.ok) throw new Error(`community patch ${c.status}`);
      const touched = await c.json();
      if (Array.isArray(touched) && touched.length > 0) posts += touched.length;

      bytes += buf.byteLength;
      moved += 1;
      console.log(
        `  ${label}  moved ${buf.byteLength} bytes` +
          (Array.isArray(touched) && touched.length ? `  + ${touched.length} community post` : ""),
      );
    } catch (err) {
      console.log(`  ${label}  FAILED  ${err.message}`);
      failed += 1;
    }
  }

  console.log(
    `\n${APPLY ? "Moved" : "Would move"} ${moved}` +
      (APPLY ? ` (${(bytes / 1024 / 1024).toFixed(1)} MB), ${posts} community post(s) repointed` : "") +
      `; ${dead} already dead at the provider; ${failed} failed.`,
  );
  if (!APPLY && moved > 0) console.log("Re-run with --apply to write.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
