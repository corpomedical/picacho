import { createHash, randomBytes, randomUUID } from "node:crypto";

// Publishing's decisions, behind the "use server" door (press-tour/
// publish-actions.ts) and the connect callbacks. Each entry checks, in this
// order, and only then acts:
//   1. who: the caller the door resolved (Press Tour on, the person allowed,
//      a confirmed email: card-service.ts pressTourCaller);
//   2. where: posting to this network open to them (access.ts networkOpen:
//      press_tour_posting, then the network's switch; admins and listed
//      testers first);
//   3. whose: the campaign and the account are theirs (the store filters by
//      owner; the table guards re-check inside the database);
//   4. how much: rate limits and the per-person caps;
//   5. what: exactly what will publish, rebuilt on the server, hashed; the
//      person's press must carry the hash of what the sheet showed them
//      (consentToken), and the words pass the content gate and the Press
//      Tour ad policy step at consent time;
// and only then writes the queue row (the idempotency key derived from the
// press's sendId makes a resent press one row).
//
// Alias-free (vitest has no '@/'): every provider arrives in PublishDeps.

import {
  NETWORKS,
  RENDITION_FOR,
  TIKTOK_PRIVACY_LEVELS,
  isNetwork,
  type ConnectionView,
  type ConsentMeta,
  type Network,
  type PostDraftInput,
  type PostDraftView,
  type PostView,
  type PostWhen,
  type TikTokChoices,
  type TikTokSheetState,
} from "../press-tour/publish-types";
import { normaliseForMatch, similarity } from "../product-lock/text-match";
import { NOT_YOURS, pathOwned } from "../press-tour/owned";
import {
  DAILY_POSTS_PER_PERSON,
  TIKTOK_TEST_PEOPLE_PER_DAY,
  checkWhen,
  connectionView,
  networkOpen,
  trialPostError,
  xCapOpen,
  type Caller,
} from "./access";
import type { OAuthAdapter } from "./adapter";
import { buildConsent, consentHash, optionsFor, type ConsentRecord } from "./consent";
import type { FetchLike } from "./http";
import {
  AI_LABEL_NOTE,
  AI_LABEL_NOTE_TEXT,
  CONNECT_FAILED,
  CONNECT_LIMIT,
  CONNECT_ON_COMPUTER,
  CONNECT_OTHER_SITE,
  CONNECT_UNAVAILABLE,
  CONNECTION_GONE,
  CUT_CHANGED,
  CUT_NOT_READY,
  CUT_WARNING_MISMATCH,
  DAILY_LIMIT_NETWORK,
  DUPLICATE_POST,
  NOT_CONNECTED,
  POST_CANCELLED,
  POST_FAILED,
  POST_NOT_CANCELLABLE,
  POST_PUBLISHED,
  POST_RATE_LIMIT,
  POST_SENDING,
  POST_UNCONFIRMED,
  POSTING_NOT_OPEN,
  RECONNECT_NEEDED,
  TIKTOK_AFTER_POST,
  TIKTOK_BRANDED_PRIVATE,
  TIKTOK_BRANDED_TEST,
  TIKTOK_DECLARATION,
  TIKTOK_DECLARATION_BRANDED,
  TIKTOK_PRIVACY_NOT_OFFERED,
  TIKTOK_PRIVACY_REQUIRED,
  TIKTOK_TEST_FULL,
  TIKTOK_TEST_ONLY_ME,
  TIKTOK_UNAVAILABLE,
  X_CLOSED_TODAY,
  X_LINK_NOTE,
  type ConnectErrorCode,
} from "./messages";
import { OAUTH } from "./networks";
import {
  DEFAULT_RETURN,
  STATE_TTL_MS,
  checkState,
  credentialsFor,
  newPkce,
  newState,
  redirectUri,
  safeReturnPath,
  siteOrigin,
  stateHash,
} from "./oauth";
import { CANCELLABLE_STAGES, type ConnectionRecord, type PostRecord, type SocialStore, type StoredRendition } from "./store";
import { HASHTAG_LIMIT, TEXT_LIMIT, captionTag, composeText, textLength, textProblems, tidyCaption, tidyHashtags } from "./text";
import { tiktokChoiceError, creatorInfo, sheetFrom, sheetUnavailable } from "./tiktok";
import { connectionAad, open, revocationAad, seal, usableAccessToken, type Keyring } from "./vault";
import type { AccessFacts } from "./worker";

export interface PublishDeps {
  store: SocialStore;
  keyring: Keyring | null;
  env: Record<string, string | undefined>;
  fetch: FetchLike;
  now(): Date;
  random?: (n: number) => Buffer;
  uuid?: () => string;
  /** The request came from the phone app's shell. */
  native: boolean;
  /** The request came in on NEXT_PUBLIC_SITE_URL's host (the callback's session cookie lives there). */
  sameSite: boolean;
  readAccess(userId: string): Promise<AccessFacts>;
  readXCap(): Promise<number>;
  /** rate-limit.ts rateLimited: true = over the limit. Fails closed. */
  rateLimited(userId: string, scope: string, windowSeconds: number, max: number): Promise<boolean>;
  /** The content gate and the Press Tour ad policy step on the words, at consent time. */
  gateCaption(userId: string, text: string): Promise<{ ok: true } | { ok: false; error: string }>;
  /** Drive the worker for this post after the answer is sent (next/server after()). */
  kick(postId: string): void;
  /** The requesting address, hashed; null when none. */
  ipHash: string | null;
  tiktokAudited: boolean;
  oauth?: Readonly<Record<Network, OAuthAdapter>>;
}

type Fail = { ok: false; error: string };
const fail = (error: string): Fail => ({ ok: false, error });

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SEND_ID_RE = /^[A-Za-z0-9_-]{8,100}$/;
const SHA_RE = /^[0-9a-f]{64}$/;
const DAY_MS = 24 * 60 * 60 * 1000;
/** Posts per person an hour through the sheet (every network together). */
export const POSTS_PER_HOUR = 30;
/** "Connect" presses per person an hour. */
export const CONNECTS_PER_HOUR = 10;
/** TikTok's creator_info: 20 a minute per account key; we ask at most 10. */
export const CREATOR_INFO_PER_MINUTE = 10;
/** The X duplicate guard: the same account and the same cut within 30 days, words this alike. */
export const DUPLICATE_WINDOW_MS = 30 * DAY_MS;
/**
 * A second press of the very same post (same account, same file, same
 * words and options: the same consent hash) within this long answers with
 * the first post instead of queueing another (MONEY-3): the backstop for a
 * press whose answer was lost after the post was queued, whatever send id
 * the second press carries.
 */
export const REPEAT_PRESS_WINDOW_MS = 15 * 60 * 1000;
export const DUPLICATE_SIMILARITY = 0.9;
/** Preview links to the file live this long. */
const PREVIEW_SECONDS = 60 * 60;

const oauthOf = (deps: PublishDeps) => deps.oauth ?? OAUTH;

/** Can this network connect here at all (credentials, the vault, the site address)? */
function configured(deps: PublishDeps, network: Network): boolean {
  return Boolean(credentialsFor(oauthOf(deps)[network], deps.env) && deps.keyring && siteOrigin(deps.env));
}

function open4(access: AccessFacts, network: Network): boolean {
  return networkOpen(network, access.switches, { isAdmin: access.isAdmin, testerNetworks: access.testerNetworks });
}

// ---------------------------------------------------------------------
// Connections
// ---------------------------------------------------------------------

export async function listConnections(deps: PublishDeps, caller: Caller): Promise<ConnectionView[]> {
  const [access, conns] = await Promise.all([deps.readAccess(caller.userId), deps.store.connections(caller.userId)]);
  return NETWORKS.map((network) => {
    const c = conns.find((x) => x.network === network) ?? null;
    return connectionView({
      network,
      open: access.pressTourOk && open4(access, network),
      configured: configured(deps, network),
      native: deps.native,
      connection: c ? { handle: c.handle, displayName: c.displayName, status: c.status } : null,
      tiktokAudited: deps.tiktokAudited,
    });
  });
}

/** Start connecting: the network's address to send the browser to. */
export async function startConnect(
  deps: PublishDeps,
  caller: Caller,
  input: { network: unknown; returnTo?: unknown },
): Promise<{ ok: true; url: string } | Fail> {
  if (!isNetwork(input.network)) return fail(CONNECT_FAILED);
  const network = input.network;
  if (deps.native) return fail(CONNECT_ON_COMPUTER);
  const access = await deps.readAccess(caller.userId);
  if (!access.pressTourOk || !open4(access, network)) return fail(POSTING_NOT_OPEN);
  const adapter = oauthOf(deps)[network];
  const origin = siteOrigin(deps.env);
  const creds = credentialsFor(adapter, deps.env);
  if (!origin || !creds || !deps.keyring) return fail(CONNECT_UNAVAILABLE);
  if (!deps.sameSite) return fail(CONNECT_OTHER_SITE);
  if (await deps.rateLimited(caller.userId, "press-social-connect", 3600, CONNECTS_PER_HOUR)) return fail(CONNECT_LIMIT);

  const random = deps.random ?? randomBytes;
  const { state, hash } = newState(random);
  const pkce = adapter.usesPkce ? newPkce(random) : null;
  const stored = await deps.store
    .insertState({
      stateHash: hash,
      userId: caller.userId,
      network,
      pkceVerifier: pkce?.verifier ?? null,
      returnTo: safeReturnPath(input.returnTo),
      expiresAt: new Date(deps.now().getTime() + STATE_TTL_MS).toISOString(),
    })
    .catch(() => false);
  if (!stored) return fail(CONNECT_FAILED);
  return {
    ok: true,
    url: adapter.authorizeUrl({ creds, redirectUri: redirectUri(origin, network), state, codeChallenge: pkce?.challenge ?? null }),
  };
}

/** Where the browser goes back to after a connect, with ?connected= or ?connect_error=. */
function backTo(path: string, param: string): string {
  return `${path}${path.includes("?") ? "&" : "?"}${param}`;
}

/**
 * The network sent the person back (GET /api/social/<network>/callback).
 * Answers the in-app path to redirect to. Never throws.
 */
export async function completeConnect(
  deps: PublishDeps,
  input: { network: Network; params: URLSearchParams; sessionUserId: string | null },
): Promise<{ redirect: string; connected: boolean }> {
  const network = input.network;
  const code = (c: ConnectErrorCode, path = DEFAULT_RETURN) => ({ redirect: backTo(path, `connect_error=${c}&network=${network}`), connected: false });
  const state = input.params.get("state");
  if (!state || state.length > 200) return code("expired");

  const now = deps.now();
  const stored = await deps.store.takeState(stateHash(state), now.toISOString()).catch(() => null);
  const check = checkState(stored, { network, sessionUserId: input.sessionUserId, now });
  const returnTo = safeReturnPath(stored?.returnTo);
  if (!check.ok) return code(check.code, returnTo);
  const userId = stored!.userId.toLowerCase();

  if (input.params.get("error")) return code("denied", returnTo);
  const authCode = input.params.get("code");
  if (!authCode || authCode.length > 2000) return code("failed", returnTo);

  const access = await deps.readAccess(userId).catch(() => null);
  if (!access || !access.pressTourOk || !open4(access, network)) return code("closed", returnTo);

  const adapter = oauthOf(deps)[network];
  const origin = siteOrigin(deps.env);
  const creds = credentialsFor(adapter, deps.env);
  const keyring = deps.keyring;
  if (!origin || !creds || !keyring) return code("failed", returnTo);

  let tokens;
  let profile;
  try {
    tokens = await adapter.exchangeCode(deps.fetch, { creds, code: authCode, redirectUri: redirectUri(origin, network), verifier: stored!.pkceVerifier, now });
    profile = await adapter.profile(deps.fetch, { accessToken: tokens.accessToken, token: tokens });
  } catch {
    return code("failed", returnTo);
  }

  try {
    const existing = await deps.store.connection(userId, network);
    // A different account on the same network replaces the old one: its
    // queued posts stop and its keys are revoked first.
    if (existing && existing.externalId !== profile.externalId) await forgetConnection(deps, existing);

    const id = await deps.store.upsertConnection({
      userId,
      network,
      externalId: profile.externalId,
      handle: profile.handle,
      displayName: profile.displayName,
      scopes: tokens.scopes,
      accessExpiresAt: tokens.accessExpiresAt?.toISOString() ?? null,
      refreshExpiresAt: tokens.refreshExpiresAt?.toISOString() ?? null,
      refreshedAt: now.toISOString(),
    });
    if (!id) throw new Error("connection not saved");
    const pair = {
      access: seal(tokens.accessToken, connectionAad(id, "access"), keyring),
      refresh: tokens.refreshToken ? seal(tokens.refreshToken, connectionAad(id, "refresh"), keyring) : null,
    };
    if (!(await deps.store.writeSecrets(id, pair))) {
      // Keys we can't keep are keys nobody should hold: drop the row, revoke them.
      if (!existing || existing.id !== id) await deps.store.deleteConnection(id).catch(() => false);
      await adapter.revoke(deps.fetch, { creds, token: tokens.refreshToken ?? tokens.accessToken, kind: tokens.refreshToken ? "refresh" : "access" }).catch(() => "failed");
      return code("failed", returnTo);
    }
  } catch {
    return code("failed", returnTo);
  }
  return { redirect: backTo(returnTo, `connected=${network}`), connected: true };
}

/**
 * Stop using an account: its queued posts are cancelled, its keys revoked at
 * the network (a failed revoke is owed: social_revocations, retried daily),
 * and its row and keys deleted either way.
 */
export async function forgetConnection(deps: Pick<PublishDeps, "store" | "keyring" | "env" | "fetch" | "uuid" | "oauth">, conn: ConnectionRecord): Promise<void> {
  const store = deps.store;
  await store.cancelPostsForConnection(conn.id, CONNECTION_GONE).catch(() => 0);
  const adapter = (deps.oauth ?? OAUTH)[conn.network];
  const creds = credentialsFor(adapter, deps.env);
  const keyring = deps.keyring;
  const keys = await store.readKeys(conn.id).catch(() => null);
  if (keys && keyring) {
    // X: the refresh key ends the grant, the access key too. TikTok revokes by
    // the access key. Instagram and Threads have no revoke call.
    const wanted: ("refresh" | "access")[] = conn.network === "x" ? ["refresh", "access"] : conn.network === "tiktok" ? ["access"] : [];
    for (const kind of wanted) {
      const sealed = kind === "refresh" ? keys.refresh : keys.access;
      if (!sealed) continue;
      let token: string;
      try {
        token = open(sealed, connectionAad(conn.id, kind), keyring);
      } catch {
        continue;
      }
      const result = creds ? await adapter.revoke(deps.fetch, { creds, token, kind }).catch(() => "failed" as const) : "failed";
      if (result === "failed") {
        const id = (deps.uuid ?? randomUUID)();
        await store
          .addRevocation({ id, userId: conn.userId, network: conn.network, externalId: conn.externalId, kind, sealed: seal(token, revocationAad(id, kind), keyring) })
          .catch(() => false);
      }
    }
  }
  await store.deleteConnection(conn.id);
}

export async function disconnect(deps: PublishDeps, userId: string, input: { network: unknown }): Promise<{ ok: true } | Fail> {
  if (!isNetwork(input.network)) return fail(CONNECT_FAILED);
  const conn = await deps.store.connection(userId, input.network);
  if (!conn) return { ok: true };
  await forgetConnection(deps, conn);
  return { ok: true };
}

// ---------------------------------------------------------------------
// TikTok's sheet
// ---------------------------------------------------------------------

async function tiktokKey(deps: PublishDeps, conn: ConnectionRecord): Promise<{ ok: true; token: string } | Fail> {
  const adapter = oauthOf(deps).tiktok;
  const creds = credentialsFor(adapter, deps.env);
  if (!creds || !deps.keyring) return fail(CONNECT_UNAVAILABLE);
  const key = await usableAccessToken({
    store: deps.store,
    keyring: deps.keyring,
    connectionId: conn.id,
    now: () => deps.now(),
    refresh: (c) => adapter.refresh(deps.fetch, { creds, accessToken: c.accessToken, refreshToken: c.refreshToken, now: deps.now() }),
  });
  if (!key.ok) return fail(key.reason === "unavailable" ? TIKTOK_UNAVAILABLE : RECONNECT_NEEDED);
  return { ok: true, token: key.accessToken };
}

/** creator_info for the sheet (on open, and again at consent). */
export async function readTikTokSheet(deps: PublishDeps, caller: Caller, conn: ConnectionRecord): Promise<{ ok: true; sheet: TikTokSheetState } | Fail> {
  if (await deps.rateLimited(caller.userId, "press-tiktok-creator-info", 60, CREATOR_INFO_PER_MINUTE)) return fail(POST_RATE_LIMIT);
  const key = await tiktokKey(deps, conn);
  if (!key.ok) return key;
  const info = await creatorInfo(deps.fetch, key.token);
  if (!info.ok) {
    if (info.outcome === "reconnect") {
      await deps.store.markNeedsReconnect(conn.id).catch(() => undefined);
      return fail(RECONNECT_NEEDED);
    }
    return { ok: true, sheet: sheetUnavailable(info.outcome, deps.now(), deps.tiktokAudited) };
  }
  return { ok: true, sheet: sheetFrom(info.info, { audited: deps.tiktokAudited, now: deps.now() }) };
}

export async function prepareTikTokSheet(deps: PublishDeps, caller: Caller, input: { campaignId: unknown }): Promise<{ ok: true; sheet: TikTokSheetState } | Fail> {
  const access = await deps.readAccess(caller.userId);
  if (!access.pressTourOk || !open4(access, "tiktok")) return fail(POSTING_NOT_OPEN);
  if (typeof input.campaignId !== "string" || !UUID_RE.test(input.campaignId)) return fail(NOT_YOURS);
  const campaign = await deps.store.campaignForPost(caller.userId, input.campaignId.toLowerCase());
  if (campaign === "unavailable") return fail(POST_FAILED);
  if (!campaign) return fail(NOT_YOURS);
  const conn = await deps.store.connection(caller.userId, "tiktok");
  if (!conn) return fail(NOT_CONNECTED);
  if (conn.status === "needs_reconnect") return fail(RECONNECT_NEEDED);
  return readTikTokSheet(deps, caller, conn);
}

/**
 * Pure: TikTok's choices, before the account's own options are known (the
 * preview does not ask TikTok on every keystroke; consent and the worker
 * do). A privacy the person chose, "Only me" only in test mode, branded
 * content never "Only me" and not in test mode.
 */
export function tiktokStructuralError(choices: TikTokChoices | null | undefined, testMode: boolean): string | null {
  if (!choices || !choices.privacy) return TIKTOK_PRIVACY_REQUIRED;
  if (!(TIKTOK_PRIVACY_LEVELS as readonly string[]).includes(choices.privacy)) return TIKTOK_PRIVACY_NOT_OFFERED;
  if (testMode && choices.privacy !== "SELF_ONLY") return TIKTOK_TEST_ONLY_ME;
  if (choices.brandedContent && testMode) return TIKTOK_BRANDED_TEST;
  if (choices.brandedContent && choices.privacy === "SELF_ONLY") return TIKTOK_BRANDED_PRIVATE;
  return null;
}

function tiktokChoices(raw: unknown): TikTokChoices {
  const r = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const privacy = typeof r.privacy === "string" && (TIKTOK_PRIVACY_LEVELS as readonly string[]).includes(r.privacy) ? (r.privacy as TikTokChoices["privacy"]) : null;
  return {
    privacy,
    allowComment: r.allowComment === true,
    allowDuet: r.allowDuet === true,
    allowStitch: r.allowStitch === true,
    yourBrand: r.yourBrand === true,
    brandedContent: r.brandedContent === true,
  };
}

// ---------------------------------------------------------------------
// The draft: exactly what will publish
// ---------------------------------------------------------------------

type Draft = {
  view: PostDraftView;
  network: Network;
  conn: ConnectionRecord | null;
  rendition: StoredRendition | null;
  campaign: { id: string; masterGenerationId: string | null };
  caption: string;
  hashtags: string[];
  tiktok: TikTokChoices | null;
  when: { isNow: boolean; at: Date } | null;
  scheduledForCanonical: string | null;
};

async function buildDraft(deps: PublishDeps, caller: Caller, input: PostDraftInput & { when?: PostWhen }): Promise<{ ok: true; draft: Draft } | Fail> {
  if (!input || !isNetwork(input.network)) return fail(POST_FAILED);
  const network = input.network;
  if (typeof input.campaignId !== "string" || !UUID_RE.test(input.campaignId)) return fail(NOT_YOURS);
  const campaignId = input.campaignId.toLowerCase();

  const [access, campaign, conn] = await Promise.all([
    deps.readAccess(caller.userId),
    deps.store.campaignForPost(caller.userId, campaignId),
    deps.store.connection(caller.userId, network),
  ]);
  if (campaign === "unavailable") return fail(POST_FAILED);
  if (!campaign) return fail(NOT_YOURS);

  const blockers: string[] = [];
  const open = access.pressTourOk && open4(access, network);
  if (!open) blockers.push(POSTING_NOT_OPEN);

  const kind = RENDITION_FOR[network];
  const stored = campaign.renditions[kind] ?? null;
  // Ready, and a file in the person's own folder. Posting does NOT wait on
  // C2PA signing (fixer 2026-09-26, PT-R3-01, option a): signing stays off
  // until a certificate and a library are in place, and every delivered
  // file is unsigned until then. The disclosure is the platform's own AI
  // label (forced on every post), the tag on the tagged file and the
  // machine-readable marker the cut writes into both files (cut-encode.ts
  // joinArgs). What posts is still pinned to the approved file's path and
  // sha256, here and again in the worker.
  const rendition = campaign.stage === "ready" && stored && pathOwned(caller.userId, stored.path) ? stored : null;
  if (!rendition) blockers.push(CUT_NOT_READY);

  const connection = connectionView({
    network,
    open,
    configured: configured(deps, network),
    native: deps.native,
    connection: conn ? { handle: conn.handle, displayName: conn.displayName, status: conn.status } : null,
    tiktokAudited: deps.tiktokAudited,
  });
  if (open && !conn) blockers.push(NOT_CONNECTED);
  if (open && conn?.status === "needs_reconnect") blockers.push(RECONNECT_NEEDED);

  const caption = tidyCaption(input.caption);
  const tags = tidyHashtags(input.hashtags);
  const hashtags = tags.ok ? tags.tags : [];
  if (!tags.ok) blockers.push(tags.error);
  for (const p of textProblems(network, caption, hashtags)) if (!blockers.includes(p)) blockers.push(p);

  const whenCheck = checkWhen(network, input.when ?? "now", deps.now());
  if (!whenCheck.ok) blockers.push(whenCheck.error);
  const when = whenCheck.ok ? { isNow: whenCheck.isNow, at: whenCheck.at } : null;
  const scheduledForCanonical = when && !when.isNow ? when.at.toISOString() : null;

  const tiktok = network === "tiktok" ? tiktokChoices(input.tiktok) : null;
  if (tiktok) {
    const e = tiktokStructuralError(tiktok, !deps.tiktokAudited);
    if (e) blockers.push(e);
  }
  const x = network === "x" ? { paidPartnership: input.x?.paidPartnership === true } : null;

  const finalText = composeText(network, caption, hashtags);
  const [videoUrl, posterUrl] = rendition
    ? await Promise.all([
        deps.store.signedUrl(rendition.bucket, rendition.path, PREVIEW_SECONDS).catch(() => null),
        rendition.posterPath ? deps.store.signedUrl(rendition.bucket, rendition.posterPath, PREVIEW_SECONDS).catch(() => null) : Promise.resolve(null),
      ])
    : [null, null];

  const consentToken =
    blockers.length === 0 && rendition && conn
      ? consentHash(
          buildConsent({
            network,
            accountExternalId: conn.externalId,
            rendition: kind,
            renditionSha256: rendition.sha256,
            caption,
            hashtags,
            tiktok,
            x,
            scheduledFor: scheduledForCanonical,
          }),
        )
      : null;

  const view: PostDraftView = {
    network,
    campaignId,
    account: conn ? { connectionId: conn.id, handle: conn.handle, displayName: conn.displayName } : null,
    connection: connection.status,
    rendition: kind,
    videoUrl,
    posterUrl,
    durationSeconds: rendition?.durationSeconds ?? null,
    caption,
    hashtags,
    finalText,
    textLength: textLength(network, finalText),
    textLimit: TEXT_LIMIT[network],
    hashtagLimit: HASHTAG_LIMIT[network],
    captionTag: captionTag(network),
    aiLabel: true,
    aiLabelNote: network === "threads" ? AI_LABEL_NOTE_TEXT : AI_LABEL_NOTE,
    canSchedule: network !== "tiktok",
    when: when && !when.isNow ? when.at.toISOString() : "now",
    x: x ? { ...x, linkNote: X_LINK_NOTE } : null,
    tiktok: tiktok
      ? {
          ...tiktok,
          sheet: null,
          declaration: tiktok.brandedContent ? TIKTOK_DECLARATION_BRANDED : TIKTOK_DECLARATION,
          afterPostNote: TIKTOK_AFTER_POST,
        }
      : null,
    // A shot that missed the product in its role (didn't match, or the product missing: shots.ts takeMissed) is still in the cut (PT-R3-05).
    cutWarning: campaign.productVerdict === "didnt_match" || campaign.productVerdict === "product_missing" ? CUT_WARNING_MISMATCH : null,
    blockers,
    consentToken,
  };
  return {
    ok: true,
    draft: {
      view,
      network,
      conn,
      rendition,
      campaign: { id: campaign.id, masterGenerationId: campaign.masterGenerationId },
      caption,
      hashtags,
      tiktok,
      when,
      scheduledForCanonical,
    },
  };
}

export async function previewPost(deps: PublishDeps, caller: Caller, input: PostDraftInput & { when?: PostWhen }): Promise<{ ok: true; draft: PostDraftView } | Fail> {
  const built = await buildDraft(deps, caller, input);
  return built.ok ? { ok: true, draft: built.draft.view } : built;
}

// ---------------------------------------------------------------------
// Consent: the person's tap
// ---------------------------------------------------------------------

/** The idempotency key of one press on one network (a resent press finds the same row). */
export function idempotencyKey(userId: string, sendId: string, network: Network): string {
  return createHash("sha256").update(`press-post|${userId.toLowerCase()}|${sendId}|${network}`, "utf8").digest("hex");
}

async function consent(
  deps: PublishDeps,
  caller: Caller,
  input: PostDraftInput & ConsentMeta & { when?: PostWhen },
): Promise<{ ok: true; post: PostView } | Fail> {
  if (!input || !isNetwork(input.network)) return fail(POST_FAILED);
  if (typeof input.sendId !== "string" || !SEND_ID_RE.test(input.sendId)) return fail(POST_FAILED);
  const key = idempotencyKey(caller.userId, input.sendId, input.network);

  // A resent press answers with the post the first one made.
  const already = await deps.store.postByKey(key).catch(() => null);
  if (already && already.userId === caller.userId) return { ok: true, post: postView(already, deps.now()) };

  const built = await buildDraft(deps, caller, input);
  if (!built.ok) return built;
  const d = built.draft;
  if (d.view.blockers.length > 0) return fail(d.view.blockers[0]);
  if (!d.conn || !d.rendition || !d.when || !d.view.consentToken) return fail(CUT_NOT_READY);
  if (typeof input.consentToken !== "string" || !SHA_RE.test(input.consentToken) || input.consentToken !== d.view.consentToken) return fail(CUT_CHANGED);
  const network = d.network;
  const at = d.when.at;

  // The same post pressed again (its answer lost, a new send id): the first one, not a second (MONEY-3).
  const repeat = await deps.store.livePostByPayload(d.conn.id, d.view.consentToken, new Date(deps.now().getTime() - REPEAT_PRESS_WINDOW_MS).toISOString());
  if (repeat === "unavailable") return fail(POST_FAILED);
  if (repeat && repeat.userId === caller.userId) return { ok: true, post: postView(repeat, deps.now()) };

  // How much.
  if (await deps.rateLimited(caller.userId, "press-post", 3600, POSTS_PER_HOUR)) return fail(POST_RATE_LIMIT);
  const count = await deps.store.countPosts({
    userId: caller.userId,
    network,
    from: new Date(at.getTime() - DAY_MS).toISOString(),
    to: new Date(at.getTime() + DAY_MS).toISOString(),
  });
  if (count === null) return fail(POST_FAILED);
  if (count >= DAILY_POSTS_PER_PERSON[network]) return fail(DAILY_LIMIT_NETWORK);
  if (caller.via === "trial") {
    const prior = await deps.store.countLivePosts(caller.userId, network);
    const e = trialPostError(caller, network, prior ?? 1);
    if (e) return fail(e);
  }
  if (network === "x" && !xCapOpen(await deps.readXCap().catch(() => 0))) return fail(X_CLOSED_TODAY);

  // TikTok: the account's own options, asked again right now.
  if (network === "tiktok") {
    if (!deps.tiktokAudited) {
      const people = await deps.store.tiktokPeopleSince(new Date(deps.now().getTime() - DAY_MS).toISOString());
      if (people === null) return fail(POST_FAILED);
      if (!people.includes(caller.userId) && people.length >= TIKTOK_TEST_PEOPLE_PER_DAY) return fail(TIKTOK_TEST_FULL);
    }
    const sheet = await readTikTokSheet(deps, caller, d.conn);
    if (!sheet.ok) return sheet;
    const e = tiktokChoiceError(d.tiktok, sheet.sheet, d.rendition.durationSeconds);
    if (e) return fail(e);
  }

  // X's duplicate rule: the same account, the same cut, words this alike, 30 days.
  if (network === "x") {
    const recent = await deps.store.recentOnConnection(d.conn.id, new Date(deps.now().getTime() - DUPLICATE_WINDOW_MS).toISOString());
    if (recent === null) return fail(POST_FAILED);
    const mine = normaliseForMatch(d.view.finalText).slice(0, 600);
    const repeat = recent.some((r) => r.renditionSha256 === d.rendition!.sha256 && similarity(mine, normaliseForMatch(r.finalText).slice(0, 600)) > DUPLICATE_SIMILARITY);
    if (repeat) return fail(DUPLICATE_POST);
  }

  // The words, at consent time: the content gate and the ad policy step.
  const words = [d.caption, d.hashtags.map((t) => `#${t}`).join(" ")].filter(Boolean).join("\n");
  if (words.trim()) {
    const gate = await deps.gateCaption(caller.userId, words);
    if (!gate.ok) return fail(gate.error);
  }

  const consentObject = buildConsent({
    network,
    accountExternalId: d.conn.externalId,
    rendition: RENDITION_FOR[network],
    renditionSha256: d.rendition.sha256,
    caption: d.caption,
    hashtags: d.hashtags,
    tiktok: d.tiktok,
    x: network === "x" ? { paidPartnership: input.x?.paidPartnership === true } : null,
    scheduledFor: d.scheduledForCanonical,
  });
  const hash = consentHash(consentObject);
  if (hash !== input.consentToken) return fail(CUT_CHANGED);
  const record: ConsentRecord = {
    payload_sha256: hash,
    network,
    handle: d.conn.handle,
    ui_version: typeof input.uiVersion === "string" ? input.uiVersion.slice(0, 32) : "",
    locale: typeof input.locale === "string" ? input.locale.slice(0, 16) : "",
    ip_hash: deps.ipHash,
    consented_at: deps.now().toISOString(),
  };

  const inserted = await deps.store.insertPost({
    userId: caller.userId,
    campaignId: d.campaign.id,
    generationId: d.campaign.masterGenerationId,
    connectionId: d.conn.id,
    network,
    accountExternalId: d.conn.externalId,
    rendition: RENDITION_FOR[network],
    renditionPath: d.rendition.path,
    renditionSha256: d.rendition.sha256,
    caption: d.caption,
    hashtags: d.hashtags,
    finalText: consentObject.text,
    options: optionsFor(consentObject),
    aiLabel: true,
    consent: record,
    payloadSha256: hash,
    idempotencyKey: key,
    stage: "queued",
    // "Now" is a few seconds back, so the database's own clock (which the
    // claim compares with) never sees it as still in the future. A "now"
    // consent carries no time, so the hash is unaffected.
    scheduledFor: d.when.isNow ? new Date(at.getTime() - 5_000).toISOString() : at.toISOString(),
    trendDerived: false,
  });
  if (!inserted.ok) {
    if (inserted.reason === "duplicate") {
      const first = await deps.store.postByKey(key).catch(() => null);
      if (first && first.userId === caller.userId) return { ok: true, post: postView(first, deps.now()) };
    }
    return fail(POST_FAILED);
  }
  if (d.when.isNow) deps.kick(inserted.post.id);
  return { ok: true, post: postView(inserted.post, deps.now()) };
}

export function consentAndPost(deps: PublishDeps, caller: Caller, input: PostDraftInput & ConsentMeta): Promise<{ ok: true; post: PostView } | Fail> {
  return consent(deps, caller, { ...input, when: "now" });
}

export async function consentAndSchedule(
  deps: PublishDeps,
  caller: Caller,
  input: PostDraftInput & ConsentMeta & { when: string },
): Promise<{ ok: true; post: PostView } | Fail> {
  if (!input || typeof input.when !== "string" || input.when === "now") return fail(POST_FAILED);
  return consent(deps, caller, input);
}

// ---------------------------------------------------------------------
// Posts
// ---------------------------------------------------------------------

/** Pure: a queue row as the press line shows it. No platform ids, costs or raw errors. */
export function postView(p: PostRecord, now: Date): PostView {
  const due = p.scheduledFor ? Date.parse(p.scheduledFor) <= now.getTime() : true;
  let phase: PostView["phase"];
  let message: string | null = null;
  switch (p.stage) {
    case "draft":
      phase = "scheduled";
      break;
    case "queued":
      phase = due ? "sending" : "scheduled";
      message = due ? POST_SENDING : null;
      break;
    case "claimed":
    case "uploading":
    case "media_ready":
    case "publishing":
    case "retry":
      phase = "sending";
      message = POST_SENDING;
      break;
    case "published":
      phase = "posted";
      message = p.network === "tiktok" ? TIKTOK_AFTER_POST : POST_PUBLISHED;
      break;
    case "unconfirmed":
      phase = "needs_you";
      message = POST_UNCONFIRMED;
      break;
    case "needs_reconnect":
      phase = "needs_you";
      message = p.lastError ?? RECONNECT_NEEDED;
      break;
    case "platform_busy":
      phase = "needs_you";
      message = p.lastError ?? POST_FAILED;
      break;
    case "cancelled":
      phase = "stopped";
      message = p.lastError ?? POST_CANCELLED;
      break;
    case "failed":
      phase = "stopped";
      message = p.lastError ?? POST_FAILED;
      break;
  }
  return {
    id: p.id,
    network: p.network,
    campaignId: p.campaignId,
    stage: p.stage,
    phase,
    scheduledFor: p.scheduledFor,
    handle: p.consent?.handle ?? null,
    finalText: p.finalText,
    permalink: p.permalink,
    publishedAt: p.publishedAt,
    message,
    canCancel: CANCELLABLE_STAGES.includes(p.stage) && p.lockedAt === null,
    updatedAt: p.updatedAt,
  };
}

export async function cancelPost(deps: PublishDeps, userId: string, input: { postId: unknown }): Promise<{ ok: true; post: PostView } | Fail> {
  if (typeof input.postId !== "string" || !UUID_RE.test(input.postId)) return fail(NOT_YOURS);
  const r = await deps.store.cancelPost(userId, input.postId.toLowerCase(), POST_CANCELLED);
  if (!r.post) return fail(NOT_YOURS);
  if (r.cancelled || r.post.stage === "cancelled") return { ok: true, post: postView(r.post, deps.now()) };
  return fail(POST_NOT_CANCELLABLE);
}

export async function listPosts(deps: PublishDeps, userId: string, input: { campaignId?: unknown }): Promise<{ ok: true; posts: PostView[] } | Fail> {
  let campaignId: string | null = null;
  if (input.campaignId !== undefined && input.campaignId !== null) {
    if (typeof input.campaignId !== "string" || !UUID_RE.test(input.campaignId)) return fail(NOT_YOURS);
    campaignId = input.campaignId.toLowerCase();
  }
  const rows = await deps.store.posts(userId, campaignId, 100);
  const now = deps.now();
  return { ok: true, posts: rows.map((p) => postView(p, now)) };
}
