import { type NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";
import { NATIVE_COOKIE, userAgentIsNativeApp } from "@/lib/native/platform";

export async function middleware(request: NextRequest) {
  const response = await updateSession(request);

  // Record whether this session is running inside the iOS/Android shell, so
  // Server Components can omit purchase UI rather than render it and hide it
  // afterwards. Capacitor appends a marker to the user agent (see
  // capacitor.config.ts); this turns that into something readable everywhere.
  //
  // Not httpOnly on purpose — client components need to read the same signal,
  // and there's nothing sensitive in it. Session-scoped so a browser can't
  // inherit a stale "I'm the app" flag from some earlier context.
  const isNative = userAgentIsNativeApp(request.headers.get("user-agent"));
  const existing = request.cookies.get(NATIVE_COOKIE)?.value;
  if (isNative && existing !== "1") {
    response.cookies.set(NATIVE_COOKIE, "1", { path: "/", sameSite: "lax" });
  } else if (!isNative && existing === "1") {
    response.cookies.delete(NATIVE_COOKIE);
  }

  return response;
}

export const config = {
  matcher: [
    /*
     * Run on every route except static files and images, so the session
     * cookie stays fresh everywhere without wasting work on assets.
     */
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
