import { describe, expect, it } from "vitest";
import { checkCardPhotos, choiceToSend, readCardPhotos, startChoice, withJob, withWho, type CardPhoto } from "./card-photos-rules";
import { validatePreparedSend } from "../producer/tools";

// The condom-box picture, 2026-10-02: a photo of a woman and a photo of the
// box, attached in Light; Aly put Eva in instead and the box never reached
// the engine. These are the rules that make the photos ride, and keep a saved
// character out unless it is picked.

const WOMAN = "11111111-1111-4111-8111-111111111111";
const BOX = "22222222-2222-4222-8222-222222222222";
const pictures = [
  { id: WOMAN, name: "Gemini_Generated_Image.png" },
  { id: BOX, name: "cce964af.jpg" },
];
const EVA = "33333333-3333-4333-8333-333333333333";

describe("which photos a card may carry", () => {
  it("takes a person photo and a product photo attached in this chat", () => {
    const r = checkCardPhotos(
      [
        { file_id: WOMAN, role: "person" },
        { file_id: BOX, role: "product" },
      ],
      pictures,
      "image",
      null,
    );
    expect(r).toEqual({
      photos: [
        { fileId: WOMAN, role: "person", name: "Gemini_Generated_Image.png" },
        { fileId: BOX, role: "product", name: "cce964af.jpg" },
      ],
    });
  });

  it("an empty list (or none) is no photos", () => {
    expect(checkCardPhotos([], pictures, "image", null)).toEqual({ photos: [] });
    expect(checkCardPhotos(null, [], "video", EVA)).toEqual({ photos: [] });
  });

  it("refuses a photo that isn't attached here, a second person, a video, and a person photo beside a character", () => {
    expect(checkCardPhotos([{ file_id: EVA, role: "product" }], pictures, "image", null)).toHaveProperty("error");
    expect(
      checkCardPhotos(
        [
          { file_id: WOMAN, role: "person" },
          { file_id: BOX, role: "person" },
        ],
        pictures,
        "image",
        null,
      ),
    ).toHaveProperty("error");
    expect(checkCardPhotos([{ file_id: BOX, role: "product" }], pictures, "video", null)).toHaveProperty("error");
    expect(checkCardPhotos([{ file_id: WOMAN, role: "person" }], pictures, "image", EVA)).toHaveProperty("error");
    // A product beside a saved character is fine: Eva holding THEIR box.
    expect(checkCardPhotos([{ file_id: BOX, role: "product" }], pictures, "image", EVA)).toEqual({
      photos: [{ fileId: BOX, role: "product", name: "cce964af.jpg" }],
    });
  });

  it("prepare_send puts them on the card, and a chat with no pictures can't name any", () => {
    const cast = [{ id: EVA, name: "Eva" }];
    const input = {
      kind: "image",
      character_id: null,
      prompt: "She holds the box up close to the camera, smiling, eyes closed",
      video_model_id: null,
      seconds: null,
      label: "Holding your product close up",
      photos: [
        { file_id: WOMAN, role: "person" },
        { file_id: BOX, role: "product" },
      ],
    };
    const ok = validatePreparedSend(input, cast, () => "c1", [], pictures);
    expect("card" in ok && ok.card.photos?.map((p) => p.role)).toEqual(["person", "product"]);
    expect("card" in ok && ok.card.characterId).toBeNull();
    expect(validatePreparedSend(input, cast, () => "c1")).toHaveProperty("error");
    // An old-style call with no photos still makes a card, with none.
    const plain = validatePreparedSend({ ...input, photos: [] }, cast, () => "c1", [], pictures);
    expect("card" in plain && plain.card.photos).toBeUndefined();
  });

  it("reads a saved card's photos and drops anything malformed", () => {
    expect(readCardPhotos(undefined)).toEqual([]);
    expect(
      readCardPhotos([
        { fileId: WOMAN, role: "person", name: "a.png" },
        { fileId: "not-a-uuid", role: "product" },
        { fileId: BOX, role: "person" },
        { fileId: BOX, role: "product", name: "b.png" },
      ]),
    ).toEqual([
      { fileId: WOMAN, role: "person", name: "a.png" },
      { fileId: BOX, role: "product", name: "b.png" },
    ]);
  });
});

describe("the card's switches", () => {
  const photos: CardPhoto[] = [
    { fileId: WOMAN, role: "person", name: "a.png" },
    { fileId: BOX, role: "product", name: "b.png" },
  ];

  it("starts as Aly prepared it: the person photo is who's in it", () => {
    const c = startChoice(photos, null, null);
    expect(c.who).toEqual({ kind: "photo" });
    expect(choiceToSend(c, photos)).toEqual({ photos, characterId: null });
  });

  it("switching to Eva takes the person photo off and keeps the product", () => {
    const c = withWho(startChoice(photos, null, null), photos, { kind: "character", id: EVA, name: "Eva" });
    expect(choiceToSend(c, photos)).toEqual({ photos: [photos[1]], characterId: EVA });
  });

  it("no one: only the product rides", () => {
    const c = withWho(startChoice(photos, null, null), photos, { kind: "none" });
    expect(choiceToSend(c, photos)).toEqual({ photos: [photos[1]], characterId: null });
  });

  it("back to your photo puts the person photo back on and drops the character", () => {
    const eva = withWho(startChoice(photos, null, null), photos, { kind: "character", id: EVA, name: "Eva" });
    const back = withWho(eva, photos, { kind: "photo" });
    expect(choiceToSend(back, photos)).toEqual({ photos, characterId: null });
  });

  it("a photo's job: one person and one product at most, and 'who' follows", () => {
    // The box made the person: the woman's photo goes unused, who is still "your photo".
    const swapped = withJob(startChoice(photos, null, null), BOX, "person");
    expect(swapped.jobs).toEqual({ [WOMAN]: "unused", [BOX]: "person" });
    expect(swapped.who).toEqual({ kind: "photo" });
    // The person photo set to Not used: nobody is in it any more.
    const off = withJob(startChoice(photos, null, null), WOMAN, "unused");
    expect(off.who).toEqual({ kind: "none" });
    // Eva picked, then a photo made the person: the photo wins and Eva goes.
    const eva = startChoice([photos[1]], EVA, "Eva");
    expect(eva.who).toEqual({ kind: "character", id: EVA, name: "Eva" });
  });
});
