import { SETTINGS_TABS } from "../settings/tabs";

// Every page of Picacho, for Aly (operator, 2026-09-29: "Give Aly complete
// knowledge of the website. Give her the power to help the user as you do,
// and switch between pages" → picked "Guide + drive": she opens pages and
// lights the button; the person presses anything that spends, pays, deletes
// or changes the account).
//
// TWO JOBS, ONE LIST:
// 1. What she knows. renderSiteMap() is appended to the product guide in the
//    system prompt, so it follows that file's rule: deterministic bytes, no
//    clocks, nothing per person (who can open what arrives per turn).
// 2. Where she may go. open_page (lib/producer/run-tools.ts) sends the
//    browser only to a path this list names, with only the query values it
//    names — never a URL the model made up, never another site.
//
// site-map.test.ts walks src/app and fails when a page exists that this list
// doesn't name (or names a page that's gone), so a new page can't be missing
// from what she knows.

/** Who can open a page. The tool gates are lib/nav/gates.ts's, read per person. */
export type PageGate =
  | "all"
  | "admin"
  | "chat"
  | "setsVisible"
  | "recceVisible"
  | "mystiqueVisible"
  | "liveVisible"
  | "cutVisible"
  | "pressTourVisible";

export type PageOption = { value: string; name: string; what: string };

export type SitePage = {
  /** The path, with [id] for a record's id (a uuid). */
  path: string;
  name: string;
  what: string;
  gate: PageGate;
  /** One query parameter the page reads, and the values she may pass. */
  param?: { key: string; options: readonly PageOption[] };
  /** Fits Picacho Light (the simple version): she may open it for a Light account. */
  light?: boolean;
  /** Not a place to send anyone (a step of a flow, a redirect): known, never opened. */
  noOpen?: boolean;
  /** "site" pages are public; "admin" pages are the team's. */
  area: "app" | "site" | "admin";
};

const SETTINGS_ROOMS: Record<(typeof SETTINGS_TABS)[number], { name: string; what: string }> = {
  overview: {
    name: "Overview",
    what: "who is signed in, the plan, credits left this month and extra credits, the month's other allowances (Helios sets, AI character photos, prompt assists, Aly), anything that needs attention, the latest invoice",
  },
  billing: {
    name: "Plan & billing",
    what: "the plan and \"Change or cancel\" (Stripe's page; a Google Play plan is changed in Google Play), \"Credits left this month\", where this month's credits went, Aly's top-ups, Invoices, Payment method, Billing details",
  },
  profile: {
    name: "Profile",
    what: "Public profile (username), About you (name, company), the invite card with \"Copy link\"",
  },
  generation: {
    name: "Generation",
    what: "\"Where new renders start\" (default engine), AI generation (skip the prompt rewrite), Brand rules (always/never rules for every send)",
  },
  preferences: {
    name: "Preferences",
    what: "Appearance (light/dark look, language, Picacho Light or the full studio), Your assistant (Aly's name, voice, lamp look, wheel, chat style, personality, live voice, push-to-talk key), Notifications, Email preferences",
  },
  security: {
    name: "Security",
    what: "Sign-in (email, password), Two-step verification, Devices, API keys (when the API is open to them), connected apps",
  },
  privacy: {
    name: "Privacy & data",
    what: "Shared to the community, Blocked accounts, Cookies, Your data (download or delete some of it), Danger zone (delete the account)",
  },
  help: {
    name: "Help",
    what: "the feedback form, the help email, Learn (guides, course, tutorial), Legal, Who runs Picacho",
  },
};

export const SITE_PAGES: readonly SitePage[] = [
  // ---- the app ------------------------------------------------------------
  { area: "app", path: "/app", name: "Home", gate: "all", what: "credits left, the average identity score, a reel of their best takes, \"Pick up where you left off\", their characters and recent renders (no character yet: an example reel and \"Set up your character\"). A Light account's Home is the Light chat." },
  { area: "app", path: "/app/generate", name: "Generate (the studio)", gate: "all", what: "the stage with the newest take and its filmstrip, the session transcript, and the composer: Video/Image switch, the send receipt, character, engine, length, aspect, Camera and Light & looks chips, mode pills (Multi-angle, Storyboard, Cinema Studio, Frames), dialogue, Enhance, the composer's assistant. Aly's prepared cards open here filled in." },
  { area: "app", path: "/app/light", name: "Picacho Light", gate: "all", light: true, what: "the simple version: one chat box (Aly's chat when it's open to them) where a picture or video comes back in the chat; a rail of chats, Search, four ideas, credits in the top bar." },
  { area: "app", path: "/app/chat", name: "Aly's chat page", gate: "chat", what: "Aly full-screen, like ChatGPT: many chats in a side list, Claude (Think harder = Opus), GPT or Gemini per message or \"Ask all three\", files and PDFs, documents in a side panel, render cards with \"Make it\". A Light account's chat opens inside Light." },
  { area: "app", path: "/app/chat/[id]", name: "One of Aly's chats", gate: "chat", what: "a saved chat, by its id." },
  { area: "app", path: "/app/chat/memory", name: "Aly's memory", gate: "chat", light: true, what: "the notes Aly keeps about them: read, edit, delete." },
  { area: "app", path: "/app/character", name: "Characters", gate: "all", what: "their cast: every saved character with its face, and \"New character\"." },
  { area: "app", path: "/app/character/new", name: "New character", gate: "all", what: "make a character: identity photo(s), name, traits, voice." },
  { area: "app", path: "/app/character/[id]", name: "A character", gate: "all", what: "one character: reference photos (up to 5, the face-lock meter), Perspective (a reference sheet), Outfit, traits, voice, project, delete." },
  { area: "app", path: "/app/media", name: "Media", gate: "all", light: true, what: "every finished picture and video in one grid, All / Images / Videos (\"Library\" in Light's rail)." },
  { area: "app", path: "/app/images", name: "Images", gate: "all", light: true, what: "finished pictures only, 60 a page (\"Images\" in Light's rail)." },
  { area: "app", path: "/app/videos", name: "Videos", gate: "all", what: "finished videos only, 60 a page." },
  { area: "app", path: "/app/history", name: "History", gate: "all", light: true, what: "every render ever made, failures included, as a contact sheet with type and outcome filters." },
  { area: "app", path: "/app/history/[id]", name: "One render (a take)", gate: "all", what: "one render: the result, its score and notes, download, \"Continue this clip\", Upscale, \"Share to community\", \"Report a problem\", the Keep going shelf of other tools. A Light account's take opens in Light." },
  { area: "app", path: "/app/projects", name: "Projects", gate: "all", what: "the shelf of projects: each with its cast's faces, renders, average score, last worked on; pin, star, archive." },
  { area: "app", path: "/app/projects/new", name: "New project", gate: "all", what: "name and describe a new project." },
  { area: "app", path: "/app/projects/[id]", name: "A project", gate: "all", what: "one project: its characters, renders, Aly's chats in it and her instructions for it." },
  { area: "app", path: "/app/community", name: "Community", gate: "all", what: "the members' feed of renders people chose to share, New or Top, with hearts." },
  { area: "app", path: "/app/templates", name: "Templates", gate: "all", what: "ready-made looks in five categories (Portrait, Product, Social, Marketing, Story); picking one fills the composer, nothing sends." },
  { area: "app", path: "/app/upscale", name: "Upscale video", gate: "all", what: "sharpen a video up to 2K: upload an MP4 (up to 20 s, 50 MB) or pick a recent take; both tiers' prices shown before anything is spent." },
  { area: "app", path: "/app/layers", name: "Layers", gate: "all", what: "split one image into named transparent layers: upload or pick a recent image, both tiers' prices shown first; the splits already made." },
  { area: "app", path: "/app/layers/[id]", name: "One split (its layers)", gate: "all", what: "one split's stack: change a layer from words, download one or all." },
  { area: "app", path: "/app/notes", name: "Notes", gate: "all", what: "their own free-text notes (ideas, prompts); \"New note\". Not Aly's memory." },
  { area: "app", path: "/app/sets", name: "Helios 3D (Sets)", gate: "setsVisible", what: "describe who, where and what happens; Astra builds the place as a 3D set to keep and reshoot; their sets. Opens on a computer, not in the phone app." },
  {
    area: "app",
    path: "/app/sets/[id]",
    name: "A Helios set",
    gate: "setsVisible",
    what: "one set's workspace: Set · Shoot · Film, Build (fix things by hand), stills, takes, Astra's chat; the \"Studio\" button in its top bar opens Helios Studio (?studio=1).",
    param: {
      key: "studio",
      options: [
        {
          value: "1",
          name: "Helios Studio",
          what: "the Blender-style 3D workspace on this set: objects, keyframes, physics, export and 3D-print check, path-traced renders, Astra in the right sidebar, Render ▸ Photo with your character.",
        },
      ],
    },
  },
  { area: "app", path: "/app/stage/[id]", name: "Angle stage", gate: "all", what: "one take's 3D stage for new angles of it, from its take page." },
  { area: "app", path: "/app/live", name: "Live", gate: "liveVisible", what: "a take that streams while they keep directing it in typed lines; prepaid 30/60/120 s." },
  { area: "app", path: "/app/press-tour", name: "Press Tour", gate: "pressTourVisible", what: "an ad for their product starring their character: plan (free), paint the stills, film." },
  { area: "app", path: "/app/mystique", name: "Recast", gate: "mystiqueVisible", what: "a saved character performs any video clip they upload." },
  { area: "app", path: "/app/recce", name: "Recce", gate: "recceVisible", what: "filmed footage read into a walkable Helios set." },
  { area: "app", path: "/app/edit", name: "Director's Cut (video editor)", gate: "cutVisible", what: "raw footage in, a finished edit out, with a timeline and an original score." },
  {
    area: "app",
    path: "/app/effects",
    name: "Effects",
    gate: "cutVisible",
    what: "effects put into a video, one-tap effects on a photo, titles and credits for a film.",
    param: {
      key: "tab",
      options: [
        { value: "video", name: "Video", what: "effects in the shot" },
        { value: "photo", name: "Photo", what: "one-tap effects" },
        { value: "titles", name: "Titles", what: "titles, credits, a vertical cut, a cover" },
      ],
    },
  },
  {
    area: "app",
    path: "/app/settings",
    name: "Settings",
    gate: "all",
    light: true,
    what: "eight rooms, chosen with ?tab=",
    param: {
      key: "tab",
      options: SETTINGS_TABS.filter((t) => t !== "overview").map((t) => ({ value: t, ...SETTINGS_ROOMS[t] })),
    },
  },
  { area: "app", path: "/app/more", name: "More (phone app)", gate: "all", what: "the phone app's fifth tab: the profile card, Tools, Your work, Helios, the course, Share, Settings." },
  { area: "app", path: "/app/tutorial", name: "Tutorial", gate: "all", what: "a walk-through of the studio (stage, characters, composer, transcript)." },
  { area: "app", path: "/app/welcome", name: "Welcome (the full studio or Picacho Light)", gate: "all", light: true, what: "the sign-up's choice: the full studio (recommended; lists what it gives free and with a plan) or Picacho Light's simple chat. The look follows the device; Settings changes both later." },
  { area: "app", path: "/app/checkout", name: "Checkout", gate: "all", noOpen: true, what: "the payment step, reached from a plan, pack or top-up button; send them to Plan & billing or Pricing instead." },
  { area: "app", path: "/app/profile", name: "(old address of Settings → Profile)", gate: "all", noOpen: true, what: "redirects to Settings → Profile." },
  { area: "app", path: "/app/usage", name: "(old address of Settings → Plan & billing)", gate: "all", noOpen: true, what: "redirects to Settings → Plan & billing." },

  // ---- the public site ----------------------------------------------------
  { area: "site", path: "/", name: "Picacho's front page", gate: "all", light: true, what: "the public home page: what Picacho is, examples, sign up." },
  { area: "site", path: "/pricing", name: "Pricing", gate: "all", light: true, what: "the plans, monthly or annual, and credit packs." },
  { area: "site", path: "/gallery", name: "Made with Picacho (gallery)", gate: "all", light: true, what: "the team's curated showcase." },
  { area: "site", path: "/guides", name: "Guides", gate: "all", light: true, what: "every guide." },
  { area: "site", path: "/guides/getting-started", name: "The Picacho course", gate: "all", light: true, what: "first login to first take." },
  { area: "site", path: "/guides/helios", name: "Helios 3D guide", gate: "all", what: "how Helios sets work." },
  { area: "site", path: "/guides/ai-camera-movements", name: "AI camera movements guide", gate: "all", what: "camera moves and how to ask for them." },
  { area: "site", path: "/guides/ai-character-consistency", name: "Character consistency guide", gate: "all", light: true, what: "keeping the same face across takes." },
  { area: "site", path: "/guides/seedance-2", name: "Seedance 2.0 guide", gate: "all", what: "the Seedance engine." },
  { area: "site", path: "/tools/identity-check", name: "Free identity checker", gate: "all", light: true, what: "score how well a generated face matches a real one, 0-100." },
  { area: "site", path: "/docs/api", name: "API docs", gate: "all", what: "the developer API (Elite)." },
  { area: "site", path: "/privacy", name: "Privacy policy", gate: "all", light: true, what: "the privacy policy." },
  { area: "site", path: "/terms", name: "Terms", gate: "all", light: true, what: "the terms of service." },
  { area: "site", path: "/content-policy", name: "Content policy", gate: "all", light: true, what: "what can't be made." },
  { area: "site", path: "/delete-account", name: "Deleting your account (help page)", gate: "all", light: true, what: "how to delete the account or some data." },

  // ---- the team's admin area ----------------------------------------------
  { area: "admin", path: "/admin", name: "Admin", gate: "admin", what: "the admin home." },
  { area: "admin", path: "/admin/activity", name: "Admin · Activity", gate: "admin", what: "the activity log." },
  { area: "admin", path: "/admin/billing", name: "Admin · Billing", gate: "admin", what: "billing overview." },
  { area: "admin", path: "/admin/emails", name: "Admin · Emails", gate: "admin", what: "emails sent and their templates." },
  { area: "admin", path: "/admin/feedback", name: "Admin · Feedback", gate: "admin", what: "feedback from Settings → Help." },
  { area: "admin", path: "/admin/flags", name: "Admin · Flags", gate: "admin", what: "feature switches." },
  { area: "admin", path: "/admin/moderation", name: "Admin · Moderation", gate: "admin", what: "flagged renders and posts." },
  { area: "admin", path: "/admin/payments", name: "Admin · Payments", gate: "admin", what: "payments." },
  { area: "admin", path: "/admin/product-checks", name: "Admin · Product checks", gate: "admin", what: "products waiting to be confirmed." },
  { area: "admin", path: "/admin/promo", name: "Admin · Promo codes", gate: "admin", what: "promo codes and partner commissions." },
  { area: "admin", path: "/admin/providers", name: "Admin · Providers", gate: "admin", what: "the AI providers and their state." },
  { area: "admin", path: "/admin/renders", name: "Admin · Renders", gate: "admin", what: "the render queue." },
  { area: "admin", path: "/admin/reports", name: "Admin · Reports", gate: "admin", what: "\"Report a problem\" reports and auto-filed failures." },
  { area: "admin", path: "/admin/security", name: "Admin · Security", gate: "admin", what: "security events." },
  { area: "admin", path: "/admin/settings", name: "Admin · Settings", gate: "admin", what: "app-wide settings." },
  { area: "admin", path: "/admin/stats", name: "Admin · Stats", gate: "admin", what: "usage and revenue numbers." },
  { area: "admin", path: "/admin/system", name: "Admin · System", gate: "admin", what: "system health, failure rates." },
  { area: "admin", path: "/admin/updates", name: "Admin · Updates", gate: "admin", what: "the changelog of what shipped." },
  { area: "admin", path: "/admin/users", name: "Admin · Users", gate: "admin", what: "accounts: credits, refunds, notes, grants." },
  { area: "admin", path: "/admin/users/[id]", name: "Admin · One user", gate: "admin", what: "one account: plan, credits, activity, refunds, notes, Aly access." },
  { area: "admin", path: "/admin/voices", name: "Admin · Voices", gate: "admin", what: "voices for characters and Aly." },
];

const GATE_WORDS: Record<PageGate, string> = {
  all: "",
  admin: " [team only]",
  chat: " [when Aly's chat page is open]",
  setsVisible: " [paid plans]",
  recceVisible: " [not open to customers yet]",
  mystiqueVisible: " [not open to customers yet]",
  liveVisible: " [when Live is open to them]",
  cutVisible: " [not open to customers yet]",
  pressTourVisible: " [not open to customers yet]",
};

/** What Aly knows about the site's pages. Deterministic bytes. */
export function renderSiteMap(): string {
  const line = (p: SitePage) => {
    const base = `- ${p.path} — ${p.name}${GATE_WORDS[p.gate]}: ${p.what}`;
    if (!p.param) return base;
    const opts = p.param.options.map((o) => `  - ${p.path}?${p.param!.key}=${o.value} — ${o.name}: ${o.what}`);
    return [base, ...opts].join("\n");
  };
  const block = (area: SitePage["area"]) => SITE_PAGES.filter((p) => p.area === area).map(line).join("\n");
  return `SITE MAP — every page of Picacho, what is on it, and who can open it ([brackets]; admins can open every page, and open_page says when a page isn't open to this person). [id] is a record's id from your tools or the app note.

THE APP:
${block("app")}

THE PUBLIC SITE:
${block("site")}

THE TEAM'S ADMIN AREA (admins only):
${block("admin")}`;
}

// ---------------------------------------------------------------------------
// Where open_page may send the browser.

const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ANCHOR = /^[a-z0-9-]{1,40}$/;

function matches(pattern: string, path: string): boolean {
  const a = pattern.split("/");
  const b = path.split("/");
  if (a.length !== b.length) return false;
  return a.every((seg, i) => (seg === "[id]" ? ID.test(b[i]) : seg === b[i]));
}

export function findPage(path: string): SitePage | undefined {
  // Exact pages first, so /app/chat/memory is never read as a chat id.
  return SITE_PAGES.find((p) => p.path === path) ?? SITE_PAGES.find((p) => p.path.includes("[id]") && matches(p.path, path));
}

export type ResolvedPage = { page: SitePage; href: string; label: string };

/**
 * The model's path → a page this list names, or a correctable error. Only
 * the page's own parameter survives, with a value it lists; an anchor
 * survives when it is a plain word. Anything else is dropped, never passed on.
 */
export function resolvePage(raw: unknown): ResolvedPage | { error: string } {
  let text = typeof raw === "string" ? raw.trim().slice(0, 300) : "";
  text = text.replace(/^https?:\/\/(www\.)?picacho\.ai(?=\/|$)/i, "");
  if (!text.startsWith("/") || text.startsWith("//")) {
    return { error: "Give a path from the SITE MAP, starting with / (for example /app/settings?tab=billing)." };
  }
  let url: URL;
  try {
    url = new URL(text, "https://picacho.ai");
  } catch {
    return { error: "That path couldn't be read. Use one from the SITE MAP." };
  }
  if (url.origin !== "https://picacho.ai") return { error: "Only Picacho's own pages can be opened." };
  const path = url.pathname.length > 1 ? url.pathname.replace(/\/+$/, "") : url.pathname;
  const page = findPage(path);
  if (!page) return { error: `${path} isn't a page in the SITE MAP. Pick the closest page there.` };
  if (page.noOpen) return { error: `${page.name} isn't a page to send someone to: ${page.what}` };

  let href = path;
  let label = page.name;
  if (page.param) {
    const value = url.searchParams.get(page.param.key);
    const option = page.param.options.find((o) => o.value === value);
    if (option) {
      href += `?${page.param.key}=${option.value}`;
      label = `${page.name} → ${option.name}`;
    }
  }
  const anchor = url.hash.replace(/^#/, "");
  if (anchor && ANCHOR.test(anchor)) href += `#${anchor}`;
  return { page, href, label };
}

/** The person's access, read by the route when open_page runs. */
export type PageAccess = {
  isAdmin: boolean;
  inLight: boolean;
  chatOpen: boolean;
  gates: Record<Exclude<PageGate, "all" | "admin" | "chat">, boolean>;
};

/** Whether this person can open the page; the reason when not. */
export function pageRefusal(page: SitePage, access: PageAccess): string | null {
  if (page.gate === "admin" && !access.isAdmin) return `${page.name} is for the Picacho team only.`;
  if (page.gate === "chat" && !access.chatOpen) return "Aly's chat page isn't open to them yet.";
  if (page.gate !== "all" && page.gate !== "admin" && page.gate !== "chat" && !access.gates[page.gate]) {
    return page.gate === "setsVisible"
      ? "Helios 3D is on the paid plans; it isn't open to this account. Pricing (/pricing) shows the plans."
      : `${page.name} isn't open to this account.`;
  }
  if (access.inLight && page.area === "app" && !page.light) {
    return `They use Picacho Light, and ${page.name} is part of the full studio. Keep them in Light; if they want the studio, it's Settings → Preferences → Appearance.`;
  }
  return null;
}
