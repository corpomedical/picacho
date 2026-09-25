// Press Tour: the two small plain-text files a site serves beside its pages
// that an import reads — robots.txt (spec §1.1: read once per host per 24 h)
// and one stylesheet for a brand kit's colours and fonts (spec §1.2: at
// most 200 KB).
//
// safeFetch only speaks HTML, JSON and images, so these two go through the
// SAME vetted parts it is built from (safe-fetch.ts): vetUrl (https, port
// 443, no credentials, no IP literals or internal names — http upgraded),
// resolvePinned (every DNS answer public, the socket pinned to the checked
// address) and httpsTransport (fresh socket, certificate checked against the
// name). Redirects are followed by hand, at most 3, and every hop is vetted
// and pinned again. No cookies, no Authorization, no Referer, ever. Decoded
// bytes are capped; a compressed body is inflated under the cap.
//
// ROBOTS (RFC 9309). The group for our product token "PicachoBot" wins over
// "*"; the longest matching rule wins; Allow wins a tie; "*" and "$" work.
// A 4xx answer means no rules (import allowed). A 5xx, a network failure or
// a timeout means "unreachable", which the RFC says to treat as complete
// disallow — the card then says "We couldn't read that page. Add photos
// instead." Readable answers are kept 24 h per host, unreachable ones 1 h,
// in this server instance (at most 500 hosts).
//
// Server-only (node:zlib, via safe-fetch node:https). Relative imports only.

import zlib from "node:zlib";
import {
  SAFE_FETCH_USER_AGENT,
  SafeFetchError,
  decodeText,
  httpsTransport,
  resolvePinned,
  systemResolver,
  vetUrl,
  type Resolver,
  type Transport,
  type TransportResponse,
} from "./safe-fetch";

export const ROBOTS_AGENT = "picachobot";
/** RFC 9309 asks crawlers to parse at least 500 KiB. */
export const ROBOTS_MAX_BYTES = 512 * 1024;
export const CSS_MAX_BYTES = 200 * 1024;
export const SITE_TEXT_TIMEOUT_MS = 5_000;
export const ROBOTS_TTL_MS = 24 * 60 * 60 * 1000;
export const ROBOTS_UNREACHABLE_TTL_MS = 60 * 60 * 1000;
const MAX_REDIRECTS = 3;
const MAX_CACHED_HOSTS = 500;
const MAX_RULES = 2_000;

export type SiteTextKind = "robots" | "css";

export interface SiteTextDeps {
  resolve?: Resolver;
  transport?: Transport;
  timeoutMs?: number;
}

export type SiteTextResult =
  | { ok: true; status: number; text: string; url: string }
  /** A final status outside 2xx (after redirects). */
  | { ok: false; status: number; unreachable: false }
  /** No answer at all: DNS, a blocked address, a refused connection, TLS, a timeout, a redirect loop. */
  | { ok: false; status: 0; unreachable: true; code: string };

function headerValue(headers: TransportResponse["headers"], name: string): string | null {
  for (const key of Object.keys(headers)) {
    if (key.toLowerCase() !== name) continue;
    const value = headers[key];
    if (Array.isArray(value)) return value.length > 0 ? String(value[0]) : null;
    return value === undefined ? null : String(value);
  }
  return null;
}

async function readCapped(response: TransportResponse, cap: number, signal: AbortSignal): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let total = 0;
  try {
    for await (const value of response.body) {
      if (signal.aborted) throw new SafeFetchError("timeout", "the fetch took too long");
      const chunk = typeof value === "string" ? Buffer.from(value, "utf8") : Buffer.from(value.buffer, value.byteOffset, value.byteLength);
      const room = cap - total;
      if (chunk.length >= room) {
        // A longer file is read up to the cap, not refused: robots rules
        // and colour tokens past the cap are simply not read.
        chunks.push(chunk.subarray(0, room));
        total = cap;
        break;
      }
      chunks.push(chunk);
      total += chunk.length;
    }
  } finally {
    response.destroy();
  }
  return Buffer.concat(chunks, total);
}

function inflate(encoding: string, raw: Buffer, cap: number): Buffer | null {
  const options = { maxOutputLength: cap };
  try {
    if (encoding === "gzip" || encoding === "x-gzip") return zlib.gunzipSync(raw, options);
    if (encoding === "br") return zlib.brotliDecompressSync(raw, options);
    if (encoding === "deflate") {
      try {
        return zlib.inflateSync(raw, options);
      } catch {
        return zlib.inflateRawSync(raw, options);
      }
    }
  } catch {
    return null;
  }
  return null;
}

/**
 * Fetches robots.txt or a stylesheet under the safe-fetch rules. Never
 * throws: a refused URL, DNS, address or connection is `unreachable`.
 */
export async function fetchSiteText(input: string, kind: SiteTextKind, deps: SiteTextDeps = {}): Promise<SiteTextResult> {
  const cap = kind === "robots" ? ROBOTS_MAX_BYTES : CSS_MAX_BYTES;
  const resolve = deps.resolve ?? systemResolver;
  const transport = deps.transport ?? httpsTransport;
  const timeoutMs = Math.min(SITE_TEXT_TIMEOUT_MS, Math.max(1, Math.floor(deps.timeoutMs ?? SITE_TEXT_TIMEOUT_MS)));
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new SafeFetchError("timeout", "the fetch took too long")), timeoutMs);
  const headers = {
    "user-agent": SAFE_FETCH_USER_AGENT,
    accept: kind === "robots" ? "text/plain" : "text/css",
    "accept-encoding": "gzip, deflate, br",
  };
  try {
    let url = vetUrl(input);
    for (let hop = 0; ; hop++) {
      const pin = await resolvePinned(url.hostname, resolve);
      if (controller.signal.aborted) throw new SafeFetchError("timeout", "the fetch took too long");
      const response = await transport({
        url,
        address: pin.address,
        family: pin.family,
        port: 443,
        headers: { ...headers },
        signal: controller.signal,
        connectTimeoutMs: Math.min(3_000, timeoutMs),
      });
      const status = response.status;
      if ([301, 302, 303, 307, 308].includes(status)) {
        response.destroy();
        const location = headerValue(response.headers, "location");
        if (hop >= MAX_REDIRECTS || !location) throw new SafeFetchError("too_many_redirects", "redirects");
        url = vetUrl(new URL(location, url).href);
        continue;
      }
      if (status < 200 || status > 299) {
        response.destroy();
        return { ok: false, status, unreachable: false };
      }
      const type = (headerValue(response.headers, "content-type") ?? "").split(";")[0].trim().toLowerCase();
      if (kind === "css" && type !== "" && type !== "text/css" && type !== "text/plain") {
        response.destroy();
        return { ok: false, status: 415, unreachable: false };
      }
      const encoding = (headerValue(response.headers, "content-encoding") ?? "").trim().toLowerCase();
      const raw = await readCapped(response, cap, controller.signal);
      let body: Buffer | null = raw;
      if (encoding && encoding !== "identity") {
        // A cut compressed stream cannot be inflated; the cap applies to the
        // wire bytes here and to the decoded bytes below.
        body = inflate(encoding, raw, cap);
        if (!body) return { ok: false, status: 0, unreachable: true, code: "bad_encoding" };
      }
      return { ok: true, status, text: decodeText(body, headerValue(response.headers, "content-type")), url: url.href };
    }
  } catch (err) {
    const code = err instanceof SafeFetchError ? err.code : controller.signal.aborted ? "timeout" : "connect_failed";
    return { ok: false, status: 0, unreachable: true, code };
  } finally {
    clearTimeout(timer);
  }
}

// ---------------------------------------------------------------------------
// robots.txt
// ---------------------------------------------------------------------------

export type RobotsRule = { allow: boolean; path: string };
/** null = no rules for us (everything allowed); [] = a group with no rules (everything allowed). */
export type RobotsRules = RobotsRule[] | null;

/**
 * Pure: the rules that apply to `agent` (lowercase product token). The
 * groups naming it are merged; with none, the "*" groups are; with neither,
 * null. User-agent lines that follow each other open one group.
 */
export function parseRobots(text: string, agent: string = ROBOTS_AGENT): RobotsRules {
  const mine: RobotsRule[] = [];
  const star: RobotsRule[] = [];
  let sawMine = false;
  let sawStar = false;
  let agents: string[] = [];
  let inRules = false;
  let rules = 0;
  for (const rawLine of text.slice(0, ROBOTS_MAX_BYTES).split(/\r\n|\r|\n/)) {
    const line = rawLine.replace(/#.*$/, "").trim();
    const colon = line.indexOf(":");
    if (colon < 0) continue;
    const key = line.slice(0, colon).trim().toLowerCase();
    const value = line.slice(colon + 1).trim();
    if (key === "user-agent") {
      if (inRules) {
        agents = [];
        inRules = false;
      }
      const token = value.toLowerCase().split("/")[0].trim();
      agents.push(token);
      if (token === agent) sawMine = true;
      if (token === "*") sawStar = true;
      continue;
    }
    if (key !== "allow" && key !== "disallow") continue;
    inRules = true;
    if (++rules > MAX_RULES) break;
    // "Disallow:" with no path allows everything: it is no rule at all.
    if (value === "") continue;
    const rule = { allow: key === "allow", path: value };
    if (agents.includes(agent)) mine.push(rule);
    else if (agents.includes("*")) star.push(rule);
  }
  if (sawMine) return mine;
  if (sawStar) return star;
  return null;
}

function percentNormalise(path: string): string {
  // Compare with the same escaping on both sides.
  return path.replace(/%[0-9a-f]{2}/gi, (m) => m.toUpperCase());
}

/** Does a robots path pattern match this path (with query)? "*" is any run, a final "$" anchors the end. */
function matches(pattern: string, path: string): boolean {
  const anchored = pattern.endsWith("$");
  const body = percentNormalise(anchored ? pattern.slice(0, -1) : pattern);
  const target = percentNormalise(path);
  const pieces = body.split("*");
  if (pieces.length === 1) return anchored ? target === body : target.startsWith(body);
  const first = pieces[0];
  const last = pieces[pieces.length - 1];
  if (!target.startsWith(first)) return false;
  let end = target.length;
  if (anchored) {
    // The last piece must sit at the very end; the others fit before it.
    if (!target.endsWith(last) || target.length - last.length < first.length) return false;
    end = target.length - last.length;
  }
  let at = first.length;
  for (const piece of anchored ? pieces.slice(1, -1) : pieces.slice(1)) {
    const found = target.indexOf(piece, at);
    if (found < 0 || found + piece.length > end) return false;
    at = found + piece.length;
  }
  return true;
}

/** Pure: is this path (with its query) allowed under these rules? Longest match wins; Allow wins a tie. */
export function robotsAllowsPath(rules: RobotsRules, pathWithQuery: string): boolean {
  if (!rules || rules.length === 0) return true;
  const path = pathWithQuery || "/";
  if (path === "/robots.txt") return true;
  let best: RobotsRule | null = null;
  for (const rule of rules) {
    if (!matches(rule.path, path)) continue;
    if (!best || rule.path.length > best.path.length || (rule.path.length === best.path.length && rule.allow && !best.allow)) {
      best = rule;
    }
  }
  return best ? best.allow : true;
}

type CacheEntry = { rules: RobotsRules | "unreachable"; expires: number };
const cache = new Map<string, CacheEntry>();

/** For tests. */
export function clearRobotsCache(): void {
  cache.clear();
}

/**
 * May PicachoBot read this URL? Reads the host's robots.txt at most once a
 * day (once an hour while it is unreachable). A URL safe-fetch would refuse
 * anyway is "no": the import refuses it just the same.
 */
export async function robotsAllowsUrl(input: string, deps: SiteTextDeps & { now?: () => number } = {}): Promise<boolean> {
  let url: URL;
  try {
    url = vetUrl(input);
  } catch {
    return false;
  }
  const now = (deps.now ?? Date.now)();
  const host = url.hostname.toLowerCase();
  let entry = cache.get(host);
  if (!entry || entry.expires <= now) {
    const read = await fetchSiteText(`https://${host}/robots.txt`, "robots", deps);
    // RFC 9309: a 4xx (or a redirect chain too long to follow) is "no
    // robots.txt", so no rules; a 5xx or no answer is complete disallow.
    const unavailable = !read.ok && (read.unreachable ? read.code === "too_many_redirects" : read.status < 500);
    entry = read.ok
      ? { rules: parseRobots(read.text), expires: now + ROBOTS_TTL_MS }
      : unavailable
        ? { rules: null, expires: now + ROBOTS_TTL_MS }
        : { rules: "unreachable", expires: now + ROBOTS_UNREACHABLE_TTL_MS };
    cache.delete(host);
    cache.set(host, entry);
    while (cache.size > MAX_CACHED_HOSTS) cache.delete(cache.keys().next().value as string);
  }
  if (entry.rules === "unreachable") return false;
  return robotsAllowsPath(entry.rules, `${url.pathname}${url.search}`);
}
