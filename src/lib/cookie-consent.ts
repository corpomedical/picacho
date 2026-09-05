// Shared between the cookie banner (which writes the choice) and the
// page-view tracker (which reads it before firing anything non-essential).
// Kept in one place so the two never drift on the key name or valid values.

export const COOKIE_CONSENT_KEY = "picacho_cookie_consent";

export type CookieConsent = "accepted" | "declined";

// Both accessors are try/caught at the SOURCE: in a browser set to block all
// cookies (Chrome/Safari "Block all cookies", managed WebViews), merely
// touching window.localStorage throws a SecurityError. These are called from
// mount effects in the ROOT layout (the banner, the page-view tracker), so an
// unguarded throw replaced the entire site with the error screen for exactly
// the visitors who had asked for the most privacy.
export function getCookieConsent(): CookieConsent | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(COOKIE_CONSENT_KEY);
    return raw === "accepted" || raw === "declined" ? raw : null;
  } catch {
    // Storage unavailable: treat as "no choice recorded". The banner shows,
    // a choice just won't stick across visits — the honest degradation.
    return null;
  }
}

export function setCookieConsent(value: CookieConsent): void {
  try {
    window.localStorage.setItem(COOKIE_CONSENT_KEY, value);
  } catch {
    // Storage unavailable — the banner still hides for this visit.
  }
}
