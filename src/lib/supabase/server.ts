import { createServerClient } from "@supabase/ssr";
import { createClient as createRawClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";

/**
 * Supabase client for use on the server (Server Components, Route Handlers,
 * Server Actions). Reads/writes the session via cookies so the logged-in
 * user stays logged in across requests.
 */
export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options),
            );
          } catch {
            // setAll called from a Server Component — safe to ignore
            // because middleware refreshes the session on every request.
          }
        },
      },
    },
  );
}

/**
 * Admin-only Supabase client using the service role key. This bypasses
 * row-level security, so it must only ever be used in server-side code
 * (never sent to the browser) — e.g. the /admin area's data lookups.
 */
export function createAdminClient() {
  return createRawClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );
}
