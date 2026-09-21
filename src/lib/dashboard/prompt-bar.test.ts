import { describe, expect, it } from "vitest";
import { promptBarCharacter, promptBarShown } from "./prompt-bar";

// Newest first, as the dashboard loads them.
const cast = [
  { id: "anubis", name: "Anubis" },
  { id: "eva", name: "Eva" },
  { id: "marco", name: "Marco" },
];

describe("who the dashboard's prompt bar is for", () => {
  it("is the reel's character, not the newest one (Anubis beside 'Put Eva somewhere…')", () => {
    expect(promptBarCharacter(cast, "eva")?.name).toBe("Eva");
  });

  it("is the newest character when there is no reel, as the composer defaults", () => {
    expect(promptBarCharacter(cast, null)?.name).toBe("Anubis");
    expect(promptBarCharacter(cast, undefined)?.name).toBe("Anubis");
  });

  it("is the newest character when the reel's character is not among those loaded", () => {
    expect(promptBarCharacter(cast, "someone-older")?.name).toBe("Anubis");
  });

  it("is no one on an account with no characters", () => {
    expect(promptBarCharacter([], "eva")).toBeNull();
  });
});

describe("when the dashboard's prompt bar shows", () => {
  // A page in the app's scroller, measured the way the bar measures it. The
  // content has 96 px of bottom padding (pb-24) under the page, whose foot is
  // where the bar rests; sticky holds the bar `dock` px above the scroller's
  // foot (16 on the web; 16 + the tab bar in the phone app).
  function page(o: {
    viewport: number;
    length: number;
    reelEnds: number;
    scrollTop: number;
    dock?: number;
    scrollerTop?: number;
  }) {
    const top = o.scrollerTop ?? 0;
    return {
      reelBottom: top + o.reelEnds - o.scrollTop,
      scrollerTop: top,
      scrollTop: o.scrollTop,
      clientHeight: o.viewport,
      scrollHeight: o.length,
      restBottom: top + o.length - 96 - o.scrollTop,
      dockLine: top + o.viewport - (o.dock ?? 16),
    };
  }
  // A phone: 812 px of screen over a 1,600 px page whose reel ends 330 px down.
  const phone = (scrollTop: number) => page({ viewport: 812, length: 1600, reelEnds: 330, scrollTop });

  it("stays hidden while any of the reel is on screen", () => {
    expect(promptBarShown(phone(0))).toBe(false);
    expect(promptBarShown(phone(329))).toBe(false);
  });

  it("shows once the reel has scrolled away", () => {
    expect(promptBarShown(phone(330))).toBe(true);
    expect(promptBarShown(phone(600))).toBe(true);
  });

  it("goes again when you scroll back up to the reel", () => {
    expect(promptBarShown(phone(600))).toBe(true);
    expect(promptBarShown(phone(100))).toBe(false);
  });

  it("shows on a page too short to scroll at all", () => {
    expect(promptBarShown(page({ viewport: 1400, length: 1400, reelEnds: 600, scrollTop: 0 }))).toBe(true);
  });

  it("shows wherever it is resting in its own place, even with the reel in view", () => {
    // A tall window over a page that scrolls 60 px: the bar's place is
    // already on screen at the top, so hiding it would leave an empty slot.
    expect(promptBarShown(page({ viewport: 1300, length: 1360, reelEnds: 600, scrollTop: 0 }))).toBe(true);
    // Its place starts 120 px below the fold: hidden at the top, shown from
    // the moment it is in place, before the last pixel of scroll.
    const tall = (scrollTop: number) => page({ viewport: 1300, length: 1500, reelEnds: 600, scrollTop });
    expect(promptBarShown(tall(0))).toBe(false);
    expect(promptBarShown(tall(110))).toBe(false);
    expect(promptBarShown(tall(120))).toBe(true);
  });

  it("shows at the very end in the phone app, where the tab bar keeps it from quite resting", () => {
    // 16 px + a 64 px bar + a 34 px home indicator + the lamp's 18 px rise:
    // higher than the page's 96 px of padding. The page scrolls only 88 px,
    // so the reel never leaves the screen either.
    const app = (scrollTop: number) =>
      page({ viewport: 812, length: 900, reelEnds: 330, scrollTop, dock: 16 + 64 + 34 + 18 });
    expect(promptBarShown(app(0))).toBe(false);
    expect(promptBarShown(app(87.5))).toBe(true);
  });

  it("measures the reel against the scroller's top, not the screen's", () => {
    // The phone app: the body is padded clear of the status bar, so the
    // scroller starts 32 px down.
    const app = (reelEnds: number) =>
      page({ viewport: 780, length: 1600, reelEnds, scrollTop: 300, scrollerTop: 32 });
    expect(promptBarShown(app(308))).toBe(false);
    expect(promptBarShown(app(300))).toBe(true);
  });
});
