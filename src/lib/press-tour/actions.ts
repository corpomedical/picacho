"use server";

// Press Tour's product card and brand kit, from the browser (spec §1.1,
// §1.2; synthesis §3.4 Cut 1). No UI here: the door, the Generate mode, the
// Producer and MCP all call these.
//
// A thin door onto card-service.ts, which decides everything and is tested
// as it is (card-service.test.ts). Each action here does exactly three
// things, in this order, and nothing else:
//   1. who: the signed-in person, through pressTourCaller — Press Tour
//      switched on, the person allowed (admins first; plans and the trial
//      only once their own switches are on), and a CONFIRMED EMAIL before
//      anything can reach a paid call (critique #20). It reads with the
//      person's own client, as every other door does;
//   2. the real clients: the service role for every write (people only ever
//      SELECT products, brand_kits and product_consents:
//      press-tour-02-products.sql), rate-limit.ts for every budget;
//   3. the card-service entry, which checks ownership (owned.ts), spends the
//      budget ('press-import': 20 a day on a plan, 3 on the trial) and only
//      then fetches or calls a provider.
// An error nothing names is caught here, logged, and answered with one
// English sentence; every sentence is an English constant i18n maps.
//
// The page that calls importProductFromUrl, createProductFromUploads or
// importBrandKit needs `export const maxDuration = 120` or more: a page read,
// up to 16 pictures, the product read and the label reading run in turn.
//
// Every export of a "use server" file must be an async function; the shapes
// (ProductImported, Failure...) are imported from card-service.ts.

import { headers } from "next/headers";
import { getLocale } from "@/lib/i18n/server";
import { hashedRateKey, rateLimited } from "@/lib/rate-limit";
import { createAdminClient, createClient } from "@/lib/supabase/server";
import { cardSelfTest } from "@/lib/product-lock/live";
import {
  PRESS_TOUR_FAILED,
  confirmProductCard as confirmCard,
  createProductFromUploads as cardFromUploads,
  importBrandKit as draftBrandKit,
  importProductFromUrl as cardFromUrl,
  pressTourCaller,
  recordConsent as keepConsent,
  reservePressUploads as uploadPlaces,
  saveBrandKit as keepBrandKit,
  type BrandKitImported,
  type BrandKitSaved,
  type CardDeps,
  type ConsentRecorded,
  type Failure,
  type PressCaller,
  type ProductConfirmed,
  type ProductImported,
  type UploadPlaces,
} from "./card-service";
import type { ConsentAnswer, ConsentPlace, LogoBox, ProductView } from "./types";

type Door = { error: null; caller: PressCaller; deps: CardDeps } | Failure;

/** Who is asking, and the clients the card service works with. */
async function door(): Promise<Door> {
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  const who = await pressTourCaller(supabase, data.user);
  if (who.error !== null) return who;
  return { error: null, caller: who.caller, deps: { db: createAdminClient(), rateLimited, hashKey: hashedRateKey } };
}

/** Runs one card-service entry behind the door; an unexpected throw is one plain sentence, never the raw error. */
async function behindDoor<T>(name: string, run: (caller: PressCaller, deps: CardDeps) => Promise<T | Failure>): Promise<T | Failure> {
  try {
    const d = await door();
    if (d.error !== null) return d;
    return await run(d.caller, d.deps);
  } catch (err) {
    console.error(`[press-tour] ${name} failed: ${err instanceof Error ? err.message : String(err)}`);
    return { error: PRESS_TOUR_FAILED, code: "unavailable" };
  }
}

/** The requesting address, for the consent record's ip_hash (hashed there, never kept raw). */
async function callerIp(): Promise<string | null> {
  const h = await headers();
  return h.get("x-forwarded-for")?.split(",")[0]?.trim() || h.get("x-real-ip") || null;
}

// ---------------------------------------------------------------------------
// The product card
// ---------------------------------------------------------------------------

/** A product page's address → a draft card: its photos, the words read on them, its colours. */
export async function importProductFromUrl(input: { url: string; brandKitId?: string | null }): Promise<ProductImported | Failure> {
  return behindDoor("import from a link", (caller, deps) => cardFromUrl(deps, caller, input));
}

/** Places for the person's own photos (purpose 'product', 1–5) or a logo ('logo', 1): the browser uploads straight to them. */
export async function reservePressUploads(input: {
  purpose: "product" | "logo";
  files: { bytes: number; type: string }[];
}): Promise<UploadPlaces | Failure> {
  return behindDoor("upload places", (caller, deps) => uploadPlaces(deps, caller, input));
}

/**
 * The photos just uploaded → a new draft card, or more photos on one of the
 * person's drafts (productId). With a url, the product's page is read too.
 */
export async function createProductFromUploads(input: {
  uploads: string[];
  productId?: string | null;
  url?: string | null;
  brandKitId?: string | null;
}): Promise<ProductImported | Failure> {
  return behindDoor("import from photos", (caller, deps) => cardFromUploads(deps, caller, input));
}

/**
 * "I own this product, or may advertise it, and may use these photos"
 * (kind 'product', for exactly the photos named), or "This is my brand, or I
 * may use its name and logo" (kind 'brand_kit', for exactly the logo named).
 * The language and the address are read here, on the server.
 */
export async function recordConsent(input: {
  kind: "product" | "brand_kit";
  productId?: string | null;
  brandKitId?: string | null;
  photos?: string[];
  logoPath?: string | null;
  answer: ConsentAnswer;
  place?: ConsentPlace;
}): Promise<ConsentRecorded | Failure> {
  return behindDoor("consent", async (caller, deps) => {
    const [locale, ip] = await Promise.all([getLocale(), callerIp()]);
    return keepConsent(deps, caller, input, { locale, ip });
  });
}

/**
 * The person's answers make the card: 3–5 photos with their views (one the
 * front), the label words confirmed or "No readable text on this product",
 * an optional logo box, the colours. Needs a product consent for exactly the
 * chosen photos.
 */
export async function confirmProductCard(input: {
  productId: string;
  angles: { path: string; view: ProductView }[];
  labelStrings?: string[];
  noReadableText?: boolean;
  logoBox?: LogoBox | null;
  palette?: string[];
  name?: string;
  brandKitId?: string | null;
}): Promise<ProductConfirmed | Failure> {
  // The card self-test (synthesis v2 #7): every chosen photo must read Match
  // before the card is confirmed — wired only here, where it can spend.
  return behindDoor("confirm a card", (caller, deps) => confirmCard({ ...deps, selfTest: cardSelfTest }, caller, input));
}

// ---------------------------------------------------------------------------
// The brand kit
// ---------------------------------------------------------------------------

/** A brand's website → a draft kit (name, logos, colours, fonts, suggested words) the person checks field by field. */
export async function importBrandKit(input: { url: string }): Promise<BrandKitImported | Failure> {
  return behindDoor("import a brand kit", (caller, deps) => draftBrandKit(deps, caller, input));
}

/**
 * Saves a brand kit the person has checked (a new one is always a draft);
 * with confirm, it becomes confirmed, which needs a brand consent for
 * exactly its logo. logoUpload is one of the person's reserved upload places.
 */
export async function saveBrandKit(input: {
  id?: string | null;
  name: string;
  logoPath?: string | null;
  logoUpload?: string | null;
  palette?: string[];
  fonts?: string[];
  tone?: string | null;
  tagline?: string | null;
  defaultCta?: string | null;
  confirm?: boolean;
}): Promise<BrandKitSaved | Failure> {
  return behindDoor("save a brand kit", (caller, deps) => keepBrandKit(deps, caller, input));
}
