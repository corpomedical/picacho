// The buckets that hold per-user files, as ONE list shared by every deletion
// path.
//
// WHY ITS OWN MODULE (2026-09-04). This lived in profile/actions.ts and was
// exported from there so admin/actions.ts could import it instead of keeping a
// second copy — a duplicated literal is a list that only ever gets half
// updated, which is exactly how "generated-videos" came to be in one copy and
// not the other for a day.
//
// But profile/actions.ts carries "use server", and such a file may export
// ONLY async functions. Exporting an array from it builds locally and fails in
// `next build` at page-data collection ("A \"use server\" file can only export
// async functions, found object"), taking down every route that transitively
// imports it — /admin/flags first. That is what broke the production deploys
// of 807b3a8 and e6d30f4.
//
// A plain module keeps the single-source-of-truth win without the constraint.
// Do NOT move this back into either actions file, and do not add "use server"
// here.
//
// Every file a user ever uploaded or generated lives under a `${userId}/...`
// path in each of these. Deleting an account previously removed only the
// database rows (which cascade automatically); the files themselves were never
// touched, so they sat in Storage, permanently orphaned and permanently
// billed, with no record left anywhere to ever find them again.
export const USER_STORAGE_BUCKETS = [
  "character-references",
  "generated-images",
  // Added 2026-09-04, the day finished videos started being copied into our
  // own storage (persistGeneratedVideo). Without it, deleting an account
  // cascaded the rows away and left every rendered video sitting under the
  // deleted user's id — video of a real person's face surviving an erasure
  // request, with no row left to find it by. schema.sql already claimed this
  // bucket was covered here; now it is.
  "generated-videos",
  "chat-attachments",
  // Added 2026-09-05 (audit): both were created after this list was and
  // nothing ever swept them — a deleted account's uploaded source video and
  // source photos survived forever, orphaned and billed. Exactly the drift
  // this module's own header warns about: a bucket born elsewhere has to be
  // added HERE the same day, and nothing mechanical enforces that yet.
  "upscale-sources",
  "layer-sources",
];

// The one storage sweep both deletion paths share. This was two hand-copied
// loops (profile/actions.ts and admin/actions.ts) — the exact duplicated
// truth that let "generated-videos" exist in one copy and not the other for
// a day. One implementation, imported by both.
//
// Collect every path FIRST by paging with an advancing offset, then remove.
// Removing while paging would be wrong: deleting a page shifts every later
// object forward in the listing, so the next offset window would skip a
// page's worth of files.
//
// RECURSIVE, since 2026-09-05: list() is one level deep and returns a
// subfolder as a placeholder entry with id null. The Layers lane stores its
// PNGs at `${userId}/layers/${generationId}/z<N>.png`, and the old flat
// listing saw only a "layers" folder it could not remove — remove() on a
// folder key deletes nothing — so every layer image (often a person cut out
// of their own photo) survived account deletion. Walk into every folder.
export async function removeAllUserStorage(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  admin: any,
  userId: string,
): Promise<void> {
  const PAGE = 1000;
  for (const bucket of USER_STORAGE_BUCKETS) {
    try {
      const paths: string[] = [];
      const walk = async (prefix: string): Promise<void> => {
        for (let offset = 0; ; offset += PAGE) {
          const { data: entries } = await admin.storage
            .from(bucket)
            .list(prefix, { limit: PAGE, offset });
          if (!entries || entries.length === 0) break;
          for (const e of entries as { name: string; id: string | null }[]) {
            if (e.id === null) await walk(`${prefix}/${e.name}`);
            else paths.push(`${prefix}/${e.name}`);
          }
          if (entries.length < PAGE) break;
        }
      };
      await walk(userId);
      // remove() caps the number of keys it accepts per call, so delete in
      // batches rather than handing it the whole list at once.
      for (let i = 0; i < paths.length; i += PAGE) {
        await admin.storage.from(bucket).remove(paths.slice(i, i + PAGE));
      }
    } catch {
      // Best-effort — a storage hiccup here must not block the account
      // deletion itself. Worst case, a follow-up pass catches what's missed.
    }
  }
}
