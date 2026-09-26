"use server";

// Press Tour's publishing actions, from the browser: the engine side of
// publish-types.ts PublishActions (spec §2; synthesis v2 Cut 5). No UI here:
// the press line (the publish sheet) calls these.
//
// A thin door onto src/lib/social/publish-service.ts, which decides
// everything and is tested as it is. Each action does exactly three things,
// in this order:
//   1. who: the signed-in person, through card-service.ts pressTourCaller —
//      Press Tour switched on, the person allowed, a CONFIRMED EMAIL;
//      Disconnect needs only the signed-in person (anyone may always take
//      their account back);
//   2. the real providers (social/runtime.ts publishDeps): the service role,
//      the vault, the switches, the rate limits, the words' gates, the kick;
//   3. the service entry, which checks where, whose, how much and what, and
//      only then connects, records consent or writes the queue.
// An error nothing names is caught here, logged, and answered with one
// English sentence (every sentence is a constant i18n maps).
//
// Every export of a "use server" file must be an async function; the shapes
// are imported from publish-types.ts.

import { createClient } from "@/lib/supabase/server";
import { SESSION_EXPIRED_MESSAGE } from "@/lib/generations/user-facing-error";
import { POST_FAILED } from "@/lib/social/messages";
import { publishDeps } from "@/lib/social/runtime";
import * as service from "@/lib/social/publish-service";
import { pressTourCaller } from "./card-service";
import type {
  ConnectionsResult,
  ConnectStartResult,
  ConsentMeta,
  Network,
  PostDraftInput,
  PostResult,
  PostsResult,
  PostWhen,
  PreviewResult,
  TikTokSheetResult,
} from "./publish-types";

type Caller = { userId: string; via: "admin" | "plan" | "trial" };

async function who(): Promise<{ ok: true; caller: Caller } | { ok: false; error: string }> {
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  const found = await pressTourCaller(supabase, data.user);
  if (found.error !== null) return { ok: false, error: found.error };
  return { ok: true, caller: found.caller };
}

async function behindDoor<T extends { ok: boolean }>(
  name: string,
  run: (caller: Caller, deps: service.PublishDeps) => Promise<T>,
): Promise<T | { ok: false; error: string }> {
  try {
    const w = await who();
    if (!w.ok) return w;
    return await run(w.caller, await publishDeps());
  } catch (err) {
    console.error(`[press-tour] ${name} failed: ${err instanceof Error ? err.message : String(err)}`);
    return { ok: false, error: POST_FAILED };
  }
}

/** Every network's row, in NETWORKS order. */
export async function listConnections(): Promise<ConnectionsResult> {
  return behindDoor("list connections", async (caller, deps) => ({ ok: true as const, connections: await service.listConnections(deps, caller) }));
}

/** Start connecting an account: the address to send the browser to (web only). */
export async function connectStart(input: { network: Network; returnTo?: string }): Promise<ConnectStartResult> {
  return behindDoor("start a connect", (caller, deps) => service.startConnect(deps, caller, input ?? {}));
}

/** Disconnect: queued posts through the account are cancelled, its keys revoked and deleted. */
export async function disconnect(input: { network: Network }): Promise<ConnectionsResult> {
  try {
    const supabase = await createClient();
    const { data } = await supabase.auth.getUser();
    const userId = typeof data.user?.id === "string" ? data.user.id.toLowerCase() : null;
    if (!userId) return { ok: false, error: SESSION_EXPIRED_MESSAGE };
    const deps = await publishDeps();
    const done = await service.disconnect(deps, userId, input ?? {});
    if (!done.ok) return done;
    // The rows as they are now; for someone Press Tour is no longer open to, an empty list.
    const w = await who();
    if (!w.ok) return { ok: true, connections: [] };
    return { ok: true, connections: await service.listConnections(deps, w.caller) };
  } catch (err) {
    console.error(`[press-tour] disconnect failed: ${err instanceof Error ? err.message : String(err)}`);
    return { ok: false, error: POST_FAILED };
  }
}

/** TikTok's creator_info for the sheet, read when it opens. */
export async function prepareTikTokSheet(input: { campaignId: string }): Promise<TikTokSheetResult> {
  return behindDoor("read the TikTok sheet", (caller, deps) => service.prepareTikTokSheet(deps, caller, input ?? {}));
}

/** Exactly what will publish, its blockers and the consent token. Posts nothing. */
export async function previewPost(input: PostDraftInput & { when?: PostWhen }): Promise<PreviewResult> {
  return behindDoor("preview a post", (caller, deps) => service.previewPost(deps, caller, input));
}

/** The tap on Post: consent recorded, the post goes out now. */
export async function consentAndPost(input: PostDraftInput & ConsentMeta): Promise<PostResult> {
  return behindDoor("post", (caller, deps) => service.consentAndPost(deps, caller, input));
}

/** The tap on Schedule (never TikTok). */
export async function consentAndSchedule(input: PostDraftInput & ConsentMeta & { when: string }): Promise<PostResult> {
  return behindDoor("schedule a post", (caller, deps) => service.consentAndSchedule(deps, caller, input));
}

/** Cancel a post that hasn't gone to the network yet. */
export async function cancelPost(input: { postId: string }): Promise<PostResult> {
  return behindDoor("cancel a post", (caller, deps) => service.cancelPost(deps, caller.userId, input ?? {}));
}

/** A campaign's posts (or every recent post), newest first. */
export async function listPosts(input: { campaignId?: string | null }): Promise<PostsResult> {
  return behindDoor("list posts", (caller, deps) => service.listPosts(deps, caller.userId, input ?? {}));
}
