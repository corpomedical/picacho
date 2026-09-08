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
//
// /3 as of versionCode 16. /1 was 14 (custom scheme handed to the system
// browser: the redirect jumped to Gmail) and /2 was 15 (verified App Link:
// the redirect stayed in the browser). Neither could finish a sign-in, so the
// site must never offer those buttons again — bumping the token retires each
// binary permanently, without a store rollback and without any way for a later
// deploy to hand the button back to it. The cost is deliberate and worth
// naming: between this deploy and the day someone installs 16, the app shows
// no Google button at all. Email and password still work, which is better than
// a button that strands you half signed in.
export const NATIVE_AUTH_UA_MARKER = "PicachoAuth/3";

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

// Where the provider sends the user back to: our own private-use scheme,
// opened inside a Chrome Custom Tab, as of versionCode 16.
//
// 15 asked for a verified App Link instead and it did not come back on a real
// phone. The file is not the problem — Google's Digital Asset Links verifier
// reads our assetlinks.json and all three certificates parse. The problem is
// that App Link verification is a PER-DEVICE step: Android has to run it,
// succeed, and cache it, and none of that is visible or forceable from here.
// When it has not happened the redirect just carries on in the browser, which
// is exactly what was reported.
//
// A private-use scheme needs no verification at all, and inside a Custom Tab
// it is deterministic: the tab belongs to this app's task, so firing the
// scheme closes it and returns here. RFC 8252 recommends this exact shape for
// native OAuth. The token bump to PicachoAuth/3 retires 15 the same way 15
// retired 14.
//
// Interception is not the risk it sounds like. PKCE means a stolen code is
// useless without the verifier, and the verifier is a host-only cookie inside
// this WebView's own jar.
//
// There is deliberately no constant for 15's App Link target
// (https://picacho.ai/auth/app-callback). Its intent filter, its route and
// public/.well-known/assetlinks.json all stay — they cost nothing, they still
// work on a device where verification did land, and a redirect already in
// flight when this deploys can still arrive there. But nothing REQUESTS that
// URL any more, so an exported constant for it would be a name with no caller,
// inviting someone to reintroduce the dependency that broke 15.
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
