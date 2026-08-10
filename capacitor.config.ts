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
  },

  plugins: {
    SplashScreen: {
      // Short, and dismissed manually once the first paint lands — a fixed
      // multi-second splash is the most common reason a wrapper app feels
      // slower than the website it wraps.
      launchAutoHide: false,
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
