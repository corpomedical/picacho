// What an Astra press actually saved, read back by the page (2026-09-25,
// Cut 1 — operator: "GO ahead", never charge twice).
//
// An edit or a rebuild waits up to 180 s inside one request. When the
// connection drops, the call throws on the page while the server usually
// finishes and saves; the page said "Couldn't reach the server — try
// again", showed the old set, and the person asked again — another change
// from the month and another Astra bill, with Undo pointing at the wrong
// copy. A browser's silent resend of the same press is answered at once
// with SET_EDIT_STILL_WORKING (astra-press.ts) and needs the same follow.
//
// So after a thrown call or a `pending` answer the page reads the press
// back every SET_EDIT_FOLLOW_POLL_MS (editor-actions.ts readAstraEdit)
// until it has ended, and shows what the server holds:
// - saved: the set as saved, with how many pieces changed;
// - unsaved: nothing changed (and nothing was counted);
// - lost — the platform stopped it: judged by the saved copy. The read gave
//   back the change it had reserved (editor-actions.ts readAstraEdit, Helios
//   Cut 4, step A5), once, so the count it carries is after that, and
//   "nothing was counted" holds for it too;
// - none, seen twice and for SET_EDIT_NONE_AFTER_MS: nothing reached the
//   server — the ONE case that says try again;
// - checks failing past SET_EDIT_FOLLOW_CAP_MS: reload to see it.
//
// Pure and client-safe, relative imports only: the test drives it with a
// scripted read, a fake clock and a recorded sleep.

import { countSpecChanges } from "./editor-model";
import { SET_EDIT_NOT_SAVED, SET_EDIT_UNCHECKED } from "./messages";
import { SET_EDIT_FOLLOW_CAP_MS, SET_EDIT_FOLLOW_POLL_MS } from "./set-config";
import type { SetSpec } from "./set-spec";

/**
 * Where a press stands on the server (astra-press.ts readAstraPress):
 * none — no claim; running — claimed, not ended; saved / unsaved — ended;
 * lost — claimed long ago and never ended (the platform stopped it);
 * unread — the record could not be read.
 */
export type AstraPressKind = "none" | "running" | "saved" | "unsaved" | "lost" | "unread";

/** readAstraEdit's answer: the saved working copy and where the press stands. */
export type AstraEditRead = { error: string } | { error: null; press: AstraPressKind; spec: SetSpec; editsLeft?: number | null };

export type FollowedEdit =
  | { kind: "saved"; spec: SetSpec; changed: number; editsLeft?: number | null }
  | { kind: "unsaved"; error: string; editsLeft?: number | null }
  // Nothing reached the server: the call never got there.
  | { kind: "none" }
  // A sentence to show: the session or the set is gone, or the checks kept failing.
  | { kind: "error"; error: string }
  // A deploy left the tab behind: the reload is on its way, and says so itself.
  | { kind: "left" };

/** How many reads must find no press before the page says nothing reached the server: one grace read for a delivery that hasn't claimed yet. */
const NONE_READS = 2;
/**
 * And for how long from the start of the follow (review, 2026-09-25): two
 * reads 4 s apart were too quick for a delivery slow to claim (a cold start,
 * a slow sign-in check, a rebuild listing its photos), and "try again" then
 * ran and billed a second Astra job on top of the first.
 */
export const SET_EDIT_NONE_AFTER_MS = 24_000;

export async function followAstraEdit(
  read: () => Promise<AstraEditRead | { thrown: unknown }>,
  opts: {
    before: SetSpec;
    stop?: (err: unknown) => boolean;
    now?: () => number;
    sleep?: (ms: number) => Promise<void>;
    pollMs?: number;
    capMs?: number;
  },
): Promise<FollowedEdit> {
  const now = opts.now ?? (() => new Date().getTime());
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const pollMs = opts.pollMs ?? SET_EDIT_FOLLOW_POLL_MS;
  const capMs = opts.capMs ?? SET_EDIT_FOLLOW_CAP_MS;
  const start = now();
  let noneSeen = 0;
  for (;;) {
    const r = await read();
    if ("thrown" in r) {
      // A read that did not come back says nothing about the press: read again.
      if (opts.stop?.(r.thrown)) return { kind: "left" };
    } else if (r.error !== null) {
      return { kind: "error", error: r.error };
    } else {
      const saved = (): FollowedEdit => ({ kind: "saved", spec: r.spec, changed: countSpecChanges(opts.before, r.spec), editsLeft: r.editsLeft });
      if (r.press === "saved") return saved();
      if (r.press === "unsaved") return { kind: "unsaved", error: SET_EDIT_NOT_SAVED, editsLeft: r.editsLeft };
      // Stopped by the platform with no end marker: the saved copy is the only witness.
      if (r.press === "lost") return countSpecChanges(opts.before, r.spec) > 0 ? saved() : { kind: "unsaved", error: SET_EDIT_NOT_SAVED, editsLeft: r.editsLeft };
      if (r.press === "none") {
        noneSeen += 1;
        if (noneSeen >= NONE_READS && now() - start >= SET_EDIT_NONE_AFTER_MS) return { kind: "none" };
      }
      // running, unread: read again.
    }
    if (now() - start >= capMs) return { kind: "error", error: SET_EDIT_UNCHECKED };
    await sleep(pollMs);
  }
}
