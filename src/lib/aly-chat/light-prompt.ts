import { TOOL_NAMES } from "../producer/tools";

// ---- Picacho Light (2026-09-29) ------------------------------------------------
//
// Aly is Light's chat (624ff17). The operator's picks for how she works there
// (2026-09-29, "Add Aly capabilities to Picacho Light"): a picture or video
// she makes STARTS RIGHT AWAY, and every Light user has her on the plan's Aly
// allowance. A chat started in Light is saved with `light: true` in its setup
// and reads these words instead of the chat page's "they press the button
// themselves". Alias-free, so the test suite can load it.
//
// The one exception is a message with files attached: a render can't take a
// photo from the chat as its reference, so that turn's card waits for its
// "Make it" tap, and "Change it first" opens Light's own box to add the photo.

const LIGHT_PREPARE_DESCRIPTION =
  "Make ONE picture or video. In Picacho Light this STARTS the render at once and spends its credits (unless the app note says this message's cards wait for a tap); the result appears in the chat by itself when it is ready. Call it only when the person clearly asked for something to be made, changed or redone, once per render. Returns the credit cost, or an error saying what to fix.";

/** The chat page's tools as a Light chat has them: prepare_send says what it does there. */
export function lightChatToolsFrom(tools: unknown[]): unknown[] {
  // start_render (2026-10-01) has no place here: in Light, prepare_send
  // already starts the render.
  return (tools as { name: string; description?: string }[])
    .filter((t) => t.name !== TOOL_NAMES.startRender)
    .map((t) => (t.name === TOOL_NAMES.prepare ? { ...t, description: LIGHT_PREPARE_DESCRIPTION } : t));
}

const LIGHT_PICTURES = `PICTURES AND VIDEOS (PICACHO LIGHT)
Picacho makes pictures and videos, with or without the person's saved characters. Here prepare_send MAKES it: unless the app note says otherwise, the render starts at once, spends its credits, and the picture or video appears in this chat by itself when it is ready. So:
- Call prepare_send only when they clearly ask you to make, change or redo a picture or video. If what they want is unclear, ask one short question first. A question about pictures or videos ("how do I make it look cinematic?") gets an answer, not a render.
- One render per request, unless they ask for several (then at most four).
- Say in one short sentence what you're making. Never say it is done (it appears when it is), and never send them to the composer or the studio.
- A follow-up ("make it slow motion", "now as a picture") is a new render built on the last one: keep its words and change what they asked.
- When the app note says they attached files to this message, what you prepare in that turn does NOT start by itself: it waits on its card for them to tap Make it. A render can't take their photo in by itself: if they want their own photo in it, tell them "Change it first" on the card lets them add it.
- For a video, use the model and length the app note names (Light's own, which their prices assume), unless they ask for a particular length or look it can't give; then pick from the catalogue. A picture needs no model: leave video_model_id and seconds null.
- For an ad of a product, plan_press_ad.`;

const LIGHT_BLOCK = `PICACHO LIGHT
The person uses Picacho Light, the simple version: one chat box where they talk to you and get pictures and videos back. They are probably new to AI pictures and video. Keep answers short and warm unless they ask for more, and skip jargon (models, seeds, aspect ratios) unless they bring it up. There is no studio composer or engine settings in front of them; the product guide's studio pages are not where they are. If they want more control, they can switch to the full studio from Settings.`;

/** The chat page's rules (CHAT_RULES) as a Light chat reads them. */
export function lightRulesFrom(chatRules: string): string {
  const rules = chatRules
    .replace("on your full-screen chat page", "in Picacho Light's chat")
    .replace(/PICTURES AND VIDEOS\n[\s\S]*?\n\nMEMORY/, `${LIGHT_PICTURES}\n\nMEMORY`)
    .replace(
      "Apart from starting your own cards when they ask (start_render), you cannot spend or refund credits,",
      "Apart from the pictures and videos you make with prepare_send, you cannot spend or refund credits,",
    );
  return `${rules}\n\n${LIGHT_BLOCK}`;
}

/** What Light tells Aly about one message (kept in its note, so a replay is identical). */
export function lightTurnNote(n: { files?: unknown; video?: { model?: unknown; seconds?: unknown } | null }): string {
  const lines: string[] = [];
  const files = typeof n.files === "number" && Number.isInteger(n.files) && n.files > 0 ? n.files : 0;
  lines.push(
    files
      ? "they attached files to this message, so a picture or video you prepare in this turn waits on its card for them to tap Make it"
      : "a picture or video you prepare in this turn starts at once",
  );
  const v = n.video;
  if (v && typeof v.model === "string" && /^[a-z0-9][a-z0-9.-]{0,40}$/.test(v.model)) {
    const secs = typeof v.seconds === "number" && Number.isInteger(v.seconds) && v.seconds > 0 && v.seconds <= 60 ? v.seconds : null;
    lines.push(`Light makes videos with video_model_id "${v.model}"${secs ? ` and seconds ${secs}` : ""}`);
  }
  return `[App note (Picacho Light): ${lines.join("; ")}.]`;
}
