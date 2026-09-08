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

// Can THIS shell catch an OAuth redirect coming back from the Custom Tab?
//
// User agent only, with no cookie fallback, and that is the point: the cookie
// exists because the UA is missing on some cached responses, but here a
// missed detection means the OAuth buttons stay hidden — today's behaviour,
// and the safe direction. A cookie fallback could only make it answer "yes"
// on a request where we are less sure, which is the one answer that hurts.
export async function nativeSupportsAuthReturn(): Promise<boolean> {
  // KILL SWITCH. Set NATIVE_OAUTH_DISABLED=1 in Vercel and in-app Google
  // sign-in is off for every build on the next request — no deploy, no store
  // round trip. It was pulled within the hour on 2026-09-07, when versionCode
  // 14 turned out to end in Gmail instead of back in the app.
  //
  // Turned off HERE, in the website, on purpose. The capability token was
  // built so the site decides whether a binary may show these buttons, and
  // that cuts both ways: it reaches every installed build the moment Vercel
  // deploys, where a Play rollback takes hours and still misses anyone who
  // already updated. Email and password are untouched either way.
  //
  // Retiring a specific bad build is the token's job, not this switch's:
  // 14 claimed PicachoAuth/1, 15 claimed /2, and the marker is now /3, so
  // neither can be offered these buttons by any future deploy. This flag is
  // for the day the CURRENT build misbehaves too.
  if (process.env.NATIVE_OAUTH_DISABLED === "1") return false;

  const headerStore = await headers();
  return userAgentSupportsAuthReturn(headerStore.get("user-agent"));
}
