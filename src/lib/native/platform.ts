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

// A CAPABILITY token, not a version. Only a shell binary that carries the
// auth-callback intent filter appends it (capacitor.config.ts, android only).
//
// It exists because the website reaches every installed app the moment Vercel
// deploys, while a new APK reaches people over days. Gating OAuth on "is this
// the app?" would switch the buttons on for binaries that have no way to catch
// the redirect coming back — which is precisely the 2026-08-20 bug this whole
// change is fixing. Gating on "can this app catch the return?" cannot.
//
// Named for what it does rather than the versionCode, so it needs no
// coordination with release numbering and cannot drift from build.gradle.
export const NATIVE_AUTH_UA_MARKER = "PicachoAuth/1";

export function userAgentIsNativeApp(userAgent: string | null | undefined): boolean {
  return Boolean(userAgent && userAgent.includes(NATIVE_UA_MARKER));
}

// Deliberately a SEPARATE substring test rather than an extension of the one
// above: appending a second space-separated token cannot change what the
// existing includes("PicachoApp") matches, so reader-mode gating — the
// App Review-critical part — is untouched in both directions.
export function userAgentSupportsAuthReturn(userAgent: string | null | undefined): boolean {
  return Boolean(userAgent && userAgent.includes(NATIVE_AUTH_UA_MARKER));
}

// Where the provider sends the browser back to. A custom scheme, NOT an
// https App Link: an App Link needs the Play signing fingerprint (which is not
// in this repo), its verification is asynchronous and cacheable, and when it
// fails on Android 12+ the link opens silently in Chrome — the exact failure
// being fixed, with the one-time code already spent. PKCE makes scheme
// interception useless: the code is worthless without the verifier, and the
// verifier is a host-only cookie inside our own WebView.
export const NATIVE_AUTH_REDIRECT = "ai.picacho.app://auth-callback";

// Client-side check. Capacitor injects a global on native platforms; the user
// agent is the fallback for the brief window before that global exists, and
// for anything rendered before hydration finishes.
export function isNativeAppClient(): boolean {
  if (typeof window === "undefined") return false;
  const cap = (window as unknown as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor;
  if (cap?.isNativePlatform?.()) return true;
  return userAgentIsNativeApp(window.navigator.userAgent);
}
