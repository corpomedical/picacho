// The Director's Cut preview frame loads a video's editable project from here
// (src/lib/editor/project-serve.ts says what it answers and why a signed token,
// not a session, is the key).
import { createAdminClient } from "@/lib/supabase/server";
import { serveProjectFile } from "@/lib/editor/project-serve";

export const dynamic = "force-dynamic";

export async function GET(request: Request, context: { params: Promise<{ token: string; path: string[] }> }) {
  const { token, path } = await context.params;
  let supabaseOrigin: string | null = null;
  try {
    supabaseOrigin = process.env.NEXT_PUBLIC_SUPABASE_URL ? new URL(process.env.NEXT_PUBLIC_SUPABASE_URL).origin : null;
  } catch {
    supabaseOrigin = null;
  }
  return serveProjectFile(token, path, new URL(request.url).searchParams, { admin: createAdminClient(), supabaseOrigin });
}
