"use server";

// What became of a Helios press (operator, 2026-09-25: "GO ahead" on Cut 1).
//
// A shot or take stays open for 60-280 s. When the connection drops the
// page's await throws, and all it could say was "Couldn't reach the server —
// try again", while the paid render carried on, and a second press paid for
// it again. The page now asks here, with the press's own id, and is told
// the truth: still running, the answer the action gave, or what the request
// left behind when it died without one.
//
// A read of the person's own rows and nothing else: it writes nothing and
// has no limiter (like readTakes).

import { createAdminClient } from "@/lib/supabase/server";
import { setsAccess, UUID_RE } from "@/lib/sets/access";
import { isPressAnswer, parseFilmBeat, parsePressId, PRESS_STALE_MS, pressClipId, pressLedgerId, readPress } from "@/lib/sets/press";
import { SET_NOT_FOUND } from "@/lib/sets/messages";
import type { ShootResult, TakeResult } from "@/lib/sets/actions";

export type SetPressState =
  | { error: string }
  /** The press is still being worked on: say "still rendering — it will appear here". */
  | { error: null; state: "running" }
  /** The press's own answer, exactly as the action returned it: handled as that return would have been. */
  | { error: null; state: "answered"; kind: "shot"; answer: ShootResult }
  | { error: null; state: "answered"; kind: "take"; answer: TakeResult }
  /** The request ended without an answer (the platform stopped it): the still and clip rows it left, with their status. */
  | { error: null; state: "unanswered"; still: { id: string; status: string } | null; take: { id: string; status: string } | null }
  /** Nothing under this press was started or charged: it may be pressed again, under a NEW id. */
  | { error: null; state: "not-found" }
  /** The ledger isn't there to read (its SQL not run yet, or the read failed): the page falls back to its reload message. */
  | { error: null; state: "unknown" };

export async function readSetPress(setId: string, input: { pressId: string; filmBeat?: number }): Promise<SetPressState> {
  const access = await setsAccess();
  if (access.error !== null) return { error: access.error };
  if (typeof setId !== "string" || !UUID_RE.test(setId)) return { error: SET_NOT_FOUND };
  const pressId = parsePressId(input?.pressId);
  const beatGiven = input?.filmBeat !== undefined && input?.filmBeat !== null;
  const beat = beatGiven ? parseFilmBeat(input.filmBeat) : null;
  if (pressId === null || (beatGiven && beat === null)) return { error: SET_NOT_FOUND };
  // A film beat's press is its own, made from the Render's id (press.ts).
  const id = pressLedgerId(pressId, beat) as string;

  // The ledger: the person's own row, on this set.
  const read = await readPress(createAdminClient(), { id, userId: access.userId, setId });
  if (read.missing) return { error: null, state: "unknown" };
  const row = read.row;
  if (row && row.state === "done" && isPressAnswer(row.result)) {
    if (row.kind === "shot") return { error: null, state: "answered", kind: "shot", answer: row.result as ShootResult };
    if (row.kind === "take") return { error: null, state: "answered", kind: "take", answer: row.result as TakeResult };
    return { error: SET_NOT_FOUND };
  }
  // Running, and young enough to still be inside its request's 300 s.
  if (row && row.state !== "done" && Date.now() - Date.parse(row.createdAt) < PRESS_STALE_MS) return { error: null, state: "running" };

  // No answer is coming: no row (the press never claimed one, or claimed it
  // before the ledger existed), or one the platform stopped. What it
  // reserved is the truth from here. The ids are made from a press the page
  // minted for this set, so they are owner-checked and not set-checked:
  // nobody else can own them. Answering "not-found" for a press that was
  // charged would invite a second charge, so a read that fails says
  // "unknown", never "not-found".
  const clipId = pressClipId(id);
  const { data, error } = await access.supabase.from("generations").select("id, status").in("id", [id, clipId]).eq("user_id", access.userId);
  if (error) return { error: null, state: "unknown" };
  const rows = (data ?? []) as { id: string; status: string }[];
  if (rows.length === 0) return { error: null, state: "not-found" };
  const still = rows.find((r) => r.id === id);
  const take = rows.find((r) => r.id === clipId);
  return {
    error: null,
    state: "unanswered",
    still: still ? { id: still.id, status: still.status } : null,
    take: take ? { id: take.id, status: take.status } : null,
  };
}
