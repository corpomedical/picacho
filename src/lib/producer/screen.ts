// What Aly sees of the person's screen, and how she points at one thing on
// it (operator, 2026-09-29: "Give her the power to help the user as you do,
// and switch between pages" → "Guide + drive").
//
// read_screen: the lamp sends a short text reading of the page with every
// message (readScreen below): the address, the headings, the buttons, tabs,
// links and field labels, an open dialog, what is selected. It enters the
// conversation only when she calls read_screen, so a message she answers
// without it costs nothing more. What people TYPE into fields is never read:
// a field is named by its label, never by its value.
//
// open_page's point_at: the browser finds the control whose words match
// (bestControl) and rings it (components/producer/aly-pointer.tsx).
//
// The DOM walk runs in the browser only; the matching and the server's
// cleaning are pure, so they are tested without a page.

/** Aly's own interface (the lamp, its sheet, the subtitles): never part of the screen she reads. */
export const ALY_UI_ATTR = "data-aly-ui";

/** The event open_page raises in the browser; aly-pointer.tsx listens. */
export const ALY_POINT_EVENT = "picacho:aly-point";
export type AlyPointDetail = { href: string; words: string | null };

const MAX_SCREEN = 4000;

/** The lamp's reading, as the server keeps it: text only, capped, no control characters. */
export function cleanScreen(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const text = raw
    .replace(/[\u0000-\u0008\u000b-\u001f\u007f]+/g, " ")
    .replace(/[ \t]+/g, " ")
    .trim()
    .slice(0, MAX_SCREEN);
  return text || null;
}

/** Words as they're compared: lower case, no accents, single spaces, no punctuation at the ends. */
export function normWords(s: string): string {
  return s
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/^[\s·•:,.→>()\-]+|[\s·•:,.→>()\-]+$/g, "")
    .trim();
}

export type ControlCandidate = { name: string; interactive: boolean };

/**
 * Which candidate the words mean: the same words beats starting with them,
 * which beats containing them; a button or tab beats a heading with the same
 * words; then the shortest name (the most specific element). -1 for none.
 */
export function bestControl(candidates: readonly ControlCandidate[], words: string): number {
  const want = normWords(words);
  if (!want) return -1;
  let best = -1;
  let bestScore = 0;
  let bestLen = Infinity;
  candidates.forEach((c, i) => {
    const name = normWords(c.name);
    if (!name) return;
    let score = 0;
    if (name === want) score = 30;
    else if (name.startsWith(want)) score = 20;
    else if (name.includes(want)) score = 10;
    else if (name.length >= 3 && want.includes(name)) score = 5;
    if (!score) return;
    if (c.interactive) score += 2;
    if (score > bestScore || (score === bestScore && name.length < bestLen)) {
      best = i;
      bestScore = score;
      bestLen = name.length;
    }
  });
  return best;
}

// ---------------------------------------------------------------------------
// Browser only.

const CONTROLS =
  'button, a[href], [role="button"], [role="tab"], [role="menuitem"], [role="link"], [role="switch"], [role="checkbox"], [role="radio"], [role="option"], summary, select';
const POINTABLE = `${CONTROLS}, label, h1, h2, h3, h4, legend, [aria-label]`;

function squash(s: string | null | undefined, max = 80): string {
  return (s ?? "").replace(/\s+/g, " ").trim().slice(0, max);
}

function visible(el: Element): boolean {
  if (el.closest(`[${ALY_UI_ATTR}]`) || el.closest("[aria-hidden='true'], [hidden], [inert]")) return false;
  const r = el.getBoundingClientRect();
  if (r.width < 2 || r.height < 2) return false;
  const style = window.getComputedStyle(el);
  return style.visibility !== "hidden" && style.display !== "none" && Number(style.opacity) > 0.05;
}

/** An element's name as a person reads it: its label, never a value typed into it. */
function nameOf(el: Element): string {
  const aria = el.getAttribute("aria-label");
  if (aria) return squash(aria);
  const labelledBy = el.getAttribute("aria-labelledby");
  if (labelledBy) {
    const text = labelledBy
      .split(/\s+/)
      .map((id) => document.getElementById(id)?.textContent ?? "")
      .join(" ");
    if (squash(text)) return squash(text);
  }
  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement) {
    const label = el.id ? document.querySelector(`label[for="${CSS.escape(el.id)}"]`)?.textContent : null;
    return squash(label || el.closest("label")?.textContent || el.getAttribute("placeholder") || el.name);
  }
  return squash((el as HTMLElement).innerText ?? el.textContent);
}

function stateOf(el: Element): string {
  const bits: string[] = [];
  const checked = el.getAttribute("aria-checked") ?? (el instanceof HTMLInputElement && /checkbox|radio/.test(el.type) ? String(el.checked) : null);
  if (checked === "true") bits.push("on");
  if (checked === "false") bits.push("off");
  if (el.getAttribute("aria-pressed") === "true") bits.push("pressed");
  if (el.getAttribute("aria-selected") === "true" || el.getAttribute("aria-current")) bits.push("selected");
  if (el.getAttribute("aria-expanded") === "true") bits.push("open");
  if (el.hasAttribute("disabled") || el.getAttribute("aria-disabled") === "true") bits.push("disabled");
  return bits.length ? ` (${bits.join(", ")})` : "";
}

function kindOf(el: Element): string {
  const role = el.getAttribute("role");
  if (role) return role;
  if (el.tagName === "A") return "link";
  if (el.tagName === "SELECT") return "menu";
  if (el instanceof HTMLInputElement) return el.type === "checkbox" ? "checkbox" : el.type === "radio" ? "radio" : "field";
  if (el.tagName === "TEXTAREA") return "field";
  return "button";
}

/** A short text reading of what is on the screen, for read_screen. */
export function readScreen(doc: Document = document): string {
  const lines: string[] = [`Page: ${location.pathname}${location.search} — "${squash(doc.title, 100)}"`];

  const dialog = Array.from(doc.querySelectorAll("[role='dialog'], [role='alertdialog'], dialog[open]")).find(visible);
  const root: ParentNode = dialog ?? doc;
  if (dialog) lines.push(`An open dialog covers the page: "${squash(nameOf(dialog) || dialog.querySelector("h1,h2,h3")?.textContent, 100)}". What follows is inside it.`);

  const headings = Array.from(root.querySelectorAll("h1, h2, h3"))
    .filter(visible)
    .map((h) => squash(h.textContent, 90))
    .filter(Boolean);
  if (headings.length) lines.push(`Headings: ${[...new Set(headings)].slice(0, 24).join(" | ")}`);

  const seen = new Set<string>();
  const controls: string[] = [];
  for (const el of Array.from(root.querySelectorAll(CONTROLS))) {
    if (controls.length >= 90 || !visible(el)) continue;
    const name = nameOf(el);
    if (!name) continue;
    const line = `${kindOf(el)} "${name}"${stateOf(el)}`;
    if (seen.has(line)) continue;
    seen.add(line);
    controls.push(line);
  }
  if (controls.length) lines.push(`Buttons, tabs and links: ${controls.join("; ")}`);

  const fields: string[] = [];
  for (const el of Array.from(root.querySelectorAll("input:not([type='hidden']):not([type='checkbox']):not([type='radio']), textarea"))) {
    if (fields.length >= 25 || !visible(el)) continue;
    const name = nameOf(el);
    // The label only: what they typed stays on their screen.
    if (name) fields.push(`"${name}"${(el as HTMLInputElement).value ? " (filled in)" : " (empty)"}`);
  }
  if (fields.length) lines.push(`Fields: ${fields.join("; ")}`);

  // Every piece of text in reading order, by the block it sits in — so a
  // number in a card ("18", "of 30 left") is read as well as a paragraph.
  const scope = dialog ?? doc.querySelector("main, [data-app-content]") ?? doc.body;
  const texts: string[] = [];
  const blocks = new Set<Element>();
  const walker = doc.createTreeWalker(scope, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node && texts.length < 70; node = walker.nextNode()) {
    if (!node.textContent?.trim()) continue;
    let el = node.parentElement;
    while (el && el !== scope && window.getComputedStyle(el).display.startsWith("inline")) el = el.parentElement;
    if (!el || blocks.has(el) || el.closest(`${CONTROLS}, h1, h2, h3, label, script, style, noscript`) || !visible(el)) continue;
    blocks.add(el);
    const t = squash((el as HTMLElement).innerText, 160);
    if (t && !texts.includes(t)) texts.push(t);
  }
  if (texts.length) lines.push(`Text on the page: ${texts.join(" / ")}`);

  return lines.join("\n").slice(0, MAX_SCREEN);
}

/** The element on the page that the words name, for the pointer's ring. */
export function findControl(words: string, doc: Document = document): HTMLElement | null {
  const els = Array.from(doc.querySelectorAll(POINTABLE)).filter(visible) as HTMLElement[];
  const i = bestControl(
    els.map((el) => ({ name: nameOf(el), interactive: el.matches(CONTROLS) })),
    words,
  );
  return i >= 0 ? els[i] : null;
}
