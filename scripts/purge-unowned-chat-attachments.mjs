// Remove chat-attachment uploads that no row has ever pointed at.
//
//   node scripts/purge-unowned-chat-attachments.mjs                 manifest only
//   node scripts/purge-unowned-chat-attachments.mjs --delete --confirm <N>
//
// WHY THESE EXIST. generations.attachments only started recording what a send
// carried on 2026-08-31. Every reference photo uploaded to chat before that
// has no row pointing at it and never will: the product cannot show it to the
// person who uploaded it, and nothing can find it except a capability URL
// nobody holds. They are real people's photos held for no purpose, by a
// company whose privacy policy names itself as controller — a data-
// minimization question, not a storage-cost one (72 MB, 2026-09-08).
//
// WHAT IS PROTECTED. Three independent gates, all of which must pass:
//   1. bucket is chat-attachments and nothing else — the gallery, videos and
//      layers buckets are never listed here, let alone touched;
//   2. the object is unreferenced by the SAME logic the audit uses
//      (lib/storage-references.mjs — one definition, shared, four corrections
//      deep), so an object the audit calls referenced can never appear here;
//   3. the object was created BEFORE recording began (RECORDING_STARTED). A
//      photo uploaded after that date is unreferenced only while its send is
//      in flight, and this never deletes one of those.
//
// HOW IT RUNS. Without flags it prints the manifest and exits — the operator
// reads the list. With --delete it also requires --confirm <N>, where N is
// the object count the manifest printed; a mismatch (the bucket changed since
// the list was reviewed) refuses. Deletes go through the storage API in
// batches and the response is checked per batch; a batch that fails stops
// the run and reports what was and was not removed.
import { isReferenced, listAll, loadEnv, makeClient, mb, referencedKeys } from "./lib/storage-references.mjs";

const BUCKET = "chat-attachments";
const RECORDING_STARTED = "2026-08-31T00:00:00Z";
const BATCH = 25;

const args = process.argv.slice(2);
const doDelete = args.includes("--delete");
const confirmIdx = args.indexOf("--confirm");
const confirm = confirmIdx >= 0 ? Number(args[confirmIdx + 1]) : null;

const client = makeClient(loadEnv());
const referenced = await referencedKeys(client.rest);
const objects = await listAll(client, BUCKET);

const candidates = objects.filter(
  (o) => !isReferenced(referenced, o.path) && o.createdAt && o.createdAt < RECORDING_STARTED,
);
const skippedRecent = objects.filter(
  (o) => !isReferenced(referenced, o.path) && !(o.createdAt && o.createdAt < RECORDING_STARTED),
);
const bytes = candidates.reduce((a, b) => a + b.size, 0);
const owners = new Set(candidates.map((o) => o.path.split("/")[0]));

console.log(`${BUCKET}: ${objects.length} objects, ${referenced.size} referenced keys known`);
console.log(`unreferenced and created before ${RECORDING_STARTED.slice(0, 10)}: ${candidates.length} objects, ${mb(bytes)} MB, ${owners.size} uploaders\n`);
for (const o of candidates) {
  console.log(`  ${o.createdAt.slice(0, 10)}  ${mb(o.size).padStart(6)} MB  ${o.path}`);
}
if (skippedRecent.length) {
  console.log(`\nleft alone (unreferenced but created on/after recording began): ${skippedRecent.length}`);
  for (const o of skippedRecent) console.log(`  ${o.createdAt?.slice(0, 10) ?? "?"}  ${o.path}`);
}

if (!doDelete) {
  console.log(`\nManifest only. Nothing was deleted.`);
  console.log(`To remove exactly these: node scripts/purge-unowned-chat-attachments.mjs --delete --confirm ${candidates.length}`);
  process.exit(0);
}
if (confirm !== candidates.length) {
  console.error(`\nRefusing: --confirm ${confirm} does not match the ${candidates.length} objects listed. Re-read the manifest and pass its count.`);
  process.exit(1);
}
if (candidates.length === 0) {
  console.log("\nNothing to delete.");
  process.exit(0);
}

let removed = 0;
for (let i = 0; i < candidates.length; i += BATCH) {
  const batch = candidates.slice(i, i + BATCH).map((o) => o.path);
  const res = await fetch(`${client.BASE}/storage/v1/object/${BUCKET}`, {
    method: "DELETE",
    headers: client.headers,
    body: JSON.stringify({ prefixes: batch }),
  });
  if (!res.ok) {
    console.error(`\nBatch starting at ${i} failed (${res.status}): ${(await res.text()).slice(0, 300)}`);
    console.error(`Removed ${removed} of ${candidates.length} before stopping. Re-run the manifest to see what remains.`);
    process.exit(1);
  }
  const body = await res.json();
  const got = Array.isArray(body) ? body.length : batch.length;
  removed += got;
  console.log(`  removed ${removed}/${candidates.length}`);
}
console.log(`\nDone: ${removed} objects, ${mb(bytes)} MB, from ${owners.size} uploaders. Run scripts/audit-storage.mjs to confirm the bucket reads clean.`);
