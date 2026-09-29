import { inflateRawSync } from "node:zlib";

// Files people drop into Aly's chat (2026-09-29): PDFs, pictures, Word files,
// spreadsheets and plain text. Relative imports only; unit-tested.
//
// PDFs and pictures go to every brain AS THEMSELVES (all three read them
// natively). Word files and spreadsheets are read into words here, on the
// server, because no brain takes .docx/.xlsx directly — both are zip files of
// XML, so a small zip reader and a tag stripper are all it takes (no library,
// nothing new in the dependency tree).

import { MAX_TEXT_CHARS, type FileKind } from "./file-types";

export * from "./file-types";

/**
 * Do the bytes match the claimed type? Checked on the server after the upload,
 * so a renamed executable never reaches a brain as a "PDF".
 */
export function bytesMatch(kind: FileKind, mime: string, b: Uint8Array): boolean {
  const starts = (...sig: number[]) => sig.every((v, i) => b[i] === v);
  switch (kind) {
    case "pdf":
      return starts(0x25, 0x50, 0x44, 0x46); // %PDF
    case "docx":
    case "xlsx":
      return starts(0x50, 0x4b, 0x03, 0x04); // PK zip
    case "image":
      if (mime === "image/png") return starts(0x89, 0x50, 0x4e, 0x47);
      if (mime === "image/jpeg") return starts(0xff, 0xd8, 0xff);
      if (mime === "image/gif") return starts(0x47, 0x49, 0x46, 0x38);
      if (mime === "image/webp") return starts(0x52, 0x49, 0x46, 0x46) && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50;
      return false;
    case "text": {
      // Text is text: no NUL bytes in the first 8 KB, and it decodes as UTF-8.
      const head = b.subarray(0, 8192);
      if (head.includes(0)) return false;
      try {
        new TextDecoder("utf-8", { fatal: true }).decode(head.length < b.length ? trimToCharBoundary(head) : head);
        return true;
      } catch {
        return false;
      }
    }
  }
}

function trimToCharBoundary(b: Uint8Array): Uint8Array {
  // Drop a multi-byte character cut in half at the end of the sample.
  let end = b.length;
  for (let i = 1; i <= 3 && end - i >= 0; i++) {
    const c = b[end - i];
    if ((c & 0xc0) === 0x80) continue;
    if (c >= 0xc0) end = end - i;
    break;
  }
  return b.subarray(0, end);
}

// ---------------------------------------------------------------------------
// A small zip reader: the central directory at the end, then each entry's
// data, stored (method 0) or deflated (method 8). Enough for .docx/.xlsx.

type ZipEntry = { name: string; method: number; compressedSize: number; localOffset: number };

const MAX_UNZIPPED_BYTES = 60 * 1024 * 1024;

export function zipEntries(b: Uint8Array): ZipEntry[] {
  const view = new DataView(b.buffer, b.byteOffset, b.byteLength);
  // End of central directory: signature 0x06054b50 within the last 64 KB + 22.
  let eocd = -1;
  for (let i = b.length - 22; i >= Math.max(0, b.length - 65_557); i--) {
    if (view.getUint32(i, true) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error("not a zip file");
  const count = view.getUint16(eocd + 10, true);
  let p = view.getUint32(eocd + 16, true);
  const out: ZipEntry[] = [];
  for (let i = 0; i < count; i++) {
    if (p + 46 > b.length || view.getUint32(p, true) !== 0x02014b50) throw new Error("broken zip directory");
    const method = view.getUint16(p + 10, true);
    const compressedSize = view.getUint32(p + 20, true);
    const nameLen = view.getUint16(p + 28, true);
    const extraLen = view.getUint16(p + 30, true);
    const commentLen = view.getUint16(p + 32, true);
    const localOffset = view.getUint32(p + 42, true);
    const name = new TextDecoder().decode(b.subarray(p + 46, p + 46 + nameLen));
    out.push({ name, method, compressedSize, localOffset });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}

export function readZipEntry(b: Uint8Array, entry: ZipEntry): Uint8Array {
  const view = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const p = entry.localOffset;
  if (view.getUint32(p, true) !== 0x04034b50) throw new Error("broken zip entry");
  const nameLen = view.getUint16(p + 26, true);
  const extraLen = view.getUint16(p + 28, true);
  const start = p + 30 + nameLen + extraLen;
  const data = b.subarray(start, start + entry.compressedSize);
  if (entry.method === 0) return data;
  if (entry.method === 8) return new Uint8Array(inflateRawSync(data, { maxOutputLength: MAX_UNZIPPED_BYTES }));
  throw new Error(`zip method ${entry.method} not supported`);
}

function zipText(b: Uint8Array, name: string): string | null {
  const entry = zipEntries(b).find((e) => e.name === name);
  return entry ? new TextDecoder().decode(readZipEntry(b, entry)) : null;
}

export function decodeXmlEntities(s: string): string {
  return s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, d: string) => safeCodePoint(Number(d)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h: string) => safeCodePoint(parseInt(h, 16)))
    .replace(/&amp;/g, "&");
}

function safeCodePoint(n: number): string {
  return Number.isInteger(n) && n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : "";
}

/** A Word document's words, paragraph by paragraph, tables as tab-separated rows. */
export function docxText(b: Uint8Array): string {
  const xml = zipText(b, "word/document.xml");
  if (xml === null) throw new Error("no word/document.xml");
  const text = xml
    .replace(/<w:tab\/>/g, "\t")
    .replace(/<w:br[^>]*\/>/g, "\n")
    .replace(/<\/w:tc>/g, "\t")
    .replace(/<\/w:p>/g, "\n")
    .replace(/<[^>]+>/g, "");
  return decodeXmlEntities(text)
    .replace(/\t\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .slice(0, MAX_TEXT_CHARS);
}

function columnIndex(ref: string): number {
  const letters = /^[A-Z]+/.exec(ref)?.[0] ?? "A";
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

/** A spreadsheet as CSV, one block per sheet, with the sheet's name above it. */
export function xlsxText(b: Uint8Array): string {
  const entries = zipEntries(b);
  const read = (name: string) => {
    const e = entries.find((x) => x.name === name);
    return e ? new TextDecoder().decode(readZipEntry(b, e)) : null;
  };
  const shared: string[] = [];
  const sst = read("xl/sharedStrings.xml");
  if (sst) {
    for (const si of sst.match(/<si>[\s\S]*?<\/si>/g) ?? []) {
      const parts = [...si.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((m) => m[1]);
      shared.push(decodeXmlEntities(parts.join("")));
    }
  }
  const workbook = read("xl/workbook.xml") ?? "";
  const names = [...workbook.matchAll(/<sheet [^>]*name="([^"]*)"/g)].map((m) => decodeXmlEntities(m[1]));
  const sheetFiles = entries
    .map((e) => e.name)
    .filter((n) => /^xl\/worksheets\/sheet\d+\.xml$/.test(n))
    .sort((a, c) => Number(/(\d+)\.xml$/.exec(a)![1]) - Number(/(\d+)\.xml$/.exec(c)![1]));

  const csvCell = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  const blocks: string[] = [];
  let total = 0;
  sheetFiles.forEach((file, i) => {
    const xml = read(file) ?? "";
    const lines: string[] = [];
    for (const row of xml.match(/<row[^>]*>[\s\S]*?<\/row>/g) ?? []) {
      const cells: string[] = [];
      for (const c of row.matchAll(/<c ([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
        const attrs = c[1];
        const inner = c[2] ?? "";
        const ref = /r="([A-Z]+\d+)"/.exec(attrs)?.[1] ?? "";
        const type = /t="([^"]+)"/.exec(attrs)?.[1] ?? "";
        const v = /<v>([\s\S]*?)<\/v>/.exec(inner)?.[1];
        let value = "";
        if (type === "s" && v !== undefined) value = shared[Number(v)] ?? "";
        else if (type === "inlineStr") value = decodeXmlEntities([...inner.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((m) => m[1]).join(""));
        else if (v !== undefined) value = decodeXmlEntities(v);
        const col = ref ? columnIndex(ref) : cells.length;
        while (cells.length < col) cells.push("");
        cells[col] = csvCell(value);
      }
      lines.push(cells.join(","));
    }
    const block = `## Sheet: ${names[i] ?? `Sheet ${i + 1}`}\n${lines.join("\n")}`;
    total += block.length;
    if (total <= MAX_TEXT_CHARS) blocks.push(block);
  });
  if (blocks.length === 0) throw new Error("no sheets");
  return blocks.join("\n\n");
}

/** The words the brains get for a file that isn't a PDF or a picture. */
export function extractText(kind: FileKind, b: Uint8Array): string | null {
  if (kind === "docx") return docxText(b);
  if (kind === "xlsx") return xlsxText(b);
  if (kind === "text") return new TextDecoder("utf-8").decode(b).slice(0, MAX_TEXT_CHARS);
  return null;
}
