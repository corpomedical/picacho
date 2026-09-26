import type { SupabaseClient } from "@supabase/supabase-js";
import { beforeAll, describe, expect, it } from "vitest";
import { CAMPAIGN_STAGES } from "./campaign-types";
import { PRESS_KIT_BUCKET } from "./card-service";
import { CLOSED_STAGES, OPEN_STAGES, getPressTourHome } from "./door-data";
import { photosHash } from "../characters/likeness";

// What the Press Tour door opens on, against an in-memory Supabase that
// behaves like the admins' read policy: EVERY row is visible unless the query
// names its owner. The door opens to admins first, so a read that leaned on
// RLS alone would show an admin every account's products.

const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";
const P1 = "33333333-3333-4333-8333-333333333333";
const P2 = "44444444-4444-4444-8444-444444444444";
const K1 = "55555555-5555-4555-8555-555555555555";
const C1 = "66666666-6666-4666-8666-666666666666";

type Row = Record<string, unknown>;

function product(id: string, userId: string, extra: Row = {}): Row {
  return {
    id,
    user_id: userId,
    name: `Product ${id.slice(0, 4)}`,
    brand_kit_id: null,
    source_url: null,
    category: "beverage",
    dna: null,
    dna_photos: [],
    label_strings: [],
    no_readable_text: false,
    image_paths: [`${userId}/products/${id}/a.jpg`],
    logo_path: null,
    logo_box: null,
    palette: [],
    angles: [],
    lock_refs: [],
    photos_hash: null,
    status: "draft",
    confirmed_at: null,
    created_at: "2026-09-26T00:00:00Z",
    updated_at: "2026-09-26T00:00:00Z",
    deleted_at: null,
    ...extra,
  };
}

function kit(id: string, userId: string, extra: Row = {}): Row {
  return {
    id,
    user_id: userId,
    name: "Solstad",
    source_url: null,
    logo_path: `${userId}/brand/${id}/logo-1.png`,
    palette: ["#1f3b2d", "#e0a468"],
    fonts: [],
    tone: null,
    tagline: null,
    default_cta: null,
    photos_hash: null,
    status: "draft",
    confirmed_at: null,
    created_at: "2026-09-26T00:00:00Z",
    updated_at: "2026-09-26T00:00:00Z",
    deleted_at: null,
    ...extra,
  };
}

type Query = { table: string; filters: string[] };

/**
 * What press-kit holds, for the fake: by default every path; `missing` paths
 * are answered as the storage API answers a file it does not have (an error,
 * no link); `down` fails the whole call.
 */
type Store = { missing?: ReadonlySet<string>; down?: boolean };

/** A query builder that filters like PostgREST and records what each query named. */
function fakeClient(tables: Record<string, Row[] | Error>, log: Query[], signed: string[][], store: Store = {}) {
  const client = {
    from(table: string) {
      const q: Query = { table, filters: [] };
      log.push(q);
      const preds: ((r: Row) => boolean)[] = [];
      let limit = Infinity;
      const run = () => {
        const rows = tables[table];
        if (rows instanceof Error || rows === undefined) return { data: null, error: { message: "relation does not exist" } };
        return { data: rows.filter((r) => preds.every((p) => p(r))).slice(0, limit), error: null };
      };
      const builder = {
        select: () => builder,
        eq(col: string, value: unknown) {
          q.filters.push(`eq:${col}=${String(value)}`);
          preds.push((r) => r[col] === value);
          return builder;
        },
        is(col: string, value: unknown) {
          q.filters.push(`is:${col}=${String(value)}`);
          preds.push((r) => (r[col] ?? null) === value);
          return builder;
        },
        in(col: string, values: unknown[]) {
          q.filters.push(`in:${col}`);
          preds.push((r) => values.includes(r[col]));
          return builder;
        },
        order: () => builder,
        limit(n: number) {
          limit = n;
          return builder;
        },
        maybeSingle: async () => {
          const res = run();
          return { data: res.data?.[0] ?? null, error: res.error };
        },
        then(resolve: (v: unknown) => void, reject: (e: unknown) => void) {
          return Promise.resolve(run()).then(resolve, reject);
        },
      };
      return builder;
    },
    storage: {
      from(bucket: string) {
        return {
          async createSignedUrls(paths: string[]) {
            expect(bucket).toBe(PRESS_KIT_BUCKET);
            signed.push(paths);
            if (store.down) throw new Error("storage is down");
            return {
              data: paths.map((path) =>
                store.missing?.has(path)
                  ? { path, signedUrl: null, error: "Either the object does not exist or you do not have access to it" }
                  : { path, signedUrl: `https://signed/${path}`, error: null },
              ),
              error: null,
            };
          },
        };
      },
    },
  };
  return client as unknown as SupabaseClient;
}

beforeAll(() => {
  // mediaUrl signs character thumbnails with this key (lib/media/url.ts).
  process.env.MEDIA_SIGNING_SECRET ||= "test-signing-secret";
});

describe("the Press Tour door's first read", () => {
  it("shows only the person's own characters, products and brand kits, even to an admin who could read every row", async () => {
    const log: Query[] = [];
    const signed: string[][] = [];
    const tables = {
      character_profiles: [
        { id: C1, user_id: A, name: "Eva", reference_image_urls: [`${A}/eva-1.jpg`, `${A}/eva-2.jpg`] },
        { id: "c-b", user_id: B, name: "Someone else", reference_image_urls: [] },
      ],
      products: [product(P1, A), product(P2, B)],
      brand_kits: [kit(K1, A), kit("k-b", B)],
      press_campaigns: new Error("missing"),
    };
    const db = fakeClient(tables, log, signed);
    const home = await getPressTourHome({ db, admin: fakeClient(tables, log, signed) }, A);

    expect(home.characters.map((c) => c.name)).toEqual(["Eva"]);
    expect(home.characters[0].photoCount).toBe(2);
    expect(home.characters[0].photoUrl).toMatch(/^\/api\/media\/character-references\//);
    expect(home.products.map((p) => p.card.id)).toEqual([P1]);
    expect(home.brandKits.map((k) => k.kit.id)).toEqual([K1]);
    // Every read named its owner.
    for (const table of ["character_profiles", "products", "brand_kits", "press_campaigns"]) {
      const reads = log.filter((q) => q.table === table);
      expect(reads.length, table).toBeGreaterThan(0);
      for (const q of reads) expect(q.filters, table).toContain(`eq:user_id=${A}`);
    }
    // Deleted and archived rows stay off the shelves.
    for (const table of ["products", "brand_kits"]) {
      const q = log.find((x) => x.table === table)!;
      expect(q.filters).toContain("is:deleted_at=null");
      expect(q.filters).toContain("in:status");
    }
  });

  it("signs only the person's own press-kit paths, in one call, and hands each card its own links", async () => {
    const log: Query[] = [];
    const signed: string[][] = [];
    const stray = `${B}/products/${P1}/b.jpg`;
    const tables = {
      character_profiles: [],
      products: [product(P1, A, { image_paths: [`${A}/products/${P1}/a.jpg`, stray], logo_path: `${A}/products/${P1}/logo-x.png` })],
      brand_kits: [kit(K1, A)],
      press_campaigns: [],
    };
    const home = await getPressTourHome({ db: fakeClient(tables, log, signed), admin: fakeClient(tables, log, signed) }, A);
    expect(signed).toHaveLength(1);
    expect(signed[0]).not.toContain(stray);
    expect(signed[0]).toEqual(
      expect.arrayContaining([`${A}/products/${P1}/a.jpg`, `${A}/products/${P1}/logo-x.png`, `${A}/brand/${K1}/logo-1.png`]),
    );
    const card = home.products[0];
    expect(Object.keys(card.photoUrls).sort()).toEqual([`${A}/products/${P1}/a.jpg`, `${A}/products/${P1}/logo-x.png`].sort());
    expect(home.brandKits[0].logoUrl).toBe(`https://signed/${A}/brand/${K1}/logo-1.png`);
  });

  it("finds the newest campaign that is not closed, and reads none before its table exists", async () => {
    expect(OPEN_STAGES).not.toEqual(expect.arrayContaining(["failed"]));
    expect([...OPEN_STAGES, ...CLOSED_STAGES].sort()).toEqual([...CAMPAIGN_STAGES].sort());
    expect(OPEN_STAGES).toContain("ready");

    const open = { id: "camp-1", user_id: A, stage: "awaiting_approval", deleted_at: null };
    const other = { id: "camp-b", user_id: B, stage: "painting", deleted_at: null };
    const closed = { id: "camp-0", user_id: A, stage: "failed", deleted_at: null };
    const withTable = { character_profiles: [], products: [], brand_kits: [], press_campaigns: [other, closed, open] };
    const home = await getPressTourHome({ db: fakeClient(withTable, [], []), admin: fakeClient(withTable, [], []) }, A);
    expect(home.openCampaignId).toBe("camp-1");

    const before = { character_profiles: [], products: [], brand_kits: [], press_campaigns: new Error("missing") };
    const early = await getPressTourHome({ db: fakeClient(before, [], []), admin: fakeClient(before, [], []) }, A);
    expect(early.openCampaignId).toBeNull();
  });

  it("gives each star the answer kept for its photos now, from the person's own rows only", async () => {
    const log: Query[] = [];
    const eva = [`${A}/eva-1.jpg`, `${A}/eva-2.jpg`];
    const tables = {
      character_profiles: [
        { id: C1, user_id: A, name: "Eva", reference_image_urls: eva },
        { id: "c-2", user_id: A, name: "Marco", reference_image_urls: [`${A}/marco-1.jpg`] },
      ],
      products: [],
      brand_kits: [],
      press_campaigns: [],
      character_ad_consents: [
        // Eva's answer, for exactly her photos now.
        { user_id: A, character_id: C1, answer: "me", ads_ok: true, photos_hash: photosHash(eva) },
        // Marco's answer was for other photos: it asks again.
        { user_id: A, character_id: "c-2", answer: "permission", ads_ok: true, photos_hash: photosHash([`${A}/old.jpg`]) },
        // Someone else's row about Marco never counts.
        { user_id: B, character_id: "c-2", answer: "me", ads_ok: true, photos_hash: photosHash([`${A}/marco-1.jpg`]) },
      ],
    };
    const home = await getPressTourHome({ db: fakeClient(tables, log, []), admin: fakeClient(tables, [], []) }, A);
    expect(home.characters.map((c) => [c.name, c.adAnswer])).toEqual([
      ["Eva", "me"],
      ["Marco", null],
    ]);
    const read = log.find((q) => q.table === "character_ad_consents")!;
    expect(read.filters).toContain(`eq:user_id=${A}`);
    expect(read.filters).toContain("in:character_id");

    // Before press-tour-03-campaigns.sql: no table, no answers, the tile asks.
    const before = { ...tables, character_ad_consents: new Error("missing") };
    const early = await getPressTourHome({ db: fakeClient(before, [], []), admin: fakeClient(before, [], []) }, A);
    expect(early.characters.map((c) => c.adAnswer)).toEqual([null, null]);
  });

  it("counts and shows a product photo only when press-kit holds it: a Product Studio leftover's photo in another bucket is neither", async () => {
    // The operator's door, 2026-09-26: "Climax shirt · 1 photos" with a blank
    // picture. Its row is from the 2026-08-27 experiment, whose files are in
    // the character-references bucket; Press Tour reads press-kit alone.
    const OLD = "77777777-7777-4777-8777-777777777777";
    const oldPhoto = `${A}/products/${OLD}/shirt-front.jpg`;
    const oldLogo = `${A}/products/${OLD}/logo.png`;
    const newPhoto = `${A}/products/${P1}/a.jpg`;
    const tables = {
      character_profiles: [],
      products: [
        product(OLD, A, { name: "Climax shirt", image_paths: [oldPhoto], logo_path: oldLogo }),
        product(P1, A, { image_paths: [newPhoto] }),
      ],
      brand_kits: [],
      press_campaigns: [],
    };
    const signed: string[][] = [];
    const home = await getPressTourHome(
      { db: fakeClient(tables, [], signed), admin: fakeClient(tables, [], signed, { missing: new Set([oldPhoto, oldLogo]) }) },
      A,
    );
    // Asked once, in press-kit only (the fake refuses any other bucket).
    expect(signed).toHaveLength(1);
    const byId = new Map(home.products.map((p) => [p.card.id, p]));
    const leftover = byId.get(OLD)!;
    expect(leftover.card.photos).toEqual([]);
    expect(leftover.card.logoPath).toBeNull();
    expect(leftover.photoUrls).toEqual({});
    // The normal product's one photo counts and shows.
    const fine = byId.get(P1)!;
    expect(fine.card.photos).toEqual([newPhoto]);
    expect(fine.photoUrls).toEqual({ [newPhoto]: `https://signed/${newPhoto}` });
  });

  it("when press-kit can't be asked, a card's own photos still count (nothing is known to be missing), with no picture", async () => {
    const photo = `${A}/products/${P1}/a.jpg`;
    const tables = { character_profiles: [], products: [product(P1, A)], brand_kits: [kit(K1, A)], press_campaigns: [] };
    const home = await getPressTourHome({ db: fakeClient(tables, [], []), admin: fakeClient(tables, [], [], { down: true }) }, A);
    expect(home.products[0].card.photos).toEqual([photo]);
    expect(home.products[0].photoUrls).toEqual({});
    expect(home.brandKits[0].logoUrl).toBeNull();
  });

  it("opens on empty shelves when a read fails, never a broken door", async () => {
    const broken = { character_profiles: new Error("x"), products: new Error("x"), brand_kits: new Error("x"), press_campaigns: new Error("x") };
    const home = await getPressTourHome({ db: fakeClient(broken, [], []), admin: fakeClient(broken, [], []) }, A);
    expect(home).toEqual({ characters: [], products: [], brandKits: [], openCampaignId: null });
  });
});
