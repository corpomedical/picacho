import { describe, expect, it } from "vitest";
import {
  SET_PHOTO_MAX_ASPECT,
  SET_PHOTO_MIN_SIDE_PX,
  isCurrentSetThumb,
  photoFit,
  setPhotoPath,
  setThumbPath,
} from "./set-config";
import { SET_PHOTO_TOO_SMALL } from "./messages";

// A set's card is taken again when it predates the set's current lift
// (exposure.ts): the path carries the version, and any other path is stale.

describe("set thumbnails", () => {
  const user = "11111111-1111-4111-8111-111111111111";
  const set = "22222222-2222-4222-8222-222222222222";

  it("keeps a card taken at the current version", () => {
    expect(isCurrentSetThumb(setThumbPath(user, set), user, set)).toBe(true);
  });

  it("retakes a card from before the lift, one lifted by exposure alone or with the figure measured, and a missing one", () => {
    expect(isCurrentSetThumb(`${user}/sets/${set}.jpg`, user, set)).toBe(false);
    expect(isCurrentSetThumb(`${user}/sets/${set}.v2.jpg`, user, set)).toBe(false);
    expect(isCurrentSetThumb(`${user}/sets/${set}.v3.jpg`, user, set)).toBe(false);
    expect(isCurrentSetThumb(null, user, set)).toBe(false);
    expect(isCurrentSetThumb(undefined, user, set)).toBe(false);
  });

  it("stays under the person's own sets folder, which deletion sweeps", () => {
    expect(setThumbPath(user, set).startsWith(`${user}/sets/`)).toBe(true);
  });
});

describe("a photo set's photo (2026-09-11)", () => {
  const user = "11111111-1111-4111-8111-111111111111";
  const set = "22222222-2222-4222-8222-222222222222";

  it("lives in the person's own sets folder, which account deletion sweeps", () => {
    expect(setPhotoPath(user, set).startsWith(`${user}/sets/`)).toBe(true);
    expect(setPhotoPath(user, set)).toBe(`${user}/sets/${set}.photo.jpg`);
  });

  it("is never mistaken for the card: a card pass never removes or keeps it as a thumbnail", () => {
    expect(setPhotoPath(user, set)).not.toBe(setThumbPath(user, set));
    expect(isCurrentSetThumb(setPhotoPath(user, set), user, set)).toBe(false);
  });
});

describe("photoFit", () => {
  it("scales a phone photo to 2048 on its long side", () => {
    expect(photoFit(4032, 3024)).toEqual({ ok: true, width: 2048, height: 1536 });
    expect(photoFit(3024, 4032)).toEqual({ ok: true, width: 1536, height: 2048 });
  });

  it("never enlarges a photo already small enough", () => {
    expect(photoFit(1600, 1200)).toEqual({ ok: true, width: 1600, height: 1200 });
  });

  it("refuses a photo too small to read the place from", () => {
    expect(photoFit(600, 900)).toEqual({ ok: false, reason: "small" });
    expect(photoFit(0, 900)).toEqual({ ok: false, reason: "small" });
    expect(photoFit(Number.NaN, 900)).toEqual({ ok: false, reason: "small" });
  });

  it("refuses a panorama, and passes a 2.39:1 film frame at exactly the limit", () => {
    expect(photoFit(3000, 1000)).toEqual({ ok: false, reason: "shape" });
    expect(photoFit(1000, 3000)).toEqual({ ok: false, reason: "shape" });
    expect(photoFit(2403, 1000)).toEqual({ ok: false, reason: "shape" });
    expect(photoFit(2400, 1000).ok).toBe(true);
    expect(photoFit(1920, 804).ok).toBe(true);
    expect(SET_PHOTO_MAX_ASPECT).toBe(2.4);
  });

  it("passes again, unchanged, the size it hands back — the browser's photo is never refused by the server's check", () => {
    // The server re-checks what sharp wrote, which for a photo the browser
    // prepared is the browser's own size (it is never enlarged). Rounding
    // the short side once took 2400 × 1000 to 2048 × 853 — 2.4009:1, refused.
    expect(photoFit(2400, 1000)).toEqual({ ok: true, width: 2048, height: 853 });
    expect(photoFit(2048, 853)).toEqual({ ok: true, width: 2048, height: 853 });
    expect(photoFit(4800, 2000)).toEqual({ ok: true, width: 2048, height: 853 });
    expect(photoFit(3840, 1600)).toEqual({ ok: true, width: 2048, height: 853 });
    let checked = 0;
    for (let short = SET_PHOTO_MIN_SIDE_PX; short <= 4000; short++) {
      const edge = Math.floor(SET_PHOTO_MAX_ASPECT * short);
      for (let long = edge - 2; long <= edge + 2; long++) {
        for (const [w, h] of [
          [long, short],
          [short, long],
        ]) {
          const fit = photoFit(w, h);
          if (!fit.ok) continue;
          checked++;
          expect(photoFit(fit.width, fit.height), `${w}×${h} → ${fit.width}×${fit.height}`).toEqual(fit);
        }
      }
    }
    expect(checked).toBeGreaterThan(10_000);
  });

  it("says the smallest side it accepts, in the sentence the person reads", () => {
    expect(SET_PHOTO_TOO_SMALL).toContain(String(SET_PHOTO_MIN_SIDE_PX));
  });
});
