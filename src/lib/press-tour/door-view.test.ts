import { describe, expect, it } from "vitest";
import { CAMPAIGN_STAGES, type MomentView, type PressQuote, type ShotView, type StillView, type TakeView } from "./campaign-types";
import { VERDICT_SEVERITY } from "../product-lock/product-lock";
import { ANGLES_MAX, ANGLES_MIN } from "./card-service";
import {
  BOX_MIN,
  PICK_MAX,
  PICK_MIN,
  VERDICT_WEIGHT,
  cardSaveBlock,
  clampBox,
  openingCard,
  clockSeconds,
  clockTenths,
  firstDecisionShot,
  isMiss,
  letterRow,
  momentVerdict,
  shotBusy,
  shotMisses,
  shotsInCut,
  shownTake,
  singleSwap,
  wallBusy,
  wallMoments,
  wallTally,
  worstMoment,
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
  const ready = { picked: 4, hasFront: true, words: 2, noReadableText: false, consent: true };

  it("asks for 3 to 5 photos, exactly as the card service does", () => {
    expect(PICK_MIN).toBe(ANGLES_MIN);
    expect(PICK_MAX).toBe(ANGLES_MAX);
    expect(cardSaveBlock({ ...ready, picked: 2 })).toBe("photos");
    expect(cardSaveBlock({ ...ready, picked: 6 })).toBe("photos");
    expect(cardSaveBlock(ready)).toBeNull();
  });

  it("then the front, the words (or no readable text), and the consent", () => {
    expect(cardSaveBlock({ ...ready, hasFront: false })).toBe("front");
    expect(cardSaveBlock({ ...ready, words: 0 })).toBe("words");
    expect(cardSaveBlock({ ...ready, words: 0, noReadableText: true })).toBeNull();
    expect(cardSaveBlock({ ...ready, consent: false })).toBe("consent");
  });

  it("never waits on the star's answer: a product card saves whoever the door has picked to star", () => {
    // Save once waited for an answer about the door's pick of star, who may
    // not be the one the person meant (pre-flight review, 2026-09-26). An
    // old caller's star fields change nothing; painting still waits for the
    // answer on the server (campaign-service.test.ts, paint.test.ts).
    const withStar = { ...ready, starOpen: true, starAnswered: false } as Parameters<typeof cardSaveBlock>[0];
    expect(cardSaveBlock(withStar)).toBeNull();
    expect(cardSaveBlock({ ...withStar, consent: false })).toBe("consent");
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

  it("opens a card with its own logo box kept, so saving a confirmed card again keeps its logo (pre-flight review, 2026-09-26)", () => {
    // The door's "Edit its card" opens a confirmed card in the sheet. Saving
    // sends only the box the sheet holds, and the server removes a crop no
    // box points at: a sheet that opened with no box lost the logo.
    const card = {
      photos: ["u/p/a.jpg", "u/p/b.jpg", "u/p/c.jpg"],
      angles: [
        { path: "u/p/a.jpg", view: "three_quarter" as const },
        { path: "u/p/b.jpg", view: "front" as const },
        { path: "u/p/c.jpg", view: "side" as const },
      ],
      logoBox: { path: "u/p/b.jpg", x: 0.3, y: 0.35, w: 0.4, h: 0.2 },
    };
    expect(openingCard(card)).toEqual({
      picked: ["u/p/a.jpg", "u/p/b.jpg", "u/p/c.jpg"],
      views: { "u/p/a.jpg": "three_quarter", "u/p/b.jpg": "front", "u/p/c.jpg": "side" },
      logo: { path: "u/p/b.jpg", box: { x: 0.3, y: 0.35, w: 0.4, h: 0.2 } },
    });
    // A box on a photo that is not the front is not one the sheet can show: not kept.
    expect(openingCard({ ...card, logoBox: { ...card.logoBox, path: "u/p/a.jpg" } }).logo).toBeNull();
    // A draft with no views yet: its first photo is the front, and it has no box.
    expect(openingCard({ photos: ["u/p/a.jpg", "u/p/b.jpg"], angles: [], logoBox: null })).toEqual({
      picked: ["u/p/a.jpg", "u/p/b.jpg"],
      views: { "u/p/a.jpg": "front" },
      logo: null,
    });
    expect(openingCard(null)).toEqual({ picked: [], views: {}, logo: null });
  });

  it("names a product page by its host", () => {
    expect(sourceHost("https://www.solstad.coffee/products/oat")).toBe("solstad.coffee");
    expect(sourceHost(null)).toBeNull();
    expect(sourceHost("not a url")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// The press wall (Cut 4 UI)
// ---------------------------------------------------------------------------

function moment(extra: Partial<MomentView> = {}): MomentView {
  return { atSeconds: 1.2, face: "match", product: "match", reason: null, ...extra };
}

function take(extra: Partial<TakeView> = {}): TakeView {
  return {
    take: 1,
    state: "checked",
    videoUrl: "/api/media/generated-videos/u/take-1.mp4",
    moments: [moment({ atSeconds: 1.2 }), moment({ atSeconds: 2.6 }), moment({ atSeconds: 4.1 })],
    worst: "match",
    face: "match",
    product: "match",
    reason: null,
    ...extra,
  };
}

function shot(extra: Partial<ShotView> = {}): ShotView {
  return {
    shot: 1,
    role: "hook",
    takes: [take()],
    chosenTake: 1,
    decision: "pending",
    needsDecision: false,
    productExpected: true,
    refilmCredits: 2,
    canRefilm: true,
    ...extra,
  };
}

describe("the press wall", () => {
  it("puts an ad waiting after filming at the Press wall, not back at the Stills", () => {
    expect(routeIndex("awaiting_approval", true)).toBe(3);
    expect(routeIndex("awaiting_approval", false)).toBe(1);
    expect(routeIndex("awaiting_approval")).toBe(1);
    expect(routeIndex("animating", true)).toBe(2);
    expect(routeIndex("ready", true)).toBe(4);
  });

  it("weighs the verdicts exactly as the checker does", () => {
    expect(VERDICT_WEIGHT).toEqual(VERDICT_SEVERITY);
    expect(isMiss("didnt_match")).toBe(true);
    expect(isMiss("product_missing")).toBe(true);
    for (const v of ["match", "not_readable", "not_checked", "no_one_in_shot"] as const) expect(isMiss(v), v).toBe(false);
  });

  it("reads a moment by the checks that apply to its shot", () => {
    // A packshot with no one in it: the product alone.
    expect(momentVerdict(moment({ face: "no_one_in_shot", product: "didnt_match" }), true)).toBe("didnt_match");
    // A hook planned without the product: the face alone (its product word is "not checked" and doesn't count).
    expect(momentVerdict(moment({ face: "match", product: "not_checked" }), false)).toBe("match");
    // Both apply: the worse.
    expect(momentVerdict(moment({ face: "didnt_match", product: "match" }), true)).toBe("didnt_match");
    expect(momentVerdict(moment({ face: "match", product: "not_readable" }), true)).toBe("not_readable");
    // Nothing applies.
    expect(momentVerdict(moment({ face: "no_one_in_shot", product: "not_checked" }), false)).toBe("not_checked");
  });

  it("lays every moment out in cut order, numbered across the wall, timed in the ad", () => {
    const shots = [
      shot({ shot: 2, role: "costar", takes: [take({ moments: [moment({ atSeconds: 0.8 }), moment({ atSeconds: 2.2, product: "didnt_match" }), moment({ atSeconds: 3.9, product: "not_readable" })] })] }),
      shot({ shot: 1 }),
    ];
    const wall = wallMoments(shots, { 1: 0, 2: 5 });
    expect(wall.map((m) => m.index)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(wall.map((m) => m.shot)).toEqual([1, 1, 1, 2, 2, 2]);
    expect(wall[4]).toMatchObject({ index: 5, shot: 2, take: 1, at: 7.2, atTake: 2.2, verdict: "didnt_match" });
    expect(wall.map((m) => m.key)).toEqual(["1-1-0", "1-1-1", "1-1-2", "2-1-0", "2-1-1", "2-1-2"]);
    expect(wallTally(wall)).toEqual([
      { verdict: "match", count: 4 },
      { verdict: "didnt_match", count: 1 },
      { verdict: "not_readable", count: 1 },
    ]);
    expect(worstMoment(wall)?.index).toBe(5);
    expect(shotMisses(wall, 2)).toBe(1);
    expect(shotMisses(wall, 1)).toBe(0);
  });

  it("leaves out a cut shot and a take not yet read, and never calls blur or a missing check the worst", () => {
    const shots = [
      shot({ shot: 1, decision: "cut" }),
      shot({ shot: 2, takes: [take({ state: "filming", moments: [] })] }),
      shot({ shot: 3, takes: [take({ moments: [moment({ product: "not_readable" }), moment({ product: "not_checked" })] })] }),
    ];
    const wall = wallMoments(shots, {});
    expect(wall.map((m) => m.shot)).toEqual([3, 3]);
    expect(worstMoment(wall)).toBeNull();
    expect(wallBusy(shots)).toBe(true);
    expect(shotBusy(shots[1])).toBe(true);
    expect(shotBusy(shot({ decision: "refilming" }))).toBe(true);
    expect(shotsInCut(shots)).toBe(2);
  });

  it("shows the person's pick, else the take the cut uses, else the newest read", () => {
    const two = shot({ takes: [take({ take: 1 }), take({ take: 2, state: "checking", moments: [] })], chosenTake: null, needsDecision: true });
    expect(shownTake(two)?.take).toBe(1);
    expect(shownTake(two, 2)?.take).toBe(2);
    expect(shownTake(shot({ chosenTake: 1, takes: [take({ take: 1 }), take({ take: 2 })] }))?.take).toBe(1);
    expect(shownTake(shot({ takes: [] }))).toBeNull();
    expect(firstDecisionShot([shot({ shot: 3, needsDecision: true }), shot({ shot: 2, needsDecision: true })])?.shot).toBe(2);
    expect(firstDecisionShot([shot()])).toBeNull();
  });

  it("spells a misread label letter by letter, the label's letter under each one that differs", () => {
    const row = letterRow("SOLSTAO", "SOLSTAD")!;
    expect(row.cells.map((c) => c.read).join("")).toBe("SOLSTAO");
    expect(row.wrong).toBe(1);
    expect(row.cells[6]).toEqual({ read: "O", want: "D" });
    expect(singleSwap(row)).toEqual({ at: 7, want: "D" });
    // The part of a longer line nearest the word.
    const line = letterRow("SOLSTAO COLD BREW", "Solstad")!;
    expect(line.cells.map((c) => c.read).join("")).toBe("SOLSTAO");
    // A letter missing, a letter extra.
    const missing = letterRow("SOLSAD", "SOLSTAD")!;
    expect(missing.wrong).toBe(1);
    expect(missing.cells.find((c) => c.read === "")).toEqual({ read: "", want: "T" });
    expect(singleSwap(missing)).toBeNull();
    const extra = letterRow("SOLSTTAD", "SOLSTAD")!;
    expect(extra.cells.filter((c) => c.want === "").length).toBe(1);
    // Too far apart to spell out, the same word, or nothing to compare.
    expect(letterRow("OATMILK", "SOLSTAD")).toBeNull();
    expect(letterRow("solstad", "SOLSTAD")).toBeNull();
    expect(letterRow("", "SOLSTAD")).toBeNull();
    expect(letterRow("SOLSTAO", "")).toBeNull();
    expect(letterRow("X".repeat(30), "X".repeat(29) + "Y")).toBeNull();
  });

  it("prints a moment's place to a tenth of a second and a length in seconds", () => {
    expect(clockTenths(7.2)).toBe("0:07.2");
    expect(clockTenths(0)).toBe("0:00.0");
    expect(clockTenths(65.04)).toBe("1:05.0");
    expect(clockTenths(null)).toBe("–");
    expect(clockSeconds(15)).toBe("0:15");
    expect(clockSeconds(null)).toBe("–");
  });
});
