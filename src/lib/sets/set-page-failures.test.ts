import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

// Helios keeps going when a call fails (2026-09-16). The set page's Astra
// change had no catch: a call that threw (a dropped connection, a deploy
// landing while the page was open) left the conversation on "Astra is
// changing the set…" for good, with every message refused. Its Undo never
// read the save's answer, so a failed save showed the old set while the
// server kept the new one. The rig, the film, the take poll, the card
// picture and the camera were fire-and-forget: a throw was an unhandled
// rejection, which the error reporter turned into a report or an instant
// reload that took the unsaved change with it. The editor showed
// "Saving…" for good after a thrown save, and Done left whether or not the
// copy had saved. Read as source: client components do not load here.

const dir = join(__dirname, "../../components/sets");
const view = readFileSync(join(dir, "set-view.tsx"), "utf8");
const editor = readFileSync(join(dir, "set-editor.tsx"), "utf8");
const between = (source: string, from: string, to: string) => {
  const start = source.indexOf(from);
  expect(start, from).toBeGreaterThan(-1);
  const end = source.indexOf(to, start + from.length);
  expect(end, to).toBeGreaterThan(start);
  return source.slice(start, end);
};

/** The index of the bracket that closes the one opened at `open`. */
function closing(source: string, open: number): number {
  const pairs: Record<string, string> = { "(": ")", "{": "}", "[": "]" };
  const stack: string[] = [];
  for (let i = open; i < source.length; i++) {
    const c = source[i];
    if (pairs[c]) stack.push(pairs[c]);
    else if (c === ")" || c === "}" || c === "]") {
      if (stack.pop() !== c) throw new Error(`unbalanced at ${i}`);
      if (stack.length === 0) return i;
    }
  }
  throw new Error("unclosed");
}

/** Whether the call at `at` sits inside the body of a `try` (not its catch or finally), within its function. */
function insideTry(source: string, at: number): boolean {
  let depth = 0;
  for (let i = at; i >= 0; i--) {
    const c = source[i];
    if (c === "}") depth++;
    else if (c === "{") {
      if (depth > 0) {
        depth--;
        continue;
      }
      const before = source.slice(Math.max(0, i - 40), i);
      if (/\btry\s*$/.test(before)) return true;
      // The enclosing function's own braces end the search.
      if (/(=>|\bfunction\b[^{]*\))\s*$/.test(before) || /^\s*(async\s+)?function\b/m.test(source.slice(source.lastIndexOf("\n", i) + 1, i))) {
        return false;
      }
    }
  }
  return false;
}

type Call = { file: string; name: string; line: number; handled: boolean };

/** Every call of a Helios server action in a client file, and whether a throw from it is handled. */
function actionCalls(file: string, source: string): Call[] {
  const code = source.replace(/^\s*\/\/.*$/gm, (m) => " ".repeat(m.length));
  const names = [...code.matchAll(/import \{([^}]*)\} from "@\/lib\/sets\/(?:[\w-]+-)?actions"/g)].flatMap((m) =>
    m[1]
      .split(",")
      .map((n) => n.trim())
      .filter(Boolean),
  );
  const calls: Call[] = [];
  for (const name of names) {
    for (const m of code.matchAll(new RegExp(`\\b${name}\\(`, "g"))) {
      const at = m.index ?? 0;
      const end = closing(code, at + name.length);
      const after = code.slice(end + 1);
      let handled = false;
      if (after.startsWith(".catch(")) handled = true;
      else if (after.startsWith(".then(")) {
        const thenOpen = end + 1 + ".then".length;
        const thenClose = closing(code, thenOpen);
        const args = code.slice(thenOpen + 1, thenClose);
        // Two arguments at the top level: the second handles the rejection.
        let depth = 0;
        let comma = false;
        for (const c of args) {
          if ("({[".includes(c)) depth++;
          else if (")}]".includes(c)) depth--;
          else if (c === "," && depth === 0) comma = true;
        }
        handled = comma || code.slice(thenClose + 1).startsWith(".catch(");
      } else {
        handled = /\bawait\s+$/.test(code.slice(Math.max(0, at - 12), at)) && insideTry(code, at);
      }
      calls.push({ file, name, line: code.slice(0, at).split("\n").length, handled });
    }
  }
  return calls;
}

describe("every Helios server call a page makes", () => {
  it("handles a throw: awaited inside a try, or given a rejection handler", () => {
    const calls = readdirSync(dir)
      .filter((f) => f.endsWith(".tsx"))
      .flatMap((f) => actionCalls(f, readFileSync(join(dir, f), "utf8")));
    // The pages that talk to the server are all here.
    const files = new Set(calls.map((c) => c.file));
    for (const f of ["set-view.tsx", "set-editor.tsx", "sets-home.tsx", "set-building.tsx"]) expect(files, f).toContain(f);
    expect(calls.length).toBeGreaterThan(20);
    expect(calls.filter((c) => !c.handled).map((c) => `${c.file}:${c.line} ${c.name}`)).toEqual([]);
  });

  it("is told apart by the scan", () => {
    const fake = (body: string) =>
      actionCalls("fake.tsx", `import { saveSetRig } from "@/lib/sets/rig-actions";\nasync function f() {\n${body}\n}\n`)[0].handled;
    expect(fake("void saveSetRig(id, rig);")).toBe(false);
    expect(fake("void saveSetRig(id, rig).then((r) => setRigError(r.error ?? ''));")).toBe(false);
    expect(fake("const r = await saveSetRig(id, rig);")).toBe(false);
    expect(fake("try {\n  x();\n} catch {}\nconst r = await saveSetRig(id, rig);")).toBe(false);
    expect(fake("try {\n  x();\n} finally {\n  await saveSetRig(id, rig);\n}")).toBe(false);
    expect(fake("try {\n  const r = await saveSetRig(id, { a: [1] });\n} catch {}")).toBe(true);
    expect(fake("saveSetRig(id, rig).then((r) => ok(r), (err) => failed(err));")).toBe(true);
    expect(fake("saveSetRig(id, rig).catch(() => {});")).toBe(true);
    expect(fake("try {\n  run(async () => {\n    await saveSetRig(id, rig);\n  });\n} catch {}")).toBe(false);
  });
});

describe("the set page", () => {
  it("lets the conversation go when an Astra change throws", () => {
    const edit = between(view, "async function editSet(message: string) {", "\n  }\n");
    expect(edit).toMatch(/try \{\s*res = await editSetWithAstra\(setId, message\);\s*\} catch \(err\) \{/);
    expect(edit).toMatch(/\} finally \{\s*(?:busyRef\.current\.editing = false;\s*)?setEditingSet\(false\);\s*\}/);
    expect(edit).toContain("if (!leftBehind(err)) setError(t.generate.submitFailed);");
  });

  it("shows an Undo only once it is saved, and says when it is not", () => {
    const undo = between(view, "async function undoSetEdit() {", "\n  }\n");
    expect(undo).toContain("if (!before || undoingRef.current) return;");
    const saved = undo.indexOf("failed = (await saveSetEdit(setId, before)).error;");
    const told = undo.indexOf("setError(failed);");
    const shown = undo.indexOf("setSpec(before);");
    expect(saved).toBeGreaterThan(-1);
    expect(told).toBeGreaterThan(saved);
    expect(shown).toBeGreaterThan(told);
    expect(undo.slice(0, shown)).not.toContain("specBeforeEditRef.current = null;\n    setSetChanged(null);\n    setSpec(");
  });

  it("keeps a rig or a film that did not save, and puts it back after a reload", () => {
    const rig = between(view, "const rigLoadedRef = useRef(false);", "}, [rig, setId, leftBehind]);");
    expect(rig).toContain('const missed = () => keepUnsaved(setId, "rig", rig, rigSavedRef.current);');
    expect(rig).toMatch(/const sentAt = new Date\(\)\.getTime\(\);\s*saveSetRig\(setId, rig\)\.then\(/);
    expect(rig).toMatch(
      /if \(r\.error !== null\) \{\s*missed\(\);\s*return;\s*\}\s*rigSavedRef\.current = savedRigKey\(rig\);\s*dropUnsaved\(setId, "rig", sentAt\);/,
    );
    expect(rig).toMatch(/\(err\) => \{\s*missed\(\);\s*if \(!leftBehind\(err\)\) setRigError\(SET_SAVE_FAILED\);/);
    const film = between(view, "const saveFilm = useCallback(", "[setId, leftBehind],");
    expect(film).toContain('const missed = () => keepUnsaved(setId, "film", next, filmSavedRef.current);');
    expect(film).toMatch(/const sentAt = new Date\(\)\.getTime\(\);\s*saveSetFilm\(setId, next\)\.then\(/);
    expect(film).toMatch(/filmSavedRef\.current = savedFilmKey\(next\);\s*dropUnsaved\(setId, "film", sentAt\);/);
    expect(film).toMatch(/missed\(\);\s*setFilmError\(r\.error\);/);
    expect(film).toMatch(/\(err\) => \{\s*missed\(\);\s*if \(!leftBehind\(err\)\) setFilmError\(SET_SAVE_FAILED\);/);
    // The render keeps each beat the moment it lands through the same save.
    expect(between(view, "const keep = (next: SetFilm) => {", "};")).toContain("saveFilm(next);");
    // Once a deploy has left the tab behind, the autosaves only keep.
    expect(rig).toMatch(/if \(staleRef\.current\) \{\s*missed\(\);\s*return;\s*\}/);
    expect(film).toMatch(/if \(staleRef\.current\) \{\s*missed\(\);\s*return;\s*\}/);
    // Back after the reload, onto the copy each was made from.
    const back = between(view, "// A rig or a film the last load of this page could not save", "}, [setId]);");
    expect(back).toContain('takeUnsaved(setId, "rig", rigSavedRef.current)');
    expect(back).toContain("setRig(normaliseSetRig(keptRig))");
    expect(back).toContain('takeUnsaved(setId, "film", filmSavedRef.current)');
    expect(back).toContain("setFilm(normaliseSetFilm(keptFilm))");
    expect(view).toContain("const [loadedRigKey] = useState(() => savedRigKey(savedRig));");
    expect(view).toContain("const [loadedFilmKey] = useState(() => savedFilmKey(savedFilm));");
  });

  it("reloads a tab a deploy left behind once, and says so", () => {
    // The guard is staleHere's, and leftBehind is that plus the page's own
    // error line: every place that used to reload by itself — the match, the
    // shoot, the take, a film beat, a retry, the words reader — now asks
    // staleHere, so one tab reloads once (2026-09-18).
    const guard = between(view, "const staleHere = useCallback((err: unknown): boolean => {", "}, []);");
    expect(guard).toContain("if (!isStaleDeployError(err)) return false;");
    expect(guard).toContain("if (reloadForNewDeploy({ delayMs: 1800 })) staleRef.current = true;");
    const behind = between(view, "const leftBehind = useCallback(", "[staleHere, refreshNeeded],");
    expect(behind).toContain("if (!staleHere(err)) return false;");
    expect(behind).toContain("setError(refreshNeeded);");
    // And nothing on this page reloads on its own any more.
    expect(view).not.toContain("location.reload");
    expect(view.match(/const stale = staleHere\(err\);/g)?.length ?? 0).toBeGreaterThanOrEqual(6);
    // The polls and the best-effort saves reload through it too.
    expect(view).toContain("(err) => void leftBehind(err),");
    expect(view).toContain("saveSetLayout(setId, { ...layoutRef.current, camera: api.pose() }).catch((err) => void leftBehind(err));");
    expect(view.match(/saveSetThumbnail\(setId, thumb\)\.catch\(\(err\) => void leftBehind\(err\)\);/g)).toHaveLength(2);
  });
});

describe("the Build editor", () => {
  const save = between(editor, "async function saveCopy(copy: SetSpec, clear = false): Promise<boolean> {", "\n  }\n");
  const missed = between(editor, "function saveMissed(copy: SetSpec, err: unknown): boolean {", "\n  }\n");

  it("never stays on 'Saving…' after a save throws, and keeps the copy that did not save", () => {
    expect(save).toMatch(/try \{\s*error = \(clear \? await clearSetEdit\(setId\) : await saveSetEdit\(setId, copy\)\)\.error;\s*\} catch \(err\) \{\s*if \(!saveMissed\(copy, err\)\) setSaveState\("failed"\);/);
    expect(save).toMatch(/if \(error !== null\) \{\s*saveMissed\(copy, null\);\s*setSaveState\("failed"\);/);
    expect(save).toMatch(/const sentAt = new Date\(\)\.getTime\(\);\s*try \{/);
    expect(save).toMatch(/savedKeyRef\.current = savedEditKey\(copy\);\s*dropUnsaved\(setId, "edit", sentAt\);/);
    expect(missed).toContain('keepUnsaved(setId, "edit", copy, savedKeyRef.current);');
    expect(missed).toContain('before: () => keepUnsaved(setId, "edit", specRef.current, savedKeyRef.current),');
    expect(missed).toContain("setAskError(t.generate.refreshNeeded);");
    expect(between(editor, "function scheduleSave(next: SetSpec) {", "\n  }\n")).toContain("void saveCopy(next);");
    // Going back to Astra's original saves the same way.
    expect(between(editor, "async function restoreOriginal() {", "\n  }\n")).toContain("await saveCopy(original, true);");
  });

  it("does not leave a copy behind unasked, and stays for a reload", () => {
    const done = between(editor, "async function done(to: string = closeHref) {", "\n  }\n");
    // Left behind on purpose, a copy is forgotten rather than put back later.
    expect(done).toMatch(
      /if \(dirtyRef\.current && !\(await saveCopy\(specRef\.current\)\)\) \{\s*if \(staleRef\.current \|\| !window\.confirm\(s\.editorLeaveUnsaved\)\) return;\s*\/\/ Left behind on purpose: it does not come back\.\s*dropUnsaved\(setId, "edit"\);\s*\}/,
    );
    expect(done.indexOf("await saveCopy(")).toBeLessThan(done.indexOf("router.push(to);"));
  });

  it("saves a change made by hand before Astra is asked", () => {
    const ask = between(editor, "async function sendAsk() {", "\n  }\n");
    const flush = ask.indexOf("if (!(await saveCopy(specRef.current))) {");
    expect(flush).toBeGreaterThan(-1);
    expect(flush).toBeLessThan(ask.indexOf("r = await editSetWithAstra(setId, text);"));
    expect(ask).toMatch(/if \(!staleRef\.current\) setAskError\(SET_SAVE_FAILED\);\s*setAsking\(false\);\s*return;/);
    // Astra's answer, saved by the server, holds whatever was kept before it was asked for.
    expect(ask).toMatch(/const askedAt = new Date\(\)\.getTime\(\);\s*try \{\s*r = await editSetWithAstra/);
    expect(ask).toMatch(/commitFromServer\(r\.spec\);\s*dropUnsaved\(setId, "edit", askedAt\);/);
  });

  it("puts a copy the last load could not save back, as an edit", () => {
    const back = between(editor, "// A copy the last load of this editor could not save", "}, [setId]);");
    expect(back).toContain('takeUnsaved(setId, "edit", savedKeyRef.current)');
    expect(back).toContain("if (n.ok) commitRef.current({ ok: true, spec: n.spec, notes: [] });");
    expect(editor).toContain("const [openedKey] = useState(() => savedEditKey(initialEdited ?? original));");
    expect(editor).toContain("commitRef.current = commit;");
    // A flush as the editor closes keeps what did not save, too.
    const flush = between(editor, "// A pending autosave flushes when the editor closes any way at all;", "}, [setId]);");
    expect(flush).toContain('() => keepUnsaved(setId, "edit", copy, base),');
    expect(flush).toMatch(/const sentAt = new Date\(\)\.getTime\(\);[\s\S]*else dropUnsaved\(setId, "edit", sentAt\);/);
  });
});
