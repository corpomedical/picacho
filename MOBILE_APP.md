# Picacho for iOS and Android

Everything in the web codebase is done. What's left needs Xcode and Android
Studio, which only run on your machine.

---

## What was built, and why it's shaped this way

The app is a **Capacitor shell around the live site**, not a separate mobile
codebase and not a static export.

A static export was never available: Picacho runs on Server Actions and Server
Components throughout — generation, auth, billing, brand rules — and none of
those survive `next export`. Pointing the shell at `picacho.ai` keeps one
codebase, and a fix reaches phones the moment Vercel finishes rather than
waiting days for App Review.

**Reader-app model.** Apple and Google require their own billing for digital
goods sold in-app, at 15–30%. The exception is a "reader" app: it may let
existing subscribers sign in and use what they've paid for, provided it sells
nothing and points nowhere that does. Netflix and Spotify work this way.
Picacho does too, so subscriptions keep running through Stripe at 100%.

That rule is stricter than it sounds. Inside the app there is no pricing page,
no upgrade button, no buy-credits panel, and no Stripe billing portal — the
portal counts, because it can change plans and take payment. There is also no
"manage your subscription on our website", which is itself a rejection reason.

This is enforced server-side, not with CSS. `capacitor.config.ts` appends
`PicachoApp` to the user agent; `middleware.ts` turns that into a cookie; and
`isNativeApp()` gates the purchase UI so it never reaches the app's DOM.

### Files added

| File | Purpose |
|---|---|
| `capacitor.config.ts` | Shell config: remote URL, UA marker, navigation allowlist |
| `src/lib/native/platform.ts` | UA marker, cookie name, client-side detection |
| `src/lib/native/server.ts` | `isNativeApp()` for Server Components |
| `src/components/native-chrome.tsx` | Safe-area class, splash dismissal on first paint |
| `public/native/index.html` | Offline fallback screen |
| `middleware.ts` | Sets the native cookie |
| `src/app/globals.css` | Safe-area insets, no overscroll bounce, no tap highlight |
| `src/app/layout.tsx` | `viewport-fit=cover` (required for safe areas) |
| `src/app/app/settings/page.tsx` | Purchase UI omitted in the app |

No `@capacitor/*` packages were added to `package.json` — deliberately, so
Vercel isn't installing native tooling to render HTML. Step 1 below adds them.

---

## Step 1 — Install Capacitor and create the native projects

```bash
cd ~/Picacho
npm install --save-dev @capacitor/cli
npm install @capacitor/core @capacitor/ios @capacitor/android \
  @capacitor/splash-screen @capacitor/status-bar @capacitor/camera \
  @capacitor/share @capacitor/haptics @capacitor/push-notifications
npx cap add ios
npx cap add android
npx cap sync
```

This creates `ios/` and `android/` directories. Commit them — Capacitor
projects are meant to be version-controlled.

## Step 2 — Verify the reader gating actually works

**Do not skip this.** The gating fails open: if the user-agent marker doesn't
arrive, the app shows pricing and upgrade buttons, and that is a guaranteed
rejection.

```bash
npx cap run ios
```

In the running app, go to Settings → Plan. You should see your plan name and
**nothing else** — no upgrade button, no manage-billing button. Check the
Usage tab too: no buy-credits panel.

If you see any of them, the UA marker isn't arriving. Confirm with Safari's
Web Inspector (Develop → Simulator → Picacho) that `navigator.userAgent`
contains `PicachoApp`.

## Step 3 — Make it more than a wrapper

Apple rejects webview wrappers under guideline 4.2 ("minimum functionality").
A shell around a website with no native capability will not pass. Two things
carry the most weight, and both are genuinely useful here rather than box-ticking:

- **Camera** — `@capacitor/camera` for capturing a character reference photo
  directly instead of picking a file. This is the strongest single argument
  that the app does something the website can't.
- **Push notifications** — generation takes minutes. Since the fire-and-poll
  rewrite the job survives backgrounding, so push is how someone learns it
  finished without watching the screen. Needs a Firebase project for Android
  and an APNs key for iOS.

Share sheet and haptics are cheap additions that also help.

## Step 4 — Assets and store listings

- Icon: 1024×1024, no transparency, no rounded corners (the OS rounds it).
- Splash: the existing wordmark on a flat background, generated with
  `@capacitor/assets`.
- Screenshots: 6.7" and 5.5" for iOS; phone and 7"/10" tablet for Android.
- Privacy policy URL — required by both stores. You have one at
  `/privacy`; confirm it's reachable and current.

## Step 5 — Answering the store questionnaires

**App Store — "Does your app contain in-app purchases?"** No.

**App Store — sign-in.** You'll be asked why an account is required. Answer
that Picacho is a subscription creative tool and the app provides access to an
existing subscription. Provide a working demo account with an active plan and
some generation history — reviewers reject accounts that show an empty app.

**Apple's Sign in with Apple rule.** If you ever add Google or Facebook login,
Apple requires Sign in with Apple alongside it. Email-and-password alone does
not trigger this.

**Data safety / privacy nutrition labels.** Picacho collects email, generated
content and usage data. Declare account creation, and that content is stored
on your servers. Be accurate — inconsistencies here get caught.

---

## The release build is minified — what to re-test when it changes

`minifyEnabled true` since 2026-09-03 (Play Console flagged the release DEX at
2% obfuscation, deadline Feb 2027). R8 renames classes, and Capacitor finds
every plugin by STRING — `assets/capacitor.plugins.json` holds a classpath per
plugin and `PluginManager` resolves it with `Class.forName`, then dispatches
each `@PluginMethod` reflectively. A missing keep rule therefore fails at
RUNTIME, not at build time: the app compiles, installs, launches, and the
bridge is simply dead. Nothing in the web test suite can see it.

So any change to `android/app/proguard-rules.pro`, to `minifyEnabled`, or to
the plugin list gets an actual signed release build on a device before it is
uploaded:

```bash
cd android && ANDROID_HOME=~/Library/Android/sdk ./gradlew assembleRelease
adb install -r app/build/outputs/apk/release/app-release.apk
adb logcat -c && adb shell am start -n ai.picacho.app/.MainActivity
```

Then confirm, in this order — the first two are the ones that prove reflection
survived, because both are JS calling a native plugin through the bridge:

1. The splash dismisses and the site renders. (SplashScreen plugin: the live
   site's inlined hide script calls it at first paint.)
2. The status-bar icons match the theme. (StatusBar `setStyle`.)
3. `adb logcat -d | grep -iE "ClassNotFoundException|NoSuchMethodException|FATAL"`
   is empty for `ai.picacho.app`.
4. Every plugin class still owns its name in the mapping:
   ```bash
   grep -E "Plugin ->" app/build/outputs/mapping/release/mapping.txt | grep -v " -> \(.*\)\1:"
   ```
   Each of the ten in `capacitor.plugins.json` must map to itself.

Verified this way on the Pixel_7 emulator (API 37) for versionCode 10.

## Known risks, honestly

1. **Guideline 4.2 rejection.** The single most likely outcome if Step 3 is
   skipped. A remote-URL shell with no native features reads exactly like the
   thing Apple wrote that rule for.
2. **Reader-model scrutiny.** Reviewers do look for purchase paths. If any
   route inside the app reaches pricing — a marketing footer link, an error
   message suggesting an upgrade — it gets rejected. Worth walking every screen
   in the simulator before submitting.
3. **Sign-up inside the app.** New users can register but cannot subscribe,
   which is a confusing first run. Consider making the app sign-in only and
   sending new users an email with a web link after they register on the site.
4. **No offline capability.** Everything needs the network. The fallback screen
   in `public/native/` softens it but doesn't solve it.
5. **Android is much easier.** Google's policy is looser and review is faster.
   Shipping Android first is a reasonable way to find problems cheaply.
