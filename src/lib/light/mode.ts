// PICACHO LIGHT (operator, 2026-09-27/28: "I mean a light version for
// unexperienced users that seek Chat gpt and Gemini experience").
//
// Two choices a person makes on the welcome step and can change in Settings:
// how they create (Light = one chat box, Advanced = the full studio) and
// which look the app wears. Both live on profiles (supabase/pending/
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

/** Where Light lives, and the welcome step. */
export const LIGHT_HOME = "/app/light";
export const WELCOME_PATH = "/app/welcome";

/**
 * Where the shell sends someone on this path, or null to stay.
 * A new account goes to the welcome step first (Settings stays reachable so
 * nobody is trapped); a Light account's /app opens the chat instead of the
 * studio's dashboard.
 */
export function shellRedirect(pathname: string, mode: AppMode, needsChoice: boolean): string | null {
  if (needsChoice) {
    return pathname === WELCOME_PATH || pathname.startsWith("/app/settings") ? null : WELCOME_PATH;
  }
  if (mode === "light" && pathname === "/app") return LIGHT_HOME;
  return null;
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
