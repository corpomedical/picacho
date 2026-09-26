import type { SupabaseClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { photosHash } from "../characters/likeness";
import { MAPPED_SERVER_STRINGS, localizeServerText } from "../i18n/server-text";
import es from "../i18n/messages/es";
import {
  STAR_ADS_OK_REQUIRED,
  STAR_CONSENT_FAILED,
  STAR_CONSENT_MESSAGES,
  STAR_CONSENT_METHOD,
  STAR_CONSENT_NOTICE_VERSION,
  STAR_NEEDS_PHOTO,
  STAR_NOT_YOURS,
  STAR_WRITE_LIMIT,
  currentStarAnswer,
  keepStarConsent,
} from "./star-consent";

// The star's say-so for ads (critique #9): "Who is Eva?" and "Eva may appear
// in ads for products I sell", kept by the server for exactly the photos on
// the character now. The Starring tile's "You said…" line is printed only
// from a row this module wrote.

const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";
const EVA = "44444444-4444-4444-8444-444444444444";
const PHOTOS = [`${A}/eva-1.jpg`, `${A}/eva-2.jpg`];

type Row = Record<string, unknown>;

function clients(opts: { characters?: Row[]; insertError?: boolean; readError?: boolean } = {}) {
  const inserted: { table: string; row: Row }[] = [];
  const characters = opts.characters ?? [{ id: EVA, user_id: A, reference_image_urls: PHOTOS }];
  const db = {
    from(table: string) {
      const preds: ((r: Row) => boolean)[] = [];
      const builder = {
        select: () => builder,
        eq(col: string, value: unknown) {
          preds.push((r) => r[col] === value);
          return builder;
        },
        maybeSingle: async () => {
          if (opts.readError) return { data: null, error: { message: "down" } };
          const rows = table === "character_profiles" ? characters : [];
          return { data: rows.find((r) => preds.every((p) => p(r))) ?? null, error: null };
        },
      };
      return builder;
    },
  } as unknown as SupabaseClient;
  const admin = {
    from(table: string) {
      return {
        async insert(row: Row) {
          inserted.push({ table, row });
          return { error: opts.insertError ? { message: "check violated" } : null };
        },
      };
    },
  } as unknown as SupabaseClient;
  return { db, admin, inserted };
}

const allow = async () => false;
const hashKey = (value: string | null | undefined, scope: string) => `hashed:${scope}:${value}`;
const context = { locale: "es", ip: "203.0.113.9" };

describe("keeping the star's answer", () => {
  it("writes one row for exactly the photos the character has now, with the server's notice, method and place", async () => {
    const c = clients();
    const res = await keepStarConsent({ ...c, rateLimited: allow, hashKey }, A, { characterId: EVA, answer: "me", adsOk: true }, context);
    expect(res).toEqual({ error: null, answer: "me" });
    expect(c.inserted).toHaveLength(1);
    expect(c.inserted[0].table).toBe("character_ad_consents");
    expect(c.inserted[0].row).toEqual({
      user_id: A,
      character_id: EVA,
      answer: "me",
      ads_ok: true,
      photos_hash: photosHash(PHOTOS),
      notice_version: STAR_CONSENT_NOTICE_VERSION,
      locale: "es",
      method: STAR_CONSENT_METHOD,
      place: "door",
      ip_hash: "hashed:press-consent:203.0.113.9",
    });
  });

  it("refuses an answer that is not one of the three, and never writes without the ads tick", async () => {
    const c = clients();
    const deps = { ...c, rateLimited: allow, hashKey };
    expect(await keepStarConsent(deps, A, { characterId: EVA, answer: "maybe", adsOk: true }, context)).toEqual({ error: STAR_CONSENT_FAILED });
    expect(await keepStarConsent(deps, A, { characterId: "not-an-id", answer: "me", adsOk: true }, context)).toEqual({ error: STAR_CONSENT_FAILED });
    expect(await keepStarConsent(deps, A, { characterId: EVA, answer: "permission", adsOk: false }, context)).toEqual({ error: STAR_ADS_OK_REQUIRED });
    expect(await keepStarConsent(deps, A, { characterId: EVA, answer: "permission", adsOk: "yes" }, context)).toEqual({ error: STAR_ADS_OK_REQUIRED });
    expect(c.inserted).toHaveLength(0);
  });

  it("answers only for the person's own character, one with photos", async () => {
    const theirs = clients({ characters: [{ id: EVA, user_id: B, reference_image_urls: PHOTOS }] });
    expect(await keepStarConsent({ ...theirs, rateLimited: allow, hashKey }, A, { characterId: EVA, answer: "me", adsOk: true }, context)).toEqual({ error: STAR_NOT_YOURS });
    const bare = clients({ characters: [{ id: EVA, user_id: A, reference_image_urls: [] }] });
    expect(await keepStarConsent({ ...bare, rateLimited: allow, hashKey }, A, { characterId: EVA, answer: "me", adsOk: true }, context)).toEqual({ error: STAR_NEEDS_PHOTO });
    expect(theirs.inserted).toHaveLength(0);
    expect(bare.inserted).toHaveLength(0);
  });

  it("fails closed: over the hour's writes, a read that errors, or a write the database refuses", async () => {
    const c = clients();
    expect(await keepStarConsent({ ...c, rateLimited: async () => true, hashKey }, A, { characterId: EVA, answer: "me", adsOk: true }, context)).toEqual({ error: STAR_WRITE_LIMIT });
    const down = clients({ readError: true });
    expect(await keepStarConsent({ ...down, rateLimited: allow, hashKey }, A, { characterId: EVA, answer: "me", adsOk: true }, context)).toEqual({ error: STAR_CONSENT_FAILED });
    const refused = clients({ insertError: true });
    expect(await keepStarConsent({ ...refused, rateLimited: allow, hashKey }, A, { characterId: EVA, answer: "me", adsOk: true }, context)).toEqual({ error: STAR_CONSENT_FAILED });
    expect(c.inserted).toHaveLength(0);
  });

  it("keeps a language it can read, and English for anything else", async () => {
    const c = clients();
    await keepStarConsent({ ...c, rateLimited: allow, hashKey }, A, { characterId: EVA, answer: "not_a_person", adsOk: true }, { locale: "<script>", ip: null });
    expect(c.inserted[0].row.locale).toBe("en");
    expect(c.inserted[0].row.ip_hash).toBeNull();
  });
});

describe("reading the star's answer back", () => {
  it("holds only for the photos it was given for, and only as a yes", () => {
    const hash = photosHash(PHOTOS);
    expect(currentStarAnswer(PHOTOS, [{ answer: "permission", photos_hash: hash, ads_ok: true }])).toBe("permission");
    // A new photo asks again.
    expect(currentStarAnswer([...PHOTOS, `${A}/eva-3.jpg`], [{ answer: "me", photos_hash: hash, ads_ok: true }])).toBeNull();
    // The same photos in another order are the same photos.
    expect(currentStarAnswer([...PHOTOS].reverse(), [{ answer: "me", photos_hash: hash, ads_ok: true }])).toBe("me");
    // Newest first: the first row for these photos wins; an older stale row is ignored.
    expect(
      currentStarAnswer(PHOTOS, [
        { answer: "me", photos_hash: "1-deadbeef", ads_ok: true },
        { answer: "not_a_person", photos_hash: hash, ads_ok: true },
        { answer: "me", photos_hash: hash, ads_ok: true },
      ]),
    ).toBe("not_a_person");
    expect(currentStarAnswer(PHOTOS, [{ answer: "me", photos_hash: hash, ads_ok: false }])).toBeNull();
    expect(currentStarAnswer(PHOTOS, [{ answer: "a stranger", photos_hash: hash, ads_ok: true }])).toBeNull();
    expect(currentStarAnswer([], [{ answer: "me", photos_hash: photosHash([]), ads_ok: true }])).toBeNull();
  });
});

describe("the words and the table agree", () => {
  it("maps every sentence it can answer with, in the person's language", () => {
    for (const sentence of STAR_CONSENT_MESSAGES) {
      expect(MAPPED_SERVER_STRINGS, sentence).toContain(sentence);
      expect(localizeServerText(sentence, es), sentence).not.toBe(sentence);
    }
  });

  it("writes only what press-tour-03-campaigns.sql accepts", () => {
    const sql = readFileSync(join(__dirname, "..", "..", "..", "supabase", "pending", "press-tour-03-campaigns.sql"), "utf8");
    expect(sql).toContain("create table if not exists public.character_ad_consents");
    expect(sql).toContain("check (answer in ('me', 'permission', 'not_a_person'))");
    expect(sql).toMatch(/character_ad_consents_place check \(place in \([^)]*'door'/);
    expect(sql).toContain("check (ads_ok)");
    expect(STAR_CONSENT_NOTICE_VERSION.length).toBeLessThanOrEqual(32);
    expect(STAR_CONSENT_METHOD.length).toBeLessThanOrEqual(32);
  });
});
