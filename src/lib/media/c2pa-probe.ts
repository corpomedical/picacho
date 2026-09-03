// Is this file marked as AI-generated?
//
// EU AI Act Article 50(2) requires synthetic output to carry a machine-readable
// mark, and from 2 December 2026 that is a legal duty on us, not a nice-to-have.
// Measured on 2026-09-03, our output is inconsistent: image renders carry a C2PA
// manifest and so do some video engines, while gemini-omni and our own upscale
// lane produce nothing at all. See docs/AI_ACT_MARKING.md for the evidence.
//
// This is the measurement layer. It cannot VERIFY a manifest — that needs the
// c2pa library and trust-list checking — but it answers the question that
// actually matters operationally: did anything mark this file, or did it reach
// the customer bare? A cheap, dependency-free structural probe, in the same
// spirit as mp4-probe.ts.

/** JUMBF box label that every C2PA manifest store carries. */
const C2PA_MARKERS = ["jumdc2pa", "c2pa"] as const;

/**
 * True when the bytes contain a C2PA manifest store.
 *
 * MP4 carries it inside a top-level `uuid` box, which sits early in the file
 * (right after `ftyp` in fal's marked deliveries), so a leading slice is
 * enough. PNG carries it in a `caBX` chunk. Rather than special-case each
 * container, this scans for the JUMBF label — present in both, and absent in
 * every unmarked file we have inspected.
 */
export function hasC2paManifest(bytes: Uint8Array): boolean {
  // latin1 keeps every byte a single character, so no multi-byte decoding can
  // invent a match or destroy one that is there.
  const head = Buffer.from(bytes.subarray(0, Math.min(bytes.length, 1_048_576))).toString("latin1");
  return C2PA_MARKERS.some((marker) => head.includes(marker));
}

/**
 * The top-level MP4 box types, in order — `uuid` among them is where a C2PA
 * manifest rides. Returns an empty array for anything that is not a plausible
 * MP4 rather than throwing: a probe that can crash the collect path is worse
 * than one that shrugs.
 */
export function mp4TopLevelBoxes(bytes: Uint8Array, limit = 12): string[] {
  const boxes: string[] = [];
  let offset = 0;
  while (offset + 8 <= bytes.length && boxes.length < limit) {
    const size =
      (bytes[offset] << 24) |
      (bytes[offset + 1] << 16) |
      (bytes[offset + 2] << 8) |
      bytes[offset + 3];
    if (size < 8) break;
    boxes.push(Buffer.from(bytes.subarray(offset + 4, offset + 8)).toString("latin1"));
    offset += size;
  }
  return boxes;
}
