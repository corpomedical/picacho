// The likeness answers (likeness.ts), read and written. The only file that
// names the table (pending/character-likeness-consent.sql). Written with the
// service client only: people read their own answers, never write them.
// A missing table (the SQL not run yet) reads as "no answer" and says so,
// once, in the logs; the callers decide what that means for them.

import type { SupabaseClient } from "@supabase/supabase-js";
import { LIKENESS_METHOD, LIKENESS_NOTICE_VERSION, parseLikeness, type LikenessAnswer, type LikenessPlace, type LikenessRecord } from "./likeness";

const TABLE = "character_likeness_consents";

/** PostgREST's "no such table" (the schema cache), and Postgres's own. */
function isMissingTable(error: { code?: string; message?: string } | null | undefined): boolean {
  return Boolean(error && (error.code === "PGRST205" || error.code === "42P01" || /does not exist|schema cache/i.test(error.message ?? "")));
}

let warned = false;
function warnMissing() {
  if (warned) return;
  warned = true;
  console.error(`[likeness] ${TABLE} is missing — run supabase/pending/character-likeness-consent.sql`);
}

/** The latest answer for each of these characters, the person's own; `missing` when the table isn't there. */
export async function readLikeness(
  db: SupabaseClient,
  userId: string,
  characterIds: readonly string[],
): Promise<{ records: Map<string, LikenessRecord>; missing: boolean }> {
  const records = new Map<string, LikenessRecord>();
  if (characterIds.length === 0) return { records, missing: false };
  try {
    const { data, error } = await db
      .from(TABLE)
      .select("character_id, answer, photos_hash, consented_at")
      .eq("user_id", userId)
      .in("character_id", [...characterIds])
      .order("consented_at", { ascending: false })
      .limit(500);
    if (error) {
      if (isMissingTable(error)) {
        warnMissing();
        return { records, missing: true };
      }
      console.error("[likeness] read failed:", error.message);
      return { records, missing: false };
    }
    for (const row of data ?? []) {
      const id = typeof row.character_id === "string" ? row.character_id : null;
      const answer = parseLikeness(row.answer);
      if (!id || !answer || records.has(id)) continue;
      records.set(id, { answer, photosHash: String(row.photos_hash ?? ""), consentedAt: String(row.consented_at ?? "") });
    }
  } catch (err) {
    console.error("[likeness] read failed:", err instanceof Error ? err.message : String(err));
  }
  return { records, missing: false };
}

/** Keep an answer. `missing` when the table isn't there; any other failure is `failed`. */
export async function recordLikeness(
  admin: SupabaseClient,
  row: { userId: string; characterId: string; answer: LikenessAnswer; photosHash: string; locale: string; place: LikenessPlace },
): Promise<"ok" | "missing" | "failed"> {
  try {
    const { error } = await admin.from(TABLE).insert({
      user_id: row.userId,
      character_id: row.characterId,
      answer: row.answer,
      photos_hash: row.photosHash,
      notice_version: LIKENESS_NOTICE_VERSION,
      locale: row.locale,
      method: LIKENESS_METHOD,
      place: row.place,
    });
    if (!error) return "ok";
    if (isMissingTable(error)) {
      warnMissing();
      return "missing";
    }
    console.error("[likeness] record failed:", error.message);
    return "failed";
  } catch (err) {
    console.error("[likeness] record failed:", err instanceof Error ? err.message : String(err));
    return "failed";
  }
}
