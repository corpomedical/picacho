// "Tell me when Instagram opens" (the press line's Coming soon column,
// design A publish-desktop): a person's wish to hear, once, by email, when
// posting to a network opens to them. One row per person per network in
// press_network_waitlist (supabase/applied/2026-09-26/press-tour-08-waitlist.sql, RLS
// on, zero policies: only the service role reads or writes it). The switch
// starts OFF; turning it off deletes the row. Nothing here sends anything:
// when a network opens, the operator writes to the people on its list once
// and clears it (the one email the switch promises).
//
// Pure and alias-free (vitest has no "@/"): waitlist-actions.ts is the
// "use server" door onto it.

import type { SupabaseClient } from "@supabase/supabase-js";
import { NETWORKS, isNetwork, type Network } from "./publish-types";

export const WAITLIST_TABLE = "press_network_waitlist";

/** Said when the list can't be read or written just now. */
export const WAITLIST_FAILED = "We couldn't save that just now. Try again.";

export type WaitlistResult = { ok: true; networks: Network[] } | { ok: false; error: string };

/** The actions the press line calls (waitlist-actions.ts), handed in by the page. */
export interface WaitlistActions {
  /** The networks this person asked to hear about. */
  readWaitlist(): Promise<WaitlistResult>;
  /** Ask (on) or stop asking (off) to hear when a network opens. */
  setWaitlist(input: { network: Network; on: boolean }): Promise<WaitlistResult>;
}

/** The networks on the person's list, in NETWORKS order. */
export async function readWaitlistFor(admin: SupabaseClient, userId: string): Promise<WaitlistResult> {
  try {
    const { data, error } = await admin.from(WAITLIST_TABLE).select("network").eq("user_id", userId).limit(10);
    if (error) return { ok: false, error: WAITLIST_FAILED };
    const got = new Set((data ?? []).map((r) => (r as { network?: unknown }).network).filter(isNetwork));
    return { ok: true, networks: NETWORKS.filter((n) => got.has(n)) };
  } catch {
    return { ok: false, error: WAITLIST_FAILED };
  }
}

/** Puts the person on a network's list, or takes them off it; answers with the list as it now is. */
export async function setWaitlistFor(admin: SupabaseClient, userId: string, input: { network: unknown; on: unknown }): Promise<WaitlistResult> {
  if (!isNetwork(input?.network) || typeof input?.on !== "boolean") return { ok: false, error: WAITLIST_FAILED };
  try {
    const { error } = input.on
      ? await admin.from(WAITLIST_TABLE).upsert({ user_id: userId, network: input.network }, { onConflict: "user_id,network", ignoreDuplicates: true })
      : await admin.from(WAITLIST_TABLE).delete().eq("user_id", userId).eq("network", input.network);
    if (error) return { ok: false, error: WAITLIST_FAILED };
  } catch {
    return { ok: false, error: WAITLIST_FAILED };
  }
  return readWaitlistFor(admin, userId);
}
