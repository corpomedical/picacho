# Picacho for iPhone and iPad

The iOS app was built on 2026-09-30. It is the same kind of app as the Android
one: a native shell around the live site (`capacitor.config.ts` explains why),
so every fix on picacho.ai reaches it the moment Vercel deploys. MOBILE_APP.md
has the background: why the app is a shell, and why it sells nothing (the
"reader" rules).

Nothing here needs a database change.

---

## What is in the repo

| Where | What it does |
|---|---|
| `ios/App/App.xcodeproj` | The Xcode project. Bundle ID `ai.picacho.app`, version 1.0.0 (build 1), iPhone and iPad, iOS 15 and newer. |
| `ios/App/CapApp-SPM/Package.swift` | The Capacitor plugins, through Swift Package Manager. No CocoaPods. Written by `npx cap sync ios`: never edit it by hand. |
| `ios/App/App/PicachoViewController.swift` | Picacho's screen: registers the app's own plugins, stays upright on iPhone, follows light and dark mode, and a swipe from the left edge goes back a page. |
| `ios/App/App/MediaPlugin.swift` | **PicachoMedia.** Download saves pictures and videos to Photos. Anything else (a WebM, PDF or 3D model) opens the share sheet, where "Save to Files" is. |
| `ios/App/App/OrientationPlugin.swift` | **PicachoOrientation.** A picture or video open full screen may turn sideways, as on Android. |
| `ios/App/App/AppDelegate.swift`, `SceneDelegate.swift` | App start, the one window, push registration. |
| `ios/App/App/Info.plist` + `*.lproj/InfoPlist.strings` | The permission prompts (camera, microphone, adding to Photos, choosing photos) in English, Spanish, Portuguese and Italian. Also the `ai.picacho.app://` link scheme, and "no special encryption", which answers App Store Connect's export question for every upload. |
| `ios/App/App/App.entitlements` | Push notifications. |
| `ios/App/App/PrivacyInfo.xcprivacy` | Apple's privacy manifest: no tracking, and the two "required reason" APIs the code uses. |
| `ios/App/App/Assets.xcassets` | The icon (the Play Store's white P and orange bar, at 1024 px), and the launch screen's wordmark and background in light and dark. |
| `ios/App/App/Base.lproj/LaunchScreen.storyboard` | The launch screen, laid out to match the site's opening animation exactly. |
| `src/lib/push/apns.ts` | The server sends iPhone notifications straight to Apple (Android's still go through Firebase). |

### What the website does differently in the iPhone app

- **Nothing is for sale**, the same as on Android. The app adds `PicachoApp` to
  its user agent, and the site hides pricing, upgrade and billing buttons.
- **No Google or Facebook sign-in buttons on iPhone.** Apple requires Sign in
  with Apple next to them (guideline 4.8). Email and password work. This can
  be added later.
- **Download** puts pictures and videos in Photos, and the note says "Saved to
  Photos". If someone refused Photos access, the note says where to allow it.
- **Microphone** (Aly, voice notes): works from build 1. The "update the app"
  check is for Android builds before 20 only. If the microphone is blocked,
  the message names the iPhone's own Settings path.
- **Push notifications** come from Apple's push service once the three Apple
  keys below are in Vercel.

---

## Step 1: make room for Xcode (this Mac)

On 2026-09-30 this Mac had **4.7 GB free**. Xcode and one iPhone simulator
need about **35 GB** free to install. What was using the most space that day:

| Folder | Size | Notes |
|---|---|---|
| `~/Downloads` | 14 GB | Yours to look through |
| `~/aly-voice-lab` | 11 GB | Aly's own voice work; keep it unless you're done with it |
| `~/Library/Android` + `~/.android` | 20 GB | The Android emulator; needed for Android testing |
| `~/Library/Caches` | 4.3 GB | Safe to empty; apps rebuild what they need |
| `~/.npm` | 4.2 GB | npm's download cache; the command below empties it safely |

```bash
npm cache clean --force
```

## Step 2: install Xcode

1. Open the **App Store** on the Mac, search **Xcode**, press **Get**. The
   download is long.
2. Open Xcode once. Accept the licence. When it asks which platforms to add,
   tick **iOS**.
3. Point the Mac's command-line tools at it (it asks for your Mac password):

```bash
sudo xcode-select -s /Applications/Xcode.app/Contents/Developer
```

## Step 3: run it on the iPhone simulator

From the Picacho folder:

```bash
cd ~/Picacho && npx cap sync ios && npx cap open ios
```

Xcode opens the project. At the top, pick an iPhone simulator (for example
"iPhone 17") and press ▶. The first build fetches Capacitor and takes a few
minutes.

Then check, in this order:

1. The launch screen shows the wordmark, and the site opens with no jump.
2. **Settings → Plan** shows your plan and **no** upgrade or billing buttons.
   **Settings → Usage** has no "buy credits". If you see any of them, stop:
   the reader marker isn't arriving.
3. **Download** on a finished picture: iPhone asks to add to Photos. Say yes.
   The note says "Saved to Photos", and the picture is in the Photos app.
4. The mic on Aly: iPhone asks for the microphone, then it listens.
5. Open a picture full screen and turn the simulator sideways (⌘→). The
   picture turns. Close it: the app stands upright again.
6. Swipe in from the left edge: the app goes back a page.

## Step 4: an Apple Developer account

To put the app on a real iPhone, send notifications, or submit it, you need
the **Apple Developer Program** (99 USD a year), at developer.apple.com →
Account. Then in Xcode: click **App** in the left list → **Signing &
Capabilities** → **Team** → pick your team. Xcode registers `ai.picacho.app`
and push notifications for it by itself.

## Step 5: notifications (Apple key → Vercel)

1. developer.apple.com → **Certificates, IDs & Profiles** → **Keys** → **+**.
2. Name it "Picacho push", tick **Apple Push Notifications service (APNs)**,
   press **Continue**, then **Register**.
3. **Download** the `.p8` file (Apple lets you download it only once) and
   note the **Key ID** shown on that page.
4. Your **Team ID** is at developer.apple.com → Account → **Membership
   details**.
5. In Vercel → project → Settings → Environment Variables, add three
   (Production):
   - `APNS_KEY_ID`: the Key ID
   - `APNS_TEAM_ID`: the Team ID
   - `APNS_PRIVATE_KEY`: open the `.p8` in TextEdit and paste the **whole**
     file, the BEGIN and END lines included.
6. They take effect with the next deploy, so don't press Vercel's Redeploy
   button; your next push carries them.

A build run from Xcode gets "sandbox" tokens; TestFlight and the App Store get
"production" ones. The server tries production first, then sandbox, so both
work with the same key. Dead tokens are removed on their own.

## Step 6: App Store Connect and TestFlight

1. appstoreconnect.apple.com → **Apps** → **+** → **New App**. Platform iOS,
   name **Picacho**, language English, bundle ID `ai.picacho.app`, SKU
   `picacho-ios`.
2. In Xcode: top menu **Product → Archive**. When it's done, press
   **Distribute App** → **App Store Connect** → **Upload**.
3. In App Store Connect → **TestFlight**, the build shows after Apple
   processes it (10–30 min). Add yourself as a tester and install it on your
   iPhone with the TestFlight app.

### What the App Store listing needs

- **Screenshots:** iPhone 6.9" (1320 × 2868) and iPad 13" (2064 × 2752). The
  simulators take them: ⌘S in the Simulator.
- **Privacy policy URL:** https://picacho.ai/privacy
- **App Privacy** (the data questions): start from the Play Data safety
  answers. Name and email, user ID, photos and videos, audio (voice notes and
  Aly), other user content, purchase history, product interaction, in-app
  search history, crash data, approximate location. All are linked to the
  account, none are used for tracking.
- **Sign-in for the reviewer:** a demo account with an active plan and some
  finished pictures and videos. Reviewers reject an empty app.
- **Review notes** (a draft to paste):

  > Picacho is a free companion app for an existing picacho.ai subscription
  > (guideline 3.1.3(f)). Nothing is sold in the app and it links to no
  > purchase page. Plans are bought on the website. The app adds native
  > features: taking a photo for a character, saving results to Photos,
  > push notifications when a video finishes, and the share sheet.

## Known risks

1. **Guideline 4.2 (just a website).** The answer is the native features:
   camera capture, Save to Photos, push notifications, share sheet, haptics,
   and the in-app review prompt. Say so in the review notes.
2. **Guideline 3.1.1 (paying outside Apple).** The app must never show
   pricing or link to it. Walk every screen in the simulator before
   submitting. Any purchase button inside the app gets it rejected.
3. **iPad.** The app runs on iPad in every orientation, so it needs iPad
   screenshots, and a reviewer may test it there. To ship iPhone-only, set
   Xcode → App → General → Supported Destinations to iPhone only.

## After a change to `capacitor.config.ts` or the plugins

```bash
cd ~/Picacho && npx cap sync ios
```

Run it from the Picacho folder, never from inside `ios/`. Then rebuild in
Xcode. `ios/App/App/public`, `capacitor.config.json` and `config.xml` are
generated and git-ignored.

## Not built yet

- Google and Facebook sign-in, with Sign in with Apple.
- Links that open the app (universal links for picacho.ai).
- The "Get the app" badge on the website still shows the Add to Home Screen
  instructions on iPhone. Change it to an App Store badge once the app is
  live.
