// Press Tour: what a product page says about its product (spec §1.1 step 2).
//
// Input is the HTML safe-fetch returned plus the URL it came from. Output is
// the first draft of a product card, in the spec's order of trust:
//   1. JSON-LD `Product` (name, brand, image[], description, sku / gtin / mpn);
//   2. OpenGraph (og:title, og:description, og:image…, product:brand);
//   3. <title> and <meta name="description">;
//   4. the pictures on the page, as absolute, deduplicated candidate URLs.
// No site-specific scrapers: nothing here branches on a domain, and every
// attribute read is a generic HTML / schema.org / OpenGraph one (plus the
// common lazy-loading spellings data-src / data-srcset / data-zoom-image).
//
// EVERYTHING returned is untrusted page data. Structured fields (name, brand,
// sku…) are for the person to confirm on the card, never for a prompt as-is.
// Free text reaches a model ONLY as `fencedText`:
//   <untrusted_page source="shop.example.com">…</untrusted_page>
// cut to 4,000 characters (spec §1.1), with the page unable to close the
// fence (< > & are escaped), with invisible and bidi-override characters and
// Unicode tag characters removed (the usual ways to smuggle instructions past
// a reader), and without the text of elements the page hides from people
// (hidden, aria-hidden, display:none, visibility:hidden, opacity:0,
// font-size:0). The fence is the defence; the stripping only narrows what
// hides inside it. The downstream system prompt must still say the fenced
// block is data that may contain instructions to ignore.
//
// Image order: product data first, then social tags (og:image, twitter:image,
// image_src), then the page's own <img>/<picture> sources; within each group
// the largest the page claims comes first (srcset w descriptors,
// og:image:width/height, width/height attributes), then document order.
// Visual duplicates (the same picture at two sizes) are left to
// product-images.ts's perceptual hash — URL tricks to guess them would be
// site knowledge.
//
// Bounded: at most 2,000,000 characters of HTML are read, in one linear pass
// with no DOM; JSON-LD is capped per block, per page, per node and per depth.
// Never throws on any input.
//
// Pure, dependency-free, server-safe. Relative imports only: tested as it is.

export const MAX_HTML_CHARS = 2_000_000;
/** The spec's cut for page text handed to a model (§1.1). */
export const FENCE_MAX_CHARS = 4_000;
export const MAX_IMAGE_CANDIDATES = 24;
/** Pictures the page itself says are smaller than this (longest side, px) are icons or pixels. */
export const MIN_IMAGE_HINT = 128;

const MAX_TAGS = 100_000;
const MAX_ATTRS = 64;
const MAX_ATTR_CHARS = 16_384;
const MAX_JSONLD_BLOCKS = 20;
const MAX_JSONLD_CHARS = 1_000_000;
const MAX_JSON_NODES = 5_000;
const MAX_JSON_DEPTH = 12;
const MAX_JSON_CHILDREN = 500;
const MAX_TEXT_COLLECT = 64 * 1024;
const MAX_PRODUCT_IMAGES = 20;
const MAX_SRCSET_ENTRIES = 50;
const MAX_URL_CHARS = 2_048;

export type ImageSource = "product_data" | "social" | "page";

export interface ImageCandidate {
  /** Absolute http(s) URL, fragment removed. */
  url: string;
  source: ImageSource;
  /** The longest side in pixels the page claims for it; 0 when it does not say. */
  sizeHint: number;
}

export interface ProductData {
  name: string | null;
  brand: string | null;
  description: string | null;
  sku: string | null;
  /** Digits only, 8–14 of them, or null. */
  gtin: string | null;
  mpn: string | null;
  /** Absolute image URLs from the JSON-LD, in its order. */
  images: string[];
}

export interface OpenGraphData {
  title: string | null;
  description: string | null;
  siteName: string | null;
  type: string | null;
  /** product:brand / og:brand. */
  brand: string | null;
  images: string[];
}

export interface ExtractedProductPage {
  /** The page URL we were given (the base for relative URLs, unless a <base href> overrides it). */
  url: string;
  host: string;
  /** From JSON-LD, or null when the page has no Product there. */
  product: ProductData | null;
  openGraph: OpenGraphData;
  title: string | null;
  metaDescription: string | null;
  /** Best guesses for the card, in the spec's order of trust. Untrusted; the person confirms them. */
  name: string | null;
  brand: string | null;
  description: string | null;
  /** Ranked candidates (see the header). */
  images: ImageCandidate[];
  imageUrls: string[];
  /** The ONLY form in which page text may reach a model. */
  fencedText: string;
  /** True when the page text was cut to fit the fence. */
  truncated: boolean;
}

// ---------------------------------------------------------------------------
// Text helpers
// ---------------------------------------------------------------------------

const NAMED_ENTITIES: Readonly<Record<string, string>> = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: "\u00a0", shy: "\u00ad",
  copy: "©", reg: "®", trade: "™", hellip: "…", mdash: "—", ndash: "–", minus: "−",
  lsquo: "‘", rsquo: "’", sbquo: "‚", ldquo: "“", rdquo: "”", bdquo: "„", laquo: "«", raquo: "»",
  deg: "°", times: "×", divide: "÷", plusmn: "±", frac12: "½", frac14: "¼", frac34: "¾",
  euro: "€", pound: "£", yen: "¥", cent: "¢", sect: "§", para: "¶", middot: "·", bull: "•",
  prime: "′", Prime: "″", micro: "µ", ordm: "º", ordf: "ª", sup2: "²", sup3: "³",
  iexcl: "¡", iquest: "¿", szlig: "ß",
  aacute: "á", agrave: "à", acirc: "â", atilde: "ã", auml: "ä", aring: "å", aelig: "æ",
  ccedil: "ç", eacute: "é", egrave: "è", ecirc: "ê", euml: "ë",
  iacute: "í", igrave: "ì", icirc: "î", iuml: "ï", ntilde: "ñ",
  oacute: "ó", ograve: "ò", ocirc: "ô", otilde: "õ", ouml: "ö", oslash: "ø",
  uacute: "ú", ugrave: "ù", ucirc: "û", uuml: "ü", yacute: "ý", yuml: "ÿ",
  Aacute: "Á", Agrave: "À", Acirc: "Â", Atilde: "Ã", Auml: "Ä", Aring: "Å", AElig: "Æ",
  Ccedil: "Ç", Eacute: "É", Egrave: "È", Ecirc: "Ê", Euml: "Ë",
  Iacute: "Í", Igrave: "Ì", Icirc: "Î", Iuml: "Ï", Ntilde: "Ñ",
  Oacute: "Ó", Ograve: "Ò", Ocirc: "Ô", Otilde: "Õ", Ouml: "Ö", Oslash: "Ø",
  Uacute: "Ú", Ugrave: "Ù", Ucirc: "Û", Uuml: "Ü", Yacute: "Ý",
};

/** Decodes numeric and the common named HTML entities; unknown names are left as written. */
export function decodeEntities(input: string): string {
  if (!input.includes("&")) return input;
  return input.replace(/&(#[xX][0-9a-fA-F]{1,6}|#[0-9]{1,7}|[a-zA-Z][a-zA-Z0-9]{1,31});?/g, (match, body: string) => {
    if (body.charAt(0) === "#") {
      const hex = body.charAt(1) === "x" || body.charAt(1) === "X";
      const code = parseInt(body.slice(hex ? 2 : 1), hex ? 16 : 10);
      if (!Number.isFinite(code) || code === 0 || code > 0x10ffff || (code >= 0xd800 && code <= 0xdfff)) return "\ufffd";
      return String.fromCodePoint(code);
    }
    const named = NAMED_ENTITIES[body];
    return named === undefined ? match : named;
  });
}

// Control characters (keeping \t \n \r), invisible formatting and bidi
// overrides, variation selectors, and Unicode "tag" characters — the
// invisible alphabet used to smuggle instructions into text a person never
// sees.
const INVISIBLE =
  /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f\u00ad\u034f\u061c\u115f\u1160\u17b4\u17b5\u180b-\u180f\u200b-\u200f\u202a-\u202e\u2060-\u206f\u3164\ufe00-\ufe0f\ufeff\uffa0\ufff0-\ufff8]/g;
const TAG_CHARACTERS = /[\u{e0000}-\u{e007f}]/gu;

function stripInvisible(input: string): string {
  return input.replace(INVISIBLE, "").replace(TAG_CHARACTERS, "");
}

/** One line: entities decoded, tags and invisibles removed, whitespace collapsed, cut to `max`. */
function cleanLine(input: string, max: number): string | null {
  // Bound the input before the tag-stripping regex: markup-heavy descriptions
  // need room, but a megabyte of "<" must not cost a quadratic scan.
  const bounded = input.length > max * 8 + 4_096 ? input.slice(0, max * 8 + 4_096) : input;
  const text = stripInvisible(decodeEntities(bounded.replace(/<[^<>]{0,500}>/g, " ")))
    .replace(/\s+/g, " ")
    .trim();
  if (!text) return null;
  return cutChars(text, max);
}

/** Cuts to at most `max` UTF-16 units without splitting a surrogate pair. */
function cutChars(text: string, max: number): string {
  if (text.length <= max) return text;
  let cut = text.slice(0, max);
  const last = cut.charCodeAt(cut.length - 1);
  if (last >= 0xd800 && last <= 0xdbff) cut = cut.slice(0, -1);
  return cut;
}

function normalizeBlock(input: string): string {
  return stripInvisible(input)
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line.replace(/[^\S\n]+/g, " ").trim())
    .filter((line) => line.length > 0)
    .join("\n");
}

function escapeForFence(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/**
 * Wraps untrusted text as data: `<untrusted_page source="host">…</untrusted_page>`.
 * The text is cleaned, cut to `maxChars` and escaped, so nothing inside can
 * close or forge the fence. Shared with the brand kit and trend briefs.
 */
export function fenceUntrusted(text: string, source: string, maxChars: number = FENCE_MAX_CHARS): string {
  const safeSource = String(source ?? "").toLowerCase().replace(/[^a-z0-9.-]/g, "").slice(0, 253) || "unknown";
  const body = escapeForFence(cutChars(normalizeBlock(String(text ?? "")), Math.max(0, maxChars)));
  return `<untrusted_page source="${safeSource}">\n${body}\n</untrusted_page>`;
}

// ---------------------------------------------------------------------------
// The scanner: one linear pass, no DOM
// ---------------------------------------------------------------------------

type Attrs = Map<string, string>;

interface ScannedImage {
  tag: "img" | "source";
  attrs: Attrs;
  order: number;
}

interface Scan {
  title: string | null;
  metas: Attrs[];
  links: Attrs[];
  images: ScannedImage[];
  jsonLd: string[];
  baseHref: string | null;
  text: string;
}

const VOID = new Set([
  "area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "param", "source", "track", "wbr",
]);
/** Elements whose content is raw text, not markup. */
const RAW_TEXT = new Set(["script", "style", "title", "textarea", "xmp", "iframe", "noembed", "noframes", "plaintext"]);
/** Elements whose text never reaches the page text (their <img> fallbacks still count as pictures). */
const NO_TEXT = new Set(["noscript", "template", "svg", "math", "select", "object", "canvas", "audio", "video"]);
const BLOCK = new Set([
  "address", "article", "aside", "blockquote", "br", "dd", "div", "dl", "dt", "figcaption", "figure", "footer",
  "form", "h1", "h2", "h3", "h4", "h5", "h6", "header", "hr", "li", "main", "nav", "ol", "p", "pre", "section",
  "table", "tbody", "td", "th", "thead", "tr", "ul",
]);
const HIDDEN_STYLE =
  /display\s*:\s*none|visibility\s*:\s*hidden|opacity\s*:\s*0*(?:\.0+)?\s*(?:;|!|$)|font-size\s*:\s*0+(?:\.0+)?(?:px|em|rem|pt|%)?\s*(?:;|!|$)/i;

function isSpace(code: number): boolean {
  return code === 0x20 || code === 0x09 || code === 0x0a || code === 0x0c || code === 0x0d;
}

function isHidden(attrs: Attrs): boolean {
  if (attrs.has("hidden")) return true;
  if ((attrs.get("aria-hidden") ?? "").trim().toLowerCase() === "true") return true;
  const style = attrs.get("style");
  return style !== undefined && HIDDEN_STYLE.test(style);
}

/** Reads attributes from `from` to the closing '>' (quotes respected). */
function readAttributes(html: string, from: number): { attrs: Attrs; end: number; selfClosing: boolean } {
  const attrs: Attrs = new Map();
  const len = html.length;
  let k = from;
  let selfClosing = false;
  while (k < len) {
    let c = html.charCodeAt(k);
    while (k < len && (isSpace(c) || c === 0x2f /* / */)) {
      selfClosing = c === 0x2f;
      k++;
      c = html.charCodeAt(k);
    }
    if (k >= len) break;
    if (c === 0x3e /* > */) return { attrs, end: k + 1, selfClosing };
    selfClosing = false;
    const nameStart = k;
    while (k < len) {
      c = html.charCodeAt(k);
      if (isSpace(c) || c === 0x2f || c === 0x3e || (c === 0x3d /* = */ && k > nameStart)) break;
      k++;
    }
    const name = html.slice(nameStart, k).toLowerCase();
    while (k < len && isSpace(html.charCodeAt(k))) k++;
    let value = "";
    if (html.charCodeAt(k) === 0x3d) {
      k++;
      while (k < len && isSpace(html.charCodeAt(k))) k++;
      const quote = html.charCodeAt(k);
      if (quote === 0x22 || quote === 0x27) {
        const close = html.indexOf(quote === 0x22 ? '"' : "'", k + 1);
        const stop = close < 0 ? len : close;
        value = html.slice(k + 1, Math.min(stop, k + 1 + MAX_ATTR_CHARS));
        k = close < 0 ? len : close + 1;
      } else {
        const valueStart = k;
        while (k < len) {
          c = html.charCodeAt(k);
          if (isSpace(c) || c === 0x3e) break;
          k++;
        }
        value = html.slice(valueStart, Math.min(k, valueStart + MAX_ATTR_CHARS));
      }
    }
    if (name && attrs.size < MAX_ATTRS && !attrs.has(name)) attrs.set(name, value);
  }
  return { attrs, end: len, selfClosing };
}

function scanHtml(html: string): Scan {
  const scan: Scan = { title: null, metas: [], links: [], images: [], jsonLd: [], baseHref: null, text: "" };
  const len = html.length;
  const textParts: string[] = [];
  let textLength = 0;
  // The outermost element whose text is not page text (hidden, or NO_TEXT);
  // nested elements of the same name are counted so the right close ends it.
  let quiet: { name: string; depth: number } | null = null;
  let tags = 0;

  const pushText = (raw: string) => {
    if (quiet || textLength >= MAX_TEXT_COLLECT || raw.length === 0) return;
    const decoded = decodeEntities(raw);
    textParts.push(decoded);
    textLength += decoded.length;
  };
  const pushBreak = () => {
    if (!quiet && textLength < MAX_TEXT_COLLECT) textParts.push("\n");
  };

  let i = 0;
  while (i < len) {
    const lt = html.indexOf("<", i);
    if (lt < 0) {
      pushText(html.slice(i));
      break;
    }
    if (lt > i) pushText(html.slice(i, lt));
    if (++tags > MAX_TAGS) break;

    if (html.startsWith("<!--", lt)) {
      const end = html.indexOf("-->", lt + 4);
      i = end < 0 ? len : end + 3;
      continue;
    }
    const next = html.charCodeAt(lt + 1);
    if (next === 0x21 /* ! */ || next === 0x3f /* ? */) {
      const end = html.indexOf(">", lt);
      i = end < 0 ? len : end + 1;
      continue;
    }
    const closing = next === 0x2f;
    const nameStart = lt + (closing ? 2 : 1);
    const first = html.charCodeAt(nameStart);
    const isLetter = (first >= 0x41 && first <= 0x5a) || (first >= 0x61 && first <= 0x7a);
    if (!isLetter) {
      pushText("<");
      i = lt + 1;
      continue;
    }
    let j = nameStart;
    while (j < len) {
      const c = html.charCodeAt(j);
      if (isSpace(c) || c === 0x2f || c === 0x3e) break;
      j++;
    }
    const name = html.slice(nameStart, j).toLowerCase();
    const { attrs, end, selfClosing } = readAttributes(html, j);
    i = end;

    if (closing) {
      if (quiet && quiet.name === name && --quiet.depth === 0) quiet = null;
      if (BLOCK.has(name)) pushBreak();
      continue;
    }

    if (BLOCK.has(name)) pushBreak();
    if (quiet && quiet.name === name && !selfClosing && !VOID.has(name)) quiet.depth++;
    else if (!quiet && !VOID.has(name) && !selfClosing && (NO_TEXT.has(name) || isHidden(attrs))) {
      quiet = { name, depth: 1 };
    }

    if (name === "meta") scan.metas.push(attrs);
    else if (name === "link") scan.links.push(attrs);
    else if (name === "img" || name === "source") scan.images.push({ tag: name, attrs, order: scan.images.length });
    else if (name === "base" && scan.baseHref === null && attrs.has("href")) scan.baseHref = attrs.get("href") ?? null;

    if (RAW_TEXT.has(name) && !selfClosing) {
      const closer = new RegExp(`</${name}[\\s/>]`, "gi");
      closer.lastIndex = i;
      const found = closer.exec(html);
      const contentEnd = found ? found.index : len;
      const content = html.slice(i, contentEnd);
      if (name === "script") {
        const type = (attrs.get("type") ?? "").split(";")[0].trim().toLowerCase();
        if (type === "application/ld+json" && scan.jsonLd.length < MAX_JSONLD_BLOCKS && content.length <= MAX_JSONLD_CHARS) {
          scan.jsonLd.push(content);
        }
      } else if (name === "title" && scan.title === null && !quiet) {
        scan.title = content;
      } else if (name === "textarea") {
        pushText(content);
      }
      if (found) {
        const gt = html.indexOf(">", found.index);
        i = gt < 0 ? len : gt + 1;
      } else {
        i = len;
      }
      if (quiet && quiet.name === name && --quiet.depth === 0) quiet = null;
    }
  }
  scan.text = textParts.join("");
  return scan;
}

// ---------------------------------------------------------------------------
// URLs
// ---------------------------------------------------------------------------

const SKIP_EXTENSIONS = /\.(svgz?|gif|ico)$/i;

function absoluteImageUrl(raw: string | undefined, base: URL | null): string | null {
  if (!raw) return null;
  const value = decodeEntities(raw).trim();
  if (!value || value.length > MAX_URL_CHARS) return null;
  if (/^(data|blob|javascript|about|file):/i.test(value)) return null;
  let url: URL;
  try {
    url = base ? new URL(value, base) : new URL(value);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  if (SKIP_EXTENSIONS.test(url.pathname)) return null;
  // safe-fetch upgrades http to https, so the two spellings are one fetch:
  // write them the same way and they deduplicate (og:image vs secure_url).
  if (url.protocol === "http:") {
    const port = url.port;
    url.protocol = "https:";
    if (port === "80") url.port = "";
  }
  url.hash = "";
  return url.href.length > MAX_URL_CHARS ? null : url.href;
}

export interface SrcsetEntry {
  url: string;
  width: number | null;
  density: number | null;
}

/** Parses a srcset the way browsers do (commas inside URLs survive; descriptors are w or x). */
export function parseSrcset(value: string): SrcsetEntry[] {
  const out: SrcsetEntry[] = [];
  const len = value.length;
  let i = 0;
  while (i < len && out.length < MAX_SRCSET_ENTRIES) {
    while (i < len && (isSpace(value.charCodeAt(i)) || value.charAt(i) === ",")) i++;
    if (i >= len) break;
    const start = i;
    while (i < len && !isSpace(value.charCodeAt(i))) i++;
    let url = value.slice(start, i);
    let descriptors = "";
    if (url.endsWith(",")) {
      url = url.replace(/,+$/, "");
    } else {
      const descStart = i;
      let inParens = false;
      while (i < len) {
        const ch = value.charAt(i);
        if (ch === "(") inParens = true;
        else if (ch === ")") inParens = false;
        else if (ch === "," && !inParens) break;
        i++;
      }
      descriptors = value.slice(descStart, i).trim();
      i++;
    }
    if (!url) continue;
    let width: number | null = null;
    let density: number | null = null;
    for (const token of descriptors.split(/\s+/)) {
      const w = /^(\d+)w$/i.exec(token);
      const x = /^(\d*\.?\d+)x$/i.exec(token);
      if (w) width = parseInt(w[1], 10);
      else if (x) density = parseFloat(x[1]);
    }
    out.push({ url, width, density });
  }
  return out;
}

function pixels(value: string | undefined): number {
  if (!value) return 0;
  const m = /^\s*(\d{1,5})(?:\.\d+)?\s*(?:px)?\s*$/i.exec(value);
  return m ? parseInt(m[1], 10) : 0;
}

/** The biggest entry of a srcset and the longest side it implies (0 when unknown). */
function largestFromSrcset(value: string | undefined, attrHint: number): { url: string; hint: number } | null {
  if (!value) return null;
  const entries = parseSrcset(decodeEntities(value));
  if (entries.length === 0) return null;
  let best: { url: string; hint: number; score: number } | null = null;
  for (const entry of entries) {
    const hint = entry.width ?? (entry.density && attrHint ? Math.round(entry.density * attrHint) : 0);
    const score = entry.width ?? (entry.density ?? 1) * 1_000_000; // density-only sets rank by density
    if (!best || score > best.score) best = { url: entry.url, hint, score };
  }
  return best ? { url: best.url, hint: best.hint } : null;
}

// ---------------------------------------------------------------------------
// JSON-LD
// ---------------------------------------------------------------------------

type JsonObject = Record<string, unknown>;

function isObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseJsonLoose(raw: string): unknown {
  let s = raw.trim();
  s = s.replace(/^<!--/, "").replace(/-->$/, "").trim();
  s = s.replace(/^(\/\/\s*)?<!\[CDATA\[/, "").replace(/(\/\/\s*)?\]\]>$/, "").trim();
  if (!s) return undefined;
  const attempts = [
    s,
    // Raw newlines and tabs inside strings are common (pasted descriptions) and invalid JSON.
    s.replace(/[\u0000-\u001f]+/g, " "),
    // Trailing commas.
    s.replace(/[\u0000-\u001f]+/g, " ").replace(/,\s*([}\]])/g, "$1"),
  ];
  for (const attempt of attempts) {
    try {
      return JSON.parse(attempt);
    } catch {
      /* next */
    }
  }
  return undefined;
}

const PRODUCT_TYPES = new Set(["product", "productgroup", "individualproduct", "productmodel", "someproducts"]);

function typeNames(value: unknown): string[] {
  const list = Array.isArray(value) ? value : [value];
  return list
    .filter((v): v is string => typeof v === "string")
    .map((v) => v.replace(/^https?:\/\/schema\.org\//i, "").replace(/^schema:/i, "").toLowerCase());
}

function isProductNode(node: JsonObject): boolean {
  return typeNames(node["@type"]).some((t) => PRODUCT_TYPES.has(t));
}

/** JSON-LD nodes by their @id, for following {"@id": ...} references. */
type JsonIds = ReadonlyMap<string, JsonObject>;
const NO_IDS: JsonIds = new Map();

/** {"@id": "..."} (a @type at most): a pointer to a node described elsewhere, not a node. */
function isReference(node: JsonObject): boolean {
  return Object.keys(node).every((key) => key === "@id" || key === "@type");
}

/**
 * The node a {"@id": ...} value points at, else null. In the @graph form
 * (Yoast, WooCommerce) a Product's image is {"@id": "<page>#primaryimage"}
 * and the picture's own url sits on an ImageObject elsewhere in the graph.
 */
function follow(value: JsonObject, ids: JsonIds): JsonObject | null {
  const id = value["@id"];
  if (typeof id !== "string") return null;
  const target = ids.get(id.trim());
  return target && target !== value ? target : null;
}

/**
 * Product-typed nodes, breadth-first (a page's own product before products
 * it merely mentions), and every described node by its @id (the first one
 * wins; a bare reference is never indexed).
 */
function walkJsonLd(roots: unknown[]): { products: JsonObject[]; ids: Map<string, JsonObject> } {
  const found: JsonObject[] = [];
  const ids = new Map<string, JsonObject>();
  const queue: Array<{ node: unknown; depth: number }> = roots.map((node) => ({ node, depth: 0 }));
  let head = 0;
  while (head < queue.length && head < MAX_JSON_NODES) {
    const { node, depth } = queue[head++];
    if (Array.isArray(node)) {
      if (depth >= MAX_JSON_DEPTH) continue;
      for (const child of node.slice(0, MAX_JSON_CHILDREN)) {
        if (typeof child === "object" && child !== null) queue.push({ node: child, depth: depth + 1 });
      }
    } else if (isObject(node)) {
      if (isProductNode(node)) found.push(node);
      const id = node["@id"];
      if (typeof id === "string" && id.trim() && !isReference(node) && !ids.has(id.trim())) ids.set(id.trim(), node);
      if (depth >= MAX_JSON_DEPTH) continue;
      let children = 0;
      for (const key of Object.keys(node)) {
        const child = node[key];
        if (typeof child === "object" && child !== null) {
          queue.push({ node: child, depth: depth + 1 });
          if (++children >= MAX_JSON_CHILDREN) break;
        }
      }
    }
  }
  return { products: found, ids };
}

function jsonText(value: unknown, max: number, ids: JsonIds = NO_IDS, depth = 0): string | null {
  if (depth > 4) return null;
  if (Array.isArray(value)) {
    for (const item of value.slice(0, 10)) {
      const text = jsonText(item, max, ids, depth + 1);
      if (text) return text;
    }
    return null;
  }
  if (typeof value === "string") return cleanLine(value, max);
  if (typeof value === "number" && Number.isFinite(value)) return cleanLine(String(value), max);
  if (isObject(value)) {
    // A Brand / Organization / language-tagged value, or a reference to one.
    const own = value.name ?? value["@value"];
    if (own !== undefined && own !== null) return jsonText(own, max, ids, depth + 1);
    const target = follow(value, ids);
    return target ? jsonText(target, max, ids, depth + 1) : null;
  }
  return null;
}

function jsonCode(value: unknown): string | null {
  const text = jsonText(value, 64);
  if (!text) return null;
  const code = text.replace(/[^A-Za-z0-9._/-]+/g, "");
  return code.length > 0 ? code : null;
}

function jsonGtin(node: JsonObject): string | null {
  for (const key of ["gtin", "gtin13", "gtin14", "gtin12", "gtin8", "isbn"]) {
    const text = jsonText(node[key], 64);
    if (!text) continue;
    const digits = text.replace(/[\s-]/g, "");
    if (/^\d{8,14}$/.test(digits)) return digits;
  }
  return null;
}

/**
 * A node's picture URLs. An ImageObject gives its contentUrl or url; a
 * {"@id": ...} reference is followed to the node it names. An @id is a
 * NAME, never a picture: used as one, "<page>#primaryimage" became the page
 * itself (its fragment dropped), fetched as a picture and refused (review F3).
 */
function jsonImages(value: unknown, base: URL | null, out: string[], ids: JsonIds = NO_IDS, depth = 0): void {
  if (out.length >= MAX_PRODUCT_IMAGES || depth > 4 || value === null || value === undefined) return;
  if (typeof value === "string") {
    const url = absoluteImageUrl(value, base);
    if (url && !out.includes(url)) out.push(url);
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value.slice(0, MAX_PRODUCT_IMAGES * 2)) jsonImages(item, base, out, ids, depth + 1);
    return;
  }
  if (isObject(value)) {
    const own = value.contentUrl ?? value.url;
    if (own !== undefined && own !== null) {
      jsonImages(own, base, out, ids, depth + 1);
      return;
    }
    const target = follow(value, ids);
    if (target) jsonImages(target, base, out, ids, depth + 1);
  }
}

function productFromNode(node: JsonObject, base: URL | null, ids: JsonIds = NO_IDS): ProductData {
  const images: string[] = [];
  jsonImages(node.image, base, images, ids);
  if (images.length === 0 && Array.isArray(node.hasVariant)) {
    for (const variant of node.hasVariant.slice(0, 10)) {
      const described = isObject(variant) ? (isReference(variant) ? follow(variant, ids) : variant) : null;
      if (described) jsonImages(described.image, base, images, ids);
    }
  }
  return {
    name: jsonText(node.name, 200, ids),
    brand: jsonText(node.brand, 100, ids) ?? jsonText(node.manufacturer, 100, ids),
    description: jsonText(node.description, 1_000, ids),
    sku: jsonCode(node.sku),
    gtin: jsonGtin(node),
    mpn: jsonCode(node.mpn),
    images,
  };
}

function extractProduct(blocks: string[], base: URL | null): ProductData | null {
  try {
    const roots = blocks.map(parseJsonLoose).filter((v) => v !== undefined);
    const { products: nodes, ids } = walkJsonLd(roots);
    if (nodes.length === 0) return null;
    const chosen = nodes.find((n) => jsonText(n.name, 200, ids) !== null) ?? nodes[0];
    return productFromNode(chosen, base, ids);
  } catch {
    // Belt and braces: a page's JSON must never cost the rest of the card.
    return null;
  }
}

// ---------------------------------------------------------------------------
// The page
// ---------------------------------------------------------------------------

interface RankedCandidate extends ImageCandidate {
  order: number;
}

const TIER: Readonly<Record<ImageSource, number>> = { product_data: 0, social: 1, page: 2 };

function metaKey(attrs: Attrs): string {
  return (attrs.get("property") ?? attrs.get("name") ?? attrs.get("itemprop") ?? "").trim().toLowerCase();
}

/**
 * Reads a product page. Never throws. Everything returned is untrusted; only
 * `fencedText` may be handed to a model, and only as the data block it is.
 */
export function extractProductPage(html: string, baseUrl: string): ExtractedProductPage {
  const source = typeof html === "string" ? (html.length > MAX_HTML_CHARS ? html.slice(0, MAX_HTML_CHARS) : html) : "";
  let pageUrl: URL | null = null;
  try {
    pageUrl = new URL(baseUrl);
  } catch {
    pageUrl = null;
  }
  const scan = scanHtml(source);

  let base = pageUrl;
  if (scan.baseHref) {
    try {
      const candidate = pageUrl ? new URL(decodeEntities(scan.baseHref).trim(), pageUrl) : new URL(decodeEntities(scan.baseHref).trim());
      if (candidate.protocol === "https:" || candidate.protocol === "http:") base = candidate;
    } catch {
      /* keep the page URL */
    }
  }

  const product = extractProduct(scan.jsonLd, base);

  // OpenGraph / Twitter / meta description.
  const og: OpenGraphData = { title: null, description: null, siteName: null, type: null, brand: null, images: [] };
  let metaDescription: string | null = null;
  const candidates = new Map<string, RankedCandidate>();
  let order = 0;
  const add = (url: string | null, from: ImageSource, sizeHint: number) => {
    if (!url) return;
    const existing = candidates.get(url);
    if (existing) {
      if (TIER[from] < TIER[existing.source]) existing.source = from;
      existing.sizeHint = Math.max(existing.sizeHint, sizeHint);
      return;
    }
    candidates.set(url, { url, source: from, sizeHint, order: order++ });
  };

  for (const url of product?.images ?? []) add(url, "product_data", 0);

  // og:image:width / height describe the og:image just before them.
  let lastOg: RankedCandidate | null = null;
  for (const attrs of scan.metas) {
    const key = metaKey(attrs);
    const content = attrs.get("content");
    if (!key || content === undefined) continue;
    switch (key) {
      case "og:title":
        og.title ??= cleanLine(content, 300);
        break;
      case "og:description":
        og.description ??= cleanLine(content, 1_000);
        break;
      case "og:site_name":
        og.siteName ??= cleanLine(content, 100);
        break;
      case "og:type":
        og.type ??= cleanLine(content, 50);
        break;
      case "product:brand":
      case "og:brand":
        og.brand ??= cleanLine(content, 100);
        break;
      case "description":
        metaDescription ??= cleanLine(content, 1_000);
        break;
      case "og:image":
      case "og:image:url":
      case "og:image:secure_url": {
        const url = absoluteImageUrl(content, base);
        if (!url) break;
        if (!og.images.includes(url)) og.images.push(url);
        add(url, "social", 0);
        lastOg = candidates.get(url) ?? null;
        break;
      }
      case "og:image:width":
      case "og:image:height":
        if (lastOg) lastOg.sizeHint = Math.max(lastOg.sizeHint, pixels(content));
        break;
      case "twitter:image":
      case "twitter:image:src":
        add(absoluteImageUrl(content, base), "social", 0);
        break;
      default:
        break;
    }
  }

  for (const attrs of scan.links) {
    const rel = (attrs.get("rel") ?? "").toLowerCase().split(/\s+/);
    if (rel.includes("image_src")) add(absoluteImageUrl(attrs.get("href"), base), "social", 0);
  }

  for (const image of scan.images) {
    const a = image.attrs;
    if (image.tag === "source") {
      const type = (a.get("type") ?? "").toLowerCase();
      if (type && !/^image\/(jpeg|jpg|png|webp|avif)$/.test(type)) continue;
    }
    const attrHint = Math.max(pixels(a.get("width")), pixels(a.get("height")));
    const fromDataSrcset = largestFromSrcset(a.get("data-srcset"), attrHint);
    const fromSrcset = largestFromSrcset(a.get("srcset"), attrHint);
    const set = fromDataSrcset ?? fromSrcset;
    const zoom = a.get("data-zoom-image");
    const lazy = a.get("data-src") ?? a.get("data-lazy-src") ?? a.get("data-original");
    // One candidate per element, the best URL it offers: a zoom image, then
    // the largest srcset entry, then a lazy-loader's real source, then src.
    const zoomUrl = absoluteImageUrl(zoom, base);
    const setUrl = set ? absoluteImageUrl(set.url, base) : null;
    const lazyUrl = absoluteImageUrl(lazy, base);
    const srcUrl = absoluteImageUrl(a.get("src"), base);
    let url: string | null = null;
    let hint = 0;
    if (zoomUrl) {
      url = zoomUrl;
      hint = Math.max(attrHint, set?.hint ?? 0);
    } else if (setUrl) {
      url = setUrl;
      hint = set?.hint || attrHint;
    } else {
      url = lazyUrl ?? srcUrl;
      hint = attrHint;
    }
    if (!url) continue;
    if (hint > 0 && hint < MIN_IMAGE_HINT) continue; // an icon or a tracking pixel
    add(url, "page", hint);
  }

  const ranked = [...candidates.values()]
    .sort((x, y) => TIER[x.source] - TIER[y.source] || y.sizeHint - x.sizeHint || x.order - y.order)
    .slice(0, MAX_IMAGE_CANDIDATES)
    .map(({ url, source: from, sizeHint }) => ({ url, source: from, sizeHint }));

  const title = scan.title === null ? null : cleanLine(scan.title, 300);
  const name = product?.name ?? og.title ?? title;
  const brand = product?.brand ?? og.brand ?? null;
  const description = product?.description ?? og.description ?? metaDescription;

  const lines: string[] = [];
  if (name) lines.push(`Product name: ${name}`);
  if (brand) lines.push(`Brand: ${brand}`);
  if (title && title !== name) lines.push(`Page title: ${title}`);
  if (description) lines.push(`Description: ${description}`);
  const visible = normalizeBlock(scan.text);
  if (visible) lines.push("", visible);
  const pageText = normalizeBlock(lines.join("\n"));
  const host = pageUrl?.hostname ?? "unknown";

  return {
    url: pageUrl?.href ?? "",
    host,
    product,
    openGraph: og,
    title,
    metaDescription,
    name,
    brand,
    description,
    images: ranked,
    imageUrls: ranked.map((c) => c.url),
    fencedText: fenceUntrusted(pageText, host, FENCE_MAX_CHARS),
    truncated: pageText.length > FENCE_MAX_CHARS,
  };
}
