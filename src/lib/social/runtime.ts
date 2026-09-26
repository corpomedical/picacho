// Publishing's real providers, wired (server-only). Every decision lives in
// the alias-free modules (publish-service.ts, worker.ts, the adapters,
// vault.ts), which take their providers as dependencies and are tested with
// fakes; this file is the one place they are the real ones. The "use
// server" door (press-tour/publish-actions.ts), the connect callbacks and
// the posts clock all build their dependencies here.
//
//   store       the service role (store.ts supabaseSocialStore)
//   vault       SOCIAL_TOKEN_KEY_V<n> (vault.ts keyringFromEnv)
//   access      enabled.ts: the switches and settings, pressTourAllowed on
//               the person's profile, press_social_testers
//   ceilings    rate-limit.ts on fixed keys: the app-wide X ceiling a day
//               (press_x_daily_cap), per-person connect / post / sheet limits
//   words       content-policy.ts assertPromptAllowed, then planner.ts
//               adPolicyCheck (the ad packs plus the person's own rules)
//   kick        next/server after(): "Post now" drives the worker for that
//               post after the answer is sent; the clock carries on after

import { after } from "next/server";
import { headers } from "next/headers";
import { assertPromptAllowed, ContentPolicyRefusal } from "@/lib/generations/content-policy";
import { isNativeApp } from "@/lib/native/server";
import { getOrigin } from "@/lib/origin";
import { notifyUser } from "@/lib/push/send";
import { notifyAdmins } from "@/lib/push/web-push";
import { hashedRateKey, rateLimited } from "@/lib/rate-limit";
import { createAdminClient } from "@/lib/supabase/server";
import { ownBrandRules, plannerDeps } from "@/lib/press-tour/campaign-runtime";
import { pressTourAllowed, pressTourOpenings, readPressTourSettings, readPressTourSwitches } from "@/lib/press-tour/enabled";
import { adPolicyCheck } from "@/lib/press-tour/planner";
import { TIKTOK_AUDITED } from "./access";
import { CAPTION_CHECK_UNAVAILABLE, CAPTION_REFUSED, CAPTION_REFUSED_AD_RULES } from "./messages";
import { siteOrigin } from "./oauth";
import { forgetSocialAccountsOnDelete } from "./forget";
import { postNotice, reconnectNotice, reconnectPushScope, type PostNotice } from "./notices";
import type { PublishDeps } from "./publish-service";
import { supabaseSocialStore, type SocialStore } from "./store";
import { keyringFromEnv, keyringProblems } from "./vault";
import { housekeeping, runPosts, type AccessFacts, type WorkerDeps } from "./worker";
import type { Network } from "@/lib/press-tour/publish-types";

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** The function limit of whatever runs a kick (the press-tour page and the posts clock allow 300 s). */
const KICK_BUDGET_MS = 250_000;

let warnedKeys = false;
function keyring() {
  const ring = keyringFromEnv(process.env);
  if (!ring && !warnedKeys) {
    warnedKeys = true;
    const bad = keyringProblems(process.env);
    console.warn(
      bad.length > 0
        ? `[social] the vault is closed: ${bad.join(", ")} must be 32 random bytes in base64`
        : "[social] the vault is closed: SOCIAL_TOKEN_KEY_V1 is not set",
    );
  }
  return ring;
}

/** Everything the worker and the service need to know about a person, read fresh. */
export async function readAccess(store: SocialStore, userId: string): Promise<AccessFacts> {
  const admin = createAdminClient();
  const [switches, settings, profile, testerNetworks] = await Promise.all([
    readPressTourSwitches(admin),
    readPressTourSettings(admin),
    store.profile(userId).catch(() => null),
    store.testerNetworks(userId).catch(() => [] as string[]),
  ]);
  const verdict = pressTourAllowed(profile, pressTourOpenings(switches, settings));
  return {
    pressTourOk: verdict.error === null && verdict.via !== null,
    isAdmin: verdict.isAdmin && verdict.error === null,
    testerNetworks,
    switches,
  };
}

async function readXCap(): Promise<number> {
  return (await readPressTourSettings(createAdminClient())).press_x_daily_cap;
}

/** One post's room under the app-wide X ceiling (rolling 24 h, atomic in api_rate_check). */
async function takeXSlot(cap: number): Promise<boolean> {
  if (!(cap > 0)) return false;
  const key = hashedRateKey("press-x-app", "press-x-daily");
  return !(await rateLimited(key, "press-x-daily", 24 * 60 * 60, cap));
}

/** The content gate, then the Press Tour ad policy step, on the person's words at consent time. */
async function gateCaption(userId: string, text: string): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    await assertPromptAllowed({ prompt: text });
  } catch (err) {
    if (err instanceof ContentPolicyRefusal) return { ok: false, error: err.userMessage || CAPTION_REFUSED };
    return { ok: false, error: CAPTION_CHECK_UNAVAILABLE };
  }
  try {
    const own = await ownBrandRules(createAdminClient(), userId);
    const verdict = await adPolicyCheck(plannerDeps(), text, own);
    if (verdict.ok) return { ok: true };
    return { ok: false, error: verdict.code === "refused" ? CAPTION_REFUSED_AD_RULES : CAPTION_CHECK_UNAVAILABLE };
  } catch {
    return { ok: false, error: CAPTION_CHECK_UNAVAILABLE };
  }
}

/** One notice to the person's devices (their notification switches decide; never throws). */
async function pushNotice(userId: string, notice: PostNotice): Promise<void> {
  try {
    await notifyUser(userId, { message: { key: notice.key, params: notice.params }, path: notice.path });
  } catch (err) {
    console.error(`[social] ${notice.key} push failed: ${err instanceof Error ? err.message : String(err)}`);
  }
}

/**
 * The reconnect push, at most once a day per person and network: the worker
 * says so for every queued post on an account that needs connecting again
 * and housekeeping says so again, so the limiter (fail-closed: no push when
 * it can't tell) keeps it to one.
 */
async function pushReconnect(userId: string, network: Network): Promise<void> {
  if (await rateLimited(userId, reconnectPushScope(network), 24 * 60 * 60, 1)) return;
  await pushNotice(userId, reconnectNotice(network));
}

export function workerDeps(): WorkerDeps {
  const store = supabaseSocialStore(createAdminClient());
  return {
    store,
    keyring: keyring(),
    env: process.env,
    fetch: (input, init) => fetch(input, init),
    now: () => new Date(),
    sleep,
    readAccess: (userId) => readAccess(store, userId),
    readXCap,
    takeXSlot,
    tiktokAudited: TIKTOK_AUDITED,
    notifyAdmins: (title, body) => notifyAdmins({ title, body, path: "#content" }),
    onNeedsReconnect: (userId, network) => pushReconnect(userId, network),
    onPostSettled: (post, outcome) => pushNotice(post.userId, postNotice(post, outcome)),
  };
}

/** "Post now": drive the worker for this post after the answer is sent. */
export function kickPost(postId: string): void {
  after(async () => {
    try {
      await runPosts(workerDeps(), { batch: 1, budgetMs: KICK_BUDGET_MS, postId });
    } catch (err) {
      console.error(`[social] kick failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  });
}

/** The posts clock's minute: housekeeping, then up to `batch` due posts. */
export async function postsTick(input: { batch: number; budgetMs: number; posting: boolean }) {
  const deps = workerDeps();
  const kept = await housekeeping(deps).catch(() => undefined);
  if (!input.posting) return { claimed: 0, outcomes: {}, housekeeping: kept };
  const report = await runPosts(deps, { batch: input.batch, budgetMs: input.budgetMs });
  return { ...report, housekeeping: kept };
}

async function requestFacts(): Promise<{ native: boolean; sameSite: boolean; ipHash: string | null }> {
  const [native, origin, h] = await Promise.all([isNativeApp(), getOrigin(), headers()]);
  const site = siteOrigin(process.env);
  let sameSite = false;
  try {
    sameSite = site !== null && new URL(origin).host === new URL(site).host;
  } catch {
    sameSite = false;
  }
  const ip = h.get("x-forwarded-for")?.split(",")[0]?.trim() || h.get("x-real-ip") || null;
  return { native, sameSite, ipHash: ip ? hashedRateKey(ip, "press-post-consent") : null };
}

/** The service's dependencies for one request. */
export async function publishDeps(): Promise<PublishDeps> {
  const store = supabaseSocialStore(createAdminClient());
  const facts = await requestFacts();
  return {
    store,
    keyring: keyring(),
    env: process.env,
    fetch: (input, init) => fetch(input, init),
    now: () => new Date(),
    native: facts.native,
    sameSite: facts.sameSite,
    readAccess: (userId) => readAccess(store, userId),
    readXCap,
    rateLimited,
    gateCaption,
    kick: kickPost,
    ipHash: facts.ipHash,
    tiktokAudited: TIKTOK_AUDITED,
  };
}

/** The connect callback's dependencies (no page request facts matter there). */
export function callbackDeps(): PublishDeps {
  const store = supabaseSocialStore(createAdminClient());
  return {
    store,
    keyring: keyring(),
    env: process.env,
    fetch: (input, init) => fetch(input, init),
    now: () => new Date(),
    native: false,
    sameSite: true,
    readAccess: (userId) => readAccess(store, userId),
    readXCap,
    rateLimited,
    gateCaption,
    kick: kickPost,
    ipHash: null,
    tiktokAudited: TIKTOK_AUDITED,
  };
}

/**
 * For account deletion: every account the person connected is disconnected
 * the same way as the Disconnect button: queued posts cancelled, keys
 * revoked (a failed revoke is owed and retried by the posts clock after the
 * account is gone), rows deleted. Bounded and never throws. The deletion
 * flows themselves (lib/profile/actions.ts deleteAccount, lib/admin/actions.ts
 * deleteUser) call forget.ts forgetSocialAccountsOnDelete directly, which
 * this is, so they don't load this module's graph.
 */
export async function forgetSocialAccounts(userId: string): Promise<void> {
  await forgetSocialAccountsOnDelete(createAdminClient(), userId);
}
