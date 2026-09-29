// What Aly's chat accepts (2026-09-29) — shared by the browser (the file
// picker) and the server (files.ts). No Node imports here.

export type FileKind = "pdf" | "image" | "text" | "docx" | "xlsx";

export const MAX_FILE_BYTES = 20 * 1024 * 1024;
/** Everything attached to one chat, together: Claude's request limit is 32 MB. */
export const MAX_CHAT_FILE_BYTES = 24 * 1024 * 1024;
export const MAX_FILES_PER_MESSAGE = 10;
/** Words kept from one Word file or spreadsheet (~500,000 tokens at most). */
export const MAX_TEXT_CHARS = 2_000_000;

const DOCX = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

export const ACCEPTED_MIME: Record<string, FileKind> = {
  "application/pdf": "pdf",
  "image/jpeg": "image",
  "image/png": "image",
  "image/webp": "image",
  "image/gif": "image",
  "text/plain": "text",
  "text/markdown": "text",
  "text/csv": "text",
  "application/json": "text",
  [DOCX]: "docx",
  [XLSX]: "xlsx",
};

/** What the file picker offers. */
export const ACCEPT_ATTR = [
  ".pdf", ".png", ".jpg", ".jpeg", ".webp", ".gif",
  ".txt", ".md", ".csv", ".json", ".docx", ".xlsx",
].join(",");

const BY_EXTENSION: Record<string, string> = {
  pdf: "application/pdf",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  gif: "image/gif",
  txt: "text/plain",
  md: "text/markdown",
  markdown: "text/markdown",
  csv: "text/csv",
  json: "application/json",
  docx: DOCX,
  xlsx: XLSX,
};

/**
 * The type the server will store a file as, from its name first (browsers
 * send "" or application/octet-stream for .md and .csv on some systems),
 * then from what the browser said. Null = not something Aly reads.
 */
export function mimeFor(name: string, browserType: string): string | null {
  const ext = name.toLowerCase().split(".").pop() ?? "";
  const byName = BY_EXTENSION[ext];
  if (byName) return byName;
  const t = browserType.toLowerCase().split(";")[0].trim();
  return ACCEPTED_MIME[t] ? t : null;
}

export function kindOf(mime: string): FileKind | null {
  return ACCEPTED_MIME[mime] ?? null;
}

/** A name safe for a storage path: letters, digits, dot, dash, underscore. */
export function safeName(name: string): string {
  const cleaned = name
    .normalize("NFKD")
    .replace(/[^\w.\-]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^[._]+/, "")
    .slice(-80);
  return cleaned || "file";
}
