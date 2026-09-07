"use client";

import { useEffect } from "react";
import { capPlugin } from "@/lib/native/bridge";

// Walks an OAuth sign-in back INTO the app.
//
// Why this component has to exist at all: with a remote `server.url`, Capacitor
// never navigates the WebView to a deep link. Bridge.load() always loads
// server.url; the incoming URI is only stashed for App.getLaunchUrl() and
// broadcast as the `appUrlOpen` event. So nothing happens on return unless the
// page's own JS listens and navigates — which is what this does.
//
// The round trip:
//   1. oauth-buttons asks Supabase for the provider URL with
//      redirectTo = ai.picacho.app://auth-callback, which writes the PKCE
//      verifier as a host-only cookie in THIS WebView's jar.
//   2. The WebView tries to navigate there; the host is not in
//      allowNavigation, so Capacitor cancels the load and hands it to the
//      system browser — a user agent Google actually permits.
//   3. Provider → Supabase → 302 to ai.picacho.app://auth-callback?code=…
//   4. The intent filter routes that to MainActivity (singleTask → onNewIntent)
//      and Capacitor fires `appUrlOpen`.
//   5. We navigate the WebView to /auth/callback?code=… — same origin, so the
//      verifier cookie rides along and the EXISTING server route does the
//      exchange, unchanged. That route is not a thin redirect: it enforces the
//      signups_enabled kill switch, stamps terms_accepted_at and resolves the
//      picacho_ref referral. Exchanging in client JS instead would skip all
//      three.
//
// Inert everywhere else: capPlugin returns null off-native, and a shell binary
// without the intent filter can never receive the event.
export function NativeAuthReturn() {
  useEffect(() => {
    const app = capPlugin("App");
    if (!app) return;

    // MainActivity is exported and the filter is BROWSABLE, so any app on the
    // device can launch us with this scheme. Never navigate to the URL we were
    // handed: pull out a validated code and rebuild the destination ourselves,
    // the same posture /auth/callback already takes by using getOrigin()
    // instead of trusting request.url. Worst case from a hostile launch is a
    // wasted trip to /login?error=oauth — the code is useless without the
    // verifier, which only exists in this WebView.
    function handle(url: string | null | undefined) {
      if (!url) return;
      let parsed: URL;
      try {
        parsed = new URL(url);
      } catch {
        return;
      }
      // Two shapes reach here. The verified App Link is
      // https://picacho.ai/auth/app-callback — the app's OWN path, not the
      // shared /auth/callback, which browser sign-in and every password-reset
      // email also use and which this app must never capture. The custom
      // scheme is versionCode 14's; nothing asks for it any more, but a
      // redirect already in flight when this deploys can still arrive on it.
      const isAppLink =
        parsed.protocol === "https:" &&
        parsed.host === "picacho.ai" &&
        parsed.pathname.startsWith("/auth/app-callback");
      // Custom-scheme URLs put the "host" in different places across parsers;
      // accept either shape rather than depending on one.
      const isScheme =
        parsed.protocol === "ai.picacho.app:" &&
        (parsed.host || parsed.pathname.replace(/^\/+/, "")) === "auth-callback";
      if (!isAppLink && !isScheme) return;

      const code = parsed.searchParams.get("code");
      if (code && /^[A-Za-z0-9._~-]+$/.test(code)) {
        // Belt and braces against the loop described above ever coming back by
        // another route. An auth code is single-use, so a code we have already
        // walked in cannot succeed a second time — refuse it rather than spend
        // a navigation finding out. Keyed by the code itself, so a genuine
        // second attempt (a new code) is unaffected. sessionStorage because it
        // survives document navigations, which is exactly the boundary a
        // module-level flag would die at.
        try {
          const seen = "picacho_oauth_code";
          if (window.sessionStorage.getItem(seen) === code) return;
          window.sessionStorage.setItem(seen, code);
        } catch {
          // Storage disabled: fall through. The retained-event contract above
          // already delivers once; this guard is the backup, not the mechanism.
        }
        // A REAL document navigation, not router.push, and the lint rule below
        // is wrong for this one case. /auth/callback is a Route Handler, not a
        // page: the browser has to make an actual HTTP request so the PKCE
        // verifier cookie is sent and the Set-Cookie carrying the session is
        // stored. A soft client-side navigation does neither, and would fail
        // silently — sign-in would appear to work and leave you logged out.
        // eslint-disable-next-line @next/next/no-location-assign-relative-destination
        // Handed to the SHARED callback, which is where the exchange logic
        // lives. Safe from inside the app: this is a same-origin navigation
        // in our own WebView, so the verifier written when sign-in started is
        // right here. `next` is forwarded when the provider passed one, and
        // validated the same way the route validates it — a relative path
        // only, so a crafted launch cannot turn this into an open redirect.
        const rawNext = parsed.searchParams.get("next");
        const next =
          rawNext && /^\/[a-zA-Z0-9/_\-?=&.%]*$/.test(rawNext) && !rawNext.startsWith("//")
            ? `&next=${encodeURIComponent(rawNext)}`
            : "";
        window.location.assign(`/auth/callback?code=${encodeURIComponent(code)}${next}`);
        return;
      }
      // The provider can also come back with a refusal ("cancelled", denied
      // consent). Land on the same page a failed exchange does, so the person
      // sees the sign-in form again instead of a dead screen.
      // Full navigation for the same reason as above: this runs while the
      // session state is mid-flight, so the page should be re-fetched rather
      // than re-rendered from a client cache that predates the attempt.
      // eslint-disable-next-line @next/next/no-location-assign-relative-destination
      window.location.assign("/login?error=oauth");
    }

    let handle_: { remove?: () => void } | undefined;
    const maybePromise = app.addListener?.("appUrlOpen", (event: { url?: string }) => {
      handle(event?.url);
    });
    void Promise.resolve(maybePromise).then((h) => {
      handle_ = h as { remove?: () => void };
    });

    // Cold start is already covered, and NOT by App.getLaunchUrl().
    //
    // getLaunchUrl was the obvious choice and it is a trap: Bridge.intentUri is
    // assigned once in the Bridge constructor (Bridge.java:229) and never
    // cleared or consumed, so it returns the launching URI for the whole life
    // of the Activity — on every page. Since this component sits in the root
    // layout, a SUCCESSFUL cold-start sign-in would land on /app, remount,
    // read the same spent code, fail the exchange, bounce to /login, get
    // redirected to /app by the live session, and go round forever.
    //
    // The retained event is the correct path and self-limits:
    // BridgeActivity.load() routes the launch intent through onNewIntent, so
    // appUrlOpen is fired and retained before any JS exists; Bridge.reset()
    // clears eventListeners but NOT retainedEventArguments; and the replay
    // (Plugin.java:712-724) REMOVES the retained args before delivering, so it
    // arrives exactly once no matter how many documents load after it.

    return () => {
      handle_?.remove?.();
    };
  }, []);

  return null;
}
