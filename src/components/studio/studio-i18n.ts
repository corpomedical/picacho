// Helios Studio's translator (stage 7). The engine stays plain DOM and
// writes its English; this module turns every text node and every title,
// placeholder and aria-label under the Studio into the person's language —
// once on start, then as the engine draws (a MutationObserver), the way
// Blender translates by the English text itself. Rows live in
// studio-text.ts. Text the person wrote, object names and Astra's code are
// marked translate="no" by the engine and left as they are.

import type { Locale } from "@/lib/i18n/locales";
import { STUDIO_TEXT } from "./studio-text";

const COL: Record<Locale, 0 | 1 | 2 | 3> = { en: 0, es: 1, pt: 2, it: 3 };
const escRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** A number as the locale writes it ("3.25" → "3,25"; "18,304" → "18.304"). Keeps the decimals it had. */
export function localNumber(s: string, locale: Locale): string {
  if (locale === "en" || !/^[−-]?\d{1,3}(,\d{3})*(\.\d+)?$|^[−-]?\d+(\.\d+)?$/.test(s)) return s;
  const neg = /^[−-]/.test(s), body = s.replace(/^[−-]/, "").replace(/,/g, "");
  const dec = body.includes(".") ? body.split(".")[1].length : 0;
  const out = new Intl.NumberFormat(locale, { minimumFractionDigits: dec, maximumFractionDigits: dec, useGrouping: body.length > 4 }).format(Number(body));
  return (neg ? s[0] : "") + out;
}

export type StudioTranslate = (text: string) => string;

/**
 * The translator for one locale: exact rows first, then the patterns (rows
 * with {0}…), whose values are translated themselves when they are a row
 * ("Undo · Insert keyframe"), otherwise written as the locale writes
 * numbers. A number with a unit on its own ("1.00 kg", "0.25 m") follows the
 * locale too. English, or text with no row, comes back as it was.
 */
export function studioTranslator(locale: Locale): StudioTranslate {
  const col = COL[locale] ?? 0;
  if (col === 0) return (s) => s;
  const exact = new Map<string, string>();
  const patterns: { re: RegExp; to: string }[] = [];
  for (const row of STUDIO_TEXT) {
    // Keys are matched with runs of spaces flattened, as the text they meet is.
    const key = row[0].replace(/\s+/g, " ");
    if (/\{\d\}/.test(key)) patterns.push({ re: new RegExp("^" + escRe(key).replace(/\\\{(\d)\\\}/g, "(?<g$1>.+?)") + "$"), to: row[col] });
    else exact.set(key, row[col]);
  }
  // The longest pattern first, so "Edit Mode · {0} (its main mesh) · …" wins over "Edit Mode · {0} · …".
  patterns.sort((a, b) => b.re.source.length - a.re.source.length);
  const unit = /^([−-]?[\d,]+(?:\.\d+)?)(\s?)(m|mm|kg|fps|m\/s²|°|%|s)$/;
  const tr = (s: string, depth = 0): string => {
    const hit = exact.get(s);
    if (hit !== undefined) return hit;
    const u = s.match(unit);
    if (u) return localNumber(u[1], locale) + u[2] + u[3];
    if (/^[−-]?\d+\.\d+$/.test(s)) return localNumber(s, locale);
    if (depth > 1) return localNumber(s, locale);
    for (const p of patterns) {
      const m = s.match(p.re);
      if (!m || !m.groups) continue;
      const g = m.groups;
      return p.to.replace(/\{(\d)\}/g, (_, n: string) => (g["g" + n] === undefined ? "" : tr(g["g" + n], depth + 1)));
    }
    return depth > 0 ? localNumber(s, locale) : s;
  };
  // Lookups ignore runs of spaces (the markup and the engine pad some lines with two).
  return (s) => {
    const flat = s.replace(/\s+/g, " ");
    const out = tr(flat);
    return out === flat ? s : out;
  };
}

const ATTRS = ["title", "placeholder", "aria-label"] as const;

/**
 * Translates everything under `root` now and whatever the engine draws
 * later. Returns the stop function. Leading and trailing spaces of a text
 * node are kept; a subtree marked translate="no" is left alone.
 */
export function watchStudioText(root: HTMLElement, tr: StudioTranslate): () => void {
  const done = new WeakMap<Node, string>();
  const skip = (el: Element | null) => !!el?.closest("[translate=no],script,style,textarea");
  const text = (n: Text) => {
    const v = n.nodeValue ?? "";
    if (done.get(n) === v || skip(n.parentElement)) return;
    const t = v.trim();
    if (!t || !/[A-Za-z0-9]/.test(t)) return;
    const out = tr(t);
    if (out !== t) {
      const next = v.slice(0, v.indexOf(t)) + out + v.slice(v.indexOf(t) + t.length);
      done.set(n, next);
      n.nodeValue = next;
    } else done.set(n, v);
  };
  const attrs = (el: Element) => {
    if (el.closest("[translate=no]")) return;
    for (const a of ATTRS) {
      const v = el.getAttribute(a);
      if (!v) continue;
      const out = tr(v.trim());
      if (out !== v.trim()) el.setAttribute(a, out);
    }
  };
  const walk = (node: Node) => {
    if (node.nodeType === 3) return text(node as Text);
    if (node.nodeType !== 1) return;
    const el = node as Element;
    if (skip(el)) return;
    attrs(el);
    const w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT);
    let n: Node | null = w.nextNode();
    while (n) {
      if (n.nodeType === 3) text(n as Text);
      else attrs(n as Element);
      n = w.nextNode();
    }
  };
  walk(root);
  const mo = new MutationObserver((records) => {
    for (const r of records) {
      if (r.type === "characterData") text(r.target as Text);
      else if (r.type === "attributes") attrs(r.target as Element);
      else r.addedNodes.forEach(walk);
    }
  });
  mo.observe(root, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: [...ATTRS] });
  return () => mo.disconnect();
}
