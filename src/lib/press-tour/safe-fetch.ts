// Press Tour: the one door through which the SERVER fetches a URL a person
// handed us — a product page, the pictures on it, a brand's website, an MCP
// client's metadata document (spec §1.1 "safe-fetch contract", critique #33).
//
// Why a new module. The two guards the codebase already has do not fit a
// person-supplied URL: isAllowedFetchUrl (media/url.ts) allows only our own
// origin and Supabase, and assertNotInternalAddress (providers/
// openai-images.ts) reads the hostname TEXT — a public name that resolves to
// 10.0.0.5 or 169.254.169.254 sails through it.
//
// The contract, in the order a request meets it:
//  1. The URL. https only. A pasted http:// link is UPGRADED to https:// (same
//     host and path, port 443) rather than refused — people paste http links
//     and the upgrade gives up nothing: we still speak TLS, validate the
//     certificate, and connect to 443. The same upgrade applies to every
//     redirect hop, so an https→http downgrade is impossible. Any other scheme
//     (file:, ftp:, data:, javascript:, gopher:) is refused. Any port other
//     than 443 is refused. user:pass@ in the URL is refused. IP literals are
//     refused (no product page lives on a bare address, and 0x7f.1 /
//     2130706433 / [::ffff:7f00:1] spellings stop being a question), and so
//     are names that only exist inside a network (localhost, *.local,
//     *.internal, *.home.arpa, single-label names).
//  2. DNS. The host is resolved (all A and AAAA records) and the request is
//     refused if ANY returned address is not public unicast: loopback,
//     private, link-local, CGNAT, "this network", multicast, reserved,
//     documentation and benchmarking ranges for IPv4; for IPv6 anything
//     outside global unicast 2000::/3 (which removes ::, ::1, IPv4-mapped
//     ::ffff:0:0/96, IPv4-compatible ::/96, NAT64 64:ff9b::/96 and
//     64:ff9b:1::/48, ULA fc00::/7, link-local fe80::/10, multicast ff00::/8,
//     discard 100::/64) plus the special blocks inside it (6to4 2002::/16,
//     Teredo and the IETF block 2001::/23, documentation 2001:db8::/32 and
//     3fff::/20). NAT64, 6to4 and Teredo embed an IPv4 address that a gateway
//     would forward to, so they are refused whole rather than decoded.
//     node:net BlockList does the range maths. The two families live in
//     SEPARATE lists on purpose: a BlockList holding the IPv6 rule
//     ::ffff:0:0/96 answers true for EVERY IPv4 address checked against it
//     (verified on Node 24, 2026-09-25) — one shared list would either block
//     the whole internet or, arranged the other way, nothing.
//  3. The connection is PINNED to the address that passed step 2: the
//     transport hands https.request a `lookup` that ignores the name and
//     returns that one address, so a DNS answer that changes between the
//     check and the connect (rebinding) never reaches a socket. SNI, the Host
//     header and certificate validation still use the hostname.
//  4. Redirects are followed by hand, at most 3, and every hop goes through
//     steps 1–3 again. Nothing from a response (Set-Cookie included) is ever
//     sent on the next hop: no cookies, no Authorization, no Referer, ever.
//  5. Hard timeouts: 3 s to a TLS connection, 8 s for the whole fetch
//     (redirects and DNS included). A caller may shorten either, never
//     lengthen past MAX_TOTAL_TIMEOUT_MS.
//  6. Size caps on DECODED bytes (critique #33: gzip bombs): 2 MB for HTML
//     and JSON, 12 MB for an image. A declared Content-Length over the cap is
//     refused before reading; the wire stream is cut at the cap; gzip /
//     deflate / br are inflated with zlib's maxOutputLength, so a 3 KB body
//     that inflates to 3 GB stops at the cap without ever being allocated.
//  7. Type. HTML/JSON must say so in Content-Type (text/html,
//     application/xhtml+xml / application/json, application/ld+json). Images
//     are decided by their MAGIC BYTES, not the header: JPEG, PNG, WebP or
//     AVIF only. SVG is refused — by header before the body is read, and by
//     bytes whatever the header says — with SVG_LOGO_REFUSED (no rasterizer
//     in v1; synthesis #33).
//
// Errors are a SafeFetchError carrying one SafeFetchErrorCode. Messages are
// for logs; what a person reads comes from customerMessageFor(code), whose
// English strings are the wire format i18n maps (i18n/server-text.ts).
//
// Robots.txt and the per-user / per-host rate limits are the import layer's
// job (spec §1.1), not this module's: this module is the socket.
//
// Server-only (node:net, node:dns, node:https, node:zlib). Relative imports
// only: tested as it is (vitest has no "@/" alias).

import { BlockList, isIP, type LookupFunction } from "node:net";
import { promises as dnsPromises } from "node:dns";
import https from "node:https";
import zlib from "node:zlib";

// ---------------------------------------------------------------------------
// Public constants
// ---------------------------------------------------------------------------

/** What the product card says when a page could not be read (spec §1.1 step 2). */
export const PAGE_UNREADABLE = "We couldn't read that page. Add photos instead.";
/** What a person reads when an SVG is offered as a picture or a logo (synthesis #33). */
export const SVG_LOGO_REFUSED = "Upload your logo as a PNG";

export const SAFE_FETCH_USER_AGENT = "PicachoBot/1.0 (+https://picacho.ai/bot)";

export const DEFAULT_CONNECT_TIMEOUT_MS = 3_000;
export const DEFAULT_TOTAL_TIMEOUT_MS = 8_000;
/** The ceiling a caller's timeoutMs is clamped to. */
export const MAX_TOTAL_TIMEOUT_MS = 15_000;
export const MAX_REDIRECTS = 3;

export type SafeFetchKind = "html" | "json" | "image";

/** Decoded-byte caps per kind. A caller may lower these (maxBytes), never raise them. */
export const MAX_BYTES: Readonly<Record<SafeFetchKind, number>> = {
  html: 2 * 1024 * 1024,
  json: 2 * 1024 * 1024,
  image: 12 * 1024 * 1024,
};

const TEXT_TYPES: Readonly<Record<"html" | "json", readonly string[]>> = {
  html: ["text/html", "application/xhtml+xml"],
  json: ["application/json", "application/ld+json"],
};

const ACCEPT: Readonly<Record<SafeFetchKind, string>> = {
  html: "text/html,application/xhtml+xml;q=0.9",
  json: "application/json,application/ld+json;q=0.9",
  image: "image/avif,image/webp,image/png,image/jpeg;q=0.9",
};

/** How many leading bytes sniffImageType needs to be sure (an SVG can sit behind an XML prolog and comments). */
export const SNIFF_BYTES = 4096;

export type SniffedImageType =
  | "image/jpeg"
  | "image/png"
  | "image/webp"
  | "image/avif"
  | "image/gif"
  | "image/heic"
  | "image/svg+xml";

/** The image formats we accept, by magic bytes. */
export const ALLOWED_IMAGE_TYPES: ReadonlySet<SniffedImageType> = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/avif",
]);

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export const SAFE_FETCH_ERROR_CODES = [
  "invalid_url", // unparseable, too long, or no host
  "scheme_not_allowed", // anything but https (http is upgraded, not refused)
  "port_not_allowed", // any explicit port but 443
  "credentials_in_url", // user:pass@host
  "host_not_allowed", // IP literal, localhost, *.local, *.internal, single-label …
  "dns_failed", // the name did not resolve
  "address_blocked", // a resolved address is not public unicast
  "too_many_redirects",
  "bad_redirect", // 3xx without a usable Location
  "timeout",
  "aborted", // the caller's signal fired
  "connect_failed",
  "tls_failed",
  "http_status", // a final status outside 2xx (see .status)
  "content_type_not_allowed",
  "svg_refused",
  "not_an_image", // the bytes are not a picture at all
  "too_large", // over the decoded-byte cap
  "bad_encoding", // unknown or corrupt Content-Encoding
] as const;

export type SafeFetchErrorCode = (typeof SAFE_FETCH_ERROR_CODES)[number];

export class SafeFetchError extends Error {
  readonly code: SafeFetchErrorCode;
  /** The HTTP status, for code "http_status". */
  readonly status?: number;
  constructor(code: SafeFetchErrorCode, message?: string, status?: number) {
    super(message ?? code);
    this.name = "SafeFetchError";
    this.code = code;
    if (status !== undefined) this.status = status;
  }
}

/** The English sentence a person reads for a refused fetch (i18n maps it at display time). */
export function customerMessageFor(code: SafeFetchErrorCode): string {
  return code === "svg_refused" ? SVG_LOGO_REFUSED : PAGE_UNREADABLE;
}

// ---------------------------------------------------------------------------
// Addresses
// ---------------------------------------------------------------------------

function v4List(): BlockList {
  const list = new BlockList();
  const subnets: Array<[string, number]> = [
    ["0.0.0.0", 8], // "this network"
    ["10.0.0.0", 8], // private
    ["100.64.0.0", 10], // CGNAT
    ["127.0.0.0", 8], // loopback
    ["169.254.0.0", 16], // link-local (cloud metadata lives here)
    ["172.16.0.0", 12], // private
    ["192.0.0.0", 24], // IETF protocol assignments
    ["192.0.2.0", 24], // TEST-NET-1
    ["192.88.99.0", 24], // 6to4 relay anycast (deprecated)
    ["192.168.0.0", 16], // private
    ["198.18.0.0", 15], // benchmarking
    ["198.51.100.0", 24], // TEST-NET-2
    ["203.0.113.0", 24], // TEST-NET-3
    ["224.0.0.0", 4], // multicast
    ["240.0.0.0", 4], // reserved, and 255.255.255.255 broadcast
  ];
  for (const [net, prefix] of subnets) list.addSubnet(net, prefix, "ipv4");
  return list;
}

function v6GlobalList(): BlockList {
  const list = new BlockList();
  list.addSubnet("2000::", 3, "ipv6"); // global unicast — the only v6 we will talk to
  return list;
}

function v6BlockedList(): BlockList {
  const list = new BlockList();
  const subnets: Array<[string, number]> = [
    // Inside 2000::/3 but not somewhere a product page lives:
    ["2001::", 23], // IETF protocol assignments, incl. Teredo 2001::/32, ORCHID, benchmarking
    ["2001:db8::", 32], // documentation
    ["2002::", 16], // 6to4 — embeds an IPv4 address a relay forwards to
    ["3fff::", 20], // documentation (RFC 9637)
    // Outside 2000::/3 already, listed so the intent is written down and a
    // future edit to the global rule cannot quietly open them:
    ["::", 96], // IPv4-compatible (and :: / ::1)
    ["::ffff:0:0", 96], // IPv4-mapped
    ["64:ff9b::", 96], // NAT64 well-known prefix
    ["64:ff9b:1::", 48], // NAT64 local-use
    ["100::", 64], // discard-only
    ["fc00::", 7], // unique local
    ["fe80::", 10], // link-local
    ["fec0::", 10], // site-local (deprecated)
    ["ff00::", 8], // multicast
  ];
  for (const [net, prefix] of subnets) list.addSubnet(net, prefix, "ipv6");
  return list;
}

const V4_BLOCKED = v4List();
const V6_GLOBAL = v6GlobalList();
const V6_BLOCKED = v6BlockedList();

/**
 * True only for a public unicast address we may connect to. Anything that is
 * not a well-formed IPv4 or IPv6 address — including a scoped "fe80::1%en0" —
 * is false: BlockList answers false (not blocked) for garbage, so every
 * address is parsed before it is looked up.
 */
export function isPublicAddress(address: string): boolean {
  if (typeof address !== "string" || address.length === 0 || address.includes("%")) return false;
  const family = isIP(address);
  if (family === 4) return !V4_BLOCKED.check(address, "ipv4");
  if (family === 6) return V6_GLOBAL.check(address, "ipv6") && !V6_BLOCKED.check(address, "ipv6");
  return false;
}

// ---------------------------------------------------------------------------
// URLs
// ---------------------------------------------------------------------------

const MAX_URL_LENGTH = 2048;
const BLOCKED_HOST_SUFFIXES = [
  ".localhost",
  ".local",
  ".localdomain",
  ".internal",
  ".intranet",
  ".lan",
  ".home.arpa",
  ".arpa",
  ".onion",
];

function hostnameAllowed(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/\.$/, "");
  if (host.length === 0 || host.length > 253) return false;
  if (host === "localhost") return false;
  if (!host.includes(".")) return false; // single-label names only exist inside a network
  for (const suffix of BLOCKED_HOST_SUFFIXES) {
    if (host.endsWith(suffix) || host === suffix.slice(1)) return false;
  }
  const labels = host.split(".");
  for (const label of labels) {
    if (label.length === 0 || label.length > 63) return false;
    if (!/^[a-z0-9_-]+$/.test(label)) return false;
  }
  // A numeric top-level label is an address in disguise, never a name.
  if (/^\d+$/.test(labels[labels.length - 1])) return false;
  return true;
}

/**
 * Parses and vets a URL against step 1 of the contract. http:// comes back as
 * https:// (port 443); the fragment is dropped. Throws SafeFetchError.
 */
export function vetUrl(input: string): URL {
  if (typeof input !== "string") throw new SafeFetchError("invalid_url", "URL is not a string");
  const trimmed = input.trim();
  if (trimmed.length === 0 || trimmed.length > MAX_URL_LENGTH) {
    throw new SafeFetchError("invalid_url", "URL is empty or too long");
  }
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    throw new SafeFetchError("invalid_url", "URL does not parse");
  }
  if (url.protocol === "http:") {
    // Upgrade: same host and path over TLS. An explicit :80 falls away with
    // the scheme; any other explicit port survives and is refused below.
    const port = url.port;
    url.protocol = "https:";
    if (port === "" || port === "80") url.port = "";
  } else if (url.protocol !== "https:") {
    throw new SafeFetchError("scheme_not_allowed", `scheme ${url.protocol} is not allowed`);
  }
  if (url.protocol !== "https:") throw new SafeFetchError("scheme_not_allowed", "scheme could not be upgraded");
  if (url.username !== "" || url.password !== "") {
    throw new SafeFetchError("credentials_in_url", "URL carries credentials");
  }
  if (url.port !== "" && url.port !== "443") {
    throw new SafeFetchError("port_not_allowed", `port ${url.port} is not allowed`);
  }
  const host = url.hostname;
  if (!host) throw new SafeFetchError("invalid_url", "URL has no host");
  if (host.startsWith("[") || isIP(host) !== 0) {
    throw new SafeFetchError("host_not_allowed", "IP-address URLs are not fetched");
  }
  if (!hostnameAllowed(host)) throw new SafeFetchError("host_not_allowed", "host is not a public name");
  url.hash = "";
  return url;
}

// ---------------------------------------------------------------------------
// DNS
// ---------------------------------------------------------------------------

export interface ResolvedAddress {
  address: string;
  family?: number;
}

/** Resolves a hostname to every address it has. Injected in tests. */
export type Resolver = (hostname: string) => Promise<ResolvedAddress[]>;

export const systemResolver: Resolver = (hostname) => dnsPromises.lookup(hostname, { all: true });

export interface PinnedAddress {
  address: string;
  family: 4 | 6;
}

/**
 * Resolves `hostname` and returns the one address the connection will be
 * pinned to — refusing if ANY answer is not public. IPv4 is preferred (the
 * serverless egress we run on has no guaranteed IPv6 route).
 */
export async function resolvePinned(hostname: string, resolve: Resolver): Promise<PinnedAddress> {
  let answers: ResolvedAddress[];
  try {
    answers = await resolve(hostname);
  } catch {
    throw new SafeFetchError("dns_failed", "the name did not resolve");
  }
  if (!Array.isArray(answers) || answers.length === 0) {
    throw new SafeFetchError("dns_failed", "the name resolved to nothing");
  }
  for (const answer of answers) {
    if (!answer || !isPublicAddress(answer.address)) {
      throw new SafeFetchError("address_blocked", "the name resolves to a non-public address");
    }
  }
  const chosen = answers.find((a) => isIP(a.address) === 4) ?? answers[0];
  return { address: chosen.address, family: isIP(chosen.address) === 4 ? 4 : 6 };
}

// ---------------------------------------------------------------------------
// Transport (the injectable "fetch function")
// ---------------------------------------------------------------------------

export interface TransportRequest {
  url: URL;
  /** The vetted address. The transport MUST connect here and nowhere else. */
  address: string;
  family: 4 | 6;
  /** Always 443 from safeFetch; a parameter only so the pin can be proven against a local socket. */
  port: number;
  headers: Readonly<Record<string, string>>;
  signal: AbortSignal;
  connectTimeoutMs: number;
}

export interface TransportResponse {
  status: number;
  headers: Readonly<Record<string, string | string[] | undefined>>;
  body: AsyncIterable<Uint8Array | string>;
  /** Releases the connection; safe to call more than once. */
  destroy(): void;
}

export type Transport = (request: TransportRequest) => Promise<TransportResponse>;

/**
 * A net `lookup` that ignores the name it is asked about and answers with the
 * vetted address. Handles both callback shapes Node uses (single address, and
 * `all: true` from the happy-eyeballs connect path).
 */
export function pinnedLookup(address: string, family: 4 | 6): LookupFunction {
  const lookup = (
    _hostname: string,
    options: unknown,
    callback?: (err: NodeJS.ErrnoException | null, address: string | Array<{ address: string; family: number }>, family?: number) => void,
  ): void => {
    const cb = (typeof options === "function" ? options : callback) as NonNullable<typeof callback>;
    const all = typeof options === "object" && options !== null && (options as { all?: boolean }).all === true;
    if (all) cb(null, [{ address, family }]);
    else cb(null, address, family);
  };
  return lookup as unknown as LookupFunction;
}

function transportError(err: unknown): SafeFetchError {
  if (err instanceof SafeFetchError) return err;
  const e = err as { code?: unknown; name?: unknown; message?: unknown } | null;
  const code = typeof e?.code === "string" ? e.code : "";
  const message = typeof e?.message === "string" ? e.message : "connection failed";
  if (e?.name === "AbortError" || code === "ABORT_ERR") return new SafeFetchError("aborted", message);
  if (code.startsWith("ERR_TLS") || code.startsWith("ERR_SSL") || code.includes("CERT") || /certificate|ssl|tls/i.test(message)) {
    return new SafeFetchError("tls_failed", message);
  }
  return new SafeFetchError("connect_failed", message);
}

/** The production transport: node:https, one fresh socket, pinned to the vetted address. */
export const httpsTransport: Transport = (request) =>
  new Promise<TransportResponse>((resolve, reject) => {
    let settled = false;
    const fail = (err: unknown) => {
      if (settled) return;
      settled = true;
      reject(transportError(err));
    };
    const hostname = request.url.hostname;
    const req = https.request({
      protocol: "https:",
      hostname,
      port: request.port,
      path: `${request.url.pathname}${request.url.search}`,
      method: "GET",
      headers: { ...request.headers },
      agent: false, // no pooled socket, no shared state with any other request
      servername: hostname,
      lookup: pinnedLookup(request.address, request.family),
      family: request.family,
      signal: request.signal,
      maxHeaderSize: 16 * 1024,
      rejectUnauthorized: true,
    });
    const connectTimer = setTimeout(() => {
      req.destroy(new SafeFetchError("timeout", "connect timed out"));
    }, request.connectTimeoutMs);
    req.once("socket", (socket) => {
      socket.once("secureConnect", () => clearTimeout(connectTimer));
    });
    req.once("response", (res) => {
      clearTimeout(connectTimer);
      if (settled) {
        res.destroy();
        return;
      }
      settled = true;
      resolve({
        status: res.statusCode ?? 0,
        headers: res.headers,
        body: res,
        destroy: () => {
          res.destroy();
          req.destroy();
        },
      });
    });
    // `on`, not `once`: a socket can error again after the response resolved,
    // and an unhandled 'error' event would take the process down.
    req.on("error", (err) => {
      clearTimeout(connectTimer);
      fail(err);
    });
    req.end();
  });

// ---------------------------------------------------------------------------
// Bytes
// ---------------------------------------------------------------------------

function startsWithBytes(buf: Uint8Array, bytes: readonly number[], offset = 0): boolean {
  if (buf.length < offset + bytes.length) return false;
  for (let i = 0; i < bytes.length; i++) if (buf[offset + i] !== bytes[i]) return false;
  return true;
}

function ascii(buf: Uint8Array, start: number, end: number): string {
  let s = "";
  for (let i = start; i < end && i < buf.length; i++) s += String.fromCharCode(buf[i]);
  return s;
}

/**
 * The image format by magic bytes, or null when the bytes are not a picture
 * we recognise. SVG (any leading "<" markup that mentions <svg) is reported so
 * callers can refuse it with SVG_LOGO_REFUSED.
 */
export function sniffImageType(bytes: Uint8Array): SniffedImageType | null {
  if (startsWithBytes(bytes, [0xff, 0xd8, 0xff])) return "image/jpeg";
  if (startsWithBytes(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return "image/png";
  if (ascii(bytes, 0, 4) === "RIFF" && ascii(bytes, 8, 12) === "WEBP") return "image/webp";
  if (ascii(bytes, 0, 4) === "GIF8") return "image/gif";
  if (ascii(bytes, 4, 8) === "ftyp") {
    // ISO-BMFF: the major brand, then compatible brands, until the box ends.
    const boxSize = ((bytes[0] << 24) | (bytes[1] << 16) | (bytes[2] << 8) | bytes[3]) >>> 0;
    const end = Math.min(bytes.length, Math.max(16, Math.min(boxSize, 256)));
    const brands: string[] = [ascii(bytes, 8, 12)];
    for (let i = 16; i + 4 <= end; i += 4) brands.push(ascii(bytes, i, i + 4));
    if (brands.includes("avif") || brands.includes("avis")) return "image/avif";
    if (brands.some((b) => ["heic", "heix", "hevc", "hevx", "heim", "heis", "mif1", "msf1"].includes(b))) {
      return "image/heic";
    }
    return null;
  }
  // Markup: skip a UTF-8 BOM and whitespace, then look for "<".
  let i = 0;
  if (startsWithBytes(bytes, [0xef, 0xbb, 0xbf])) i = 3;
  while (i < bytes.length && (bytes[i] === 0x20 || bytes[i] === 0x09 || bytes[i] === 0x0a || bytes[i] === 0x0d)) i++;
  if (bytes[i] === 0x3c /* < */) {
    const head = ascii(bytes, i, Math.min(bytes.length, i + SNIFF_BYTES)).toLowerCase();
    const svgAt = head.indexOf("<svg");
    // An HTML page (an error page served for a picture URL) often carries
    // inline <svg> icons: it is "not a picture", not an SVG.
    const htmlAt = head.search(/<!doctype\s+html|<html[\s>]/);
    if (svgAt >= 0 && (htmlAt < 0 || svgAt < htmlAt)) return "image/svg+xml";
  }
  return null;
}


function headerValue(headers: TransportResponse["headers"], name: string): string | null {
  const want = name.toLowerCase();
  for (const key of Object.keys(headers)) {
    if (key.toLowerCase() !== want) continue;
    const value = headers[key];
    if (Array.isArray(value)) return value.length > 0 ? String(value[0]) : null;
    return value === undefined ? null : String(value);
  }
  return null;
}

function mediaType(contentType: string | null): string {
  return (contentType ?? "").split(";")[0].trim().toLowerCase();
}

function charsetOf(contentType: string | null): string | null {
  const m = /;\s*charset\s*=\s*"?([^";\s]+)"?/i.exec(contentType ?? "");
  return m ? m[1].toLowerCase() : null;
}

/**
 * Decodes an HTML or JSON body to text: a BOM wins, then the header's
 * charset, then a <meta charset> in the first 2 KB, then UTF-8. An unknown
 * label falls back to UTF-8 rather than failing.
 */
export function decodeText(body: Uint8Array, contentType: string | null): string {
  let label: string | null = null;
  if (startsWithBytes(body, [0xef, 0xbb, 0xbf])) label = "utf-8";
  else if (startsWithBytes(body, [0xff, 0xfe])) label = "utf-16le";
  else if (startsWithBytes(body, [0xfe, 0xff])) label = "utf-16be";
  if (!label) label = charsetOf(contentType);
  if (!label) {
    const head = ascii(body, 0, 2048);
    const m =
      /<meta[^>]+charset\s*=\s*["']?\s*([a-z0-9_:.-]+)/i.exec(head) ??
      /<meta[^>]+content\s*=\s*["'][^"']*charset\s*=\s*([a-z0-9_:.-]+)/i.exec(head);
    if (m) label = m[1].toLowerCase();
  }
  try {
    return new TextDecoder(label ?? "utf-8").decode(body);
  } catch {
    return new TextDecoder("utf-8").decode(body);
  }
}

function inflate(encoding: string, raw: Buffer, maxBytes: number): Promise<Buffer> {
  return new Promise<Buffer>((resolve, reject) => {
    const done = (err: Error | null, out: Buffer) => {
      if (!err) return resolve(out);
      const code = (err as { code?: unknown }).code;
      if (code === "ERR_BUFFER_TOO_LARGE" || err instanceof RangeError) {
        reject(new SafeFetchError("too_large", "decoded body is over the cap"));
      } else {
        reject(new SafeFetchError("bad_encoding", `could not decode ${encoding}`));
      }
    };
    const options = { maxOutputLength: maxBytes };
    if (encoding === "gzip" || encoding === "x-gzip") zlib.gunzip(raw, options, done);
    else if (encoding === "br") zlib.brotliDecompress(raw, options, done);
    else if (encoding === "deflate") {
      // "deflate" is zlib-wrapped by the spec and raw in the wild: try both.
      zlib.inflate(raw, options, (err, out) => {
        if (!err) return resolve(out);
        const code = (err as { code?: unknown }).code;
        if (code === "ERR_BUFFER_TOO_LARGE" || err instanceof RangeError) return done(err, out);
        zlib.inflateRaw(raw, options, done);
      });
    } else reject(new SafeFetchError("bad_encoding", `content-encoding ${encoding} is not supported`));
  });
}

// ---------------------------------------------------------------------------
// Abort plumbing
// ---------------------------------------------------------------------------

function abortReason(signal: AbortSignal): SafeFetchError {
  const reason: unknown = signal.reason;
  return reason instanceof SafeFetchError ? reason : new SafeFetchError("aborted", "aborted");
}

/** Settles with `promise`, or rejects the moment `signal` aborts — whichever is first. */
function raceAbort<T>(promise: Promise<T>, signal: AbortSignal, onLateValue?: (value: T) => void): Promise<T> {
  if (signal.aborted) {
    promise.then((v) => onLateValue?.(v), () => {});
    return Promise.reject(abortReason(signal));
  }
  return new Promise<T>((resolve, reject) => {
    let done = false;
    const onAbort = () => {
      if (done) return;
      done = true;
      reject(abortReason(signal));
    };
    signal.addEventListener("abort", onAbort, { once: true });
    promise.then(
      (value) => {
        signal.removeEventListener("abort", onAbort);
        if (done) {
          onLateValue?.(value);
          return;
        }
        done = true;
        resolve(value);
      },
      (err) => {
        signal.removeEventListener("abort", onAbort);
        if (done) return;
        done = true;
        reject(err);
      },
    );
  });
}

// ---------------------------------------------------------------------------
// safeFetch
// ---------------------------------------------------------------------------

export interface SafeFetchOptions {
  kind: SafeFetchKind;
  /** Lower the decoded-byte cap for this call (e.g. 5 KB for an MCP client document). Never raises it. */
  maxBytes?: number;
  /** Whole-fetch budget, redirects and DNS included. Clamped to MAX_TOTAL_TIMEOUT_MS. */
  timeoutMs?: number;
  /** Budget to a TLS connection, per hop. */
  connectTimeoutMs?: number;
  /** 0–3. */
  maxRedirects?: number;
  signal?: AbortSignal;
  /** DNS, injectable for tests. Defaults to the system resolver. */
  resolve?: Resolver;
  /** The fetch function, injectable for tests. Defaults to httpsTransport. */
  transport?: Transport;
}

export interface SafeFetchResult {
  /** The URL finally read, after redirects (always https). */
  url: string;
  /** Every hop followed, in order (not including the first URL). */
  redirects: string[];
  /** The vetted address the final connection was pinned to. */
  address: string;
  status: number;
  /** The media type: from the header for html/json, from the MAGIC BYTES for images. */
  contentType: string;
  /** The decoded body, never more than the cap. */
  body: Buffer;
  /** html / json: the body as text. image: null. */
  text: string | null;
}

function clampInt(value: number | undefined, fallback: number, min: number, max: number): number {
  const n = typeof value === "number" && Number.isFinite(value) ? Math.floor(value) : fallback;
  return Math.min(max, Math.max(min, n));
}

function isRedirect(status: number): boolean {
  return status === 301 || status === 302 || status === 303 || status === 307 || status === 308;
}

async function readCapped(
  response: TransportResponse,
  maxBytes: number,
  signal: AbortSignal,
  onPrefix: ((prefix: Buffer) => void) | null,
): Promise<Buffer> {
  const iterator = response.body[Symbol.asyncIterator]();
  const chunks: Buffer[] = [];
  let total = 0;
  let prefixChecked = onPrefix === null;
  try {
    for (;;) {
      const step = await raceAbort(iterator.next(), signal);
      if (step.done) break;
      const value = step.value;
      const chunk = typeof value === "string" ? Buffer.from(value, "utf8") : Buffer.from(value.buffer, value.byteOffset, value.byteLength);
      if (chunk.length === 0) continue;
      total += chunk.length;
      if (total > maxBytes) throw new SafeFetchError("too_large", "body is over the cap");
      chunks.push(chunk);
      if (!prefixChecked && total >= SNIFF_BYTES) {
        prefixChecked = true;
        onPrefix?.(chunks.length === 1 ? chunks[0] : Buffer.concat(chunks, total));
      }
    }
  } catch (err) {
    response.destroy();
    // Not awaited: a stuck producer must not hold the caller hostage.
    void Promise.resolve()
      .then(() => iterator.return?.())
      .catch(() => {});
    throw err;
  }
  return Buffer.concat(chunks, total);
}

/**
 * Fetches a person-supplied URL under the contract at the top of this file.
 * Resolves with the decoded body, or throws SafeFetchError.
 */
export async function safeFetch(input: string, opts: SafeFetchOptions): Promise<SafeFetchResult> {
  const kind = opts?.kind;
  if (kind !== "html" && kind !== "json" && kind !== "image") {
    throw new SafeFetchError("content_type_not_allowed", "unknown fetch kind");
  }
  const cap = MAX_BYTES[kind];
  const maxBytes = clampInt(opts.maxBytes, cap, 1, cap);
  const timeoutMs = clampInt(opts.timeoutMs, DEFAULT_TOTAL_TIMEOUT_MS, 1, MAX_TOTAL_TIMEOUT_MS);
  const connectTimeoutMs = clampInt(opts.connectTimeoutMs, DEFAULT_CONNECT_TIMEOUT_MS, 1, timeoutMs);
  const maxRedirects = clampInt(opts.maxRedirects, MAX_REDIRECTS, 0, MAX_REDIRECTS);
  const resolve = opts.resolve ?? systemResolver;
  const transport = opts.transport ?? httpsTransport;

  let url = vetUrl(input);

  const controller = new AbortController();
  const signal = controller.signal;
  const timer = setTimeout(() => controller.abort(new SafeFetchError("timeout", "the fetch took too long")), timeoutMs);
  const outer = opts.signal;
  const onOuterAbort = () => controller.abort(new SafeFetchError("aborted", "the caller cancelled"));
  if (outer) {
    if (outer.aborted) onOuterAbort();
    else outer.addEventListener("abort", onOuterAbort, { once: true });
  }

  // Built fresh for every hop, from constants only: nothing a response says
  // (Set-Cookie, WWW-Authenticate, …) can ever be sent back.
  const headers: Record<string, string> = {
    "user-agent": SAFE_FETCH_USER_AGENT,
    accept: ACCEPT[kind],
    "accept-encoding": "gzip, deflate, br",
    "accept-language": "en;q=0.9, *;q=0.5",
  };

  const redirects: string[] = [];
  try {
    for (let hop = 0; ; hop++) {
      const pin = await raceAbort(resolvePinned(url.hostname, resolve), signal);
      const response = await raceAbort(
        transport({
          url,
          address: pin.address,
          family: pin.family,
          port: 443,
          headers: { ...headers },
          signal,
          connectTimeoutMs,
        }),
        signal,
        (late) => late.destroy(),
      );

      if (isRedirect(response.status)) {
        response.destroy();
        if (hop >= maxRedirects) throw new SafeFetchError("too_many_redirects", `more than ${maxRedirects} redirects`);
        const location = headerValue(response.headers, "location");
        if (!location) throw new SafeFetchError("bad_redirect", "redirect without a Location");
        let next: URL;
        try {
          next = new URL(location, url);
        } catch {
          throw new SafeFetchError("bad_redirect", "redirect Location does not parse");
        }
        url = vetUrl(next.href);
        redirects.push(url.href);
        continue;
      }

      if (response.status < 200 || response.status > 299 || response.status === 204 || response.status === 206) {
        response.destroy();
        throw new SafeFetchError("http_status", `status ${response.status}`, response.status);
      }

      const contentTypeHeader = headerValue(response.headers, "content-type");
      const declaredType = mediaType(contentTypeHeader);
      if (kind === "image") {
        if (declaredType === "image/svg+xml") {
          response.destroy();
          throw new SafeFetchError("svg_refused", "SVG is not accepted");
        }
      } else if (declaredType !== "" && !TEXT_TYPES[kind].includes(declaredType)) {
        response.destroy();
        throw new SafeFetchError("content_type_not_allowed", `content type ${declaredType} is not allowed`);
      }

      const declaredLength = Number(headerValue(response.headers, "content-length"));
      if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
        response.destroy();
        throw new SafeFetchError("too_large", "declared length is over the cap");
      }

      const encoding = (headerValue(response.headers, "content-encoding") ?? "").trim().toLowerCase();
      const identity = encoding === "" || encoding === "identity";
      if (!identity && !["gzip", "x-gzip", "deflate", "br"].includes(encoding)) {
        response.destroy();
        throw new SafeFetchError("bad_encoding", `content-encoding ${encoding} is not supported`);
      }

      // Refuse a non-picture as soon as its first bytes arrive, not after 12 MB.
      const earlySniff = kind === "image" && identity ? (prefix: Buffer) => assertImageBytes(prefix) : null;
      const raw = await readCapped(response, maxBytes, signal, earlySniff);
      const body = identity ? raw : await raceAbort(inflate(encoding, raw, maxBytes), signal);
      if (body.length > maxBytes) throw new SafeFetchError("too_large", "decoded body is over the cap");

      if (kind === "image") {
        const sniffed = assertImageBytes(body);
        return { url: url.href, redirects, address: pin.address, status: response.status, contentType: sniffed, body, text: null };
      }

      if (declaredType === "") {
        // No Content-Type: accept only what is plainly the expected text.
        const head = body.subarray(0, 512).toString("latin1").trimStart().toLowerCase();
        const looksRight = kind === "html" ? head.startsWith("<") : head.startsWith("{") || head.startsWith("[");
        if (!looksRight) throw new SafeFetchError("content_type_not_allowed", "no content type and the body does not look right");
      }
      return {
        url: url.href,
        redirects,
        address: pin.address,
        status: response.status,
        contentType: declaredType || (kind === "html" ? "text/html" : "application/json"),
        body,
        text: decodeText(body, contentTypeHeader),
      };
    }
  } catch (err) {
    if (err instanceof SafeFetchError) throw err;
    if (signal.aborted) throw abortReason(signal);
    throw transportError(err);
  } finally {
    clearTimeout(timer);
    outer?.removeEventListener("abort", onOuterAbort);
  }
}

function assertImageBytes(bytes: Uint8Array): SniffedImageType {
  const sniffed = sniffImageType(bytes);
  if (sniffed === "image/svg+xml") throw new SafeFetchError("svg_refused", "SVG is not accepted");
  if (sniffed === null) throw new SafeFetchError("not_an_image", "the bytes are not a picture");
  if (!ALLOWED_IMAGE_TYPES.has(sniffed)) {
    throw new SafeFetchError("content_type_not_allowed", `${sniffed} is not accepted`);
  }
  return sniffed;
}
