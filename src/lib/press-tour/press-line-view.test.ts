import { describe, expect, it } from "vitest";
import { NETWORKS, TIKTOK_CHOICES_DEFAULT, type ConnectionView, type TikTokSheetState } from "./publish-types";
import {
  NETWORK_MARKS,
  NETWORK_NAMES,
  TIKTOK_UI_DEFAULT,
  adFileName,
  canCompose,
  defaultScheduleInput,
  downloadUrl,
  localInputToIso,
  parseHashtags,
  postsNewestFirst,
  profileUrl,
  safePermalink,
  sheetColumns,
  tiktokBlocks,
  tiktokSent,
  toLocalInput,
  zoneCity,
} from "./press-line-view";

// The press line's own rules (press-line-view.ts): which networks get a
// column, what the person typed, the time they picked, TikTok's audit rules
// before the server is asked, and which file a save points at.

function conn(extra: Partial<ConnectionView> = {}): ConnectionView {
  return { network: "x", handle: "solstadcoffee", displayName: "Solstad", status: "connected", canConnect: true, webOnly: false, testMode: false, note: null, ...extra };
}

function sheet(extra: Partial<TikTokSheetState> = {}): TikTokSheetState {
  return {
    nickname: "Solstad Coffee",
    username: "solstad.coffee",
    avatarUrl: null,
    privacyOptions: ["SELF_ONLY"],
    commentDisabled: false,
    duetDisabled: false,
    stitchDisabled: false,
    maxDurationSeconds: 600,
    testMode: true,
    brandedContentAvailable: false,
    canPost: true,
    blocker: null,
    fetchedAt: "2026-09-26T10:00:00Z",
    ...extra,
  };
}

describe("the press line's columns", () => {
  it("names every network by its own name and mark", () => {
    for (const n of NETWORKS) {
      expect(NETWORK_NAMES[n].length, n).toBeGreaterThan(0);
      expect(NETWORK_MARKS[n].length, n).toBeGreaterThan(0);
    }
  });

  it("gives an open network its own pit and groups the ones not open yet", () => {
    const list = [
      conn({ network: "x" }),
      conn({ network: "tiktok", status: "test_mode", testMode: true }),
      conn({ network: "instagram", status: "coming_soon" }),
      conn({ network: "threads", status: "coming_soon" }),
    ];
    const { open, soon } = sheetColumns(list);
    expect(open.map((c) => c.network)).toEqual(["x", "tiktok"]);
    expect(soon.map((c) => c.network)).toEqual(["instagram", "threads"]);
    expect(canCompose(conn())).toBe(true);
    expect(canCompose(conn({ status: "test_mode" }))).toBe(true);
    for (const status of ["needs_reconnect", "not_connected", "coming_soon"] as const) expect(canCompose(conn({ status })), status).toBe(false);
  });
});

describe("what the person typed", () => {
  it("reads hashtags without the #, once each, in the order typed, and fixes nothing", () => {
    expect(parseHashtags("#coldbrew #oat_milk, morning #ColdBrew")).toEqual(["coldbrew", "oat_milk", "morning"]);
    expect(parseHashtags("  ")).toEqual([]);
    // Odd ones go to the server as typed, so its answer says what's wrong.
    expect(parseHashtags("#café-bar")).toEqual(["café-bar"]);
  });

  it("turns the picked time into an ISO time, and nothing else", () => {
    const iso = localInputToIso("2026-09-30T08:30");
    expect(iso).not.toBeNull();
    expect(new Date(iso!).getHours()).toBe(8);
    expect(localInputToIso("")).toBeNull();
    expect(localInputToIso("tomorrow")).toBeNull();
    expect(toLocalInput(new Date(2026, 8, 30, 8, 5))).toBe("2026-09-30T08:05");
  });

  it("offers the next half hour at least 15 minutes away", () => {
    expect(defaultScheduleInput(new Date(2026, 8, 30, 8, 5))).toBe("2026-09-30T08:30");
    expect(defaultScheduleInput(new Date(2026, 8, 30, 8, 20))).toBe("2026-09-30T09:00");
    expect(defaultScheduleInput(new Date(2026, 8, 30, 23, 50))).toBe("2026-10-01T00:30");
  });

  it("names the time zone by its city", () => {
    expect(zoneCity("Europe/Madrid")).toBe("Madrid");
    expect(zoneCity("America/New_York")).toBe("New York");
    expect(zoneCity("UTC")).toBeNull();
    expect(zoneCity(null)).toBeNull();
  });
});

describe("TikTok's sheet (the audit's rules)", () => {
  it("starts with nothing chosen: no privacy, every toggle off", () => {
    expect(TIKTOK_UI_DEFAULT).toEqual({ ...TIKTOK_CHOICES_DEFAULT, commercial: false });
    expect(TIKTOK_UI_DEFAULT.privacy).toBeNull();
  });

  it("waits for TikTok's own answer and for who can see it, and takes only what TikTok offers", () => {
    expect(tiktokBlocks(TIKTOK_UI_DEFAULT, null)).toEqual(["sheet", "privacy"]);
    expect(tiktokBlocks(TIKTOK_UI_DEFAULT, sheet())).toEqual(["privacy"]);
    expect(tiktokBlocks({ ...TIKTOK_UI_DEFAULT, privacy: "PUBLIC_TO_EVERYONE" }, sheet())).toEqual(["privacy"]);
    expect(tiktokBlocks({ ...TIKTOK_UI_DEFAULT, privacy: "SELF_ONLY" }, sheet())).toEqual([]);
    expect(tiktokBlocks({ ...TIKTOK_UI_DEFAULT, privacy: "SELF_ONLY" }, sheet({ canPost: false }))).toEqual(["sheet"]);
  });

  it("asks which kind once commercial content is on, and never lets branded content be Only me", () => {
    const on = { ...TIKTOK_UI_DEFAULT, privacy: "SELF_ONLY" as const, commercial: true };
    expect(tiktokBlocks(on, sheet())).toEqual(["commercialPick"]);
    expect(tiktokBlocks({ ...on, yourBrand: true }, sheet())).toEqual([]);
    expect(tiktokBlocks({ ...on, brandedContent: true }, sheet())).toEqual(["brandedPrivate"]);
    const open = sheet({ privacyOptions: ["PUBLIC_TO_EVERYONE", "SELF_ONLY"], testMode: false, brandedContentAvailable: true });
    expect(tiktokBlocks({ ...on, privacy: "PUBLIC_TO_EVERYONE", brandedContent: true }, open)).toEqual([]);
  });

  it("sends neither label while commercial content is off", () => {
    expect(tiktokSent({ ...TIKTOK_UI_DEFAULT, yourBrand: true, brandedContent: true })).toMatchObject({ yourBrand: false, brandedContent: false });
    expect(tiktokSent({ ...TIKTOK_UI_DEFAULT, commercial: true, yourBrand: true })).toMatchObject({ yourBrand: true, brandedContent: false });
    expect(Object.keys(tiktokSent(TIKTOK_UI_DEFAULT)).sort()).toEqual(Object.keys(TIKTOK_CHOICES_DEFAULT).sort());
  });
});

describe("links out", () => {
  it("opens only the person's own profile on the network, and only https posts", () => {
    expect(profileUrl("x", "solstadcoffee")).toBe("https://x.com/solstadcoffee");
    expect(profileUrl("tiktok", "solstad.coffee")).toBe("https://www.tiktok.com/@solstad.coffee");
    expect(profileUrl("instagram", "solstad")).toBe("https://www.instagram.com/solstad/");
    expect(profileUrl("threads", "solstad")).toBe("https://www.threads.net/@solstad");
    expect(profileUrl("x", null)).toBeNull();
    expect(profileUrl("x", "evil/../path")).toBeNull();
    expect(safePermalink("https://x.com/solstadcoffee/status/1")).toBe("https://x.com/solstadcoffee/status/1");
    expect(safePermalink("javascript:alert(1)")).toBeNull();
    expect(safePermalink(null)).toBeNull();
  });

  it("saves a signed file under the product's name, and leaves other links as they are", () => {
    const signed = "https://abc.supabase.co/storage/v1/object/sign/press-kit/u/ad.mp4?token=t";
    const out = new URL(downloadUrl(signed, "solstad-press-tour.mp4"));
    expect(out.searchParams.get("download")).toBe("solstad-press-tour.mp4");
    expect(out.searchParams.get("token")).toBe("t");
    expect(downloadUrl("/api/media/x.mp4", "a.mp4")).toBe("/api/media/x.mp4");
    expect(adFileName("Solstad Oat Cold Brew", "tagged")).toBe("solstad-oat-cold-brew-press-tour.mp4");
    expect(adFileName("Café Olé!", "clean")).toBe("cafe-ole-press-tour-tiktok.mp4");
    expect(adFileName(null, "tagged")).toBe("ad-press-tour.mp4");
  });

  it("lists posts newest first", () => {
    const post = (id: string, updatedAt: string) => ({ id, updatedAt }) as never;
    expect(postsNewestFirst([post("a", "2026-09-26T10:00:00Z"), post("b", "2026-09-26T11:00:00Z")]).map((p: { id: string }) => p.id)).toEqual(["b", "a"]);
  });
});
