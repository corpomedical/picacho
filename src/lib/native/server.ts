import { cookies, headers } from "next/headers";
import {
  NATIVE_COOKIE,
  userAgentIsNativeApp,
  userAgentSupportsAuthReturn,
} from "@/lib/native/platform";

// Server-side "is this the mobile app?" check, for Server Components that
// need to omit purchase UI entirely rather than hide it after render.
//
// Reads the cookie the middleware sets, and falls back to the user agent on
// the very first request of a session, before that cookie exists. Both are
// checked because either alone has a gap: the cookie isn't there on request
// one, and the UA isn't forwarded on some cached/streamed responses.
//
// Fails CLOSED in the sense that matters for App Review: if we can't tell,
// we treat it as a browser and show everything. That's the safe direction for
// revenue but the risky one for review, so the marker has to actually work —
// see the "verify the user agent" step in MOBILE_APP.md, which is not
// optional before submitting.
export async function isNativeApp(): Promise<boolean> {
  const cookieStore = await cookies();
  if (cookieStore.get(NATIVE_COOKIE)?.value === "1") return true;

  const headerStore = await headers();
  return userAgentIsNativeApp(headerStore.get("user-agent"));
}

// Can THIS shell catch an OAuth redirect coming back from the system browser?
//
// User agent only, with no cookie fallback, and that is the point: the cookie
// exists because the UA is missing on some cached responses, but here a
// missed detection means the OAuth buttons stay hidden — today's behaviour,
// and the safe direction. A cookie fallback could only make it answer "yes"
// on a request where we are less sure, which is the one answer that hurts.
export async function nativeSupportsAuthReturn(): Promise<boolean> {
  // KILL SWITCH, 2026-09-08. In-app Google sign-in is OFF.
  //
  // versionCode 14 shipped it to Play and it is broken on real devices: the
  // consent screen opens in the browser correctly, but choosing an account
  // ends up in Gmail composing a mail instead of returning to the app. The
  // person is left with a button that cannot complete, and no way back.
  //
  // Turned off HERE, in the website, on purpose. The capability token was
  // built so the site decides whether a binary may show these buttons, and
  // that cuts both ways: this reaches every installed v14 the moment Vercel
  // deploys, where a Play rollback would take hours and still not reach
  // anyone who had already updated. Email and password are untouched, which
  // is what every account used before yesterday.
  //
  // The version gate below now does the excluding: versionCode 14 claims
  // PicachoAuth/1 and the marker is /2, so the broken build can never be
  // offered these buttons again. This stays as an instant lever if 15 also
  // misbehaves — set NATIVE_OAUTH_DISABLED=1 in Vercel and it is off for
  // every build on the next request, no deploy and no store round trip.
  if (process.env.NATIVE_OAUTH_DISABLED === "1") return false;

  const headerStore = await headers();
  return userAgentSupportsAuthReturn(headerStore.get("user-agent"));
}
