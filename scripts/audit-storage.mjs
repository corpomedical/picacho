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
import { isReferenced as isRef, listAll as listAllIn, loadEnv, makeClient, mb, referencedKeys } from "./lib/storage-references.mjs";

// The reference set, the key matcher and the lister all live in
// lib/storage-references.mjs as of 2026-09-09, shared with the purge script
// so the two can never disagree about what "unreferenced" means. Every
// correction described above is encoded THERE.
const client = makeClient(loadEnv());
const referenced = await referencedKeys(client.rest);
const listAll = (bucket) => listAllIn(client, bucket);
const isReferenced = (path) => isRef(referenced, path);
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
