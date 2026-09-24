// Where the Producer is working (2026-09-25, operator: "the generator lights
// with a very thin light at the bottom edge … so the user knows where the
// assistant is standing. This must be applied on everything on the page").
//
// Pure, shared by the route (which names a spot as each tool runs) and the
// page (which finds that spot and lights its bottom edge). A spot is a NAME,
// marked in the markup with data-producer-spot="<name>"; several elements on
// one page can carry the same name (the take strip and the History grid are
// both "renders"), and a single render is data-producer-render="<id>".
//
// The mapping is from what the Producer DOES, not what it says: preparing a
// send is the composer, searching is the renders, looking is one render, a
// note is the notes. When the spot isn't on the current page, nothing lights
// — the sheet's own status line still says what it's doing.

export const SPOTS = ["composer", "renders", "render", "notes", "credits", "cast"] as const;
export type Spot = (typeof SPOTS)[number];

export function spotForTool(name: string): Spot | null {
  switch (name) {
    case "prepare_send":
      return "composer";
    case "search_renders":
      return "renders";
    case "look_at_render":
      return "render";
    case "memory":
      return "notes";
    default:
      return null;
  }
}

export function isSpot(v: unknown): v is Spot {
  return typeof v === "string" && (SPOTS as readonly string[]).includes(v);
}

/** The CSS selector for a spot on the page (a render by id, else by name). */
export function spotSelector(spot: Spot, id?: string | null): string {
  if (spot === "render" && id && /^[0-9a-f-]{36}$/i.test(id)) {
    return `[data-producer-render="${id}"]`;
  }
  // A render nobody can find by id falls back to the stage that shows one.
  if (spot === "render") return `[data-producer-spot="render"]`;
  return `[data-producer-spot="${spot}"]`;
}
