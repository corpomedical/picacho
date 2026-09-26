// The contract between the Press Tour publish sheet (UI: the press line) and
// the publishing engine (server: src/lib/social/). Both sides build against
// these shapes; the engine owns their meaning. Alias-free on purpose: the
// money and policy modules import it under vitest, which has no "@/" alias.
//
// Sources: press-tour spec v1 §2 (one queue, consent records, the TikTok
// sheet) as corrected by the synthesis v2 (#14 the consent hash, #23 X,
// #24 the X ceiling, #36 TikTok test mode; S7 no link toggle, S8 TikTok
// posts only on press, S10 "Marked as made with AI") and the operator's
// decisions of 2026-09-26: a small visible "AI-generated" tag on every ad
// file EXCEPT TikTok's (TikTok forbids watermarks and logos; its own label
// does that job), and the platform's AI label forced on every post.
//
// Every English sentence the engine answers with is a constant in
// src/lib/social/messages.ts (SOCIAL_MESSAGES), which the UI maps into the
// four locales. Nothing here names a vendor, an engine or a machine part.

/** The networks Press Tour posts to (v1). */
export const NETWORKS = ["x", "tiktok", "instagram", "threads"] as const;
export type Network = (typeof NETWORKS)[number];

export function isNetwork(value: unknown): value is Network {
  return typeof value === "string" && (NETWORKS as readonly string[]).includes(value);
}

/**
 * The two finished files a campaign's cut is delivered as (Cut 4 writes
 * them; press_campaigns.renditions):
 *   - clean:  no tag, no logo, no end card. TikTok's (it forbids
 *             promotional watermarks and logos; is_aigc labels it instead).
 *   - tagged: carries the small visible "AI-generated" tag (about 2% of the
 *             frame height, in a bottom corner holding neither product nor
 *             face). X's, Instagram's and Threads'.
 */
export type RenditionKind = "clean" | "tagged";

/** Which file each network gets. Fixed: never a choice on the sheet. */
export const RENDITION_FOR: Readonly<Record<Network, RenditionKind>> = {
  x: "tagged",
  tiktok: "clean",
  instagram: "tagged",
  threads: "tagged",
};

/**
 * How a network row reads on the sheet:
 *   connected       an account is connected and can post;
 *   needs_reconnect the network stopped accepting the account's keys: connect again;
 *   not_connected   posting is open to this person, no account yet;
 *   coming_soon     posting to this network isn't open to this person yet
 *                   (Meta before App Review for anyone who isn't a tester;
 *                   TikTok's private test for anyone who isn't a tester);
 *   test_mode       TikTok, connected, before TikTok's audit: posts are
 *                   "Only me" and the account must be private.
 */
export type ConnectionStatus = "connected" | "needs_reconnect" | "not_connected" | "coming_soon" | "test_mode";

export interface ConnectionView {
  network: Network;
  /** The account's handle without "@", or null when none is connected. */
  handle: string | null;
  /** The account's display name (TikTok's nickname: the sheet must show it). */
  displayName: string | null;
  status: ConnectionStatus;
  /** True when the Connect button works here (open to this person, on the web, set up). */
  canConnect: boolean;
  /** True in the phone app: connecting happens on a computer (posting through a connected account still works). */
  webOnly: boolean;
  /** TikTok before its audit ("Private test mode"). */
  testMode: boolean;
  /** One plain sentence for the row, or null (e.g. why it can't connect). */
  note: string | null;
}

// ---------------------------------------------------------------------
// TikTok's sheet (constraints §6A: every element the audit checks)
// ---------------------------------------------------------------------

export const TIKTOK_PRIVACY_LEVELS = [
  "PUBLIC_TO_EVERYONE",
  "MUTUAL_FOLLOW_FRIENDS",
  "FOLLOWER_OF_CREATOR",
  "SELF_ONLY",
] as const;
export type TikTokPrivacy = (typeof TIKTOK_PRIVACY_LEVELS)[number];

/** What TikTok's creator_info says, as the sheet uses it. Asked when the sheet opens and again right before sending. */
export interface TikTokSheetState {
  /** Must be shown: the account the video goes to. */
  nickname: string;
  username: string;
  /** Expires about 2 hours after it was read. */
  avatarUrl: string | null;
  /** The privacy options to offer, in TikTok's order; in test mode only "SELF_ONLY" ("Only me"). No default is ever chosen. */
  privacyOptions: TikTokPrivacy[];
  /** The creator turned these off in TikTok: the matching toggle is greyed out and stays off. */
  commentDisabled: boolean;
  duetDisabled: boolean;
  stitchDisabled: boolean;
  /** The longest video this creator may post, in seconds. */
  maxDurationSeconds: number;
  /** Before TikTok's audit: "Only me" only, branded content unavailable, the account must be private. */
  testMode: boolean;
  /** False in test mode ("Not available in test mode"). */
  brandedContentAvailable: boolean;
  /** False when TikTok says this account can't post right now, or the account is public in test mode. */
  canPost: boolean;
  /** Why it can't post, in plain words, or null. */
  blocker: string | null;
  /** ISO time it was read. */
  fetchedAt: string;
}

/** The choices the person makes on TikTok's sheet. Every toggle starts OFF; privacy starts EMPTY. */
export interface TikTokChoices {
  /** Must be chosen by the person; null = not chosen yet (Post stays disabled). */
  privacy: TikTokPrivacy | null;
  allowComment: boolean;
  allowDuet: boolean;
  allowStitch: boolean;
  /** "Your brand" → labelled "Promotional content" (brand_organic_toggle). */
  yourBrand: boolean;
  /** "Branded content" → labelled "Paid partnership" (brand_content_toggle); never "Only me". */
  brandedContent: boolean;
}

export const TIKTOK_CHOICES_DEFAULT: Readonly<TikTokChoices> = {
  privacy: null,
  allowComment: false,
  allowDuet: false,
  allowStitch: false,
  yourBrand: false,
  brandedContent: false,
};

/** X's one choice (the link toggle is not in v1: captions say "link in bio"). */
export interface XChoices {
  /** The post is a paid partnership → "labeled as a paid promotion". Off by default. */
  paidPartnership: boolean;
}

// ---------------------------------------------------------------------
// The sheet: what the person sees, and what they send
// ---------------------------------------------------------------------

/** "now", or an ISO time at least 5 minutes and at most 30 days ahead (never for TikTok). */
export type PostWhen = "now" | string;

/** What the sheet sends for one network. The same fields go to previewPost, consentAndPost and consentAndSchedule. */
export interface PostDraftInput {
  campaignId: string;
  network: Network;
  /** The person's own words; Picacho never edits them or adds hashtags. */
  caption: string;
  /** Without "#"; letters, digits and "_" only. */
  hashtags: string[];
  x?: XChoices | null;
  tiktok?: TikTokChoices | null;
}

/** A post as the sheet shows it before the person consents: exactly what will publish. */
export interface PostDraftView {
  network: Network;
  campaignId: string;
  /** The account it posts as, or null when none is connected. */
  account: { connectionId: string; handle: string | null; displayName: string | null } | null;
  connection: ConnectionStatus;
  rendition: RenditionKind;
  /** A short-lived link to preview the very file that posts; null while the cut isn't ready. */
  videoUrl: string | null;
  posterUrl: string | null;
  durationSeconds: number | null;
  caption: string;
  hashtags: string[];
  /** The exact text that posts: the caption, the hashtags and, on Threads, the "Made with AI" line. */
  finalText: string;
  /** Characters counted the network's way, and its limit. */
  textLength: number;
  textLimit: number;
  hashtagLimit: number;
  /** The line Picacho adds to the text (Threads: "Made with AI"), shown in the preview; null elsewhere. */
  captionTag: string | null;
  /** Always true: the platform's AI label is forced on and cannot be switched off. */
  aiLabel: true;
  /** How the label shows, in plain words (e.g. "Marked as made with AI"). */
  aiLabelNote: string;
  /** False for TikTok: it posts only when the person presses Post. */
  canSchedule: boolean;
  when: PostWhen;
  x: (XChoices & { linkNote: string }) | null;
  tiktok: (TikTokChoices & {
    sheet: TikTokSheetState | null;
    /** The declaration line to show (Music Usage Confirmation, plus the Branded Content Policy when ticked). */
    declaration: string;
    /** Shown after posting: "It can take a few minutes to appear on your profile." */
    afterPostNote: string;
  }) | null;
  /** A shot that didn't match the product is still in the cut (the person may still post). */
  cutWarning: string | null;
  /** Plain reasons Post / Schedule is disabled; empty when it can go. */
  blockers: string[];
  /**
   * The consent token: the hash of exactly what the sheet shows. Sent back
   * with consentAndPost / consentAndSchedule; if anything changed since
   * (the cut, the account, the words), the press is refused and the sheet
   * asks again. Null while something blocks.
   */
  consentToken: string | null;
}

/** The queue's stages (spec §2.1). */
export const POST_STAGES = [
  "draft",
  "queued",
  "claimed",
  "uploading",
  "media_ready",
  "publishing",
  "published",
  "retry",
  "failed",
  "unconfirmed",
  "needs_reconnect",
  "platform_busy",
  "cancelled",
] as const;
export type PostStage = (typeof POST_STAGES)[number];

/** One post, as the press line and the calendar show it. No platform ids, costs or raw errors. */
export interface PostView {
  id: string;
  network: Network;
  campaignId: string | null;
  stage: PostStage;
  /** A plain phase for the row: waiting for its time, going out now, out, or needs the person. */
  phase: "scheduled" | "sending" | "posted" | "needs_you" | "stopped";
  /** When it goes (or went) out; null for a draft. */
  scheduledFor: string | null;
  handle: string | null;
  finalText: string;
  /** The post on the network, when it is public and known. */
  permalink: string | null;
  publishedAt: string | null;
  /** One plain sentence for the row, or null. */
  message: string | null;
  /** The person may still cancel it (nothing has gone to the network yet). */
  canCancel: boolean;
  updatedAt: string;
}

// ---------------------------------------------------------------------
// The actions (implemented in publish-actions.ts, "use server")
// ---------------------------------------------------------------------

export type ConnectionsResult = { ok: true; connections: ConnectionView[] } | { ok: false; error: string };
export type ConnectStartResult = { ok: true; url: string } | { ok: false; error: string };
export type TikTokSheetResult = { ok: true; sheet: TikTokSheetState } | { ok: false; error: string };
export type PreviewResult = { ok: true; draft: PostDraftView } | { ok: false; error: string };
export type PostResult = { ok: true; post: PostView } | { ok: false; error: string };
export type PostsResult = { ok: true; posts: PostView[] } | { ok: false; error: string };

/** What the person's press carries besides the draft: who pressed, once. */
export interface ConsentMeta {
  /** Client-made id, one per press: a resent press answers with the same post and never posts twice. */
  sendId: string;
  /** The token previewPost answered for exactly this draft. */
  consentToken: string;
  /** The sheet's locale ('en' | 'es' | 'pt' | 'it'). */
  locale: string;
  /** The sheet's version, recorded with the consent. */
  uiVersion: string;
}

export interface PublishActions {
  /** Every network's row, in NETWORKS order. */
  listConnections(): Promise<ConnectionsResult>;
  /** Start connecting an account: the address to send the browser to. Web only. */
  connectStart(input: { network: Network; returnTo?: string }): Promise<ConnectStartResult>;
  /** Disconnect: queued posts through it are cancelled, its keys are revoked and deleted. */
  disconnect(input: { network: Network }): Promise<ConnectionsResult>;
  /** Read TikTok's creator_info for the sheet (on open). */
  prepareTikTokSheet(input: { campaignId: string }): Promise<TikTokSheetResult>;
  /** Exactly what will publish, with its blockers and the consent token. Free; posts nothing. */
  previewPost(input: PostDraftInput & { when?: PostWhen }): Promise<PreviewResult>;
  /** The person's tap on Post: consent recorded, the post goes out now. */
  consentAndPost(input: PostDraftInput & ConsentMeta): Promise<PostResult>;
  /** The person's tap on Schedule (never TikTok). `when` is an ISO time. */
  consentAndSchedule(input: PostDraftInput & ConsentMeta & { when: string }): Promise<PostResult>;
  /** Cancel a post that hasn't gone to the network yet. */
  cancelPost(input: { postId: string }): Promise<PostResult>;
  /** A campaign's posts (or every recent post), newest first. */
  listPosts(input: { campaignId?: string | null }): Promise<PostsResult>;
}
