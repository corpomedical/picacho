import { createHash } from "crypto";
import { readCardPhotos, type CardPhoto } from "../aly-chat/card-photos-rules";

// start_render's rules (operator, 2026-10-01: "I asked she takes control so
// the user works hands free" → "Say price, then go"). Alias-free, so it's
// tested on its own; start-render.ts does the starting.
//
// WHAT SHE MAY START: only a card she prepared in THIS conversation (the lamp's
// thread or this chat), found by its id in what was saved — never a prompt,
// a price or a model she writes into the call. The price she says is the
// card's own, worked out from the catalogue when she prepared it.
//
// WHEN is the model's judgment, from what the person MEANS (the rules in her
// prompt): "do it", "make it", "go ahead", "I can't touch the phone", a yes
// to her price. The code holds the hard edges: never an ad (painting is on
// the Press Tour page), never the same card twice in a turn, never more than
// MAX_STARTS_PER_TURN in one answer.

export type StartableCard = {
  id: string;
  kind: "image" | "video" | "ad";
  label: string;
  prompt: string;
  characterId: string | null;
  modelId: string | null;
  seconds: number | null;
  credits: number;
  /** Already made (its button was pressed, or she started it before). */
  generationId: string | null;
  /** Chat pictures that ride into the render (card-photos-rules.ts). */
  photos: CardPhoto[];
};

export const MAX_STARTS_PER_TURN = 4;

/** Above this many credits, or for more than one render at once, she asks before starting. */
export const ASK_FIRST_ABOVE_CREDITS = 10;

/** The card with that id among a conversation's saved cards (newest wins if one repeats). */
export function findCard<T extends { id: string }>(cards: readonly T[], id: unknown): T | null {
  if (typeof id !== "string" || !id.trim()) return null;
  for (let i = cards.length - 1; i >= 0; i--) if (cards[i].id === id.trim()) return cards[i];
  return null;
}

/** Every card saved in a list of message displays (the lamp keeps them as display.cards, the chat page as content.renders). */
export function cardsIn(rows: readonly unknown[], field: "cards" | "renders"): StartableCard[] {
  const out: StartableCard[] = [];
  for (const row of rows) {
    const list = row && typeof row === "object" ? (row as Record<string, unknown>)[field] : null;
    if (!Array.isArray(list)) continue;
    for (const c of list) {
      if (!c || typeof c !== "object") continue;
      const r = c as Record<string, unknown>;
      if (typeof r.id !== "string" || typeof r.prompt !== "string") continue;
      const kind = r.kind === "image" || r.kind === "video" || r.kind === "ad" ? r.kind : null;
      if (!kind) continue;
      out.push({
        id: r.id,
        kind,
        label: typeof r.label === "string" ? r.label : "",
        prompt: r.prompt,
        characterId: typeof r.characterId === "string" ? r.characterId : null,
        modelId: typeof r.modelId === "string" ? r.modelId : null,
        seconds: typeof r.seconds === "number" ? r.seconds : null,
        credits: typeof r.credits === "number" && Number.isFinite(r.credits) ? r.credits : 0,
        generationId: typeof r.generationId === "string" ? r.generationId : null,
        photos: kind === "image" ? readCardPhotos(r.photos) : [],
      });
    }
  }
  return out;
}

/** Why this card can't be started now, or null when it can. */
export function startRefusal(card: StartableCard | null, startedThisTurn: readonly string[]): string | null {
  if (!card) return "There's no card with that id in this conversation. Prepare it first (prepare_send), then start the card it gives you.";
  if (card.kind === "ad") {
    return "An ad's stills are painted on the Press Tour page, where they press Paint. Open it for them (open_page) and say so.";
  }
  if (startedThisTurn.includes(card.id)) return "You already started that card in this answer.";
  if (card.generationId) return "That card has already been made (it was started before). To make it again, prepare a new card.";
  if (startedThisTurn.length >= MAX_STARTS_PER_TURN) return `At most ${MAX_STARTS_PER_TURN} renders in one answer. Ask before starting more.`;
  return null;
}

const plural = (n: number) => (n === 1 ? "1 credit" : `${n} credits`);

/** What the tool tells her once the start has been tried. */
export function startResultText(card: StartableCard, outcome: { state: "started" | "done" | "failed"; error?: string }): string {
  if (outcome.state === "failed") {
    return `"${card.label}" didn't start: ${outcome.error ?? "it couldn't start just now"}. Nothing was made, and a refusal or a failure that cost nothing isn't charged. Tell them in a sentence, and offer what would fix it.`;
  }
  const what = card.kind === "video" ? "video" : "picture";
  return outcome.state === "done"
    ? `"${card.label}" is made (${plural(card.credits)}): the ${what} is in their History and on the card. Say it's ready.`
    : `"${card.label}" has started (${plural(card.credits)}). The ${what} appears on the card and in their History when it's ready${card.kind === "video" ? ", usually in a few minutes" : ""}; they'll get a notification if they have them on. Say it's on its way.`;
}

/**
 * A card's take id: a UUID made from the person and the card (the route
 * passes "<conversation>:<card>"), the same every time — so a second start of
 * the same card arrives as the same send and runGeneration follows the first
 * take instead of rendering again (repeat-send.ts).
 */
export function cardGenerationId(userId: string, cardKey: string): string {
  const h = createHash("sha256").update(`aly-card:${userId}:${cardKey}`).digest("hex");
  // Shaped as a version-4 UUID so every UUID check along the way accepts it.
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-${((parseInt(h[16], 16) & 3) | 8).toString(16)}${h.slice(17, 20)}-${h.slice(20, 32)}`;
}
