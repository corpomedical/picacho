// Every sentence publishing shows a person, in English. The UI maps each one
// into the four locales (i18n/server-text.ts); the engine never builds a
// sentence out of parts, so a translation is always a whole line. No vendor,
// engine or machine words ("token", "API", "queue", "rendition", "container").
//
// Alias-free (vitest has no '@/').

// Who may post, and where
export const POSTING_NOT_OPEN = "Posting isn't open on this account yet.";
export const POSTING_PAUSED = "Posting to this network is paused for the moment. Nothing was posted.";
export const COMING_SOON = "Coming soon.";
export const TIKTOK_SAVE_INSTEAD = "Posting straight to TikTok is in private testing. Save the video for TikTok instead.";
export const TIKTOK_TEST_MODE_NOTE = "Private test mode: TikTok offers only \"Only me\", and the account must be private.";

// Connecting
export const CONNECT_ON_COMPUTER = "Connect accounts on a computer. Posting through an account you connected works here too.";
export const CONNECT_UNAVAILABLE = "Connecting this network isn't set up yet.";
export const CONNECT_OTHER_SITE = "Open Picacho at picacho.ai to connect accounts, then try again.";
export const CONNECT_LIMIT = "That's a lot of connecting in an hour. Try again a little later.";
export const CONNECT_FAILED = "We couldn't connect that account. Try again.";
export const NOT_CONNECTED = "Connect an account to post here.";
export const RECONNECT_NEEDED = "Reconnect this account to post.";

// The cut
export const CUT_NOT_READY = "This ad isn't ready to post yet.";
export const CUT_CHANGED = "The ad changed since you looked. Check it again, then post.";
export const CUT_WARNING_MISMATCH = "A shot that didn't match your product is still in this ad.";

// The words
export const TEXT_TOO_LONG = "The text is too long for this network.";
export const TOO_MANY_HASHTAGS = "That's too many hashtags for this network.";
export const HASHTAG_INVALID = "Hashtags can use letters, numbers and _ only.";
export const X_NO_LINKS = "Links can't go in posts to X yet. Put the link in your bio and write \"link in bio\".";
export const X_LINK_NOTE = "Link in bio: posts to X carry no links.";
export const CAPTION_REFUSED = "This text can't be posted. Change it and try again.";
export const CAPTION_REFUSED_AD_RULES =
  "This text breaks the ad rules: no invented reviews, no hidden sponsorship, no \"best\" or health claims. Change it and try again.";
export const CAPTION_CHECK_UNAVAILABLE = "We couldn't check the text just now. Try again in a moment.";
export const DUPLICATE_POST = "You posted this ad with almost the same words to this account recently. Change the caption or the cut.";

// The AI label (forced on)
export const AI_LABEL_NOTE = "Marked as made with AI";
export const AI_LABEL_NOTE_TEXT = "\"Made with AI\" is added to the text";
/** Posted content: the visible line Threads carries (it has no label field). */
export const THREADS_AI_TAG = "Made with AI";

// Limits and time
export const DAILY_LIMIT_NETWORK = "That's all the posts to this network for today. Try again tomorrow.";
export const X_CLOSED_TODAY = "Posting to X is closed for today. Try again tomorrow.";
export const POST_RATE_LIMIT = "That's a lot of posting in an hour. Try again a little later.";
export const SCHEDULE_TIKTOK = "TikTok posts go out only when you press Post.";
export const SCHEDULE_TOO_SOON = "Pick a time at least 5 minutes from now.";
export const SCHEDULE_TOO_FAR = "Pick a time within the next 30 days.";
export const SCHEDULE_INVALID = "That time doesn't look right. Pick it again.";
export const TRIAL_X_ONCE = "Your free ad can be posted once, to X.";

// TikTok's sheet
export const TIKTOK_PRIVACY_REQUIRED = "Choose who can see this video.";
export const TIKTOK_PRIVACY_NOT_OFFERED = "TikTok doesn't offer that choice for this account. Choose again.";
export const TIKTOK_TEST_ONLY_ME = "In test mode TikTok offers only \"Only me\".";
export const TIKTOK_BRANDED_PRIVATE = "Branded content can't be set to \"Only me\".";
export const TIKTOK_BRANDED_TEST = "Branded content isn't available in test mode.";
export const TIKTOK_INTERACTION_OFF = "This account turned that off in TikTok.";
export const TIKTOK_TOO_LONG = "This video is longer than this TikTok account can post.";
export const TIKTOK_ACCOUNT_PUBLIC =
  "In test mode TikTok takes posts only from private accounts. Set your TikTok account to private, then try again.";
export const TIKTOK_CANT_POST_NOW = "TikTok says this account can't post more right now. Try again later.";
export const TIKTOK_TEST_FULL = "Test posting to TikTok is full for today. Try again tomorrow.";
export const TIKTOK_UNAVAILABLE = "We couldn't reach TikTok just now. Try again in a moment.";
export const TIKTOK_DECLARATION = "By posting, you agree to TikTok's Music Usage Confirmation.";
export const TIKTOK_DECLARATION_BRANDED =
  "By posting, you agree to TikTok's Branded Content Policy and Music Usage Confirmation.";
export const TIKTOK_AFTER_POST = "It can take a few minutes to appear on your profile.";

// A post's life
export const POST_SENDING = "Going out now.";
export const POST_PUBLISHED = "Posted.";
export const POST_UNCONFIRMED = "We couldn't confirm this went out. Check your profile before posting again.";
export const POST_CANCELLED = "Cancelled. Nothing was posted.";
export const POST_NOT_CANCELLABLE = "This post is already going out, so it can't be cancelled.";
export const NETWORK_BUSY = "The network is busy right now. Nothing was posted. Pick a new time.";
export const NETWORK_LIMIT_REACHED = "This account reached the network's posting limit for today. Nothing was posted. Pick a new time.";
export const MEDIA_REJECTED = "The network couldn't take this video. Nothing was posted.";
export const UPLOAD_FAILED = "We couldn't send the video. Nothing was posted.";
export const POST_REJECTED = "The network turned this post down. Nothing was posted.";
export const X_REPEAT_REJECTED = "X turned this down as a repeat. Nothing was posted. Change the caption or the cut.";
export const CONNECTION_GONE = "The account was disconnected. Nothing was posted.";
export const POST_ACCESS_LOST = "Posting isn't open on this account any more. Nothing was posted.";
export const POST_NO_LONGER_MATCHES = "What would post no longer matches what you approved, so nothing was posted.";
export const POST_FAILED = "Something went wrong on our side. Nothing was posted.";

/** Every constant above, for the UI's translation map and the banned-word test. */
export const SOCIAL_MESSAGES = [
  POSTING_NOT_OPEN,
  POSTING_PAUSED,
  COMING_SOON,
  TIKTOK_SAVE_INSTEAD,
  TIKTOK_TEST_MODE_NOTE,
  CONNECT_ON_COMPUTER,
  CONNECT_UNAVAILABLE,
  CONNECT_OTHER_SITE,
  CONNECT_LIMIT,
  CONNECT_FAILED,
  NOT_CONNECTED,
  RECONNECT_NEEDED,
  CUT_NOT_READY,
  CUT_CHANGED,
  CUT_WARNING_MISMATCH,
  TEXT_TOO_LONG,
  TOO_MANY_HASHTAGS,
  HASHTAG_INVALID,
  X_NO_LINKS,
  X_LINK_NOTE,
  CAPTION_REFUSED,
  CAPTION_REFUSED_AD_RULES,
  CAPTION_CHECK_UNAVAILABLE,
  DUPLICATE_POST,
  AI_LABEL_NOTE,
  AI_LABEL_NOTE_TEXT,
  THREADS_AI_TAG,
  DAILY_LIMIT_NETWORK,
  X_CLOSED_TODAY,
  POST_RATE_LIMIT,
  SCHEDULE_TIKTOK,
  SCHEDULE_TOO_SOON,
  SCHEDULE_TOO_FAR,
  SCHEDULE_INVALID,
  TRIAL_X_ONCE,
  TIKTOK_PRIVACY_REQUIRED,
  TIKTOK_PRIVACY_NOT_OFFERED,
  TIKTOK_TEST_ONLY_ME,
  TIKTOK_BRANDED_PRIVATE,
  TIKTOK_BRANDED_TEST,
  TIKTOK_INTERACTION_OFF,
  TIKTOK_TOO_LONG,
  TIKTOK_ACCOUNT_PUBLIC,
  TIKTOK_CANT_POST_NOW,
  TIKTOK_TEST_FULL,
  TIKTOK_UNAVAILABLE,
  TIKTOK_DECLARATION,
  TIKTOK_DECLARATION_BRANDED,
  TIKTOK_AFTER_POST,
  POST_SENDING,
  POST_PUBLISHED,
  POST_UNCONFIRMED,
  POST_CANCELLED,
  POST_NOT_CANCELLABLE,
  NETWORK_BUSY,
  NETWORK_LIMIT_REACHED,
  MEDIA_REJECTED,
  UPLOAD_FAILED,
  POST_REJECTED,
  X_REPEAT_REJECTED,
  CONNECTION_GONE,
  POST_ACCESS_LOST,
  POST_NO_LONGER_MATCHES,
  POST_FAILED,
] as const;

/**
 * The codes a connect callback sends the browser back with
 * (?connect_error=<code>), for the door to show the matching line:
 *   denied    the person said no on the network's page
 *   expired   the connect press is older than 10 minutes, or was used
 *   session   signed out, or signed in as someone else, since the press
 *   closed    posting to that network isn't open to them (any more)
 *   failed    the network's answer couldn't be used
 */
export const CONNECT_ERROR_CODES = ["denied", "expired", "session", "closed", "failed"] as const;
export type ConnectErrorCode = (typeof CONNECT_ERROR_CODES)[number];
