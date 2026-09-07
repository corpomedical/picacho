// The Android app's OAuth return, and ONLY the app's.
//
// It exists because /auth/callback is shared. The browser's own Google
// sign-in returns there (oauth-buttons.tsx), and so does every password-reset
// email (forgot-password-form.tsx sends
// /auth/callback?next=/reset-password). A verified App Link claiming that
// path would capture all three, and two of them start in a BROWSER — whose
// PKCE verifier lives in its own cookie jar, not the app's WebView. Tapping a
// reset link in Gmail would have opened the app, failed the exchange, and
// spent the one-time code: a flow that works today, broken by a release meant
// to fix something else.
//
// So the app asks the provider for THIS path instead, the intent filter is
// scoped to it, and /auth/callback goes back to being untouched by Android.
//
// The behaviour is the real callback's, re-exported rather than reimplemented
// — that handler enforces the signups_enabled kill switch, stamps
// terms_accepted_at and resolves the picacho_ref referral, and a second copy
// of it would drift. This path is a different DOOR, not different logic.
//
// It also has to work when nobody intercepts it: if App Link verification has
// not landed, the browser loads this URL itself. Then it behaves exactly as
// /auth/callback does for a browser with no verifier — the exchange is
// refused and the person lands on /login?error=oauth, rather than holding a
// half-made session.
export { GET } from "@/app/auth/callback/route";
