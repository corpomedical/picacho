// Press Tour: the product card and the brand kit, on the server (spec §1.1,
// §1.2; synthesis §3.4 Cut 1). actions.ts is the thin "use server" door
// onto this module: it finds the signed-in person and hands over the real
// clients; everything that decides anything is here, alias-free, so
// card-service.test.ts runs it against a fake database and fake providers.
//
// EVERY ENTRY, IN THIS ORDER, before anything is read, written or spent:
//   1. who: a session (actions.ts), Press Tour switched on, the person
//      allowed (admins first; plans and the trial only once their switches
//      are on: enabled.ts), and a CONFIRMED EMAIL (critique #20) — all in
//      pressTourCaller;
//   2. whose: every id and path the request names is the caller's own
//      (owned.ts checkOwned; one answer for "not there" and "not yours");
//   3. how much: a rate limit (rate-limit.ts via deps.rateLimited). Reading
//      a product or a brand site is the 'press-import' counter, 20 a day on
//      a plan (admins included) and 3 a day on the free trial, plus an
//      app-wide daily cap on free reads and 60 a minute per website across
//      the app. The shared caps are asked before the person's own counter
//      is spent, so "busy" never costs one of their reads (importBudget).
//      Confirming, saving and consenting — no paid call — share a
//      'press-card-write' counter of 120 an hour;
//   4. only then a fetch (robots.txt first) or a paid call (the product
//      read, the label reading, the brand voice).
//
// WRITES are the service role's (deps.db): press-tour-02-products.sql gives
// people SELECT only, and its triggers re-check ownership of every file, the
// brand kit, and the consent behind a confirmed card or kit.
//
// Storage (private buckets, no policies for people):
//   press-uploads (12 MB a file, JPEG/PNG/WebP only: a signed upload token
//   binds neither a size nor a type, so the bucket does)
//   <user>/uploads/<batch>/<n>          the browser's own uploads, through a
//                                      signed upload token for a path the
//                                      server chose (the editor's pattern);
//                                      read once, then removed; one never
//                                      read is swept after 3 hours
//                                      (upload-sweep.ts)
//   press-kit
//   <user>/products/<product>/<sha>.jpg the product's photos, re-encoded
//   <user>/products/<product>/logo-…png the saved logo crop
//   <user>/brand/<kit>/logo-<sha>.png   the brand's logo candidates / logo
//
// RECORD-ONLY (operator, 2026-09-25): nothing here claims a lock, judges a
// render, or refunds anything. A regulated product is refused with honest
// copy and kept on the record as a draft without its photos.
//
// CATEGORY BY MEANING COVERS EXACTLY THE PHOTOS IT SAW. The product read
// sees at most DNA_MAX_IMAGES photos; a card can hold CARD_LIMITS.photos.
// products.dna_photos records which photos the stored category was read
// from, and a card is confirmed only with photos in it: confirming with any
// other photo reads the chosen photos again first (all of them, in one
// call), and the database refuses a confirmed card whose photos are not all
// in dna_photos (products_confirmed_complete).
//
// Customer sentences are English constants (below), mapped in 4 locales by
// i18n/server-text.ts at display time. No engine or vendor names.
//
// Relative imports only (vitest has no "@/" alias).

import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import sharp from "sharp";
import { photosHash } from "../characters/likeness";
import { SESSION_EXPIRED_MESSAGE } from "../generations/user-facing-error";
import { LogoError, importBrandSite as readBrandSite, normaliseLogo, type BrandKitDraft } from "./brand-kit-import";
import {
  PRESS_TOUR_NOT_OPEN,
  PRESS_TOUR_UNAVAILABLE,
  isPressTourEnabled,
  pressTourAllowed,
  pressTourEmailError,
  pressTourOpenings,
  readPressTourSettings,
  readPressTourSwitches,
} from "./enabled";
import { extractProductPage, fenceUntrusted } from "./extract-page";
import { OCR_MAX_IMAGES, readLabelText, type LabelReading } from "./ocr";
import { NOT_YOURS, OWNERSHIP_UNAVAILABLE, checkOwned, pathOwned } from "./owned";
import { paletteFromImage } from "./palette";
import { DNA_MAX_IMAGES, dnaImageFromBytes, readProductDna, type ProductDnaResult } from "./product-dna";
import {
  ProductImageError,
  isSamePicture,
  normalizeProductImage,
  prepareProductImages,
  type NormalizedProductImage,
  type PreparedProductImages,
} from "./product-images";
import { PAGE_UNREADABLE, SVG_LOGO_REFUSED, safeFetch, vetUrl } from "./safe-fetch";
import { robotsAllowsUrl } from "./site-text";
import { PRESS_UPLOADS_BUCKET } from "./upload-sweep";
import {
  BRAND_KIT_COLUMNS,
  CARD_LIMITS,
  CONSENT_METHOD,
  CONSENT_PLACES,
  PRODUCT_CARD_COLUMNS,
  PRODUCT_REGULATED_REFUSED,
  PRODUCT_VIEWS,
  REGULATED,
  brandKitFromRow,
  cleanText,
  normaliseLabelStrings,
  normalisePalette,
  parseConsentAnswer,
  productCardFromRow,
  type BrandKit,
  type ConsentPlace,
  type LogoBox,
  type ProductAngle,
  type ProductCard,
  type ProductDna,
  type ProductView,
} from "./types";

// ---------------------------------------------------------------------------
// Numbers
// ---------------------------------------------------------------------------

export const PRESS_KIT_BUCKET = "press-kit";
/** Where the browser stages a person's own photos before the server reads them (press-tour-02-products.sql section 6). */
export { PRESS_UPLOADS_BUCKET };
const DAY = 24 * 60 * 60;
/** Product and brand-site reads a day, on a plan (admins included). */
export const PAID_IMPORTS_PER_DAY = 20;
/** Product and brand-site reads a day, on the free trial. */
export const FREE_IMPORTS_PER_DAY = 3;
/**
 * Free reads a day across the whole app (synthesis #20). Each is at most
 * 5 label readings (5 × $0.0015 = $0.0075) plus one product read (unpriced
 * in both briefs, logged: synthesis #21).
 */
export const FREE_IMPORTS_APP_PER_DAY = 300;
/** Fetches of one website a minute, across the app (spec §1.1). */
export const HOST_FETCHES_PER_MINUTE = 60;
/** Confirmations, saves and consents an hour (no paid call). */
export const CARD_WRITES_PER_HOUR = 120;
/** Upload places handed out an hour. */
export const UPLOAD_RESERVATIONS_PER_HOUR = 30;
/**
 * Upload reservations a day on the free trial: a trial account reads 3
 * products a day, so 10 reservations is room to retry, and no more (each is
 * up to 5 × 12 MB of storage until it is read or swept).
 */
export const FREE_UPLOAD_RESERVATIONS_PER_DAY = 10;
/** Photos one upload adds (spec §1.1: 1–5 photos). */
export const PRODUCT_UPLOADS_MAX = 5;
/** The same cap safe-fetch holds a downloaded picture to. */
export const UPLOAD_MAX_BYTES = 12 * 1024 * 1024;
/** The photos a card is confirmed with (spec §1.1: 3–5, one of them the front). Never more than one product read sees (DNA_MAX_IMAGES). */
export const ANGLES_MIN = 3;
export const ANGLES_MAX = 5;
/** Display links for the person's own photos. */
export const PHOTO_URL_SECONDS = 60 * 60;
/** The consent wording the answers are given under; set here, never by the page. */
export const PRESS_CONSENT_NOTICE_VERSION = "2026-09-25";
const UPLOAD_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DEFAULT_PRODUCT_NAME = "New product";

// ---------------------------------------------------------------------------
// What a person reads (English; i18n/server-text.ts maps them)
// ---------------------------------------------------------------------------

export const PRESS_IMPORT_LIMIT = "That's all the products you can read today. Try again tomorrow.";
export const PRESS_IMPORT_BUSY = "Reading products is busy right now. Try again in a few minutes.";
export const PRESS_WRITE_LIMIT = "That's a lot of changes in an hour. Try again a little later.";
export const PRESS_UPLOAD_LIMIT = "That's a lot of uploads in an hour. Try again a little later.";
export const PRESS_UPLOAD_DAY_LIMIT = "That's all the photos you can add today. Try again tomorrow.";
export const PRODUCT_LINK_INVALID = "That link doesn't look right. Paste the address of the product's page.";
export const BRAND_LINK_INVALID = "That link doesn't look right. Paste your brand's website address.";
export const PRODUCT_UPLOAD_COUNT = "Add 1 to 5 photos of the product.";
export const PRODUCT_UPLOAD_TYPE = "Add photos as JPEG, PNG or WebP, up to 12 MB each.";
export const PRODUCT_UPLOAD_MISSING = "Your photos didn't finish uploading. Add them again.";
export const PRODUCT_PHOTO_TOO_SMALL = "Each photo needs to be at least 512 pixels on its shorter side.";
export const PRODUCT_PHOTO_UNREADABLE = "We couldn't open one of your photos. Use a JPEG, PNG or WebP.";
export const PRODUCT_SAVE_FAILED = "We couldn't save your product. Try again.";
export const PRODUCT_NOT_DRAFT = "This product is already confirmed. Start a new one to change its photos.";
export const PRODUCT_READ_UNAVAILABLE = "We couldn't tell what this product is just now. Try again in a moment.";
export const PRODUCT_ANGLES_REQUIRED = "Pick 3 to 5 photos of the product.";
export const PRODUCT_FRONT_REQUIRED = "Mark one photo as the front, with the label readable.";
export const PRODUCT_LABEL_REQUIRED = 'Tick the words printed on the product, or tick "No readable text on this product".';
export const PRODUCT_CONSENT_REQUIRED = "Confirm that you own this product or may advertise it, and may use these photos.";
export const PRODUCT_LOGO_BOX_INVALID = "Draw the logo box on one of the photos you picked.";
export const BRAND_NAME_REQUIRED = "Give your brand a name.";
export const BRAND_CONSENT_REQUIRED = "Confirm that this is your brand, or that you may use its name and logo.";
export const BRAND_LOGO_INVALID = "We couldn't use that logo. Upload it as a PNG or JPEG at least 128 pixels wide.";
export const BRAND_SAVE_FAILED = "We couldn't save your brand kit. Try again.";
export const CONSENT_SAVE_FAILED = "We couldn't record your answer. Try again.";
/** An error nothing above names (actions.ts catches it at the door). */
export const PRESS_TOUR_FAILED = "Something went wrong on our side. Try again in a moment.";

/** Every sentence above, for the i18n map and its truth-contract test. */
export const CARD_SERVICE_MESSAGES = [
  PRESS_IMPORT_LIMIT, PRESS_IMPORT_BUSY, PRESS_WRITE_LIMIT, PRESS_UPLOAD_LIMIT, PRESS_UPLOAD_DAY_LIMIT, PRODUCT_LINK_INVALID, BRAND_LINK_INVALID,
  PRODUCT_UPLOAD_COUNT, PRODUCT_UPLOAD_TYPE, PRODUCT_UPLOAD_MISSING, PRODUCT_PHOTO_TOO_SMALL, PRODUCT_PHOTO_UNREADABLE,
  PRODUCT_SAVE_FAILED, PRODUCT_NOT_DRAFT, PRODUCT_READ_UNAVAILABLE, PRODUCT_ANGLES_REQUIRED, PRODUCT_FRONT_REQUIRED,
  PRODUCT_LABEL_REQUIRED, PRODUCT_CONSENT_REQUIRED, PRODUCT_LOGO_BOX_INVALID, BRAND_NAME_REQUIRED, BRAND_CONSENT_REQUIRED,
  BRAND_LOGO_INVALID, BRAND_SAVE_FAILED, CONSENT_SAVE_FAILED, PRESS_TOUR_FAILED,
] as const;

// ---------------------------------------------------------------------------
// Shapes
// ---------------------------------------------------------------------------

export type FailCode =
  | "session"
  | "access"
  | "notYours"
  | "unavailable"
  | "limit"
  | "link"
  | "page"
  | "upload"
  | "photos"
  | "regulated"
  | "read"
  | "save"
  | "draftOnly"
  | "angles"
  | "front"
  | "label"
  | "logoBox"
  | "consent"
  | "name"
  | "logo";

export type Failure = { error: string; code: FailCode; productId?: string; brandKitId?: string; photosHash?: string };
const fail = (code: FailCode, error: string, extra: Omit<Failure, "error" | "code"> = {}): Failure => ({ error, code, ...extra });

export type PressCaller = { userId: string; via: "admin" | "plan" | "trial" };
export type AuthUserLike = { id?: unknown; email_confirmed_at?: unknown } | null | undefined;

export type LabelReadingState = "read" | "not_configured" | "unavailable";

export type ProductImported = {
  error: null;
  card: ProductCard;
  /** Display links for card.photos (short-lived). */
  photoUrls: Record<string, string>;
  /** Words read on the photos, for the person to tick and correct. Empty when none were read. */
  labelCandidates: string[];
  /** "not_configured": no label reader, so the card asks the person to type the words. */
  labelReading: LabelReadingState;
  /** Whether the product itself was read ("unavailable": the card is saved; confirming reads it again). */
  productRead: "read" | "unavailable";
  /** Candidate photos not kept (too small, a duplicate, not a picture...). */
  photosSkipped: number;
};

export type ProductConfirmed = { error: null; card: ProductCard; photoUrls: Record<string, string> };
export type ConsentRecorded = { error: null; photosHash: string };
/** `bucket` is where the browser uploads each path with its token (uploadToSignedUrl). */
export type UploadPlaces = { error: null; bucket: string; uploads: { path: string; token: string }[] };
export type BrandKitImported = {
  error: null;
  kit: BrandKit;
  /** The logos read from the site, best guess first (kit.logoPath is the first). */
  logoCandidates: { path: string; url: string | null }[];
  toneWords: string[];
  /** SVG_LOGO_REFUSED when the site only offered SVG logos. */
  logoNotice: string | null;
  voiceRead: BrandKitDraft["voice"];
};
export type BrandKitSaved = { error: null; kit: BrandKit; logoUrl: string | null };

export interface CardDeps {
  /** The service-role client. */
  db: SupabaseClient;
  /** rate-limit.ts rateLimited: true = over the limit (fails closed). */
  rateLimited: (key: string, scope: string, windowSeconds: number, max: number) => Promise<boolean>;
  /** rate-limit.ts hashedRateKey: a salted uuid-shaped key for things that are not users (a website, the app, an address). */
  hashKey: (value: string | null | undefined, scope: string) => string;
  // The providers; the real modules unless a test swaps one.
  robotsAllows?: (url: string) => Promise<boolean>;
  fetchPage?: (url: string) => Promise<{ html: string; url: string }>;
  prepareImages?: (urls: readonly string[], opts: { maxImages: number }) => Promise<PreparedProductImages>;
  readDna?: typeof readProductDna;
  readLabels?: (images: readonly Buffer[]) => Promise<LabelReading>;
  palette?: typeof paletteFromImage;
  importBrandSite?: (url: string) => ReturnType<typeof readBrandSite>;
  newId?: () => string;
  now?: () => Date;
}

type Providers = Required<Omit<CardDeps, "db" | "rateLimited" | "hashKey">>;

function providers(deps: CardDeps): Providers {
  return {
    robotsAllows: deps.robotsAllows ?? ((url) => robotsAllowsUrl(url)),
    fetchPage:
      deps.fetchPage ??
      (async (url) => {
        const res = await safeFetch(url, { kind: "html" });
        return { html: res.text ?? "", url: res.url };
      }),
    prepareImages: deps.prepareImages ?? ((urls, opts) => prepareProductImages(urls, { maxImages: opts.maxImages })),
    readDna: deps.readDna ?? readProductDna,
    readLabels: deps.readLabels ?? ((images) => readLabelText(images)),
    palette: deps.palette ?? paletteFromImage,
    importBrandSite: deps.importBrandSite ?? ((url) => readBrandSite(url)),
    newId: deps.newId ?? (() => crypto.randomUUID()),
    now: deps.now ?? (() => new Date()),
  };
}

// ---------------------------------------------------------------------------
// 1. Who
// ---------------------------------------------------------------------------

/**
 * The signed-in person, if Press Tour is on and open to them and their
 * email is confirmed. `db` reads the switches, settings and profile (the
 * person's own client is enough); `user` is the auth user (it carries
 * email_confirmed_at, which profiles cannot see).
 */
export async function pressTourCaller(db: SupabaseClient, user: AuthUserLike): Promise<Failure | { error: null; caller: PressCaller }> {
  const userId = typeof user?.id === "string" && UUID_RE.test(user.id) ? user.id.toLowerCase() : null;
  if (!userId) return fail("session", SESSION_EXPIRED_MESSAGE);
  if (!(await isPressTourEnabled(db))) return fail("access", PRESS_TOUR_UNAVAILABLE);
  let profile: Record<string, unknown> | null = null;
  try {
    const { data } = await db.from("profiles").select("plan, plan_status, role, status").eq("id", userId).maybeSingle();
    profile = (data as Record<string, unknown> | null) ?? null;
  } catch {
    profile = null;
  }
  const [switches, settings] = await Promise.all([readPressTourSwitches(db), readPressTourSettings(db)]);
  const access = pressTourAllowed(profile, pressTourOpenings(switches, settings));
  if (access.error !== null || !access.via) return fail("access", access.error ?? PRESS_TOUR_NOT_OPEN);
  const unconfirmed = pressTourEmailError(user as { email_confirmed_at?: unknown });
  if (unconfirmed) return fail("access", unconfirmed);
  return { error: null, caller: { userId, via: access.via } };
}

// ---------------------------------------------------------------------------
// 3. How much
// ---------------------------------------------------------------------------

const IMPORT_SCOPE = "press-import";

/**
 * The person's own reads in the last day, counted WITHOUT spending one: the
 * limiter's own rows, read with the service role (sets/data.ts counts
 * Astra's monthly changes the same way). Null when they cannot be read.
 */
async function importsUsedToday(deps: CardDeps, userId: string): Promise<number | null> {
  try {
    const since = new Date(providers(deps).now().getTime() - DAY * 1000).toISOString();
    const { count, error } = await deps.db
      .from("api_rate_hits")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId)
      .eq("scope", IMPORT_SCOPE)
      .gte("created_at", since);
    return error || typeof count !== "number" ? null : count;
  } catch {
    return null;
  }
}

/**
 * One product or brand-site read. api_rate_check records a hit whenever it
 * allows one, so the ORDER is the policy:
 *   1. the person's own count, only READ: someone already at their limit is
 *      stopped here and never spends a shared slot below;
 *   2. the shared caps, the website's first and then the app-wide free one:
 *      a "busy" answer from either spends none of the person's own reads
 *      (and a busy website spends no app-wide free slot);
 *   3. the person's own read, spent last. This is the authoritative, atomic
 *      count; step 1 is only an early answer (it lets a read through when
 *      the count cannot be read, and this step still holds the limit).
 */
async function importBudget(deps: CardDeps, caller: PressCaller, host: string | null): Promise<Failure | null> {
  const perDay = caller.via === "trial" ? FREE_IMPORTS_PER_DAY : PAID_IMPORTS_PER_DAY;
  const used = await importsUsedToday(deps, caller.userId);
  if (used !== null && used >= perDay) return fail("limit", PRESS_IMPORT_LIMIT);
  if (host && (await deps.rateLimited(deps.hashKey(host.toLowerCase(), "press-host"), "press-host", 60, HOST_FETCHES_PER_MINUTE))) {
    return fail("limit", PRESS_IMPORT_BUSY);
  }
  if (
    caller.via === "trial" &&
    (await deps.rateLimited(deps.hashKey("all", "press-import-free"), "press-import-free", DAY, FREE_IMPORTS_APP_PER_DAY))
  ) {
    return fail("limit", PRESS_IMPORT_BUSY);
  }
  if (await deps.rateLimited(caller.userId, IMPORT_SCOPE, DAY, perDay)) return fail("limit", PRESS_IMPORT_LIMIT);
  return null;
}

async function writeBudget(deps: CardDeps, caller: PressCaller): Promise<Failure | null> {
  return (await deps.rateLimited(caller.userId, "press-card-write", 60 * 60, CARD_WRITES_PER_HOUR)) ? fail("limit", PRESS_WRITE_LIMIT) : null;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function optionalId(raw: unknown): { ok: true; id: string | null } | { ok: false } {
  if (raw === null || raw === undefined || raw === "") return { ok: true, id: null };
  return typeof raw === "string" && UUID_RE.test(raw) ? { ok: true, id: raw.toLowerCase() } : { ok: false };
}

async function owns(deps: CardDeps, caller: PressCaller, refs: Parameters<typeof checkOwned>[1]): Promise<Failure | null> {
  const check = await checkOwned(caller.userId, refs, deps.db);
  return check.ok ? null : fail(check.code === "notFound" ? "notYours" : "unavailable", check.error);
}

const bucket = (db: SupabaseClient) => db.storage.from(PRESS_KIT_BUCKET);
/** The staging bucket: a person's own uploads, until the server has read them. */
const staging = (db: SupabaseClient) => db.storage.from(PRESS_UPLOADS_BUCKET);
type StoreName = typeof PRESS_KIT_BUCKET | typeof PRESS_UPLOADS_BUCKET;

async function removePaths(db: SupabaseClient, paths: readonly string[], from: StoreName = PRESS_KIT_BUCKET): Promise<void> {
  if (paths.length === 0) return;
  try {
    await db.storage.from(from).remove([...paths]);
  } catch {
    /* best effort: the files are the person's own, under their folder (a staged one left behind is swept) */
  }
}

async function download(db: SupabaseClient, path: string, from: StoreName = PRESS_KIT_BUCKET, maxBytes = UPLOAD_MAX_BYTES): Promise<Buffer | null> {
  try {
    const { data, error } = await db.storage.from(from).download(path);
    if (error || !data || data.size > maxBytes) return null;
    return Buffer.from(await data.arrayBuffer());
  } catch {
    return null;
  }
}

async function signedUrls(db: SupabaseClient, paths: readonly string[]): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  if (paths.length === 0) return out;
  try {
    const { data } = await bucket(db).createSignedUrls([...paths], PHOTO_URL_SECONDS);
    for (const item of data ?? []) if (item?.path && item.signedUrl) out[item.path] = item.signedUrl;
  } catch {
    /* no display links is not a failure of the card */
  }
  return out;
}

/**
 * The sizes of staged uploads, read from the listing before any byte is
 * downloaded: a signed upload token does not bind a size (the staging
 * bucket's own 12 MB limit does, and this holds the line again should that
 * limit ever be raised), so an oversized file is refused here, not read
 * into memory. null when a file is missing or the listing fails.
 */
async function stagedSizes(db: SupabaseClient, paths: readonly string[]): Promise<Map<string, number> | null> {
  const sizes = new Map<string, number>();
  const folders = uniq(paths.map((path) => path.slice(0, path.lastIndexOf("/"))));
  try {
    for (const folder of folders) {
      const { data, error } = await staging(db).list(folder, { limit: 100 });
      if (error || !Array.isArray(data)) return null;
      for (const item of data) {
        const size = Number((item?.metadata as { size?: unknown } | null | undefined)?.size);
        if (item?.name) sizes.set(`${folder}/${item.name}`, Number.isFinite(size) ? size : 0);
      }
    }
  } catch {
    return null;
  }
  return paths.every((path) => sizes.has(path)) ? sizes : null;
}

function stagingPattern(userId: string): RegExp {
  return new RegExp(`^${userId}/uploads/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9]$`);
}

function productFolder(userId: string, productId: string): string {
  return `${userId}/products/${productId}/`;
}

function brandFolder(userId: string, kitId: string): string {
  return `${userId}/brand/${kitId}/`;
}

async function storePhoto(db: SupabaseClient, userId: string, productId: string, img: NormalizedProductImage): Promise<string | null> {
  const ext = img.mime === "image/png" ? "png" : "jpg";
  const path = `${productFolder(userId, productId)}${img.sha256.slice(0, 32)}.${ext}`;
  try {
    const { error } = await bucket(db).upload(path, img.data, { contentType: img.mime, upsert: true });
    return error ? null : path;
  } catch {
    return null;
  }
}

async function readCard(db: SupabaseClient, userId: string, productId: string): Promise<ProductCard | null | "unavailable"> {
  try {
    const { data, error } = await db
      .from("products")
      .select(PRODUCT_CARD_COLUMNS)
      .eq("id", productId)
      .eq("user_id", userId)
      .is("deleted_at", null)
      .maybeSingle();
    if (error) return "unavailable";
    return productCardFromRow(data);
  } catch {
    return "unavailable";
  }
}

async function readKit(db: SupabaseClient, userId: string, kitId: string): Promise<BrandKit | null | "unavailable"> {
  try {
    const { data, error } = await db
      .from("brand_kits")
      .select(BRAND_KIT_COLUMNS)
      .eq("id", kitId)
      .eq("user_id", userId)
      .is("deleted_at", null)
      .maybeSingle();
    if (error) return "unavailable";
    return brandKitFromRow(data);
  } catch {
    return "unavailable";
  }
}

async function hasConsent(
  db: SupabaseClient,
  userId: string,
  subject: { kind: "product"; productId: string } | { kind: "brand_kit"; brandKitId: string },
  hash: string,
): Promise<boolean | "unavailable"> {
  try {
    let query = db.from("product_consents").select("id").eq("user_id", userId).eq("kind", subject.kind).eq("photos_hash", hash);
    query = subject.kind === "product" ? query.eq("product_id", subject.productId) : query.eq("brand_kit_id", subject.brandKitId);
    const { data, error } = await query.limit(1);
    if (error || !Array.isArray(data)) return "unavailable";
    return data.length > 0;
  } catch {
    return "unavailable";
  }
}

function readingState(reading: LabelReading): LabelReadingState {
  if (!reading.configured) return "not_configured";
  return reading.ok ? "read" : "unavailable";
}

function uniq<T>(list: readonly T[]): T[] {
  return [...new Set(list)];
}

/** The card's own name and brand, as data for the product read when there is no page (they came from one once). */
function cardFence(card: ProductCard): string | null {
  const lines = [card.name ? `Product name: ${card.name}` : "", card.dna?.brand ? `Brand: ${card.dna.brand}` : ""].filter(Boolean);
  return lines.length > 0 ? fenceUntrusted(lines.join("\n"), "card") : null;
}

/**
 * A draft card found to be a regulated product: the refusal stays on the
 * record (its category and description), its photos, colours and words do
 * not — the same shape a regulated import is saved in. The photos' files go
 * too; nothing can ever use them. Throws on a failed write (the caller logs
 * it: the refusal stands either way).
 */
async function keepRefusalOnly(db: SupabaseClient, userId: string, card: ProductCard, dna: ProductDna | null): Promise<void> {
  const { error } = await db
    .from("products")
    .update({
      category: REGULATED,
      dna,
      dna_photos: [],
      image_paths: [],
      palette: [],
      label_strings: [],
      no_readable_text: false,
      logo_box: null,
      angles: null,
    })
    .eq("id", card.id)
    .eq("user_id", userId)
    .eq("status", "draft");
  if (error) throw new Error(error.message);
  await removePaths(db, uniq([...card.photos, ...(card.logoPath ? [card.logoPath] : [])]));
}

// ---------------------------------------------------------------------------
// The product read and the save both imports share
// ---------------------------------------------------------------------------

type ReadAndSave = {
  productId: string;
  existing: ProductCard | null;
  /** New pictures, in the order the card shows them. */
  images: NormalizedProductImage[];
  fencedPageText: string | null;
  sourceUrl: string | null;
  pageName: string | null;
  brandKitId: string | null;
  skipped: number;
};

async function readAndSave(deps: CardDeps, caller: PressCaller, x: ReadAndSave): Promise<ProductImported | Failure> {
  const p = providers(deps);
  const db = deps.db;
  const userId = caller.userId;

  // What the product IS, before anything is kept: a regulated product keeps
  // no photos. The read sees at most DNA_MAX_IMAGES of this batch; `seen`
  // remembers which, because the category it answers covers only those.
  const offered = await Promise.all(
    x.images.slice(0, DNA_MAX_IMAGES).map(async (img) => ({ img, url: await dnaImageFromBytes(img.data) })),
  );
  const seen = offered.filter((o): o is { img: NormalizedProductImage; url: string } => o.url !== null);
  const dna: ProductDnaResult = await p.readDna({ images: seen.map((o) => o.url), fencedPageText: x.fencedPageText });
  const regulated = (dna.ok && dna.regulated) || x.existing?.category === REGULATED;
  const name =
    cleanText(x.existing?.name || x.pageName || (dna.ok ? dna.dna.name : null) || DEFAULT_PRODUCT_NAME, CARD_LIMITS.productName) ??
    DEFAULT_PRODUCT_NAME;

  if (regulated) {
    const dnaValue: ProductDna | null = dna.ok ? { ...dna.dna, category: REGULATED } : x.existing?.dna ?? null;
    try {
      if (x.existing) {
        await keepRefusalOnly(db, userId, x.existing, dnaValue);
      } else {
        const { error } = await db.from("products").insert({
          id: x.productId,
          user_id: userId,
          name,
          source_url: x.sourceUrl,
          category: REGULATED,
          dna: dnaValue,
          image_paths: [],
          status: "draft",
          brand_kit_id: x.brandKitId,
        });
        if (error) throw new Error(error.message);
      }
    } catch (err) {
      // The refusal stands whether or not the record could be written.
      console.error(`[press-tour] regulated record not written: ${err instanceof Error ? err.message : String(err)}`);
    }
    return fail("regulated", PRODUCT_REGULATED_REFUSED, { productId: x.productId });
  }

  // Keep the photos.
  const stored: string[] = [];
  const pathOf = new Map<NormalizedProductImage, string>();
  for (const img of x.images) {
    const path = await storePhoto(db, userId, x.productId, img);
    if (!path) {
      await removePaths(db, stored);
      return fail("save", PRODUCT_SAVE_FAILED);
    }
    pathOf.set(img, path);
    if (!stored.includes(path)) stored.push(path);
  }

  // The words on the label, and the colours: proposals the person corrects.
  const reading = await p.readLabels(x.images.slice(0, OCR_MAX_IMAGES).map((img) => img.data));
  const palette =
    x.existing && x.existing.palette.length > 0 ? x.existing.palette : normalisePalette(await p.palette(x.images[0].data));

  const imagePaths = uniq([...stored, ...(x.existing?.photos ?? [])]).slice(0, CARD_LIMITS.photos);
  const dropped = (x.existing?.photos ?? []).filter((path) => !imagePaths.includes(path));

  // Which photos the card's category was read from (products.dna_photos). A
  // read of this batch covers the photos it saw; the card's earlier photos
  // stay covered only if a read saw them (a card with a category has
  // dna_photos; one without has none). A failed read covers nothing new:
  // its photos are stored, but confirming with any of them reads them first.
  const earlier = x.existing?.category ? x.existing.dnaPhotos : [];
  const covered = uniq([...(dna.ok ? seen.map((o) => pathOf.get(o.img)!) : []), ...earlier]).filter((path) => imagePaths.includes(path));
  let category = dna.ok ? dna.category : x.existing?.category ?? null;
  let dnaValue = dna.ok ? dna.dna : x.existing?.dna ?? null;
  if (covered.length === 0) {
    // No photo on the card was read: there is no category to keep.
    category = null;
    dnaValue = null;
  }

  let row: unknown = null;
  let saveError = false;
  try {
    if (x.existing) {
      const { data, error } = await db
        .from("products")
        .update({
          image_paths: imagePaths,
          category,
          dna: dnaValue,
          dna_photos: covered,
          palette,
          source_url: x.sourceUrl ?? x.existing.sourceUrl,
          ...(x.brandKitId ? { brand_kit_id: x.brandKitId } : {}),
        })
        .eq("id", x.productId)
        .eq("user_id", userId)
        .eq("status", "draft")
        .is("deleted_at", null)
        .select(PRODUCT_CARD_COLUMNS)
        .single();
      row = data;
      saveError = Boolean(error);
    } else {
      const { data, error } = await db
        .from("products")
        .insert({
          id: x.productId,
          user_id: userId,
          name,
          source_url: x.sourceUrl,
          category,
          dna: dnaValue,
          dna_photos: covered,
          image_paths: imagePaths,
          palette,
          label_strings: [],
          no_readable_text: false,
          status: "draft",
          brand_kit_id: x.brandKitId,
        })
        .select(PRODUCT_CARD_COLUMNS)
        .single();
      row = data;
      saveError = Boolean(error);
    }
  } catch {
    saveError = true;
  }
  const card = saveError ? null : productCardFromRow(row);
  if (!card) {
    await removePaths(db, stored.filter((path) => !(x.existing?.photos ?? []).includes(path)));
    return fail("save", PRODUCT_SAVE_FAILED);
  }
  await removePaths(db, dropped);

  return {
    error: null,
    card,
    photoUrls: await signedUrls(db, card.photos),
    labelCandidates: reading.configured && reading.ok ? reading.candidates : [],
    labelReading: readingState(reading),
    productRead: dna.ok ? "read" : "unavailable",
    photosSkipped: x.skipped,
  };
}

// ---------------------------------------------------------------------------
// importProductFromUrl
// ---------------------------------------------------------------------------

/** A product page → a draft product card (spec §1.1 steps 1–5, 7, 9). */
export async function importProductFromUrl(
  deps: CardDeps,
  caller: PressCaller,
  input: { url?: unknown; brandKitId?: unknown },
): Promise<ProductImported | Failure> {
  let url: URL;
  try {
    url = vetUrl(typeof input?.url === "string" ? input.url : "");
  } catch {
    return fail("link", PRODUCT_LINK_INVALID);
  }
  const kit = optionalId(input?.brandKitId);
  if (!kit.ok) return fail("notYours", NOT_YOURS);
  const notOwned = await owns(deps, caller, { brandKit: kit.id });
  if (notOwned) return notOwned;
  const over = await importBudget(deps, caller, url.hostname);
  if (over) return over;

  const p = providers(deps);
  if (!(await p.robotsAllows(url.href))) return fail("page", PAGE_UNREADABLE);
  let page: { html: string; url: string };
  try {
    page = await p.fetchPage(url.href);
  } catch {
    return fail("page", PAGE_UNREADABLE);
  }
  const extracted = extractProductPage(page.html, page.url);
  const prepared = await p.prepareImages(extracted.imageUrls, { maxImages: CARD_LIMITS.photos });
  if (prepared.images.length === 0) return fail("page", PAGE_UNREADABLE);

  let sourceUrl: string | null = null;
  try {
    sourceUrl = vetUrl(page.url).href;
  } catch {
    sourceUrl = url.href;
  }
  return readAndSave(deps, caller, {
    productId: p.newId(),
    existing: null,
    images: prepared.images,
    fencedPageText: extracted.fencedText,
    sourceUrl: sourceUrl.length <= CARD_LIMITS.sourceUrl ? sourceUrl : null,
    pageName: extracted.name,
    brandKitId: kit.id,
    skipped: prepared.rejected.length,
  });
}

// ---------------------------------------------------------------------------
// Uploads: places, then a card from them
// ---------------------------------------------------------------------------

/**
 * One-time places in storage for the person's own photos (or a logo): the
 * browser uploads straight to them (in the press-uploads bucket, which holds
 * each file to 12 MB and JPEG/PNG/WebP whatever the browser declared),
 * never through our server. A place never read is swept after 3 hours.
 */
export async function reservePressUploads(
  deps: CardDeps,
  caller: PressCaller,
  input: { purpose?: unknown; files?: unknown },
): Promise<UploadPlaces | Failure> {
  const purpose = input?.purpose === "logo" ? "logo" : input?.purpose === "product" ? "product" : null;
  const files = Array.isArray(input?.files) ? input.files : null;
  const max = purpose === "logo" ? 1 : PRODUCT_UPLOADS_MAX;
  if (!purpose || !files || files.length < 1 || files.length > max) return fail("upload", PRODUCT_UPLOAD_COUNT);
  for (const f of files) {
    const bytes = (f as { bytes?: unknown } | null)?.bytes;
    const type = (f as { type?: unknown } | null)?.type;
    if (typeof bytes !== "number" || !(bytes > 0) || bytes > UPLOAD_MAX_BYTES || !(UPLOAD_TYPES as readonly unknown[]).includes(type)) {
      return fail("upload", PRODUCT_UPLOAD_TYPE);
    }
  }
  if (await deps.rateLimited(caller.userId, "press-upload", 60 * 60, UPLOAD_RESERVATIONS_PER_HOUR)) return fail("limit", PRESS_UPLOAD_LIMIT);
  if (
    caller.via === "trial" &&
    (await deps.rateLimited(caller.userId, "press-upload-day", DAY, FREE_UPLOAD_RESERVATIONS_PER_DAY))
  ) {
    return fail("limit", PRESS_UPLOAD_DAY_LIMIT);
  }
  const batch = providers(deps).newId();
  const uploads: { path: string; token: string }[] = [];
  for (let i = 0; i < files.length; i++) {
    const path = `${caller.userId}/uploads/${batch}/${i}`;
    try {
      const { data, error } = await staging(deps.db).createSignedUploadUrl(path);
      if (error || !data?.token) return fail("save", PRODUCT_SAVE_FAILED);
      uploads.push({ path, token: data.token });
    } catch {
      return fail("save", PRODUCT_SAVE_FAILED);
    }
  }
  return { error: null, bucket: PRESS_UPLOADS_BUCKET, uploads };
}

function rejectionMessage(reason: string | null): string {
  if (reason === "too_small" || reason === "bad_shape") return PRODUCT_PHOTO_TOO_SMALL;
  if (reason === "svg_refused") return SVG_LOGO_REFUSED;
  return PRODUCT_PHOTO_UNREADABLE;
}

/**
 * The person's own photos (already uploaded to the places reserved above)
 * → a new draft card, or more photos on one of their draft cards. With a
 * `url` the product's page is read too, for its words and its photos
 * ("a pasted URL, 1–5 photos, or both": spec §1.1).
 */
export async function createProductFromUploads(
  deps: CardDeps,
  caller: PressCaller,
  input: { uploads?: unknown; productId?: unknown; url?: unknown; brandKitId?: unknown },
): Promise<ProductImported | Failure> {
  const userId = caller.userId;
  const uploads = Array.isArray(input?.uploads) ? input.uploads : null;
  if (!uploads || uploads.length < 1 || uploads.length > PRODUCT_UPLOADS_MAX) return fail("upload", PRODUCT_UPLOAD_COUNT);
  const staging = stagingPattern(userId);
  for (const path of uploads) {
    if (typeof path !== "string" || !staging.test(path) || !pathOwned(userId, path)) return fail("notYours", NOT_YOURS);
  }
  const paths = uniq(uploads as string[]);
  const productRef = optionalId(input?.productId);
  const kit = optionalId(input?.brandKitId);
  if (!productRef.ok || !kit.ok) return fail("notYours", NOT_YOURS);

  let pageUrl: URL | null = null;
  if (input?.url !== undefined && input?.url !== null && input?.url !== "") {
    try {
      pageUrl = vetUrl(typeof input.url === "string" ? input.url : "");
    } catch {
      return fail("link", PRODUCT_LINK_INVALID);
    }
  }

  try {
    const notOwned = await owns(deps, caller, { product: productRef.id, brandKit: kit.id });
    if (notOwned) return notOwned;
    let existing: ProductCard | null = null;
    if (productRef.id) {
      const card = await readCard(deps.db, userId, productRef.id);
      if (card === "unavailable") return fail("unavailable", OWNERSHIP_UNAVAILABLE);
      if (!card) return fail("notYours", NOT_YOURS);
      if (card.category === REGULATED) return fail("regulated", PRODUCT_REGULATED_REFUSED, { productId: card.id });
      if (card.status !== "draft") return fail("draftOnly", PRODUCT_NOT_DRAFT, { productId: card.id });
      existing = card;
    }
    const over = await importBudget(deps, caller, pageUrl?.hostname ?? null);
    if (over) return over;

    // The photos, checked and cleaned; duplicates dropped.
    const sizes = await stagedSizes(deps.db, paths);
    if (!sizes) return fail("upload", PRODUCT_UPLOAD_MISSING);
    if (paths.some((path) => (sizes.get(path) ?? 0) > UPLOAD_MAX_BYTES)) return fail("upload", PRODUCT_UPLOAD_TYPE);
    const images: NormalizedProductImage[] = [];
    let firstRejection: string | null = null;
    for (const path of paths) {
      const bytes = await download(deps.db, path, PRESS_UPLOADS_BUCKET);
      if (!bytes) return fail("upload", PRODUCT_UPLOAD_MISSING);
      try {
        const img = await normalizeProductImage(bytes);
        if (!images.some((k) => isSamePicture(k.fingerprint, img.fingerprint))) images.push(img);
      } catch (err) {
        firstRejection ??= err instanceof ProductImageError ? err.reason : "decode_failed";
      }
    }
    if (images.length === 0) return fail("photos", rejectionMessage(firstRejection));
    const skippedUploads = paths.length - images.length;

    // The page, when there is one: its words, and photos to fill the card.
    const p = providers(deps);
    let fencedPageText: string | null = existing ? cardFence(existing) : null;
    let sourceUrl: string | null = existing?.sourceUrl ?? null;
    let pageName: string | null = null;
    let pageSkipped = 0;
    if (pageUrl && (await p.robotsAllows(pageUrl.href))) {
      try {
        const page = await p.fetchPage(pageUrl.href);
        const extracted = extractProductPage(page.html, page.url);
        fencedPageText = extracted.fencedText;
        pageName = extracted.name;
        try {
          sourceUrl = vetUrl(page.url).href;
        } catch {
          sourceUrl = pageUrl.href;
        }
        const room = CARD_LIMITS.photos - images.length;
        if (room > 0 && extracted.imageUrls.length > 0) {
          const prepared = await p.prepareImages(extracted.imageUrls, { maxImages: room });
          pageSkipped = prepared.rejected.length;
          for (const img of prepared.images) {
            if (images.length >= CARD_LIMITS.photos) break;
            if (!images.some((k) => isSamePicture(k.fingerprint, img.fingerprint))) images.push(img);
          }
        }
      } catch {
        // The photos are enough on their own; the page just isn't read.
      }
    }

    return await readAndSave(deps, caller, {
      productId: existing?.id ?? p.newId(),
      existing,
      images,
      fencedPageText,
      sourceUrl: sourceUrl && sourceUrl.length <= CARD_LIMITS.sourceUrl ? sourceUrl : null,
      pageName,
      brandKitId: kit.id,
      skipped: skippedUploads + pageSkipped,
    });
  } finally {
    // The uploads were read (or refused): they are not kept.
    await removePaths(deps.db, paths, PRESS_UPLOADS_BUCKET);
  }
}

// ---------------------------------------------------------------------------
// recordConsent
// ---------------------------------------------------------------------------

/**
 * "I own this product, or may advertise it, and may use these photos" (kind
 * 'product', for exactly the photos named) or "This is my brand, or I may
 * use its name and logo" (kind 'brand_kit', for exactly the logo named).
 * The notice version, the method and the hashed address are the server's.
 */
export async function recordConsent(
  deps: CardDeps,
  caller: PressCaller,
  input: {
    kind?: unknown;
    productId?: unknown;
    brandKitId?: unknown;
    photos?: unknown;
    logoPath?: unknown;
    answer?: unknown;
    place?: unknown;
  },
  context: { locale: string; ip: string | null },
): Promise<ConsentRecorded | Failure> {
  const userId = caller.userId;
  const answer = parseConsentAnswer(input?.answer);
  const kind = input?.kind === "product" || input?.kind === "brand_kit" ? input.kind : null;
  const place: ConsentPlace = (CONSENT_PLACES as readonly unknown[]).includes(input?.place) ? (input.place as ConsentPlace) : "door";
  if (!answer || !kind) return fail("consent", CONSENT_SAVE_FAILED);
  const over = await writeBudget(deps, caller);
  if (over) return over;

  let hash: string;
  let subject: { product_id: string | null; brand_kit_id: string | null };
  if (kind === "product") {
    const ref = optionalId(input?.productId);
    if (!ref.ok || !ref.id) return fail("notYours", NOT_YOURS);
    const notOwned = await owns(deps, caller, { product: ref.id });
    if (notOwned) return notOwned;
    const card = await readCard(deps.db, userId, ref.id);
    if (card === "unavailable") return fail("unavailable", OWNERSHIP_UNAVAILABLE);
    if (!card) return fail("notYours", NOT_YOURS);
    if (card.category === REGULATED) return fail("regulated", PRODUCT_REGULATED_REFUSED, { productId: card.id });
    const photos = Array.isArray(input?.photos) ? input.photos : null;
    if (!photos || photos.length < 1 || photos.length > CARD_LIMITS.photos) return fail("angles", PRODUCT_ANGLES_REQUIRED);
    if (!photos.every((path) => typeof path === "string" && card.photos.includes(path))) return fail("notYours", NOT_YOURS);
    hash = photosHash(uniq(photos as string[]));
    subject = { product_id: card.id, brand_kit_id: null };
  } else {
    const ref = optionalId(input?.brandKitId);
    if (!ref.ok || !ref.id) return fail("notYours", NOT_YOURS);
    const notOwned = await owns(deps, caller, { brandKit: ref.id });
    if (notOwned) return notOwned;
    const kit = await readKit(deps.db, userId, ref.id);
    if (kit === "unavailable") return fail("unavailable", OWNERSHIP_UNAVAILABLE);
    if (!kit) return fail("notYours", NOT_YOURS);
    const logo = input?.logoPath ?? null;
    if (logo !== null && (typeof logo !== "string" || !logo.startsWith(brandFolder(userId, kit.id)) || !pathOwned(userId, logo))) {
      return fail("notYours", NOT_YOURS);
    }
    hash = photosHash(logo ? [logo as string] : []);
    subject = { product_id: null, brand_kit_id: kit.id };
  }

  const locale = typeof context?.locale === "string" && /^[a-z]{2}(-[A-Za-z]{2})?$/.test(context.locale) ? context.locale : "en";
  try {
    const { error } = await deps.db.from("product_consents").insert({
      user_id: userId,
      kind,
      ...subject,
      answer,
      photos_hash: hash,
      notice_version: PRESS_CONSENT_NOTICE_VERSION,
      locale,
      method: CONSENT_METHOD,
      place,
      ip_hash: context?.ip ? deps.hashKey(context.ip, "press-consent") : null,
    });
    if (error) return fail("save", CONSENT_SAVE_FAILED);
  } catch {
    return fail("save", CONSENT_SAVE_FAILED);
  }
  return { error: null, photosHash: hash };
}

// ---------------------------------------------------------------------------
// confirmProductCard
// ---------------------------------------------------------------------------

function parseAngles(raw: unknown, photos: readonly string[]): ProductAngle[] | null {
  if (!Array.isArray(raw) || raw.length < ANGLES_MIN || raw.length > ANGLES_MAX) return null;
  const out: ProductAngle[] = [];
  for (const item of raw) {
    const path = (item as { path?: unknown } | null)?.path;
    const view = (item as { view?: unknown } | null)?.view;
    if (typeof path !== "string" || !photos.includes(path) || out.some((a) => a.path === path)) return null;
    if (!(PRODUCT_VIEWS as readonly unknown[]).includes(view)) return null;
    out.push({ path, view: view as ProductView });
  }
  return out;
}

function parseLogoBox(raw: unknown, chosen: readonly string[]): LogoBox | null | "invalid" {
  if (raw === null || raw === undefined) return null;
  if (typeof raw !== "object" || Array.isArray(raw)) return "invalid";
  const b = raw as Record<string, unknown>;
  const nums = [b.x, b.y, b.w, b.h];
  if (typeof b.path !== "string" || !chosen.includes(b.path)) return "invalid";
  if (!nums.every((n) => typeof n === "number" && Number.isFinite(n) && n >= 0 && n <= 1)) return "invalid";
  const [x, y, w, h] = nums as number[];
  if (w <= 0 || h <= 0 || x + w > 1 || y + h > 1) return "invalid";
  return { path: b.path, x, y, w, h };
}

async function saveLogoCrop(db: SupabaseClient, userId: string, productId: string, box: LogoBox): Promise<string | null> {
  const photo = await download(db, box.path);
  if (!photo) return null;
  try {
    const meta = await sharp(photo, { limitInputPixels: 50_000_000 }).metadata();
    const width = meta.width ?? 0;
    const height = meta.height ?? 0;
    if (!width || !height) return null;
    const left = Math.min(width - 1, Math.floor(box.x * width));
    const top = Math.min(height - 1, Math.floor(box.y * height));
    const crop = await sharp(photo, { limitInputPixels: 50_000_000 })
      .extract({
        left,
        top,
        width: Math.max(1, Math.min(width - left, Math.round(box.w * width))),
        height: Math.max(1, Math.min(height - top, Math.round(box.h * height))),
      })
      .png()
      .toBuffer();
    const path = `${productFolder(userId, productId)}logo-${createHash("sha256").update(crop).digest("hex").slice(0, 32)}.png`;
    const { error } = await bucket(db).upload(path, crop, { contentType: "image/png", upsert: true });
    return error ? null : path;
  } catch {
    return null;
  }
}

/**
 * The person's answers make the card: 3–5 photos with their views (one the
 * front), the label words confirmed or "no readable text", an optional
 * logo box, the colours. Needs a product consent for exactly the chosen
 * photos (recordConsent) — the database holds the same rule.
 */
export async function confirmProductCard(
  deps: CardDeps,
  caller: PressCaller,
  input: {
    productId?: unknown;
    angles?: unknown;
    labelStrings?: unknown;
    noReadableText?: unknown;
    logoBox?: unknown;
    palette?: unknown;
    name?: unknown;
    brandKitId?: unknown;
  },
): Promise<ProductConfirmed | Failure> {
  const userId = caller.userId;
  const ref = optionalId(input?.productId);
  const kit = optionalId(input?.brandKitId);
  if (!ref.ok || !ref.id || !kit.ok) return fail("notYours", NOT_YOURS);
  const notOwned = await owns(deps, caller, { product: ref.id, brandKit: kit.id });
  if (notOwned) return notOwned;
  const over = await writeBudget(deps, caller);
  if (over) return over;

  const card = await readCard(deps.db, userId, ref.id);
  if (card === "unavailable") return fail("unavailable", OWNERSHIP_UNAVAILABLE);
  if (!card || card.status === "archived") return fail("notYours", NOT_YOURS);
  if (card.category === REGULATED) return fail("regulated", PRODUCT_REGULATED_REFUSED, { productId: card.id });

  const angles = parseAngles(input?.angles, card.photos);
  if (!angles) return fail("angles", PRODUCT_ANGLES_REQUIRED);
  if (!angles.some((a) => a.view === "front")) return fail("front", PRODUCT_FRONT_REQUIRED);
  const chosen = angles.map((a) => a.path);

  const noReadableText = input?.noReadableText === true;
  const labelStrings = noReadableText ? [] : normaliseLabelStrings(input?.labelStrings);
  const typedWords = Array.isArray(input?.labelStrings) && input.labelStrings.length > 0;
  if (noReadableText ? typedWords : labelStrings.length === 0) return fail("label", PRODUCT_LABEL_REQUIRED);

  const logoBox = parseLogoBox(input?.logoBox, chosen);
  if (logoBox === "invalid") return fail("logoBox", PRODUCT_LOGO_BOX_INVALID);

  // The consent for exactly these photos, before anything costs anything.
  const hash = photosHash(chosen);
  const consented = await hasConsent(deps.db, userId, { kind: "product", productId: card.id }, hash);
  if (consented === "unavailable") return fail("unavailable", OWNERSHIP_UNAVAILABLE);
  if (!consented) return fail("consent", PRODUCT_CONSENT_REQUIRED, { productId: card.id, photosHash: hash });

  const p = providers(deps);
  // The category is decided by meaning, never by the person's pick, and it
  // covers exactly the photos a read saw (products.dna_photos). A card whose
  // read failed, or a pick with any photo no read saw (a page's sixth
  // picture, a batch added while the read was down), is read again now:
  // every chosen photo, in one call, or nothing is confirmed.
  let category = card.category;
  let dna = card.dna;
  if (!category || chosen.some((path) => !card.dnaPhotos.includes(path))) {
    const budget = await importBudget(deps, caller, null);
    if (budget) return budget;
    const photos = await Promise.all(chosen.map((path) => download(deps.db, path)));
    const images = await Promise.all(photos.map((bytes) => (bytes ? dnaImageFromBytes(bytes) : Promise.resolve(null))));
    // A photo that cannot be shown to the read is a photo the category would not cover.
    if (chosen.length > DNA_MAX_IMAGES || images.some((url) => url === null)) {
      return fail("read", PRODUCT_READ_UNAVAILABLE, { productId: card.id });
    }
    const read = await p.readDna({ images: images as string[], fencedPageText: cardFence(card) });
    if (!read.ok) return fail("read", PRODUCT_READ_UNAVAILABLE, { productId: card.id });
    category = read.category;
    dna = read.dna;
    if (read.regulated) {
      try {
        await keepRefusalOnly(deps.db, userId, card, dna);
      } catch (err) {
        console.error(`[press-tour] regulated record not written: ${err instanceof Error ? err.message : String(err)}`);
      }
      return fail("regulated", PRODUCT_REGULATED_REFUSED, { productId: card.id });
    }
  }

  // Colours: the person's, else the card's, else read from the front photo.
  let palette = normalisePalette(input?.palette);
  if (palette.length === 0) palette = card.palette;
  if (palette.length === 0) {
    const front = angles.find((a) => a.view === "front")!;
    const bytes = await download(deps.db, front.path);
    palette = bytes ? normalisePalette(await p.palette(bytes)) : [];
  }

  let logoPath: string | null = null;
  if (logoBox) {
    logoPath = await saveLogoCrop(deps.db, userId, card.id, logoBox);
    if (!logoPath) return fail("save", PRODUCT_SAVE_FAILED);
  }
  const lockRefs = uniq([...chosen, ...(logoPath ? [logoPath] : [])]).slice(0, CARD_LIMITS.lockRefs);
  const name = cleanText(input?.name, CARD_LIMITS.productName) ?? card.name;

  let row: unknown = null;
  let saveError: { message?: string } | null = null;
  try {
    const { data, error } = await deps.db
      .from("products")
      .update({
        name,
        ...(kit.id ? { brand_kit_id: kit.id } : {}),
        image_paths: chosen,
        angles,
        label_strings: labelStrings,
        no_readable_text: noReadableText,
        logo_box: logoBox,
        logo_path: logoPath,
        palette,
        lock_refs: lockRefs,
        photos_hash: hash,
        category,
        dna,
        // Every chosen photo was seen by the read the category came from (above).
        dna_photos: chosen,
        status: "confirmed",
        confirmed_at: p.now().toISOString(),
      })
      .eq("id", card.id)
      .eq("user_id", userId)
      .is("deleted_at", null)
      .select(PRODUCT_CARD_COLUMNS)
      .single();
    row = data;
    saveError = error;
  } catch (err) {
    saveError = { message: err instanceof Error ? err.message : String(err) };
  }
  const saved = saveError ? null : productCardFromRow(row);
  if (!saved) {
    // The database's own consent rule said no (a consent withdrawn between
    // the check and the write): the same sentence as the check.
    if (logoPath && logoPath !== card.logoPath) await removePaths(deps.db, [logoPath]);
    if (/consent/i.test(saveError?.message ?? "")) return fail("consent", PRODUCT_CONSENT_REQUIRED, { productId: card.id, photosHash: hash });
    return fail("save", PRODUCT_SAVE_FAILED);
  }
  // The photos not picked, and a logo crop this one replaced, are no longer
  // the card's: nothing points at them now.
  const orphaned = [...card.photos.filter((path) => !chosen.includes(path)), ...(card.logoPath && card.logoPath !== logoPath ? [card.logoPath] : [])];
  await removePaths(deps.db, orphaned);
  return { error: null, card: saved, photoUrls: await signedUrls(deps.db, saved.photos) };
}

// ---------------------------------------------------------------------------
// Brand kits
// ---------------------------------------------------------------------------

/** A brand's website → a draft brand kit the person confirms field by field (spec §1.2). */
export async function importBrandKit(deps: CardDeps, caller: PressCaller, input: { url?: unknown }): Promise<BrandKitImported | Failure> {
  let url: URL;
  try {
    url = vetUrl(typeof input?.url === "string" ? input.url : "");
  } catch {
    return fail("link", BRAND_LINK_INVALID);
  }
  const over = await importBudget(deps, caller, url.hostname);
  if (over) return over;
  const p = providers(deps);
  if (!(await p.robotsAllows(url.href))) return fail("page", PAGE_UNREADABLE);
  const read = await p.importBrandSite(url.href);
  if (!read.ok) return fail("page", read.error);
  const draft = read.draft;

  const kitId = p.newId();
  const userId = caller.userId;
  const stored: string[] = [];
  for (const logo of draft.logos) {
    const path = `${brandFolder(userId, kitId)}logo-${logo.sha256.slice(0, 32)}.png`;
    try {
      const { error } = await bucket(deps.db).upload(path, logo.data, { contentType: "image/png", upsert: true });
      if (!error && !stored.includes(path)) stored.push(path);
    } catch {
      /* a logo that could not be kept is one fewer candidate */
    }
  }
  let sourceUrl: string | null = null;
  try {
    sourceUrl = vetUrl(draft.sourceUrl).href;
  } catch {
    sourceUrl = url.href;
  }
  const toneLine = [draft.toneWords.join(", "), draft.tone].filter((s) => s && s.length > 0).join(". ");
  const row = {
    id: kitId,
    user_id: userId,
    name: cleanText(draft.name, CARD_LIMITS.brandName) ?? cleanText(url.hostname.replace(/^www\./, ""), CARD_LIMITS.brandName) ?? "My brand",
    source_url: sourceUrl.length <= CARD_LIMITS.sourceUrl ? sourceUrl : null,
    logo_path: stored[0] ?? null,
    palette: normalisePalette(draft.palette),
    fonts: draft.fonts.slice(0, CARD_LIMITS.fonts),
    tone: cleanText(toneLine, CARD_LIMITS.tone),
    tagline: cleanText(draft.tagline, CARD_LIMITS.tagline),
    default_cta: cleanText(draft.defaultCta, CARD_LIMITS.cta),
    status: "draft",
  };
  let kit: BrandKit | null = null;
  try {
    const { data, error } = await deps.db.from("brand_kits").insert(row).select(BRAND_KIT_COLUMNS).single();
    kit = error ? null : brandKitFromRow(data);
  } catch {
    kit = null;
  }
  if (!kit) {
    await removePaths(deps.db, stored);
    return fail("save", BRAND_SAVE_FAILED);
  }
  const urls = await signedUrls(deps.db, stored);
  return {
    error: null,
    kit,
    logoCandidates: stored.map((path) => ({ path, url: urls[path] ?? null })),
    toneWords: draft.toneWords,
    logoNotice: draft.logoNotice,
    voiceRead: draft.voice,
  };
}

function cleanList(raw: unknown, count: number, each: number): string[] {
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  for (const item of raw) {
    const s = cleanText(item, each);
    if (s && !out.some((o) => o.toLowerCase() === s.toLowerCase())) out.push(s);
    if (out.length === count) break;
  }
  return out;
}

/**
 * Saves a brand kit the person has checked: a new one (always a draft — a
 * kit must exist before its consent can name it), or one of theirs. With
 * `confirm` it becomes confirmed, which needs a brand-kit consent for
 * exactly its logo (or for no logo). A `logoUpload` is one of the person's
 * reserved upload places holding a new logo.
 */
export async function saveBrandKit(
  deps: CardDeps,
  caller: PressCaller,
  input: {
    id?: unknown;
    name?: unknown;
    logoPath?: unknown;
    logoUpload?: unknown;
    palette?: unknown;
    fonts?: unknown;
    tone?: unknown;
    tagline?: unknown;
    defaultCta?: unknown;
    confirm?: unknown;
  },
): Promise<BrandKitSaved | Failure> {
  const userId = caller.userId;
  const ref = optionalId(input?.id);
  if (!ref.ok) return fail("notYours", NOT_YOURS);
  const upload = input?.logoUpload ?? null;
  if (upload !== null && (typeof upload !== "string" || !stagingPattern(userId).test(upload))) return fail("notYours", NOT_YOURS);
  const name = cleanText(input?.name, CARD_LIMITS.brandName);
  if (!name) return fail("name", BRAND_NAME_REQUIRED);
  const over = await writeBudget(deps, caller);
  if (over) return over;

  const p = providers(deps);
  let existing: BrandKit | null = null;
  if (ref.id) {
    const notOwned = await owns(deps, caller, { brandKit: ref.id });
    if (notOwned) return notOwned;
    const kit = await readKit(deps.db, userId, ref.id);
    if (kit === "unavailable") return fail("unavailable", OWNERSHIP_UNAVAILABLE);
    if (!kit) return fail("notYours", NOT_YOURS);
    existing = kit;
  }
  const kitId = existing?.id ?? p.newId();

  // The logo: a new upload, one of this kit's own files, none, or unchanged.
  let logoPath: string | null = existing?.logoPath ?? null;
  let newLogo: string | null = null;
  if (typeof upload === "string") {
    try {
      const sizes = await stagedSizes(deps.db, [upload]);
      if (!sizes) return fail("upload", PRODUCT_UPLOAD_MISSING);
      if ((sizes.get(upload) ?? 0) > UPLOAD_MAX_BYTES) return fail("logo", BRAND_LOGO_INVALID);
      const bytes = await download(deps.db, upload, PRESS_UPLOADS_BUCKET);
      if (!bytes) return fail("upload", PRODUCT_UPLOAD_MISSING);
      let logo;
      try {
        logo = await normaliseLogo(bytes);
      } catch (err) {
        return fail("logo", err instanceof LogoError && err.reason === "svg_refused" ? SVG_LOGO_REFUSED : BRAND_LOGO_INVALID);
      }
      const path = `${brandFolder(userId, kitId)}logo-${logo.sha256.slice(0, 32)}.png`;
      const { error } = await bucket(deps.db).upload(path, logo.data, { contentType: "image/png", upsert: true });
      if (error) return fail("save", BRAND_SAVE_FAILED);
      logoPath = path;
      newLogo = path;
    } finally {
      await removePaths(deps.db, [upload], PRESS_UPLOADS_BUCKET);
    }
  } else if (input?.logoPath !== undefined) {
    const given = input.logoPath;
    if (given !== null && (typeof given !== "string" || !given.startsWith(brandFolder(userId, kitId)) || !pathOwned(userId, given))) {
      return fail("notYours", NOT_YOURS);
    }
    logoPath = given as string | null;
  }

  const fields = {
    name,
    logo_path: logoPath,
    palette: input?.palette === undefined ? existing?.palette ?? [] : normalisePalette(input.palette),
    fonts: input?.fonts === undefined ? existing?.fonts ?? [] : cleanList(input.fonts, CARD_LIMITS.fonts, CARD_LIMITS.font),
    tone: input?.tone === undefined ? existing?.tone ?? null : cleanText(input.tone, CARD_LIMITS.tone),
    tagline: input?.tagline === undefined ? existing?.tagline ?? null : cleanText(input.tagline, CARD_LIMITS.tagline),
    default_cta: input?.defaultCta === undefined ? existing?.defaultCta ?? null : cleanText(input.defaultCta, CARD_LIMITS.cta),
  };

  const confirm = input?.confirm === true && existing !== null;
  let status: "draft" | "confirmed" = "draft";
  let hash: string | null = existing?.photosHash ?? null;
  if (confirm) {
    hash = photosHash(logoPath ? [logoPath] : []);
    const consented = await hasConsent(deps.db, userId, { kind: "brand_kit", brandKitId: kitId }, hash);
    if (consented !== true) {
      // A logo uploaded with this very save has no consent yet (it is named
      // by its bytes): it is not kept. Save the kit as a draft, answer the
      // consent for its logo, then confirm.
      if (newLogo) await removePaths(deps.db, [newLogo]);
      if (consented === "unavailable") return fail("unavailable", OWNERSHIP_UNAVAILABLE);
      return fail("consent", BRAND_CONSENT_REQUIRED, { brandKitId: kitId, photosHash: hash });
    }
    status = "confirmed";
  }

  let row: unknown = null;
  let saveError: { message?: string } | null = null;
  try {
    const write = existing
      ? deps.db
          .from("brand_kits")
          .update({
            ...fields,
            status,
            photos_hash: hash,
            confirmed_at: status === "confirmed" ? p.now().toISOString() : null,
          })
          .eq("id", kitId)
          .eq("user_id", userId)
          .is("deleted_at", null)
      : deps.db.from("brand_kits").insert({ id: kitId, user_id: userId, ...fields, status: "draft" });
    const { data, error } = await write.select(BRAND_KIT_COLUMNS).single();
    row = data;
    saveError = error;
  } catch (err) {
    saveError = { message: err instanceof Error ? err.message : String(err) };
  }
  const kit = saveError ? null : brandKitFromRow(row);
  if (!kit) {
    if (newLogo && newLogo !== existing?.logoPath) await removePaths(deps.db, [newLogo]);
    if (/consent/i.test(saveError?.message ?? "")) return fail("consent", BRAND_CONSENT_REQUIRED, { brandKitId: kitId, photosHash: hash ?? undefined });
    return fail("save", BRAND_SAVE_FAILED);
  }
  const urls = kit.logoPath ? await signedUrls(deps.db, [kit.logoPath]) : {};
  return { error: null, kit, logoUrl: kit.logoPath ? urls[kit.logoPath] ?? null : null };
}
