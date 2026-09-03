# R8 rules for the release build (minifyEnabled true since 2026-09-03).
#
# Most of what this app needs is already declared by the libraries: the
# Capacitor AAR ships consumer rules that keep every class extending
# com.getcapacitor.Plugin and the @CapacitorPlugin/@PluginMethod members it
# reaches by reflection, AGP's proguard-android.txt keeps @JavascriptInterface
# members, and Firebase and RevenueCat ship their own. What is left is what a
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
# subclasses of com.getcapacitor.Plugin, which covers all ten of ours; this
# names the packages as well so a future plugin that registers differently —
# or a library rule that regresses — still cannot be renamed out from under
# the JSON.
-keep class com.capacitorjs.plugins.** { *; }
-keep class com.getcapacitor.community.** { *; }
-keep class com.revenuecat.purchases.capacitor.** { *; }

# Capacitor passes plugin results as org.json objects across the bridge and
# reads annotation metadata at runtime.
-keepattributes *Annotation*, Signature, InnerClasses, EnclosingMethod
