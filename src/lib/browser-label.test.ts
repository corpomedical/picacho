import { describe, expect, it } from "vitest";
import { describeBrowser } from "./browser-label";

const IPHONE = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko)";
const ANDROID_WV =
  "Mozilla/5.0 (Linux; Android 14; Pixel 7 Build/UQ1A.240205.004; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/139.0.7258.94 Mobile Safari/537.36";
const MAC = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Safari/605.1.15";

describe("describeBrowser", () => {
  it("names in-app browsers, the usual source of scripts that are not ours", () => {
    expect(
      describeBrowser(
        `${IPHONE} Mobile/22F76 Instagram 390.0.0.28.85 (iPhone16,2; iOS 18_5; en_US; en; scale=3.00; 1290x2796; 761434542; IABMV/1)`,
      ),
    ).toBe("Instagram in-app browser · iPhone");
    expect(
      describeBrowser(
        `${IPHONE} Mobile/22F76 [FBAN/FBIOS;FBAV/520.0.0.38.101;FBBV/745216093;FBDV/iPhone16,2;FBMD/iPhone;FBSN/iOS;FBSV/18.5;FBSS/3;FBID/phone;FBLC/en_US;FBOP/5;IABMV/1]`,
      ),
    ).toBe("Facebook in-app browser · iPhone");
    expect(describeBrowser(`${IPHONE} Mobile/22F76 [FBAN/MessengerForiOS;FBAV/500.0.0.37.110;FBDV/iPhone16,2]`)).toBe(
      "Messenger in-app browser · iPhone",
    );
    expect(
      describeBrowser(
        `${IPHONE} Mobile/15E148 musical_ly_40.2.0 JsSdk/2.0 NetType/WIFI Channel/App Store ByteLocale/en Region/US WKWebView/1 BytedanceWebview/d8a21c6`,
      ),
    ).toBe("TikTok in-app browser · iPhone");
    expect(describeBrowser(`${IPHONE} GSA/381.0.781334297 Mobile/15E148 Safari/604.1`)).toBe(
      "Google app in-app browser · iPhone",
    );
    expect(
      describeBrowser(
        `${ANDROID_WV} Instagram 390.0.0.43.81 Android (34/14; 420dpi; 1080x2400; Google/google; Pixel 7; panther; panther; en_US; 761434542)`,
      ),
    ).toBe("Instagram in-app browser · Android");
  });

  it("never calls an app's browser we can't name Safari or Chrome", () => {
    // Apple's embedded browser lacks the Safari/ token; Android's says "; wv)".
    expect(describeBrowser(`${IPHONE} Mobile/15E148`)).toBe("unrecognised app's in-app browser · iPhone");
    expect(describeBrowser(ANDROID_WV)).toBe("unrecognised app's in-app browser · Android");
  });

  it("recognises our own app before anything else", () => {
    expect(describeBrowser(`${ANDROID_WV} PicachoApp PicachoAuth/3`)).toBe("Picacho app · Android");
  });

  it("names every browser on an iPhone, which all run Safari's engine", () => {
    expect(describeBrowser(`${IPHONE} Version/18.5 Mobile/15E148 Safari/604.1`)).toBe("Safari 18 · iPhone");
    // Safari 26 freezes the OS version at 18_6; its own version is still true.
    expect(
      describeBrowser(
        "Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Mobile/15E148 Safari/604.1",
      ),
    ).toBe("Safari 26 · iPhone");
    expect(describeBrowser(`${IPHONE} CriOS/138.0.7204.156 Mobile/15E148 Safari/604.1`)).toBe("Chrome 138 · iPhone");
    expect(describeBrowser(`${IPHONE} FxiOS/141.0 Mobile/15E148 Safari/605.1.15`)).toBe("Firefox 141 · iPhone");
    expect(describeBrowser(`${IPHONE} Version/18.0 EdgiOS/138.0.3351.83 Mobile/15E148 Safari/605.1.15`)).toBe(
      "Edge 138 · iPhone",
    );
  });

  it("tells an iPad in desktop mode from a Mac by its touchscreen", () => {
    expect(describeBrowser(MAC, 0)).toBe("Safari 18 · Mac");
    expect(describeBrowser(MAC, 5)).toBe("Safari 18 · iPad");
  });

  it("names desktop and Android browsers, the Chromium family's lookalikes first", () => {
    const WIN = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.0.0 Safari/537.36";
    expect(describeBrowser(WIN)).toBe("Chrome 139 · Windows");
    expect(describeBrowser(`${WIN} Edg/139.0.0.0`)).toBe("Edge 139 · Windows");
    expect(describeBrowser(`${WIN} OPR/123.0.0.0`)).toBe("Opera 123 · Windows");
    expect(
      describeBrowser("Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:142.0) Gecko/20100101 Firefox/142.0"),
    ).toBe("Firefox 142 · Mac");
    expect(
      describeBrowser(
        "Mozilla/5.0 (X11; CrOS x86_64 14541.0.0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.0.0 Safari/537.36",
      ),
    ).toBe("Chrome 139 · Chromebook");
    expect(
      describeBrowser(
        "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.0.0 Mobile Safari/537.36",
      ),
    ).toBe("Chrome 139 · Android");
    expect(
      describeBrowser(
        "Mozilla/5.0 (Linux; Android 14; SAMSUNG SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/28.0 Chrome/130.0.0.0 Mobile Safari/537.36",
      ),
    ).toBe("Samsung Internet 28 · Android");
  });

  it("says so when there is nothing to go on", () => {
    expect(describeBrowser("")).toBe("not reported by the browser");
    expect(describeBrowser("curl/8.7.1")).toBe("unrecognised browser · unknown device");
  });
});
