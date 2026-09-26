// What a person reads while connecting Picacho to Claude, ChatGPT or another
// app, and in Settings › Security › Connected apps. English: the wire form
// the UI agent maps into the four locales (i18n is not edited here).
//
// Customer-copy rules (spec §0; house rules): no machinery words (no
// "OAuth", "token", "scope", "client", "server"), nothing sold, no plans or
// prices, and every sentence says what happened and what to do next.
//
// Pure, alias-free, no imports.

import type { McpScope } from "./config";

// --- The consent page ------------------------------------------------------

export const CONSENT_TITLE = "Connect {app} to Picacho";
export const CONSENT_LEAD = "{app} wants to use your Picacho account.";
/** Under the name, for a host whose own address we recognise. */
export const CONSENT_VERIFIED = "Verified: {host}";
/** Under the name, for a desktop tool (Claude Code and the like). */
export const CONSENT_THIS_COMPUTER = "Runs on this computer";
/** Under the name, for anything else. */
export const CONSENT_UNVERIFIED = "Picacho hasn't verified this app, so it can only see your account.";
export const CONSENT_RETURNS_TO = "After you answer, you go back to {host}.";
export const CONSENT_IT_CAN = "It will be able to:";
export const CONSENT_SIGNED_IN_AS = "Signed in as {email}";
export const CONSENT_ALLOW = "Allow";
export const CONSENT_DENY = "Don't allow";
export const CONSENT_FOOTER = "You can disconnect it at any time in Settings › Security › Connected apps.";
/**
 * True of Press Tour only: an ad's paid steps are app-only tools behind a
 * one-time code only Picacho's card holds. A single picture
 * (generate_image) is still the app's to ask for, so nothing here claims
 * more than the ad.
 */
export const CONSENT_MONEY_LINE = "An ad's stills and filming are only paid for when you tap Picacho's own card.";
export const CONSENT_RETURNING = "Taking you back to {app}…";
export const CONSENT_CONTINUE = "Continue";

/** What each permission means, in plain words (spec §4.2: "Spend your credits on ads you approve"). */
export const SCOPE_WORDS: Record<McpScope, string> = {
  read: "See your characters, products, brand kits, credits and ads",
  brand: "Add products from links you share",
  generate: "Spend your credits on pictures and ads you ask for",
};

// --- The consent page's dead ends (codes on the URL, never text) -------------

export const CONSENT_ERRORS = {
  expired: "This connection request has expired. Go back to the app you came from and connect again.",
  other_account: "This connection request was started for another Picacho account.",
  not_open: "Connecting apps isn't open to your account yet.",
  unknown_client: "We don't recognise the app that sent you here. Go back to it and connect again.",
  bad_redirect: "The app that sent you here asked to return somewhere it didn't register. Nothing was connected.",
  client_disabled: "This app can no longer connect to Picacho.",
  unavailable: "We couldn't open this connection request just now. Try again in a moment.",
  failed: "Something went wrong on our side. Go back to the app and connect again.",
} as const;
export type ConsentErrorCode = keyof typeof CONSENT_ERRORS;

// --- Settings › Security › Connected apps ------------------------------------

export const CONNECTED_APPS_TITLE = "Connected apps";
export const CONNECTED_APPS_DESC = "Apps you've allowed to use your Picacho account, such as Claude or ChatGPT.";
export const CONNECTED_APPS_EMPTY = "No apps are connected.";
export const CONNECTED_APPS_CONNECTED = "Connected {date}";
export const CONNECTED_APPS_LAST_USED = "last used {date}";
export const CONNECTED_APPS_NEVER_USED = "not used yet";
export const CONNECTED_APPS_THIS_COMPUTER = "on this computer";
export const CONNECTED_APPS_REVOKE = "Disconnect";
export const CONNECTED_APPS_REVOKING = "Disconnecting…";
export const CONNECTED_APPS_REVOKED = "Disconnected. It can't use your account any more.";
export const CONNECTED_APPS_NOT_FOUND = "That app isn't connected to this account.";
export const CONNECTED_APPS_FAILED = "We couldn't disconnect that app just now. Try again.";
export const CONNECTED_APPS_SESSION = "Your session expired. Sign in again.";

/** Every fixed sentence above, for the i18n map and its truth-contract test. */
export const OAUTH_MESSAGES = [
  CONSENT_TITLE,
  CONSENT_LEAD,
  CONSENT_VERIFIED,
  CONSENT_THIS_COMPUTER,
  CONSENT_UNVERIFIED,
  CONSENT_RETURNS_TO,
  CONSENT_IT_CAN,
  CONSENT_SIGNED_IN_AS,
  CONSENT_ALLOW,
  CONSENT_DENY,
  CONSENT_FOOTER,
  CONSENT_MONEY_LINE,
  CONSENT_RETURNING,
  CONSENT_CONTINUE,
  ...Object.values(SCOPE_WORDS),
  ...Object.values(CONSENT_ERRORS),
  CONNECTED_APPS_TITLE,
  CONNECTED_APPS_DESC,
  CONNECTED_APPS_EMPTY,
  CONNECTED_APPS_CONNECTED,
  CONNECTED_APPS_LAST_USED,
  CONNECTED_APPS_NEVER_USED,
  CONNECTED_APPS_THIS_COMPUTER,
  CONNECTED_APPS_REVOKE,
  CONNECTED_APPS_REVOKING,
  CONNECTED_APPS_REVOKED,
  CONNECTED_APPS_NOT_FOUND,
  CONNECTED_APPS_FAILED,
  CONNECTED_APPS_SESSION,
] as const;

/** Fills {name} slots. */
export function fill(template: string, values: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (whole, key: string) => (key in values ? values[key] : whole));
}
