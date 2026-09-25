import { describe, expect, it } from "vitest";
import { bundlePlan, footageInPage } from "./export";
import { buildZip } from "./zip";

describe("the render bundle", () => {
  const clips = [{ path: "u/e/clip-0.mp4" }, { path: "u/e/clip-1.mp4" }, { path: "u/e/clip-2.mov" }];
  const page = '<video src="footage/clip-0.mp4"></video><video src="footage/clip-0.mp4"></video><video src="footage/clip-2.mov"></video><audio src="assets/sfx/hit.mp3"></audio><video src="footage/clip-9.mp4"></video>';

  it("takes only the customer's clips the edit plays, once each, as the page names them", () => {
    expect(footageInPage(page, clips)).toEqual([
      { name: "footage/clip-0.mp4", path: "u/e/clip-0.mp4" },
      { name: "footage/clip-2.mov", path: "u/e/clip-2.mov" },
    ]);
  });

  it("carries the project's own files but not the pages it replaces or the agent's notes", () => {
    const manifest = {
      dir: "u/e/projects/g",
      entry: "index.html",
      files: ["index.html", "assets/vendor/gsap.min.js", "assets/sfx/hit.mp3", "CLAUDE.md", "AGENTS.md", "hyperframes.json", "meta.json"].map((path) => ({ path, bytes: 1 })),
    };
    expect(bundlePlan(page, manifest, clips).project).toEqual(["assets/vendor/gsap.min.js", "assets/sfx/hit.mp3", "hyperframes.json", "meta.json"]);
  });

  it("zips it the way HeyGen reads a project (stored entries, names kept, nothing climbing out)", () => {
    const zip = buildZip([
      { name: "index.html", data: new TextEncoder().encode("<html></html>") },
      { name: "footage/clip-0.mp4", data: new Uint8Array([1, 2, 3]) },
    ]);
    const text = Buffer.from(zip).toString("latin1");
    expect(text.startsWith("PK\u0003\u0004")).toBe(true);
    expect(text).toContain("footage/clip-0.mp4");
    expect(() => buildZip([{ name: "../x", data: new Uint8Array() }])).toThrow("refusing");
  });
});
