// The four networks' adapters, in one place. Alias-free (vitest has no '@/').

import type { Network } from "../press-tour/publish-types";
import type { OAuthAdapter, PostingAdapter } from "./adapter";
import { instagramOAuth, instagramPosting } from "./instagram";
import { threadsOAuth, threadsPosting } from "./threads";
import { tiktokOAuth, tiktokPosting } from "./tiktok";
import { xOAuth, xPosting } from "./x";

export const OAUTH: Readonly<Record<Network, OAuthAdapter>> = {
  x: xOAuth,
  tiktok: tiktokOAuth,
  instagram: instagramOAuth,
  threads: threadsOAuth,
};

export const POSTING: Readonly<Record<Network, PostingAdapter>> = {
  x: xPosting,
  tiktok: tiktokPosting,
  instagram: instagramPosting,
  threads: threadsPosting,
};

/** Every environment variable a network needs (for Admin and the operator's list). */
export function networkEnvKeys(network: Network): string[] {
  const a = OAUTH[network];
  return [a.envKeys.id, a.envKeys.secret];
}
