// A template filled in one pass (Helios Cut 2, step 8, 2026-09-25; moved
// here in the review of Cut 2, W4). Pure, no imports: the chat's reply
// (turn-reply.ts) and the Astra card's sentence (astra-card.ts) both fill
// the person's own words into a catalog string, and must never read them
// back — formatMsg's replaceAll reads "$'", "$&" and "$$" in a value as
// patterns, so "make the sign read '$'" came back misquoted on the one card
// that asks to spend a monthly change.

/**
 * A template filled in ONE pass: each {key} is replaced by its value, and a
 * value is never read again — so a name, a quote or an idea holding "{n}"
 * or "$&" stays as written. Unknown keys stay as they are (a test finds them).
 */
export function fill(template: string, vars: Record<string, string | number>): string {
  let out = "";
  let at = 0;
  while (at < template.length) {
    const open = template.indexOf("{", at);
    const close = open < 0 ? -1 : template.indexOf("}", open);
    if (open < 0 || close < 0) {
      out += template.slice(at);
      break;
    }
    const key = template.slice(open + 1, close);
    out += template.slice(at, open);
    out += Object.prototype.hasOwnProperty.call(vars, key) ? String(vars[key]) : template.slice(open, close + 1);
    at = close + 1;
  }
  return out;
}
