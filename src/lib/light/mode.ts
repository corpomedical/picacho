// PICACHO LIGHT (operator, 2026-09-27/28: "I mean a light version for
// unexperienced users that seek Chat gpt and Gemini experience").
//
// Two choices, both changeable in Settings: how a person creates (Light =
// one chat box, Advanced = the full studio), picked on the welcome step, and
// which look the app wears, which the welcome step takes from the device
// (welcomeLook) since it stopped asking (2026-09-29). Both live on profiles (supabase/pending/
// picacho-light.sql). Pure and alias-free so the rules are unit-testable.

export type AppMode = "light" | "advanced";
export type AppLook = "light" | "dark" | "system";

/** The profile's stored mode. Anything else (no column yet, garbage) is null. */
export function parseAppMode(raw: unknown): AppMode | null {
  return raw === "light" || raw === "advanced" ? raw : null;
}

export function parseAppLook(raw: unknown): AppLook | null {
  return raw === "light" || raw === "dark" || raw === "system" ? raw : null;
}

/**
 * What the app shell does with a profile read of `app_mode`.
 *
 * Fails safe: before the SQL runs the read errors, and everyone stays in the
 * full studio with no welcome step. After it runs, existing accounts were
 * backfilled to "advanced"; only a new account (NULL) is asked.
 */
export function resolveAppMode(read: { error: unknown; mode: unknown }): {
  mode: AppMode;
  needsChoice: boolean;
} {
  if (read.error) return { mode: "advanced", needsChoice: false };
  const mode = parseAppMode(read.mode);
  return mode ? { mode, needsChoice: false } : { mode: "advanced", needsChoice: true };
}

/**
 * The look saved with the welcome step's choice. The step no longer asks
 * (operator, 2026-09-29, the choice page with the studio first: "Light or
 * dark follows your device. You can change it in Settings."): a device that
 * already picked a look keeps it, anything else follows the device.
 */
export function welcomeLook(deviceStored: string | null): AppLook {
  return parseAppLook(deviceStored) ?? "system";
}

/** Where Light lives, and the welcome step. */
export const LIGHT_HOME = "/app/light";
export const WELCOME_PATH = "/app/welcome";

/**
 * Light's own box, without Aly (operator, 2026-09-29: "Aly IS the Light
 * chat"): where her card's "Open" lands, and the way on when her allowance
 * runs out, since credits still make pictures and videos.
 */
export const LIGHT_DIRECT_HREF = `${LIGHT_HOME}?direct=1`;

/** One of Aly's chats, as Light opens it. */
export function lightChatHref(chatId: string): string {
  return `${LIGHT_HOME}?chat=${chatId}`;
}

/**
 * Which chat /app/light shows. Aly's, when her chat is open, unless the
 * address asks for Light's own box: a take to show (a notification, Search,
 * the Library), a send prepared elsewhere (her card's "Open", the lamp), or
 * direct=1. `chat` is kept only when it looks like a chat id.
 */
export function lightView(
  params: { take?: string; prompt?: string; direct?: string; chat?: string },
  alyOpen: boolean,
): { view: "aly"; chatId: string | null } | { view: "direct" } {
  const own = Boolean(params.take) || Boolean((params.prompt ?? "").trim()) || params.direct === "1";
  if (!alyOpen || own) return { view: "direct" };
  const chat = params.chat ?? "";
  return { view: "aly", chatId: /^[0-9a-f-]{36}$/i.test(chat) ? chat : null };
}

/**
 * Where the shell sends someone on this path, or null to stay.
 * A new account goes to the welcome step first (Settings stays reachable so
 * nobody is trapped); a Light account's /app opens the chat instead of the
 * studio's dashboard.
 */
export function shellRedirect(pathname: string, mode: AppMode, needsChoice: boolean, search = ""): string | null {
  if (needsChoice) {
    return pathname === WELCOME_PATH || pathname.startsWith("/app/settings") ? null : WELCOME_PATH;
  }
  if (mode !== "light") return null;
  if (pathname === "/app") return LIGHT_HOME;
  // Any other way in (a notification, an email, a bookmark, the assistant)
  // to the composer or a take's page opens Light's chat instead. A link that
  // asks for the studio on purpose ("Open in full studio") carries studio=1.
  const query = search.startsWith("?") ? search.slice(1) : search;
  if (new URLSearchParams(query).get("studio") === "1") return null;
  if (pathname === "/app/generate" || /^\/app\/history\/[^/]+$/.test(pathname) || isAlyChatPath(pathname, query)) {
    return lightHref(query ? `${pathname}?${query}` : pathname);
  }
  return null;
}

/** A link that opens the studio on purpose, even for a Light account. */
export function studioHref(href: string): string {
  return href.includes("?") ? `${href}&studio=1` : `${href}?studio=1`;
}

/** The greeting's name: the first word of the full name, else nothing ("Hi there"). */
export function firstName(fullName: string | null | undefined): string | null {
  const first = (fullName ?? "").trim().split(/\s+/)[0];
  return first ? first : null;
}

/**
 * Where a device remembers the account look it last saw, so a change made
 * somewhere else (an admin, or Settings on another device) reaches it once.
 */
export const ACCOUNT_LOOK_SEEN_KEY = "picacho_account_look_seen";

/**
 * The look this device should switch to now, or null to leave it alone.
 * A device that never picked a look takes the account's. After that, the
 * device's own pick wins until the account's look CHANGES (an admin set it,
 * or the person saved a new one elsewhere): then the new one applies once.
 * The first time a device sees the account look it only remembers it, so
 * nobody's screen flips the day this rule ships.
 */
export function lookToApply(
  account: AppLook | null,
  deviceStored: string | null,
  lastSeen: string | null,
): AppLook | null {
  if (!account) return null;
  if (deviceStored === null) return account;
  if (lastSeen === null) return null;
  return lastSeen === account ? null : account;
}

/** The two choices in an admin's words ("Studio" is the full studio). */
export const ADMIN_MODE_LABELS: Record<AppMode, string> = { light: "Picacho Light", advanced: "Studio" };
export const ADMIN_LOOK_LABELS: Record<AppLook, string> = { light: "Light", dark: "Dark", system: "Same as device" };

/**
 * A studio link, as Picacho Light should open it (operator, 2026-09-28:
 * "When I talk to the assistant and give her a job to add a prompt to the
 * generator in light mode, it takes me to the studio generator").
 * The composer with a prompt → the Light chat with it filled in (same
 * query: type, prompt, character, model, seconds); a take's page → that
 * take in the Light chat. Everything else is left as it is.
 */
export function lightHref(href: string): string {
  const [path, query] = href.split("?", 2) as [string, string | undefined];
  if (path === "/app/generate") return query ? `${LIGHT_HOME}?${query}` : LIGHT_HOME;
  const take = /^\/app\/history\/([^/]+)$/.exec(path);
  if (take) return `${LIGHT_HOME}?take=${take[1]}`;
  // Aly's own page: she is Light's chat (2026-09-29), so a new chat or one
  // of hers opens there. A chat started inside a project keeps her page.
  if (isAlyChatPath(path, query ?? "")) {
    const chat = /^\/app\/chat\/([0-9a-f-]{36})$/i.exec(path);
    return chat ? lightChatHref(chat[1]) : LIGHT_HOME;
  }
  return href;
}

/** Aly's chat page, a new chat or one of hers; not her Memory page or a project's new chat. */
function isAlyChatPath(path: string, query: string): boolean {
  if (/^\/app\/chat\/[0-9a-f-]{36}$/i.test(path)) return true;
  return path === "/app/chat" && !new URLSearchParams(query).has("project");
}

/** What an Aly-prepared link asks the Light chat to fill in (checked on the server). */
export type LightPrepared = {
  kind: "image" | "video";
  prompt: string;
  characterId: string | null;
  characterName: string | null;
  videoModelId: string | null;
  videoModelName: string | null;
  seconds: number | null;
};
