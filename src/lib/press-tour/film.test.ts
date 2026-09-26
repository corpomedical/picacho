import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { photosHash } from "../characters/likeness";
import { CAMPAIGN_BAD_REQUEST, CAMPAIGN_MOVED_ON, blockDecide, BLOCK_FILMING_NOT_OPEN, PAINT_FAILED, priceChanged } from "./campaign-messages";
import { CHARACTER_A, PRODUCT_A, USER_A, adConsent, character, confirmedProduct, fakeDb } from "./campaign-fixtures";
import { CAMPAIGN_COLUMNS, LEASE_MS, campaignRowFrom, canMove, masterView, pressCampaignId, pressTick, stepCampaign, withOutcome, type MachineDeps, type StillState } from "./campaign-machine";
import {
  approveStill,
  assembleNow,
  cancelCampaign,
  cutShot,
  filmShots,
  getCampaign,
  keepTake,
  paintStills,
  planCampaign,
  refilmShot,
  repaintStill,
  type CampaignCaller,
  type CampaignDeps,
} from "./campaign-service";
import type { CampaignResult, CampaignView } from "./campaign-types";
import { assembleStep, lateCuts, masterRowId, signStep, type CutDeps } from "./cut";
import { loadCutFont, type ExportPreset } from "./cut-encode";
import {
  DEFAULT_FILM_LANE,
  FILM_FLAG,
  FILM_LANES,
  FILM_LANE_SETTING,
  checkShotsStep,
  filmPrompt,
  filmRowId,
  filmRowPayload,
  filmSpec,
  filmStep,
  readFilmOpening,
  refilmRowId,
  resolveFilmLane,
  takeCheckFrom,
  type FilmDeps,
} from "./film";
import {
  CUT_CANCEL_WAIT,
  CUT_LATE,
  CUT_STALLED,
  FILM_BUSY,
  FILM_CANCEL_WAIT,
  FILM_EXPIRED,
  FILM_REFUSED,
  SIGN_NOT_CONFIGURED,
  blockDecideShot,
  cutLateRefunded,
} from "./film-messages";
import { PRESS_TOUR_REQUIRED_KEYS } from "./enabled";
import type { PlannerDeps } from "./planner";
import { FILM_LANE, shotCredits } from "./quote";
import { c2paSigner } from "./sign";
import type { TakeCheckResult } from "./shots";

// Cut 4 end to end against the in-memory database: the Film press charges
// the quote's film line once, the machine films (fake lane), keeps, checks
// (fake checker), waits on the person only for a miss, cuts (the REAL
// encoder on tiny clips when ffmpeg-static is there), signs (unsigned, and
// why), delivers, and the 24 h rule refunds a cut we never delivered.

const NOW = new Date("2026-09-26T10:00:00.000Z");
const ADMIN: CampaignCaller = { userId: USER_A, via: "admin" };
const SEND = "77777777-7777-4777-8777-777777777777";
const PAINT_SEND = "99999999-9999-4999-8999-999999999999";
const FILM_SEND = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const REFILM_SEND = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const PHOTOS = [`${USER_A}/eva-1.jpg`];
const CAMPAIGN = pressCampaignId(SEND);

/** A small frame so the real encoder runs in well under a second a segment. */
const SMALL: ExportPreset = { width: 108, height: 192, fps: 30, crf: 28, maxrateKbps: 2000, bufsizeKbps: 4000, profile: "high", level: "4.1", x264Preset: "veryfast", audioRate: 48000, audioKbps: 128 };

const planAnswer = {
  angle: "Morning ritual",
  cta: "Try it today",
  shots: [0, 1, 2].map((i) => ({
    still: `Still ${i + 1}: she holds the can in a bright kitchen.`,
    motion: "Slow push-in.",
    product_visibility: "required_label",
    on_screen_text: i === 1 ? "Cold brew <b>&</b> calm" : "",
  })),
};

const view = (r: CampaignResult): CampaignView => {
  if (!r.ok) throw new Error(`expected a campaign, got: ${r.error}`);
  return r.campaign;
};

// ---------------------------------------------------------------------------
// The encoder, for the real-cut tests
// ---------------------------------------------------------------------------

const ffmpegPath = join(__dirname, "..", "..", "..", "node_modules", "ffmpeg-static", "ffmpeg");
const HAS_FFMPEG = existsSync(ffmpegPath);
let work = "";
let takeClip: Buffer = Buffer.alloc(0);

beforeAll(() => {
  work = mkdtempSync(join(tmpdir(), "press-film-test-"));
  if (HAS_FFMPEG) {
    const out = join(work, "take.mp4");
    // A white 5 s "filmed take", 9:16, with a sine tone: the cut must take the sound OUT.
    execFileSync(ffmpegPath, ["-y", "-v", "error", "-f", "lavfi", "-i", "color=c=white:s=90x160:r=24:d=5", "-f", "lavfi", "-i", "sine=f=440:d=5", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", out]);
    takeClip = readFileSync(out);
  }
});

afterAll(() => {
  if (work) rmSync(work, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// The world
// ---------------------------------------------------------------------------

function setup(opts: { open?: boolean; busy?: boolean } = {}) {
  const db = fakeDb({}, { now: new Date(NOW) });
  db.tables.products.push(confirmedProduct());
  db.tables.character_profiles.push(character());
  db.tables.character_ad_consents.push(adConsent(photosHash(PHOTOS)));
  const state = { open: opts.open !== false, busy: opts.busy === true };
  const kicked: string[] = [];
  const planner: PlannerDeps = {
    direct: vi.fn(async () => planAnswer),
    assertPromptAllowed: vi.fn(async () => ({})),
    classify: vi.fn(async () => ({ violations: [], checked: true })),
    review: vi.fn(async () => '{"band":"NONE"}'),
  };
  const refunds: string[] = [];
  const deps: CampaignDeps = {
    db: db.db,
    money: {
      db: db.db,
      allowance: vi.fn(async () => ({ error: null, isAdmin: true })),
      spendBonus: vi.fn(async () => true),
      spendPurchased: vi.fn(async () => true),
      refund: vi.fn(async (rowId: string) => {
        refunds.push(rowId);
        return true;
      }),
    },
    planner,
    ownRules: vi.fn(async () => []),
    balance: vi.fn(async () => 96),
    kick: vi.fn((id: string) => {
      kicked.push(id);
    }),
    imageUrl: (path) => `/api/media/generated-images/${path}?v=sig`,
    rateLimited: vi.fn(async () => false),
    hashKey: (v, scope) => `hash(${scope}:${v})`,
    now: () => db.clock.now,
    filmDoor: {
      opening: async () => (state.open ? { open: true, lane: FILM_LANES[DEFAULT_FILM_LANE] } : { open: false, lane: null }),
      laneBusy: async () => state.busy,
      videoUrl: (stored) => stored,
      renditionUrl: async (path) => `https://storage.test/press-kit/${path}?token=t`,
    },
  };
  return { db, deps, kicked, planner, state, refunds };
}

type World = ReturnType<typeof setup>;

/** Planned, painted, every still approved: the ad waits for "Film". */
async function readyToFilm(s: World = setup()) {
  view(await planCampaign(s.deps, ADMIN, { sendId: SEND, productId: PRODUCT_A, characterId: CHARACTER_A }));
  view(await paintStills(s.deps, ADMIN, { sendId: PAINT_SEND, campaignId: CAMPAIGN }));
  const c = s.db.tables.press_campaigns[0];
  let stills = c.stills as StillState[];
  for (const shot of [1, 2, 3]) {
    stills = withOutcome(stills, shot, 1, { kind: "painted", path: `${USER_A}/press/${c.id}/${shot}.png`, face: "match", product: "match", reason: null, fits: true, faceScore: 80, escalations: 0, usd: 0 }, NOW.toISOString());
  }
  c.stills = stills;
  c.stage = "awaiting_approval";
  for (const shot of [1, 2, 3]) view(await approveStill(s.deps, ADMIN, { campaignId: CAMPAIGN, shot }));
  return s;
}

const clean = (over: Partial<TakeCheckResult> = {}): TakeCheckResult => ({
  face: "match",
  product: "match",
  reason: null,
  moments: [0.4, 2.5, 4.6].map((atSeconds) => ({ atSeconds, face: "match" as const, product: "match" as const, reason: null })),
  escalations: 0,
  corner: "left",
  ...over,
});

function machine(s: World, over: { film?: Partial<FilmDeps>; cut?: Partial<CutDeps>; checks?: Record<number, TakeCheckResult> } = {}) {
  let n = 0;
  const notified: { key: string; path: string }[] = [];
  const admins: string[] = [];
  const released: string[] = [];
  const settled: string[] = [];
  const film: FilmDeps = {
    lane: async () => FILM_LANES[DEFAULT_FILM_LANE],
    laneBusy: async () => false,
    submit: vi.fn(async () => {
      n += 1;
      return { requestId: `req-${n}`, statusUrl: `https://queue.fal.run/r${n}/status`, responseUrl: `https://queue.fal.run/r${n}`, cancelUrl: `https://queue.fal.run/r${n}/cancel`, label: "Kling O3" };
    }),
    poll: vi.fn(async () => ({ state: "completed" as const })),
    result: vi.fn(async (job) => `https://fal.media/${job.requestId}.mp4`),
    cancel: vi.fn(async () => undefined),
    outputGate: vi.fn(async () => ({ ok: true as const })),
    keep: vi.fn(async ({ userId, providerUrl }) => `/api/media/generated-videos/${userId}/${providerUrl.split("/").pop()}?v=sig`),
    stillUrl: (path) => `https://picacho.test/api/media/generated-images/${path}?v=s`,
    promptGate: vi.fn(async () => ({ ok: true as const, scores: {} })),
    classify: vi.fn(async () => ({ violations: [], checked: true })),
    review: vi.fn(async () => '{"band":"NONE"}'),
    ownRules: vi.fn(async () => []),
    refund: vi.fn(async () => true),
    reservePaid: vi.fn(async ({ spec }) => {
      s.db.tables.generations.push({ ...filmRowPayload(spec), user_id: USER_A, created_at: NOW.toISOString() });
      return "reserved" as const;
    }),
    reserveHouse: vi.fn(async ({ spec }) => {
      s.db.tables.generations.push({ ...filmRowPayload(spec), user_id: USER_A, created_at: NOW.toISOString() });
      return true;
    }),
    healthSuccess: vi.fn(async () => undefined),
    healthFailure: vi.fn(async () => undefined),
    checkTake: vi.fn(async (input) => ({ check: over.checks?.[input.shot] ?? clean(), usd: 0.05 })),
    usdPerSecond: () => 0.112,
    ...over.film,
  };
  const kit = (p: string) => `press-kit/${p}`;
  const cut: CutDeps = {
    readVideo: vi.fn(async () => (takeClip.length ? takeClip : null)),
    readKit: vi.fn(async (p) => s.db.files.get(kit(p)) ?? null),
    writeKit: vi.fn(async (p, bytes) => {
      s.db.files.set(kit(p), Buffer.from(bytes));
      return true;
    }),
    removeKit: vi.fn(async (paths) => {
      for (const p of paths) s.db.files.delete(kit(p));
    }),
    keepMaster: vi.fn(async ({ userId, campaignId, sha256, bytes }) => {
      const path = `${userId}/press/${campaignId}/cut-${sha256.slice(0, 16)}.mp4`;
      s.db.files.set(`generated-videos/${path}`, bytes);
      return `/api/media/generated-videos/${path}?v=sig`;
    }),
    signer: c2paSigner({}, null),
    brand: vi.fn(async () => null),
    font: () => loadCutFont(),
    notify: vi.fn(async (m) => {
      notified.push({ key: m.key, path: m.path });
    }),
    refund: vi.fn(async () => true),
    preset: SMALL,
    ...over.cut,
  };
  const deps: MachineDeps = {
    db: s.db.db,
    paint: vi.fn(async () => ({ kind: "skipped" as const })),
    reserveHouse: vi.fn(async () => true),
    reservePaid: vi.fn(async () => "refused" as const),
    releaseRow: vi.fn(async ({ rowId, credits }) => {
      released.push(rowId);
      return credits > 0;
    }),
    settleRow: vi.fn(async ({ rowId, credits }) => {
      settled.push(rowId);
      return credits > 0;
    }),
    faceGateOn: vi.fn(async () => true),
    notifyAdmins: vi.fn(async (m) => {
      admins.push(m.title);
    }),
    now: () => s.db.clock.now,
    film,
    cut,
    stages: { animating: filmStep, checking_shots: checkShotsStep, assembling: assembleStep, signing: signStep, late: lateCuts },
  };
  return { deps, film, cut, notified, admins, released, settled };
}

const row = (s: World) => campaignRowFrom(s.db.tables.press_campaigns[0])!;

/** Step until the stage leaves `from` (or 30 steps). */
async function stepWhile(m: ReturnType<typeof machine>, s: World, stages: string[]) {
  for (let i = 0; i < 30 && stages.includes(row(s).stage); i++) await stepCampaign(m.deps, CAMPAIGN);
}

// ---------------------------------------------------------------------------

describe("the stage machine past awaiting_approval", () => {
  it("film -> check -> (the press wall) -> cut -> sign -> ready; a parked cut waits on the person", () => {
    expect(canMove("awaiting_approval", "animating")).toBe(true);
    expect(canMove("animating", "checking_shots")).toBe(true);
    expect(canMove("checking_shots", "awaiting_approval")).toBe(true);
    expect(canMove("checking_shots", "assembling")).toBe(true);
    expect(canMove("awaiting_approval", "assembling")).toBe(true);
    expect(canMove("assembling", "signing")).toBe(true);
    expect(canMove("assembling", "awaiting_approval")).toBe(true);
    expect(canMove("signing", "ready")).toBe(true);
    expect(canMove("ready", "failed")).toBe(false);
    expect(canMove("animating", "assembling")).toBe(false);
    expect(canMove("checking_shots", "ready")).toBe(false);
  });
});

describe("the lane and the switch", () => {
  it("only a lane the quote prices may film; a missing row is the default", () => {
    expect(resolveFilmLane(undefined)?.modelId).toBe("kling-o3");
    expect(resolveFilmLane("kling-o3")).toEqual({ modelId: "kling-o3", openingFrame: true, audio: false });
    expect(resolveFilmLane("KLING-O3 ")?.modelId).toBe("kling-o3");
    expect(resolveFilmLane("veo")).toBeNull();
    expect(resolveFilmLane("seedance")).toBeNull();
    expect(resolveFilmLane(42)).toBeNull();
    expect(FILM_LANES[DEFAULT_FILM_LANE].modelId).toBe(FILM_LANE.modelId);
  });

  it("filming is open only with press_tour AND press_tour_film on, the keys set, and a priced lane (fail-closed)", async () => {
    for (const k of PRESS_TOUR_REQUIRED_KEYS) vi.stubEnv(k, "set");
    vi.stubEnv("PRESS_TOUR_DISABLED", "");
    const db = fakeDb();
    expect(await readFilmOpening(db.db)).toEqual({ open: false, lane: null });
    db.tables.feature_flags.push({ key: "press_tour", enabled: true });
    expect(await readFilmOpening(db.db)).toEqual({ open: false, lane: null });
    db.tables.feature_flags.push({ key: FILM_FLAG, enabled: true });
    expect((await readFilmOpening(db.db)).open).toBe(true);
    db.tables.app_settings.push({ key: FILM_LANE_SETTING, value: "veo" });
    expect(await readFilmOpening(db.db)).toEqual({ open: false, lane: null });
    vi.stubEnv("PRESS_TOUR_DISABLED", "1");
    db.tables.app_settings[0].value = "kling-o3";
    expect(await readFilmOpening(db.db)).toEqual({ open: false, lane: null });
    vi.unstubAllEnvs();
  });
});

describe("the SQL (press-tour-03b-film.sql)", () => {
  const repo = join(__dirname, "..", "..", "..");
  const root = join(repo, "supabase");
  const name = "press-tour-03b-film.sql";
  const found = [join(root, "pending", name), ...readdirSync(join(root, "applied")).map((d) => join(root, "applied", d, name))].find((p) => existsSync(p))!;
  const sql = readFileSync(found, "utf8");

  it("adds exactly the columns the machine reads, each nullable or defaulted", () => {
    const adds = [...sql.matchAll(/alter table public\.press_campaigns add column if not exists (\w+) ([^;]+);/g)];
    expect(adds.map((m) => m[1]).sort()).toEqual(["assembly", "cut_due_at", "delivered_at", "film_charged_at", "shots"]);
    for (const m of adds) if (/not null/i.test(m[2])) expect(m[2]).toMatch(/default/i);
  });

  it("every column the machine selects exists in 03 or 03b (the machine's read fails closed otherwise)", () => {
    const find = (file: string) => [join(root, "pending", file), ...readdirSync(join(root, "applied")).map((d) => join(root, "applied", d, file))].find((p) => existsSync(p))!;
    const sql03 = readFileSync(find("press-tour-03-campaigns.sql"), "utf8");
    const body = sql03.slice(sql03.indexOf("create table if not exists public.press_campaigns ("), sql03.indexOf("create index if not exists press_campaigns_user"));
    const created = [...body.matchAll(/^ {2}([a-z_]+)\s/gm)].map((m) => m[1]).filter((c) => c !== "constraint");
    const added = [...sql.matchAll(/alter table public\.press_campaigns add column if not exists (\w+)/g)].map((m) => m[1]);
    const selected = CAMPAIGN_COLUMNS.split(",").map((c) => c.trim());
    for (const c of selected) expect([...created, ...added], c).toContain(c);
  });

  it("inserts the film switch OFF and seeds the lane with the code's default; nothing is turned on", () => {
    expect(sql).toMatch(new RegExp(`values \\(\\s*'${FILM_FLAG}',\\s*false,`));
    expect(sql).toMatch(new RegExp(`values \\(\\s*'${FILM_LANE_SETTING}',\\s*'${DEFAULT_FILM_LANE}',`));
    expect(sql).not.toMatch(/do update/i);
    expect(sql).not.toMatch(/enabled\s*=\s*true/i);
  });

  it("adds no definer function and no policy; the verify block keeps press_campaigns policy-free", () => {
    expect(sql).not.toMatch(/create (or replace )?function/i);
    expect(sql).not.toMatch(/create policy/i);
    expect(sql).toContain("must have no policies");
  });
});

describe("the rows and the words", () => {
  it("a take's row is a 9:16 video on the lane, never the daily free slot, priced as the quote's film line", () => {
    const s = setup();
    const planned = { shot: 2, role: "costar" as const, seconds: 5, span: [5, 10] as [number, number], direction: "She pours.", still: "x", motion: "Slow push-in.", camera: "", productVisibility: "required_label" as const, star: true, onScreenText: "", caption: "" };
    const spec = filmSpec({ id: CAMPAIGN, characterIds: [CHARACTER_A], trialId: null, plan: null }, planned, { id: filmRowId(FILM_SEND, 2), kind: "film", take: 1, credits: shotCredits(5), modelId: "kling-o3" });
    const payload = filmRowPayload(spec, { purchased: 1, bonus: 0 });
    expect(payload).toMatchObject({
      content_type: "video",
      model_id: "kling-o3",
      video_model_id: "kling-o3",
      video_duration_seconds: 5,
      video_aspect_ratio: "9:16",
      credits_used: 2,
      purchased_credits_used: 1,
      free_generation_used: false,
      character_profile_ids: [CHARACTER_A],
      press_tour: { campaign_id: CAMPAIGN, shot: 2, kind: "shot", take: 1, film: "film", house: false },
    });
    expect(shotCredits(5)).toBe(2);
    void s;
  });

  it("the film prompt keeps the first frame, the label words and says nobody speaks; the note rides last", () => {
    const p = filmPrompt({
      shot: { direction: "She lifts the can.", motion: "Slow push-in.", camera: "close", productVisibility: "required_label", star: true },
      product: { name: "Solstad", labelStrings: ['SOL"STAD'], noReadableText: false },
      note: "warmer light",
    });
    expect(p).toContain("first frame");
    expect(p).toContain(`"SOL'STAD"`);
    expect(p).toContain("No one speaks.");
    expect(p.trim().endsWith("The advertiser asks for this change: warmer light")).toBe(true);
  });

  it("the checker's answer becomes the take's words, moment by moment, and the tag's corner", () => {
    const got = takeCheckFrom(
      {
        face: "match",
        product: "didnt_match",
        reason: "The words on the label came out different.",
        productExpected: true,
        signals: {
          moments: [
            { at: 0.4, verdict: "match", reason: null, presence: "yes", coverage: 0.2, box: { x: 0.05, y: 0.75, w: 0.3, h: 0.2 }, words: "match", ocrBest: 1, conflict: null, judge: null, escalated: false, face: 88 },
            { at: 2.5, verdict: "didnt_match", reason: "The words on the label came out different.", presence: "yes", coverage: 0.2, box: null, words: "conflict", ocrBest: 0.3, conflict: "SOLSTAO", judge: null, escalated: true, face: 81 },
          ],
          worst: 1,
          faceLowest: 81,
          escalationsUsed: 1,
          usd: 0.02,
          scorerVersion: "t",
          timedOut: false,
          referenceText: null,
        },
      },
      { productExpected: true, star: true },
      70,
    );
    expect(got.moments).toEqual([
      { atSeconds: 0.4, face: "match", product: "match", reason: null },
      { atSeconds: 2.5, face: "match", product: "didnt_match", reason: "The words on the label came out different." },
    ]);
    expect(got).toMatchObject({ face: "match", product: "didnt_match", escalations: 1, corner: "right" });
  });

  it("a moment read both ways carries both readings to the press wall: the letters and the four parts, never a score", () => {
    const signals = (m: Record<string, unknown>) => ({
      face: "match" as const,
      product: "didnt_match" as const,
      reason: "The words on the label came out different.",
      productExpected: true,
      signals: {
        moments: [{ at: 2.2, verdict: "didnt_match", reason: "The words on the label came out different.", presence: "yes", coverage: 0.2, box: null, words: "conflict", ocrBest: 0.86, escalated: false, face: 81, ...m }],
        worst: 0,
        faceLowest: 81,
        escalationsUsed: 0,
        usd: 0.01,
        scorerVersion: "t",
        timedOut: false,
        referenceText: null,
      },
    });
    const both = takeCheckFrom(
      signals({
        conflict: "SOLSTAO",
        labelExpected: "SOLSTAD",
        judge: { verdict: "mismatch", confidence: 82, labelInView: true, blurred: false, aspects: { label: "off", logo: "off", shape: "ok", colour: "unseen" } },
      }) as never,
      { productExpected: true, star: true },
      70,
    );
    expect(both.moments[0].detail).toEqual({ read: "SOLSTAO", expected: "SOLSTAD", label: "didnt_match", logo: "didnt_match", shape: "match", colour: "not_readable" });
    expect(JSON.stringify(both.moments[0].detail)).not.toMatch(/82|0\.86|confidence|score/);
    // One reading alone: the reason only.
    const wordsOnly = takeCheckFrom(signals({ conflict: "SOLSTAO", labelExpected: "SOLSTAD", judge: null }) as never, { productExpected: true, star: true }, 70);
    expect(wordsOnly.moments[0]).not.toHaveProperty("detail");
    const judgeOnly = takeCheckFrom(
      signals({ conflict: null, labelExpected: "SOLSTAD", judge: { verdict: "mismatch", confidence: 82, labelInView: true, blurred: false, aspects: { label: "off", logo: "ok", shape: "ok", colour: "ok" } } }) as never,
      { productExpected: true, star: true },
      70,
    );
    expect(judgeOnly.moments[0]).not.toHaveProperty("detail");
    // A shot planned without the product has no product readings to show.
    const hook = takeCheckFrom(
      signals({ conflict: "SOLSTAO", labelExpected: "SOLSTAD", judge: { verdict: "mismatch", confidence: 82, labelInView: true, blurred: false, aspects: { label: "off", logo: "ok", shape: "ok", colour: "ok" } } }) as never,
      { productExpected: false, star: true },
      70,
    );
    expect(hook.moments[0]).not.toHaveProperty("detail");
  });
});

describe("filmShots (the Film press)", () => {
  it("charges the quote's film line once: one row per shot from the press's own id, the ad goes to animating, the 24 h clock starts", async () => {
    const s = await readyToFilm();
    const before = s.db.tables.generations.length;
    const v = view(await filmShots(s.deps, ADMIN, { sendId: FILM_SEND, campaignId: CAMPAIGN, locale: "es" }));
    expect(v.stage).toBe("animating");
    const rows = s.db.tables.generations.slice(before);
    expect(rows.map((r) => r.id)).toEqual([1, 2, 3].map((n) => filmRowId(FILM_SEND, n)));
    expect(rows.every((r) => r.credits_used === 2 && r.content_type === "video" && r.status === "generating")).toBe(true);
    const c = row(s);
    expect(c.creditsCharged).toBe(3 + 6);
    expect(c.filmChargedAt).toBe(NOW.toISOString());
    expect(c.cutDueAt).toBe(new Date(NOW.getTime() + 24 * 3600_000).toISOString());
    expect((c.assembly as { locale: string }).locale).toBe("es");
    expect(v.shots.map((sh) => sh.takes.map((t) => t.state))).toEqual([["filming"], ["filming"], ["filming"]]);
    expect(v.quote?.rows.find((r) => r.key === "film")).toMatchObject({ credits: 6, paid: true });
    // Painting kicked once; the Film press kicks again.
    expect(s.kicked).toEqual([CAMPAIGN, CAMPAIGN]);
  });

  it("a resent press meets its own rows and charges nothing again", async () => {
    const s = await readyToFilm();
    view(await filmShots(s.deps, ADMIN, { sendId: FILM_SEND, campaignId: CAMPAIGN }));
    const count = s.db.tables.generations.length;
    const again = view(await filmShots(s.deps, ADMIN, { sendId: FILM_SEND, campaignId: CAMPAIGN }));
    expect(again.stage).toBe("animating");
    expect(s.db.tables.generations.length).toBe(count);
    expect(row(s).creditsCharged).toBe(9);
  });

  it("switched off: 'Filming isn't open yet', and nothing is reserved", async () => {
    const s = await readyToFilm(setup({ open: false }));
    const before = s.db.tables.generations.length;
    expect(await filmShots(s.deps, ADMIN, { sendId: FILM_SEND, campaignId: CAMPAIGN })).toEqual({ ok: false, error: BLOCK_FILMING_NOT_OPEN });
    expect(s.db.tables.generations.length).toBe(before);
    // ...and the door says so; with filming open, nothing blocks the Film press.
    expect(view(await getCampaign(s.deps, ADMIN, { campaignId: CAMPAIGN })).blocker).toBe(BLOCK_FILMING_NOT_OPEN);
    s.state.open = true;
    expect(view(await getCampaign(s.deps, ADMIN, { campaignId: CAMPAIGN })).blocker).toBeNull();
  });

  it("a tripped lane: 'Filming is busy', nothing charged, never another lane", async () => {
    const s = await readyToFilm(setup({ busy: true }));
    const before = s.db.tables.generations.length;
    expect(await filmShots(s.deps, ADMIN, { sendId: FILM_SEND, campaignId: CAMPAIGN })).toEqual({ ok: false, error: FILM_BUSY });
    expect(s.db.tables.generations.length).toBe(before);
  });

  it("every still must be decided first", async () => {
    const s = setup();
    view(await planCampaign(s.deps, ADMIN, { sendId: SEND, productId: PRODUCT_A, characterId: CHARACTER_A }));
    view(await paintStills(s.deps, ADMIN, { sendId: PAINT_SEND, campaignId: CAMPAIGN }));
    const c = s.db.tables.press_campaigns[0];
    let stills = c.stills as StillState[];
    for (const shot of [1, 2, 3]) stills = withOutcome(stills, shot, 1, { kind: "painted", path: `${USER_A}/p/${shot}.png`, face: "match", product: "match", reason: null, fits: true, faceScore: 80, escalations: 0, usd: 0 }, NOW.toISOString());
    c.stills = stills;
    c.stage = "awaiting_approval";
    view(await approveStill(s.deps, ADMIN, { campaignId: CAMPAIGN, shot: 1 }));
    expect(await filmShots(s.deps, ADMIN, { sendId: FILM_SEND, campaignId: CAMPAIGN })).toEqual({ ok: false, error: blockDecide(2) });
  });

  it("once filmed, the stills are settled: no repaint, no still decision", async () => {
    const s = await readyToFilm();
    view(await filmShots(s.deps, ADMIN, { sendId: FILM_SEND, campaignId: CAMPAIGN }));
    const c = s.db.tables.press_campaigns[0];
    c.stage = "awaiting_approval";
    expect(await repaintStill(s.deps, ADMIN, { sendId: REFILM_SEND, campaignId: CAMPAIGN, shot: 1 })).toEqual({ ok: false, error: CAMPAIGN_MOVED_ON });
    expect(await approveStill(s.deps, ADMIN, { campaignId: CAMPAIGN, shot: 1 })).toEqual({ ok: false, error: CAMPAIGN_MOVED_ON });
  });

  it("a campaign with shots in the lane can't be stopped mid-render", async () => {
    const s = await readyToFilm();
    view(await filmShots(s.deps, ADMIN, { sendId: FILM_SEND, campaignId: CAMPAIGN }));
    expect(await cancelCampaign(s.deps, ADMIN, { campaignId: CAMPAIGN })).toEqual({ ok: false, error: FILM_CANCEL_WAIT });
  });

  it("MONEY (MONEY-1): while we owe the cut it can't be closed (the filming would be kept and the 24 h rule disarmed); on the wall it can, and the filming stays spent", async () => {
    const s = await readyToFilm();
    view(await filmShots(s.deps, ADMIN, { sendId: FILM_SEND, campaignId: CAMPAIGN }));
    const m = machine(s);
    // Filmed and checked, cutting between the cron's claims: no lease held, nothing in the lane.
    await stepWhile(m, s, ["animating", "checking_shots"]);
    expect(row(s).stage).toBe("assembling");
    expect(row(s).lockedAt).toBeNull();
    expect(view(await getCampaign(s.deps, ADMIN, { campaignId: CAMPAIGN })).cutOwed).toBe(true);
    expect(await cancelCampaign(s.deps, ADMIN, { campaignId: CAMPAIGN })).toEqual({ ok: false, error: CUT_CANCEL_WAIT });
    // Parked after three failed cuts: still owed, still refused; the 24 h rule then closes and refunds it.
    const c = s.db.tables.press_campaigns[0];
    Object.assign(c, { stage: "awaiting_approval", assembly: { ...(c.assembly as object), parked: true, failures: 3 } });
    expect(await cancelCampaign(s.deps, ADMIN, { campaignId: CAMPAIGN })).toEqual({ ok: false, error: CUT_CANCEL_WAIT });
    s.db.clock.now = new Date(NOW.getTime() + 25 * 3600_000);
    expect(await lateCuts(m.deps)).toBe(1);
    expect(row(s)).toMatchObject({ stage: "failed", creditsRefunded: 6 });

    // Waiting on the person (the clock stopped): it may be closed; the filming stays spent.
    const w = await readyToFilm();
    view(await filmShots(w.deps, ADMIN, { sendId: FILM_SEND, campaignId: CAMPAIGN }));
    const mw = machine(w, { checks: { 1: clean({ product: "didnt_match" }) } });
    await stepWhile(mw, w, ["animating", "checking_shots"]);
    const wall = view(await getCampaign(w.deps, ADMIN, { campaignId: CAMPAIGN }));
    expect(wall).toMatchObject({ stage: "awaiting_approval", cutOwed: false });
    const closed = view(await cancelCampaign(w.deps, ADMIN, { campaignId: CAMPAIGN }));
    expect(closed.stage).toBe("cancelled");
    expect(row(w).creditsRefunded).toBe(0);
  });
});

describe("the machine: film, keep, check", () => {
  it("submits every take with the approved still as the opening frame, writes the handle on the row, then collects, gates and keeps each", async () => {
    const s = await readyToFilm();
    view(await filmShots(s.deps, ADMIN, { sendId: FILM_SEND, campaignId: CAMPAIGN }));
    const m = machine(s);
    expect(await stepCampaign(m.deps, CAMPAIGN)).toBe("submitted");
    expect(m.film.submit).toHaveBeenCalledTimes(3);
    const first = (m.film.submit as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(first).toMatchObject({ modelId: "kling-o3", seconds: 5, stillUrl: `https://picacho.test/api/media/generated-images/${USER_A}/press/${CAMPAIGN}/1.png?v=s` });
    const take1 = s.db.tables.generations.find((g) => g.id === filmRowId(FILM_SEND, 1))!;
    expect((take1.press_tour as { job?: { requestId: string } }).job?.requestId).toBe("req-1");

    expect(await stepCampaign(m.deps, CAMPAIGN)).toBe("filmed");
    expect(m.film.outputGate).toHaveBeenCalledTimes(2); // two collected a step
    expect(s.db.tables.generations.find((g) => g.id === filmRowId(FILM_SEND, 1))).toMatchObject({ status: "succeeded", result_url: `/api/media/generated-videos/${USER_A}/req-1.mp4?v=sig` });
    await stepWhile(m, s, ["animating"]);
    expect(row(s).stage).toBe("checking_shots");
    expect(m.film.healthSuccess).toHaveBeenCalledTimes(3);
    expect(row(s).costUsd).toBeCloseTo(3 * 5 * 0.112, 4);
  });

  it("a step that died after the lane took a take never films it twice: the next step adopts the handle", async () => {
    const s = await readyToFilm();
    view(await filmShots(s.deps, ADMIN, { sendId: FILM_SEND, campaignId: CAMPAIGN }));
    const m = machine(s);
    s.db.failNextUpdate("press_campaigns");
    // The adoption record lands on the row; the campaign write fails.
    expect(await stepCampaign(m.deps, CAMPAIGN)).toBe("unavailable");
    expect(m.film.submit).toHaveBeenCalledTimes(1);
    await stepCampaign(m.deps, CAMPAIGN);
    expect(m.film.submit).toHaveBeenCalledTimes(3);
    const shots = row(s).shots;
    expect(shots[0].takes[0]).toMatchObject({ status: "filming" });
    expect(shots[0].takes[0].job?.requestId).toBe("req-1");
  });

  it("a take delivered to History by a step whose campaign write was lost is adopted, never retried or charged again", async () => {
    const s = await readyToFilm();
    view(await filmShots(s.deps, ADMIN, { sendId: FILM_SEND, campaignId: CAMPAIGN }));
    const m = machine(s);
    await stepCampaign(m.deps, CAMPAIGN); // submitted
    // Take 1 was collected and its row delivered, but the campaign never heard.
    const take1 = s.db.tables.generations.find((g) => g.id === filmRowId(FILM_SEND, 1))!;
    Object.assign(take1, { status: "succeeded", result_url: "/api/media/generated-videos/u/kept.mp4?v=s", press_tour: { ...(take1.press_tour as object), filmed: true } });
    await stepCampaign(m.deps, CAMPAIGN);
    const t = row(s).shots[0].takes;
    expect(t.map((x) => [x.kind, x.status, x.video])).toEqual([["film", "filmed", "/api/media/generated-videos/u/kept.mp4?v=s"]]);
    expect(m.film.reservePaid).not.toHaveBeenCalled();
    expect(m.film.reserveHouse).not.toHaveBeenCalled();
    expect(m.film.submit).toHaveBeenCalledTimes(3);
  });

  it("a collect whose campaign write fails leaves the row reserved for the next step (no half delivery)", async () => {
    const s = await readyToFilm();
    view(await filmShots(s.deps, ADMIN, { sendId: FILM_SEND, campaignId: CAMPAIGN }));
    const m = machine(s);
    await stepCampaign(m.deps, CAMPAIGN); // submitted
    s.db.failNextUpdate("press_campaigns");
    expect(await stepCampaign(m.deps, CAMPAIGN)).toBe("unavailable");
    expect(s.db.tables.generations.find((g) => g.id === filmRowId(FILM_SEND, 1))?.status).toBe("generating");
    await stepWhile(m, s, ["animating"]);
    expect(row(s).stage).toBe("checking_shots");
    expect(row(s).shots.map((x) => x.takes.map((t) => t.status))).toEqual([["filmed"], ["filmed"], ["filmed"]]);
    expect(row(s).shots.every((x) => x.takes.length === 1)).toBe(true);
  });

  it("a clean ad goes straight to the cut: nothing waits on the person", async () => {
    const s = await readyToFilm();
    view(await filmShots(s.deps, ADMIN, { sendId: FILM_SEND, campaignId: CAMPAIGN }));
    const m = machine(s);
    await stepWhile(m, s, ["animating", "checking_shots"]);
    expect(row(s).stage).toBe("assembling");
    expect(m.film.checkTake).toHaveBeenCalledTimes(3);
    expect(row(s).shots.map((x) => [x.decision, x.chosen])).toEqual([
      ["kept", 1],
      ["kept", 1],
      ["kept", 1],
    ]);
    expect(row(s).productVerdict).toBe("match");
    // Checked on the take itself, with the ad's escalations left over (2 across the ad).
    expect((m.film.checkTake as ReturnType<typeof vi.fn>).mock.calls[0][0]).toMatchObject({ shot: 1, seconds: 5, escalationsLeft: 2, lane: "kling-o3", packshot: false });
  });

  it("a miss starts nothing on its own: the ad waits on the person with the shot's verdict; Keep take 1 makes the cut", async () => {
    const s = await readyToFilm();
    view(await filmShots(s.deps, ADMIN, { sendId: FILM_SEND, campaignId: CAMPAIGN }));
    const m = machine(s, { checks: { 2: clean({ product: "didnt_match", reason: "The words on the label came out different." }) } });
    await stepWhile(m, s, ["animating", "checking_shots"]);
    const before = s.db.tables.generations.length;
    const waiting = view(await getCampaign(s.deps, ADMIN, { campaignId: CAMPAIGN }));
    expect(waiting.stage).toBe("awaiting_approval");
    expect(waiting.blocker).toBe(blockDecideShot(2));
    expect(waiting.shots[1]).toMatchObject({ needsDecision: true, chosenTake: 1, refilmCredits: 2, canRefilm: true });
    expect(waiting.shots[1].takes[0]).toMatchObject({ worst: "didnt_match", product: "didnt_match" });
    expect(row(s).cutDueAt).toBeNull(); // waiting on the person: the 24 h clock stops
    expect(m.film.submit).toHaveBeenCalledTimes(3); // no re-shoot

    const kept = view(await keepTake(s.deps, ADMIN, { campaignId: CAMPAIGN, shot: 2, take: 1 }));
    expect(kept.stage).toBe("assembling");
    expect(row(s).cutDueAt).toBe(new Date(NOW.getTime() + 24 * 3600_000).toISOString());
    expect(s.db.tables.generations.length).toBe(before); // free
    expect(s.kicked).toContain(CAMPAIGN);
  });

  it("Cut this shot is free and makes the cut without it", async () => {
    const s = await readyToFilm();
    view(await filmShots(s.deps, ADMIN, { sendId: FILM_SEND, campaignId: CAMPAIGN }));
    const m = machine(s, { checks: { 3: clean({ product: "product_missing" }) } });
    await stepWhile(m, s, ["animating", "checking_shots"]);
    const charged = row(s).creditsCharged;
    const v = view(await cutShot(s.deps, ADMIN, { campaignId: CAMPAIGN, shot: 3 }));
    expect(v.stage).toBe("assembling");
    expect(v.shots[2]).toMatchObject({ decision: "cut", chosenTake: null });
    expect(row(s).creditsCharged).toBe(charged);
  });

  it("Re-film shot N: priced at that shot's film credits, one row per press, the new take goes up on the wall", async () => {
    const s = await readyToFilm();
    view(await filmShots(s.deps, ADMIN, { sendId: FILM_SEND, campaignId: CAMPAIGN }));
    const checks: Record<number, TakeCheckResult> = { 1: clean({ face: "didnt_match" }) };
    const m = machine(s, { checks });
    await stepWhile(m, s, ["animating", "checking_shots"]);
    const charged = row(s).creditsCharged;
    const v = view(await refilmShot(s.deps, ADMIN, { sendId: REFILM_SEND, campaignId: CAMPAIGN, shot: 1, credits: 2, note: "look at the camera" }));
    expect(v.stage).toBe("animating");
    expect(s.db.tables.generations.find((g) => g.id === refilmRowId(REFILM_SEND))).toMatchObject({ credits_used: 2, status: "generating" });
    expect(row(s).creditsCharged).toBe(charged + 2);
    // The same press again: the same row, charged once.
    const count = s.db.tables.generations.length;
    view(await refilmShot(s.deps, ADMIN, { sendId: REFILM_SEND, campaignId: CAMPAIGN, shot: 1, credits: 2, note: "look at the camera" }));
    expect(s.db.tables.generations.length).toBe(count);
    expect(row(s).creditsCharged).toBe(charged + 2);
    // The person's words were judged before any money moved.
    expect(s.planner.assertPromptAllowed).toHaveBeenCalledWith(expect.objectContaining({ prompt: "look at the camera" }));

    checks[1] = clean();
    await stepWhile(m, s, ["animating", "checking_shots"]);
    const wall = view(await getCampaign(s.deps, ADMIN, { campaignId: CAMPAIGN }));
    expect(wall.stage).toBe("awaiting_approval");
    expect(wall.shots[0].takes.map((t) => t.take)).toEqual([1, 2]);
    expect(wall.shots[0]).toMatchObject({ chosenTake: 2, needsDecision: true, decision: "pending" });
    expect((m.film.submit as ReturnType<typeof vi.fn>).mock.calls[3][0].prompt).toContain("The advertiser asks for this change: look at the camera");
    expect(view(await keepTake(s.deps, ADMIN, { campaignId: CAMPAIGN, shot: 1, take: 2 })).stage).toBe("assembling");
  });

  it("a lane failure whose charge went back is retried once at its price; one whose charge stayed, on the house", async () => {
    const s = await readyToFilm();
    view(await filmShots(s.deps, ADMIN, { sendId: FILM_SEND, campaignId: CAMPAIGN }));
    let failures = 0;
    const m = machine(s, {
      film: {
        poll: vi.fn(async (job) => (job.requestId === "req-1" && failures++ === 0 ? { state: "failed" as const, error: "fal.ai (Kling O3): 500" } : { state: "completed" as const })),
        refund: vi.fn(async () => true),
      },
    });
    await stepCampaign(m.deps, CAMPAIGN); // submit
    await stepCampaign(m.deps, CAMPAIGN); // take 1 fails, retried
    const shot1 = row(s).shots[0];
    expect(shot1.takes.map((t) => [t.kind, t.status, t.credits])).toEqual([
      ["film", "failed", 0],
      ["retry", "reserved", 2],
    ]);
    expect(m.film.reservePaid).toHaveBeenCalledTimes(1);
    expect(m.film.healthFailure).toHaveBeenCalled();
    expect(row(s).creditsRefunded).toBe(2);

    const s2 = await readyToFilm();
    view(await filmShots(s2.deps, ADMIN, { sendId: FILM_SEND, campaignId: CAMPAIGN }));
    let f2 = 0;
    const m2 = machine(s2, {
      film: {
        poll: vi.fn(async (job) => (job.requestId === "req-1" && f2++ === 0 ? { state: "failed" as const, error: "x" } : { state: "completed" as const })),
        refund: vi.fn(async () => false),
      },
    });
    await stepCampaign(m2.deps, CAMPAIGN);
    await stepCampaign(m2.deps, CAMPAIGN);
    expect(row(s2).shots[0].takes.map((t) => [t.kind, t.credits])).toEqual([
      ["film", 2],
      ["retry", 0],
    ]);
    expect(m2.film.reserveHouse).toHaveBeenCalledTimes(1);
    expect(m2.film.reservePaid).not.toHaveBeenCalled();
  });

  it("MONEY (MONEY-2): a shot the output gate refuses never takes the paid ad down with it: it waits on the wall with nothing to keep, and cutting it is free", async () => {
    const s = await readyToFilm();
    view(await filmShots(s.deps, ADMIN, { sendId: FILM_SEND, campaignId: CAMPAIGN }));
    const m = machine(s, {
      film: {
        outputGate: vi.fn(async ({ url }) => (url.includes("req-2") ? { ok: false as const, reason: "refused" as const, message: "Not shown." } : { ok: true as const })),
      },
    });
    await stepWhile(m, s, ["animating", "checking_shots"]);
    const c = row(s);
    expect(c.stage).toBe("awaiting_approval");
    expect(c.error).toBeNull();
    expect(c.shots[1].takes.map((t) => [t.status, t.cause])).toEqual([["failed", "refused"]]); // never retried
    expect(m.notified).toEqual([]);
    const wall = view(await getCampaign(s.deps, ADMIN, { campaignId: CAMPAIGN }));
    expect(wall.shots[1]).toMatchObject({ needsDecision: true, chosenTake: null, canRefilm: true });
    const charged = row(s).creditsCharged;
    const cut = view(await cutShot(s.deps, ADMIN, { campaignId: CAMPAIGN, shot: 2 }));
    expect(cut.stage).toBe("assembling");
    expect(row(s).creditsCharged).toBe(charged);
    expect(row(s).shots.map((x) => x.decision)).toEqual(["kept", "cut", "kept"]);
  });

  it("MONEY (MONEY-2): only when no shot came through does a refusal close the ad; the person hears adFailed", async () => {
    const s = await readyToFilm();
    view(await filmShots(s.deps, ADMIN, { sendId: FILM_SEND, campaignId: CAMPAIGN }));
    const m = machine(s, { film: { outputGate: vi.fn(async () => ({ ok: false as const, reason: "refused" as const, message: "Not shown." })) } });
    await stepWhile(m, s, ["animating"]);
    const c = row(s);
    expect(c.stage).toBe("failed");
    expect(c.error).toBe(FILM_REFUSED);
    expect(c.shots.every((x) => x.takes.length === 1)).toBe(true); // never retried
    expect(m.notified).toEqual([{ key: "adFailed", path: `/app/press-tour?campaign=${CAMPAIGN}` }]);
  });

  it("MONEY (MONEY-2): a paid re-film refused at its own gates fails that take alone: its shot goes back to the wall with take 1, the ad stays", async () => {
    const s = await readyToFilm();
    view(await filmShots(s.deps, ADMIN, { sendId: FILM_SEND, campaignId: CAMPAIGN }));
    const m = machine(s, { checks: { 2: clean({ product: "didnt_match" }) } });
    await stepWhile(m, s, ["animating", "checking_shots"]);
    expect(row(s).stage).toBe("awaiting_approval");
    view(await refilmShot(s.deps, ADMIN, { sendId: REFILM_SEND, campaignId: CAMPAIGN, shot: 2, credits: 2, note: "hold the bottle higher" }));
    // The combined prompt is refused at submit (the note alone passed at the press).
    (m.film.promptGate as ReturnType<typeof vi.fn>).mockImplementation(async () => ({ ok: false, reason: "refused", message: "Not shown." }));
    await stepWhile(m, s, ["animating", "checking_shots"]);
    const c = row(s);
    expect(c.stage).toBe("awaiting_approval");
    expect(c.error).toBeNull();
    expect(c.shots[1].takes.map((t) => [t.kind, t.status, t.cause, t.credits])).toEqual([
      ["film", "checked", null, 2],
      ["refilm", "failed", "refused", 0], // refused before the lane: its credits went back, forced
    ]);
    const wall = view(await getCampaign(s.deps, ADMIN, { campaignId: CAMPAIGN }));
    expect(wall.shots[1]).toMatchObject({ decision: "pending", needsDecision: true, chosenTake: 1 });
    expect(m.notified).toEqual([]);
    // Keep take 1 makes the cut.
    expect(view(await keepTake(s.deps, ADMIN, { campaignId: CAMPAIGN, shot: 2, take: 1 })).stage).toBe("assembling");
  });

  it("MONEY (MONEY-5): Re-film at a price that moved since the wall was drawn is refused with the new price, and nothing is reserved", async () => {
    const s = await readyToFilm();
    view(await filmShots(s.deps, ADMIN, { sendId: FILM_SEND, campaignId: CAMPAIGN }));
    const m = machine(s, { checks: { 1: clean({ face: "didnt_match" }) } });
    await stepWhile(m, s, ["animating", "checking_shots"]);
    const before = s.db.tables.generations.length;
    const charged = row(s).creditsCharged;
    expect(await refilmShot(s.deps, ADMIN, { sendId: REFILM_SEND, campaignId: CAMPAIGN, shot: 1, credits: 1 })).toEqual({ ok: false, error: priceChanged(2) });
    expect(await refilmShot(s.deps, ADMIN, { sendId: REFILM_SEND, campaignId: CAMPAIGN, shot: 1 } as never)).toEqual({ ok: false, error: CAMPAIGN_BAD_REQUEST });
    expect(s.db.tables.generations.length).toBe(before);
    expect(row(s).creditsCharged).toBe(charged);
    expect(view(await refilmShot(s.deps, ADMIN, { sendId: REFILM_SEND, campaignId: CAMPAIGN, shot: 1, credits: 2 })).stage).toBe("animating");
  });

  it("PT-R3-05: the ad's product verdict is the worst of the takes that go INTO the cut", async () => {
    // Cut the mismatched shot out: the ad's verdict is clean.
    const s = await readyToFilm();
    view(await filmShots(s.deps, ADMIN, { sendId: FILM_SEND, campaignId: CAMPAIGN }));
    const m = machine(s, { checks: { 2: clean({ product: "didnt_match" }) } });
    await stepWhile(m, s, ["animating", "checking_shots"]);
    expect(row(s).productVerdict).toBe("didnt_match");
    view(await cutShot(s.deps, ADMIN, { campaignId: CAMPAIGN, shot: 2 }));
    expect(row(s).productVerdict).toBe("match");

    // Re-filmed and matched, then the person keeps the mismatched take 1: the verdict says so.
    const s2 = await readyToFilm();
    view(await filmShots(s2.deps, ADMIN, { sendId: FILM_SEND, campaignId: CAMPAIGN }));
    const checks: Record<number, TakeCheckResult> = { 2: clean({ product: "didnt_match" }) };
    const m2 = machine(s2, { checks });
    await stepWhile(m2, s2, ["animating", "checking_shots"]);
    view(await refilmShot(s2.deps, ADMIN, { sendId: REFILM_SEND, campaignId: CAMPAIGN, shot: 2, credits: 2 }));
    checks[2] = clean();
    await stepWhile(m2, s2, ["animating", "checking_shots"]);
    expect(row(s2).productVerdict).toBe("match");
    view(await keepTake(s2.deps, ADMIN, { campaignId: CAMPAIGN, shot: 2, take: 1 }));
    expect(row(s2).productVerdict).toBe("didnt_match");

    // A missing product counts as a miss too.
    const s3 = await readyToFilm();
    view(await filmShots(s3.deps, ADMIN, { sendId: FILM_SEND, campaignId: CAMPAIGN }));
    const m3 = machine(s3, { checks: { 3: clean({ product: "product_missing" }) } });
    await stepWhile(m3, s3, ["animating", "checking_shots"]);
    view(await keepTake(s3.deps, ADMIN, { campaignId: CAMPAIGN, shot: 3, take: 1 }));
    expect(row(s3).productVerdict).toBe("product_missing");
  });
});

describe.skipIf(!HAS_FFMPEG)("the cut, for real (tiny clips through ffmpeg-static)", () => {
  async function toCut(s: World, m: ReturnType<typeof machine>) {
    view(await filmShots(s.deps, ADMIN, { sendId: FILM_SEND, campaignId: CAMPAIGN, locale: "it" }));
    await stepWhile(m, s, ["animating", "checking_shots"]);
    expect(row(s).stage).toBe("assembling");
  }

  it(
    "segments, join, clean + tagged renditions, signing (unsigned, and why), delivery to History, adReady",
    async () => {
      const s = await readyToFilm();
      const m = machine(s);
      await toCut(s, m);
      await stepWhile(m, s, ["assembling", "signing"]);
      const c = row(s);
      expect(c.stage).toBe("ready");
      expect(c.deliveredAt).toBe(NOW.toISOString());
      expect(c.cutDueAt).toBeNull();
      expect(c.masterGenerationId).toBe(masterRowId(CAMPAIGN));
      const master = s.db.tables.generations.find((g) => g.id === masterRowId(CAMPAIGN))!;
      expect(master).toMatchObject({ model_id: "press-tour-cut", credits_used: 0, status: "succeeded", content_type: "video", video_aspect_ratio: "9:16" });

      const recs = c.renditions as Record<string, { path: string; seconds: number; signed: boolean; reason: string }>;
      expect(recs.clean.signed).toBe(false);
      expect(recs.clean.reason).toBe(SIGN_NOT_CONFIGURED);
      expect(recs.clean.seconds).toBeCloseTo(15, 0);
      // No brand kit: no end card, so both are the film's length.
      expect(recs.tagged.seconds).toBeCloseTo(15, 0);
      expect(recs.clean.path).not.toBe(recs.tagged.path);

      const v = view(await getCampaign(s.deps, ADMIN, { campaignId: CAMPAIGN }));
      expect(v.master?.renditions.map((r) => [r.kind, r.signed])).toEqual([
        ["clean", false],
        ["tagged", false],
      ]);
      expect(v.master?.adminNote).toContain(SIGN_NOT_CONFIGURED);
      // No brand kit, so no end card: the page must not promise one (PT-R3-07).
      expect(v.master?.hasEndCard).toBe(false);
      const planUser = view(await getCampaign(s.deps, { userId: USER_A, via: "admin" }, { campaignId: CAMPAIGN }));
      expect(planUser.master?.generationId).toBe(masterRowId(CAMPAIGN));
      expect(m.notified).toEqual([{ key: "adReady", path: `/app/press-tour?campaign=${CAMPAIGN}` }]);
      // The segments are gone once delivered; the renditions stay.
      expect([...s.db.files.keys()].filter((k) => k.includes("/seg-"))).toEqual([]);
      expect(s.db.files.has(`press-kit/${recs.clean.path}`)).toBe(true);

      // The files themselves: the preset's frame and rate, silence instead of the take's tone, faststart.
      for (const kind of ["clean", "tagged"] as const) {
        const file = join(work, `${kind}.mp4`);
        writeFileSync(file, s.db.files.get(`press-kit/${recs[kind].path}`)!);
        let info = "";
        try {
          execFileSync(ffmpegPath, ["-hide_banner", "-i", file], { stdio: "pipe" });
        } catch (err) {
          info = String((err as { stderr?: Buffer }).stderr ?? "");
        }
        expect(info).toMatch(/Video: h264 \(High\)/);
        expect(info).toContain(`${SMALL.width}x${SMALL.height}`);
        expect(info).toMatch(/30 tbr/);
        expect(info).toMatch(/Audio: aac \(LC\).*48000 Hz, stereo/);
        // Both files carry the machine-readable AI marking, the clean TikTok file included (PT-R3-03).
        expect(info, kind).toContain("comment         : AI-generated with Picacho Press Tour");
        expect(info, kind).toContain("trainedAlgorithmicMedia");
        // The take carried a 440 Hz tone: the cut carries silence instead (audio off, music off).
        const volume = spawnSync(ffmpegPath, ["-hide_banner", "-i", file, "-af", "volumedetect", "-f", "null", "-"], { encoding: "utf8" });
        const max = Number(/max_volume: (-?[\d.]+) dB/.exec(volume.stderr ?? "")?.[1] ?? "0");
        expect(max).toBeLessThan(-80);
      }

      // The tag: in the tagged file, bottom-left (nothing located), never in the clean one.
      const corner = async (kind: "clean" | "tagged") => {
        const png = join(work, `${kind}.png`);
        execFileSync(ffmpegPath, ["-y", "-v", "error", "-ss", "1", "-i", join(work, `${kind}.mp4`), "-frames:v", "1", png]);
        const h = Math.round(SMALL.height * 0.02);
        const region = { left: Math.round(SMALL.width * 0.03), top: SMALL.height - Math.round(SMALL.height * 0.025) - h, width: 8, height: Math.max(1, h) };
        // stats() reads the INPUT, whatever the pipeline says: cut first, then read.
        const stats = await sharp(await sharp(png).extract(region).toBuffer()).stats();
        return stats.channels[0].mean;
      };
      expect(await corner("clean")).toBeGreaterThan(230); // white film
      expect(await corner("tagged")).toBeLessThan(200); // the tag's dark chip
    },
    60_000,
  );

  it(
    "with a confirmed brand logo the tagged rendition carries a 1.5 s end card; the clean one never does",
    async () => {
      const s = await readyToFilm();
      const logo = await sharp({ create: { width: 64, height: 32, channels: 4, background: "#e0a468" } }).png().toBuffer();
      const m = machine(s, { cut: { brand: vi.fn(async () => ({ logo, background: "#101010" })) } });
      s.db.tables.press_campaigns[0].brand_kit_id = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
      await toCut(s, m);
      await stepWhile(m, s, ["assembling", "signing"]);
      const recs = row(s).renditions as Record<string, { seconds: number }>;
      expect(recs.clean.seconds).toBeCloseTo(15, 0);
      expect(recs.tagged.seconds).toBeCloseTo(16.5, 0);
    },
    60_000,
  );

  it(
    "three failed cut steps park the ad for the team; 'Make the cut' runs it again for free",
    async () => {
      const s = await readyToFilm();
      const m = machine(s, { cut: { run: vi.fn(async () => ({ ok: false as const, error: "encoder exploded" })) } });
      await toCut(s, m);
      for (let i = 0; i < 3; i++) await stepCampaign(m.deps, CAMPAIGN);
      const c = row(s);
      expect(c.stage).toBe("awaiting_approval");
      expect((c.assembly as { parked: boolean; failures: number }).parked).toBe(true);
      expect(c.cutDueAt).not.toBeNull(); // we still owe it: the 24 h rule keeps running
      expect(m.admins).toContain("Press Tour cut stuck");
      expect(view(await getCampaign(s.deps, ADMIN, { campaignId: CAMPAIGN })).blocker).toBe(CUT_STALLED);
      const rows = s.db.tables.generations.length;
      const again = view(await assembleNow(s.deps, ADMIN, { campaignId: CAMPAIGN }));
      expect(again.stage).toBe("assembling");
      expect((row(s).assembly as { parked: boolean; failures: number }).parked).toBe(false);
      expect(s.db.tables.generations.length).toBe(rows);
    },
    60_000,
  );
});

describe("the 24 h rule and waiting", () => {
  it("an ad we owed for a day closes: open takes settled, delivered takes refunded by the ordinary rules, the shots stay in History", async () => {
    const s = await readyToFilm();
    view(await filmShots(s.deps, ADMIN, { sendId: FILM_SEND, campaignId: CAMPAIGN }));
    const m = machine(s);
    await stepCampaign(m.deps, CAMPAIGN); // submitted
    await stepCampaign(m.deps, CAMPAIGN); // two collected, one still filming
    s.db.clock.now = new Date(NOW.getTime() + 25 * 3600_000);
    const report = await pressTick(m.deps, { batch: 4 });
    expect(report.late).toBe(1);
    const c = row(s);
    expect(c.stage).toBe("failed");
    expect(c.error).toBe(cutLateRefunded(6));
    expect(c.creditsRefunded).toBe(6);
    // The two delivered takes through the authority (not forced); the one in the lane stopped and settled.
    expect((m.cut.refund as ReturnType<typeof vi.fn>).mock.calls.map((x) => x[1])).toEqual([{}, {}]);
    expect(m.film.cancel).toHaveBeenCalledTimes(1);
    expect(m.settled).toEqual([filmRowId(FILM_SEND, 3)]);
    expect(s.db.tables.generations.find((g) => g.id === filmRowId(FILM_SEND, 1))?.status).toBe("succeeded");
    // Credits went back: the phone says "what came back" (PT-R3-04).
    expect(m.notified).toEqual([{ key: "adFailedRefunded", path: `/app/press-tour?campaign=${CAMPAIGN}` }]);
    expect(m.admins).toContain("Press Tour ad late");
  });

  it("an account whose refunds don't go through hears it plainly", async () => {
    const s = await readyToFilm();
    view(await filmShots(s.deps, ADMIN, { sendId: FILM_SEND, campaignId: CAMPAIGN }));
    const m = machine(s, { cut: { refund: vi.fn(async () => false) } });
    await stepWhile(m, s, ["animating"]);
    s.db.clock.now = new Date(NOW.getTime() + 25 * 3600_000);
    await lateCuts(m.deps);
    expect(row(s)).toMatchObject({ stage: "failed", error: CUT_LATE, creditsRefunded: 0 });
    // Nothing came back: the phone promises nothing (PT-R3-04).
    expect(m.notified).toEqual([{ key: "adFailed", path: `/app/press-tour?campaign=${CAMPAIGN}` }]);
  });

  it("MONEY (MONEY-6): a claim landing between the 24 h rule's read and its write is seen: the ad a step is delivering is never closed and refunded under it", async () => {
    const s = await readyToFilm();
    view(await filmShots(s.deps, ADMIN, { sendId: FILM_SEND, campaignId: CAMPAIGN }));
    const m = machine(s);
    await stepWhile(m, s, ["animating", "checking_shots"]);
    const c = s.db.tables.press_campaigns[0];
    c.stage = "signing";
    s.db.clock.now = new Date(NOW.getTime() + 25 * 3600_000);
    // The cron's claim lands right after lateCuts read the ad unlocked (claim_press_campaigns sets the lease and the version).
    let reads = 0;
    const real = s.db.db as unknown as { from: (t: string) => Record<string, (...a: unknown[]) => unknown> };
    const racing = {
      ...(s.db.db as object),
      from: (table: string) => {
        const b = real.from(table);
        if (table !== "press_campaigns") return b;
        const maybeSingle = b.maybeSingle;
        b.maybeSingle = async (...a: unknown[]) => {
          const r = await maybeSingle(...a);
          if (++reads === 1) Object.assign(c, { locked_at: s.db.clock.now.toISOString(), version: Number(c.version) + 1 });
          return r;
        };
        return b;
      },
    } as unknown as MachineDeps["db"];
    expect(await lateCuts({ ...m.deps, db: racing })).toBe(0);
    expect(row(s)).toMatchObject({ stage: "signing", creditsRefunded: 0 });
    expect(m.cut.refund).not.toHaveBeenCalled();
    // Once the lease has run out, the rule closes it as before.
    s.db.clock.now = new Date(s.db.clock.now.getTime() + LEASE_MS + 1000);
    expect(await lateCuts(m.deps)).toBe(1);
    expect(row(s).stage).toBe("failed");
  });

  it("PT-R3-07: the finished ad says it has an end card only when the cut made one", () => {
    const base = { stage: "ready" as const, renditions: null, masterGenerationId: null };
    expect(masterView({ ...base, assembly: { endCard: "u/press/c/end-card.mp4", endCardDone: true, cleaned: true } }, {}, false)?.hasEndCard).toBe(true);
    expect(masterView({ ...base, assembly: { endCard: null, endCardDone: true } }, {}, false)?.hasEndCard).toBe(false);
    expect(masterView({ ...base, assembly: null }, {}, false)?.hasEndCard).toBe(false);
  });

  it("waiting on the person is never 'late', and a delivered ad is never touched", async () => {
    const s = await readyToFilm();
    view(await filmShots(s.deps, ADMIN, { sendId: FILM_SEND, campaignId: CAMPAIGN }));
    const m = machine(s, { checks: { 1: clean({ product: "didnt_match" }) } });
    await stepWhile(m, s, ["animating", "checking_shots"]);
    expect(row(s).stage).toBe("awaiting_approval");
    s.db.clock.now = new Date(NOW.getTime() + 3 * 24 * 3600_000);
    expect(await lateCuts(m.deps)).toBe(0);
    expect(row(s).stage).toBe("awaiting_approval");
  });

  it("after 7 days on the press wall the ad closes, and the words say the shots are in History", async () => {
    const s = await readyToFilm();
    view(await filmShots(s.deps, ADMIN, { sendId: FILM_SEND, campaignId: CAMPAIGN }));
    const m = machine(s, { checks: { 1: clean({ product: "didnt_match" }) } });
    await stepWhile(m, s, ["animating", "checking_shots"]);
    s.db.clock.now = new Date(NOW.getTime() + 8 * 24 * 3600_000);
    await pressTick(m.deps, { batch: 4 });
    expect(row(s)).toMatchObject({ stage: "expired", error: FILM_EXPIRED });
  });

  it("a campaign whose plan vanished still fails with its own words", async () => {
    const s = await readyToFilm();
    view(await filmShots(s.deps, ADMIN, { sendId: FILM_SEND, campaignId: CAMPAIGN }));
    s.db.tables.press_campaigns[0].plan = null;
    const m = machine(s);
    expect(await stepCampaign(m.deps, CAMPAIGN)).toBe("failed");
    expect(s.db.tables.press_campaigns[0].error).toBe(PAINT_FAILED);
    // Every reserved take went back (forced: nothing was sent).
    expect(m.released).toEqual([1, 2, 3].map((n) => filmRowId(FILM_SEND, n)));
  });
});
