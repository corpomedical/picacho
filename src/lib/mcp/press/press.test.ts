import { describe, expect, it } from "vitest";
import type { CampaignResult, CampaignView, PressQuote, StillView } from "../../press-tour/campaign-types";
import { PRODUCT_NOT_CONFIRMED } from "../../press-tour/campaign-messages";
import { fakeDb, type Row } from "../fake-db";
import { MCP_INSTRUCTIONS, MCP_TOOLS, getMcpTool, isModelCallable, isSpendingTool, listedTools, mcpInstructions, wireTool } from "../tools";
import { hashSecret } from "../oauth/tokens";
import { adCardFromView } from "./card";
import { NONCE_REQUIRED, NONCE_USED, NONCE_WRONG, PRESS_MCP_MESSAGES, PRODUCT_NOT_FOUND_BY_URL } from "./messages";
import { runPressTool, type PressDeps, type PressEngine, type PressMcpCaller } from "./service";
import { PRESS_TOUR_INSTRUCTIONS } from "./tool-defs";
import { PRESS_WIDGET_URI, UI_NONCE_META_KEY, pressTourWidgetHtml, widgetMeta, widgetResourceContents } from "./widget";
import { WIDGET_TEXT_EN } from "./widget-text";

// Press Tour inside Claude and ChatGPT (Cut 8): the tools, the card's
// one-time code, and the MONEY rule — the only spender a model can call is
// generate_image; painting and filming start only from the person's tap on
// Picacho's card.

const USER = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";
const PRODUCT = "33333333-3333-4333-8333-333333333333";
const CHAR = "44444444-4444-4444-8444-444444444444";
const PLAN = "55555555-5555-4555-8555-555555555555";
const PLAN_B = "66666666-6666-4666-8666-666666666666";
const GRANT = "77777777-7777-4777-8777-777777777777";
const ORIGIN = "https://picacho.ai";

function quote(over: Partial<PressQuote> = {}): PressQuote {
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
    balanceNow: 99,
    balanceAfterNextStep: 96,
    trial: false,
    ...over,
  };
}

function still(shot: number, over: Partial<StillView> = {}): StillView {
  return {
    shot,
    role: shot === 1 ? "hook" : shot === 2 ? "costar" : "line",
    span: [(shot - 1) * 5, shot * 5],
    direction: "x",
    imageUrl: null,
    face: "not_checked",
    product: "not_checked",
    productExpected: true,
    reason: null,
    decision: "pending",
    repaints: 0,
    houseRepainted: false,
    ...over,
  };
}

function view(over: Partial<CampaignView> = {}): CampaignView {
  return {
    id: PLAN,
    stage: "planned",
    source: "mcp",
    productId: PRODUCT,
    characterIds: [CHAR],
    brandKitId: null,
    lengthSeconds: 15,
    aspect: "9:16",
    angle: "Solstad launch",
    stills: [still(1), still(2), still(3)],
    shots: [],
    master: null,
    creditsRefunded: 0,
    quote: quote(),
    blocker: null,
    error: null,
    updatedAt: "2026-09-26T10:00:00.000Z",
    ...over,
  };
}

const PAINTED = [
  still(1, { imageUrl: "/api/media/generated-images/u/1.png?v=s", face: "match", product: "match" }),
  still(2, { imageUrl: "/api/media/generated-images/u/2.png?v=s", face: "no_one_in_shot", product: "match" }),
  still(3, { imageUrl: "/api/media/generated-images/u/3.png?v=s", face: "match", product: "not_readable", reason: "The label is turned away" }),
];

type Calls = { plan: unknown[]; paint: unknown[]; approve: unknown[]; keep: unknown[]; film: unknown[]; importProduct: unknown[] };

function harness(opts: { via?: "admin" | "plan"; canSpend?: boolean; film?: boolean; state?: CampaignView; products?: Row[] } = {}) {
  const f = fakeDb({
    products: opts.products ?? [
      {
        id: PRODUCT,
        user_id: USER,
        name: "Solstad Oat Cold Brew",
        status: "confirmed",
        source_url: "https://solstad.coffee/products/oat-cold-brew",
        image_paths: [],
        label_strings: ["SOLSTAD"],
        deleted_at: null,
        updated_at: "2026-09-25",
      },
    ],
    character_profiles: [{ id: CHAR, user_id: USER, name: "Eva", reference_image_urls: [`${USER}/eva.jpg`] }],
    press_campaigns: [{ id: PLAN, user_id: USER, mcp_grant_id: null, platforms: [], deleted_at: null }],
    mcp_ui_nonces: [],
  });
  let state = opts.state ?? view();
  const calls: Calls = { plan: [], paint: [], approve: [], keep: [], film: [], importProduct: [] };
  const ok = (): CampaignResult => ({ ok: true, campaign: structuredClone(state) });
  const engine: PressEngine = {
    plan: async (input) => {
      calls.plan.push(input);
      return ok();
    },
    paint: async (input) => {
      calls.paint.push(input);
      state = { ...state, stage: "painting", quote: quote({ rows: quote().rows.map((r) => (r.key === "stills" ? { ...r, paid: true } : r)) }) };
      return ok();
    },
    approve: async (input) => {
      calls.approve.push(input);
      state = { ...state, stills: state.stills.map((s) => (s.shot === input.shot ? { ...s, decision: "approved" } : s)) };
      return ok();
    },
    keep: async (input) => {
      calls.keep.push(input);
      state = { ...state, stills: state.stills.map((s) => (s.shot === input.shot ? { ...s, decision: "kept" } : s)) };
      return ok();
    },
    get: async ({ campaignId }) => (campaignId === state.id ? ok() : { ok: false, error: "That ad isn't on this account." }),
    film: opts.film
      ? async (input) => {
          calls.film.push(input);
          state = { ...state, stage: "animating" };
          return ok();
        }
      : null,
    importProduct: async (input) => {
      calls.importProduct.push(input);
      return { error: null, card: { id: "88888888-8888-4888-8888-888888888888", name: "New thing", status: "draft", sourceUrl: input.url, labelStrings: [] } as never, labelCandidates: ["NEW", "THING"] };
    },
    canSpend: opts.canSpend ?? true,
  };
  let n = 0;
  const deps: PressDeps = { db: f.db, engine, origin: ORIGIN, repaintCredits: 1, now: () => new Date("2026-09-26T10:00:00.000Z"), newNonce: () => `pmcp_un_test_nonce_${++n}_${"x".repeat(20)}` };
  const caller: PressMcpCaller = { userId: USER, via: opts.via ?? "admin", grantId: GRANT };
  const run = (name: string, args: Record<string, unknown> = {}, who: PressMcpCaller = caller) => runPressTool(name, args, deps, who);
  return {
    ...f,
    calls,
    deps,
    caller,
    run,
    set(next: CampaignView) {
      state = next;
    },
  };
}

const nonceOf = (r: { _meta?: Record<string, unknown> }) => (r._meta?.[UI_NONCE_META_KEY] as { value: string; purpose: string } | undefined) ?? null;

describe("MONEY: only a person's tap on the card can spend", () => {
  it("the only spender a model can call is generate_image", () => {
    const modelSpenders = MCP_TOOLS.filter((t) => isModelCallable(t) && isSpendingTool(t.name)).map((t) => t.name);
    expect(modelSpenders).toEqual(["generate_image"]);
  });

  it("Press Tour's paid steps are card-only, need the card's code, and are never read-only", () => {
    const spenders = MCP_TOOLS.filter((t) => t.pressTour && t.spends).map((t) => t.name).sort();
    expect(spenders).toEqual(["approve_stills", "start_ad"]);
    for (const name of spenders) {
      const t = getMcpTool(name)!;
      expect(t.visibility, name).toEqual(["app"]);
      expect(t.inputSchema.required, name).toContain("ui_nonce");
      expect(t.annotations?.readOnlyHint, name).toBe(false);
      const wire = wireTool(t) as { _meta: { ui: { visibility: string[] }; "openai/visibility": string } };
      expect(wire._meta.ui.visibility, name).toEqual(["app"]);
      expect(wire._meta["openai/visibility"], name).toBe("private");
    }
  });

  it("there is no post or schedule tool and no publish scope", () => {
    const names = MCP_TOOLS.map((t) => t.name);
    for (const banned of ["post_ad", "schedule_post", "publish", "post"]) expect(names).not.toContain(banned);
    for (const t of MCP_TOOLS) expect(["read", "brand", "generate"]).toContain(t.scope);
  });

  it("SECURITY: start_ad without the card's code spends nothing", async () => {
    const h = harness();
    for (const args of [{ plan_id: PLAN }, { plan_id: PLAN, ui_nonce: "" }, { plan_id: PLAN, ui_nonce: "made-up-by-a-model-000000000000" }]) {
      const r = await h.run("start_ad", args);
      expect(r.isError).toBe(true);
      expect(r.content[0].text).toMatch(new RegExp(`${NONCE_REQUIRED}|${NONCE_WRONG}`));
    }
    expect(h.calls.paint).toEqual([]);
  });
});

describe("the card's one-time code", () => {
  it("rides only in _meta (never in what the model reads), bound to the step", async () => {
    const h = harness();
    const r = await h.run("draft_ad_plan", { character_id: CHAR, product_id: PRODUCT });
    const code = nonceOf(r)!;
    expect(code.purpose).toBe("paint");
    expect(JSON.stringify(r.structuredContent)).not.toContain(code.value);
    expect(JSON.stringify(r.content)).not.toContain(code.value);
    // Stored hashed.
    expect(JSON.stringify(h.tables.mcp_ui_nonces)).not.toContain(code.value);
    expect(h.tables.mcp_ui_nonces[0]).toMatchObject({ nonce_hash: hashSecret(code.value), user_id: USER, campaign_id: PLAN, quote_total: 9, grant_id: GRANT });
  });

  it("a tap spends once: the same code again is refused and paints nothing more", async () => {
    const h = harness();
    const plan = await h.run("draft_ad_plan", { character_id: CHAR, product_id: PRODUCT });
    const code = nonceOf(plan)!;
    const first = await h.run("start_ad", { plan_id: PLAN, ui_nonce: code.value });
    expect(first.isError).toBeUndefined();
    expect(h.calls.paint).toHaveLength(1);
    const again = await h.run("start_ad", { plan_id: PLAN, ui_nonce: code.value });
    expect(again.isError).toBe(true);
    expect(again.content[0].text).toContain(NONCE_USED);
    expect(h.calls.paint).toHaveLength(1);
    // The paint's send id is made from the code: the same tap delivered twice meets the same rows.
    expect((h.calls.paint[0] as { sendId: string }).sendId).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("SECURITY: another account's code, another ad's, or another step's does not work", async () => {
    const h = harness();
    const code = nonceOf(await h.run("draft_ad_plan", { character_id: CHAR, product_id: PRODUCT }))!;
    const other: PressMcpCaller = { userId: OTHER, via: "admin", grantId: null };
    expect((await h.run("start_ad", { plan_id: PLAN, ui_nonce: code.value }, other)).content[0].text).toBe(NONCE_WRONG);
    expect((await h.run("start_ad", { plan_id: PLAN_B, ui_nonce: code.value })).content[0].text).toBe(NONCE_WRONG);
    expect((await h.run("approve_stills", { plan_id: PLAN, ui_nonce: code.value })).content[0].text).toBe(NONCE_WRONG);
    expect(h.calls.paint).toEqual([]);
  });

  it("a code expires after 15 minutes; the refusal carries a fresh card and a fresh code", async () => {
    const h = harness();
    const code = nonceOf(await h.run("draft_ad_plan", { character_id: CHAR, product_id: PRODUCT }))!;
    h.deps.now = () => new Date("2026-09-26T10:16:00.000Z");
    const r = await h.run("start_ad", { plan_id: PLAN, ui_nonce: code.value });
    expect(r.isError).toBe(true);
    expect(r.structuredContent).toMatchObject({ kind: "press_tour_ad", next: "paint" });
    expect(nonceOf(r)?.value).not.toBe(code.value);
    expect(h.calls.paint).toEqual([]);
  });

  it("MONEY: a price that moved since the card was drawn is not the price the person tapped", async () => {
    const h = harness();
    const code = nonceOf(await h.run("draft_ad_plan", { character_id: CHAR, product_id: PRODUCT }))!;
    h.set(view({ quote: quote({ paint: 4, total: 10 }) }));
    const r = await h.run("start_ad", { plan_id: PLAN, ui_nonce: code.value });
    expect(r.isError).toBe(true);
    expect(r.content[0].text).toContain("The price changed to 4 credits");
    expect(h.calls.paint).toEqual([]);
  });

  it("no code while the account's paid presses are closed, or it is short of credits", async () => {
    const closed = harness({ canSpend: false });
    expect(nonceOf(await closed.run("draft_ad_plan", { character_id: CHAR, product_id: PRODUCT }))).toBeNull();
    const short = harness({ via: "plan", state: view({ quote: quote({ balanceNow: 2, balanceAfterNextStep: 0 }) }) });
    const r = await short.run("draft_ad_plan", { character_id: CHAR, product_id: PRODUCT });
    expect(nonceOf(r)).toBeNull();
    expect(r.structuredContent).toMatchObject({ short_by: { needed: 3, have: 2 } });
    expect((r.structuredContent as { summary: string }).summary).toContain("This step needs 3 credits; the account has 2.");
    // An admin's credits never move: never short.
    const admin = harness({ via: "admin", state: view({ quote: quote({ balanceNow: 0, balanceAfterNextStep: 0 }) }) });
    expect(nonceOf(await admin.run("draft_ad_plan", { character_id: CHAR, product_id: PRODUCT }))?.purpose).toBe("paint");
  });
});

describe("approve_stills", () => {
  it("records the person's choices (free) and, with filming closed here, films nothing", async () => {
    const h = harness({ state: view({ stage: "awaiting_approval", stills: PAINTED, quote: quote({ rows: quote().rows.map((r) => (r.key === "stills" ? { ...r, paid: true } : r)) }) }) });
    const got = await h.run("get_ad_job", { plan_id: PLAN });
    const code = nonceOf(got)!;
    expect(code.purpose).toBe("approve");
    expect(got.structuredContent).toMatchObject({ next: "decide", film_open: false });
    const r = await h.run("approve_stills", {
      plan_id: PLAN,
      ui_nonce: code.value,
      decisions: [
        { shot: 1, choice: "approve" },
        { shot: 2, choice: "approve" },
        { shot: 3, choice: "keep" },
      ],
    });
    expect(r.isError).toBeUndefined();
    expect(h.calls.approve).toHaveLength(2);
    expect(h.calls.keep).toHaveLength(1);
    expect(h.calls.film).toEqual([]);
    expect(r.structuredContent).toMatchObject({ next: "film_in_picacho" });
  });

  it("with filming open, the same tap films once every still is decided", async () => {
    const h = harness({ film: true, state: view({ stage: "awaiting_approval", stills: PAINTED }) });
    const code = nonceOf(await h.run("get_ad_job", { plan_id: PLAN }))!;
    await h.run("approve_stills", {
      plan_id: PLAN,
      ui_nonce: code.value,
      decisions: [
        { shot: 1, choice: "approve" },
        { shot: 2, choice: "approve" },
      ],
    });
    // Shot 3 still waits: nothing filmed.
    expect(h.calls.film).toEqual([]);
    const code2 = nonceOf(await h.run("get_ad_job", { plan_id: PLAN }))!;
    await h.run("approve_stills", { plan_id: PLAN, ui_nonce: code2.value, decisions: [{ shot: 3, choice: "keep" }] });
    expect(h.calls.film).toHaveLength(1);
    // No language from the card: the film step's own default (English) writes the tag.
    expect(h.calls.film[0]).not.toHaveProperty("locale");
  });

  it("MONEY (MONEY-4): a card drawn while filming was closed never films, even if filming opens before the tap", async () => {
    const h = harness({ film: false, state: view({ stage: "awaiting_approval", stills: PAINTED }) });
    const drawn = await h.run("get_ad_job", { plan_id: PLAN });
    const code = nonceOf(drawn)!;
    // The card showed "Approve stills", no Film key and no film price.
    expect(code.purpose).toBe("approve");
    expect(drawn.structuredContent).toMatchObject({ next: "decide", film_open: false });
    // The operator turns filming on within the code's 15 minutes.
    h.deps.engine.film = async (input) => {
      h.calls.film.push(input);
      return { ok: true, campaign: view({ stage: "animating" }) };
    };
    const r = await h.run("approve_stills", { plan_id: PLAN, ui_nonce: code.value, decisions: [1, 2, 3].map((shot) => ({ shot, choice: "approve" })) });
    expect(r.isError).toBeUndefined();
    expect(h.calls.approve).toHaveLength(3);
    expect(h.calls.film).toEqual([]);
    // What comes back is a fresh card showing the Film key and its price, with a code that may film.
    expect(r.structuredContent).toMatchObject({ next: "film", film_open: true, quote: { animate: 6 } });
    const filmCode = nonceOf(r)!;
    expect(filmCode.purpose).toBe("film");
    await h.run("approve_stills", { plan_id: PLAN, ui_nonce: filmCode.value, decisions: [] });
    expect(h.calls.film).toHaveLength(1);
    // Stored as the step it was minted for.
    expect(h.tables.mcp_ui_nonces.map((n) => n.purpose)).toEqual(["approve", "film"]);
  });

  it("the card's language reaches the film step, so the ad's AI-generated tag is in it (integration, 2026-09-26)", async () => {
    for (const [sent, expected] of [["es", "es"], ["it", "it"], ["xx", undefined], [42, undefined]] as const) {
      const h = harness({ film: true, state: view({ stage: "awaiting_approval", stills: PAINTED }) });
      const code = nonceOf(await h.run("get_ad_job", { plan_id: PLAN }))!;
      const decisions = [1, 2, 3].map((shot) => ({ shot, choice: "approve" }));
      const r = await h.run("approve_stills", { plan_id: PLAN, ui_nonce: code.value, decisions, locale: sent });
      expect(r.isError, String(sent)).toBeUndefined();
      expect(h.calls.film, String(sent)).toHaveLength(1);
      expect((h.calls.film[0] as { locale?: string }).locale, String(sent)).toBe(expected);
    }
    // The tool takes the tag's languages and nothing else, and the card sends its own.
    const schema = getMcpTool("approve_stills")!.inputSchema as { properties: { locale: { enum: string[] } } };
    expect([...schema.properties.locale.enum].sort()).toEqual(["en", "es", "it", "pt"]);
    expect(pressTourWidgetHtml()).toContain("decisions:decisions(),locale:LOC");
  });

  it("refuses malformed decisions before using the code", async () => {
    const h = harness({ state: view({ stage: "awaiting_approval", stills: PAINTED }) });
    for (const decisions of [[{ shot: 0, choice: "approve" }], [{ shot: 1, choice: "film" }], [{ shot: 1, choice: "keep" }, { shot: 1, choice: "approve" }], "all"]) {
      const r = await h.run("approve_stills", { plan_id: PLAN, ui_nonce: "x".repeat(30), decisions });
      expect(r.isError).toBe(true);
    }
    expect(h.tables.mcp_ui_nonces.every((n) => !n.used_at)).toBe(true);
  });
});

describe("the model's tools", () => {
  it("draft_ad_plan is idempotent: the same choices on the same day meet the same plan", async () => {
    const h = harness();
    await h.run("draft_ad_plan", { character_id: CHAR, product_id: PRODUCT, goal: "Morning ritual" });
    await h.run("draft_ad_plan", { character_id: CHAR, product_id: PRODUCT, goal: "Morning ritual" });
    await h.run("draft_ad_plan", { character_id: CHAR, product_id: PRODUCT, goal: "Something else" });
    await h.run("draft_ad_plan", { character_id: CHAR, product_id: PRODUCT, idempotency_key: "k1" });
    await h.run("draft_ad_plan", { character_id: CHAR, product_id: PRODUCT, idempotency_key: "k1", goal: "ignored by the key" });
    const ids = (h.calls.plan as { sendId: string }[]).map((c) => c.sendId);
    expect(ids[0]).toBe(ids[1]);
    expect(ids[2]).not.toBe(ids[0]);
    expect(ids[3]).toBe(ids[4]);
    // Tagged with the connection it came through.
    expect(h.tables.press_campaigns[0].mcp_grant_id).toBe(GRANT);
  });

  it("finds a product by its page, and sends a new or unconfirmed one to Picacho", async () => {
    const h = harness();
    await h.run("draft_ad_plan", { character_id: CHAR, product_url: "http://solstad.coffee/products/oat-cold-brew/" });
    expect((h.calls.plan[0] as { productId: string }).productId).toBe(PRODUCT);
    const unknown = await h.run("draft_ad_plan", { character_id: CHAR, product_url: "https://elsewhere.example/p" });
    expect(unknown.content[0].text).toBe(PRODUCT_NOT_FOUND_BY_URL);

    const draft = harness({ products: [{ id: PRODUCT, user_id: USER, name: "Draft thing", status: "draft", source_url: null, image_paths: [], label_strings: [], deleted_at: null }] });
    const r = await draft.run("draft_ad_plan", { character_id: CHAR, product_id: PRODUCT });
    expect(r.structuredContent).toMatchObject({ next: "set_up_product", blocker: PRODUCT_NOT_CONFIRMED, plan_id: null });
    expect(nonceOf(r)).toBeNull();
    expect(draft.calls.plan).toEqual([]);
  });

  it("SECURITY: another account's product is not there", async () => {
    const h = harness({ products: [{ id: PRODUCT, user_id: OTHER, name: "Theirs", status: "confirmed", deleted_at: null }] });
    const r = await h.run("draft_ad_plan", { character_id: CHAR, product_id: PRODUCT });
    expect(r.isError).toBe(true);
    expect(h.calls.plan).toEqual([]);
  });

  it("import_product: a page read before returns its card without another read", async () => {
    const h = harness();
    const known = await h.run("import_product", { url: "https://solstad.coffee/products/oat-cold-brew" });
    expect(known.structuredContent).toMatchObject({ product: { id: PRODUCT, status: "confirmed" }, next: "ready" });
    expect(h.calls.importProduct).toEqual([]);
    const fresh = await h.run("import_product", { url: "https://new.example/p/1" });
    expect(fresh.structuredContent).toMatchObject({ product: { status: "draft", label_words_found: 2 }, next: "confirm_in_picacho" });
    expect(h.calls.importProduct).toHaveLength(1);
  });

  it("draft_post saves the networks, posts nothing, and hands back the press line", async () => {
    const h = harness({ state: view({ stage: "ready" }) });
    const r = await h.run("draft_post", { plan_id: PLAN, networks: ["tiktok", "x"] });
    expect(r.structuredContent).toMatchObject({ networks: ["x", "tiktok"], ready: true, press_line_url: `${ORIGIN}/app/press-tour?campaign=${PLAN}#press-line` });
    expect((r.structuredContent as { summary: string }).summary).toMatch(/^Nothing was posted\./);
    expect(h.tables.press_campaigns[0].platforms).toEqual(["x", "tiktok"]);
    const bad = await h.run("draft_post", { plan_id: PLAN, networks: ["myspace"] });
    expect(bad.isError).toBe(true);
  });

  it("get_ad_job for another account's ad is not there", async () => {
    const h = harness();
    const r = await h.run("get_ad_job", { plan_id: PLAN_B });
    expect(r.isError).toBe(true);
  });
});

describe("the ad card", () => {
  it("pictures are absolute, a shot without the product says so, and the worst product verdict leads", () => {
    const card = adCardFromView(view({ stage: "awaiting_approval", stills: [...PAINTED, still(4, { productExpected: false, imageUrl: "/api/media/x/4.png", face: "match" })] }), {
      origin: ORIGIN,
      charged: true,
      filmOpen: false,
      starName: "Eva",
      productName: "Solstad",
      posterFallback: null,
      repaintCredits: 1,
    });
    expect(card.stills[0].image_url).toBe(`${ORIGIN}/api/media/generated-images/u/1.png?v=s`);
    expect(card.stills[3].product).toBe("not_planned");
    expect(card.product_verdict).toBe("not_readable");
    expect(card.poster_url).toBe(card.stills[0].image_url);
    expect(card.next).toBe("decide");
  });

  it("once filmed, a shot waiting on the press wall is finished in Picacho", () => {
    const card = adCardFromView(view({ stage: "awaiting_approval", stills: PAINTED.map((s) => ({ ...s, decision: "approved" as const })), shots: [{ shot: 1 } as never] }), {
      origin: ORIGIN,
      charged: true,
      filmOpen: true,
      starName: null,
      productName: null,
      posterFallback: null,
      repaintCredits: 1,
    });
    expect(card.next).toBe("finish_in_picacho");
  });

  it("carries no lane, cost or raw score", () => {
    const card = adCardFromView(view({ stills: PAINTED }), { origin: ORIGIN, charged: true, filmOpen: false, starName: "Eva", productName: "S", posterFallback: null, repaintCredits: 1 });
    expect(JSON.stringify(card)).not.toMatch(/\b(lane|cost|cost_usd|usd|score|match_score)\b|kling|gpt|gemini|seedance/i);
  });
});

describe("the tool list and the card's template", () => {
  it("Press Tour's tools are listed only while press_tour_mcp is on", () => {
    const off = listedTools({ pressTour: false }).map((t) => t.name);
    expect(off.sort()).toEqual(["generate_image", "get_generation", "get_usage", "list_characters"]);
    const on = listedTools({ pressTour: true }).map((t) => t.name);
    expect(on).toEqual(expect.arrayContaining(["import_product", "get_brand_kit", "draft_ad_plan", "get_ad_job", "draft_post", "start_ad", "approve_stills", "poll_ad_job"]));
    expect(mcpInstructions({ pressTour: false })).toBe(MCP_INSTRUCTIONS);
    expect(mcpInstructions({ pressTour: true })).toContain(PRESS_TOUR_INSTRUCTIONS);
  });

  it("every tool: a title, all three hints, per-tool securitySchemes, a name of 64 characters or fewer", () => {
    for (const wire of listedTools({ pressTour: true }) as Record<string, unknown>[]) {
      const name = String(wire.name);
      expect(name.length, name).toBeLessThanOrEqual(64);
      expect(wire.title, name).toBeTruthy();
      const a = wire.annotations as Record<string, unknown>;
      for (const hint of ["readOnlyHint", "destructiveHint", "openWorldHint"]) expect(typeof a[hint], `${name} ${hint}`).toBe("boolean");
      expect(wire.securitySchemes, name).toEqual([{ type: "oauth2", scopes: [getMcpTool(name)!.scope] }]);
      expect((wire._meta as Record<string, unknown>).securitySchemes, name).toEqual(wire.securitySchemes);
      for (const k of ["scope", "spends", "pressTour", "visibility", "resourceUri", "invoking", "invoked"]) expect(wire, `${name} leaks ${k}`).not.toHaveProperty(k);
    }
  });

  it("the render tools name the versioned card; the card is an MCP App with no network access of its own", () => {
    expect(PRESS_WIDGET_URI).toMatch(/^ui:\/\/picacho\/press-tour\/ad-v\d+\.html$/);
    for (const name of ["draft_ad_plan", "get_ad_job"]) {
      const wire = wireTool(getMcpTool(name)!) as { _meta: { ui: { resourceUri: string } } };
      expect(wire._meta.ui.resourceUri).toBe(PRESS_WIDGET_URI);
    }
    const contents = (widgetResourceContents(ORIGIN) as { contents: { mimeType: string; text: string }[] }).contents[0];
    expect(contents.mimeType).toBe("text/html;profile=mcp-app");
    const meta = widgetMeta(ORIGIN) as { ui: { csp: { connectDomains: string[]; resourceDomains: string[] } } };
    expect(meta.ui.csp.connectDomains).toEqual([]);
    expect(meta.ui.csp.resourceDomains.every((d) => /^https:\/\/picacho\.(ai|io)$/.test(d))).toBe(true);
    const html = pressTourWidgetHtml();
    expect(html).not.toMatch(/<script[^>]+src=|<link[^>]+href=|@import|url\(\s*["']?https?:/i);
    expect(html).toContain("ui/initialize");
    expect(html).toContain("prefers-reduced-motion");
    expect(html).not.toContain("innerHTML");
  });

  it("no text sells, names a machine, or says locked — tools, instructions, messages, the card", () => {
    const press = [PRESS_TOUR_INSTRUCTIONS, ...MCP_TOOLS.filter((t) => t.pressTour).map((t) => t.description), ...PRESS_MCP_MESSAGES, ...Object.values(WIDGET_TEXT_EN)];
    for (const text of [MCP_INSTRUCTIONS, ...MCP_TOOLS.map((t) => t.description), ...press]) {
      expect(text, text).not.toMatch(/upgrade|pick a plan|top up|elite|pricing|checkout|subscribe|\$\d|€\d/i);
    }
    for (const text of press) {
      expect(text, text).not.toMatch(/\blocked\b|\bkling|\bgpt|gemini|seedance|\bfal\b|720p|1080|server/i);
    }
    // And never an invitation to call a paid tool again on a verdict.
    for (const t of MCP_TOOLS) expect(t.description).not.toMatch(/low score|re-?roll|call again/i);
  });
});

describe("the card in four languages (2026-09-26)", () => {
  it("has the same keys and the same slots in every table, each translated but the name", async () => {
    const { WIDGET_TEXTS } = await import("./widget-text");
    const keys = Object.keys(WIDGET_TEXT_EN);
    const slots = (s: string) => (s.match(/\{\w+\}/g) ?? []).sort();
    expect(Object.keys(WIDGET_TEXTS).sort()).toEqual(["en", "es", "it", "pt"]);
    for (const lang of ["es", "pt", "it"]) {
      const table = WIDGET_TEXTS[lang] as Record<string, string>;
      expect(Object.keys(table), lang).toEqual(keys);
      for (const k of keys) {
        const en = (WIDGET_TEXT_EN as Record<string, string>)[k];
        expect(slots(table[k]), `${lang}.${k}`).toEqual(slots(en));
        // Only the name, the credit mark, and a word that is the same in the language stay English.
        const same = ["marquee", "cr", ...(lang === "it" ? ["factStar"] : [])];
        if (!same.includes(k)) expect(table[k], `${lang}.${k}`).not.toBe(en);
      }
      expect(table.marquee).toBe("Press Tour");
    }
  });
});
