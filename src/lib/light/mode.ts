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
