import { cookies, headers } from "next/headers";
import { NATIVE_COOKIE, userAgentIsNativeApp } from "@/lib/native/platform";

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
