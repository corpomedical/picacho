// A free read of what people are searching for today, for the ad planner
// (operator's v1 scope 2026-09-25: "trend research + brand memory").
//
// THE SOURCE: Google Trends' public "Trending now" RSS feed. It needs no key
// and costs nothing. It is a list of searches (often news, sport and people),
// so the planner is told to use one only where it fits the product naturally
// and never to name a person, a brand or an event from it (planner.ts).
//
// THE SEAM: TrendsSource. A paid source (a social-platform trends API, a
// trends vendor) needs a key, and none is set up; one would be a second
// TrendsSource that reads its own key from the environment. Until then this
// feed is the only one.
//
// Behind the press_trends switch (press-tour-01-flags.sql, inserted OFF).
// Never throws: a feed that is down, slow or changed shape gives no trends,
// and the ad is planned without them.

export type TrendsSource = {
  name: string;
  read: (input: { geo: string; fetch: typeof fetch; timeoutMs: number }) => Promise<string[]>;
};

export const GOOGLE_TRENDS_RSS = "https://trends.google.com/trending/rss?geo=";
/** How many trends the planner sees. */
export const TRENDS_MAX = 8;
/** One read per region per this long, per server instance. */
export const TRENDS_CACHE_MS = 6 * 60 * 60 * 1000;
const TRENDS_TIMEOUT_MS = 3_000;
const TREND_MAX_CHARS = 60;

const ENTITIES: Record<string, string> = { "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&#39;": "'", "&apos;": "'" };

/** The items' titles from the RSS text: plain words only, short, de-duplicated. */
export function parseTrendsRss(xml: string, max: number = TRENDS_MAX): string[] {
  const out: string[] = [];
  const items = xml.match(/<item\b[\s\S]*?<\/item>/gi) ?? [];
  for (const item of items) {
    const raw = item.match(/<title>([\s\S]*?)<\/title>/i)?.[1] ?? "";
    const text = raw
      .replace(/^<!\[CDATA\[|\]\]>$/g, "")
      .replace(/&(amp|lt|gt|quot|apos|#39);/g, (e) => ENTITIES[e] ?? e)
      .replace(/<[^>]*>/g, " ")
      .replace(/[^\p{L}\p{N} '&.,:!?-]/gu, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, TREND_MAX_CHARS);
    if (text && !out.some((t) => t.toLowerCase() === text.toLowerCase())) out.push(text);
    if (out.length >= max) break;
  }
  return out;
}

export const googleTrends: TrendsSource = {
  name: "Google Trends (Trending now RSS)",
  read: async ({ geo, fetch: get, timeoutMs }) => {
    const res = await get(`${GOOGLE_TRENDS_RSS}${encodeURIComponent(geo)}`, { signal: AbortSignal.timeout(timeoutMs), headers: { accept: "application/rss+xml, text/xml" } });
    if (!res.ok) return [];
    const text = await res.text();
    return parseTrendsRss(text.slice(0, 500_000));
  },
};

const cache = new Map<string, { at: number; items: string[] }>();

/** Today's trends for a region, from the cache when it is fresh; [] on any failure. */
export async function readTrends(opts: { geo?: string; source?: TrendsSource; fetch?: typeof fetch; now?: () => number } = {}): Promise<string[]> {
  const geo = /^[A-Z]{2}$/.test(opts.geo ?? "") ? (opts.geo as string) : "US";
  const now = opts.now ? opts.now() : Date.now();
  const hit = cache.get(geo);
  if (hit && now - hit.at < TRENDS_CACHE_MS) return hit.items;
  try {
    const items = await (opts.source ?? googleTrends).read({ geo, fetch: opts.fetch ?? fetch, timeoutMs: TRENDS_TIMEOUT_MS });
    // An empty answer (the feed down or changed) is not kept: the next plan asks again.
    if (items.length > 0) cache.set(geo, { at: now, items });
    return items;
  } catch {
    return [];
  }
}

/** For tests: forget what was read. */
export function clearTrendsCache(): void {
  cache.clear();
}
