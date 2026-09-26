// What the press line (the publish sheet, design A's publish-desktop and
// publish-phone artboards) decides on its own, as pure rules: which
// networks get a column, what the person typed as hashtags, the time they
// picked, TikTok's audit rules before anything is asked of the server, and
// which file a download points at. Everything the post IS comes back from
// the engine's preview (publish-types.ts PostDraftView): the text that
// posts, its length, its blockers and the consent token. Nothing here
// prices, posts or decides for the person.
//
// Alias-free and import-free at runtime (vitest has no "@/"; the client
// bundle must not pull a server module): only types come in.

import type { ConnectionView, Network, PostView, TikTokChoices, TikTokSheetState } from "./publish-types";

/** The networks by their own names (letters only on the sheet: never their logos). */
export const NETWORK_NAMES: Readonly<Record<Network, string>> = { x: "X", tiktok: "TikTok", instagram: "Instagram", threads: "Threads" };
/** The small mark beside a network's name (design A's .pmark). */
export const NETWORK_MARKS: Readonly<Record<Network, string>> = { x: "X", tiktok: "Tk", instagram: "Ig", threads: "Th" };

/** The version recorded with every consent (publish-types.ts ConsentMeta.uiVersion). */
export const PRESS_LINE_VERSION = "press-line-1";

/** A network the sheet can write a post for now: an account is connected and can post. */
export function canCompose(c: Pick<ConnectionView, "status">): boolean {
  return c.status === "connected" || c.status === "test_mode";
}

/**
 * The sheet's columns: every network open to the person gets its own
 * (connected, in test, to connect, to reconnect); the ones not open yet
 * share one "Coming soon" column.
 */
export function sheetColumns<T extends Pick<ConnectionView, "status">>(conns: readonly T[]): { open: T[]; soon: T[] } {
  return { open: conns.filter((c) => c.status !== "coming_soon"), soon: conns.filter((c) => c.status === "coming_soon") };
}

/**
 * Hashtags as typed ("#coldbrew #oat_milk, morning"): without "#", in the
 * order typed, each once. Nothing is fixed or dropped for being odd: the
 * engine answers with the reason, so the person sees exactly what is wrong.
 */
export function parseHashtags(raw: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const part of raw.split(/[\s,]+/)) {
    const tag = part.replace(/^#+/, "").trim();
    if (!tag) continue;
    const key = tag.toLocaleLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(tag);
  }
  return out.slice(0, 60);
}

/** "Madrid" for Europe/Madrid, "New York" for America/New_York; null when the zone has no city. */
export function zoneCity(timeZone: string | null | undefined): string | null {
  if (!timeZone || !timeZone.includes("/")) return null;
  const city = timeZone.split("/").pop()?.replace(/_/g, " ").trim();
  return city || null;
}

const pad = (n: number) => String(n).padStart(2, "0");

/** A Date as an <input type="datetime-local"> value, in the viewer's own zone. */
export function toLocalInput(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** An <input type="datetime-local"> value (the viewer's zone) as an ISO time, or null when it isn't one. */
export function localInputToIso(value: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) return null;
  const d = new Date(value);
  return Number.isFinite(d.getTime()) ? d.toISOString() : null;
}

/** The time a schedule starts at: the next half hour at least 15 minutes away. */
export function defaultScheduleInput(now: Date): string {
  const d = new Date(now.getTime() + 15 * 60_000);
  d.setSeconds(0, 0);
  const m = d.getMinutes();
  if (m !== 0 && m !== 30) d.setMinutes(m < 30 ? 30 : 60);
  return toLocalInput(d);
}

/** TikTok's choices as the sheet holds them: the commercial switch above the two labels. */
export type TikTokUi = TikTokChoices & { commercial: boolean };

export const TIKTOK_UI_DEFAULT: Readonly<TikTokUi> = {
  privacy: null,
  allowComment: false,
  allowDuet: false,
  allowStitch: false,
  yourBrand: false,
  brandedContent: false,
  commercial: false,
};

/** What goes to the server: with the commercial switch off, neither label is sent. */
export function tiktokSent(ui: TikTokUi): TikTokChoices {
  return {
    privacy: ui.privacy,
    allowComment: ui.allowComment,
    allowDuet: ui.allowDuet,
    allowStitch: ui.allowStitch,
    yourBrand: ui.commercial && ui.yourBrand,
    brandedContent: ui.commercial && ui.brandedContent,
  };
}

/**
 * What stops TikTok's Post before the server is asked (the content-sharing
 * guidelines the audit checks): TikTok's own answer is not in yet, who can
 * see it isn't chosen (there is no default), or the choice isn't one TikTok
 * offers; commercial content on without saying which kind; branded content
 * set to "Only me".
 */
export type TikTokBlock = "sheet" | "privacy" | "commercialPick" | "brandedPrivate";

export function tiktokBlocks(ui: TikTokUi, sheet: Pick<TikTokSheetState, "privacyOptions" | "canPost"> | null): TikTokBlock[] {
  const out: TikTokBlock[] = [];
  if (!sheet || !sheet.canPost) out.push("sheet");
  if (!ui.privacy || (sheet && !sheet.privacyOptions.includes(ui.privacy))) out.push("privacy");
  if (ui.commercial && !ui.yourBrand && !ui.brandedContent) out.push("commercialPick");
  if (ui.commercial && ui.brandedContent && ui.privacy === "SELF_ONLY") out.push("brandedPrivate");
  return out;
}

/** The person's own profile, for "check before posting again" (an unconfirmed post). */
export function profileUrl(network: Network, handle: string | null): string | null {
  if (!handle || !/^[A-Za-z0-9._]{1,60}$/.test(handle)) return null;
  switch (network) {
    case "x":
      return `https://x.com/${handle}`;
    case "tiktok":
      return `https://www.tiktok.com/@${handle}`;
    case "instagram":
      return `https://www.instagram.com/${handle}/`;
    case "threads":
      return `https://www.threads.net/@${handle}`;
  }
}

/** Only a network's own https address opens from a post row. */
export function safePermalink(url: string | null): string | null {
  if (!url) return null;
  try {
    const u = new URL(url);
    return u.protocol === "https:" ? u.toString() : null;
  } catch {
    return null;
  }
}

/**
 * A link that saves the file instead of playing it: a signed storage link
 * takes a download name; anything else is returned as it is (the browser
 * opens it, and the person saves it from there).
 */
export function downloadUrl(url: string, name: string): string {
  try {
    const u = new URL(url);
    if (!u.pathname.includes("/storage/v1/object/sign/")) return url;
    u.searchParams.set("download", name);
    return u.toString();
  } catch {
    return url;
  }
}

/** A file name for the saved ad: the product's name in plain letters, and which file it is. */
export function adFileName(product: string | null, kind: "clean" | "tagged"): string {
  const base =
    (product ?? "")
      .normalize("NFKD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40) || "ad";
  return `${base}-press-tour${kind === "clean" ? "-tiktok" : ""}.mp4`;
}

/** The posts on the press line, newest first. */
export function postsNewestFirst(posts: readonly PostView[]): PostView[] {
  return [...posts].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}
