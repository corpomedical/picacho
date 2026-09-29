import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";
import type { CampaignResult, CampaignView } from "../press-tour/campaign-types";
import { pickByName, planPressAd, producerPlanSendId, readPressAds, type PressToolDeps } from "./press-tools";
import { PRODUCER_TOOLS, TOOL_NAMES } from "./tools";

type Row = Record<string, unknown>;

function fakeDb(tables: Record<string, Row[]>): SupabaseClient {
  return {
    from(table: string) {
      const preds: ((r: Row) => boolean)[] = [];
      let limit = Infinity;
      const builder = {
        select: () => builder,
        eq(col: string, v: unknown) {
          preds.push((r) => r[col] === v);
          return builder;
        },
        is(col: string, v: unknown) {
          preds.push((r) => (r[col] ?? null) === v);
          return builder;
        },
        in(col: string, vs: unknown[]) {
          preds.push((r) => vs.includes(r[col]));
          return builder;
        },
        order: () => builder,
        limit(n: number) {
          limit = n;
          return builder;
        },
        then(resolve: (v: unknown) => void) {
          resolve({ data: (tables[table] ?? []).filter((r) => preds.every((p) => p(r))).slice(0, limit), error: null });
        },
      };
      return builder;
    },
  } as unknown as SupabaseClient;
}

const ME = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";
const tables = () => ({
  character_profiles: [
    { id: "c-eva", user_id: ME, name: "Eva" },
    { id: "c-max", user_id: ME, name: "Max" },
    { id: "c-x", user_id: OTHER, name: "Zed" },
  ],
  products: [
    { id: "p-hoodie", user_id: ME, name: "Climax hoodie", status: "confirmed", category: "apparel", image_paths: ["a.jpg"], deleted_at: null },
    { id: "p-gone", user_id: ME, name: "Old tote", status: "confirmed", category: "apparel", image_paths: [], deleted_at: null },
    { id: "p-draft", user_id: ME, name: "Mug", status: "draft", category: "homeware", image_paths: ["m.jpg"], deleted_at: null },
  ],
  press_campaigns: [
    { id: "ad-1", user_id: ME, stage: "failed", product_id: "p-hoodie", length_seconds: 15, error: "The picture service we use blocked one of your stills.", updated_at: "2026-09-26T23:20:00Z", deleted_at: null },
    { id: "ad-2", user_id: OTHER, stage: "ready", product_id: "p-x", length_seconds: 15, error: null, updated_at: "2026-09-27T10:00:00Z", deleted_at: null },
  ],
});

function planned(over: Partial<CampaignView> = {}): CampaignResult {
  return {
    ok: true,
    campaign: {
      id: "ad-new",
      stage: "planned",
      lengthSeconds: 15,
      angle: "Late-night confidence",
      stills: [{}, {}, {}],
      quote: { paint: 3 },
      ...over,
    } as unknown as CampaignView,
  };
}

const open = (db: SupabaseClient, plan = vi.fn(async () => planned())): PressToolDeps & { plan: typeof plan } => ({
  db,
  closed: null,
  plan,
  now: () => new Date("2026-09-28T12:00:00Z"),
});

describe("the Producer's Press Tour tools", () => {
  it("are in the static tool list, strict, and never spend (plan only)", () => {
    const names = PRODUCER_TOOLS.map((t) => t.name);
    expect(names).toContain(TOOL_NAMES.planAd);
    expect(names).toContain(TOOL_NAMES.readAds);
    const plan = PRODUCER_TOOLS.find((t) => t.name === TOOL_NAMES.planAd)!;
    expect("description" in plan && plan.description).toMatch(/nothing is painted or charged/i);
  });

  it("plans through the engine with the person's own star and ready product, and hands a card with the stills' price", async () => {
    const deps = open(fakeDb(tables()));
    const out = await planPressAd(deps, ME, { character: "eva", product: "hoodie", length_seconds: 15, goal: "Launch week" });
    expect(out.isError).toBeUndefined();
    expect(deps.plan).toHaveBeenCalledWith({
      sendId: producerPlanSendId(ME, "p-hoodie:c-eva:15:Launch week:2026-09-28"),
      productId: "p-hoodie",
      characterId: "c-eva",
      lengthSeconds: 15,
      goal: "Launch week",
    });
    expect(out.card).toMatchObject({ kind: "ad", credits: 3, characterName: "Eva", href: "/app/press-tour?campaign=ad-new", seconds: 15 });
    expect(out.text).toMatch(/Nothing is painted or charged/);
    expect(out.text).toMatch(/presses Paint on the Press Tour page themselves/);
  });

  it("plans on Gemini only when the person asked for it; GPT Image otherwise (operator, 2026-09-29)", async () => {
    const deps = open(fakeDb(tables()));
    await planPressAd(deps, ME, { character: "eva", product: "hoodie", length_seconds: 15, goal: null, still_engine: "gemini" });
    expect(deps.plan).toHaveBeenLastCalledWith(expect.objectContaining({ engine: "gemini", sendId: producerPlanSendId(ME, "p-hoodie:c-eva:15::2026-09-28:gemini") }));
    await planPressAd(deps, ME, { character: "eva", product: "hoodie", length_seconds: 15, goal: null, still_engine: null });
    expect((deps.plan as unknown as { mock: { calls: { engine?: string }[][] } }).mock.calls.at(-1)![0].engine).toBeUndefined();
  });

  it("the same choices on the same day meet the same ad (one send id)", () => {
    expect(producerPlanSendId(ME, "a")).toBe(producerPlanSendId(ME, "a"));
    expect(producerPlanSendId(ME, "a")).not.toBe(producerPlanSendId(OTHER, "a"));
    expect(producerPlanSendId(ME, "a")).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-8[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });

  it("closed to the person: says so and never plans", async () => {
    const plan = vi.fn(async () => planned());
    const out = await planPressAd({ db: fakeDb(tables()), closed: "Press Tour isn't open yet.", plan: null }, ME, {});
    expect(out.isError).toBe(true);
    expect(plan).not.toHaveBeenCalled();
    expect((await readPressAds({ db: fakeDb(tables()), closed: "Press Tour isn't open yet.", plan: null }, ME, {})).isError).toBe(true);
  });

  it("a name that matches nothing lists what they have; a product with no photos or not confirmed is not offered; someone else's never", async () => {
    const deps = open(fakeDb(tables()));
    const noStar = await planPressAd(deps, ME, { character: "Zed", product: null, length_seconds: null, goal: null });
    expect(noStar).toMatchObject({ isError: true });
    expect(noStar.text).toContain("Eva, Max");
    expect(noStar.text).not.toContain("Zed");
    const noProduct = await planPressAd(deps, ME, { character: "Eva", product: "tote", length_seconds: null, goal: null });
    expect(noProduct.text).toContain("Climax hoodie");
    expect(noProduct.text).not.toMatch(/Old tote|Mug/);
    expect(deps.plan).not.toHaveBeenCalled();
  });

  it("an engine refusal comes back in its own words", async () => {
    const deps = open(fakeDb(tables()), vi.fn(async (): Promise<CampaignResult> => ({ ok: false, error: "That's all the ads you can plan today." })));
    expect(await planPressAd(deps, ME, { character: null, product: null, length_seconds: 30, goal: null })).toMatchObject({
      isError: true,
      text: expect.stringContaining("all the ads you can plan today"),
    });
  });

  it("reads the person's own ads, where each stands and why one stopped", async () => {
    const out = await readPressAds(open(fakeDb(tables())), ME, { limit: null });
    expect(out.text).toContain("Climax hoodie, 15 s · stopped.");
    expect(out.text).toContain("Why: The picture service we use blocked");
    expect(out.text).toContain("/app/press-tour?campaign=ad-1");
    expect(out.text).not.toContain("ad-2");
  });

  it("picks names exactly first, then one partial match, never a guess between two", () => {
    const rows = [
      { id: "1", name: "Eva" },
      { id: "2", name: "Eva Night" },
      { id: "3", name: "Max" },
    ];
    expect(pickByName(rows, "eva")?.id).toBe("1");
    expect(pickByName(rows, "night")?.id).toBe("2");
    expect(pickByName(rows, "a")).toBeNull();
    expect(pickByName(rows, null)?.id).toBe("1");
  });
});
