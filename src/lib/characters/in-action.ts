// A character's own finished work — the character page's "In action" strip,
// and Helios Studio's "Look" strip (its images only) with the server's check
// of a picked look. One source and one rule, so the three can't drift
// (2026-09-30, live check: the Look strip said "No pictures of Eva in your
// gallery yet" beside her page's eight finished images — it asked for a
// `prompt` column the generations table doesn't have (it is `prompt_input`),
// so every read failed and read as none).
//
// The rule: the person's own row, of THIS character (character_profile_id),
// finished (status "succeeded"), not deleted, with a file. The Look strip and
// its check narrow it to images (content_type "image"; the table holds only
// "image" and "video").

/** The columns the strips read — every one of them a column of public.generations (in-action.test.ts pins it to the schema). */
export const IN_ACTION_COLUMNS = ["id", "result_url", "poster_url", "match_score", "content_type", "prompt_input", "created_at"] as const;
/** What the check of a picked look reads. */
export const IN_ACTION_CHECK_COLUMNS = ["id", "user_id", "character_profile_id", "status", "deleted_at", "result_url", "content_type"] as const;

// The query builder's shape, as much of it as this uses (supabase-js's own
// builder, or a test's stand-in).
type Query = {
  eq: (column: string, value: unknown) => Query;
  is: (column: string, value: null) => Query;
  not: (column: string, op: string, value: unknown) => Query;
  order: (column: string, o: { ascending: boolean }) => Query;
  limit: (n: number) => PromiseLike<{ data: unknown[] | null; error: unknown }>;
};
type Db = { from: (table: string) => { select: (columns: string) => unknown } };

/** The character's finished work, newest first: "In action", or with `imagesOnly` the Look strip. */
export function inActionRows(db: Db, a: { userId: string; characterId: string; limit: number; imagesOnly?: boolean }) {
  let q = (db.from("generations").select(IN_ACTION_COLUMNS.join(", ")) as Query)
    .eq("user_id", a.userId)
    .eq("character_profile_id", a.characterId)
    .eq("status", "succeeded")
    // deleteGeneration soft-deletes the ROW but hard-deletes the FILE, so a
    // deleted render still matches every other clause here — and its media
    // URL 404s (operator, the strip's first day: "some pictures are not loading").
    .is("deleted_at", null)
    .not("result_url", "is", null);
  if (a.imagesOnly) q = q.eq("content_type", "image");
  return q.order("created_at", { ascending: false }).limit(a.limit);
}

/** Whether one row is this person's finished image of this character: the Look strip's rule, row by row. */
export function isInActionImage(row: Record<string, unknown> | null | undefined, a: { userId: string; characterId: string }): boolean {
  return (
    !!row &&
    row.user_id === a.userId &&
    row.character_profile_id === a.characterId &&
    row.status === "succeeded" &&
    row.deleted_at == null &&
    typeof row.result_url === "string" &&
    row.result_url.length > 0 &&
    row.content_type === "image"
  );
}
