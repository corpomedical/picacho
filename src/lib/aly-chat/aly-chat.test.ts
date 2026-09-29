import { describe, expect, it } from "vitest";
import { deflateRawSync } from "node:zlib";
import {
  costUsd,
  fromClaude,
  fromGemini,
  fromOpenAI,
  modelFor,
  reserveUnits,
  unitsForCost,
  CLAUDE_HARDER_MODEL,
  CLAUDE_MODEL,
} from "./brains";
import { bytesMatch, docxText, extractText, mimeFor, safeName, xlsxText } from "./files";
import { canChangeKept, fileIdsIn, keptText, parseRow, toClaude, toGemini, toOpenAI, type StoredRow } from "./history";
import { downloadName, runDocTool, type Doc, type DocsStore } from "./docs";
import { sseData, streamGemini, streamGpt, ProviderError } from "./providers";
import { PLAN_CHAT_UNIT_LIMITS } from "../plans";

// ---------------------------------------------------------------------------
// brains.ts — the money

describe("costs and units", () => {
  it("prices a Sonnet 5 message from the API's own usage", () => {
    // 4,000 fresh in + 700 out: 4000 × $2/M + 700 × $10/M = $0.008 + $0.007
    const u = fromClaude({ input_tokens: 4000, output_tokens: 700, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 });
    expect(costUsd(u, CLAUDE_MODEL)).toBeCloseTo(0.015, 6);
    expect(unitsForCost(0.015)).toBe(1);
  });

  it("prices cache reads and writes on Claude", () => {
    // 20,000 cached × $0.20/M + 1,000 written × $2.50/M + 500 out × $10/M
    const u = fromClaude({ input_tokens: 0, cache_read_input_tokens: 20000, cache_creation_input_tokens: 1000, output_tokens: 500 });
    expect(costUsd(u, CLAUDE_MODEL)).toBeCloseTo(0.004 + 0.0025 + 0.005, 6);
  });

  it("does not double-count the cached part of GPT's and Gemini's totals", () => {
    const g = fromOpenAI({ prompt_tokens: 10000, completion_tokens: 1000, prompt_tokens_details: { cached_tokens: 8000 } });
    expect(g).toEqual({ input: 2000, cached: 8000, cacheWrite: 0, output: 1000 });
    // 2000 × $2/M + 8000 × $0.20/M + 1000 × $10/M
    expect(costUsd(g, "gpt-6-sol")).toBeCloseTo(0.004 + 0.0016 + 0.01, 6);
    const m = fromGemini({ promptTokenCount: 10000, cachedContentTokenCount: 4000, candidatesTokenCount: 300, thoughtsTokenCount: 200 });
    expect(m).toEqual({ input: 6000, cached: 4000, cacheWrite: 0, output: 500 });
  });

  it("prices a model it doesn't know as the dearest, never as free", () => {
    const u = { input: 1_000_000, cached: 0, cacheWrite: 0, output: 0 };
    expect(costUsd(u, "some-new-model")).toBe(10);
  });

  it("charges at least one unit and rounds up", () => {
    expect(unitsForCost(0)).toBe(1);
    expect(unitsForCost(0.02)).toBe(1);
    expect(unitsForCost(0.0201)).toBe(2);
    expect(unitsForCost(Number.NaN)).toBe(1);
  });

  it("thinks harder on Opus 5.5 for Claude only", () => {
    expect(modelFor("claude", false)).toBe(CLAUDE_MODEL);
    expect(modelFor("claude", true)).toBe(CLAUDE_HARDER_MODEL);
    expect(modelFor("gpt", true)).toBe("gpt-6-sol");
    expect(modelFor("gemini", true)).toBe("gemini-3.8-flash");
  });

  it("reserves all three lanes together for Ask all three", () => {
    expect(reserveUnits("claude", false)).toBe(25);
    expect(reserveUnits("all", false)).toBe(25 + 25 + 10);
    expect(reserveUnits("all", true)).toBe(50 + 40 + 15);
  });

  it("keeps the Generous allowance, and at least 5% margin in the worst month", () => {
    expect(PLAN_CHAT_UNIT_LIMITS).toMatchObject({ basic: 130, starter: 210, growth: 650, studio: 2150, elite: 6400 });
    const table: [keyof typeof PLAN_CHAT_UNIT_LIMITS, number, number][] = [
      ["basic", 9, 12],
      ["starter", 19, 30],
      ["growth", 79, 140],
      ["studio", 299, 550],
      ["elite", 499, 750],
    ];
    for (const [plan, price, credits] of table) {
      const net = price / 1.21 - (0.015 * price + 0.27);
      const worst = credits * 0.3396 + PLAN_CHAT_UNIT_LIMITS[plan] * 0.02;
      expect((net - worst) / net).toBeGreaterThanOrEqual(0.05);
    }
  });
});

// ---------------------------------------------------------------------------
// files.ts

/** A zip with the given files, deflated, as Word and Excel write them. */
function makeZip(files: Record<string, string>): Uint8Array {
  const enc = new TextEncoder();
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const [name, text] of Object.entries(files)) {
    const nameB = Buffer.from(enc.encode(name));
    const data = deflateRawSync(Buffer.from(enc.encode(text)));
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(8, 8);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt16LE(nameB.length, 26);
    locals.push(local, nameB, data);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(8, 10);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt16LE(nameB.length, 28);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, nameB);
    offset += 30 + nameB.length + data.length;
  }
  const dir = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(Object.keys(files).length, 8);
  end.writeUInt16LE(Object.keys(files).length, 10);
  end.writeUInt32LE(dir.length, 12);
  end.writeUInt32LE(offset, 16);
  return new Uint8Array(Buffer.concat([...locals, dir, end]));
}

describe("files", () => {
  it("reads a Word document's paragraphs, tabs, tables and entities", () => {
    const zip = makeZip({
      "word/document.xml":
        '<w:document><w:body><w:p><w:r><w:t>Launch plan</w:t></w:r></w:p><w:p><w:r><w:t>Budget &amp; dates</w:t></w:r><w:tab/><w:r><w:t>€2,000</w:t></w:r></w:p>' +
        "<w:tbl><w:tr><w:tc><w:p><w:r><w:t>Week</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>Task</w:t></w:r></w:p></w:tc></w:tr></w:tbl></w:body></w:document>",
    });
    const text = docxText(zip);
    expect(text).toContain("Launch plan\nBudget & dates\t€2,000");
    expect(text).toContain("Week");
    expect(text).toContain("Task");
  });

  it("reads a spreadsheet as CSV per sheet, with shared strings and gaps", () => {
    const zip = makeZip({
      "xl/workbook.xml": '<workbook><sheets><sheet name="Sales" sheetId="1"/></sheets></workbook>',
      "xl/sharedStrings.xml": "<sst><si><t>Month</t></si><si><t>Revenue, €</t></si><si><t>Jan</t></si></sst>",
      "xl/worksheets/sheet1.xml":
        '<worksheet><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c><c r="C1" t="s"><v>1</v></c></row><row r="2"><c r="A2" t="s"><v>2</v></c><c r="C2"><v>1250.5</v></c></row></sheetData></worksheet>',
    });
    expect(xlsxText(zip)).toBe('## Sheet: Sales\nMonth,,"Revenue, €"\nJan,,1250.5');
  });

  it("refuses bytes that don't match the claimed type", () => {
    expect(bytesMatch("pdf", "application/pdf", new TextEncoder().encode("%PDF-1.7 …"))).toBe(true);
    expect(bytesMatch("pdf", "application/pdf", new TextEncoder().encode("MZ\u0090 not a pdf"))).toBe(false);
    expect(bytesMatch("image", "image/png", new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d]))).toBe(true);
    expect(bytesMatch("image", "image/jpeg", new Uint8Array([0x89, 0x50, 0x4e, 0x47]))).toBe(false);
    expect(bytesMatch("text", "text/plain", new TextEncoder().encode("héllo, world"))).toBe(true);
    expect(bytesMatch("text", "text/plain", new Uint8Array([0x68, 0x00, 0x69]))).toBe(false);
    expect(bytesMatch("docx", "x", makeZip({ a: "b" }))).toBe(true);
  });

  it("types files by name first, then by what the browser said", () => {
    expect(mimeFor("notes.MD", "")).toBe("text/markdown");
    expect(mimeFor("report.pdf", "application/octet-stream")).toBe("application/pdf");
    expect(mimeFor("photo", "image/webp")).toBe("image/webp");
    expect(mimeFor("app.exe", "application/x-msdownload")).toBeNull();
  });

  it("makes storage-safe names", () => {
    expect(safeName("Q4 plan (final) — v2.pdf")).toBe("Q4_plan_final_v2.pdf");
    expect(safeName("../../etc/passwd")).toBe("etc_passwd");
    expect(safeName("…")).toBe("file");
  });

  it("returns words only for Word, Excel and text", () => {
    expect(extractText("text", new TextEncoder().encode("a,b\n1,2"))).toBe("a,b\n1,2");
    expect(extractText("pdf", new Uint8Array([1]))).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// history.ts — one conversation, three brains, append-only

const pdf = { id: "f1", name: "plan.pdf", mime: "application/pdf", kind: "pdf" as const };
const sheet = { id: "f2", name: "sales.xlsx", mime: "x", kind: "xlsx" as const };
const load = (id: string) =>
  id === "f1" ? { ref: pdf, base64: "JVBERi0=" } : id === "f2" ? { ref: sheet, text: "## Sheet: Sales\nMonth,Revenue" } : undefined;

const claudeTurn = [
  { role: "assistant" as const, content: [{ type: "thinking", thinking: "", signature: "sig1" }, { type: "tool_use", id: "t1", name: "web_search", input: {} }] },
  { role: "user" as const, content: [{ type: "tool_result", tool_use_id: "t1", content: "ok" }] },
  { role: "assistant" as const, content: [{ type: "text", text: "Here's the plan." }] },
];

const rows: StoredRow[] = [
  { seq: 0, role: "user", content: { text: "Plan my launch", files: [pdf], note: "[App note: today is Monday.]" } },
  { seq: 1, role: "assistant", brain: "claude", content: { lanes: { claude: { text: "Here's the plan.", model: CLAUDE_MODEL, claude: claudeTurn } }, kept: "claude" } },
  { seq: 2, role: "user", content: { text: "Compare with the numbers", files: [sheet] } },
  {
    seq: 3,
    role: "assistant",
    brain: "all",
    content: {
      lanes: {
        claude: { text: "Claude says A", model: CLAUDE_MODEL, claude: [{ role: "assistant", content: [{ type: "text", text: "Claude says A" }] }] },
        gpt: { text: "GPT says B", model: "gpt-6-sol" },
        gemini: { text: "", model: "gemini-3.8-flash", error: "declined" },
      },
      kept: "gpt",
    },
  },
  { seq: 4, role: "user", content: { text: "Go on", files: [] } },
];

describe("history", () => {
  it("gives Claude its own turns back verbatim, thinking and tools included", () => {
    const msgs = toClaude(rows, load);
    expect(msgs.map((m) => m.role)).toEqual(["user", "assistant", "user", "assistant", "user", "assistant", "user"]);
    expect(msgs[1]).toEqual(claudeTurn[0]);
    expect(msgs[3]).toEqual(claudeTurn[2]);
    const first = msgs[0].content as { type: string; source?: { data: string }; text?: string }[];
    expect(first[0]).toMatchObject({ type: "document", source: { data: "JVBERi0=" }, title: "plan.pdf" });
    expect(first.map((b) => b.text).filter(Boolean)).toEqual(["[App note: today is Monday.]", "Plan my launch"]);
  });

  it("continues a compare turn from the kept answer, as plain text", () => {
    const msgs = toClaude(rows, load);
    expect(msgs[5]).toEqual({ role: "assistant", content: [{ type: "text", text: "GPT says B" }] });
  });

  it("rebuilds the same bytes every time (the cache and Opus 5.5's thinking need it)", () => {
    expect(JSON.stringify(toClaude(rows, load))).toBe(JSON.stringify(toClaude(rows, load)));
  });

  it("merges two user turns in a row (a turn that got no answer)", () => {
    const r: StoredRow[] = [
      { seq: 0, role: "user", content: { text: "one", files: [] } },
      { seq: 1, role: "user", content: { text: "two", files: [] } },
    ];
    const msgs = toClaude(r, load);
    expect(msgs).toHaveLength(1);
    expect(toGemini(r, load)).toHaveLength(1);
    expect(toOpenAI("sys", r, load)).toHaveLength(2);
  });

  it("gives GPT the words, PDFs as files and sheets as text", () => {
    const msgs = toOpenAI("You are Aly.", rows, load);
    expect(msgs[0]).toEqual({ role: "system", content: "You are Aly." });
    const firstUser = msgs[1] as { content: { type: string; file?: { file_data: string } }[] };
    expect(firstUser.content[0]).toMatchObject({ type: "file", file: { filename: "plan.pdf", file_data: "data:application/pdf;base64,JVBERi0=" } });
    expect(msgs[2]).toEqual({ role: "assistant", content: "Here's the plan." });
    expect(JSON.stringify(msgs[3])).toContain("## Sheet: Sales");
    expect(msgs[4]).toEqual({ role: "assistant", content: "GPT says B" });
  });

  it("gives Gemini user/model turns with inline PDFs", () => {
    const c = toGemini(rows, load);
    expect(c.map((x) => x.role)).toEqual(["user", "model", "user", "model", "user"]);
    expect(JSON.stringify(c[0])).toContain('"inline_data":{"mime_type":"application/pdf","data":"JVBERi0="}');
  });

  it("says when a file is gone rather than failing", () => {
    const r: StoredRow[] = [{ seq: 0, role: "user", content: { text: "hi", files: [{ id: "gone", name: "old.pdf", mime: "application/pdf", kind: "pdf" }] } }];
    expect(JSON.stringify(toClaude(r, () => undefined))).toContain("old.pdf (no longer available)");
  });

  it("lists the files a chat refers to, once each", () => {
    expect(fileIdsIn([...rows, { seq: 5, role: "user", content: { text: "", files: [pdf] } }])).toEqual(["f1", "f2"]);
  });

  it("lets only the last message's kept answer change", () => {
    expect(canChangeKept(rows, 4)).toBe(true);
    expect(canChangeKept(rows, 3)).toBe(false);
    expect(canChangeKept([], 0)).toBe(false);
  });

  it("reads a stored row back, and falls back to text when a kept lane is missing", () => {
    const r = parseRow({ seq: 1, role: "assistant", brain: "gpt", content: { lanes: { gpt: { text: "hi", model: "gpt-6-sol" } }, kept: "gpt" } });
    expect(r?.role).toBe("assistant");
    if (r?.role === "assistant") {
      expect(keptText(r.content)).toBe("hi");
      expect(keptText({ ...r.content, lanes: {}, kept: "claude" })).toMatch(/No answer/);
    }
    expect(parseRow({ seq: 0, role: "system", content: {} })).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// docs.ts — the side panel

function memoryDocs(): DocsStore & { all: Doc[] } {
  const all: Doc[] = [];
  return {
    all,
    async count() {
      return all.length;
    },
    async get(id) {
      return all.find((d) => d.id === id) ?? null;
    },
    async create(d) {
      const doc = { ...d, id: `d${all.length + 1}`, version: 1 };
      all.push(doc);
      return doc;
    },
    async update(id, content, version) {
      const d = all.find((x) => x.id === id)!;
      d.content = content;
      d.version = version;
      return { ...d };
    },
  };
}

describe("documents", () => {
  it("writes, then edits one exact passage, bumping the version", async () => {
    const store = memoryDocs();
    const w = await runDocTool(store, "write_document", { title: "Plan", kind: "document", language: null, content: "# Plan\nLaunch on Friday." });
    expect(w.isError).toBe(false);
    expect(w.doc?.version).toBe(1);
    const e = await runDocTool(store, "edit_document", { id: "d1", find: "Friday", replace: "Saturday" });
    expect(e.isError).toBe(false);
    expect(store.all[0]).toMatchObject({ content: "# Plan\nLaunch on Saturday.", version: 2 });
  });

  it("refuses a passage that isn't there, or is there twice, and says why", async () => {
    const store = memoryDocs();
    await runDocTool(store, "write_document", { title: "T", kind: "code", language: "python", content: "x = 1\nx = 1\n" });
    const missing = await runDocTool(store, "edit_document", { id: "d1", find: "y = 2", replace: "" });
    expect(missing).toMatchObject({ isError: true });
    expect(missing.text).toContain("current text");
    const twice = await runDocTool(store, "edit_document", { id: "d1", find: "x = 1", replace: "x = 2" });
    expect(twice.text).toContain("2 times");
  });

  it("replaces everything when find is null, and keeps $ signs literal", async () => {
    const store = memoryDocs();
    await runDocTool(store, "write_document", { title: "Price", kind: "document", language: null, content: "Costs 5" });
    await runDocTool(store, "edit_document", { id: "d1", find: "5", replace: "$5 ($& is literal)" });
    expect(store.all[0].content).toBe("Costs $5 ($& is literal)");
    await runDocTool(store, "edit_document", { id: "d1", find: null, replace: "New text" });
    expect(store.all[0].content).toBe("New text");
  });

  it("names downloads by kind and language", () => {
    expect(downloadName({ title: "Q4 launch plan", kind: "document", language: null })).toBe("Q4-launch-plan.md");
    expect(downloadName({ title: "invoice", kind: "code", language: "python" })).toBe("invoice.py");
    expect(downloadName({ title: "main.go", kind: "code", language: "go" })).toBe("main.go");
  });
});

// ---------------------------------------------------------------------------
// providers.ts — GPT and Gemini streams

function sseBody(frames: string[]): ReadableStream<Uint8Array> {
  const enc = new TextEncoder();
  return new ReadableStream({
    start(c) {
      // Split mid-frame to prove the reader joins chunks.
      const all = frames.map((f) => `data: ${f}\n\n`).join("");
      c.enqueue(enc.encode(all.slice(0, 7)));
      c.enqueue(enc.encode(all.slice(7)));
      c.close();
    },
  });
}

async function drain<T, R>(gen: AsyncGenerator<T, R>): Promise<{ events: T[]; result: R }> {
  const events: T[] = [];
  let step = await gen.next();
  while (!step.done) {
    events.push(step.value);
    step = await gen.next();
  }
  return { events, result: step.value };
}

describe("providers", () => {
  it("reads server-sent events across chunk boundaries", async () => {
    const out: string[] = [];
    for await (const d of sseData(sseBody(['{"a":1}', "[DONE]"]))) out.push(d);
    expect(out).toEqual(['{"a":1}', "[DONE]"]);
  });

  it("streams GPT's words and reads its usage", async () => {
    let sent: { url: string; body: Record<string, unknown> } | null = null;
    const fetchFn = (async (url: string, init: RequestInit) => {
      sent = { url, body: JSON.parse(String(init.body)) };
      return new Response(
        sseBody([
          '{"model":"gpt-6-sol-2026-08","choices":[{"delta":{"content":"Hel"}}]}',
          '{"choices":[{"delta":{"content":"lo"}}]}',
          '{"choices":[],"usage":{"prompt_tokens":100,"completion_tokens":20,"prompt_tokens_details":{"cached_tokens":40}}}',
          "[DONE]",
        ]),
        { status: 200 },
      );
    }) as unknown as typeof fetch;
    const { events, result } = await drain(
      streamGpt({ messages: [{ role: "system", content: "s" }], harder: true, maxOutput: 100, signal: new AbortController().signal, apiKey: "k", fetchFn }),
    );
    expect(events.map((e) => e.text).join("")).toBe("Hello");
    expect(result).toEqual({ text: "Hello", model: "gpt-6-sol", usage: { input: 60, cached: 40, cacheWrite: 0, output: 20 } });
    expect(sent!.url).toBe("https://api.openai.com/v1/chat/completions");
    expect(sent!.body).toMatchObject({ model: "gpt-6-sol", reasoning_effort: "high", stream: true, store: false });
  });

  it("says GPT isn't set up without a key", async () => {
    await expect(drain(streamGpt({ messages: [], harder: false, maxOutput: 1, signal: new AbortController().signal, apiKey: "" }))).rejects.toBeInstanceOf(
      ProviderError,
    );
  });

  it("streams Gemini, skips its thoughts, and retries once without the thinking setting", async () => {
    const calls: Record<string, unknown>[] = [];
    const fetchFn = (async (_url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body));
      calls.push(body);
      if (calls.length === 1) return new Response('{"error":{"message":"Unknown field thinkingConfig.thinkingLevel"}}', { status: 400 });
      return new Response(
        sseBody([
          '{"candidates":[{"content":{"parts":[{"text":"thinking…","thought":true},{"text":"Bonjour"}]}}]}',
          '{"candidates":[{"content":{"parts":[{"text":"!"}]}}],"usageMetadata":{"promptTokenCount":50,"candidatesTokenCount":5,"thoughtsTokenCount":10}}',
        ]),
        { status: 200 },
      );
    }) as unknown as typeof fetch;
    const { events, result } = await drain(
      streamGemini({ system: "s", contents: [], harder: false, maxOutput: 10, signal: new AbortController().signal, apiKey: "k", fetchFn }),
    );
    expect(events.map((e) => e.text).join("")).toBe("Bonjour!");
    expect(result.usage).toEqual({ input: 50, cached: 0, cacheWrite: 0, output: 15 });
    expect((calls[0].generationConfig as Record<string, unknown>).thinkingConfig).toEqual({ thinkingLevel: "low" });
    expect((calls[1].generationConfig as Record<string, unknown>).thinkingConfig).toBeUndefined();
  });

  it("reports a Gemini block as a refusal", async () => {
    const fetchFn = (async () => new Response(sseBody(['{"promptFeedback":{"blockReason":"SAFETY"}}']), { status: 200 })) as unknown as typeof fetch;
    await expect(
      drain(streamGemini({ system: "s", contents: [], harder: false, maxOutput: 10, signal: new AbortController().signal, apiKey: "k", fetchFn })),
    ).rejects.toMatchObject({ kind: "refused" });
  });
});
