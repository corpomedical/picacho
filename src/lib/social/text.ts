// The words of a post: how the caption and hashtags become the exact text
// that publishes, each network's limits, and the one v1 rule about links.
//
// Picacho never edits the person's words or adds hashtags (spec §2.2). The
// one line it adds is Threads' visible "Made with AI" (Threads has no label
// field; constraints §5), and the sheet shows it before consent.
//
// Alias-free (vitest has no '@/').

import { THREADS_AI_TAG, HASHTAG_INVALID, TEXT_TOO_LONG, TOO_MANY_HASHTAGS, X_NO_LINKS } from "./messages";
import type { Network } from "../press-tour/publish-types";

/** The longest caption the sheet accepts on any network (Instagram and TikTok allow 2,200). */
export const CAPTION_MAX = 2200;

/** Each network's text limit, counted its own way (textLength). */
export const TEXT_LIMIT: Readonly<Record<Network, number>> = {
  x: 280,
  tiktok: 2200,
  instagram: 2200,
  threads: 500,
};

/** Hashtags per post. Instagram's 30 is its own rule; Threads makes one topic tag of a post. */
export const HASHTAG_LIMIT: Readonly<Record<Network, number>> = {
  x: 10,
  tiktok: 30,
  instagram: 30,
  threads: 1,
};

const HASHTAG_RE = /^[\p{L}\p{N}_]{1,50}$/u;

/** Tidy the person's caption without changing its words: line endings, trailing spaces, outer blank lines. */
export function tidyCaption(raw: unknown): string {
  if (typeof raw !== "string") return "";
  return raw
    .replace(/\r\n?/g, "\n")
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "")
    .split("\n")
    .map((line) => line.replace(/[ \t]+$/g, ""))
    .join("\n")
    .replace(/^\n+|\n+$/g, "");
}

/** The hashtags as the person typed them, "#" dropped, repeats (any case) dropped. An invalid one is an error, never silently fixed. */
export function tidyHashtags(raw: unknown): { ok: true; tags: string[] } | { ok: false; error: string } {
  if (!Array.isArray(raw)) return { ok: true, tags: [] };
  const out: string[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    if (typeof item !== "string") return { ok: false, error: HASHTAG_INVALID };
    const tag = item.trim().replace(/^#+/, "");
    if (tag === "") continue;
    if (!HASHTAG_RE.test(tag)) return { ok: false, error: HASHTAG_INVALID };
    const key = tag.toLocaleLowerCase("en");
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(tag);
  }
  return { ok: true, tags: out };
}

/** The line Picacho adds on this network, or null. */
export function captionTag(network: Network): string | null {
  return network === "threads" ? THREADS_AI_TAG : null;
}

/** The exact text that posts: the caption, a blank line, the hashtags, and on Threads a blank line and "Made with AI". */
export function composeText(network: Network, caption: string, hashtags: readonly string[]): string {
  const parts: string[] = [];
  if (caption) parts.push(caption);
  if (hashtags.length > 0) parts.push(hashtags.map((t) => `#${t}`).join(" "));
  const tag = captionTag(network);
  if (tag) parts.push(tag);
  return parts.join("\n\n");
}

// X counts most scripts' characters as 2 and Latin-range ones as 1 (the
// twitter-text weighting: 280 means 28,000 units at 100 per light
// character). An emoji sequence is over-counted here (each code point
// weighs 200), which can only refuse a post near the limit, never let one
// through that X would refuse.
const X_LIGHT_RANGES: [number, number][] = [
  [0, 4351],
  [8192, 8205],
  [8208, 8223],
  [8242, 8247],
];

function xWeight(cp: number): number {
  return X_LIGHT_RANGES.some(([a, b]) => cp >= a && cp <= b) ? 100 : 200;
}

/** The text's length the network's way. */
export function textLength(network: Network, text: string): number {
  if (network === "x") {
    let units = 0;
    for (const ch of text.normalize("NFC")) units += xWeight(ch.codePointAt(0) ?? 0);
    return Math.ceil(units / 100);
  }
  // TikTok counts UTF-16 units; Instagram and Threads count characters.
  if (network === "tiktok") return text.length;
  return Array.from(text).length;
}

// A link, by the X price rule: any URL in the text raises the post from
// $0.015 to $0.200, bare domains included by X staff's reading. v1 posts no
// links to X (v2 #23): "link in bio".
const TLDS =
  "com|net|org|io|ai|co|app|shop|store|online|site|xyz|dev|link|info|biz|me|tv|ly|gg|to|eu|es|pt|it|uk|de|fr|nl|be|ch|at|us|ca|au|br|mx|ar|cl|pe|in|jp|cn|ru|pl|se|no|dk|fi|ie|gr|tr|za|nz|sg|hk|kr|id|my|ph|vn|th|ae|sa|ng|ke|club|live|world|top|blog|news|page|website|space|tech|studio|agency|design|media|art|fun|beauty|fashion|health|life|one|pro|vip|win|bio|cc|ws|fm|am|so|sh|gl|im|is|la|li|lt|lv|ee|sk|cz|hu|ro|bg|hr|si|rs|ua|by|kz";
const SCHEME_RE = /(?:[a-z][a-z0-9+.-]*:\/\/|\bwww\.)\S/i;
const DOMAIN_RE = new RegExp(
  `(?:^|[^\\p{L}\\p{N}@._/-])(?:[\\p{L}\\p{N}](?:[\\p{L}\\p{N}-]{0,61}[\\p{L}\\p{N}])?\\.)+(?:${TLDS})(?=$|[^\\p{L}\\p{N}_-])`,
  "iu",
);

/** True when the text holds a web address, with or without "https://". */
export function hasLink(text: string): boolean {
  return SCHEME_RE.test(text) || DOMAIN_RE.test(text);
}

/** The words' problems on one network, in the order the sheet shows them. Empty = fine. */
export function textProblems(network: Network, caption: string, hashtags: readonly string[]): string[] {
  const out: string[] = [];
  if (caption.length > CAPTION_MAX) out.push(TEXT_TOO_LONG);
  if (hashtags.length > HASHTAG_LIMIT[network]) out.push(TOO_MANY_HASHTAGS);
  const text = composeText(network, caption, hashtags);
  if (textLength(network, text) > TEXT_LIMIT[network] && !out.includes(TEXT_TOO_LONG)) out.push(TEXT_TOO_LONG);
  if (network === "x" && hasLink(text)) out.push(X_NO_LINKS);
  return out;
}
