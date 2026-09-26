// What the Press Tour door opens on (build map §5.1; synthesis §3.4 Cut 1):
// the person's characters (the stars, each with its ad-use answer for its
// photos now: star-consent.ts), their product cards and brand kits (the card
// service's own columns and parsers), and the campaign they left open, if any. Read once by app/app/press-tour/page.tsx, AFTER the page has
// refused everyone it is not for.
//
// EVERY READ NAMES ITS OWNER. products and brand_kits keep an admins' read
// policy (press-tour-02-products.sql), and the door opens to admins first: a
// read that leaned on RLS alone would show an admin every account's products.
// So each query filters user_id explicitly, as the app layout does for
// generations (door-data.test.ts pins it).
//
// Two clients, handed in: `db` is the person's own (RLS applies), `admin` the
// service role, used only for what people cannot read themselves — display
// links for the private press-kit bucket (only paths under the person's own
// folder are signed) and the open campaign (press_campaigns has no policy
// for people, synthesis #30).
//
// Everything fails soft: a read that errors is an empty shelf, never a
// broken door. Alias-free (vitest has no "@/"): door-data.test.ts imports it
// as it is.

import type { SupabaseClient } from "@supabase/supabase-js";
import { mediaUrl, thumbUrl } from "../media/url";
import { CAMPAIGN_STAGES, type CampaignStage } from "./campaign-types";
import { PHOTO_URL_SECONDS, PRESS_KIT_BUCKET } from "./card-service";
import { pathOwned } from "./owned";
import { STAR_CONSENT_TABLE, currentStarAnswer, type StarAnswer } from "./star-consent";
import {
  BRAND_KIT_COLUMNS,
  PRODUCT_CARD_COLUMNS,
  brandKitFromRow,
  cardWithHeldFiles,
  productCardFromRow,
  type BrandKit,
  type ProductCard,
} from "./types";

/** A star the door can cast: a saved character and one photo to show. */
export type PressCharacter = {
  id: string;
  name: string;
  /** A small display link for the first reference photo, or null without one. */
  photoUrl: string | null;
  /** How many reference photos the character has (the face check's references). */
  photoCount: number;
  /**
   * The person's answer for these exact photos (star-consent.ts): who is in
   * them, given together with "may appear in ads for products I sell". Null
   * until answered, and again once the photos change. The Starring tile's
   * "You said…" line is printed only from this.
   */
  adAnswer: StarAnswer | null;
};

/** A product card as the door shows it, with short-lived display links for its photos. */
export type PressProduct = {
  /** The card with only the files press-kit holds (cardWithHeldFiles): what the door counts, shows and hands the card sheet. */
  card: ProductCard;
  /** Display links keyed by storage path (card.photos, and the logo crop). Short-lived. */
  photoUrls: Record<string, string>;
};

/** A brand kit, with a display link for its logo. */
export type PressBrandKit = {
  kit: BrandKit;
  logoUrl: string | null;
};

export type PressTourHome = {
  characters: PressCharacter[];
  products: PressProduct[];
  brandKits: PressBrandKit[];
  /**
   * The newest campaign that is not closed (not failed, cancelled or
   * expired), or null. The door asks the engine for its view
   * (CampaignActions.getCampaign), so the projection lives in one place.
   */
  openCampaignId: string | null;
};

/** How many of each the door lists. */
export const DOOR_LIMITS = { characters: 60, products: 24, brandKits: 12 } as const;

/** A campaign is closed once it reaches one of these (campaign-types.ts). */
export const CLOSED_STAGES: readonly CampaignStage[] = ["failed", "cancelled", "expired"];
export const OPEN_STAGES: readonly CampaignStage[] = CAMPAIGN_STAGES.filter((s) => !CLOSED_STAGES.includes(s));

const CHARACTER_BUCKET = "character-references";

async function readCharacters(db: SupabaseClient, userId: string): Promise<PressCharacter[]> {
  try {
    const { data, error } = await db
      .from("character_profiles")
      .select("id, name, reference_image_urls")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(DOOR_LIMITS.characters);
    if (error || !Array.isArray(data)) return [];
    const rows = (data as Record<string, unknown>[]).filter((row) => typeof row.id === "string");
    const answers = await readStarAnswers(
      db,
      userId,
      rows.map((row) => row.id as string),
    );
    const out: PressCharacter[] = [];
    for (const row of rows) {
      const id = row.id as string;
      const photos = Array.isArray(row.reference_image_urls)
        ? row.reference_image_urls.filter((p): p is string => typeof p === "string" && p.length > 0)
        : [];
      out.push({
        id,
        name: typeof row.name === "string" ? row.name : "",
        // A tile only: what a campaign is given is the character's id, and
        // the server reads its photos itself.
        photoUrl: photos[0] ? thumbUrl(mediaUrl(CHARACTER_BUCKET, photos[0]), 320) : null,
        photoCount: photos.length,
        adAnswer: currentStarAnswer(photos, answers.get(id) ?? []),
      });
    }
    return out;
  } catch {
    return [];
  }
}

/**
 * The person's ad-use answers for these characters, newest first per
 * character. Their own rows only (read-own policy, and the owner named
 * here too). Before press-tour-03-campaigns.sql the table is not there:
 * no answers, and the Starring tile asks.
 */
async function readStarAnswers(db: SupabaseClient, userId: string, ids: readonly string[]): Promise<Map<string, Record<string, unknown>[]>> {
  const out = new Map<string, Record<string, unknown>[]>();
  if (ids.length === 0) return out;
  try {
    const { data, error } = await db
      .from(STAR_CONSENT_TABLE)
      .select("character_id, answer, ads_ok, photos_hash, consented_at")
      .eq("user_id", userId)
      .in("character_id", [...ids])
      .order("consented_at", { ascending: false })
      .limit(DOOR_LIMITS.characters * 4);
    if (error || !Array.isArray(data)) return out;
    for (const row of data as Record<string, unknown>[]) {
      if (typeof row.character_id !== "string") continue;
      const list = out.get(row.character_id) ?? [];
      list.push(row);
      out.set(row.character_id, list);
    }
  } catch {
    /* no answers read is the same as none given: the tile asks */
  }
  return out;
}

async function readProducts(db: SupabaseClient, userId: string): Promise<ProductCard[]> {
  try {
    const { data, error } = await db
      .from("products")
      .select(PRODUCT_CARD_COLUMNS)
      .eq("user_id", userId)
      .is("deleted_at", null)
      .in("status", ["draft", "confirmed"])
      .order("updated_at", { ascending: false })
      .limit(DOOR_LIMITS.products);
    if (error || !Array.isArray(data)) return [];
    return (data as unknown[]).map(productCardFromRow).filter((c): c is ProductCard => c !== null);
  } catch {
    return [];
  }
}

async function readBrandKits(db: SupabaseClient, userId: string): Promise<BrandKit[]> {
  try {
    const { data, error } = await db
      .from("brand_kits")
      .select(BRAND_KIT_COLUMNS)
      .eq("user_id", userId)
      .is("deleted_at", null)
      .in("status", ["draft", "confirmed"])
      .order("updated_at", { ascending: false })
      .limit(DOOR_LIMITS.brandKits);
    if (error || !Array.isArray(data)) return [];
    return (data as unknown[]).map(brandKitFromRow).filter((k): k is BrandKit => k !== null);
  } catch {
    return [];
  }
}

async function readOpenCampaignId(admin: SupabaseClient, userId: string): Promise<string | null> {
  try {
    const { data, error } = await admin
      .from("press_campaigns")
      .select("id")
      .eq("user_id", userId)
      .is("deleted_at", null)
      .in("stage", OPEN_STAGES as unknown as string[])
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    // Before press-tour-03-campaigns.sql the table is not there: no campaign.
    if (error || !data) return null;
    const id = (data as { id?: unknown }).id;
    return typeof id === "string" ? id : null;
  } catch {
    return null;
  }
}

type SignedPaths = {
  links: Record<string, string>;
  /**
   * Whether press-kit answered for the paths. When it did, a path it gave no
   * link for is not there (a Product Studio leftover names photos in another
   * bucket, 2026-08-27). When it could not be asked, nothing is known.
   */
  answered: boolean;
};

/** Short-lived display links for press-kit paths under the person's own folder; others are left out. */
async function signPressPaths(admin: SupabaseClient, userId: string, paths: readonly string[]): Promise<SignedPaths> {
  const own = [...new Set(paths)].filter((path) => pathOwned(userId, path));
  const links: Record<string, string> = {};
  if (own.length === 0) return { links, answered: true };
  try {
    const { data, error } = await admin.storage.from(PRESS_KIT_BUCKET).createSignedUrls(own, PHOTO_URL_SECONDS);
    if (error || !Array.isArray(data)) return { links, answered: false };
    for (const item of data) if (item?.path && item.signedUrl) links[item.path] = item.signedUrl;
    return { links, answered: true };
  } catch {
    /* no display links is not a failure of the door */
    return { links, answered: false };
  }
}

/** Everything the door opens on, in one pass. */
export async function getPressTourHome(clients: { db: SupabaseClient; admin: SupabaseClient }, userId: string): Promise<PressTourHome> {
  const { db, admin } = clients;
  const [characters, cards, kits, openCampaignId] = await Promise.all([
    readCharacters(db, userId),
    readProducts(db, userId),
    readBrandKits(db, userId),
    readOpenCampaignId(admin, userId),
  ]);

  const paths: string[] = [];
  for (const card of cards) {
    paths.push(...card.photos);
    if (card.logoPath) paths.push(card.logoPath);
  }
  for (const kit of kits) if (kit.logoPath) paths.push(kit.logoPath);
  const { links, answered } = await signPressPaths(admin, userId, paths);

  // A product photo counts, and shows, only when press-kit holds it: the
  // tile's count, its "finish its card" line and the card sheet all see the
  // same photos the server can read. When press-kit could not be asked, the
  // card's own photos stand (nothing is known to be missing).
  const held = (path: string) => (answered ? typeof links[path] === "string" : pathOwned(userId, path));
  const products: PressProduct[] = cards.map((stored) => {
    const card = cardWithHeldFiles(stored, held);
    const photoUrls: Record<string, string> = {};
    for (const path of [...card.photos, ...(card.logoPath ? [card.logoPath] : [])]) {
      if (links[path]) photoUrls[path] = links[path];
    }
    return { card, photoUrls };
  });
  const brandKits: PressBrandKit[] = kits.map((kit) => ({ kit, logoUrl: kit.logoPath ? (links[kit.logoPath] ?? null) : null }));

  return { characters, products, brandKits, openCampaignId };
}
