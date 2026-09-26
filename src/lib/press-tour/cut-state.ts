// What press_campaigns.assembly and .renditions hold (Cut 4): the cut's
// working state and the finished files. Pure, alias-free and a leaf, so the
// machine's view and the cut's steps read one shape.
//
//   assembly    the tag's language (the account's language at the Film
//               press), whether captions are burned in, each segment made
//               (per kept take: a clean and a tagged file in press-kit), the
//               end card, and the failures that park the cut for the team
//   renditions  clean (no tag, no end card: TikTok) and tagged (the small
//               AI-generated tag, and the brand's end card when there is
//               one): where each is in press-kit, its sha256, length and
//               size, and whether it is SIGNED (only ever true when the
//               manifest was read back from that very file: sign.ts) or why
//               not (Admin only)

import { AI_TAG_TEXT, type TagLocale } from "./film-messages";

export const RENDITION_KINDS = ["clean", "tagged"] as const;
export type RenditionKind = (typeof RENDITION_KINDS)[number];

/** Failed cut steps in a row before the cut is parked for the team (spec §1.12: "Assembly fails 3 ticks in a row"). */
export const MAX_CUT_FAILURES = 3;

export type Segment = { shot: number; take: number; rowId: string; clean: string; tagged: string; seconds: number };

export type AssemblyState = {
  locale: TagLocale;
  captions: boolean;
  segments: Segment[];
  /** press-kit path of the encoded end card, or null (no brand logo). */
  endCard: string | null;
  endCardDone: boolean;
  failures: number;
  /** The cut failed MAX_CUT_FAILURES times: parked until "Make the cut" again, the team told. */
  parked: boolean;
  /** The last failure, for Admin (English, never shown raw). */
  lastError: string | null;
  /** The segment files were removed after delivery. */
  cleaned: boolean;
};

export type RenditionRecord = {
  kind: RenditionKind;
  path: string;
  sha256: string;
  seconds: number;
  bytes: number;
  signed: boolean;
  signedAt: string | null;
  /** Why unsigned (Admin only), or null. */
  reason: string | null;
  /** The signing step has run on this file (signed or not). */
  settled: boolean;
};

export type Renditions = Partial<Record<RenditionKind, RenditionRecord>>;

const isLocale = (v: unknown): v is TagLocale => typeof v === "string" && Object.prototype.hasOwnProperty.call(AI_TAG_TEXT, v);
const str = (v: unknown, max: number): string | null => (typeof v === "string" && v.length > 0 ? v.slice(0, max) : null);
const num = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : 0);

/** The tag's language from a locale code; English for anything else. */
export function tagLocale(raw: unknown): TagLocale {
  return isLocale(raw) ? raw : "en";
}

export function initialAssembly(input: { locale: unknown; captions?: boolean }): AssemblyState {
  return {
    locale: tagLocale(input.locale),
    captions: input.captions !== false,
    segments: [],
    endCard: null,
    endCardDone: false,
    failures: 0,
    parked: false,
    lastError: null,
    cleaned: false,
  };
}

export function parseAssembly(raw: unknown): AssemblyState {
  const r = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const segments: Segment[] = [];
  for (const s of Array.isArray(r.segments) ? r.segments : []) {
    if (!s || typeof s !== "object") continue;
    const x = s as Record<string, unknown>;
    const clean = str(x.clean, 512);
    const tagged = str(x.tagged, 512);
    const rowId = str(x.rowId, 64);
    if (!clean || !tagged || !rowId || typeof x.shot !== "number" || typeof x.take !== "number") continue;
    segments.push({ shot: x.shot, take: x.take, rowId, clean, tagged, seconds: num(x.seconds) });
  }
  return {
    locale: tagLocale(r.locale),
    captions: r.captions !== false,
    segments: segments.slice(0, 12),
    endCard: str(r.endCard, 512),
    endCardDone: r.endCardDone === true,
    failures: Math.min(99, Math.floor(num(r.failures))),
    parked: r.parked === true,
    lastError: str(r.lastError, 400),
    cleaned: r.cleaned === true,
  };
}

function renditionFrom(kind: RenditionKind, raw: unknown): RenditionRecord | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  const path = str(r.path, 512);
  const sha256 = typeof r.sha256 === "string" && /^[0-9a-f]{64}$/.test(r.sha256) ? r.sha256 : null;
  if (!path || !sha256) return null;
  return {
    kind,
    path,
    sha256,
    seconds: num(r.seconds),
    bytes: Math.floor(num(r.bytes)),
    // Signed only when the signing step said so AND recorded when.
    signed: r.signed === true && typeof r.signedAt === "string",
    signedAt: str(r.signedAt, 40),
    reason: str(r.reason, 300),
    settled: r.settled === true,
  };
}

export function parseRenditions(raw: unknown): Renditions {
  const r = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const out: Renditions = {};
  for (const kind of RENDITION_KINDS) {
    const rec = renditionFrom(kind, r[kind]);
    if (rec) out[kind] = rec;
  }
  return out;
}

/** Both renditions are there. */
export function renditionsComplete(r: Renditions): r is Record<RenditionKind, RenditionRecord> {
  return RENDITION_KINDS.every((k) => r[k] !== undefined);
}

/**
 * Where the person is taken from a push about this ad: the door, opened on
 * it. ?campaign=<id> is the one address the page reads (app/app/press-tour/
 * page.tsx fromAddress; the MCP card's doorUrl links the same), pinned by
 * rollout.test.ts.
 */
export function adPath(campaignId: string): string {
  return `/app/press-tour?campaign=${campaignId}`;
}

/** Where a cut's files live in press-kit: under the owner's own folder. */
export function cutFolder(userId: string, campaignId: string): string {
  return `${userId}/cuts/${campaignId}`;
}

export function segmentPath(userId: string, campaignId: string, rowId: string, variant: "clean" | "tagged"): string {
  return `${cutFolder(userId, campaignId)}/seg-${rowId}-${variant}.mp4`;
}

export function endCardPath(userId: string, campaignId: string): string {
  return `${cutFolder(userId, campaignId)}/end-card.mp4`;
}

/** A rendition is named after its bytes: a new file is a new path (never rewritten in place). */
export function renditionPath(userId: string, campaignId: string, kind: RenditionKind, sha256: string, signed = false): string {
  return `${cutFolder(userId, campaignId)}/${kind}-${sha256.slice(0, 16)}${signed ? "-c2pa" : ""}.mp4`;
}
