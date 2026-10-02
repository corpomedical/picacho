// Photos a person attached to the chat, riding a picture card into the
// render itself (operator, 2026-10-02: a condom-box picture in Light came out
// as Eva holding a made-up box, because the card carried only Aly's words →
// drafts at claude.ai/artifact/7MEQAvkT4VufEiy5Mu75Pj → "Your pick": 3A, the
// card shows each photo and its job; 4B, an attached person photo wins and
// the card lets them switch).
//
// No imports on purpose: tools.ts, start-card.ts, the prompts and the card
// all read it, and its tests load it alone.

/** What a photo is for in the picture. The renderer's roles: person → "identity", product → "prop". */
export type CardPhotoRole = "person" | "product";

export type CardPhoto = { fileId: string; role: CardPhotoRole; name: string };

/** One person and one product: the renderer takes the first photo of each role. */
export const MAX_CARD_PHOTOS = 2;

/** The renderer's own role names (generations/actions.ts AttachmentRoleEntry). */
export const RENDER_ROLE: Record<CardPhotoRole, "identity" | "prop"> = { person: "identity", product: "prop" };

/**
 * What Aly reads about photos and who is in the picture. Shared by her chat
 * page's rules and Light's, so the two never drift.
 */
export const PHOTOS_AND_WHO = `- Photos they attached can go INTO a picture, not just be described: pass them in photos, each with its job. "person" is the person in the shot (their photo, a model); "product" is a thing they hold, wear or show (a box, a bottle, a bag). One of each at most, by the photo id shown beside each attached picture. Only pictures take photos; for a video, leave photos empty.
- WHO IS IN IT. Use a saved character only when they name one, or picked one earlier in this chat. An attached photo of a person IS the person: give it the job "person" and leave character_id null. If the picture needs a person ("her", "a model holding it"), none is named, and no photo of a person is attached, ask in one short question who it should be (one of their characters by name, or no one) before you prepare it.`;

/**
 * Checks the photos Aly asked for against the pictures attached in this chat.
 * Returns the card's photos, or an error she can correct from.
 */
export function checkCardPhotos(
  input: unknown,
  chatPictures: readonly { id: string; name: string }[],
  kind: "image" | "video",
  characterId: string | null,
): { photos: CardPhoto[] } | { error: string } {
  if (input === null || input === undefined) return { photos: [] };
  if (!Array.isArray(input)) return { error: "photos must be a list (empty when none ride)." };
  if (input.length === 0) return { photos: [] };
  if (kind !== "image") return { error: "Only a picture can take attached photos. For a video, leave photos empty." };
  if (chatPictures.length === 0) return { error: "No pictures are attached in this chat. Leave photos empty." };
  if (input.length > MAX_CARD_PHOTOS) return { error: "At most one person photo and one product photo." };

  const photos: CardPhoto[] = [];
  for (const raw of input) {
    const r = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
    const id = typeof r.file_id === "string" ? r.file_id.trim() : "";
    const role = r.role === "person" || r.role === "product" ? r.role : null;
    if (!role) return { error: 'Each photo\'s role must be "person" or "product".' };
    const found = chatPictures.find((p) => p.id === id);
    if (!found) return { error: "That photo id isn't a picture attached in this chat. Use the photo id shown beside it." };
    if (photos.some((p) => p.fileId === found.id)) return { error: "The same photo is listed twice." };
    if (photos.some((p) => p.role === role)) return { error: `Only one ${role} photo can ride a picture.` };
    photos.push({ fileId: found.id, role, name: found.name });
  }
  if (characterId && photos.some((p) => p.role === "person")) {
    return {
      error:
        "A person photo is the person in the shot, so it can't ride with a saved character. Pass character_id null to use the photo, or leave the person photo out to use the character.",
    };
  }
  return { photos };
}

/** A card's photos as saved (an old card has none; anything malformed is dropped). */
export function readCardPhotos(v: unknown): CardPhoto[] {
  if (!Array.isArray(v)) return [];
  const out: CardPhoto[] = [];
  for (const raw of v) {
    if (!raw || typeof raw !== "object") continue;
    const r = raw as Record<string, unknown>;
    if (typeof r.fileId !== "string" || !/^[0-9a-f-]{36}$/i.test(r.fileId)) continue;
    if (r.role !== "person" && r.role !== "product") continue;
    if (out.some((p) => p.fileId === r.fileId || p.role === r.role)) continue;
    out.push({ fileId: r.fileId, role: r.role, name: typeof r.name === "string" ? r.name.slice(0, 200) : "" });
  }
  return out.slice(0, MAX_CARD_PHOTOS);
}

// ---- The card's switches (3A, 4B) ---------------------------------------------
//
// The person may change each photo's job and who is in the picture before
// Make it. Pure, so the card's rules are tested without a browser:
// one person at most, one product at most, and a person photo and a saved
// character never both (the renderer would have two faces to choose from).

export type PhotoJob = CardPhotoRole | "unused";
export type CardWho = { kind: "photo" } | { kind: "character"; id: string; name: string } | { kind: "none" };
export type CardChoice = { jobs: Record<string, PhotoJob>; who: CardWho };

/** As Aly prepared it: each photo on its job, and the person photo (or her character, or no one) in the picture. */
export function startChoice(photos: readonly CardPhoto[], characterId: string | null, characterName: string | null): CardChoice {
  const jobs: Record<string, PhotoJob> = {};
  for (const p of photos) jobs[p.fileId] = p.role;
  const who: CardWho = photos.some((p) => p.role === "person")
    ? { kind: "photo" }
    : characterId
      ? { kind: "character", id: characterId, name: characterName ?? "" }
      : { kind: "none" };
  return { jobs, who };
}

/** One photo given a new job; the others and "who" follow. */
export function withJob(choice: CardChoice, fileId: string, job: PhotoJob): CardChoice {
  if (!(fileId in choice.jobs)) return choice;
  const jobs = { ...choice.jobs };
  if (job !== "unused") for (const id of Object.keys(jobs)) if (id !== fileId && jobs[id] === job) jobs[id] = "unused";
  jobs[fileId] = job;
  const hasPerson = Object.values(jobs).includes("person");
  const who: CardWho = job === "person" ? { kind: "photo" } : choice.who.kind === "photo" && !hasPerson ? { kind: "none" } : choice.who;
  return { jobs, who };
}

/** "Who's in it" switched: a character or no one takes the person photo off; "your photo" puts one back on. */
export function withWho(choice: CardChoice, photos: readonly CardPhoto[], who: CardWho): CardChoice {
  const jobs = { ...choice.jobs };
  if (who.kind === "photo") {
    if (Object.values(jobs).includes("person")) return { jobs, who };
    // The photo Aly read as the person, else the first one not showing the product.
    const pick = photos.find((p) => p.role === "person") ?? photos.find((p) => jobs[p.fileId] !== "product") ?? photos[0];
    if (!pick) return choice;
    return withJob({ jobs, who: choice.who }, pick.fileId, "person");
  }
  for (const id of Object.keys(jobs)) if (jobs[id] === "person") jobs[id] = "unused";
  return { jobs, who };
}

/** What Make it sends: the photos still on a job, and the character (null unless one is picked). */
export function choiceToSend(choice: CardChoice, photos: readonly CardPhoto[]): { photos: CardPhoto[]; characterId: string | null } {
  const riding = photos
    .filter((p) => choice.jobs[p.fileId] === "person" || choice.jobs[p.fileId] === "product")
    .map((p) => ({ ...p, role: choice.jobs[p.fileId] as CardPhotoRole }));
  return { photos: riding, characterId: choice.who.kind === "character" ? choice.who.id : null };
}
