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

- **Camera** — capturing a character reference photo directly instead of
  picking a file. This is the strongest single argument that the app does
  something the website can't. **How it actually works, measured 2026-09-03:**
  the web app renders `<input type="file" capture="environment">` (the "Take
  photo" item in the composer's + menu), and Capacitor CORE's file chooser
  serves it by launching the system camera. `@capacitor/camera` was never
  called — no import, no `Plugins.Camera`, nothing — and on Android it was
  excluded at versionCode 12 (`android.includePlugins`), taking Material
  Components, three unreachable activities and 39% of the bundle with it.
  The one thing it had been providing silently was the `<queries>` entry for
  `IMAGE_CAPTURE` that core needs on Android 11+ to find the camera; that now
  lives in `android/app/src/main/AndroidManifest.xml`. The npm package stays
  installed, so the install line above is still right.
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
4. Every registered plugin class still owns its name in the mapping. Read the
   classpaths out of the APK — not the working tree, which can be ahead of the
   binary — and check each one maps to itself:
   ```bash
   unzip -p app/build/outputs/apk/release/app-release.apk \
     assets/capacitor.plugins.json > /tmp/pj.json
   python3 -c "
import json, re
plugins = json.load(open('/tmp/pj.json'))
renames = dict(re.findall(r'^(\S+) -> (\S+):\$',
                          open('app/build/outputs/mapping/release/mapping.txt').read(), re.M))
bad = [p['classpath'] for p in plugins if renames.get(p['classpath']) != p['classpath']]
print('BROKEN:', bad) if bad else print('ok:', len(plugins), 'plugins resolvable by string')
"
   ```
   Two earlier versions of this check were both worthless and worth recording,
   because each failed in the direction that reads as a pass. The first used a
   BRE backreference under `grep -E`, which errors out and prints nothing. The
   second matched any line containing `Plugin ->`, which flags Capacitor's own
   base classes — `com.getcapacitor.Plugin` is renamed on every build, legally,
   because nothing looks it up by string — so it printed four scary lines that
   mean nothing while saying nothing about the ones that matter. Only the
   classpaths named in `capacitor.plugins.json` are loaded by string, and only
   those may not be renamed.
5. Best of all, ask the running bridge what it actually registered. This needs
   the debug variant (the release APK is not debuggable) but it is the only
   check that tests the thing itself rather than a proxy for it — and it needs
   no login, so it costs nothing:
   ```bash
   adb forward tcp:9333 localabstract:webview_devtools_remote_$(adb shell pidof ai.picacho.app)
   # then over CDP: Runtime.evaluate
   #   Object.keys(window.Capacitor.Plugins)
   #   window.Capacitor.isPluginAvailable("Purchases")
   ```

Verified this way on the Pixel_7 emulator (API 37) for versionCode 11: splash
dismissed and the site rendered, status-bar icons followed the dark theme, the
app's own logcat carried no ClassNotFoundException / NoSuchMethodException /
FATAL, all nine classpaths mapped to themselves, and the live bridge reported
its nine plugins with `isPluginAvailable("Purchases") === false` — returned,
not thrown, which is what keeps `playBillingAvailable()` from ever reaching the
dynamic import.

Verified again for versionCode 12 (camera plugin excluded, `<queries>` moved
into our manifest), on the same emulator: release build boots and renders with
a clean logcat; all eight classpaths map to themselves; the live bridge
registers eight plugins with `isPluginAvailable("Camera") === false`; a real
`@PluginMethod` answered on App, Filesystem, Haptics, PushNotifications, Share,
SplashScreen and StatusBar; a hardware tap on `<input type="file"
accept="image/*">` opened the system Photopicker; and the same tap on
`<input capture="environment">` opened `com.android.camera2` with no
"Media capture intent could not be launched" fallback in the log — the line
that appeared before the `<queries>` move, and the regression this step
exists to catch.

Verified again on 2026-09-04 for the R8 OPTIMIZATION change (the release
build type moved from `proguard-android.txt` to `proguard-android-optimize.txt`,
Play Console release 12: "Optimization isn't enabled"). Static first, on the
emitted mapping: all 8 classpaths in `capacitor.plugins.json` map to
themselves, and all 43 distinct `@PluginMethod` names across the 8 included
plugins survive unrenamed — Java and Kotlin alike, which matters because the
Kotlin ones are the half a Java-only check misses. Then on the Pixel_7: the
signed release installs, boots, dismisses its splash and renders the site with
the status-bar icons following the dark theme — and both of those are
`@PluginMethod` calls dispatched by reflection, so the bridge is demonstrably
alive under optimization — with no ClassNotFoundException,
NoSuchMethodException or FATAL in the app's own logcat. Measured on the
artifact users download: APK 2,278,080 -> 2,015,935 bytes, -11.51%.

Note for the next person: CDP cannot be used to interrogate the bridge on a
RELEASE build — WebView debugging is off — so the recipe above needs a debug
APK, which has no R8 at all. For an R8 change the mapping check is the
evidence, and the emulator run is the corroboration.

## Google sign-in in the app — the invariants

Rewritten at versionCode 16 (2026-09-08). Read the history first, because two
releases were spent learning what does NOT hold this up:

- **14** sent the provider to the system browser with a bare `ACTION_VIEW` and
  asked for a custom scheme back. `auth.flow_state` showed four attempts with
  `auth_code_issued_at` null: the flow died before Supabase issued a code, and
  on the operator's phone the tap surfaced as a jump into Gmail.
- **15** replaced the return with a VERIFIED App Link on `/auth/app-callback`.
  Google's Digital Asset Links verifier reads our `assetlinks.json` and parses
  all three certificates — the file was never the problem. The return still
  depends on ANDROID having run and cached a successful check *on that device*,
  which is neither visible nor forceable from here, and on a real phone it had
  not happened. Operator, on 15: *"When clicking the account, it does not take
  you back to the app, it continues on the browser."*
- **16** stops depending on anything per-device. The provider URL opens in a
  CHROME CUSTOM TAB launched into this app's own task, and the return is a
  private-use scheme, which needs no verification of any kind. This is the
  shape RFC 8252 recommends for native OAuth.

Five things hold 16 up, and none of them fails loudly. Sign-in simply stops
coming back.

1. **`@capacitor/browser` must be in `android.includePlugins`**
   (`capacitor.config.ts`). That list is an allow-list: a plugin merely left
   out is dropped SILENTLY, so the shell would still build, `capPlugin`
   ("Browser") would return null, and `oauth-buttons.tsx` would fall back to
   the versionCode 15 handoff — the exact failure this release replaced. After
   any change to that list, check the generated
   `android/app/src/main/assets/capacitor.plugins.json` really lists it.

2. **`ai.picacho.app://auth-callback` must be in Supabase → Auth → URL
   Configuration → Redirect URLs.** Without it the provider never returns.
   Present since versionCode 14; `https://picacho.ai/auth/app-callback` is
   still listed too and does no harm.

3. **`Browser.close()` must NOT be called on the way back.** The tab is already
   gone: MainActivity is `singleTask`, so routing the scheme intent to it
   brings the task forward and clears everything above — the Custom Tab and the
   translucent `BrowserControllerActivity` that launched it. Calling `close()`
   anyway starts that activity again, and if the old instance is finishing but
   not yet destroyed Android skips the finishing record and creates a fresh
   one, whose `onCreate` fires the still-set controller listener and REOPENS
   the same authorize URL. The rationale is in `native-auth-return.tsx`; the
   mechanism is in `BrowserPlugin.java`.

4. **`*.supabase.co` must NOT be in `allowNavigation`.** Less load-bearing than
   it was at 15 — the URL now goes to the plugin rather than to
   `window.location` — but still true: if the WebView ever navigates there for
   real, `onPageStarted` calls `Bridge.reset()`, which calls
   `removeAllListeners()` on every plugin and destroys both the `appUrlOpen`
   listener that catches the way back and the hardware back button's.

5. **`npx cap sync android` from the repo ROOT before building.** The
   user-agent token, `allowNavigation` and the plugin list all live in
   generated files under `android/app/src/main/assets/`, which are gitignored
   and build-time only. Running sync from `android/` silently keeps the old
   ones.

### The App Link is kept, not depended on

`public/.well-known/assetlinks.json`, the `autoVerify` intent filter and the
`/auth/app-callback` route all stay. They cost nothing, they still work on a
device where verification did land, and a redirect already in flight when 16
ships can still arrive there. Nothing REQUESTS that URL any more. If you ever
reintroduce a dependency on it, first find a way to OBSERVE verification per
device — `adb shell pm get-app-links ai.picacho.app` reported
`picacho.ai: none` on the emulator throughout, and forcing re-verification did
not change it.

What the file still has to satisfy, should it ever matter again: apex only
(`www` 308s to the apex and a redirect fails Digital Asset Links), HTTP 200 as
`application/json` behind no redirect, and THREE fingerprints — Play's
quantum-ready hybrid signing means newer devices verify against the
post-quantum certificate, older ones against the classical, and the upload
certificate covers internal-test builds. All three come from Play Console →
Protected with Play → Play Store protection → Manage Play app signing.

```bash
curl -sI https://picacho.ai/.well-known/assetlinks.json | head -3
```

### Turning it off, and retiring a bad build

The website decides whether a binary may show these buttons, which is why both
14 and 15 could be switched off in minutes without a store rollback:

- `NATIVE_OAUTH_DISABLED=1` in Vercel kills it for every build on the next
  request — no deploy, no store round trip.
- The user-agent token (`PicachoAuth/<n>`, `capacitor.config.ts`) is the
  version gate. Bumping it in the shell AND in `NATIVE_AUTH_UA_MARKER` retires
  every older binary permanently, because the site then recognises only the new
  one. That is how 14 was excluded at 15, and 15 at 16. The cost is worth
  naming: between the deploy and the day someone installs the new build, the
  app shows no Google button at all.

### What to test on a device, without signing in to anything

The whole round trip is observable without a Google account. Run these against
a debug build (`assembleDebug`; CDP is off on release builds), with the app in
the foreground:

```bash
adb forward tcp:9333 localabstract:webview_devtools_remote_$(adb shell pidof ai.picacho.app)
```

1. Open a tab from the page's own bridge — over CDP, evaluate
   `Capacitor.Plugins.Browser.open({url:"https://picacho.ai/login"})`.
2. `adb shell dumpsys activity activities | grep "\* Hist"`. Chrome's
   activities must sit in the SAME task as `ai.picacho.app/.MainActivity`. If
   Chrome has a task of its own, the tab was not launched into ours and the
   return will not be reliable — that is versionCode 15's failure.
3. Fire the redirect as the provider would:

   ```bash
   adb shell am start -a android.intent.action.VIEW -c android.intent.category.BROWSABLE -d "ai.picacho.app://auth-callback?code=EMULATORTEST123"
   ```

4. `dumpsys` again: the task must be back to MainActivity ALONE — no Custom
   Tab, no controller activity, and nothing was closed by hand. The WebView
   must have navigated to `/login?error=oauth`, which is a fake code correctly
   refused. Both were verified on the Pixel_7 AVD on 2026-09-08.

Emulator gotcha found the same day: the Pixel_7 image ships with
`com.android.chrome` DISABLED, so there is no browser at all and no Custom
Tabs service. `adb shell pm enable com.android.chrome` first, or the tab falls
back to the no-browser path (which is handled — the buttons re-enable and show
an error — but proves nothing about the return).

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
