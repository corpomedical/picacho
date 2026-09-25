import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import en from "../i18n/messages/en";
import es from "../i18n/messages/es";
import pt from "../i18n/messages/pt";
import it_ from "../i18n/messages/it";
import { formatMsg } from "../i18n/format";

// The set page's paid presses (2026-09-25, Cut 1 — operator: "GO ahead" on
// "never charge twice, and films that behave"):
// - every paid press sends its own id, so a browser's silent resend of it is
//   followed on the server instead of rendered and charged again;
// - a press whose answer was lost (a dropped connection, the platform's
//   300 s cut-off) is followed by that id with the press held, never "try
//   again" while the paid render goes on, and a film keeps the beat;
// - Download saves the finished still or take itself, and the sketch's
//   download is named as the sketch;
// - the panel names the engine the stills are actually drawn with.
//
// Read as source: the page needs a browser and a stage.

const view = readFileSync(join(__dirname, "../../components/sets/set-view.tsx"), "utf8");
const bodyOf = (signature: string, end = "\n  }\n") => {
  const at = view.indexOf(signature);
  expect(at, signature).toBeGreaterThan(-1);
  return view.slice(at, view.indexOf(end, at));
};
const between = (source: string, from: string, to: string) => {
  const start = source.indexOf(from);
  expect(start, from).toBeGreaterThan(-1);
  const end = source.indexOf(to, start + from.length);
  expect(end, to).toBeGreaterThan(start);
  return source.slice(start, end);
};

const HANDLERS = [
  { signature: "  async function shoot(", flag: "shooting", call: "await shootInSet(", read: "shotPressRead(pressId)" },
  { signature: "  async function take(", flag: "taking", call: "await takeInSet(", read: "takePressRead(pressId)" },
  { signature: "  async function retryClip(", flag: "taking", call: "await takeInSet(", read: "takePressRead(pressId)" },
] as const;

describe("every paid press sends its own id", () => {
  it("mints one for Shoot, Take and Try the clip again, once held and just before the send", () => {
    for (const h of HANDLERS) {
      const body = bodyOf(h.signature);
      const minted = body.indexOf("const pressId = newPressId();");
      expect(minted, h.signature).toBeGreaterThan(body.indexOf(`busy.${h.flag} = true;`));
      expect(minted, h.signature).toBeLessThan(body.indexOf(h.call));
      const sent = body.slice(body.indexOf(h.call), body.indexOf("});", body.indexOf(h.call)));
      expect(sent, h.signature).toMatch(/\(setId, \{\s*pressId,/);
    }
  });

  it("mints one per film Render, after it is allowed to start, and each beat says which it is", () => {
    const render = bodyOf("  async function renderFilm(");
    const minted = render.indexOf("const pressId = newPressId();");
    expect(minted).toBeGreaterThan(render.indexOf("const unsheeted = await drawSheetsFor("));
    expect(minted).toBeGreaterThan(render.indexOf("if (refused) {"));
    expect(minted).toBeLessThan(render.indexOf("for (const job of plan.jobs) {"));
    // One Render is one press on the server (press.ts filmBeatPressId): its beats share the id.
    expect(render.match(/newPressId\(\)/g)).toHaveLength(1);
    const sent = render.slice(render.indexOf("result = await takeInSet(setId, {"), render.indexOf("});", render.indexOf("result = await takeInSet(setId, {")));
    expect(sent).toContain("result = await takeInSet(setId, {\n            pressId,\n            filmBeat: i,\n            startGenerationId: startId,");
  });

  it("never keeps an id past its press", () => {
    expect(view.match(/newPressId\(\)/g)).toHaveLength(4);
    expect(view).not.toMatch(/use(State|Ref)[^\n]*pressId/);
  });
});

describe("a lost answer is followed, never 'try again'", () => {
  it("follows a throw after the send with the press held, and reloads only for a deploy", () => {
    for (const h of HANDLERS) {
      const body = bodyOf(h.signature);
      const tried = between(body, h.call, "} catch (err) {");
      const caught = between(body, "} catch (err) {", "} finally {");
      const released = between(body, "} finally {", "\n    }\n");
      // A resend's "still rendering" answer is followed the same way.
      expect(tried, h.signature).toContain("if (stillGoingAnswer(result.error)) {");
      expect(tried, h.signature).toContain(h.read);
      // A deploy answers at once; a throw at the platform's ceiling is followed, not reloaded over.
      const notCut = caught.indexOf("if (!cutOff(sentAt, new Date().getTime())) {");
      expect(notCut, h.signature).toBeGreaterThan(-1);
      const stale = caught.indexOf("const stale = staleHere(err);");
      expect(stale, h.signature).toBeGreaterThan(notCut);
      expect(caught.indexOf("setError(t.generate.refreshNeeded);"), h.signature).toBeGreaterThan(stale);
      expect(caught, h.signature).toContain("await followLost(");
      expect(caught, h.signature).toContain(h.read);
      expect(caught, h.signature).toContain("setFollowing(true);");
      // Shoot is let go only once the follow is over.
      expect(released, h.signature).toContain("setFollowing(false);");
      expect(released, h.signature).toContain(`busyRef.current.${h.flag} = false;`);
    }
  });

  it("says 'couldn't reach the server' only when nothing was sent", () => {
    for (const signature of ["  async function shoot(", "  async function take("]) {
      const body = bodyOf(signature);
      const caught = between(body, "} catch (err) {", "} finally {");
      expect(caught.match(/t\.generate\.submitFailed/g), signature).toHaveLength(1);
      expect(caught, signature).toMatch(/if \(sentAt === null\) \{\s*setError\(t\.generate\.submitFailed\);\s*return;\s*\}/);
      // Sent is from the line before the call.
      expect(body, signature).toMatch(/sentAt = new Date\(\)\.getTime\(\);\s*result = await (shootInSet|takeInSet)\(setId, \{/);
    }
  });

  it("never offers a clip for a second paid press while the first may still land", () => {
    const retry = bodyOf("  async function retryClip(");
    expect(retry).not.toContain("nothing was rendered");
    // A throw is followed: it never says "couldn't reach the server" and offers the frames again.
    expect(between(retry, "} catch (err) {", "} finally {")).not.toContain("t.generate.submitFailed");
    expect(retry.match(/offerAgain = followed\.kind === "landed" \|\| followed\.kind === "never-started";/g)).toHaveLength(2);
    expect(retry).toContain("if (offerAgain) setTakeRetry(f);");
  });

  it("keeps a film's beat whose answer was lost, and goes on from it", () => {
    const render = bodyOf("  async function renderFilm(");
    const call = render.indexOf("result = await takeInSet(setId, {");
    const beat = render.slice(call, render.indexOf("if (result.error !== null) {", call));
    expect(beat).toContain("if (stillGoingAnswer(result.error)) result = await followBeat();");
    const caught = beat.slice(beat.indexOf("} catch (err) {"));
    expect(caught).toContain("if (!cutOff(sentAt, new Date().getTime())) {");
    expect(caught).toContain("const stale = staleHere(err);");
    expect(caught).toContain("setFilmError(t.generate.refreshNeeded);");
    expect(caught).toContain("result = await followBeat();");
    expect(caught).not.toContain("t.generate.submitFailed");
    // The follow says so on the button and the beat, and reads the beat by the Render's id.
    const follow = between(render, "const followBeat = async (): Promise<TakeAnswer> => {", "};");
    expect(follow).toContain("setFilmBusy({ beat: i, clipOnly: job.end !== null, following: true });");
    expect(follow).toContain("await followLost(sentAt, takePressRead(pressId, i));");
    expect(follow).toContain("return lostAnswer(followed, beatWords);");
    // What lands goes through the code an answer takes: kept on the film (keep) after it.
    expect(render.indexOf("keep({", call)).toBeGreaterThan(render.indexOf("result = await followBeat();"));
  });

  it("reads a press back by its id, and asks again when a read fails", () => {
    for (const signature of ["  function shotPressRead(pressId: string) {", "  function takePressRead(pressId: string, filmBeat?: number) {"]) {
      const read = bodyOf(signature);
      expect(read, signature).toContain("await readSetPress(setId,");
      expect(read, signature).toContain('staleHere(err) ? { state: "error", error: t.generate.refreshNeeded } : null');
    }
    expect(bodyOf("  function shotPressRead(pressId: string) {")).toContain('return pressReadOf(r, "shot");');
    expect(bodyOf("  function takePressRead(pressId: string, filmBeat?: number) {")).toContain('return pressReadOf(r, "take");');
    expect(view).toContain("return followPress<T>({ sentAt, read, alive: () => aliveRef.current });");
  });

  it("says it is still rendering while it follows", () => {
    expect(view).toContain("? (following ? s.pressFollowingShort : s.shooting)");
    expect(view).toContain("editingSet ? s.editorAsking : following ? s.pressFollowing : shooting ?");
    expect(view).toContain("formatMsg(filmBusy.following ? s.filmBeatFollowing : filmBusy.clipOnly ? s.filmRenderingClip : s.filmRendering,");
    expect(view.match(/\{filmBusy\.following \? s\.filmBeatFollowingShort : filmBusy\.clipOnly \? s\.filmBeatClip : s\.filmBeatStill\}/g)).toHaveLength(2);
    expect(view).toMatch(/\{following && simpleStep === "shoot" && \([\s\S]{0,200}data-press-following>\s*\{s\.pressFollowing\}/);
  });
});

describe("Download saves the finished still", () => {
  it("names the sketch as the sketch", () => {
    expect(bodyOf("  function downloadFrame() {")).toContain("-sketch.jpg");
    expect(view).not.toContain("-frame.jpg");
  });

  it("saves the original file the way History does", () => {
    const shot = bodyOf("  async function downloadShot(shot: SetShot) {");
    for (const needle of [
      "shotFileUrl(shot)",
      "shotFileName(title, shot.kind, stillNumber(shot), url)",
      "isNativeAppClient()",
      "downloadResultNative(url, name)",
      "downloadResult(url, name)",
      "recordDownload(shot.generationId).catch(",
      "shotFileBusyRef.current = false;",
    ]) {
      expect(shot, needle).toContain(needle);
    }
  });

  it("puts it on the bar's icon and in the viewer", () => {
    const bar = between(view, "onClick={viewingFile && viewingShot ?", "</button>");
    expect(bar).toContain("onClick={viewingFile && viewingShot ? () => void downloadShot(viewingShot) : downloadFrame}");
    expect(bar).toContain("title={barDownloadLabel}");
    expect(bar).toContain("aria-label={barDownloadLabel}");
    expect(bar).toContain("data-bar-download");
    expect(view).toContain('const barDownloadLabel = viewingFile ? (viewingShot?.kind === "take" ? s.downloadTake : s.downloadStill) : s.downloadFrame;');
    const viewer = between(view, "data-shot-download", "</button>");
    expect(viewer).toContain('{viewingShot.kind === "take" ? s.downloadTake : s.downloadStill}');
    expect(view).toContain("onClick={() => void downloadShot(viewingShot)} className={glassBtn} data-shot-download>");
  });
});

describe("the panel names the engine picked", () => {
  it("says the one source's name everywhere", () => {
    expect(view).toContain("const stillEngineName = getImageModel(stillEngine).name;");
    expect(view).toContain("formatMsg(s.panelMeta, { engine: stillEngineName })");
    expect(view).toContain("formatMsg(s.shootingLine, { engine: stillEngineName })");
    expect(view).toContain("{stillEngineName} · {credits}");
    expect(view).not.toContain("{s.panelMeta}");
    expect(view).not.toContain("s.engineChip");
  });
});

describe("the words, in all four languages", () => {
  const catalogs = { en, es, pt, it: it_ };
  const HISTORY = { en: "History", es: "Historial", pt: "Histórico", it: "Cronologia" } as const;
  const SKETCH = { en: "sketch", es: "boceto", pt: "esboço", it: "schizzo" } as const;

  it("says a lost press is still rendering, and when it did not start", () => {
    for (const [lang, m] of Object.entries(catalogs) as [keyof typeof catalogs, typeof en][]) {
      const s = m.sets;
      for (const key of [
        "pressFollowing",
        "pressFollowingShort",
        "pressNeverStarted",
        "pressStillGoing",
        "filmBeatFollowing",
        "filmBeatFollowingShort",
        "filmBeatNeverStarted",
        "filmBeatStillGoing",
      ] as const) {
        expect(s[key].trim(), `${lang} ${key}`).not.toBe("");
      }
      expect(s.filmBeatFollowing, lang).toContain("{i}");
      expect(s.filmBeatFollowing, lang).toContain("{n}");
      expect(s.filmBeatNeverStarted, lang).toContain("{n}");
      expect(s.filmBeatStillGoing, lang).toContain("{n}");
      expect(s.pressStillGoing, lang).toContain(HISTORY[lang]);
      expect(s.filmBeatStillGoing, lang).toContain(HISTORY[lang]);
    }
    expect(en.sets.pressNeverStarted).toContain("nothing was charged");
  });

  it("names the sketch, the still and the take apart", () => {
    for (const [lang, m] of Object.entries(catalogs) as [keyof typeof catalogs, typeof en][]) {
      const s = m.sets;
      expect(s.downloadFrame, lang).toContain(SKETCH[lang]);
      for (const key of ["downloadStill", "downloadTake"] as const) {
        expect(s[key].trim(), `${lang} ${key}`).not.toBe("");
        expect(s[key], `${lang} ${key}`).not.toBe(s.downloadFrame);
      }
      expect(s.downloadStill, lang).not.toBe(s.downloadTake);
    }
  });

  it("carries no engine's name of its own", () => {
    for (const [lang, m] of Object.entries(catalogs) as [keyof typeof catalogs, typeof en][]) {
      expect(m.sets.shootingLine, lang).toContain("{engine}");
      expect(m.sets.panelMeta, lang).toContain("{engine}");
      expect(JSON.stringify(m.sets), lang).not.toContain("GPT Image");
      expect(JSON.stringify(m.sets), lang).not.toContain("Nano Banana");
      expect("engineChip" in m.sets, lang).toBe(false);
      const meta = formatMsg(m.sets.panelMeta, { engine: "Nano Banana Pro" });
      expect(meta, lang).toContain("Nano Banana Pro");
      expect(meta, lang).not.toContain("{");
    }
  });
});
