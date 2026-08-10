// Is this request coming from the iOS/Android app rather than a browser?
//
// Picacho ships as a Capacitor shell around the live site (see
// capacitor.config.ts). The shell appends a marker to its user agent, and the
// middleware turns that into a cookie so Server Components can read it too —
// a Server Component can't sniff `window`, and gating purchase UI purely on
// the client would mean it renders and then disappears, which is exactly the
// kind of flash App Review notices.
//
// Why any of this matters: Apple and Google require their own billing for
// digital goods sold inside an app, taking 15-30%. The exception is the
// "reader" model — the app may let existing subscribers sign in and use what
// they've paid for, provided it sells nothing and does not point at anywhere
// that does. Netflix and Spotify work this way. Picacho takes the same route
// so subscriptions keep running through Stripe at 100% of revenue.
//
// The rule is stricter than it first sounds: no purchase screens, no upgrade
// buttons, no "manage your plan on our website", no pricing page, not even a
// link to the marketing site's footer if that footer links to pricing. An app
// has been rejected for less. Everything gated by isNativeApp() below is
// there for that reason, not for layout.

export const NATIVE_UA_MARKER = "PicachoApp";
export const NATIVE_COOKIE = "picacho_native";

export function userAgentIsNativeApp(userAgent: string | null | undefined): boolean {
  return Boolean(userAgent && userAgent.includes(NATIVE_UA_MARKER));
}

// Client-side check. Capacitor injects a global on native platforms; the user
// agent is the fallback for the brief window before that global exists, and
// for anything rendered before hydration finishes.
export function isNativeAppClient(): boolean {
  if (typeof window === "undefined") return false;
  const cap = (window as unknown as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor;
  if (cap?.isNativePlatform?.()) return true;
  return userAgentIsNativeApp(window.navigator.userAgent);
}
