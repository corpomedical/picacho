"use server";

// The press line's "Tell me when <network> opens" switch, from the browser
// (waitlist.ts). Who first (pressTourCaller: Press Tour on, the person
// allowed, a confirmed email), then the service role writes the person's
// own row: press_network_waitlist has no policies for people.

import { createAdminClient, createClient } from "@/lib/supabase/server";
import { pressTourCaller } from "./card-service";
import type { Network } from "./publish-types";
import { WAITLIST_FAILED, readWaitlistFor, setWaitlistFor, type WaitlistResult } from "./waitlist";

async function caller(): Promise<{ ok: true; userId: string } | { ok: false; error: string }> {
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  const found = await pressTourCaller(supabase, data.user);
  if (found.error !== null) return { ok: false, error: found.error };
  return { ok: true, userId: found.caller.userId };
}

/** The networks this person asked to hear about. */
export async function readWaitlist(): Promise<WaitlistResult> {
  try {
    const who = await caller();
    if (!who.ok) return who;
    return await readWaitlistFor(createAdminClient(), who.userId);
  } catch (err) {
    console.error(`[press-tour] waitlist read failed: ${err instanceof Error ? err.message : String(err)}`);
    return { ok: false, error: WAITLIST_FAILED };
  }
}

/** Ask, or stop asking, to hear when a network opens. */
export async function setWaitlist(input: { network: Network; on: boolean }): Promise<WaitlistResult> {
  try {
    const who = await caller();
    if (!who.ok) return who;
    return await setWaitlistFor(createAdminClient(), who.userId, input ?? { network: null, on: null });
  } catch (err) {
    console.error(`[press-tour] waitlist write failed: ${err instanceof Error ? err.message : String(err)}`);
    return { ok: false, error: WAITLIST_FAILED };
  }
}
