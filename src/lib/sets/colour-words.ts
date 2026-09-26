// A block's colour as one of fifteen words (Helios Cut 2, step 5; moved here
// in Helios Cut 4, step B2, 2026-09-26). A leaf module that imports
// nothing: the set's things are named by their colour on screen
// (elements.ts labelOf), in the chat reader (reader-context.ts) and in a
// still's words later (step B5), and elements.ts could not import the
// reader's module, which imports it (critic item 6).
//
// Pure, relative imports only (none).

/** Colour words, one per thing: the model reads them in English, the page says them in the person's language (spec §5.4). */
export const COLOUR_IDS = ["red", "orange", "yellow", "olive", "green", "teal", "cyan", "blue", "navy", "purple", "pink", "brown", "black", "white", "grey"] as const;
export type ColourId = (typeof COLOUR_IDS)[number];

const wrapDeg = (d: number) => ((d % 360) + 360) % 360;

/**
 * A block's colour as one of fifteen words: nearest by hue, with lightness
 * and saturation deciding black, white, grey, navy, olive and brown. The
 * garage's two red cars are both "red", which is why a "which one?" button
 * also says where each one is.
 */
export function colourWord(hex: string): ColourId {
  const m = /^#?([0-9a-f]{6}|[0-9a-f]{3})$/i.exec(hex.trim());
  if (!m) return "grey";
  const h6 = m[1].length === 3 ? m[1].replace(/./g, (c) => c + c) : m[1];
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(h6.slice(i, i + 2), 16) / 255);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const d = max - min;
  const s = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1));
  let hue = 0;
  if (d > 0) {
    if (max === r) hue = 60 * (((g - b) / d) % 6);
    else if (max === g) hue = 60 * ((b - r) / d + 2);
    else hue = 60 * ((r - g) / d + 4);
  }
  hue = wrapDeg(hue);

  if (l < 0.1) return "black";
  if (l > 0.93) return "white";
  if (s < 0.15) return l < 0.2 ? "black" : l > 0.85 ? "white" : "grey";
  if (hue < 15 || hue >= 345) return l > 0.75 ? "pink" : "red";
  if (hue < 45) return l < 0.4 || (s < 0.8 && l < 0.65) ? "brown" : "orange";
  if (hue < 90) return l < 0.35 || (s < 0.45 && l < 0.5) ? "olive" : hue < 70 ? "yellow" : "green";
  if (hue < 160) return "green";
  if (hue < 185) return "teal";
  if (hue < 200) return "cyan";
  if (hue < 250) return l < 0.3 ? "navy" : "blue";
  if (hue < 290) return "purple";
  return "pink";
}
