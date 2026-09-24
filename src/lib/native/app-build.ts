import { capPlugin } from "./bridge";

// Which Android build the website is running inside (2026-09-25, operator:
// "on the app its asking for permission and the app doesnt have an option to
// allow for permission").
//
// The microphone was declared in versionCode 20. An older build CANNOT record:
// Android refuses the WebView's request on the spot, shows no dialog, and the
// app's permission settings have no microphone to switch on — so asking the
// person to "allow it" sends them looking for a switch that doesn't exist.
// Knowing the build lets the page say what's actually true: update the app.
//
// Read through Capacitor's App plugin (in every build since the first Play
// upload). null on the website, or if the plugin can't answer.

export const MIC_MIN_APP_BUILD = 20;

type AppInfo = { build?: string | number; version?: string };

export async function nativeAppBuild(): Promise<number | null> {
  if (typeof window === "undefined") return null;
  const cap = (window as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor;
  if (!cap?.isNativePlatform?.()) return null;
  const app = capPlugin("App");
  if (!app?.getInfo) return null;
  try {
    const info = (await app.getInfo()) as AppInfo;
    const build = Number(info?.build);
    return Number.isFinite(build) ? build : null;
  } catch {
    return null;
  }
}

/** In the app, but a build from before the microphone was declared. */
export async function appCannotRecord(): Promise<boolean> {
  const build = await nativeAppBuild();
  return build !== null && build < MIC_MIN_APP_BUILD;
}
