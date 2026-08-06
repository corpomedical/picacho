// Shared between the cookie banner (which writes the choice) and the
// page-view tracker (which reads it before firing anything non-essential).
// Kept in one place so the two never drift on the key name or valid values.

export const COOKIE_CONSENT_KEY = "picacho_cookie_consent";

export type CookieConsent = "accepted" | "declined";

export function getCookieConsent(): CookieConsent | null {
  if (typeof window === "undefined") return null;
  const raw = window.localStorage.getItem(COOKIE_CONSENT_KEY);
  return raw === "accepted" || raw === "declined" ? raw : null;
}
