import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { FRAME_CHECK_COLUMNS } from "../product-lock/records";
import { CAMPAIGN_STAGES, type Verdict } from "./campaign-types";
import { BLOCK_CHECKING, BLOCK_FILMING_NOT_OPEN, BLOCK_PAINTING, BLOCK_PLANNING, CAMPAIGN_EXPIRED, PAINT_FAILED, PLAN_STALLED, STILL_REFUSED, blockDecide } from "./campaign-messages";
import { CHARACTER_A, PRODUCT_A, USER_A, fakeDb, type Row } from "./campaign-fixtures";
import {
  CAMPAIGN_TRANSITIONS,
  LEASE_MS,
  MAX_ATTEMPTS_PER_STILL,
  OVERDUE_MS,
  TERMINAL_STAGES,
  WAIT_MS,
  WORKING_STAGES,
  betterAttempt,
  blockerFor,
  campaignRowFrom,
  campaignView,
  canMove,
  derivedUuid,
  driveCampaign,
  stillRowId,
  houseRepaintDue,
  houseRowId,
  initialStills,
  kickBudgetMs,
  paidRetryRowId,
  mutateCampaign,
  parseStills,
  pressCampaignId,
  pressTick,
  readCampaign,
  repaintRowId,
  stepCampaign,
  stepOnce,
  withDecision,
  withOutcome,
  withReserved,
  type MachineDeps,
  type PaintOutcome,
  type StillAttempt,
  type StillState,
} from "./campaign-machine";
import { normaliseAdPlan, type AdPlan } from "./planner";

// The stage machine (spec §1.12 up to awaiting_approval in Cut 2): the
// stage list pinned to press-tour-03-campaigns.sql, the ids made from a
// press, the stills' pure transforms, the projection, and the machine's
// steps against an in-memory database.

const repo = join(__dirname, "..", "..", "..");
function findSql(name: string): string {
  const root = join(repo, "supabase");
  const candidates = [join(root, "pending", name), ...readdirSync(join(root, "applied")).map((d) => join(root, "applied", d, name))];
  const found = candidates.find((p) => existsSync(p));
  if (!found) throw new Error(`${name} is in neither supabase/pending nor supabase/applied/<date>`);
  return readFileSync(found, "utf8");
}
const sql = findSql("press-tour-03-campaigns.sql");

const NOW = new Date("2026-09-26T10:00:00.000Z");
const SEND = "77777777-7777-4777-8777-777777777777";
const iso = NOW.toISOString();

function plan(length: 10 | 15 | 30 = 15): AdPlan {
  const n = length === 10 ? 2 : length === 15 ? 3 : 6;
  return normaliseAdPlan(
    {
      angle: "Morning ritual",
      cta: "Try it",
      shots: Array.from({ length: n }, (_, i) => ({ still: `Still ${i + 1}: she holds the can.`, product_visibility: "required_label" })),
    },
    { length },
  )!;
}

const painted = (over: Partial<Extract<PaintOutcome, { kind: "painted" }>> = {}): PaintOutcome => ({
  kind: "painted",
  path: `${USER_A}/press/x/still.png`,
  face: "match",
  product: "match",
  reason: null,
  fits: true,
  faceScore: 88,
  escalations: 0,
  usd: 0.09,
  ...over,
});

function attempt(over: Partial<StillAttempt> = {}): StillAttempt {
  return {
    n: 1,
    rowId: derivedUuid(`row-${Math.random()}`),
    kind: "paint",
    status: "painted",
    credits: 1,
    path: `${USER_A}/press/c/1.png`,
    face: "match",
    product: "match",
    reason: null,
    fits: true,
    faceScore: 80,
    escalations: 0,
    note: null,
    at: iso,
    doneAt: iso,
    error: null,
    ...over,
  };
}

function campaignRow(over: Row = {}): Row {
  const p = (over.plan as AdPlan | undefined) ?? plan();
  return {
    id: pressCampaignId(SEND),
    user_id: USER_A,
    source: "door",
    send_id: SEND,
    product_id: PRODUCT_A,
    brand_kit_id: null,
    character_ids: [CHARACTER_A],
    trial_id: null,
    mcp_grant_id: null,
    length_s: 15,
    aspect: "9:16",
    goal: null,
    plan: p,
    quote: null,
    stills: initialStills(p),
    stage: "planned",
    stage_changed_at: iso,
    locked_at: null,
    attempts: 0,
    version: 0,
    keyframe_ids: [],
    cost_usd: 0,
    credits_charged: 0,
    credits_refunded: 0,
    error: null,
    expires_at: null,
    overdue_notified_at: null,
    created_at: iso,
    updated_at: iso,
    deleted_at: null,
    ...over,
  };
}

/** A campaign mid-paint: every still reserved at attempt 1, its row in generations. */
function painting(db: ReturnType<typeof fakeDb>, over: Row = {}) {
  const p = plan();
  let stills = initialStills(p);
  for (const s of p.shots) {
    const rowId = stillRowId(SEND, s.shot);
    stills = withReserved(stills, s.shot, { rowId, kind: "paint", credits: 1 }, iso)!;
    db.tables.generations.push({ id: rowId, user_id: USER_A, status: "generating", credits_used: 1, created_at: iso });
  }
  const row = campaignRow({ plan: p, stills, stage: "painting", ...over });
  db.tables.press_campaigns.push(row);
  return row;
}

function machine(db: ReturnType<typeof fakeDb>, over: Partial<MachineDeps> = {}): MachineDeps & { released: string[]; notified: string[] } {
  const released: string[] = [];
  const notified: string[] = [];
  return {
    released,
    notified,
    db: db.db,
    paint: vi.fn(async () => painted()),
    reserveHouse: vi.fn(async ({ rowId }) => {
      db.tables.generations.push({ id: rowId, user_id: USER_A, status: "generating", credits_used: 0, created_at: iso });
      return true;
    }),
    reservePaid: vi.fn(async ({ rowId, credits }) => {
      db.tables.generations.push({ id: rowId, user_id: USER_A, status: "generating", credits_used: credits, created_at: iso });
      return "reserved" as const;
    }),
    releaseRow: vi.fn(async ({ rowId, credits }) => {
      released.push(rowId);
      return credits > 0;
    }),
    faceGateOn: vi.fn(async () => true),
    notifyAdmins: vi.fn(async (m) => {
      notified.push(m.body);
    }),
    now: () => db.clock.now,
    ...over,
  };
}

// ---------------------------------------------------------------------------

describe("the stages, pinned to press-tour-03-campaigns.sql", () => {
  it("the SQL's stage check lists exactly CAMPAIGN_STAGES", () => {
    const check = sql.slice(sql.indexOf("constraint press_campaigns_stage check (stage in ("), sql.indexOf("constraint press_campaigns_aspect"));
    const listed = [...check.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);
    expect(listed).toEqual([...CAMPAIGN_STAGES]);
  });

  it("claim_press_campaigns claims exactly the working stages, with a 6-minute lease, FOR UPDATE SKIP LOCKED", () => {
    const fn = sql.slice(sql.indexOf("create or replace function public.claim_press_campaigns("), sql.indexOf("revoke all on function public.claim_press_campaigns"));
    const stages = fn.slice(fn.indexOf("d.stage in ("), fn.indexOf(")", fn.indexOf("d.stage in (")));
    expect([...stages.matchAll(/'([a-z_]+)'/g)].map((m) => m[1])).toEqual([...WORKING_STAGES]);
    expect(fn).toContain("interval '6 minutes'");
    expect(LEASE_MS).toBe(6 * 60_000);
    expect(fn).toMatch(/for update skip locked/i);
    expect(fn).toMatch(/security definer/i);
    expect(sql).toContain("revoke all on function public.claim_press_campaigns(integer, uuid) from public, anon, authenticated;");
    expect(sql).toContain("grant execute on function public.claim_press_campaigns(integer, uuid) to service_role;");
  });

  it("every new generations column is nullable (reserve_generation inserts VALUES (rec.*))", () => {
    const adds = [...sql.matchAll(/alter table public\.generations add column if not exists (\w+) ([^;]+);/g)];
    expect(adds.map((m) => m[1]).sort()).toEqual(["press_tour", "product_gated_at", "product_retries", "product_verdict"]);
    for (const m of adds) expect(m[2]).not.toMatch(/not null|default/i);
  });

  it("press_campaigns and product_frame_checks: RLS on and no policy at all", () => {
    for (const t of ["press_campaigns", "product_frame_checks", "character_ad_consents"]) {
      expect(sql).toContain(`alter table public.${t} enable row level security;`);
      expect(sql).toContain(`revoke all on public.${t} from public, anon, authenticated;`);
    }
    expect(sql).not.toMatch(/create policy[^;]+on public\.press_campaigns/i);
    expect(sql).not.toMatch(/create policy[^;]+on public\.product_frame_checks/i);
  });

  it("product_frame_checks holds exactly the columns the checker writes (product-lock/records.ts)", () => {
    const body = sql.slice(sql.indexOf("create table if not exists public.product_frame_checks ("), sql.indexOf("create index if not exists product_frame_checks_created"));
    const cols = [...body.matchAll(/^ {2}([a-z_]+)\s/gm)].map((m) => m[1]).filter((c) => c !== "constraint");
    expect(cols.sort()).toEqual([...FRAME_CHECK_COLUMNS, "id", "created_at", "label", "labelled_by", "labelled_at"].sort());
  });

  it("every stage has its moves; closed stages have none", () => {
    for (const s of CAMPAIGN_STAGES) expect(CAMPAIGN_TRANSITIONS[s]).toBeDefined();
    for (const s of TERMINAL_STAGES) expect(CAMPAIGN_TRANSITIONS[s]).toEqual([]);
    expect(canMove("planned", "painting")).toBe(true);
    expect(canMove("painting", "checking_keyframes")).toBe(true);
    expect(canMove("checking_keyframes", "awaiting_approval")).toBe(true);
    expect(canMove("awaiting_approval", "painting")).toBe(true);
    expect(canMove("planned", "awaiting_approval")).toBe(false);
    expect(canMove("cancelled", "planned")).toBe(false);
    expect(canMove("expired", "painting")).toBe(false);
  });

  it("the test database is test-only: nothing in the app imports it", () => {
    const src = join(repo, "src");
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const e of readdirSync(dir, { withFileTypes: true })) {
        const p = join(dir, e.name);
        if (e.isDirectory()) walk(p);
        else if (/\.(ts|tsx)$/.test(e.name) && !/\.test\.tsx?$/.test(e.name) && readFileSync(p, "utf8").includes("campaign-fixtures")) offenders.push(p);
      }
    };
    walk(src);
    expect(offenders.filter((p) => !p.endsWith("campaign-fixtures.ts"))).toEqual([]);
  });
});

describe("ids made from a press", () => {
  it("the same press gives the same id; any other gives another", () => {
    expect(pressCampaignId(SEND)).toBe(pressCampaignId(SEND.toUpperCase()));
    expect(pressCampaignId(SEND)).not.toBe(SEND);
    const ids = [
      stillRowId(SEND, 1),
      stillRowId(SEND, 2),
      repaintRowId(SEND),
      houseRowId(pressCampaignId(SEND), 1, "house", 2),
      houseRowId(pressCampaignId(SEND), 1, "retry", 2),
    ];
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-8[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });
});

describe("the stills", () => {
  const p = plan();

  it("a reserved attempt: never beside another in flight, never a repeated row, never past the bound", () => {
    let stills = initialStills(p);
    stills = withReserved(stills, 1, { rowId: stillRowId(SEND, 1), kind: "paint", credits: 1 }, iso)!;
    expect(stills[0].attempts).toHaveLength(1);
    expect(withReserved(stills, 1, { rowId: repaintRowId(SEND), kind: "repaint", credits: 1 }, iso)).toBeNull();
    expect(withReserved(stills, 9, { rowId: repaintRowId(SEND), kind: "repaint", credits: 1 }, iso)).toBeNull();
    const full: StillState[] = [{ shot: 1, attempts: Array.from({ length: MAX_ATTEMPTS_PER_STILL }, (_, i) => attempt({ n: i + 1 })), keep: 1, decision: "pending" }];
    expect(withReserved(full, 1, { rowId: repaintRowId(SEND), kind: "repaint", credits: 1 }, iso)).toBeNull();
    const done: StillState[] = [{ shot: 1, attempts: [attempt({ rowId: stillRowId(SEND, 1) })], keep: 1, decision: "pending" }];
    expect(withReserved(done, 1, { rowId: stillRowId(SEND, 1), kind: "repaint", credits: 1 }, iso)).toBeNull();
  });

  it("a painting becomes the one shown and waits for a decision; a second write of it is a no-op", () => {
    let stills: StillState[] = [{ shot: 1, attempts: [attempt()], keep: 1, decision: "approved" }];
    stills = withReserved(stills, 1, { rowId: repaintRowId(SEND), kind: "repaint", credits: 1 }, iso)!;
    stills = withOutcome(stills, 1, 2, painted({ product: "not_readable" }), iso);
    expect(stills[0]).toMatchObject({ keep: 2, decision: "pending" });
    const again = withOutcome(stills, 1, 2, painted({ product: "didnt_match" }), iso);
    expect(again[0].attempts[1].product).toBe("not_readable");
  });

  it("the house's repaint keeps the better of the two", () => {
    const miss = attempt({ product: "didnt_match" });
    let stills: StillState[] = [{ shot: 1, attempts: [miss], keep: 1, decision: "pending" }];
    stills = withReserved(stills, 1, { rowId: houseRowId("c", 1, "house", 2), kind: "house", credits: 0 }, iso)!;
    const worse = withOutcome(stills, 1, 2, painted({ product: "didnt_match", faceScore: 40 }), iso);
    expect(worse[0].keep).toBe(1);
    const better = withOutcome(stills, 1, 2, painted({ product: "match" }), iso);
    expect(better[0].keep).toBe(2);
  });

  it("a failed attempt records whether its credits went back", () => {
    let stills = initialStills(p);
    stills = withReserved(stills, 1, { rowId: stillRowId(SEND, 1), kind: "paint", credits: 1 }, iso)!;
    const failed = withOutcome(stills, 1, 1, { kind: "failed", cause: "provider", error: "x", usd: 0, refunded: true }, iso);
    expect(failed[0].attempts[0]).toMatchObject({ status: "failed", credits: 0 });
    expect(failed[0].keep).toBeNull();
  });

  it("the checker repaints a still once, on a product miss, a lost crop, or (gate on) a face miss; never on not readable", () => {
    const one = (a: Partial<StillAttempt>): StillState[] => [{ shot: 1, attempts: [attempt(a)], keep: 1, decision: "pending" }];
    expect(houseRepaintDue(one({ product: "didnt_match" }), true)).toBe(1);
    expect(houseRepaintDue(one({ product: "product_missing" }), false)).toBe(1);
    expect(houseRepaintDue(one({ fits: false }), false)).toBe(1);
    expect(houseRepaintDue(one({ face: "didnt_match" }), true)).toBe(1);
    expect(houseRepaintDue(one({ face: "didnt_match" }), false)).toBeNull();
    expect(houseRepaintDue(one({ product: "not_readable" }), true)).toBeNull();
    expect(houseRepaintDue(one({ product: "not_checked", face: "not_readable" }), true)).toBeNull();
    const after: StillState[] = [{ shot: 1, attempts: [attempt({ product: "didnt_match" }), attempt({ n: 2, kind: "house", product: "didnt_match" })], keep: 2, decision: "pending" }];
    expect(houseRepaintDue(after, true)).toBeNull();
    const repainted: StillState[] = [{ shot: 1, attempts: [attempt({ product: "match" }), attempt({ n: 2, kind: "repaint", product: "didnt_match" })], keep: 2, decision: "pending" }];
    expect(houseRepaintDue(repainted, true)).toBeNull();
  });

  it("the better attempt: the worse check first, then the product, the face, the score", () => {
    expect(betterAttempt(attempt({ n: 1, product: "match", face: "didnt_match" }), attempt({ n: 2, product: "not_readable", face: "match" })).n).toBe(2);
    expect(betterAttempt(attempt({ n: 1, product: "match", faceScore: 90 }), attempt({ n: 2, product: "match", faceScore: 70 })).n).toBe(1);
    expect(betterAttempt(attempt({ n: 1 }), attempt({ n: 2 })).n).toBe(2);
  });

  it("decisions: only on a painted still that is not being repainted", () => {
    const stills: StillState[] = [
      { shot: 1, attempts: [attempt()], keep: 1, decision: "pending" },
      { shot: 2, attempts: [attempt({ status: "reserved", path: null })], keep: null, decision: "pending" },
      { shot: 3, attempts: [], keep: null, decision: "pending" },
    ];
    const approved = withDecision(stills, 1, "approve");
    expect(approved.ok && approved.stills[0].decision).toBe("approved");
    expect(withDecision(stills, 2, "keep")).toEqual({ ok: false, reason: "busy" });
    expect(withDecision(stills, 3, "keep")).toEqual({ ok: false, reason: "notReady" });
    expect(withDecision(stills, 4, "keep")).toEqual({ ok: false, reason: "shot" });
    const undone = withDecision((approved as { stills: StillState[] }).stills, 1, "undo");
    expect(undone.ok && undone.stills[0].decision).toBe("pending");
  });

  it("stored stills are read defensively", () => {
    expect(parseStills("junk", 3).map((s) => s.shot)).toEqual([1, 2, 3]);
    const read = parseStills([{ shot: 1, keep: 5, decision: "approved", attempts: [{ n: 1, rowId: "nope" }, attempt()] }], 1);
    expect(read[0].attempts).toHaveLength(1);
    // A keep that names no painted attempt shows nothing, and so decides nothing.
    expect(read[0]).toMatchObject({ keep: null, decision: "pending" });
  });
});

describe("what the door is shown", () => {
  it("blockers say what the next step waits on", () => {
    const stills: StillState[] = [
      { shot: 1, attempts: [attempt()], keep: 1, decision: "approved" },
      { shot: 2, attempts: [attempt()], keep: 1, decision: "pending" },
    ];
    expect(blockerFor({ stage: "draft", stills: [] })).toBe(BLOCK_PLANNING);
    expect(blockerFor({ stage: "painting", stills })).toBe(BLOCK_PAINTING);
    expect(blockerFor({ stage: "checking_keyframes", stills })).toBe(BLOCK_CHECKING);
    expect(blockerFor({ stage: "awaiting_approval", stills })).toBe(blockDecide(2));
    expect(blockDecide(3)).toBe("Decide on shot 3 to film");
    expect(blockerFor({ stage: "awaiting_approval", stills: stills.map((s) => ({ ...s, decision: "kept" as const })) })).toBe(BLOCK_FILMING_NOT_OPEN);
    expect(blockerFor({ stage: "failed", stills })).toBeNull();
  });

  it("the projection carries no row id, path, lane, cost or score", () => {
    const p = plan();
    const stills: StillState[] = [
      { shot: 1, attempts: [attempt({ product: "didnt_match", reason: "The words on the label came out different." }), attempt({ n: 2, kind: "house", product: "match" })], keep: 2, decision: "pending" },
      { shot: 2, attempts: [attempt(), attempt({ n: 2, kind: "repaint", status: "reserved", path: null })], keep: 1, decision: "pending" },
      { shot: 3, attempts: [], keep: null, decision: "pending" },
    ];
    const row = campaignRowFrom(campaignRow({ plan: p, stills, stage: "awaiting_approval", cost_usd: 0.42 }))!;
    const view = campaignView(row, { imageUrl: (path) => `/api/media/generated-images/${path}?v=sig` });
    expect(view.stills[0]).toMatchObject({ shot: 1, role: "hook", span: [0, 5], face: "match", product: "match", houseRepainted: true, repaints: 0 });
    expect(view.stills[0].imageUrl).toContain("/api/media/");
    // Being repainted: no picture, not checked, still counted.
    expect(view.stills[1]).toMatchObject({ imageUrl: null, product: "not_checked", repaints: 1 });
    expect(view.stills[2]).toMatchObject({ imageUrl: null, decision: "pending" });
    const text = JSON.stringify(view);
    for (const leak of ["rowId", "faceScore", "0.42", "gpt-image", "kling", stillRowId(SEND, 1)]) expect(text).not.toContain(leak);
    expect(view.aspect).toBe("9:16");
  });

  it("a shot planned without the product says so: its product check does not apply (PT-01)", () => {
    const p = normaliseAdPlan(
      {
        angle: "Morning ritual",
        shots: [
          { still: "Eva at the wheel at dawn.", product_visibility: "absent" },
          { still: "The can to camera." },
          { still: "Eva lifts the can." },
        ],
      },
      { length: 15 },
    )!;
    expect(p.shots.map((x) => x.productVisibility)).toEqual(["absent", "required_label", "required_shape"]);
    const stills: StillState[] = [
      { shot: 1, attempts: [attempt({ product: "not_checked" })], keep: 1, decision: "pending" },
      { shot: 2, attempts: [attempt()], keep: 1, decision: "pending" },
      { shot: 3, attempts: [attempt()], keep: 1, decision: "pending" },
    ];
    const view = campaignView(campaignRowFrom(campaignRow({ plan: p, stills, stage: "awaiting_approval" }))!, { imageUrl: () => "https://x/s.png" });
    expect(view.stills.map((x) => x.productExpected)).toEqual([false, true, true]);
    expect(view.stills[0]).toMatchObject({ product: "not_checked", reason: null });
    // It is not a miss: the house never repaints it for its product.
    expect(houseRepaintDue(stills, true)).toBeNull();
  });

  it("an expired campaign says why", () => {
    const row = campaignRowFrom(campaignRow({ stage: "expired", error: null }))!;
    expect(campaignView(row, { imageUrl: () => null }).error).toBe(CAMPAIGN_EXPIRED);
  });
});

describe("optimistic writes", () => {
  it("a write that loses the race reads again and keeps both changes", async () => {
    const db = fakeDb({}, { now: NOW });
    const row = campaignRow({ stage: "awaiting_approval", stills: [{ shot: 1, attempts: [attempt()], keep: 1, decision: "pending" }, { shot: 2, attempts: [attempt()], keep: 1, decision: "pending" }, { shot: 3, attempts: [attempt()], keep: 1, decision: "pending" }] });
    db.tables.press_campaigns.push(row);
    let raced = false;
    const result = await mutateCampaign(db.db, String(row.id), USER_A, (fresh) => {
      if (!raced) {
        raced = true;
        // Someone else approves shot 2 between this read and this write.
        const stored = db.tables.press_campaigns[0];
        stored.stills = (stored.stills as StillState[]).map((s) => (s.shot === 2 ? { ...s, decision: "approved" } : s));
        stored.version = Number(stored.version) + 1;
      }
      const next = withDecision(fresh.stills, 1, "approve");
      return next.ok ? { patch: { stills: next.stills }, value: null } : { refuse: null };
    });
    expect(result.ok).toBe(true);
    const stored = (await readCampaign(db.db, String(row.id), USER_A)) as ReturnType<typeof campaignRowFrom>;
    expect(stored!.stills.map((s) => s.decision)).toEqual(["approved", "approved", "pending"]);
  });

  it("the owner filter holds: another person's campaign is not there", async () => {
    const db = fakeDb({}, { now: NOW });
    db.tables.press_campaigns.push(campaignRow());
    expect(await readCampaign(db.db, pressCampaignId(SEND), "22222222-2222-4222-8222-222222222222")).toBeNull();
  });
});

describe("the machine", () => {
  it("paints one reserved still per step, writes it down, then moves to the checks", async () => {
    const db = fakeDb({}, { now: NOW });
    const row = painting(db);
    const deps = machine(db);
    for (let i = 0; i < 3; i++) expect(await stepCampaign(deps, String(row.id))).toBe("painted");
    expect(deps.paint).toHaveBeenCalledTimes(3);
    expect((deps.paint as ReturnType<typeof vi.fn>).mock.calls.map((c) => c[0].shot)).toEqual([1, 2, 3]);
    expect(await stepCampaign(deps, String(row.id))).toBe("checked");
    const after = campaignRowFrom(db.tables.press_campaigns[0])!;
    expect(after.stage).toBe("checking_keyframes");
    expect(after.keyframeIds).toEqual([1, 2, 3].map((s) => stillRowId(SEND, s)));
    expect(after.costUsd).toBeCloseTo(0.27, 5);
    // Every still checked and fine: straight to the person, with 7 days to decide.
    expect(await stepCampaign(deps, String(row.id))).toBe("waiting");
    const waiting = campaignRowFrom(db.tables.press_campaigns[0])!;
    expect(waiting.stage).toBe("awaiting_approval");
    expect(new Date(waiting.expiresAt!).getTime() - NOW.getTime()).toBe(WAIT_MS);
  });

  it("a still the checker found wrong is repainted once on the house, and the better one is kept", async () => {
    const db = fakeDb({}, { now: NOW });
    const row = painting(db);
    const outcomes: PaintOutcome[] = [painted(), painted({ product: "didnt_match" }), painted(), painted({ product: "match" })];
    const deps = machine(db, { paint: vi.fn(async () => outcomes.shift()!) });
    const steps = await driveCampaign(deps, String(row.id), { budgetMs: 60_000 });
    expect(steps).toEqual(["painted", "painted", "painted", "checked", "repainting", "painted", "checked", "waiting"]);
    const after = campaignRowFrom(db.tables.press_campaigns[0])!;
    expect(after.stage).toBe("awaiting_approval");
    const shot2 = after.stills[1];
    expect(shot2.attempts.map((a) => [a.kind, a.credits])).toEqual([
      ["paint", 1],
      ["house", 0],
    ]);
    expect(shot2.keep).toBe(2);
    // The house row was reserved at 0 credits, under its own id.
    expect(deps.reserveHouse).toHaveBeenCalledWith(expect.objectContaining({ shot: 2, kind: "house", rowId: houseRowId(String(row.id), 2, "house", 2) }));
  });

  it("with the identity gate off, a face miss is shown, not repainted", async () => {
    const db = fakeDb({}, { now: NOW });
    const row = painting(db);
    const deps = machine(db, { paint: vi.fn(async () => painted({ face: "didnt_match" })), faceGateOn: vi.fn(async () => false) });
    const steps = await driveCampaign(deps, String(row.id), { budgetMs: 60_000 });
    expect(steps.at(-1)).toBe("waiting");
    expect(deps.reserveHouse).not.toHaveBeenCalled();
  });

  // M1 / v2 #11: a still delivered after a provider failure costs the person
  // exactly its price, once: charged - refunded, per delivered still, is 1.
  const netPerStill = (db: ReturnType<typeof fakeDb>) => {
    const c = campaignRowFrom(db.tables.press_campaigns[0])!;
    const delivered = c.stills.filter((st) => st.attempts.some((a) => a.status === "painted")).length;
    return { net: c.creditsCharged - c.creditsRefunded, delivered, row: c };
  };

  it("a failed still whose charge went back is retried AT ITS PRICE: the delivered still nets exactly 1 credit (M1)", async () => {
    const db = fakeDb({}, { now: NOW });
    const row = painting(db, { credits_charged: 3 });
    const outcomes: PaintOutcome[] = [{ kind: "failed", cause: "provider", error: "lane timed out", usd: 0, refunded: true }, painted(), painted(), painted()];
    const deps = machine(db, { paint: vi.fn(async () => outcomes.shift()!) });
    expect(await stepCampaign(deps, String(row.id))).toBe("retrying");
    const now = campaignRowFrom(db.tables.press_campaigns[0])!;
    expect(now.stills[0].attempts.map((a) => [a.kind, a.status, a.credits])).toEqual([
      ["paint", "failed", 0],
      ["retry", "reserved", 1],
    ]);
    // A paid retry, under an id made from the failed row, in its billing window; no house row.
    expect(deps.reservePaid).toHaveBeenCalledWith(
      expect.objectContaining({ shot: 1, rowId: paidRetryRowId(stillRowId(SEND, 1)), credits: 1, failedReservedAt: iso }),
    );
    expect(deps.reserveHouse).not.toHaveBeenCalled();
    expect(now).toMatchObject({ creditsCharged: 4, creditsRefunded: 1 });
    // The retry paints; so do shots 2 and 3.
    for (let i = 0; i < 3; i++) expect(await stepCampaign(deps, String(row.id))).toBe("painted");
    const { net, delivered } = netPerStill(db);
    expect(delivered).toBe(3);
    expect(net / delivered).toBe(1);
  });

  it("a failed still whose charge STAYED (the refund rules said no) is retried on the house at 0: still 1 credit net (M1)", async () => {
    const db = fakeDb({}, { now: NOW });
    const row = painting(db, { credits_charged: 3 });
    const outcomes: PaintOutcome[] = [{ kind: "failed", cause: "provider", error: "crop failed", usd: 0.09, refunded: false }, painted(), painted(), painted()];
    const deps = machine(db, { paint: vi.fn(async () => outcomes.shift()!) });
    expect(await stepCampaign(deps, String(row.id))).toBe("retrying");
    const now = campaignRowFrom(db.tables.press_campaigns[0])!;
    expect(now.stills[0].attempts.map((a) => [a.kind, a.status, a.credits])).toEqual([
      ["paint", "failed", 1],
      ["retry", "reserved", 0],
    ]);
    expect(deps.reservePaid).not.toHaveBeenCalled();
    expect(deps.reserveHouse).toHaveBeenCalledWith(expect.objectContaining({ kind: "retry", rowId: houseRowId(String(row.id), 1, "retry", 2) }));
    for (let i = 0; i < 3; i++) await stepCampaign(deps, String(row.id));
    const { net, delivered } = netPerStill(db);
    expect(delivered).toBe(3);
    expect(net / delivered).toBe(1);
  });

  it("a row gone and already refunded is treated the same: a paid retry, never a free one (M1)", async () => {
    const db = fakeDb({}, { now: NOW });
    const row = painting(db, { credits_charged: 3 });
    const deps = machine(db, { paint: vi.fn(async (): Promise<PaintOutcome> => ({ kind: "failed", cause: "gone", error: "gone", usd: 0, refunded: true })) });
    expect(await stepCampaign(deps, String(row.id))).toBe("retrying");
    expect(deps.reservePaid).toHaveBeenCalledTimes(1);
    expect(deps.reserveHouse).not.toHaveBeenCalled();
  });

  it("a moved billing window makes the retry the house's; a person who can't pay gets no retry, and the lost still closes the ad (v2 #11)", async () => {
    const db = fakeDb({}, { now: NOW });
    const row = painting(db, { credits_charged: 3 });
    const fail: PaintOutcome = { kind: "failed", cause: "provider", error: "x", usd: 0, refunded: true };
    const moved = machine(db, { paint: vi.fn(async () => fail), reservePaid: vi.fn(async () => "window" as const) });
    expect(await stepCampaign(moved, String(row.id))).toBe("retrying");
    expect(campaignRowFrom(db.tables.press_campaigns[0])!.stills[0].attempts.at(-1)).toMatchObject({ kind: "retry", credits: 0 });

    const db2 = fakeDb({}, { now: NOW });
    const row2 = painting(db2, { credits_charged: 3 });
    const broke = machine(db2, { paint: vi.fn(async () => fail), reservePaid: vi.fn(async () => "refused" as const) });
    expect(await stepCampaign(broke, String(row2.id))).toBe("failed");
    const now = campaignRowFrom(db2.tables.press_campaigns[0])!;
    expect(now).toMatchObject({ stage: "failed", error: PAINT_FAILED });
    expect(broke.reserveHouse).not.toHaveBeenCalled();
    // Nothing kept: shot 1 was refunded, shots 2 and 3 released.
    expect(now.creditsCharged - now.creditsRefunded).toBe(0);
  });

  it("a second failure loses the still and closes the ad, refunding what it held", async () => {
    const db = fakeDb({}, { now: NOW });
    const row = painting(db, { credits_charged: 3 });
    const fail: PaintOutcome = { kind: "failed", cause: "provider", error: "lane down", usd: 0, refunded: true };
    const deps = machine(db, { paint: vi.fn(async () => fail) });
    expect(await stepCampaign(deps, String(row.id))).toBe("retrying");
    // The next reserved still in shot order is shot 1's retry; it fails too (and its own charge went back).
    expect(await stepCampaign(deps, String(row.id))).toBe("failed");
    const now = campaignRowFrom(db.tables.press_campaigns[0])!;
    expect(now.stage).toBe("failed");
    expect(now.error).toBe(PAINT_FAILED);
    // Shots 2 and 3 were reserved and never painted: ended and refunded.
    expect(deps.released.sort()).toEqual([stillRowId(SEND, 2), stillRowId(SEND, 3)].sort());
    expect(now.stills.every((st) => st.attempts.every((a) => a.status !== "reserved"))).toBe(true);
    // Charged 3 + the paid retry; every credit came back.
    expect(now).toMatchObject({ creditsCharged: 4, creditsRefunded: 4 });
  });

  it("the person's note rides along to the retry of a repaint", async () => {
    const db = fakeDb({}, { now: NOW });
    const p = plan();
    let stills = initialStills(p);
    stills = withReserved(stills, 1, { rowId: repaintRowId(SEND), kind: "repaint", credits: 1, note: "Warmer light" }, iso)!;
    db.tables.generations.push({ id: repaintRowId(SEND), user_id: USER_A, status: "generating", credits_used: 1, created_at: iso });
    db.tables.press_campaigns.push(campaignRow({ plan: p, stills, stage: "painting" }));
    const deps = machine(db, { paint: vi.fn(async (): Promise<PaintOutcome> => ({ kind: "failed", cause: "provider", error: "x", usd: 0, refunded: false })) });
    expect(await stepCampaign(deps, pressCampaignId(SEND))).toBe("retrying");
    expect(campaignRowFrom(db.tables.press_campaigns[0])!.stills[0].attempts[1]).toMatchObject({ kind: "retry", note: "Warmer light" });
  });

  it("a retry reserved for an ad that closed meanwhile is given back, never left charged", async () => {
    const db = fakeDb({}, { now: NOW });
    const row = painting(db);
    const deps = machine(db, {
      paint: vi.fn(async (): Promise<PaintOutcome> => {
        db.tables.press_campaigns[0].stage = "cancelled";
        return { kind: "failed", cause: "provider", error: "x", usd: 0, refunded: true };
      }),
    });
    expect(await stepCampaign(deps, String(row.id))).toBe("idle");
    expect(deps.released).toContain(paidRetryRowId(stillRowId(SEND, 1)));
  });

  it("a read that failed before anything was spent tries the same attempt again later", async () => {
    const db = fakeDb({}, { now: NOW });
    const row = painting(db);
    const deps = machine(db, { paint: vi.fn(async (): Promise<PaintOutcome> => ({ kind: "later" })) });
    expect(await stepCampaign(deps, String(row.id))).toBe("unavailable");
    const now = campaignRowFrom(db.tables.press_campaigns[0])!;
    expect(now.stills[0].attempts).toHaveLength(1);
    expect(now.stills[0].attempts[0].status).toBe("reserved");
    expect(deps.reserveHouse).not.toHaveBeenCalled();
    expect(deps.reservePaid).not.toHaveBeenCalled();
  });

  it("a content refusal closes the ad at once, with its own words", async () => {
    const db = fakeDb({}, { now: NOW });
    const row = painting(db);
    const deps = machine(db, { paint: vi.fn(async (): Promise<PaintOutcome> => ({ kind: "failed", cause: "refused", error: STILL_REFUSED, usd: 0.09, refunded: false })) });
    expect(await stepCampaign(deps, String(row.id))).toBe("failed");
    const now = campaignRowFrom(db.tables.press_campaigns[0])!;
    expect(now).toMatchObject({ stage: "failed", error: STILL_REFUSED });
    expect(deps.reserveHouse).not.toHaveBeenCalled();
  });

  it("a closed campaign is never painted on", async () => {
    const db = fakeDb({}, { now: NOW });
    const row = painting(db, { stage: "cancelled" });
    const deps = machine(db);
    expect(await stepCampaign(deps, String(row.id))).toBe("idle");
    expect(deps.paint).not.toHaveBeenCalled();
  });

  it("a campaign someone else holds is not stepped (the lease)", async () => {
    const db = fakeDb({}, { now: NOW });
    const row = painting(db, { locked_at: new Date(NOW.getTime() - 60_000).toISOString() });
    const deps = machine(db);
    expect(await stepOnce(deps, String(row.id))).toBe("busy");
    db.tables.press_campaigns[0].locked_at = new Date(NOW.getTime() - LEASE_MS - 1000).toISOString();
    expect(await stepOnce(deps, String(row.id))).toBe("painted");
    // And the lease is given back after the step.
    expect(db.tables.press_campaigns[0].locked_at).toBeNull();
  });

  it("a campaign waiting on the person is never claimed", async () => {
    const db = fakeDb({}, { now: NOW });
    db.tables.press_campaigns.push(campaignRow({ stage: "awaiting_approval" }));
    const deps = machine(db);
    expect(await stepOnce(deps, pressCampaignId(SEND))).toBe("busy");
  });
});

describe("the kick's budget (M2, PT-07)", () => {
  it("a step starts only while a whole worst-case step fits in the page's 300 s", () => {
    expect(kickBudgetMs({ functionMs: 300_000, laneTimeoutMs: 150_000, checkBudgetMs: 75_000, marginMs: 15_000 })).toBe(60_000);
    expect(kickBudgetMs({ functionMs: 100_000, laneTimeoutMs: 150_000, checkBudgetMs: 75_000, marginMs: 15_000 })).toBe(0);
  });

  it("a kick paints one still of ~95 s and leaves the rest to the cron, instead of starting one it cannot finish", async () => {
    const db = fakeDb({}, { now: NOW });
    const row = painting(db);
    const deps = machine(db, {
      paint: vi.fn(async () => {
        db.clock.now = new Date(db.clock.now.getTime() + 95_000);
        return painted();
      }),
    });
    const steps = await driveCampaign(deps, String(row.id), { budgetMs: 60_000 });
    expect(steps).toEqual(["painted"]);
    expect(deps.paint).toHaveBeenCalledTimes(1);
  });
});

describe("the cron's minute", () => {
  it("closes what waited 7 days, fails a dead draft, tells Admin once about a stuck one, steps the rest", async () => {
    const db = fakeDb({}, { now: NOW });
    const old = new Date(NOW.getTime() - 1000).toISOString();
    const other = (n: number) => `8888888${n}-8888-4888-8888-888888888888`;
    db.tables.press_campaigns.push(
      campaignRow({ id: other(1), send_id: other(1), stage: "awaiting_approval", expires_at: old }),
      campaignRow({ id: other(2), send_id: other(2), stage: "draft", updated_at: new Date(NOW.getTime() - 11 * 60_000).toISOString() }),
      campaignRow({ id: other(3), send_id: other(3), stage: "draft", updated_at: old }),
    );
    const row = painting(db, { stage_changed_at: new Date(NOW.getTime() - OVERDUE_MS - 1000).toISOString() });
    const deps = machine(db);
    const report = await pressTick(deps, { batch: 4 });
    expect(report).toMatchObject({ expired: 1, stale: 1, overdue: 1 });
    expect(report.stepped).toEqual({ [String(row.id)]: "painted" });
    const byId = (id: string) => db.tables.press_campaigns.find((c) => c.id === id)!;
    expect(byId(other(1))).toMatchObject({ stage: "expired", error: CAMPAIGN_EXPIRED });
    expect(byId(other(2))).toMatchObject({ stage: "failed", error: PLAN_STALLED });
    expect(byId(other(3)).stage).toBe("draft");
    expect(deps.notified).toHaveLength(1);
    // The push opens an Admin anchor, never a page that does not exist (PT-11).
    expect((deps.notifyAdmins as ReturnType<typeof vi.fn>).mock.calls[0][0].path).toBe("#system");
    // Once per stage: the next minute says nothing more.
    const again = await pressTick(deps, { batch: 4 });
    expect(again.overdue).toBe(0);
  });
});

describe("verdict words", () => {
  it("the machine's words are the contract's", () => {
    const words: Verdict[] = ["match", "didnt_match", "not_readable", "product_missing", "not_checked", "no_one_in_shot"];
    const row = campaignRowFrom(campaignRow({ stills: [{ shot: 1, attempts: [attempt({ product: "weird" as Verdict })], keep: 1, decision: "pending" }] }))!;
    expect(words).toContain(row.stills[0].attempts[0].product);
    expect(row.stills[0].attempts[0].product).toBe("not_checked");
  });
});
