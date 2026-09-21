// A look's object sheet (Astra Sets, 2026-09-14): the objects of an earlier
// still, cut out onto grey (look-cutout-store.ts), drawn four ways on grey by
// the image model — front three-quarter, side, rear three-quarter, rear.
// This sheet, not the cutout, is what a shot carries as its look.
//
// WHY A SHEET. A cutout shows an object from one side, and the image model
// keeps a design only for the side it was shown: the operator's fourth
// race-track still, shot from behind with still 1's front three-quarter
// cutout as its look, came back as a different car; on GPT Image 2.5 Flare
// the same request came back as still 1's car exactly — turned to the
// cutout's side, not the sketch's. Handed a sheet of that car drawn from
// four sides instead, the still from behind came back as that car's own rear
// (the twin exhausts, the light bar, the wing on its uprights) on Sunburst,
// and a still from the front as its front on Flare (2026-09-14, the
// harnesses in docs/ASTRA_SETS.md). The model can only keep what it has
// been shown; the sheet shows it the object all round, once, and every shot
// after that is drawn from the same canon.
//
// HOW. One render on the product's own image model (openai-images.ts): the
// cutout as the one input picture, LOOK_SHEET_PROMPT as the words, the
// answer laid down as a JPEG at setLookSheetPath beside the cutout it was
// drawn from. Made the first time a still is someone's look and never
// rewritten; every later shot with that look reuses it. The cutout reaches
// the model by a signed URL to its own storage object, good for
// LOOK_SHEET_SIGNED_URL_SECONDS, never a public link.
//
// NEVER THE PERSON. The cutout has every person's region cleared out of it
// (look-cutout.ts, look-people.ts), and the sheet is asked for no people. A
// refusal by the model's own safety layer is "sheet refused": no look.
//
// THE MONEY. One sheet a look still, measured 2026-09-14 on both 2.5 models:
// 160 text and 640 image tokens in, 1,756 image tokens out — $0.0586 at the
// rates in openai-images.ts — in 42 s (Flare) and 68 s (Sunburst). Beside
// the cut it is drawn from ($0.0056 measured) and the reading of where the
// still's people are (under a cent), a look costs about seven cents to
// make, once, and nothing after.
//
// Relative imports only and the Supabase client passed in, so the test
// suite loads this file as it is, with fakes for storage and for the render.

import type { SupabaseClient } from "@supabase/supabase-js";
import { ImageSafetyRejection, generateImageWithOpenAI } from "../generations/providers/openai-images";
import { setLookSheetPath } from "./set-config";

const BUCKET = "generated-images";
/** How long the cutout's signed link lives: one render, with a retry. */
export const LOOK_SHEET_SIGNED_URL_SECONDS = 600;
/** The sheet's JPEG quality, as the cutout's. */
export const LOOK_SHEET_JPEG_QUALITY = 90;
/** The measured sheet: 160 × $5 + 640 × $8 + 1,756 × $30, per million. */
export const LOOK_SHEET_MEASURED_USD = (160 * 5 + 640 * 8 + 1756 * 30) / 1_000_000;

/**
 * The words the sheet is drawn from, measured 2026-09-14 (the header): not
 * to be reworded on a hunch.
 */
export const LOOK_SHEET_PROMPT =
  "A design reference sheet of what the attached photo shows — one object, or a few — on a plain, even, neutral grey background and nothing else. " +
  "Show that same object four times, in a two-by-two grid, each the same size and lit the same soft studio light: " +
  "top left its front three-quarter view, top right its side profile, bottom left its rear three-quarter view, bottom right its rear view. " +
  "Draw it exactly as it looks in the photo — its shape, proportions, design, colour, materials and details — and invent the sides the photo does not show " +
  "so that they belong to this exact object. No people, no text, no labels, no shadows on the ground beyond a soft contact shadow, no other objects.";

/**
 * The words a thing's sheet is drawn from when it has two to four photos
 * (R1, 2026-09-21): the same sheet as LOOK_SHEET_PROMPT's, told that every
 * photo shows the one object, each side as the photo that shows it. One
 * photo keeps LOOK_SHEET_PROMPT, word for word. Unproven until the paid
 * proof draws one.
 */
export const ELEMENT_SHEET_PROMPT =
  "A design reference sheet of the one object that all the attached photos show — the same object, photographed from different sides — on a plain, even, neutral grey background and nothing else. " +
  "Show that same object four times, in a two-by-two grid, each the same size and lit the same soft studio light: " +
  "top left its front three-quarter view, top right its side profile, bottom left its rear three-quarter view, bottom right its rear view. " +
  "Draw it exactly as it looks in the photos — its shape, proportions, design, colour, materials and details, each side as the photo that shows it — and invent only the sides no photo shows, " +
  "so that they belong to this exact object. No people, no text, no labels, no shadows on the ground beyond a soft contact shadow, no other objects.";

/** Why a shot went without its look at this step. Logged as it is: none of these carries anything of the person's. */
export type LookSheetDrop = "storage" | "sheet refused" | "sheet failed";

export type LookSheetResult = { ok: true; path: string; made: boolean } | { ok: false; reason: LookSheetDrop };

async function exists(admin: SupabaseClient, path: string): Promise<boolean> {
  try {
    const { data } = await admin.storage.from(BUCKET).exists(path);
    return data === true;
  } catch {
    return false;
  }
}

/**
 * The object sheet for this look: the kept one, or one drawn now from the
 * cutout at `cutoutPath` (the person's own, already made and kept by
 * look-cutout-store.ts).
 */
export async function lookSheet(
  input: { admin: SupabaseClient; userId: string; setId: string; lookGenerationId: string; cutoutPath: string },
  deps: { render?: typeof generateImageWithOpenAI } = {},
): Promise<LookSheetResult> {
  const { admin, userId, setId, lookGenerationId } = input;
  return sheetFromPhoto({ admin, sourcePath: input.cutoutPath, sheetPath: setLookSheetPath(userId, setId, lookGenerationId) }, deps);
}

/**
 * An object sheet drawn from any stored picture of the person's own — an
 * earlier still's cutout (lookSheet), or a reference photo they uploaded
 * (2026-09-21, set-config.ts setRefPhotoPath) — laid down at `sheetPath`
 * once and reused ever after. The same words, model and rules either way:
 * LOOK_SHEET_PROMPT asks for the objects four ways round on grey and for
 * no people, so a person in a reference photo never reaches a shot.
 */
export async function sheetFromPhoto(
  input: { admin: SupabaseClient; sourcePath: string; sheetPath: string },
  deps: { render?: typeof generateImageWithOpenAI } = {},
): Promise<LookSheetResult> {
  return sheetFromPhotos({ admin: input.admin, sourcePaths: [input.sourcePath], sheetPath: input.sheetPath }, deps);
}

/**
 * A thing's sheet drawn from its photos (R1, 2026-09-21), front first: one
 * photo is sheetFromPhoto's path exactly (LOOK_SHEET_PROMPT); two to four
 * go in together under ELEMENT_SHEET_PROMPT. Kept at `sheetPath`, which is
 * named by the photos, and reused ever after.
 */
export async function sheetFromPhotos(
  input: { admin: SupabaseClient; sourcePaths: readonly string[]; sheetPath: string },
  deps: { render?: typeof generateImageWithOpenAI } = {},
): Promise<LookSheetResult> {
  const { admin, sheetPath: path } = input;
  const sources = input.sourcePaths.slice(0, 4);
  if (sources.length === 0) return { ok: false, reason: "sheet failed" };
  if (await exists(admin, path)) return { ok: true, path, made: false };

  let urls: string[];
  try {
    urls = await Promise.all(
      sources.map(async (source) => {
        const { data, error } = await admin.storage.from(BUCKET).createSignedUrl(source, LOOK_SHEET_SIGNED_URL_SECONDS);
        if (error || !data?.signedUrl) throw new Error("unsigned");
        return data.signedUrl;
      }),
    );
  } catch {
    return { ok: false, reason: "storage" };
  }
  let png: Buffer;
  try {
    png = Buffer.from(await (deps.render ?? generateImageWithOpenAI)(urls.length === 1 ? LOOK_SHEET_PROMPT : ELEMENT_SHEET_PROMPT, urls), "base64");
  } catch (err) {
    if (err instanceof ImageSafetyRejection) {
      console.warn("[sets] look sheet refused by the image model's safety layer");
      return { ok: false, reason: "sheet refused" };
    }
    console.warn(`[sets] look sheet failed: ${err instanceof Error ? err.name : "error"}`);
    return { ok: false, reason: "sheet failed" };
  }
  if (png.byteLength === 0) return { ok: false, reason: "sheet failed" };

  let jpeg: Buffer;
  try {
    const { default: sharp } = await import("sharp");
    jpeg = await sharp(png, { limitInputPixels: 25_000_000, failOn: "error" }).jpeg({ quality: LOOK_SHEET_JPEG_QUALITY }).toBuffer();
  } catch {
    return { ok: false, reason: "sheet failed" };
  }

  try {
    const { error } = await admin.storage.from(BUCKET).upload(path, jpeg, { contentType: "image/jpeg", upsert: false });
    // Refused because it is there already: a shot beside this one drew it
    // first, and a kept sheet is never rewritten (media URLs are cached as
    // immutable). Either sheet is drawn from the same cutout.
    if (error && !(await exists(admin, path))) return { ok: false, reason: "storage" };
  } catch {
    return { ok: false, reason: "storage" };
  }
  return { ok: true, path, made: true };
}
