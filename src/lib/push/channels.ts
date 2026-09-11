// Which channels a push goes out on — pure and alias-free so the routing is
// unit-testable (the vitest "@/" gotcha), like prefs.ts.
//
// Browser devices (web push) always; the phone app (FCM) unless the caller
// says the message is web-only. Sets are the one web-only message today
// (2026-09-11): they stay on the web while the Play appeal is pending
// (docs/ASTRA_SETS.md section 5), and the Android shell shows only a
// "Sets are on the web" line — a set notification on the phone would open
// a page that cannot show the set.

export type NotifyOptions = {
  /** Browsers only: never the phone app. */
  webOnly?: boolean;
};

export function pushChannels(options: NotifyOptions = {}): { web: boolean; fcm: boolean } {
  return { web: true, fcm: options.webOnly !== true };
}
