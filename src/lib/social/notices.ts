// What the posts worker tells the person, as push messages (integration,
// 2026-09-26): a post that went out, a post that didn't, and an account to
// connect again. The words live in lib/push/text.ts and the four catalogs
// (postPublished / postFailed / reconnectNeeded, params.network = the
// network's own name); this file only picks the key, the network's name and
// where the notification opens. Pure and alias-free; runtime.ts sends them.

import { adPath } from "../press-tour/cut-state";
import { NETWORK_NAMES } from "../press-tour/press-line-view";
import type { Network } from "../press-tour/publish-types";
import type { SettledPost } from "./worker";

export type PostNoticeKey = "postPublished" | "postFailed" | "reconnectNeeded";
export type PostNotice = { key: PostNoticeKey; params: { network: string }; path: string };

/** The door's own address; a post's ad opens on its press line. */
const DOOR = "/app/press-tour";

/** A settled post's notice: it opens the press line of the ad it belongs to. */
export function postNotice(post: SettledPost, outcome: "published" | "failed"): PostNotice {
  return {
    key: outcome === "published" ? "postPublished" : "postFailed",
    params: { network: NETWORK_NAMES[post.network] },
    path: post.campaignId ? `${adPath(post.campaignId)}#press-line` : DOOR,
  };
}

/** An account to connect again: it opens the door, where "Posting accounts" has Reconnect. */
export function reconnectNotice(network: Network): PostNotice {
  return { key: "reconnectNeeded", params: { network: NETWORK_NAMES[network] }, path: DOOR };
}

/** The limiter's scope for one account's reconnect push: at most one a day per person and network (runtime.ts). */
export function reconnectPushScope(network: Network): string {
  return `social-reconnect-push:${network}`;
}
