// Relative imports on purpose: the tests load this module, and vitest has no
// "@/" alias configured (the repo's standing gotcha). Server-only
// (node:crypto): never import it from the page.
import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { FILM_MAX_BEATS } from "./film";
import { REPEAT_POLL_MS } from "../generations/repeat-send";
import { SET_PRESS_RUNNING, SET_SAVE_FAILED } from "./messages";

// ONE HELIOS PRESS, DELIVERED TWICE (operator, 2026-09-25: "GO ahead" on
// Cut 1, never charge twice). Chromium, the Android WebView included,
// silently resends a POST when a reused connection drops before any response
// headers arrive, and the page only sees the second answer
// (generations/repeat-send.ts has the incident). A Helios shot or take stays
// open for 60-280 s, all of it before the action answers, and nothing
// stopped a second delivery: it counted the limiter again, cut and drew the
// look again (Picacho pays), uploaded another frame, reserved and charged a
// second still — and for a take a second clip — and recorded more shots.
//
// So the page names each press (a fresh id per Shoot, Take and clip retry;
// one per film Render, its beats told apart by their number), and:
//
// 1. The press's first write is a claim row under that id
//    (location_set_presses, supabase/pending/helios-presses.sql), right after
//    the set is found to be the person's own and before anything is counted,
//    drawn, uploaded or charged. A second delivery meets its primary key,
//    does NOTHING else, and waits for the first delivery's answer, which is
//    stored on the row when it finishes. It answers with that, in the same
//    shape, so the page cannot tell it from the answer it lost.
// 2. Every row the press reserves takes its id from the press: the still's
//    id IS the press's, the clip's is made from it here (the recast/repeat.ts
//    construction under its own namespace). Even with no claim row — the SQL
//    not run yet, or the ledger unreachable — the reservation refuses the
//    same id twice, and runGeneration's follower answers with the first
//    delivery's take. The charge is protected either way.
//
// This is the ONLY module that names the table.
const TABLE = "location_set_presses";

/**
 * A running row older than this is a press the platform stopped (300 s
 * ceiling, page.tsx maxDuration) with 30 s to spare: its follower answers
 * "still rendering", and readSetPress stops calling it running.
 */
export const PRESS_STALE_MS = 330_000;

/** How long a press's answer is kept: a follower needs it for minutes, a day is plenty. */
const PRESS_KEEP_MS = 86_400_000;

export type PressKind = "shot" | "take" | "edit";

export type FollowClock = {
  /** When the follower gives up and answers "still rendering" (epoch ms). */
  deadlineAt: number;
  intervalMs?: number;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
};

export type PressClaim =
  // No id, no table, or the ledger unreachable: served as before the ledger.
  | { kind: "untracked" }
  // This delivery owns the press.
  | { kind: "claimed"; id: string }
  // Another delivery of the same press answered: this is its answer.
  | { kind: "repeat"; answer: { error: string | null } }
  // Another delivery of the same press was still working when the clock ran out.
  | { kind: "running" }
  // The id is someone else's, or this person's for another set or kind.
  | { kind: "foreign" };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The press's id as the page sent it, lowercased, or null when there is none to trust as a row id. */
export function parsePressId(v: unknown): string | null {
  return typeof v === "string" && UUID_RE.test(v) ? v.toLowerCase() : null;
}

/** Which beat of a film Render this is (0-based), or null for anything a film cannot have. */
export function parseFilmBeat(v: unknown): number | null {
  return typeof v === "number" && Number.isInteger(v) && v >= 0 && v < FILM_MAX_BEATS ? v : null;
}

/**
 * An id made from another by a rule of our own: SHA-256, stamped as a
 * version-8 UUID (RFC 9562's version for exactly that). The same inputs
 * always give the same id, and different ones never do. Namespaced apart
 * from Recast's take ids (recast/repeat.ts).
 */
function derived(id: string, part: string): string {
  const bytes = createHash("sha256").update(`helios-press:${id}:${part}`).digest().subarray(0, 16);
  bytes[6] = (bytes[6] & 0x0f) | 0x80;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** The clip's row id for a take press (its still's id is the press's own). */
export function pressClipId(pressId: string): string {
  return derived(pressId, "clip");
}

/** A film beat's own press id, made from its Render's id: its still's row id, and its clip's is made from it. */
export function filmBeatPressId(renderPressId: string, beat: number): string {
  return derived(renderPressId, `beat:${beat}`);
}

/** The id a press is claimed under: the press's own, or for a film beat its beat's. */
export function pressLedgerId(pressId: string | null, filmBeat: number | null): string | null {
  if (pressId === null) return null;
  return filmBeat === null ? pressId : filmBeatPressId(pressId, filmBeat);
}

/** Every row id the OTHER beats of a Render can have reserved: each beat's still and clip. */
export function filmSiblingIds(renderPressId: string, beat: number): string[] {
  const ids: string[] = [];
  for (let b = 0; b < FILM_MAX_BEATS; b++) {
    if (b === beat) continue;
    const beatId = filmBeatPressId(renderPressId, b);
    ids.push(beatId, pressClipId(beatId));
  }
  return ids;
}

/** An answer as the actions give one: an object whose error is null or a sentence. */
export function isPressAnswer(v: unknown): v is { error: string | null } {
  if (!v || typeof v !== "object" || Array.isArray(v)) return false;
  const error = (v as { error?: unknown }).error;
  return error === null || typeof error === "string";
}

const warned = new Set<string>();
function warnOnce(key: string, message: string): void {
  if (warned.has(key)) return;
  warned.add(key);
  console.warn(message);
}

type DbError = { code?: string; message?: string } | null | undefined;
function isMissingTable(error: DbError): boolean {
  return error?.code === "PGRST205" || error?.code === "42P01" || /does not exist|schema cache/.test(error?.message ?? "");
}
const MISSING = `[sets] ${TABLE} is missing — presses are served untracked until supabase/pending/helios-presses.sql runs`;

/**
 * Claims a press for this delivery, or finds that another delivery of the
 * same press has it. Every read is filtered by the person: another person's
 * id is "foreign", never read.
 */
export async function claimPress(
  admin: SupabaseClient,
  press: { id: string | null; userId: string; setId: string; kind: PressKind },
  clock: FollowClock,
): Promise<PressClaim> {
  const { id, userId, setId, kind } = press;
  if (!id) return { kind: "untracked" };
  const now = clock.now ?? Date.now;
  const sleep = clock.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));

  let insertError: DbError;
  try {
    ({ error: insertError } = await admin.from(TABLE).insert({ id, user_id: userId, set_id: setId, kind }));
  } catch (e) {
    insertError = { message: e instanceof Error ? e.message : String(e) };
  }
  if (!insertError) {
    // The person's own answers from yesterday and before go: an answer can
    // quote their words, and nobody follows a press that old.
    try {
      await admin
        .from(TABLE)
        .delete()
        .eq("user_id", userId)
        .lt("created_at", new Date(now() - PRESS_KEEP_MS).toISOString());
    } catch {
      // Pruned by the next press.
    }
    return { kind: "claimed", id };
  }
  if (isMissingTable(insertError)) {
    warnOnce("missing", MISSING);
    return { kind: "untracked" };
  }
  if (insertError.code !== "23505") {
    // Open to today's behaviour: the row ids still keep the charge single.
    warnOnce("claim", `[sets] couldn't claim a press, served untracked: ${insertError.message ?? insertError.code}`);
    return { kind: "untracked" };
  }

  // The same id is claimed already: a second delivery, or an id that is not
  // this press's. Follow the first until it answers or the clock runs out.
  // A failed read is retried, never taken as "not a repeat": that would run
  // the press a second time.
  type LedgerRow = { set_id?: unknown; kind?: unknown; state?: unknown; result?: unknown };
  const read = async (): Promise<{ readOk: boolean; row: LedgerRow | null }> => {
    try {
      const { data, error } = await admin.from(TABLE).select("set_id, kind, state, result").eq("id", id).eq("user_id", userId).maybeSingle();
      return { readOk: !error, row: (data ?? null) as LedgerRow | null };
    } catch {
      return { readOk: false, row: null };
    }
  };
  for (;;) {
    const { readOk, row } = await read();
    if (readOk) {
      if (!row) return { kind: "foreign" };
      if (String(row.set_id).toLowerCase() !== setId.toLowerCase() || row.kind !== kind) return { kind: "foreign" };
      if (row.state === "done" && isPressAnswer(row.result)) return { kind: "repeat", answer: row.result };
      // Done with no answer: the first delivery threw (runPress). Nothing
      // more is coming, so this one says "still rendering" at once and the
      // page reads what the press left (press-actions.ts readSetPress).
      if (row.state === "done") return { kind: "running" };
    }
    if (now() >= clock.deadlineAt) return { kind: "running" };
    await sleep(clock.intervalMs ?? REPEAT_POLL_MS);
  }
}

/** Stores the press's answer for any other delivery to follow. Never throws. */
export async function finishPress(admin: SupabaseClient, press: { id: string; userId: string }, answer: { error: string | null }): Promise<boolean> {
  try {
    const { error } = await admin
      .from(TABLE)
      .update({ state: "done", result: answer, finished_at: new Date().toISOString() })
      .eq("id", press.id)
      .eq("user_id", press.userId)
      .eq("state", "running");
    if (error) {
      warnOnce("finish", `[sets] couldn't store a press's answer: ${error.message}`);
      return false;
    }
    return true;
  } catch (e) {
    warnOnce("finish", `[sets] couldn't store a press's answer: ${e instanceof Error ? e.message : String(e)}`);
    return false;
  }
}

/**
 * A press whose work threw: its row is marked done with no answer, so the
 * page following it is told at once what the press left (readSetPress reads
 * the rows it reserved, or finds none) instead of "still rendering" until the
 * row goes stale 330 s later (review, 2026-09-25). Never throws.
 */
async function breakPress(admin: SupabaseClient, press: { id: string; userId: string }): Promise<void> {
  try {
    const { error } = await admin
      .from(TABLE)
      .update({ state: "done", result: null, finished_at: new Date().toISOString() })
      .eq("id", press.id)
      .eq("user_id", press.userId)
      .eq("state", "running");
    if (error) warnOnce("finish", `[sets] couldn't mark a press that threw: ${error.message}`);
  } catch (e) {
    warnOnce("finish", `[sets] couldn't mark a press that threw: ${e instanceof Error ? e.message : String(e)}`);
  }
}

/**
 * Runs `work` once per press: claims it, runs it, stores its answer. A
 * second delivery never runs it and answers with the first's answer, "still
 * rendering" when that did not come in time, and SET_SAVE_FAILED for an id
 * that belongs to another press. `work` is told how the press was claimed:
 * only a claimed press is known to be this delivery's alone (actions.ts
 * takeInSet counts a film Render once only then). A press that throws is
 * marked done with no answer (breakPress) and rethrown.
 */
export async function runPress<T extends { error: string | null }>(
  admin: SupabaseClient,
  press: { id: string | null; userId: string; setId: string; kind: PressKind },
  clock: FollowClock,
  work: (claim: Extract<PressClaim, { kind: "claimed" | "untracked" }>) => Promise<T>,
  said?: { running?: string; foreign?: string },
): Promise<T | { error: string }> {
  const claim = await claimPress(admin, press, clock);
  if (claim.kind === "repeat") return claim.answer as unknown as T;
  if (claim.kind === "running") return { error: said?.running ?? SET_PRESS_RUNNING };
  if (claim.kind === "foreign") return { error: said?.foreign ?? SET_SAVE_FAILED };
  let answer: T;
  try {
    answer = await work(claim);
  } catch (e) {
    if (claim.kind === "claimed") await breakPress(admin, { id: claim.id, userId: press.userId });
    throw e;
  }
  if (claim.kind === "claimed") await finishPress(admin, { id: claim.id, userId: press.userId }, answer);
  return answer;
}

export type PressRow = { kind: string; state: string; result: unknown; createdAt: string };

/**
 * A press's row as readSetPress reads it: the person's own, on this set.
 * `missing` when the ledger can't be read at all — the table not there yet,
 * or the read failing — so the page is never told "nothing started" on a
 * read that did not happen.
 */
export async function readPress(
  admin: SupabaseClient,
  press: { id: string; userId: string; setId: string },
): Promise<{ missing: true } | { missing: false; row: PressRow | null }> {
  try {
    const { data, error } = await admin
      .from(TABLE)
      .select("kind, state, result, created_at")
      .eq("id", press.id)
      .eq("user_id", press.userId)
      .eq("set_id", press.setId)
      .maybeSingle();
    if (error) {
      if (isMissingTable(error)) warnOnce("missing", MISSING);
      return { missing: true };
    }
    if (!data) return { missing: false, row: null };
    const r = data as { kind: unknown; state: unknown; result: unknown; created_at: unknown };
    return { missing: false, row: { kind: String(r.kind), state: String(r.state), result: r.result ?? null, createdAt: String(r.created_at) } };
  } catch {
    return { missing: true };
  }
}

/**
 * Whether another beat of this film Render has already shot a still or a
 * clip on this set: the Render was counted by the limiters then, and its
 * later beats are not counted again (actions.ts takeWork). Read from the
 * set's own shots, which only Helios writes (the person may read them, never
 * write them), not from History: any send may name its own row id there, so
 * a row under a sibling's id proved nothing (review, 2026-09-25). A read
 * that fails says no, so the beat is counted: closed, like the limiter itself.
 */
export async function renderPaidBefore(db: SupabaseClient, userId: string, render: { pressId: string; beat: number; setId: string }): Promise<boolean> {
  try {
    const { data, error } = await db
      .from("location_set_shots")
      .select("generation_id")
      .eq("set_id", render.setId)
      .eq("user_id", userId)
      .in("generation_id", filmSiblingIds(render.pressId, render.beat))
      .limit(1);
    if (error) return false;
    return Array.isArray(data) && data.length > 0;
  } catch {
    return false;
  }
}

/** A deleted set's presses go with it: an answer can quote the person's words. Failures ignored. */
export async function clearSetPresses(admin: SupabaseClient, setId: string, userId: string): Promise<void> {
  try {
    const { error } = await admin.from(TABLE).delete().eq("set_id", setId).eq("user_id", userId);
    if (error && !isMissingTable(error)) console.warn("[sets] couldn't clear the set's presses:", error.message);
  } catch {
    // Pruned within a day by the person's next press.
  }
}
