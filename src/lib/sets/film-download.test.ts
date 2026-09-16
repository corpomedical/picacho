import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// "Download as one file" (canvas page H), on the set page: the rendered
// beats fetched and joined in the browser as they are (media/mp4-join.ts,
// proven there against ffmpeg). Read as source: client components do not
// load here.

const view = readFileSync(join(__dirname, "../../components/sets/set-view.tsx"), "utf8");
const between = (from: string, to: string) => {
  const start = view.indexOf(from);
  expect(start, from).toBeGreaterThan(-1);
  const end = view.indexOf(to, start + from.length);
  expect(end, to).toBeGreaterThan(start);
  return view.slice(start, end);
};

describe("the film's download", () => {
  const download = between("async function downloadFilm() {", "\n  }\n");

  it("joins the rendered beats the reel plays, in order, and hands over one file", () => {
    expect(download).toContain("if (filmFileBusy || !reelReady) return;");
    expect(download).toMatch(/reelShots\.map\(async \(shot\) => \{\s*const res = await fetch\(shot\.resultUrl!\);\s*if \(!res\.ok\) throw new Error/);
    expect(download).toContain("const joined = joinMp4(parts);");
    expect(download).toContain('new Blob([joined.bytes as Uint8Array<ArrayBuffer>], { type: "video/mp4" })');
    expect(download).toContain('a.download = `${(title || "set").toLowerCase().replace(/[^a-z0-9]+/g, "-")}-film.mp4`;');
    expect(download).toContain("setTimeout(() => URL.revokeObjectURL(href), 60_000);");
  });

  it("says why when it cannot, and lets go either way", () => {
    expect(download).toMatch(
      /if \(!joined\.ok\) \{\s*setFilmError\(\s*joined\.reason === "different"\s*\? s\.filmFileDifferent\s*: joined\.reason === "short-sound"\s*\? s\.filmFileShortSound\s*: s\.filmFileFailed,?\s*\);\s*return;\s*\}/,
    );
    expect(download).toMatch(/\} catch \{\s*setFilmError\(s\.filmFileFailed\);\s*\} finally \{\s*setFilmFileBusy\(false\);\s*\}/);
  });

  it("is offered in the dock and over the playing film, once every beat is rendered", () => {
    const dock = between("{reelReady && (\n                  <button type=\"button\" onClick={() => void downloadFilm()}", "</button>");
    expect(dock).toContain("disabled={filmFileBusy}");
    expect(dock).toContain("{filmFileBusy ? s.filmDownloading : `↓ ${s.filmDownload}`}");
    const reel = between("{reel !== null && reelReady && reelShots[reel] && (", "{/* A still in the stage's place");
    expect(reel).toContain("onClick={() => void downloadFilm()}");
    expect(reel).toContain("{filmFileBusy ? s.filmDownloading : `↓ ${s.filmDownload}`}");
    expect(view).toContain('import { joinMp4 } from "@/lib/media/mp4-join";');
  });
});
