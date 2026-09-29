// Documents Aly writes into the side panel (2026-09-29, the "artifacts /
// canvas" of the draft). Relative imports only; the logic runs against a
// DocsStore so it is tested without a database.
//
// A document belongs to one chat. Aly writes it with write_document and
// changes it with edit_document (find-and-replace, or the whole text); the
// person edits it in the panel too. Every change bumps the version, so the
// chat can say "v2" and the panel always shows the newest.

export const DOC_TOOL_NAMES = { write: "write_document", edit: "edit_document" } as const;
export const MAX_DOC_CHARS = 400_000;
export const MAX_DOCS_PER_CHAT = 40;

export const DOC_TOOLS = [
  {
    name: DOC_TOOL_NAMES.write,
    description:
      "Write a NEW document into the side panel beside the chat, where the person can read, edit and download it. Use it for anything they will keep, edit or send: plans, letters, essays, contracts, reports, scripts, READMEs, code files. Returns the document's id. For changes to an existing document use edit_document instead.",
    strict: true,
    input_schema: {
      type: "object",
      additionalProperties: false,
      required: ["title", "kind", "language", "content"],
      properties: {
        title: { type: "string", description: "A short title, e.g. 'Q4 launch plan' or 'invoice.py'." },
        kind: { type: "string", enum: ["document", "code"], description: "document = Markdown prose; code = one source file." },
        language: {
          anyOf: [{ type: "string" }, { type: "null" }],
          description: "For code: the language, e.g. 'python', 'typescript', 'sql'. Null for a document.",
        },
        content: { type: "string", description: "The whole document. Markdown for a document; plain source for code." },
      },
    },
  },
  {
    name: DOC_TOOL_NAMES.edit,
    description:
      "Change a document already in the side panel. Either replace one exact passage (find must appear exactly once) or, when most of it changes, send the whole new text with find set to null. The person may have edited it since you wrote it: the result tells you if find wasn't there.",
    strict: true,
    input_schema: {
      type: "object",
      additionalProperties: false,
      required: ["id", "find", "replace"],
      properties: {
        id: { type: "string", description: "The document's id from write_document." },
        find: { anyOf: [{ type: "string" }, { type: "null" }], description: "The exact text to replace, or null to replace everything." },
        replace: { type: "string", description: "The new text for that passage, or the whole new document when find is null." },
      },
    },
  },
] as const;

export type Doc = {
  id: string;
  title: string;
  kind: "document" | "code";
  language: string | null;
  content: string;
  version: number;
};

export interface DocsStore {
  count(): Promise<number>;
  get(id: string): Promise<Doc | null>;
  create(d: Omit<Doc, "id" | "version">): Promise<Doc>;
  update(id: string, content: string, version: number): Promise<Doc>;
}

export type DocOutcome = { text: string; isError: boolean; doc?: Doc };

function rec(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

function countOf(hay: string, needle: string): number {
  if (!needle) return 0;
  let n = 0;
  let i = hay.indexOf(needle);
  while (i >= 0) {
    n++;
    i = hay.indexOf(needle, i + needle.length);
  }
  return n;
}

export async function runDocTool(store: DocsStore, name: string, input: unknown): Promise<DocOutcome> {
  const a = rec(input);
  if (name === DOC_TOOL_NAMES.write) {
    const title = typeof a.title === "string" ? a.title.trim().slice(0, 160) : "";
    const kind = a.kind === "code" ? "code" : "document";
    const language = kind === "code" && typeof a.language === "string" ? a.language.trim().slice(0, 30) || null : null;
    const content = typeof a.content === "string" ? a.content : "";
    if (!title) return { text: "A document needs a title.", isError: true };
    if (!content.trim()) return { text: "The document is empty. Write its content.", isError: true };
    if (content.length > MAX_DOC_CHARS) return { text: `That is longer than ${MAX_DOC_CHARS} characters. Split it into parts.`, isError: true };
    if ((await store.count()) >= MAX_DOCS_PER_CHAT) {
      return { text: `This chat already holds ${MAX_DOCS_PER_CHAT} documents. Edit one of them, or suggest starting a new chat.`, isError: true };
    }
    const doc = await store.create({ title, kind, language, content });
    return { text: `Written: "${doc.title}" (id ${doc.id}, version 1). It is open in the side panel.`, isError: false, doc };
  }
  if (name === DOC_TOOL_NAMES.edit) {
    const id = typeof a.id === "string" ? a.id.trim() : "";
    const doc = id ? await store.get(id) : null;
    if (!doc) return { text: "There is no document with that id in this chat.", isError: true };
    const replace = typeof a.replace === "string" ? a.replace : "";
    let next: string;
    if (a.find === null || a.find === undefined) {
      if (!replace.trim()) return { text: "The new text is empty.", isError: true };
      next = replace;
    } else {
      const find = String(a.find);
      const n = countOf(doc.content, find);
      if (n === 0) return { text: `That passage isn't in "${doc.title}" (the person may have edited it). Here is the current text:\n\n${doc.content.slice(0, 20000)}`, isError: true };
      if (n > 1) return { text: `That passage appears ${n} times. Include more of the surrounding text so it matches once.`, isError: true };
      next = doc.content.replace(find, () => replace);
    }
    if (next.length > MAX_DOC_CHARS) return { text: `That would make it longer than ${MAX_DOC_CHARS} characters.`, isError: true };
    const updated = await store.update(doc.id, next, doc.version + 1);
    return { text: `Changed: "${updated.title}" is now version ${updated.version}.`, isError: false, doc: updated };
  }
  return { text: `There is no tool called ${name}.`, isError: true };
}

export function isDocTool(name: string): boolean {
  return name === DOC_TOOL_NAMES.write || name === DOC_TOOL_NAMES.edit;
}

/** A file name to download a document as. */
export function downloadName(d: Pick<Doc, "title" | "kind" | "language">): string {
  const base = d.title.replace(/[^\w.\- ]+/g, "").trim().replace(/\s+/g, "-").slice(0, 80) || "document";
  if (/\.[a-z0-9]{1,6}$/i.test(base)) return base;
  if (d.kind === "document") return `${base}.md`;
  const ext: Record<string, string> = {
    python: "py", typescript: "ts", javascript: "js", tsx: "tsx", jsx: "jsx", sql: "sql", html: "html", css: "css",
    json: "json", bash: "sh", shell: "sh", go: "go", rust: "rs", java: "java", kotlin: "kt", swift: "swift",
    ruby: "rb", php: "php", c: "c", cpp: "cpp", csharp: "cs", yaml: "yml", markdown: "md",
  };
  return `${base}.${ext[(d.language ?? "").toLowerCase()] ?? "txt"}`;
}
