// Typed-enough access to Capacitor's injected runtime global.
//
// The site deliberately does NOT bundle @capacitor/* JS (see NativeChrome):
// the shell injects `window.Capacitor` itself, with proxies for every plugin
// its native side registered. Everything here degrades to null on the web —
// callers branch and no-op, the same optional-chaining contract the splash
// hide has always used.
/* eslint-disable @typescript-eslint/no-explicit-any */

type CapacitorGlobal = {
  isNativePlatform?: () => boolean;
  Plugins?: Record<string, any>;
};

export function capPlugin(name: string): any | null {
  if (typeof window === "undefined") return null;
  const cap = (window as unknown as { Capacitor?: CapacitorGlobal }).Capacitor;
  return cap?.Plugins?.[name] ?? null;
}
