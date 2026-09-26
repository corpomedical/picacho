import { createHash } from "node:crypto";

// The consent record (spec §2.2 as changed by v2 #14): the person's tap on
// Post or Schedule is consent to ONE canonical object, and its sha256 is
// stored on the row (scheduled_posts.payload_sha256). The object covers
// everything that decides what the world sees:
//   the file (its sha256), the words (caption, hashtags and the exact final
//   text), the network, the account (its external id, not a handle that can
//   be renamed), the privacy choice, the interaction toggles, the AI label,
//   the commercial flags, and the time (null = "now").
// The worker rebuilds the object from the row before sending and refuses
// when its hash differs; the adapters build every request only from it.
//
// X: "a person authenticating into your service does not by itself
// constitute consent"; Meta: "Obtain consent from people before publishing
// content"; TikTok: express consent before any bytes are sent.
//
// Alias-free (vitest has no '@/').

import type { Network, RenditionKind, TikTokChoices, TikTokPrivacy, XChoices } from "../press-tour/publish-types";
import { composeText } from "./text";

export const CONSENT_VERSION = 1;

export interface ConsentObject {
  v: typeof CONSENT_VERSION;
  network: Network;
  /** The account's external id at the network. */
  account: string;
  rendition: RenditionKind;
  rendition_sha256: string;
  caption: string;
  hashtags: string[];
  /** The exact text that posts (composeText). */
  text: string;
  /** Always true: forced on, never a choice. */
  ai_label: true;
  /** TikTok's privacy choice; null elsewhere. */
  privacy: TikTokPrivacy | null;
  /** TikTok's interaction toggles (true = allowed); null elsewhere. */
  interactions: { comment: boolean; duet: boolean; stitch: boolean } | null;
  commercial: { your_brand: boolean; branded_content: boolean; paid_partnership: boolean };
  /** ISO minute for a scheduled post; null for "now". */
  scheduled_for: string | null;
}

/** The network's own choices as the row stores them (scheduled_posts.options). */
export type PostOptions = {
  when: "now" | "scheduled";
  privacy?: TikTokPrivacy | null;
  allow_comment?: boolean;
  allow_duet?: boolean;
  allow_stitch?: boolean;
  your_brand?: boolean;
  branded_content?: boolean;
  paid_partnership?: boolean;
};

/** The consent object for one draft. `scheduledFor` null = "now". */
export function buildConsent(input: {
  network: Network;
  accountExternalId: string;
  rendition: RenditionKind;
  renditionSha256: string;
  caption: string;
  hashtags: readonly string[];
  tiktok: TikTokChoices | null | undefined;
  x: XChoices | null | undefined;
  scheduledFor: string | null;
}): ConsentObject {
  const tiktok = input.network === "tiktok" ? input.tiktok ?? null : null;
  const x = input.network === "x" ? input.x ?? null : null;
  return {
    v: CONSENT_VERSION,
    network: input.network,
    account: input.accountExternalId,
    rendition: input.rendition,
    rendition_sha256: input.renditionSha256.toLowerCase(),
    caption: input.caption,
    hashtags: [...input.hashtags],
    text: composeText(input.network, input.caption, input.hashtags),
    ai_label: true,
    privacy: tiktok ? tiktok.privacy : null,
    interactions: tiktok ? { comment: tiktok.allowComment === true, duet: tiktok.allowDuet === true, stitch: tiktok.allowStitch === true } : null,
    commercial: {
      your_brand: tiktok?.yourBrand === true,
      branded_content: tiktok?.brandedContent === true,
      paid_partnership: x?.paidPartnership === true,
    },
    scheduled_for: input.scheduledFor,
  };
}

/** The row's options for a consent object. */
export function optionsFor(consent: ConsentObject): PostOptions {
  const out: PostOptions = { when: consent.scheduled_for === null ? "now" : "scheduled" };
  if (consent.network === "tiktok") {
    out.privacy = consent.privacy;
    out.allow_comment = consent.interactions?.comment === true;
    out.allow_duet = consent.interactions?.duet === true;
    out.allow_stitch = consent.interactions?.stitch === true;
    out.your_brand = consent.commercial.your_brand;
    out.branded_content = consent.commercial.branded_content;
  }
  if (consent.network === "x") out.paid_partnership = consent.commercial.paid_partnership;
  return out;
}

/** The consent object rebuilt from a stored row (the worker's side of the check). */
export function consentFromRow(row: {
  network: Network;
  accountExternalId: string;
  rendition: RenditionKind;
  renditionSha256: string;
  caption: string;
  hashtags: readonly string[];
  options: PostOptions;
  scheduledFor: string | null;
}): ConsentObject {
  const o = row.options ?? ({ when: "now" } as PostOptions);
  const tiktok: TikTokChoices | null =
    row.network === "tiktok"
      ? {
          privacy: o.privacy ?? null,
          allowComment: o.allow_comment === true,
          allowDuet: o.allow_duet === true,
          allowStitch: o.allow_stitch === true,
          yourBrand: o.your_brand === true,
          brandedContent: o.branded_content === true,
        }
      : null;
  const x: XChoices | null = row.network === "x" ? { paidPartnership: o.paid_partnership === true } : null;
  return buildConsent({
    network: row.network,
    accountExternalId: row.accountExternalId,
    rendition: row.rendition,
    renditionSha256: row.renditionSha256,
    caption: row.caption,
    hashtags: row.hashtags,
    tiktok,
    x,
    scheduledFor: o.when === "now" ? null : minuteIso(row.scheduledFor),
  });
}

/** An ISO time cut to the minute (the sheet picks minutes), or null. */
export function minuteIso(value: string | Date | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  const t = value instanceof Date ? value.getTime() : Date.parse(value);
  if (!Number.isFinite(t)) return null;
  return new Date(Math.floor(t / 60_000) * 60_000).toISOString();
}

/** JSON with every object's keys sorted, no spaces: one text for one object, whatever order it was built in. */
export function canonicalJson(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return `[${value.map((v) => canonicalJson(v)).join(",")}]`;
  switch (typeof value) {
    case "string":
      return JSON.stringify(value);
    case "number":
      if (!Number.isFinite(value)) throw new Error("canonicalJson: a number that isn't finite");
      return JSON.stringify(value);
    case "boolean":
      return value ? "true" : "false";
    case "object": {
      const o = value as Record<string, unknown>;
      const keys = Object.keys(o).filter((k) => o[k] !== undefined).sort();
      return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson(o[k])}`).join(",")}}`;
    }
    default:
      throw new Error(`canonicalJson: ${typeof value} can't be consented to`);
  }
}

/** The consent hash (sha256, lowercase hex). */
export function consentHash(consent: ConsentObject): string {
  return createHash("sha256").update(canonicalJson(consent), "utf8").digest("hex");
}

/** The record stored beside the hash (scheduled_posts.consent). */
export type ConsentRecord = {
  payload_sha256: string;
  network: Network;
  handle: string | null;
  ui_version: string;
  locale: string;
  ip_hash: string | null;
  consented_at: string;
};
