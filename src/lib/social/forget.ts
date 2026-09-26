// Account deletion's step for connected social accounts (Press Tour
// integration, 2026-09-26). Both deletion flows (the person's own, in
// lib/profile/actions.ts, and Admin's, in lib/admin/actions.ts) call it
// after the face withdrawal and BEFORE the auth delete, while the rows that
// name the accounts still exist: every queued post is cancelled, each key is
// revoked at X and TikTok (Instagram and Threads have no revoke call), and a
// revoke that fails is owed in social_revocations, which has no foreign key
// to the account on purpose, so the posts clock retries it after the account
// is gone. The cascade then deletes our copy of every key either way.
//
// Best-effort and bounded, like deleteUserFaces: it never throws and never
// holds the deletion longer than FORGET_BUDGET_MS. Before
// press-tour-04-social.sql runs, the table read fails and this does nothing.
//
// Alias-free and light (no machine, no provider clients), because the
// deletion flows import it: a heavy import graph here could break account
// deletion itself.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { FetchLike } from "./http";
import { forgetConnection } from "./publish-service";
import { supabaseSocialStore, type SocialStore } from "./store";
import { keyringFromEnv, type Keyring } from "./vault";

/** The longest account deletion waits on the networks' revoke calls. */
export const FORGET_BUDGET_MS = 15_000;

export type ForgetDeps = {
  store: SocialStore;
  keyring: Keyring | null;
  env: Record<string, string | undefined>;
  fetch: FetchLike;
};

export type ForgetOutcome = "done" | "timed_out" | "unavailable";

/**
 * Every connected account of this person forgotten (forgetConnection, the
 * Disconnect key's own path), within the budget. "timed_out" leaves the
 * rest to the cascade: their keys are deleted, only the network-side revoke
 * is skipped. Never throws.
 */
export async function forgetAccounts(deps: ForgetDeps, userId: string, budgetMs: number = FORGET_BUDGET_MS): Promise<ForgetOutcome> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<ForgetOutcome>((resolve) => {
    timer = setTimeout(() => resolve("timed_out"), budgetMs);
  });
  const work = (async (): Promise<ForgetOutcome> => {
    let connections;
    try {
      connections = await deps.store.connections(userId);
    } catch {
      return "unavailable";
    }
    for (const conn of connections) {
      await forgetConnection(deps, conn).catch((err) =>
        console.error(`[social] forgetting a ${conn.network} account failed: ${err instanceof Error ? err.message : String(err)}`),
      );
    }
    return "done";
  })().catch((): ForgetOutcome => "unavailable");
  try {
    return await Promise.race([work, late]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/** The deletion flows' call: the service-role client they already hold, the vault from the environment. Never throws. */
export async function forgetSocialAccountsOnDelete(admin: SupabaseClient, userId: string): Promise<void> {
  try {
    const outcome = await forgetAccounts(
      {
        store: supabaseSocialStore(admin),
        keyring: keyringFromEnv(process.env),
        env: process.env,
        fetch: (input, init) => fetch(input, init),
      },
      userId,
    );
    if (outcome === "timed_out") console.warn(`[social] account deletion stopped waiting on the networks' revoke calls after ${FORGET_BUDGET_MS} ms`);
  } catch (err) {
    console.error(`[social] account deletion's social step failed: ${err instanceof Error ? err.message : String(err)}`);
  }
}
