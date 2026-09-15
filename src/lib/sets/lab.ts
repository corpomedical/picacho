// The lab's darkroom (Helios, 2026-09-15): a set shot's cut still developed
// with the rig's lab looks (lab-grade.ts), and the frame before the lab —
// the NEGATIVE — kept beside it.
//
// WHY A NEGATIVE. Two readers must never see the lab. The likeness scorer:
// after the lab it read home video at 32 and Silver Print at 16 on a frame it
// read at 72 untouched, so the identity gate would re-render every graded
// still. And the look cutout: a still that lends its objects to later shots
// would hand them a Silver Print still's grey car. Both read the negative
// when there is one. It is a JPEG (about 0.28 MB for a Scope still) at
// `<user>/negatives/<file>.jpg` beside the still's `<user>/<file>.png`,
// removed with it (generations/actions.ts: the History delete and the
// identity gate's losing attempt), swept with the account's folder, and
// counted as referenced by the storage audit whenever its still is
// (scripts/lib/storage-references.mjs).
//
// Server-only (sharp). Relative imports only: tested as it is.

import sharp from "sharp";
import { fromBytes, labGrade, toBytes, type LabLooks } from "./lab-grade";
import { RIG_LENSES, RIG_STOCKS } from "./rig";

/** The negative's JPEG quality: a scorer's and a cutter's copy, not the delivered picture. */
export const NEGATIVE_JPEG_QUALITY = 92;

const STOCKS: readonly string[] = RIG_STOCKS.map((l) => l.id);
const LENSES: readonly string[] = RIG_LENSES.map((l) => l.id);

/**
 * The one door for the lab looks a request names (generations/actions.ts
 * `set_lab`): known ids only, and null when nothing is left for the lab to
 * do — the same rule as rig.ts labLooksOf.
 */
export function normaliseLabLooks(v: unknown): LabLooks | null {
  if (!v || typeof v !== "object" || Array.isArray(v)) return null;
  const o = v as Record<string, unknown>;
  const stock = typeof o.stock === "string" && STOCKS.includes(o.stock) && o.stock !== "digital" ? (o.stock as LabLooks["stock"]) : null;
  const lens = typeof o.lens === "string" && LENSES.includes(o.lens) && o.lens !== "clean" ? (o.lens as LabLooks["lens"]) : null;
  const silver = o.silver === true;
  if (!stock && !lens && !silver) return null;
  return { stock, lens, silver };
}

/** Where a still's negative lives: `<user>/<file>.png` → `<user>/negatives/<file>.jpg`; null for any other path. */
export function negativePathFor(stillPath: string): string | null {
  const m = /^([^/]+)\/([^/]+)\.png$/.exec(stillPath);
  return m ? `${m[1]}/negatives/${m[2]}.jpg` : null;
}

/**
 * Develop a cut still (PNG, base64) with the lab looks. The print is the
 * delivered picture (PNG, base64); the negative is the frame exactly as it
 * came in (JPEG). A picture sharp cannot read as colour comes back as it was.
 */
export async function develop(base64: string, looks: LabLooks): Promise<{ print: string; negative: Buffer }> {
  const input = Buffer.from(base64, "base64");
  const negative = await sharp(input).removeAlpha().jpeg({ quality: NEGATIVE_JPEG_QUALITY }).toBuffer();
  const { data, info } = await sharp(input).removeAlpha().toColourspace("srgb").raw().toBuffer({ resolveWithObject: true });
  if (info.channels !== 3) return { print: base64, negative };
  const graded = labGrade(fromBytes(info.width, info.height, data), looks);
  const print = await sharp(Buffer.from(toBytes(graded)), { raw: { width: info.width, height: info.height, channels: 3 } })
    .png()
    .toBuffer();
  return { print: print.toString("base64"), negative };
}

const STOCK_WORDS: Record<string, string> = { film35: "35 mm film", film16: "16 mm film", homevideo: "home video" };
const LENS_WORDS: Record<string, string> = { vintage: "a vintage lens", halation: "halation", anamorphic: "an anamorphic flare" };

/** The pipeline log's line for what the lab made, in plain words. */
export function labLine(looks: LabLooks): string {
  const parts = [
    looks.stock ? STOCK_WORDS[looks.stock] : null,
    looks.lens ? LENS_WORDS[looks.lens] : null,
    looks.silver ? "black and white" : null,
  ].filter(Boolean);
  return `Developed in the lab after the cut: ${parts.join(", ")}.`;
}

