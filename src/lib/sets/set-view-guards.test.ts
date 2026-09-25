import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// The chat's money guards that ship to everyone (Helios Cut 2, step 1,
// 2026-09-25 — operator: "Run, keep going.", with the owner's decisions 1
// and 2):
// - a message read as a change to the set itself shows the Astra card —
//   the words Astra will read, the month's changes left, a press — and
//   never calls Astra on its own, in any mode (it used to, even in "Ask
//   before shooting", and "now golden hour" was read as such a change);
// - a reading that failed — the reader down, too many readings, an answer
//   not the shape — changes nothing and shoots nothing, and offers the
//   words as what happens on a press (it used to make them what happens and,
//   in "Shoot without asking", shoot them: a paid still of unread words);
// - the Sets home's own message is the only "build" turn, and the address
//   forgets it with the message (check of the spec, item 4);
// - the month's changes left follow every answer that carries a number.
//
// Read as source: the page needs a browser and a stage.

const view = readFileSync(join(__dirname, "../../components/sets/set-view.tsx"), "utf8");
const home = readFileSync(join(__dirname, "../../components/sets/sets-home.tsx"), "utf8");
const page = readFileSync(join(__dirname, "../../app/app/sets/[id]/page.tsx"), "utf8");
const bodyOf = (source: string, signature: string, end = "\n  }\n") => {
  const at = source.indexOf(signature);
  expect(at, signature).toBeGreaterThan(-1);
  return source.slice(at, source.indexOf(end, at));
};
const between = (source: string, from: string, to: string) => {
  const start = source.indexOf(from);
  expect(start, from).toBeGreaterThan(-1);
  const end = source.indexOf(to, start + from.length);
  expect(end, to).toBeGreaterThan(start);
  return source.slice(start, end);
};

const send = bodyOf(view, "  async function send(text: string, opts?: { origin?: \"build\" }) {");

describe("a change to the set itself waits for a press on the Astra card", () => {
  it("never calls Astra from a message: the edit branch shows the card", () => {
    const edit = between(send, 'if (words.intent === "edit" && !built) {', "\n    }\n");
    expect(edit).toContain("askAstraCard(message);");
    expect(edit).toContain("return;");
    expect(send).not.toContain("editSet(");
  });

  it("calls editSet from the card's own button, and nowhere else", () => {
    // The definition and v1's card; the chat's own card calls it through
    // goAstra (set-view-turn.test.ts), once step 11a is in.
    expect(view.match(/\beditSet\(/g)!.length).toBeLessThanOrEqual(3);
    expect(view).toContain("  async function editSet(\n    change: { said: string; gloss?: string | null; seal?: string | null },\n    frame: EditFrame | null,");
    const card = between(view, "<AstraChangeCard\n                      words={astraAsk.words}", "/>");
    const onGo = between(card, "onGo={() => {", "}}");
    expect(onGo).toContain("const { quoted } = astraCardWords(astraAsk.words);");
    expect(onGo).toContain("setAstraAsk(null);");
    // v1 sends only the words it quoted: no reading, no frame — the request is exactly as before.
    expect(onGo).toContain("void editSet({ said: quoted }, null);");
    // Not now spends nothing.
    expect(card).toContain("onNotNow={() => setAstraAsk(null)}");
  });

  it("sends the human-ruler fix through the card too: it is one of the month's changes", () => {
    const scale = between(view, "{scaleWarn && !takeStart && !viewingShot && (", "{s.scaleWarnFix}");
    expect(scale).toContain("askAstraCard(s.scaleFixAsk);");
    expect(scale).not.toContain("editSet(");
  });

  it("hands the card the month's count, the plan's cap and the set's size, as the action judges them", () => {
    const card = between(view, "<AstraChangeCard\n                      words={astraAsk.words}", "/>");
    expect(card).toContain("editsLeft={editsLeft}");
    expect(card).toContain("editsCap={astraEditsCap}");
    expect(card).toContain("tooBig={astraTooBig(spec)}");
    // Busy while a match or a followed press is out too: a press editSet would refuse never clears the card (review of Cut 2, N3, R5).
    expect(card).toContain("busy={reading || shooting || editingSet || matching || following !== null || !ready}");
    const onGo = between(card, "onGo={() => {", "}}");
    expect(onGo.indexOf("if (b.editing || b.shooting || b.taking || b.matching) return;")).toBeGreaterThan(-1);
    expect(onGo.indexOf("if (b.editing || b.shooting || b.taking || b.matching) return;")).toBeLessThan(onGo.indexOf("setAstraAsk(null);"));
    // v1 offers no "Change it, then shoot": nothing is shot after an edit here.
    expect(card).toContain("shootCredits={null}");
    expect(card).not.toContain("onGoShoot");
  });

  it("holds an Astra press while anything else is out, as a rebuild does", () => {
    const edit = bodyOf(view, "  async function editSet(\n");
    const guard = edit.indexOf("if (busy.editing || busy.shooting || busy.taking || busy.matching) return none;");
    expect(guard).toBeGreaterThan(-1);
    expect(guard).toBeLessThan(edit.indexOf("busyRef.current.editing = true;"));
  });
});

describe("a reading that failed changes nothing and shoots nothing", () => {
  const failed = between(send, "    if (!words) {", "\n    }\n");

  it("says so, keeps the words for a press, and returns before anything moves", () => {
    expect(failed).toContain("if (!refused) setNote({ down: message, talk: false, moved: null });");
    expect(failed).toContain("return;");
    for (const act of ["shoot(", "take(", "setDirection(", "keepRevision(", "applyWords(", "editSet(", "askAstraCard("]) expect(failed, act).not.toContain(act);
    // Before Just talking and every other branch: nothing reads a null reading as words.
    expect(send.indexOf("    if (!words) {")).toBeLessThan(send.indexOf("if (justTalk) {"));
    expect(send.indexOf("    if (!words) {")).toBeLessThan(send.indexOf("applyWords(words)"));
  });

  it("an answer that is the server's own refusal says only that", () => {
    expect(send).toMatch(/if \(res\.error !== null\) \{\s*setError\(res\.error\);\s*refused = true;\s*\} else words = res\.words;/);
  });

  it("'Use my words as what happens' sets the words, on a press, and shoots nothing", () => {
    const own = bodyOf(view, "  function wordsAsHappens(message: string) {");
    expect(own).toContain("setDirection(message);");
    for (const act of ["shoot(", "take(", "editSet("]) expect(own, act).not.toContain(act);
    const line = between(view, "{note?.down !== undefined && (", "</p>");
    expect(line).toContain("{s.reply.replyReaderDown}");
    expect(line).toContain('onClick={() => wordsAsHappens(note.down ?? "")}');
    expect(line).toContain("{s.reply.useMyWords}");
  });

  it("no longer takes an unread message as what happens on its own", () => {
    expect(view).not.toContain("fallback: true");
    expect(view).not.toContain("s.wordsFallback");
  });
});

// Undo that gives back Astra's words too (Helios Cut 2, step 2, 2026-09-25).
describe("the changed line's Undo", () => {
  const undo = bodyOf(view, '  async function undoSetEdit(inTurn = false): Promise<"undone" | "textKept" | null> {');

  it("keeps each change's seal and kind with the set it replaced", () => {
    const edit = bodyOf(view, "  async function editSet(\n");
    expect(edit).toContain("const apply = (next: SetSpec, changed: number, undo: EditUndo | null = null) => {");
    expect(edit).toContain('lastEditUndoRef.current = { before, kind: "edit", undo };');
    expect(edit).toContain("return apply(res.spec, res.changed, res.undo);");
    // A read-back has no seal.
    expect(edit).toContain('if (followed.kind === "saved") return apply(followed.spec, followed.changed);');
    const rebuild = bodyOf(view, "  async function rebuildThing(key: string) {");
    expect(rebuild).toContain('lastEditUndoRef.current = { before, kind: "rebuild", undo: null };');
  });

  it("sends this change's seal, never Astra, and says what came back", () => {
    expect(undo).toContain("const last = lastEditUndoRef.current?.before === before ? lastEditUndoRef.current : null;");
    expect(undo).toContain("const res = await undoAstraEdit(setId, before, last?.undo ?? null);");
    for (const call of ["editSetWithAstra(", "editSet(", "rebuildThingFromPhotos(", "saveSetEdit("]) expect(undo, call).not.toContain(call);
    expect(undo).toContain('const said = last?.kind !== "rebuild" && !saved.textRestored ? "textKept" : "undone";');
    // The changed line's Undo says it where the line stood; a turn's Undo says it in its own reply.
    expect(undo).toContain("if (!inTurn) setUndoNote(said);");
    expect(undo).toContain("return said;");
    const note = between(view, "{undoNote !== null && (", "</div>");
    expect(note).toContain('{undoNote === "textKept" ? s.reply.noteUndoAstraText : s.reply.noteUndoAstra}');
  });

  it("says it once: the next message, or the next change, clears it", () => {
    expect(send).toContain("setUndoNote(null);");
    for (const signature of ["  async function editSet(\n", "  async function rebuildThing(key: string) {"]) {
      expect(bodyOf(view, signature), signature).toContain("setUndoNote(null);");
    }
  });
});

describe("the Sets home's message is the only build turn", () => {
  it("the home marks only its build branch", () => {
    const homeSend = bodyOf(home, "  async function send() {");
    expect(homeSend).toContain("router.push(threadHref(toSet, message));");
    expect(homeSend).toContain("router.push(threadHref(res.id, message, true));");
    expect(bodyOf(home, "  function threadHref(")).toContain('if (built) q.set("from", "build");');
  });

  it("the page reads it only beside the message it came with", () => {
    expect(page).toContain('const askBuilt = ask !== null && first(query.from) === "build";');
    expect(page).toContain("initialAskBuilt={askBuilt}");
  });

  it("the address forgets it with the message, and only the Sets home's message is sent as the build turn", () => {
    const effect = between(view, "if (!ready || !initialAsk || askedRef.current) return;", "}, [ready, initialAsk]);");
    expect(effect).toContain('for (const key of ["ask", "character", "askFirst", "from"]) url.searchParams.delete(key);');
    expect(effect).toContain('void send(initialAsk, initialAskBuilt ? { origin: "build" } : undefined);');
    // Nothing else passes an origin: the composer's own sends never do. The
    // chat's reader v2 hands the same message and its origin back to v1 when
    // the server says v2 is off (Helios Cut 2, step 11a).
    expect(view.match(/\{ origin: "build" \}/g)).toHaveLength(1);
    expect(view.match(/\bsend\([^,()]+,/g)).toEqual(["send(text: string,", "send(initialAsk,", "send(message,"]);
    expect(view).toContain("if (source === \"message\") void send(message, opts);");
    expect(view.match(/\bsendTurn\([^,()]+,/g)).toEqual(["sendTurn(message,", "sendTurn(message: string,", "sendTurn(turn.asked,"]);
  });

  it("a built message is framed, never carded — and a later edit still gets the card", () => {
    expect(send).toContain('const built = opts?.origin === "build" && words.intent === "edit";');
    expect(send).toContain("setNote({ built, talk: false, moved: moved && moved !== \"none\" ? moved : null });");
  });
});

describe("the month's changes left follow every answer that carries a number", () => {
  it("keeps only a number, never a null — except after a change that saved, when the count becomes unknown", () => {
    expect(view).toContain("const [editsLeft, setEditsLeft] = useState<number | null>(astraEditsLeft);");
    const keep = between(view, "const keepEditsLeft = (n: number | null | undefined, saved = false) => {", "};");
    // A number replaces it; a change that saved with no count leaves it unknown, one that didn't keeps it (review of Cut 2, S4).
    expect(keep).toContain('const next = typeof n === "number" && Number.isFinite(n) ? Math.max(0, n) : saved ? null : undefined;');
    expect(keep).toContain("if (next !== undefined) setEditsLeft(next);");
    // Every write goes through it.
    expect(view.match(/setEditsLeft\(/g)).toHaveLength(1);
  });

  it("an edit's and a rebuild's answers, saved or not, and a followed press once it has ended", () => {
    for (const signature of ["  async function editSet(\n", "  async function rebuildThing(key: string) {"]) {
      const body = bodyOf(view, signature);
      expect(body, signature).toContain('if (followed.kind === "saved" || followed.kind === "unsaved") keepEditsLeft(followed.editsLeft, followed.kind === "saved");');
      // Before the error branch: a refusal's count is kept too.
      const kept = body.indexOf("keepEditsLeft(res.editsLeft, res.error === null);");
      expect(kept, signature).toBeGreaterThan(-1);
      expect(kept, signature).toBeLessThan(body.indexOf("if (res.error !== null) {"));
    }
  });

  it("the changed line says what is left after a landed change, in the Build editor's words", () => {
    const line = between(view, "{setChanged !== null && (", "{s.editorUndo}");
    expect(line).toContain("{editsLeft !== null && (");
    expect(line).toContain("editsLeft === 0 ? s.editorAskLeftNone : editsLeft === 1 ? s.editorAskLeftOne : formatMsg(s.editorAskLeft, { n: editsLeft })");
  });

  it("is handed the count and the cap by the set page", () => {
    expect(page).toContain("astraEditsLeft={data.astraEditsLeft}");
    expect(page).toContain("astraEditsCap={data.astraEditsCap}");
  });
});
