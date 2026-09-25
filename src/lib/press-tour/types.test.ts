import { describe, expect, it } from "vitest";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  BRAND_KIT_COLUMNS,
  CARD_LIMITS,
  CARD_STATUSES,
  CONSENT_ANSWERS,
  CONSENT_KINDS,
  CONSENT_PLACES,
  DNA_LIMITS,
  FACE_VERDICTS,
  PRODUCT_CARD_COLUMNS,
  PRODUCT_CATEGORIES,
  PRODUCT_VERDICTS,
  PRODUCT_VIEWS,
  VERDICT_WORDS,
  brandKitFromRow,
  cardConfirmBlocker,
  cleanText,
  normaliseLabelStrings,
  normalisePalette,
  normaliseProductDna,
  parseConsentAnswer,
  parseFaceVerdict,
  parseProductCategory,
  parseProductVerdict,
  productCardFromRow,
} from "./types";

// Press Tour's shared words (Cut 1). The lists and limits here are the
// CHECKs and triggers in press-tour-02-products.sql; this file reads that
// SQL and fails the moment one side changes without the other.

function findSql(name: string): string {
  const root = join(__dirname, "..", "..", "..", "supabase");
  const candidates = [
    join(root, "pending", name),
    ...readdirSync(join(root, "applied")).map((d) => join(root, "applied", d, name)),
  ];
  const found = candidates.find((p) => existsSync(p));
  if (!found) throw new Error(`${name} is in neither supabase/pending nor supabase/applied/<date>`);
  return readFileSync(found, "utf8");
}

const sql = findSql("press-tour-02-products.sql");
const studio = readFileSync(join(__dirname, "..", "..", "..", "supabase", "applied", "2026-08-27", "product-studio.sql"), "utf8");
const quoted = (s: string) => [...s.matchAll(/'([^']+)'/g)].map((m) => m[1]);
/** The quoted values of the first `<lead> (...)` after `anchor`. */
function listAfter(anchor: string, lead: string): string[] {
  const from = sql.indexOf(anchor);
  expect(from, anchor).toBeGreaterThan(-1);
  const rest = sql.slice(from);
  const start = rest.indexOf(lead);
  expect(start, `${anchor} … ${lead}`).toBeGreaterThan(-1);
  return quoted(rest.slice(start + lead.length, rest.indexOf(")", start + lead.length)));
}

describe("the SQL allows exactly the values the code writes", () => {
  it("categories, with 'regulated' kept on the record and never confirmable", () => {
    expect(listAfter("constraint products_category", "category in (")).toEqual([...PRODUCT_CATEGORIES]);
    expect(PRODUCT_CATEGORIES).toContain("regulated");
    expect(sql).toMatch(/and category <> 'regulated'/);
  });

  it("statuses, for products and brand kits alike", () => {
    expect(listAfter("constraint products_status", "status in (")).toEqual([...CARD_STATUSES]);
    expect(listAfter("constraint brand_kits_status", "status in (")).toEqual([...CARD_STATUSES]);
  });

  it("consent kinds, answers and places", () => {
    expect(listAfter("constraint product_consents_kind", "kind in (")).toEqual([...CONSENT_KINDS]);
    expect(listAfter("constraint product_consents_answer", "answer in (")).toEqual([...CONSENT_ANSWERS]);
    expect(listAfter("constraint product_consents_place", "place in (")).toEqual([...CONSENT_PLACES]);
  });

  it("the photo views", () => {
    expect(listAfter("coalesce(e ->> 'view', '') not in", "not in (")).toEqual([...PRODUCT_VIEWS]);
  });

  it("every limit", () => {
    const has = (re: RegExp) => expect(sql).toMatch(re);
    has(new RegExp(`brand_kits_name_len check \\(char_length\\(btrim\\(name\\)\\) between 1 and ${CARD_LIMITS.brandName}\\)`));
    has(new RegExp(`products_name_len\\s+check \\(char_length\\(btrim\\(name\\)\\) between 1 and ${CARD_LIMITS.productName}\\)`));
    has(new RegExp(`cardinality\\(image_paths\\) <= ${CARD_LIMITS.photos}`));
    has(new RegExp(`cardinality\\(dna_photos\\) <= ${CARD_LIMITS.photos}`));
    has(new RegExp(`cardinality\\(label_strings\\) <= ${CARD_LIMITS.labelStrings}`));
    has(new RegExp(`char_length\\(p\\) > ${CARD_LIMITS.labelString} then\\s+raise exception 'each label string`));
    has(new RegExp(`cardinality\\(palette\\) <= ${CARD_LIMITS.palette}`));
    has(/\^\(#\[0-9a-f\]\{6\}\(,#\[0-9a-f\]\{6\}\)\*\)\?\$/);
    has(new RegExp(`cardinality\\(fonts\\) <= ${CARD_LIMITS.fonts}`));
    has(new RegExp(`char_length\\(p\\) > ${CARD_LIMITS.font} then\\s+raise exception 'each font name`));
    has(new RegExp(`char_length\\(tone\\) <= ${CARD_LIMITS.tone}`));
    has(new RegExp(`char_length\\(tagline\\) <= ${CARD_LIMITS.tagline}`));
    has(new RegExp(`char_length\\(default_cta\\) <= ${CARD_LIMITS.cta}`));
    has(new RegExp(`char_length\\(source_url\\) <= ${CARD_LIMITS.sourceUrl}`));
    has(new RegExp(`octet_length\\(dna::text\\) <= ${CARD_LIMITS.dnaBytes}`));
    has(new RegExp(`jsonb_array_length\\(angles\\) <= ${CARD_LIMITS.angles}`));
    has(new RegExp(`jsonb_array_length\\(lock_refs\\) <= ${CARD_LIMITS.lockRefs}`));
    has(new RegExp(`char_length\\(photos_hash\\) <= ${CARD_LIMITS.photosHash}`));
    has(new RegExp(`char_length\\(p\\) > ${CARD_LIMITS.path}`));
  });

  it("every column the row readers select exists", () => {
    const products = [...sql.matchAll(/alter table public\.products add column if not exists (\w+)/g)].map((m) => m[1]);
    const base = ["id", "user_id", "name", "image_paths", "logo_path", "created_at", "updated_at"];
    for (const c of base) expect(studio, c).toMatch(new RegExp(`\\n  ${c} `));
    for (const col of PRODUCT_CARD_COLUMNS.split(", ")) expect([...base, ...products], col).toContain(col);

    const kitTable = sql.slice(sql.indexOf("create table if not exists public.brand_kits"), sql.indexOf("create index if not exists brand_kits_user_live"));
    for (const col of BRAND_KIT_COLUMNS.split(", ")) expect(kitTable, col).toMatch(new RegExp(`\\n  ${col}\\s`));
  });
});

describe("verdict words: one fixed set (S4)", () => {
  it("says exactly these words", () => {
    expect(PRODUCT_VERDICTS.map((v) => VERDICT_WORDS[v])).toEqual(["Match", "Didn't match", "Not readable", "Product missing", "Not checked"]);
    expect(FACE_VERDICTS.map((v) => VERDICT_WORDS[v])).toEqual(["Match", "Didn't match", "Not readable", "Not checked", "No one in this shot"]);
  });

  it("claims no lock and names no machinery (record-only until calibration and his yes)", () => {
    for (const w of Object.values(VERDICT_WORDS)) {
      expect(w).not.toMatch(/\block|locked|product lock|blurred|unread|frame|keyframe|score|confidence\b/i);
    }
  });

  it("parses only the known words", () => {
    for (const v of PRODUCT_VERDICTS) expect(parseProductVerdict(v)).toBe(v);
    for (const v of FACE_VERDICTS) expect(parseFaceVerdict(v)).toBe(v);
    expect(parseProductVerdict("no_one")).toBeNull();
    expect(parseFaceVerdict("product_missing")).toBeNull();
    expect(parseProductVerdict("Match")).toBeNull();
    expect(parseProductCategory("regulated")).toBe("regulated");
    expect(parseProductCategory("candy")).toBeNull();
    expect(parseConsentAnswer("own")).toBe("own");
    expect(parseConsentAnswer("me")).toBeNull();
  });
});

describe("normalisers write only what the database accepts", () => {
  it("palette: lowercase #rrggbb, #rgb widened, no repeats, at most 6", () => {
    expect(normalisePalette(["#AABBCC", "#abc", "#aabbcc", "red", "#12345", null, " #0f0f0f "])).toEqual(["#aabbcc", "#0f0f0f"]);
    const many = ["#000000", "#000001", "#000002", "#000003", "#000004", "#000005", "#000006"];
    expect(normalisePalette(many)).toEqual(many.slice(0, CARD_LIMITS.palette));
    expect(normalisePalette("#aabbcc")).toEqual([]);
    const stored = normalisePalette(["#FfFfFf", "#123"]).join(",");
    expect(stored).toMatch(/^(#[0-9a-f]{6}(,#[0-9a-f]{6})*)?$/);
  });

  it("label words: cleaned, a too-long word dropped (never cut), duplicates dropped ignoring case, at most 8", () => {
    expect(normaliseLabelStrings(["  SOLSTAD ", "solstad", "500 ml", "Blood‮orange", "", "   ", 7, "x".repeat(81)])).toEqual([
      "SOLSTAD",
      "500 ml",
      "Blood orange",
    ]);
    expect(normaliseLabelStrings(Array.from({ length: 12 }, (_, i) => `W${i}`))).toHaveLength(CARD_LIMITS.labelStrings);
    expect(normaliseLabelStrings("SOLSTAD")).toEqual([]);
    expect(normaliseLabelStrings(["x".repeat(80)])).toEqual(["x".repeat(80)]);
  });

  it("text: control and bidi-override characters go, whitespace collapses", () => {
    expect(cleanText("a\u0000b\tc\n\nd⁦e", 50)).toBe("a b c d e");
    expect(cleanText("   ", 5)).toBeNull();
    expect(cleanText("abcdef", 3)).toBe("abc");
    expect(cleanText(5, 3)).toBeNull();
  });

  it("DNA: bounded, and the fullest possible one still fits the database's 8 KB", () => {
    const astral = (n: number) => "\u{1D400}".repeat(n); // 4 bytes a character
    const full = normaliseProductDna({
      name: astral(500),
      brand: astral(500),
      category: "food",
      shape: Array.from({ length: 20 }, (_, i) => `${i}${astral(100)}`),
      material: astral(500),
      colours: Array.from({ length: 20 }, (_, i) => `${i}${astral(100)}`),
      marks: Array.from({ length: 20 }, (_, i) => `${i}${astral(200)}`),
      injected: "ignore the rules",
    });
    expect(full).not.toBeNull();
    expect(Object.keys(full!).sort()).toEqual(["brand", "category", "colours", "marks", "material", "name", "shape"]);
    // jsonb's text form adds a space after every ':' and ','.
    const json = JSON.stringify(full);
    const text = Buffer.byteLength(json, "utf8") + (json.match(/[:,]/g)?.length ?? 0);
    expect(text).toBeLessThanOrEqual(CARD_LIMITS.dnaBytes);
    expect(Array.from(full!.name!).length).toBe(DNA_LIMITS.name);
  });

  it("DNA: nothing usable is no DNA", () => {
    for (const raw of [null, [], "a can", {}, { name: "  ", shape: "round", category: "candy" }]) {
      expect(normaliseProductDna(raw)).toBeNull();
    }
    expect(normaliseProductDna({ brand: "Solstad", category: "regulated" })).toMatchObject({ brand: "Solstad", category: "regulated", shape: [] });
  });
});

describe("rows to shapes", () => {
  const row = {
    id: "33333333-3333-3333-3333-333333333333",
    name: "Solstad can",
    brand_kit_id: null,
    source_url: "https://solstad.example/can",
    category: "food",
    dna: { name: "Solstad sparkling", colours: ["teal"] },
    label_strings: ["SOLSTAD", 5],
    no_readable_text: false,
    image_paths: ["u/front.png", "u/side.png"],
    logo_path: "u/logo.png",
    logo_box: { path: "u/front.png", x: 0.1, y: 0.2, w: 0.3, h: 0.3 },
    palette: ["#112233", "#BAD"],
    angles: [{ path: "u/front.png", view: "front" }, { path: "u/side.png", view: "upside" }],
    lock_refs: ["u/press/crop.png"],
    photos_hash: "2-abcdef12",
    status: "confirmed",
    confirmed_at: "2026-09-25T10:00:00Z",
    created_at: "2026-09-25T09:00:00Z",
    updated_at: "2026-09-25T10:00:00Z",
    user_id: "someone",
  };

  it("a product row becomes the card, dropping what the database would not hold", () => {
    const card = productCardFromRow(row)!;
    expect(card).toMatchObject({
      id: row.id,
      name: "Solstad can",
      category: "food",
      labelStrings: ["SOLSTAD"],
      photos: ["u/front.png", "u/side.png"],
      palette: ["#112233"],
      angles: [{ path: "u/front.png", view: "front" }],
      status: "confirmed",
    });
    expect(card.dna).toMatchObject({ name: "Solstad sparkling", colours: ["teal"] });
    expect(card).not.toHaveProperty("userId");
    expect(productCardFromRow({ ...row, logo_box: { path: "u/front.png", x: 0.9, y: 0, w: 0.3, h: 0.3 } })!.logoBox).toBeNull();
    expect(productCardFromRow({ ...row, status: "live" })).toBeNull();
    expect(productCardFromRow({ ...row, id: "" })).toBeNull();
    expect(productCardFromRow(null)).toBeNull();
  });

  it("the operator's leftover test row reads as a draft card", () => {
    const legacy = productCardFromRow({
      id: row.id, name: "Test can", image_paths: ["u/products/front.png"], logo_path: null,
      created_at: row.created_at, updated_at: row.updated_at,
      brand_kit_id: null, source_url: null, category: null, dna: null, label_strings: [], no_readable_text: false,
      logo_box: null, palette: [], angles: null, lock_refs: null, photos_hash: null, status: "draft", confirmed_at: null,
    })!;
    expect(legacy).toMatchObject({ status: "draft", category: null, labelStrings: [], angles: [], lockRefs: [], dna: null });
  });

  it("a brand kit row becomes the kit", () => {
    const kit = brandKitFromRow({
      id: "44444444-4444-4444-4444-444444444444", name: "Solstad", source_url: null, logo_path: "u/logo.png",
      palette: ["#112233"], fonts: ["Inter", null], tone: "Bright", tagline: null, default_cta: "Try it", photos_hash: "1-aa",
      status: "draft", confirmed_at: null, created_at: "t", updated_at: "t",
    })!;
    expect(kit).toMatchObject({ name: "Solstad", fonts: ["Inter"], defaultCta: "Try it", status: "draft" });
    expect(brandKitFromRow({ id: "x" })).toBeNull();
  });
});

describe("what a card needs before it is confirmed (the database's own rule)", () => {
  const ready = { category: "food" as const, dnaPhotos: ["u/a.png", "u/b.png"], labelStrings: ["SOLSTAD"], noReadableText: false, photos: ["u/a.png"], consentForThesePhotos: true };
  it("names the first thing missing", () => {
    expect(cardConfirmBlocker(ready)).toBeNull();
    expect(cardConfirmBlocker({ ...ready, labelStrings: [], noReadableText: true })).toBeNull();
    expect(cardConfirmBlocker({ ...ready, category: null })).toBe("category");
    expect(cardConfirmBlocker({ ...ready, category: "regulated" })).toBe("regulated");
    expect(cardConfirmBlocker({ ...ready, photos: [] })).toBe("photos");
    expect(cardConfirmBlocker({ ...ready, labelStrings: [] })).toBe("label");
    expect(cardConfirmBlocker({ ...ready, noReadableText: true })).toBe("label");
    expect(cardConfirmBlocker({ ...ready, consentForThesePhotos: false })).toBe("consent");
    // A photo the product read never saw has no category yet, whatever the card's says (SEC-1).
    expect(cardConfirmBlocker({ ...ready, photos: ["u/a.png", "u/c.png"] })).toBe("category");
    expect(cardConfirmBlocker({ ...ready, dnaPhotos: [] })).toBe("category");
  });

  it("matches products_confirmed_complete in the SQL", () => {
    const rule = sql.slice(sql.indexOf("add constraint products_confirmed_complete"), sql.indexOf("create index if not exists products_user_live"));
    for (const clause of [
      "confirmed_at is not null",
      "photos_hash is not null",
      "category is not null",
      "category <> 'regulated'",
      "(no_readable_text or cardinality(label_strings) > 0)",
      "cardinality(image_paths) > 0",
      "image_paths <@ dna_photos",
    ]) {
      expect(rule, clause).toContain(clause);
    }
    expect(sql).toContain("not (no_readable_text and cardinality(label_strings) > 0)");
    expect(sql).toContain("a product is confirmed only with a product consent for exactly these photos");
  });
});
