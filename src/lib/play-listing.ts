// The Google Play listing, and whether it is actually there.
//
// The Android app was suspended on 2026-09-09 and the listing has answered
// 404 ever since, while the badge on the marketing pages and the line in
// every email footer kept pointing straight at it (noticed 2026-09-14,
// closed 2026-09-18). Both now ask this module instead of writing the
// address themselves, so the day the appeal lands ONE line brings the badge,
// the header's Android path and the email footer back together.
//
// Pure and import-free on purpose: a client component, a server email
// renderer and the tests all read it.

/** The listing's address. Google's badge artwork may only link here. */
export const PLAY_STORE_URL = "https://play.google.com/store/apps/details?id=ai.picacho.app";

/**
 * Whether the listing can be reached. It was FALSE while the app was
 * suspended (2026-09-09 to 2026-09-21): nothing could link to it, since every
 * visitor who followed it landed on a 404 with our badge above it. TRUE since
 * version 17 went live on 2026-09-21 (the listing answers again, "Updated on
 * Sep 21, 2026"). Set it back to false if the listing ever goes down again;
 * nothing else needs changing.
 */
export const PLAY_LISTING_LIVE = true;
