"use server";

import { createAdminClient } from "@/lib/supabase/server";
import { rateLimited } from "@/lib/rate-limit";
import { setsAccess, UUID_RE } from "@/lib/sets/access";
import { countSetBuildsThisMonth } from "@/lib/sets/data";
import { SET_NOT_FOUND, SET_NOT_READY } from "@/lib/sets/messages";
import { cleanText, normaliseSetSpec, type SetSpec } from "@/lib/sets/set-spec";
import {
  askShotReader,
  askShotWords,
  parseShotWords,
  shotWordsInstructions,
  SHOT_WORDS_MAX_CHARS,
  SHOT_WORDS_PER_10_MIN,
  type ShotWords,
} from "@/lib/sets/shot-words";
import {
  parseShotReading,
  SHOT_READER_MAX_COMPLETION,
  SHOT_READER_V2_OPEN_TO_ALL,
  type ReaderAliases,
  type ReaderWhy,
  type ShotReading,
} from "@/lib/sets/shot-reading";
import {
  normaliseReaderNow,
  normaliseReaderTurns,
  readerMessages,
  readerNowLine,
  readerStageBlock,
  readerThings,
  readerTurnsBlock,
  type ReaderCharacter,
} from "@/lib/sets/reader-context";

// Reading a person's words about a shot (Astra chat, 2026-09-14). Its own
// "use server" file: every export here is a client-callable action — one
// for a set's page (v1), one for the Sets home, and reader v2 for a set's
// page (readShotTurn, Helios Cut 2, step 6, 2026-09-25).
//
// Both hand back FIELDS (shot-words.ts ShotWords), never the model's text:
// the page composes what it says from its own sentences, in the person's
// language. Both FAIL OPEN: any failure past the access check is
// `words: null`, and the page takes the message as what happens in the
// frame, because a reader that is down must never stop a shot.
//
// NOTHING IS STORED here. The message goes to the reader inline and is not
// logged; what a shot keeps of it is written by the shot action itself
// (shot-words-store.ts), with the still it led to.

/**
 * The set is the person's own, not deleted, ready and drawable: the spec
 * the page draws — the WORKING copy when one is saved (the Set Editor,
 * 2026-09-15), so the reader knows the cameras and marks as they are now,
 * an added camera included, not as Astra first built them. The working
 * copy is read on its own, defensively, like everywhere else.
 */
async function readyOwnedSpec(setId: string, userId: string): Promise<{ error: string } | { error: null; spec: SetSpec }> {
  if (typeof setId !== "string" || !UUID_RE.test(setId)) return { error: SET_NOT_FOUND };
  const admin = createAdminClient();
  const { data: row } = await admin
    .from("location_sets")
    .select("status, spec")
    .eq("id", setId)
    .eq("user_id", userId)
    .is("deleted_at", null)
    .maybeSingle();
  if (!row) return { error: SET_NOT_FOUND };
  if (row.status !== "ready") return { error: SET_NOT_READY };
  const n = normaliseSetSpec(row.spec);
  if (!n.ok) return { error: SET_NOT_FOUND };
  const { data: editedRow, error: editedError } = await admin
    .from("location_sets")
    .select("edited_spec")
    .eq("id", setId)
    .eq("user_id", userId)
    .is("deleted_at", null)
    .maybeSingle();
  if (editedError) console.warn("[sets] reader could not read the working copy:", editedError.message);
  else if (editedRow?.edited_spec) {
    const edited = normaliseSetSpec(editedRow.edited_spec);
    if (edited.ok) return { error: null, spec: edited.spec };
  }
  return { error: null, spec: n.spec };
}

/**
 * The person's characters, newest first, at most 20: id, name, and whether
 * it has a photo to be shot with (data.ts charactersOf's rule). v1 reads
 * the names only, as it always has; v2's STAGE lists each under an alias,
 * "(no photo yet)" when it can't be cast (reader-context.ts). Empty on any
 * failure.
 */
async function characterList(userId: string): Promise<ReaderCharacter[]> {
  const { data } = await createAdminClient()
    .from("character_profiles")
    .select("id, name, reference_image_urls")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(50);
  return (data ?? [])
    .map((c) => ({
      id: typeof c.id === "string" ? c.id : "",
      name: typeof c.name === "string" ? c.name.trim() : "",
      hasPhoto: Array.isArray(c.reference_image_urls) && c.reference_image_urls.length > 0,
    }))
    .filter((c) => c.id.length > 0 && c.name.length > 0)
    .slice(0, 20);
}

/** The names of the person's characters, so the reader knows a name from a pose (v1). Empty on any failure. */
async function characterNames(userId: string): Promise<string[]> {
  return (await characterList(userId)).map((c) => c.name);
}

/** Words on a set's page: the frame they ask for, against that set's cameras and marks. */
export async function readShotWords(
  setId: string,
  input: { text: string },
): Promise<{ error: string } | { error: null; words: ShotWords | null }> {
  const access = await setsAccess();
  if (access.error !== null) return { error: access.error };
  const { userId } = access;
  const owned = await readyOwnedSpec(setId, userId);
  if (owned.error !== null) return { error: owned.error };
  const text = cleanText(typeof input?.text === "string" ? input.text : "", SHOT_WORDS_MAX_CHARS);
  if (text.length === 0) return { error: null, words: null };
  // Fails closed like every limiter; a limited reading is simply no reading.
  if (await rateLimited(userId, "set-words", 60 * 10, SHOT_WORDS_PER_10_MIN)) return { error: null, words: null };
  const stage = { spec: owned.spec, characters: await characterNames(userId), askPlace: false };
  const answer = await askShotWords(shotWordsInstructions(stage), text);
  const words = answer === null ? null : parseShotWords(answer, stage);
  if (answer !== null && words === null) console.warn("[sets] shot words failed: the answer was not the shape");
  return { error: null, words };
}

/** Words on the Sets home, before there is a set: the place to build, and the shot to take in it. */
export async function readSetRequest(input: { text: string }): Promise<{ error: string } | { error: null; words: ShotWords | null }> {
  const access = await setsAccess();
  if (access.error !== null) return { error: access.error };
  const { userId } = access;
  const text = cleanText(typeof input?.text === "string" ? input.text : "", SHOT_WORDS_MAX_CHARS);
  if (text.length === 0) return { error: null, words: null };
  // The place is read only for a build that can start: at the month's cap
  // the build is refused whatever the reader says, so the reader — a paid
  // call — is not asked, and the build answers with the cap's own sentence.
  if (access.monthlyLimit >= 0) {
    const used = await countSetBuildsThisMonth(userId, access.periodStart);
    if (used === null || used >= access.monthlyLimit) return { error: null, words: null };
  }
  if (await rateLimited(userId, "set-words", 60 * 10, SHOT_WORDS_PER_10_MIN)) return { error: null, words: null };
  const stage = { spec: null, characters: await characterNames(userId), askPlace: true };
  const answer = await askShotWords(shotWordsInstructions(stage), text);
  const words = answer === null ? null : parseShotWords(answer, stage);
  if (answer !== null && words === null) console.warn("[sets] set request failed: the answer was not the shape");
  return { error: null, words };
}

/** Why a v2 reading came back as it did (shot-reading.ts ReaderWhy): "off" means the page reads with v1. */
export type ShotTurnWhy = ReaderWhy;

export type ShotTurnAnswer =
  | { error: string }
  | { error: null; reading: ShotReading | null; why: ShotTurnWhy; cut: boolean; dropped: string[]; aliases: ReaderAliases };

/**
 * Reader v2 on a set's page (Helios Cut 2, spec §2.3, §6.2): one message
 * read against the set as it stands. The page sends its own NOW (who, where,
 * the camera, the look, what happens) and up to three earlier turns; the
 * server checks every value (reader-context.ts normaliseReaderNow), writes
 * STAGE, THINGS and NOW itself, asks the reader, and holds the answer to
 * the set (shot-reading.ts parseShotReading): aliases mapped back to the
 * set's things and the person's own characters, what did not match named
 * in `dropped`, never guessed.
 *
 * FAILS CLOSED, unlike v1 (the owner's decision 2): a reading that failed
 * is `reading: null` with its `why`, and the page changes nothing and
 * shoots nothing. `why: "off"` until check A opens v2 to everyone
 * (SHOT_READER_V2_OPEN_TO_ALL): admins only, and the page reads with v1.
 * `origin: "build"` only for the Sets home's first message to a set it just
 * built, which the page learns from the address alone (from=build).
 *
 * Same access, working copy and limiter as readShotWords (40 readings in
 * ten minutes, one bucket for both). Nothing is stored; the log keeps
 * token counts only.
 */
export async function readShotTurn(
  setId: string,
  input: { text: string; now?: unknown; turns?: unknown; origin?: "build" },
): Promise<ShotTurnAnswer> {
  const access = await setsAccess();
  if (access.error !== null) return { error: access.error };
  const { userId } = access;
  const none = (why: ShotTurnWhy, cut = false): ShotTurnAnswer => ({ error: null, reading: null, why, cut, dropped: [], aliases: { things: {}, people: {} } });
  if (!access.isAdmin && !SHOT_READER_V2_OPEN_TO_ALL) return none("off");
  const owned = await readyOwnedSpec(setId, userId);
  if (owned.error !== null) return { error: owned.error };
  const raw = typeof input?.text === "string" ? input.text : "";
  const message = cleanText(raw, SHOT_WORDS_MAX_CHARS);
  // Longer than the reader is given: the reply says it read the first 600.
  const cut = Array.from(cleanText(raw, Number.MAX_SAFE_INTEGER)).length > SHOT_WORDS_MAX_CHARS;
  if (message.length === 0) return none("empty");
  if (await rateLimited(userId, "set-words", 60 * 10, SHOT_WORDS_PER_10_MIN)) return none("limited", cut);

  const spec = owned.spec;
  const characters = await characterList(userId);
  const castIds = characters.map((c) => c.id);
  const now = normaliseReaderNow(input?.now, spec, castIds) ?? normaliseReaderNow({}, spec, castIds);
  if (!now) return none("down", cut);
  const things = readerThings(spec, now.mark);
  const stage = readerStageBlock({ spec, characters, things, keep: now.who });
  const nowLine = readerNowLine(now, { spec, characters, aliases: stage.aliases, things, origin: input?.origin === "build" ? "build" : null });
  const turnsBlock = readerTurnsBlock(normaliseReaderTurns(input?.turns));
  const reply = await askShotReader(readerMessages(stage.text, nowLine, turnsBlock, message), { maxCompletionTokens: SHOT_READER_MAX_COMPLETION });
  if (!reply) return none("down", cut);
  const parsed = parseShotReading(reply.text, { spec, aliases: stage.aliases, message, nowHappens: now.direction });
  if (!parsed) {
    // How it ended ("length": the cap cut it) says why; never a word of it.
    console.warn(`[sets] shot reader failed: the answer was not the shape (finish ${reply.usage.finish ?? "unknown"})`);
    return none("down", cut);
  }
  return { error: null, reading: parsed.reading, why: "ok", cut, dropped: parsed.dropped, aliases: stage.aliases };
}
