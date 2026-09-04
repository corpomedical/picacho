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
];
