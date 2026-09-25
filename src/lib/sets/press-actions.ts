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
import { thumbUrl, toMediaUrl } from "@/lib/media/url";
import { setsAccess, UUID_RE } from "@/lib/sets/access";
import { isPressAnswer, parseFilmBeat, parsePressId, PRESS_STALE_MS, pressClipId, pressLedgerId, readPress } from "@/lib/sets/press";
import { SET_NOT_FOUND } from "@/lib/sets/messages";
import type { ShootResult, TakeResult } from "@/lib/sets/actions";

/** A row a press reserved, as History has it: its status, and its file signed for the page (as data.ts signs a shot's). */
export type PressRowState = { id: string; status: string; resultUrl: string | null; viewUrl: string | null; posterUrl: string | null };

export type SetPressState =
  | { error: string }
  /** The press is still being worked on: say "still rendering — it will appear here". */
  | { error: null; state: "running" }
  /** The press's own answer, exactly as the action returned it: handled as that return would have been. */
  | { error: null; state: "answered"; kind: "shot"; answer: ShootResult }
  | { error: null; state: "answered"; kind: "take"; answer: TakeResult }
  /**
   * No answer, but the still and clip rows the press reserved, with their
   * status. `ended`: the ledger says its request is over (the platform
   * stopped it, or it threw), so no other row will come; false when the
   * ledger can't say (its SQL not run yet, or the press never claimed a row).
   */
  | { error: null; state: "unanswered"; still: PressRowState | null; take: PressRowState | null; ended: boolean }
  /**
   * Nothing under this press was started or charged. `ended`: its request is
   * over, so nothing ever will be; false while one may still reach the
   * server. It may be pressed again, under a NEW id.
   */
  | { error: null; state: "not-found"; ended: boolean }
  /** Neither the ledger nor History could say (the ledger's SQL not run yet and no rows, or a read failed): a failed read, asked again. */
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

  // The ledger: the person's own row, on this set. Missing (its SQL not run
  // yet, or the read failed), History is still read below: a still's row id
  // is the press's own and a clip's is made from it, so what the press
  // reserved can be found without it (review, 2026-09-25: before, every
  // lost press waited out its 330 s and said it was late, even a still that
  // had landed a minute in).
  const read = await readPress(createAdminClient(), { id, userId: access.userId, setId });
  const row = read.missing ? null : read.row;
  if (row && row.state === "done" && isPressAnswer(row.result)) {
    if (row.kind === "shot") return { error: null, state: "answered", kind: "shot", answer: row.result as ShootResult };
    if (row.kind === "take") return { error: null, state: "answered", kind: "take", answer: row.result as TakeResult };
    return { error: SET_NOT_FOUND };
  }
  // Running, and young enough to still be inside its request's 300 s.
  if (row && row.state !== "done" && Date.now() - Date.parse(row.createdAt) < PRESS_STALE_MS) return { error: null, state: "running" };
  // Any row left here is a request that is over: done with no answer (it
  // threw, press.ts runPress) or one the platform stopped.
  const ended = row !== null;

  // No answer is coming, or none can be read. What the press reserved is
  // the truth from here. The ids are made from a press the page minted for
  // this set, so they are owner-checked and not set-checked: nobody else can
  // own them. Answering "not-found" for a press that was charged would
  // invite a second charge, so a read that fails says "unknown", and so does
  // finding nothing with no ledger to say the press ever reached the server.
  const clipId = pressClipId(id);
  const { data, error } = await access.supabase
    .from("generations")
    .select("id, status, result_url, poster_url")
    .in("id", [id, clipId])
    .eq("user_id", access.userId);
  if (error) return { error: null, state: "unknown" };
  const rows = (data ?? []) as { id: string; status: string; result_url: string | null; poster_url: string | null }[];
  if (rows.length === 0) return read.missing ? { error: null, state: "unknown" } : { error: null, state: "not-found", ended };
  const found = (rowId: string): PressRowState | null => {
    const r = rows.find((x) => x.id === rowId);
    if (!r) return null;
    const stored = toMediaUrl(r.result_url);
    const isStill = rowId === id;
    // Signed as the page's own loader signs a shot (data.ts): a still at the strip's and the viewer's sizes, a clip as it is.
    return {
      id: r.id,
      status: r.status,
      resultUrl: isStill ? thumbUrl(stored, 640) : stored,
      viewUrl: isStill ? thumbUrl(stored, 1600) : null,
      posterUrl: isStill ? null : thumbUrl(toMediaUrl(r.poster_url), 640),
    };
  };
  return { error: null, state: "unanswered", still: found(id), take: found(clipId), ended };
}
