// What every network adapter (x.ts, tiktok.ts, instagram.ts, threads.ts)
// implements, and what the worker hands it. Types only, plus two tiny
// helpers. Alias-free (vitest has no '@/').
//
// THE RULES EVERY ADAPTER KEEPS (spec §2.1, v2 #14, #23, #36):
//   - Requests are built ONLY from the consented object (ctx.consent) and
//     the consented file (ctx.media, whose bytes the worker checks against
//     the consented sha256). Nothing else the row holds reaches a network.
//   - Media is created at SEND time, never at schedule time.
//   - Every platform id is saved (ctx.save) the moment it exists, before
//     the next call, so a resumed post continues from it.
//   - The call that makes a post public is preceded by ctx.save({stage:
//     'publishing'}) and is NEVER sent twice: a lost answer is 'unconfirmed'.
//   - The AI label is always on: X made_with_ai, TikTok is_aigc, Instagram
//     is_ai_generated, Threads a visible "Made with AI" line in the text.

import type { FetchLike } from "./http";
import type { RefreshAnswer } from "./vault";
import type { ConsentObject } from "./consent";
import type { Network, PostStage } from "../press-tour/publish-types";

/** The app's own credentials at a network (client id / key and secret). */
export type Credentials = { clientId: string; clientSecret: string };

/** What a code exchange answers. */
export type TokenAnswer = {
  accessToken: string;
  refreshToken: string | null;
  accessExpiresAt: Date | null;
  refreshExpiresAt: Date | null;
  scopes: string[];
  /** The account id when the exchange already names it (TikTok open_id, Instagram and Threads user_id). */
  externalId: string | null;
};

export type Profile = { externalId: string; handle: string | null; displayName: string | null };

export class OAuthExchangeError extends Error {
  constructor(readonly network: Network, readonly reason: string) {
    super(`${network}: ${reason}`);
    this.name = "OAuthExchangeError";
  }
}

export interface OAuthAdapter {
  network: Network;
  scopes: readonly string[];
  /** X uses PKCE (S256); TikTok, Instagram and Threads on the web authenticate with the app secret instead. */
  usesPkce: boolean;
  /** The environment variables holding the app's credentials. */
  envKeys: { id: string; secret: string };
  authorizeUrl(input: { creds: Credentials; redirectUri: string; state: string; codeChallenge: string | null }): string;
  /** Throws OAuthExchangeError when the network refuses or the answer can't be read. */
  exchangeCode(
    fetchImpl: FetchLike,
    input: { creds: Credentials; code: string; redirectUri: string; verifier: string | null; now: Date },
  ): Promise<TokenAnswer>;
  /** Throws OAuthExchangeError when the account can't be read. */
  profile(fetchImpl: FetchLike, input: { accessToken: string; token: TokenAnswer }): Promise<Profile>;
  refresh(
    fetchImpl: FetchLike,
    input: { creds: Credentials; accessToken: string; refreshToken: string | null; now: Date },
  ): Promise<RefreshAnswer>;
  /** 'unsupported' when the network has no revoke call (the key simply expires). */
  revoke(fetchImpl: FetchLike, input: { creds: Credentials; token: string; kind: "access" | "refresh" }): Promise<"done" | "unsupported" | "failed">;
}

/** The consented file, as a network needs it. */
export interface MediaSource {
  sizeBytes: number | null;
  durationSeconds: number | null;
  /** The bytes; the worker's implementation refuses (throws) when their sha256 isn't the consented one. */
  bytes(): Promise<Buffer>;
  /** A link the network can fetch the file from (Instagram, Threads), valid for `seconds`. */
  publicUrl(seconds: number): Promise<string>;
}

/** What a step writes back under the lease. costUsd is ADDED to the row's. */
export type StepPatch = {
  stage?: PostStage;
  externalIds?: Record<string, unknown>;
  costUsd?: number;
  uploadAttempts?: number;
};

/** The worker's state of the post, as the adapter reads it. */
export type PostState = {
  id: string;
  stage: PostStage;
  externalIds: Record<string, unknown>;
  uploadAttempts: number;
  createdAt: string;
};

export interface SendContext {
  post: PostState;
  consent: ConsentObject;
  account: { externalId: string; handle: string | null };
  accessToken: string;
  creds: Credentials;
  media: MediaSource;
  fetch: FetchLike;
  now(): Date;
  sleep(ms: number): Promise<void>;
  /** Epoch ms: stop starting new calls after this and wait instead. */
  deadline: number;
  /** Write under the lease. Throws LeaseLostError when the lease is gone. */
  save(patch: StepPatch): Promise<void>;
  /** TikTok: the audit has passed (false in v1: private test mode). */
  tiktokAudited: boolean;
}

export class LeaseLostError extends Error {
  constructor() {
    super("lease lost");
    this.name = "LeaseLostError";
  }
}

export type StepOutcome =
  /** The stage is saved; release the lease and look again at resumeAt. */
  | { kind: "wait"; resumeAt: Date }
  | { kind: "published"; externalPostId: string | null; permalink: string | null }
  /** An upload step failed; nothing is public. The worker retries with backoff, within the network's attempts. */
  | { kind: "retry"; error: string }
  /** Definite: nothing was posted, and sending again won't help. */
  | { kind: "failed"; error: string }
  /** The network said "not now": nothing was posted; the person picks a new time. */
  | { kind: "busy"; error: string }
  /** The answer to the call that makes it public was lost: never sent again. */
  | { kind: "unconfirmed" }
  /** The network no longer accepts the account's keys. */
  | { kind: "reconnect" };

export interface PostingAdapter {
  network: Network;
  /** Upload attempts before 'retry' becomes 'failed' (X: 2, v2 #23 "at most 1 upload retry"). */
  maxUploadAttempts: number;
  advance(ctx: SendContext): Promise<StepOutcome>;
}

/** True when there is less than `ms` left before the step's deadline. */
export function nearDeadline(ctx: Pick<SendContext, "deadline" | "now">, ms: number): boolean {
  return ctx.now().getTime() + ms > ctx.deadline;
}

/** The later of two ids objects, merged (a step keeps what earlier steps saved). */
export function mergeIds(a: Record<string, unknown>, b: Record<string, unknown>): Record<string, unknown> {
  return { ...a, ...b };
}
