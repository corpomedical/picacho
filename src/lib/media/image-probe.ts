// Pixel dimensions of a PNG, JPEG or WebP, read from the container bytes.
//
// The money path for an uploaded Layers source reads the FILE, not the
// form (same rule as probeMp4 for upscales): the short side decides
// eligibility, so a client-claimed size would let a caller sidestep it.
// Dependency-free — the three headers are small and stable.
export type ImageProbe = { width: number; height: number; mimeType: "image/png" | "image/jpeg" | "image/webp" };

export function probeImage(bytes: Uint8Array): ImageProbe | null {
  if (bytes.length < 16) return null;
  // PNG: 8-byte signature, then IHDR with width/height big-endian at 16/20.
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) {
    if (bytes.length < 24) return null;
    const width = readU32BE(bytes, 16);
    const height = readU32BE(bytes, 20);
    return width > 0 && height > 0 ? { width, height, mimeType: "image/png" } : null;
  }
  // JPEG: walk the markers to the first SOFn frame header.
  if (bytes[0] === 0xff && bytes[1] === 0xd8) {
    let i = 2;
    while (i + 9 < bytes.length) {
      if (bytes[i] !== 0xff) return null;
      // Fill bytes: any run of 0xFF before a marker is legal (ITU T.81
      // B.1.1.2) and some encoders emit them; skip to the marker itself.
      while (bytes[i + 1] === 0xff && i + 9 < bytes.length) i++;
      const marker = bytes[i + 1];
      if (marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd7) || marker === 0x01) {
        i += 2;
        continue;
      }
      const len = (bytes[i + 2] << 8) | bytes[i + 3];
      const isSof =
        marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
      if (isSof) {
        const height = (bytes[i + 5] << 8) | bytes[i + 6];
        const width = (bytes[i + 7] << 8) | bytes[i + 8];
        return width > 0 && height > 0 ? { width, height, mimeType: "image/jpeg" } : null;
      }
      if (len < 2) return null;
      i += 2 + len;
    }
    return null;
  }
  // WebP: RIFF....WEBP then VP8 / VP8L / VP8X chunk.
  if (ascii(bytes, 0, 4) === "RIFF" && ascii(bytes, 8, 12) === "WEBP") {
    const chunk = ascii(bytes, 12, 16);
    if (chunk === "VP8X" && bytes.length >= 30) {
      const width = 1 + (bytes[24] | (bytes[25] << 8) | (bytes[26] << 16));
      const height = 1 + (bytes[27] | (bytes[28] << 8) | (bytes[29] << 16));
      return { width, height, mimeType: "image/webp" };
    }
    if (chunk === "VP8L" && bytes.length >= 25) {
      const b0 = bytes[21], b1 = bytes[22], b2 = bytes[23], b3 = bytes[24];
      const width = 1 + (((b1 & 0x3f) << 8) | b0);
      const height = 1 + (((b3 & 0x0f) << 10) | (b2 << 2) | ((b1 & 0xc0) >> 6));
      return { width, height, mimeType: "image/webp" };
    }
    if (chunk === "VP8 " && bytes.length >= 30) {
      const width = (bytes[26] | (bytes[27] << 8)) & 0x3fff;
      const height = (bytes[28] | (bytes[29] << 8)) & 0x3fff;
      return width > 0 && height > 0 ? { width, height, mimeType: "image/webp" } : null;
    }
    return null;
  }
  return null;
}

function readU32BE(b: Uint8Array, o: number): number {
  return ((b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]) >>> 0;
}
function ascii(b: Uint8Array, from: number, to: number): string {
  return String.fromCharCode(...b.subarray(from, to));
}
