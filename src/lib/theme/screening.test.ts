import { describe, expect, it } from "vitest";
import { isScreeningPath, readThemeChoice, resolveDark, THEME_INIT_SCRIPT } from "./screening";

describe("isScreeningPath", () => {
  it("covers the app and everything under it", () => {
    expect(isScreeningPath("/app")).toBe(true);
    expect(isScreeningPath("/app/generate")).toBe(true);
    expect(isScreeningPath("/app/character/new")).toBe(true);
  });

  it("leaves the landing page and the rest of the site alone", () => {
    for (const path of ["/", "/pricing", "/gallery", "/login", "/signup", "/admin", "/apple", "/application", "/guides/getting-started"]) {
      expect(isScreeningPath(path)).toBe(false);
    }
    expect(isScreeningPath(null)).toBe(false);
    expect(isScreeningPath(undefined)).toBe(false);
    expect(isScreeningPath("")).toBe(false);
  });
});

describe("resolveDark", () => {
  it("makes the app dark by default, whatever the OS says", () => {
    expect(resolveDark("default", true, false)).toBe(true);
    expect(resolveDark("default", true, true)).toBe(true);
  });

  it("keeps Default following the OS outside the app", () => {
    expect(resolveDark("default", false, false)).toBe(false);
    expect(resolveDark("default", false, true)).toBe(true);
  });

  it("honours an explicit choice everywhere", () => {
    for (const screening of [true, false]) {
      for (const osDark of [true, false]) {
        expect(resolveDark("light", screening, osDark)).toBe(false);
        expect(resolveDark("dark", screening, osDark)).toBe(true);
      }
    }
  });
});

describe("readThemeChoice", () => {
  it("reads the three stored values and nothing else", () => {
    expect(readThemeChoice("light")).toBe("light");
    expect(readThemeChoice("dark")).toBe("dark");
    expect(readThemeChoice("default")).toBe("default");
    expect(readThemeChoice(null)).toBe("default");
    expect(readThemeChoice("sepia")).toBe("default");
  });
});

// The pre-hydration script is a string, so it cannot import the functions
// above. Run it against a fake document for every combination and hold it to
// the same answers — a drift here is a flash of the wrong theme on first
// paint, or the landing page turning dark.
describe("THEME_INIT_SCRIPT", () => {
  function run(pathname: string, stored: string | null, osDark: boolean) {
    const classes = new Set<string>();
    const fakeWindow = {
      location: { pathname },
      localStorage: { getItem: () => stored },
      matchMedia: () => ({ matches: osDark }),
      document: {
        documentElement: {
          classList: {
            add: (c: string) => classes.add(c),
            remove: (c: string) => classes.delete(c),
          },
        },
      },
    };
    new Function("window", "document", "localStorage", "location", THEME_INIT_SCRIPT)(
      fakeWindow,
      fakeWindow.document,
      fakeWindow.localStorage,
      fakeWindow.location,
    );
    return classes;
  }

  it("agrees with resolveDark and isScreeningPath on every combination", () => {
    for (const pathname of ["/", "/pricing", "/app", "/app/generate"]) {
      for (const stored of [null, "default", "light", "dark"]) {
        for (const osDark of [true, false]) {
          const classes = run(pathname, stored, osDark);
          const screening = isScreeningPath(pathname);
          expect(classes.has("screening")).toBe(screening);
          expect(classes.has("dark")).toBe(resolveDark(readThemeChoice(stored), screening, osDark));
        }
      }
    }
  });
});
