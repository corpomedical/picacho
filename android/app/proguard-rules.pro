# R8 rules for the release build (minifyEnabled true since 2026-09-03).
#
# Most of what this app needs is already declared by the libraries: the
# Capacitor AAR ships consumer rules that keep every class extending
# com.getcapacitor.Plugin and the @CapacitorPlugin/@PluginMethod members it
# reaches by reflection, AGP's proguard-android.txt keeps @JavascriptInterface
# members, and Firebase ships its own. What is left is what a
# consumer rule cannot know about us.

# Readable crash reports. R8 rewrites stack traces to obfuscated names; Play
# de-obfuscates them from the mapping file the bundle carries, but only if the
# line numbers survive. Without this a native crash in production arrives as
# a.b.c(Unknown Source) and cannot be read by anyone, including Play.
-keepattributes SourceFile,LineNumberTable
-renamesourcefileattribute SourceFile

# The bridge's entry point is named in AndroidManifest.xml, so AGP keeps it
# already — pinned explicitly because renaming it would break the launcher
# intent in a way no test here would catch.
-keep public class ai.picacho.app.MainActivity { *; }

# Capacitor loads plugin classes BY STRING from assets/capacitor.plugins.json
# (PluginManager: Class.forName(classpath)). The AAR's own rule keeps
# subclasses of com.getcapacitor.Plugin, which covers all eight of ours; this
# names the packages as well so a future plugin that registers differently —
# or a library rule that regresses — still cannot be renamed out from under
# the JSON.
-keep class com.capacitorjs.plugins.** { *; }
-keep class com.getcapacitor.community.** { *; }
# The RevenueCat rule that sat here left with the plugin at versionCode 11
# (capacitor.config.ts android.includePlugins). It returns with it.

# Capacitor passes plugin results as org.json objects across the bridge and
# reads annotation metadata at runtime.
-keepattributes *Annotation*, Signature, InnerClasses, EnclosingMethod

# Full screen in the WebView (2026-09-30, operator: "Android app can't full
# screen images"). Android's WebView decides whether the page may go full
# screen BY REFLECTION: WebViewChromium.doesSupportFullscreen walks the
# chrome client's class chain with getDeclaredMethod and wants BOTH
# onShowCustomView(View, CustomViewCallback) and onHideCustomView(). Capacitor's
# BridgeWebChromeClient declares both, but its onHideCustomView() only calls
# super, so R8 removed it as a redundant override — dexdump of the release
# versionCode 19 on the emulator shows the class (obfuscated to Lba;) with
# onShowCustomView and no onHideCustomView. With one half gone the WebView
# reports full screen unsupported: videos lose their full-screen button,
# document.fullscreenEnabled is false, and requestFullscreen() rejects with
# "Fullscreen is not supported" (auto-filed from a Galaxy A23, 2026-09-18).
# A debug build (no R8) has always had it, which is why it never showed up
# on the emulator.
#
# The website no longer depends on this — pictures and videos open in its own
# viewer (src/components/media-viewer.tsx) on every shell — but a video's own
# full-screen button is back from the build that carries this rule.
-keepclassmembers class * extends android.webkit.WebChromeClient {
    public void onShowCustomView(android.view.View, android.webkit.WebChromeClient$CustomViewCallback);
    public void onHideCustomView();
}
