import { afterEach, describe, expect, it } from "vitest";
import { MIC_MIN_APP_BUILD, appCannotRecord, nativeAppBuild } from "./app-build";

// The microphone arrived in Android build 20; older builds must be told to
// update, not to "allow" a permission they don't have (2026-09-25).

type G = { window?: unknown };

function inApp(build: string | number | undefined) {
  (globalThis as G).window = {
    Capacitor: {
      isNativePlatform: () => true,
      Plugins: { App: { getInfo: async () => ({ build, version: `1.${build}.0` }) } },
    },
  };
}

afterEach(() => {
  delete (globalThis as G).window;
});

describe("which app build the page is in", () => {
  it("is null on the website", async () => {
    expect(await nativeAppBuild()).toBeNull();
    (globalThis as G).window = {};
    expect(await nativeAppBuild()).toBeNull();
    expect(await appCannotRecord()).toBe(false);
  });

  it("reads the build the app reports", async () => {
    inApp("19");
    expect(await nativeAppBuild()).toBe(19);
  });

  it("says an app from before the microphone cannot record", async () => {
    inApp(String(MIC_MIN_APP_BUILD - 1));
    expect(await appCannotRecord()).toBe(true);
    inApp(String(MIC_MIN_APP_BUILD));
    expect(await appCannotRecord()).toBe(false);
  });

  it("doesn't guess when the app won't say", async () => {
    inApp(undefined);
    expect(await nativeAppBuild()).toBeNull();
    expect(await appCannotRecord()).toBe(false);
  });
});
