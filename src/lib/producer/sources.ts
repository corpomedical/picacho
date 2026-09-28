// Where a web-searched answer came from (2026-09-28, web search turned on).
// Anthropic's web search terms: "When displaying API outputs directly to end
// users, citations must be included to the original source" — so every
// answer that cites a search result shows its sources under it (the sheet's
// card and subtitles), never read aloud. Pure.

export type Source = { url: string; title: string };

/** The distinct web sources an answer's text cites, in the order first cited (at most `max`). */
export function citedSources(content: unknown, max = 5): Source[] {
  if (!Array.isArray(content)) return [];
  const seen = new Set<string>();
  const out: Source[] = [];
  for (const block of content) {
    if (!block || typeof block !== "object" || (block as { type?: unknown }).type !== "text") continue;
    const cites = (block as { citations?: unknown }).citations;
    if (!Array.isArray(cites)) continue;
    for (const c of cites) {
      if (!c || typeof c !== "object" || (c as { type?: unknown }).type !== "web_search_result_location") continue;
      const url = (c as { url?: unknown }).url;
      if (typeof url !== "string" || !/^https?:\/\//i.test(url) || seen.has(url)) continue;
      seen.add(url);
      const title = (c as { title?: unknown }).title;
      out.push({ url, title: typeof title === "string" && title.trim() ? title.trim().slice(0, 120) : hostOf(url) });
      if (out.length >= max) return out;
    }
  }
  return out;
}

/** The site's name for a link with no title: "www.bbc.com" → "bbc.com". */
export function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url.slice(0, 60);
  }
}

/** Sources as the sheet stores them (display.sources), checked. */
export function parseSources(value: unknown): Source[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((s): s is Source => !!s && typeof s.url === "string" && /^https?:\/\//i.test(s.url) && typeof s.title === "string")
    .slice(0, 5);
}
