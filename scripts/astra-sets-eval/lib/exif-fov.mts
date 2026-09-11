// Part E's ground truth: a photo's vertical field of view from its EXIF
// 35 mm-equivalent focal length, read from the photo's own EXIF when
// match.json leaves it out. Pure: the file is read by match-truth.mts.
//
// "35 mm equivalent" is defined on the DIAGONAL: a lens is called f35 when
// it gives the field of view that focal length gives on a 36 × 24 mm frame,
// whose diagonal is 43.27 mm. So the equivalent sensor height for an image
// of w × h pixels is 43.27 × h / √(w² + h²), and
//
//   vertical FOV = 2 · atan(hEq / (2 · f35))
//
// EXIF orientations 5–8 are rotated a quarter turn: width and height swap.

export const FULL_FRAME_DIAGONAL_MM = Math.hypot(36, 24);

export function verticalFovDegFrom35mm(f35: number, widthPx: number, heightPx: number, orientation = 1): number {
  if (!(f35 > 0) || !(widthPx > 0) || !(heightPx > 0)) throw new Error("focal length and image size must be positive");
  const rotated = orientation >= 5 && orientation <= 8;
  const w = rotated ? heightPx : widthPx;
  const h = rotated ? widthPx : heightPx;
  const hEq = (FULL_FRAME_DIAGONAL_MM * h) / Math.hypot(w, h);
  return (2 * Math.atan(hEq / (2 * f35)) * 180) / Math.PI;
}

/** A picture's size as it is seen: EXIF orientations 5–8 turn the stored pixels a quarter. */
export function uprightSize(width: number, height: number, orientation: number): { width: number; height: number } {
  return orientation >= 5 && orientation <= 8 ? { width: height, height: width } : { width, height };
}

// ---------------------------------------------------------------------------
// The EXIF reader: a small TIFF-IFD walk, no dependency
// ---------------------------------------------------------------------------

/** What E reads from a photo's EXIF. Null: the tag is absent, malformed, or (a 35 mm focal length of 0) unknown. */
export type ExifFocal = { focal35mm: number | null; focalMm: number | null; orientation: number | null };

export const EXIF_TAGS = { orientation: 0x0112, exifIfd: 0x8769, focalLength: 0x920a, focal35mm: 0xa405 } as const;
const SHORT = 3;
const LONG = 4;
const RATIONAL = 5;
const IFD = 13;

const NONE: ExifFocal = { focal35mm: null, focalMm: null, orientation: null };

/**
 * The three tags E needs, from a raw EXIF block (sharp's metadata().exif:
 * "Exif\0\0" and then a TIFF header, in either byte order; the header may
 * also come bare). IFD0 holds the orientation (0x0112, SHORT) and the offset
 * of the Exif IFD (0x8769); the Exif IFD holds FocalLengthIn35mmFilm
 * (0xA405, SHORT — 0 means unknown) and FocalLength (0x920A, RATIONAL: two
 * LONGs at an offset). Offsets count from the TIFF header. Never throws:
 * anything truncated, out of bounds or of the wrong type reads as null.
 */
export function readExifFocal(block: Uint8Array | null | undefined): ExifFocal {
  if (!block || block.byteLength < 8) return NONE;
  const head = [0x45, 0x78, 0x69, 0x66, 0, 0];
  const base = block.byteLength >= 14 && head.every((b, i) => block[i] === b) ? 6 : 0;
  const size = block.byteLength - base;
  const view = new DataView(block.buffer, block.byteOffset + base, size);
  const order = view.getUint16(0, false);
  const le = order === 0x4949 ? true : order === 0x4d4d ? false : null;
  if (le === null) return NONE;
  const u16 = (p: number): number | null => (Number.isInteger(p) && p >= 0 && p + 2 <= size ? view.getUint16(p, le) : null);
  const u32 = (p: number): number | null => (Number.isInteger(p) && p >= 0 && p + 4 <= size ? view.getUint32(p, le) : null);
  if (u16(2) !== 42) return NONE;

  type Entry = { type: number; count: number; at: number };
  const entries = (ifd: number | null): Map<number, Entry> => {
    const out = new Map<number, Entry>();
    if (ifd === null || ifd < 8) return out;
    const n = u16(ifd);
    if (n === null || ifd + 2 + n * 12 > size) return out;
    for (let i = 0; i < n; i++) {
      const e = ifd + 2 + i * 12;
      const tag = u16(e);
      const type = u16(e + 2);
      const count = u32(e + 4);
      if (tag === null || type === null || count === null) continue;
      out.set(tag, { type, count, at: e + 8 });
    }
    return out;
  };
  // A SHORT sits left-justified in the entry's 4-byte value field, in either byte order.
  const whole = (e: Entry | undefined): number | null => {
    if (!e || e.count < 1) return null;
    if (e.type === SHORT) return u16(e.at);
    if (e.type === LONG || e.type === IFD) return u32(e.at);
    return null;
  };
  const rational = (e: Entry | undefined): number | null => {
    if (!e || e.type !== RATIONAL || e.count < 1) return null;
    const at = u32(e.at);
    if (at === null) return null;
    const num = u32(at);
    const den = u32(at + 4);
    return num === null || !den ? null : num / den;
  };

  const ifd0 = entries(u32(4));
  const o = whole(ifd0.get(EXIF_TAGS.orientation));
  const exif = entries(whole(ifd0.get(EXIF_TAGS.exifIfd)));
  const f35 = whole(exif.get(EXIF_TAGS.focal35mm));
  const fmm = rational(exif.get(EXIF_TAGS.focalLength));
  return {
    focal35mm: f35 !== null && f35 > 0 ? f35 : null,
    focalMm: fmm !== null && Number.isFinite(fmm) && fmm > 0 ? fmm : null,
    orientation: o !== null && o >= 1 && o <= 8 ? o : null,
  };
}

// ---------------------------------------------------------------------------
// match.json's EXIF against the file's own
// ---------------------------------------------------------------------------

/** What match.json may say about a photo's lens (corpus.mts MatchRow["exif"]). */
export type DeclaredExif = { focal35mm: number | null; focalMm: number | null; orientation: number | null } | null;

export type FocalTruth = {
  focal35mm: number | null;
  focalMm: number | null;
  /** Where the 35 mm-equivalent focal length came from: match.json wins; the file's own EXIF fills what it leaves out. */
  source: "match.json" | "file" | null;
  /** Each field both match.json and the file give, where they differ. Reported, never settled silently. */
  disagreements: string[];
};

/**
 * The lens a photo's ground truth uses: match.json's figure where it gives
 * one, the file's own EXIF where it leaves it out (field by field). Where
 * both give a figure and they differ — the 35 mm focal length to the whole
 * millimetre EXIF stores, the real focal length by more than 0.05 mm, the
 * orientation at all — the difference is reported. The orientation the
 * truth uses is always the file's (fileOrientation: what the photo is
 * turned by when it is prepared).
 */
export function mergeExif(declared: DeclaredExif, file: ExifFocal, fileOrientation: number): FocalTruth {
  const d = declared ?? { focal35mm: null, focalMm: null, orientation: null };
  const disagreements: string[] = [];
  if (d.focal35mm !== null && file.focal35mm !== null && Math.round(d.focal35mm) !== Math.round(file.focal35mm)) {
    disagreements.push(`35 mm focal length: match.json ${d.focal35mm} mm, the file ${file.focal35mm} mm`);
  }
  if (d.focalMm !== null && file.focalMm !== null && Math.abs(d.focalMm - file.focalMm) > 0.05) {
    disagreements.push(`focal length: match.json ${d.focalMm} mm, the file ${file.focalMm} mm`);
  }
  if (d.orientation !== null && d.orientation !== fileOrientation) {
    disagreements.push(`orientation: match.json ${d.orientation}, the file ${fileOrientation}`);
  }
  const focal35mm = d.focal35mm ?? file.focal35mm;
  return {
    focal35mm,
    focalMm: d.focalMm ?? file.focalMm,
    source: d.focal35mm !== null ? "match.json" : file.focal35mm !== null ? "file" : null,
    disagreements,
  };
}

/**
 * Preparing a photo only scales it (photo-client.ts and photo.ts fit it,
 * never crop it), so its field of view is the original's. Checked: the sent
 * photo's short side is within a pixel of what its long side and the
 * upright original's shape predict — each side is rounded to a whole pixel
 * once, so the true sides are never more than that apart. A photo turned
 * the other way fails too.
 */
export function aspectHeld(upright: { width: number; height: number }, sent: { width: number; height: number }): boolean {
  const wide = upright.width >= upright.height;
  const ratio = wide ? upright.height / upright.width : upright.width / upright.height;
  const [long, short] = wide ? [sent.width, sent.height] : [sent.height, sent.width];
  return long > 0 && short > 0 && Math.abs(short - long * ratio) <= 1;
}
