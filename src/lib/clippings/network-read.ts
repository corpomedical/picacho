// Reading the person's OWN videos from the accounts they connected, with the
// keys they gave us (official docs, read 2026-10-02):
//
//   Instagram  GET /me/media (instagram_business_basic): id, type, caption,
//              timestamp, permalink, thumbnail_url, media_url, like_count,
//              comments_count. GET /{id}/insights?metric=views
//              (instagram_business_manage_insights; "plays" is gone since
//              2025-04-21). media_url is left out for a reel with licensed
//              music: its views stay, its words can't be read ("no_file").
//              Professional (Business or Creator) accounts only.
//   TikTok     POST /v2/video/list/ (video.list): the person's public videos
//              with view, like and comment counts, 20 a page. No file is
//              ever given, so TikTok is views only.
//
// Nobody else's account is ever read: every call names /me or the person's
// own token. Alias-free (vitest has no '@/').

import { NoAnswerError, call, num, obj, str, withQuery, type FetchLike } from "../social/http";
import { INSTAGRAM_GRAPH } from "../social/instagram";
import { metaError } from "../social/meta";
import { oneLine } from "./types";

export { INSTAGRAM_READ_SCOPE, TIKTOK_READ_SCOPE } from "./scopes";
export const TIKTOK_LIST_URL = "https://open.tiktokapis.com/v2/video/list/";

/** A video as a network describes it. */
export type NetworkVideo = {
  externalId: string;
  postedAt: string | null;
  permalink: string | null;
  thumbUrl: string | null;
  /** Where the file can be fetched from (Instagram only), or null. */
  mediaUrl: string | null;
  caption: string | null;
  durationS: number | null;
  views: number | null;
  likes: number | null;
  comments: number | null;
};

export type ReadOutcome = { ok: true; videos: NetworkVideo[] } | { ok: false; reason: "reconnect" | "unavailable" };

const IG_FIELDS = "id,media_type,media_product_type,caption,timestamp,permalink,thumbnail_url,media_url,like_count,comments_count";

function isoOrNull(v: unknown): string | null {
  const s = str(v, 64);
  if (!s) return null;
  const t = Date.parse(s);
  return Number.isFinite(t) ? new Date(t).toISOString() : null;
}

function httpsUrl(v: unknown, max = 2000): string | null {
  const s = str(v, max);
  if (!s) return null;
  try {
    return new URL(s).protocol === "https:" ? s : null;
  } catch {
    return null;
  }
}

function count(v: unknown): number | null {
  const n = num(v);
  return n !== null && n >= 0 ? Math.round(n) : null;
}

/** The views number in an insights answer: values[0].value or total_value.value. */
export function viewsFromInsights(body: unknown): number | null {
  const data = obj(body).data;
  if (!Array.isArray(data)) return null;
  const row = data.map(obj).find((r) => r.name === "views");
  if (!row) return null;
  const values = Array.isArray(row.values) ? row.values.map(obj) : [];
  return count(values[0]?.value) ?? count(obj(row.total_value).value);
}

/** The person's newest videos on Instagram (reels and feed videos), with their views. */
export async function readInstagram(fetchImpl: FetchLike, token: string, max: number): Promise<ReadOutcome> {
  const videos: NetworkVideo[] = [];
  let url: string | null = withQuery(`${INSTAGRAM_GRAPH}/me/media`, { fields: IG_FIELDS, limit: 25, access_token: token });
  let pages = 0;
  try {
    while (url && videos.length < max && pages < 6) {
      pages++;
      const res = await call(fetchImpl, url);
      if (!res.ok) {
        const kind = metaError(res.status, res.body).kind;
        if (kind === "reconnect") return { ok: false, reason: "reconnect" };
        if (videos.length > 0) break;
        return { ok: false, reason: "unavailable" };
      }
      const body = obj(res.body);
      for (const m of Array.isArray(body.data) ? body.data.map(obj) : []) {
        const type = String(m.media_type ?? "");
        const product = String(m.media_product_type ?? "");
        if (type !== "VIDEO" && product !== "REELS") continue;
        const id = str(m.id, 64);
        if (!id || !/^[0-9]+$/.test(id)) continue;
        videos.push({
          externalId: id,
          postedAt: isoOrNull(m.timestamp),
          permalink: httpsUrl(m.permalink, 500),
          thumbUrl: httpsUrl(m.thumbnail_url),
          mediaUrl: httpsUrl(m.media_url, 4000),
          caption: oneLine(m.caption, 2200),
          durationS: null,
          views: null,
          likes: count(m.like_count),
          comments: count(m.comments_count),
        });
        if (videos.length >= max) break;
      }
      // Follow Instagram's own next page only (it carries the key; never another host).
      const next = httpsUrl(obj(body.paging).next, 4000);
      url = next && new URL(next).host === new URL(INSTAGRAM_GRAPH).host ? next : null;
    }
  } catch (err) {
    if (err instanceof NoAnswerError && videos.length > 0) return { ok: true, videos };
    return { ok: false, reason: "unavailable" };
  }

  // Views, four at a time. A video whose views can't be read keeps null (it
  // stays off the chart, never guessed).
  for (let i = 0; i < videos.length; i += 4) {
    await Promise.all(
      videos.slice(i, i + 4).map(async (v) => {
        try {
          const res = await call(fetchImpl, withQuery(`${INSTAGRAM_GRAPH}/${v.externalId}/insights`, { metric: "views", access_token: token }));
          if (res.ok) v.views = viewsFromInsights(res.body);
        } catch {
          // left as null
        }
      }),
    );
  }
  return { ok: true, videos };
}

/** The person's newest public TikTok videos with their counts (no file: views only). */
export async function readTikTok(fetchImpl: FetchLike, token: string, max: number): Promise<ReadOutcome> {
  const videos: NetworkVideo[] = [];
  let cursor: number | null = null;
  let pages = 0;
  try {
    while (videos.length < max && pages < 4) {
      pages++;
      const res = await call(
        fetchImpl,
        withQuery(TIKTOK_LIST_URL, {
          fields: "id,create_time,cover_image_url,share_url,video_description,title,duration,view_count,like_count,comment_count",
        }),
        {
          method: "POST",
          headers: { authorization: `Bearer ${token}`, "content-type": "application/json; charset=UTF-8" },
          body: JSON.stringify(cursor === null ? { max_count: 20 } : { max_count: 20, cursor }),
        },
      );
      const body = obj(res.body);
      const errCode = String(obj(body.error).code ?? "");
      if (!res.ok || (errCode && errCode !== "ok")) {
        if (res.status === 401 || errCode === "access_token_invalid" || errCode === "scope_not_authorized") return { ok: false, reason: "reconnect" };
        if (videos.length > 0) break;
        return { ok: false, reason: "unavailable" };
      }
      const data = obj(body.data);
      for (const v of Array.isArray(data.videos) ? data.videos.map(obj) : []) {
        const id = str(v.id, 64);
        if (!id || !/^[0-9]+$/.test(id)) continue;
        const created = num(v.create_time);
        videos.push({
          externalId: id,
          postedAt: created !== null && created > 0 ? new Date(created * 1000).toISOString() : null,
          permalink: httpsUrl(v.share_url, 500),
          thumbUrl: httpsUrl(v.cover_image_url),
          mediaUrl: null,
          caption: oneLine(v.video_description ?? v.title, 2200),
          durationS: count(v.duration),
          views: count(v.view_count),
          likes: count(v.like_count),
          comments: count(v.comment_count),
        });
        if (videos.length >= max) break;
      }
      if (data.has_more !== true) break;
      const next = num(data.cursor);
      if (next === null || next === cursor) break;
      cursor = next;
    }
  } catch {
    if (videos.length > 0) return { ok: true, videos };
    return { ok: false, reason: "unavailable" };
  }
  return { ok: true, videos };
}
