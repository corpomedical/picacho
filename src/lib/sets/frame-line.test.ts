import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import en from "../i18n/messages/en";
import es from "../i18n/messages/es";
import pt from "../i18n/messages/pt";
import it_ from "../i18n/messages/it";

// The frame line under the chat (2026-09-25, found drawing Cut 2's replies):
// "The camera is at your own camera, 24 mm." — the own camera is lower-case
// inside the sentence, in every language; a set's named camera keeps its name.

describe("the frame line's own camera", () => {
  it("is the card's label with a lower-case first letter, in all four languages", () => {
    for (const [l, m] of Object.entries({ en, es, pt, it: it_ })) {
      const { yourCamera, yourCameraInline } = m.sets;
      expect(yourCameraInline, l).toBe(yourCamera.charAt(0).toLocaleLowerCase(l) + yourCamera.slice(1));
    }
  });

  it("is what the page puts in the sentence when the camera is its own", () => {
    const view = readFileSync(join(__dirname, "../../components/sets/set-view.tsx"), "utf8");
    expect(view).toContain("camera: cameraId ? cameraLabel : s.yourCameraInline");
  });
});
