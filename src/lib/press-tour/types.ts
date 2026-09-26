// Press Tour's shared words: the product card, the brand kit, the consents
// behind both, and the verdict words every surface prints (Spec v1 §1.1,
// §1.2, §6; v2: press-tour-synthesis.md §3.1 items 7, 9, 28, 30, S4/N2).
//
// supabase/applied/2026-09-26/press-tour-02-products.sql holds the same lists and
// limits as CHECKs and triggers; types.test.ts reads that file and fails if
// the two ever disagree, so a value the server writes here is a value the
// database accepts.
//
// Pure and alias-free (vitest has no '@/'): the door, the actions, the
// Producer, MCP and the tests all import it as it is.

// ---------------------------------------------------------------------
// Categories. Decided by MEANING (the chosen photos plus the product's
// description), never by the person's pick. 'regulated' is kept so the
// refusal is on the record; a regulated product can never be confirmed in
// v1, because no ad-claims check exists (build map §8.3).
// ---------------------------------------------------------------------
export const PRODUCT_CATEGORIES = [
  "rigid",
  "apparel",
  "liquid",
  "cosmetic",
  "food",
  "electronics",
  "other",
  "regulated",
] as const;
export type ProductCategory = (typeof PRODUCT_CATEGORIES)[number];
export const REGULATED: ProductCategory = "regulated";

export function parseProductCategory(raw: unknown): ProductCategory | null {
  return typeof raw === "string" && (PRODUCT_CATEGORIES as readonly string[]).includes(raw)
    ? (raw as ProductCategory)
    : null;
}

/** Server error, English; the door maps it in 4 locales. */
export const PRODUCT_REGULATED_REFUSED =
  "Press Tour can't make ads for this kind of product yet (alcohol, tobacco and vapes, medicines and supplements, gambling, weapons, financial products).";

// ---------------------------------------------------------------------
// Card and kit status. 'draft' until the person has answered the label
// question and the consent for exactly these photos; 'archived' is put away.
// ---------------------------------------------------------------------
export const CARD_STATUSES = ["draft", "confirmed", "archived"] as const;
export type CardStatus = (typeof CARD_STATUSES)[number];

// ---------------------------------------------------------------------
// Consents (product_consents). kind 'product': "I own this product, or I
// may advertise it, and I may use these photos". kind 'brand_kit': "This is
// my brand, or I may use its name and logo" (critique #28). Written by the
// server alone, append-only, for exactly the photos (or logo) in photos_hash.
// ---------------------------------------------------------------------
export const CONSENT_KINDS = ["product", "brand_kit"] as const;
export type ConsentKind = (typeof CONSENT_KINDS)[number];
export const CONSENT_ANSWERS = ["own", "permission"] as const;
export type ConsentAnswer = (typeof CONSENT_ANSWERS)[number];
/** Where it was given. */
export const CONSENT_PLACES = ["door", "generate", "producer", "mcp"] as const;
export type ConsentPlace = (typeof CONSENT_PLACES)[number];
/** How it was given: ticked, never pre-ticked (S11). */
export const CONSENT_METHOD = "checkbox";

export function parseConsentAnswer(raw: unknown): ConsentAnswer | null {
  return typeof raw === "string" && (CONSENT_ANSWERS as readonly string[]).includes(raw) ? (raw as ConsentAnswer) : null;
}

// ---------------------------------------------------------------------
// The views a chosen photo can be (products.angles).
// ---------------------------------------------------------------------
export const PRODUCT_VIEWS = ["front", "back", "side", "three_quarter", "top", "detail", "in_use"] as const;
export type ProductView = (typeof PRODUCT_VIEWS)[number];

// ---------------------------------------------------------------------
// Limits, each one a CHECK or a trigger rule in press-tour-02-products.sql.
// ---------------------------------------------------------------------
export const CARD_LIMITS = {
  productName: 120,
  brandName: 80,
  photos: 8,
  labelStrings: 8,
  labelString: 80,
  palette: 6,
  fonts: 4,
  font: 80,
  tone: 500,
  tagline: 120,
  cta: 60,
  sourceUrl: 2048,
  path: 512,
  photosHash: 64,
  angles: 8,
  lockRefs: 8,
  /** products.dna, measured as its text (octet_length(dna::text)). */
  dnaBytes: 8192,
} as const;

/** One palette colour as stored: lowercase #rrggbb. */
export const HEX_COLOUR = /^#[0-9a-f]{6}$/;

// ---------------------------------------------------------------------
// The shapes.
// ---------------------------------------------------------------------

/** Where the logo sits on one of the product's own photos, each 0..1 of it. */
export type LogoBox = { path: string; x: number; y: number; w: number; h: number };

export type ProductAngle = { path: string; view: ProductView };

/**
 * What the product is, read once from the chosen photos and the page, and
 * kept bounded. Data for the checks, never instructions: every string here
 * reaches a model only fenced as data.
 */
export type ProductDna = {
  name: string | null;
  brand: string | null;
  category: ProductCategory | null;
  shape: string[];
  material: string | null;
  colours: string[];
  marks: string[];
};

/**
 * The product card as the door, the Producer and MCP see it. No engine, no
 * cost and no raw score ever sits on it (critique #30).
 */
export type ProductCard = {
  id: string;
  name: string;
  brandKitId: string | null;
  sourceUrl: string | null;
  category: ProductCategory | null;
  dna: ProductDna | null;
  /**
   * The photos the product read (category and dna) actually saw. A card is
   * confirmed only with photos in this list; a photo outside it is read
   * again first (card-service.ts confirmProductCard; the database holds the
   * same rule in products_confirmed_complete).
   */
  dnaPhotos: string[];
  /** The words that must appear on the product, ticked and spelled by the person. */
  labelStrings: string[];
  /** "No readable text on this product", ticked instead of any word. */
  noReadableText: boolean;
  /** The photos the person chose (storage paths under their own folder). */
  photos: string[];
  logoPath: string | null;
  logoBox: LogoBox | null;
  palette: string[];
  angles: ProductAngle[];
  /** The reference crops the product checks compare against. */
  lockRefs: string[];
  /** The photos the product consent was given for. */
  photosHash: string | null;
  status: CardStatus;
  confirmedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type BrandKit = {
  id: string;
  name: string;
  sourceUrl: string | null;
  logoPath: string | null;
  palette: string[];
  fonts: string[];
  tone: string | null;
  tagline: string | null;
  defaultCta: string | null;
  /** The logo the ownership answer was given for. */
  photosHash: string | null;
  status: CardStatus;
  confirmedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type ProductConsent = {
  kind: ConsentKind;
  productId: string | null;
  brandKitId: string | null;
  answer: ConsentAnswer;
  photosHash: string;
  noticeVersion: string;
  locale: string;
  method: string;
  place: ConsentPlace;
  createdAt: string;
};

// ---------------------------------------------------------------------
// Verdict words (S4/N2): ONE fixed set, printed the same on the door, the
// press wall, the Producer and in Claude, and mapped in 4 locales.
//
// RECORD-ONLY (operator, 2026-09-25: the paid bake-off is not approved).
// A verdict is shown and stored; until product_lock_calibrated is on it
// drives no re-shoot and no refund, and no customer copy says "locked" or
// "Product Lock" (that is the internal module name only).
// ---------------------------------------------------------------------
export const PRODUCT_VERDICTS = ["match", "mismatch", "not_readable", "product_missing", "not_checked"] as const;
export type ProductVerdict = (typeof PRODUCT_VERDICTS)[number];
/** The face can also be absent on purpose: a packshot has no one in it. */
export const FACE_VERDICTS = ["match", "mismatch", "not_readable", "not_checked", "no_one"] as const;
export type FaceVerdict = (typeof FACE_VERDICTS)[number];

export const VERDICT_WORDS: Record<ProductVerdict | FaceVerdict, string> = {
  match: "Match",
  mismatch: "Didn't match",
  not_readable: "Not readable",
  product_missing: "Product missing",
  not_checked: "Not checked",
  no_one: "No one in this shot",
};

export function parseProductVerdict(raw: unknown): ProductVerdict | null {
  return typeof raw === "string" && (PRODUCT_VERDICTS as readonly string[]).includes(raw) ? (raw as ProductVerdict) : null;
}

export function parseFaceVerdict(raw: unknown): FaceVerdict | null {
  return typeof raw === "string" && (FACE_VERDICTS as readonly string[]).includes(raw) ? (raw as FaceVerdict) : null;
}

// ---------------------------------------------------------------------
// Normalisers: what the server writes always passes the database's checks.
// ---------------------------------------------------------------------

// Control characters (C0, DEL, C1) and the bidi overrides that can make a
// string read differently from what it holds.
const UNSAFE_CHARS = /[\u0000-\u001f\u007f-\u009f‪-‮⁦-⁩]/g;

/** Trimmed, one space between words, no control or bidi-override characters, at most `max` characters. */
export function cleanText(raw: unknown, max: number): string | null {
  if (typeof raw !== "string") return null;
  const s = raw.replace(UNSAFE_CHARS, " ").replace(/\s+/g, " ").trim();
  if (!s) return null;
  return Array.from(s).slice(0, max).join("").trim() || null;
}

/**
 * The label words as stored: each cleaned and 1-80 characters (a longer one
 * is dropped, not cut: a cut word would be a word the product never shows),
 * duplicates dropped ignoring case, at most 8.
 */
export function normaliseLabelStrings(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    const s = cleanText(item, Number.MAX_SAFE_INTEGER);
    if (!s || Array.from(s).length > CARD_LIMITS.labelString) continue;
    const key = s.toLocaleLowerCase("en");
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(s);
    if (out.length === CARD_LIMITS.labelStrings) break;
  }
  return out;
}

/** A palette as stored: lowercase #rrggbb (#rgb is widened), no repeats, at most 6. */
export function normalisePalette(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  for (const item of raw) {
    if (typeof item !== "string") continue;
    let s = item.trim().toLowerCase();
    if (/^#[0-9a-f]{3}$/.test(s)) s = `#${s[1]}${s[1]}${s[2]}${s[2]}${s[3]}${s[3]}`;
    if (!HEX_COLOUR.test(s) || out.includes(s)) continue;
    out.push(s);
    if (out.length === CARD_LIMITS.palette) break;
  }
  return out;
}

// Per-field bounds that keep the fullest possible DNA under
// CARD_LIMITS.dnaBytes even at 4 bytes a character (types.test.ts proves it).
export const DNA_LIMITS = { name: 120, brand: 80, material: 80, words: 8, word: 40, marks: 8, mark: 80 } as const;

function cleanList(raw: unknown, count: number, each: number): string[] {
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  for (const item of raw) {
    const s = cleanText(item, each);
    if (s && !out.includes(s)) out.push(s);
    if (out.length === count) break;
  }
  return out;
}

/** A description as stored, or null when nothing usable was read. */
export function normaliseProductDna(raw: unknown): ProductDna | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  const dna: ProductDna = {
    name: cleanText(r.name, DNA_LIMITS.name),
    brand: cleanText(r.brand, DNA_LIMITS.brand),
    category: parseProductCategory(r.category),
    shape: cleanList(r.shape, DNA_LIMITS.words, DNA_LIMITS.word),
    material: cleanText(r.material, DNA_LIMITS.material),
    colours: cleanList(r.colours, DNA_LIMITS.words, DNA_LIMITS.word),
    marks: cleanList(r.marks, DNA_LIMITS.marks, DNA_LIMITS.mark),
  };
  const empty =
    !dna.name && !dna.brand && !dna.category && !dna.material && !dna.shape.length && !dna.colours.length && !dna.marks.length;
  return empty ? null : dna;
}

// ---------------------------------------------------------------------
// Rows to shapes. Defensive: a malformed stored value becomes an empty or
// null field, never a crash; a row without an id or a known status is no
// card at all.
// ---------------------------------------------------------------------

/** The products columns productCardFromRow reads. */
export const PRODUCT_CARD_COLUMNS =
  "id, name, brand_kit_id, source_url, category, dna, dna_photos, label_strings, no_readable_text, image_paths, logo_path, logo_box, palette, angles, lock_refs, photos_hash, status, confirmed_at, created_at, updated_at";

/** The brand_kits columns brandKitFromRow reads. */
export const BRAND_KIT_COLUMNS =
  "id, name, source_url, logo_path, palette, fonts, tone, tagline, default_cta, photos_hash, status, confirmed_at, created_at, updated_at";

const str = (v: unknown): string | null => (typeof v === "string" && v.length > 0 ? v : null);
const strList = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && x.length > 0) : []);
const status = (v: unknown): CardStatus | null =>
  typeof v === "string" && (CARD_STATUSES as readonly string[]).includes(v) ? (v as CardStatus) : null;

function logoBoxFrom(v: unknown): LogoBox | null {
  if (!v || typeof v !== "object" || Array.isArray(v)) return null;
  const b = v as Record<string, unknown>;
  const path = str(b.path);
  const nums = [b.x, b.y, b.w, b.h];
  if (!path || !nums.every((n) => typeof n === "number" && Number.isFinite(n) && n >= 0 && n <= 1)) return null;
  const [x, y, w, h] = nums as number[];
  if (w <= 0 || h <= 0 || x + w > 1 || y + h > 1) return null;
  return { path, x, y, w, h };
}

function anglesFrom(v: unknown): ProductAngle[] {
  if (!Array.isArray(v)) return [];
  const out: ProductAngle[] = [];
  for (const a of v) {
    if (!a || typeof a !== "object") continue;
    const path = str((a as Record<string, unknown>).path);
    const view = (a as Record<string, unknown>).view;
    if (path && typeof view === "string" && (PRODUCT_VIEWS as readonly string[]).includes(view)) {
      out.push({ path, view: view as ProductView });
    }
  }
  return out;
}

export function productCardFromRow(row: unknown): ProductCard | null {
  if (!row || typeof row !== "object") return null;
  const r = row as Record<string, unknown>;
  const id = str(r.id);
  const st = status(r.status);
  if (!id || !st) return null;
  return {
    id,
    name: typeof r.name === "string" ? r.name : "",
    brandKitId: str(r.brand_kit_id),
    sourceUrl: str(r.source_url),
    category: parseProductCategory(r.category),
    dna: normaliseProductDna(r.dna),
    dnaPhotos: strList(r.dna_photos),
    labelStrings: strList(r.label_strings),
    noReadableText: r.no_readable_text === true,
    photos: strList(r.image_paths),
    logoPath: str(r.logo_path),
    logoBox: logoBoxFrom(r.logo_box),
    palette: strList(r.palette).filter((c) => HEX_COLOUR.test(c)),
    angles: anglesFrom(r.angles),
    lockRefs: strList(r.lock_refs),
    photosHash: str(r.photos_hash),
    status: st,
    confirmedAt: str(r.confirmed_at),
    createdAt: str(r.created_at) ?? "",
    updatedAt: str(r.updated_at) ?? "",
  };
}

export function brandKitFromRow(row: unknown): BrandKit | null {
  if (!row || typeof row !== "object") return null;
  const r = row as Record<string, unknown>;
  const id = str(r.id);
  const st = status(r.status);
  if (!id || !st) return null;
  return {
    id,
    name: typeof r.name === "string" ? r.name : "",
    sourceUrl: str(r.source_url),
    logoPath: str(r.logo_path),
    palette: strList(r.palette).filter((c) => HEX_COLOUR.test(c)),
    fonts: strList(r.fonts),
    tone: str(r.tone),
    tagline: str(r.tagline),
    defaultCta: str(r.default_cta),
    photosHash: str(r.photos_hash),
    status: st,
    confirmedAt: str(r.confirmed_at),
    createdAt: str(r.created_at) ?? "",
    updatedAt: str(r.updated_at) ?? "",
  };
}

/**
 * Whether a card may become 'confirmed' — the database's own rule
 * (products_confirmed_complete plus the consent trigger), asked before the
 * write so the door can say what is missing instead of failing it.
 */
export function cardConfirmBlocker(card: {
  category: ProductCategory | null;
  /** The photos the product read saw (products.dna_photos). */
  dnaPhotos: readonly string[];
  labelStrings: readonly string[];
  noReadableText: boolean;
  photos: readonly string[];
  consentForThesePhotos: boolean;
}): "category" | "regulated" | "label" | "photos" | "consent" | null {
  if (!card.category) return "category";
  if (card.category === REGULATED) return "regulated";
  if (card.photos.length === 0) return "photos";
  // A photo the product read never saw has no category yet (image_paths <@ dna_photos).
  if (card.photos.some((path) => !card.dnaPhotos.includes(path))) return "category";
  if (!card.noReadableText && card.labelStrings.length === 0) return "label";
  if (card.noReadableText && card.labelStrings.length > 0) return "label";
  if (!card.consentForThesePhotos) return "consent";
  return null;
}
