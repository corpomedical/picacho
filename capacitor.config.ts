// Deliberately NOT importing CapacitorConfig from "@capacitor/cli".
//
// The Capacitor packages aren't installed yet — they get added at the point
// the native projects are created (see MOBILE_APP.md), because installing
// them now would put them in Vercel's build for no reason. A type-only import
// of a package that isn't there fails the type check for everyone, so this
// file describes its own shape instead. The Capacitor CLI reads it as plain
// JS and doesn't care either way.

// Picacho ships as a native shell around the live site, not a static export.
//
// The obvious alternative — `next build && next export` bundled into the app —
// isn't available: this app is built on Server Actions and Server Components
// end to end (generation, auth, billing, brand rules), none of which survive a
// static export. Pointing the shell at the deployed site keeps one codebase
// and one deploy, and means a fix ships to phones the moment Vercel finishes
// rather than waiting on App Review.
//
// The cost of that choice is real and worth naming: the app needs a network
// connection to do anything, and Apple rejects apps that are "just a website"
// under guideline 4.2. That's why the plugin list below isn't decoration —
// camera, push, share and haptics are what make this a native app rather than
// a bookmark, and at least camera and push should be genuinely wired up before
// submitting. See MOBILE_APP.md.
const config = {
  appId: "ai.picacho.app",
  appName: "Picacho",
  // Required by the CLI even when a remote server URL is set. It only holds
  // the offline fallback page — see MOBILE_APP.md.
  webDir: "public/native",

  server: {
    url: "https://picacho.ai",
    // The offline fallback, actually wired up. When a main-frame load of the
    // remote site fails (no network, DNS, or an HTTP error page), the shell
    // loads this file from webDir via its internal local server
    // (https://localhost/index.html) instead of showing the WebView's raw
    // net::ERR_… screen. Both platforms honor it: BridgeWebViewClient
    // (onReceivedError/onReceivedHttpError) on Android,
    // WebViewDelegationHandler on iOS. Without this line the page in
    // public/native/ is dead weight — nothing ever navigates to it.
    errorPath: "index.html",
    // No cleartext anywhere: the session cookie rides on these requests.
    cleartext: false,
    // Everything else opens in the system browser rather than inside the
    // shell. This is a review requirement as much as a UX one — a webview
    // that can wander onto arbitrary pages is how a "reader" app
    // accidentally becomes one that links to a purchase page.
    allowNavigation: ["picacho.ai", "*.picacho.ai", "*.supabase.co"],
  },

  ios: {
    contentInset: "always",
    // Marker the middleware reads to switch the site into reader mode: no
    // pricing, no upgrade buttons, no billing portal. See lib/native/platform.ts.
    appendUserAgent: "PicachoApp",
    // Keeps the webview background matching the app's own, so there's no
    // white flash behind the page during navigation on a dark theme.
    backgroundColor: "#ffffff",
  },

  android: {
    appendUserAgent: "PicachoApp",
    backgroundColor: "#ffffff",
    // Play requires HTTPS for anything handling credentials.
    allowMixedContent: false,

    // Which plugins are compiled into the Android binary (2026-09-03).
    //
    // Capacitor's default is "every Capacitor package in package.json", and
    // that swept in @revenuecat/purchases-capacitor, whose transitive graph —
    // purchases-android, the Play Billing client, the Amazon Appstore IAP
    // SDK — measured 3,237 of 9,009 classes in the release DEX. A third of
    // the app, for a store that cannot transact: it self-gates on
    // isPluginAvailable("Purchases") AND NEXT_PUBLIC_REVENUECAT_GOOGLE_KEY,
    // and that key has never been set. It also merged
    // com.android.vending.BILLING into the manifest of a reader-mode app.
    //
    // THIS LIST, NOT AN UNINSTALL. The npm package must stay in
    // package.json: src/lib/native/purchases.ts imports it with a static
    // specifier, which Turbopack resolves at BUILD time, so removing the
    // dependency fails `next build` and takes down the site every installed
    // binary loads. Excluding it here removes it from the APK while leaving
    // the web half — the store UI, the gate, the four locales' strings —
    // intact and inert, which is what makes this a pause rather than a
    // deletion.
    //
    // TO RESTORE PLAY BILLING: delete this array, run `npx cap sync android`,
    // cut the next versionCode. Nothing else was removed — the RevenueCat
    // webhook, lib/play/products.ts and PLAY_BILLING_SETUP.md are all still
    // here.
    //
    // @capacitor/camera LEFT WITH versionCode 12 (2026-09-03). Nothing in
    // src/ calls it — no import, no Plugins.Camera, no string lookup — and
    // both photo paths are plain <input type="file"> served by Capacitor
    // CORE's file chooser (BridgeWebChromeClient), not the plugin. It was the
    // only dependency pulling Material Components and its resource tables:
    // measured, the AAB went 4,535,254 -> 2,766,078 bytes (-39%), the DEX
    // 4,787 -> 3,735 classes, and three never-reachable activities left the
    // manifest. The npm package stays in package.json for the same
    // reversibility as above, and because removing it buys nothing the
    // exclusion does not.
    //
    // THE ONE THING IT WAS SILENTLY PROVIDING: the <queries> declarations for
    // IMAGE_CAPTURE / GET_CONTENT / PICK. Core's "Take photo" path resolves
    // the camera intent, and on Android 11+ that returns null without the
    // declaration — no crash, the button just opens the gallery. Those three
    // intents now live in android/app/src/main/AndroidManifest.xml. Restoring
    // the plugin does not require removing them.
    //
    // A NAME THAT IS NOT INSTALLED IS FATAL AT SYNC; a plugin merely LEFT OUT
    // is dropped silently. After changing this list, check the generated
    // android/app/src/main/assets/capacitor.plugins.json has exactly the
    // entries you meant — Capacitor resolves plugins from it by string at
    // runtime, and one wrong classpath takes the whole bridge down.
    includePlugins: [
      "@capacitor-community/in-app-review",
      "@capacitor/app",
      "@capacitor/filesystem",
      "@capacitor/haptics",
      "@capacitor/push-notifications",
      "@capacitor/share",
      "@capacitor/splash-screen",
      "@capacitor/status-bar",
    ],
  },

  plugins: {
    SplashScreen: {
      // Dismissed manually at the FIRST PAINTED FRAME by SPLASH_HIDE_SCRIPT
      // (native-chrome.tsx), which the live site inlines into <head> for
      // native user agents — NOT by the app bundle, which arrives seconds
      // later on mobile networks. That was the launch-week bug: the hide
      // lived in a React effect, so the icon sat frozen through JS download
      // and hydration and read as a hang ("people think the app crashed").
      // The offline fallback (public/native/index.html) hides it too —
      // without that, a no-network cold start kept the splash up forever in
      // front of the very error page explaining the problem (reproduced
      // live on the emulator, 2026-08-29: any page that never calls hide()
      // wears the icon indefinitely and swallows every touch).
      //
      // autoHide true + 8s duration is the NATIVE backstop for the one
      // remaining hang case (site unreachable AND the error path failing):
      // the web hide always lands first in normal operation, and nothing
      // can hold the splash past 8s. As of versionCode 6 the splash
      // drawable is the wordmark-on-white brand field (night variant
      // included), the same frame the web intro opens with — the launch is
      // one continuous surface instead of an icon in a circle.
      launchAutoHide: true,
      launchShowDuration: 8000,
      backgroundColor: "#ffffff",
      showSpinner: false,
    },
    // Generation takes minutes; the whole point of the fire-and-poll rewrite
    // is that the job survives the app being backgrounded. Push is how the
    // person finds out it finished without sitting on the screen waiting.
    PushNotifications: {
      presentationOptions: ["badge", "sound", "alert"],
    },
  },
};

export default config;
