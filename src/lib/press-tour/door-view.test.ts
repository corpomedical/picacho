import { describe, expect, it } from "vitest";
import { CAMPAIGN_STAGES, type PressQuote, type StillView } from "./campaign-types";
import { ANGLES_MAX, ANGLES_MIN } from "./card-service";
import {
  BOX_MIN,
  PICK_MAX,
  PICK_MIN,
  cardSaveBlock,
  clampBox,
  decidedCount,
  firstWaiting,
  isClosed,
  isWorking,
  networkStates,
  nextSpend,
  planBlock,
  plannedSeconds,
  routeIndex,
  shotNumber,
  shotSeconds,
  sourceHost,
  spanLabel,
  productChecked,
  stillAllClear,
  stillFlashes,
  stillNeedsDecision,
} from "./door-view";

// The Press Tour door's own rules (door-view.ts): where an ad sits on the
// route, which still flashes, which one waits on the person, what the key
// spends next, what the networks may claim, and what blocks a plan or a card.

function still(extra: Partial<StillView> = {}): StillView {
  return {
    shot: 1,
    role: "hook",
    span: [0, 5],
    direction: "Eva at the wheel at dawn.",
    imageUrl: "https://signed/still-1.jpg",
    face: "match",
    product: "match",
    productExpected: true,
    reason: null,
    decision: "pending",
    repaints: 0,
    houseRepainted: false,
    ...extra,
  };
}

function quote(extra: Partial<PressQuote> = {}): PressQuote {
  return {
    version: 1,
    paint: 3,
    animate: 6,
    total: 9,
    rows: [
      { key: "stills", credits: 3, paid: false },
      { key: "film", credits: 6, paid: false },
      { key: "checks", credits: 0, paid: false },
      { key: "posting", credits: 0, paid: false },
    ],
    policy: { reshoot: "off", refund: false },
    balanceNow: 96,
    balanceAfterNextStep: 93,
    trial: false,
    ...extra,
  };
}

describe("the route", () => {
  it("puts every stage at one of the five stops, and a closed ad back at the Plan", () => {
    const at = Object.fromEntries(CAMPAIGN_STAGES.map((s) => [s, routeIndex(s)]));
    expect(at).toEqual({
      draft: 0,
      planned: 0,
      painting: 1,
      checking_keyframes: 1,
      awaiting_approval: 1,
      animating: 2,
      checking_shots: 3,
      assembling: 3,
      signing: 3,
      ready: 4,
      failed: 0,
      cancelled: 0,
      expired: 0,
    });
    expect(routeIndex(null)).toBe(0);
  });

  it("asks the engine again only while it works, and knows a closed ad", () => {
    expect(CAMPAIGN_STAGES.filter(isWorking)).toEqual(["draft", "painting", "checking_keyframes", "animating", "checking_shots", "assembling", "signing"]);
    expect(CAMPAIGN_STAGES.filter(isClosed)).toEqual(["failed", "cancelled", "expired"]);
    // Waiting on the person is not the engine working: no polling there.
    expect(isWorking("awaiting_approval")).toBe(false);
    expect(isWorking("planned")).toBe(false);
  });
});

describe("the stills", () => {
  it("fires the flashbulb only when the face AND the product both read Match", () => {
    expect(stillFlashes(still())).toBe(true);
    expect(stillFlashes(still({ face: "no_one_in_shot" }))).toBe(false);
    expect(stillFlashes(still({ product: "not_readable" }))).toBe(false);
    expect(stillFlashes(still({ face: "didnt_match" }))).toBe(false);
    // Nothing flashes before it is painted.
    expect(stillFlashes(still({ imageUrl: null }))).toBe(false);
  });

  it("clears a packshot with no one in it, and asks the person about anything else", () => {
    expect(stillAllClear(still({ face: "no_one_in_shot" }))).toBe(true);
    for (const product of ["didnt_match", "not_readable", "product_missing", "not_checked"] as const) {
      expect(stillAllClear(still({ product })), product).toBe(false);
      expect(stillNeedsDecision(still({ product })), product).toBe(true);
    }
    for (const face of ["didnt_match", "not_readable", "not_checked"] as const) {
      expect(stillNeedsDecision(still({ face })), face).toBe(true);
    }
    expect(stillNeedsDecision(still())).toBe(false);
    // A still still being painted asks nothing yet.
    expect(stillNeedsDecision(still({ imageUrl: null, product: "not_checked" }))).toBe(false);
  });

  it("a hook planned without the product is clear on its face alone: one-press Approve, never 'waits for you' (PT-01)", () => {
    // What the engine sends for the default 15 s ad's shot 1: the product
    // check did not apply, so its word is Not checked, and it is not expected.
    const hook = still({ role: "hook", product: "not_checked", productExpected: false, reason: null });
    expect(productChecked(hook)).toBe(false);
    expect(stillAllClear(hook)).toBe(true);
    expect(stillNeedsDecision(hook)).toBe(false);
    expect(firstWaiting([hook])).toBeNull();
    // The star is in the frame and every applicable check matched: the hook flashes.
    expect(stillFlashes(hook)).toBe(true);
    // A packshot with no one in it never flashes, even with its product matched.
    expect(stillFlashes(still({ face: "no_one_in_shot", product: "match" }))).toBe(false);
    // Its face still decides: a face that didn't match waits for the person.
    expect(stillNeedsDecision(still({ product: "not_checked", productExpected: false, face: "didnt_match" }))).toBe(true);
    // A shot planned WITH the product still needs its Match.
    expect(stillNeedsDecision(still({ product: "not_checked", productExpected: true }))).toBe(true);
  });

  it("finds the first still that waits, and counts the decided ones", () => {
    const stills = [
      still({ shot: 1, decision: "approved" }),
      still({ shot: 2, face: "no_one_in_shot", decision: "pending" }),
      still({ shot: 3, product: "not_readable", decision: "pending" }),
    ];
    expect(firstWaiting(stills)?.shot).toBe(3);
    expect(decidedCount(stills)).toBe(1);
    expect(firstWaiting([still({ product: "not_readable", decision: "kept" })])).toBeNull();
  });

  it("writes a shot's place in the cut and its number the way the artboards do", () => {
    expect(spanLabel([0, 5])).toBe("0:00–0:05");
    expect(spanLabel([55, 65])).toBe("0:55–1:05");
    expect(shotNumber(3)).toBe("03");
    const stills = [still({ span: [0, 5] }), still({ shot: 2, span: [5, 10] }), still({ shot: 3, span: [10, 15] })];
    expect(plannedSeconds(stills)).toBe(15);
    expect(shotSeconds(stills)).toBe(5);
    expect(shotSeconds([still({ span: [0, 5] }), still({ shot: 2, span: [5, 15] })])).toBeNull();
  });
});

describe("the money", () => {
  it("picks the next spend from the quote's own rows, and adds nothing up", () => {
    expect(nextSpend(null)).toBeNull();
    expect(nextSpend(quote())).toBe("paint");
    const painted = quote({ rows: quote().rows.map((r) => (r.key === "stills" ? { ...r, paid: true } : r)) });
    expect(nextSpend(painted)).toBe("film");
    const all = quote({ rows: quote().rows.map((r) => ({ ...r, paid: true })) });
    expect(nextSpend(all)).toBeNull();
  });
});

describe("the networks", () => {
  const off = { press_tour_posting: false, press_post_x: false, press_post_tiktok_direct: false, press_post_meta: false };

  it("claims nothing before its posting switch is on", () => {
    expect(networkStates(off)).toEqual({ x: "comingSoon", tiktok: "comingSoon", instagram: "comingSoon" });
    // A network's own switch without posting opens nothing.
    expect(networkStates({ ...off, press_post_x: true, press_post_tiktok_direct: true, press_post_meta: true })).toEqual({
      x: "comingSoon",
      tiktok: "comingSoon",
      instagram: "comingSoon",
    });
  });

  it("reads X Ready, TikTok and Instagram only ever a private test", () => {
    const on = { press_tour_posting: true, press_post_x: true, press_post_tiktok_direct: true, press_post_meta: true };
    expect(networkStates(on)).toEqual({ x: "ready", tiktok: "privateTest", instagram: "privateTest" });
  });
});

describe("what blocks a plan", () => {
  const star = { photoCount: 2, adAnswer: "me" as const };
  const product = { status: "confirmed" as const, category: "food" as const };

  it("names the first thing missing, in the order the door asks for it", () => {
    expect(planBlock({ emailConfirmed: false, star, product })).toBe("email");
    expect(planBlock({ emailConfirmed: true, star: null, product })).toBe("star");
    expect(planBlock({ emailConfirmed: true, star: { photoCount: 0, adAnswer: null }, product })).toBe("starPhoto");
    expect(planBlock({ emailConfirmed: true, star: { photoCount: 2, adAnswer: null }, product })).toBe("starAnswer");
    expect(planBlock({ emailConfirmed: true, star, product: null })).toBe("product");
    expect(planBlock({ emailConfirmed: true, star, product: { status: "confirmed", category: "regulated" } })).toBe("productRefused");
    expect(planBlock({ emailConfirmed: true, star, product: { status: "draft", category: "food" } })).toBe("productCard");
    expect(planBlock({ emailConfirmed: true, star, product })).toBeNull();
  });
});

describe("what blocks a product card", () => {
  const ready = { picked: 4, hasFront: true, words: 2, noReadableText: false, consent: true, starOpen: false, starAnswered: false };

  it("asks for 3 to 5 photos, exactly as the card service does", () => {
    expect(PICK_MIN).toBe(ANGLES_MIN);
    expect(PICK_MAX).toBe(ANGLES_MAX);
    expect(cardSaveBlock({ ...ready, picked: 2 })).toBe("photos");
    expect(cardSaveBlock({ ...ready, picked: 6 })).toBe("photos");
    expect(cardSaveBlock(ready)).toBeNull();
  });

  it("then the front, the words (or no readable text), the consent, and the star's answer when it is asked", () => {
    expect(cardSaveBlock({ ...ready, hasFront: false })).toBe("front");
    expect(cardSaveBlock({ ...ready, words: 0 })).toBe("words");
    expect(cardSaveBlock({ ...ready, words: 0, noReadableText: true })).toBeNull();
    expect(cardSaveBlock({ ...ready, consent: false })).toBe("consent");
    expect(cardSaveBlock({ ...ready, starOpen: true })).toBe("star");
    expect(cardSaveBlock({ ...ready, starOpen: true, starAnswered: true })).toBeNull();
  });
});

describe("the logo box", () => {
  it("stays inside the photo and never shrinks to nothing", () => {
    expect(clampBox({ x: 0.9, y: 0.9, w: 0.3, h: 0.3 })).toEqual({ x: 0.7, y: 0.7, w: 0.3, h: 0.3 });
    const tiny = clampBox({ x: 0.5, y: 0.5, w: 0, h: 0.001 });
    expect(tiny.w).toBe(BOX_MIN);
    expect(tiny.h).toBe(BOX_MIN);
    const any = clampBox({ x: -1, y: Number.NaN, w: 5, h: 0.2 });
    expect(any.x).toBe(0);
    expect(any.y).toBe(0);
    expect(any.x + any.w).toBeLessThanOrEqual(1);
  });

  it("names a product page by its host", () => {
    expect(sourceHost("https://www.solstad.coffee/products/oat")).toBe("solstad.coffee");
    expect(sourceHost(null)).toBeNull();
    expect(sourceHost("not a url")).toBeNull();
  });
});
