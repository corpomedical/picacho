import { json, preflight, requireAdminFromRequest } from "@/lib/admin/api-auth";
import { loadLiveFeed } from "@/lib/admin/live-feed";

// GET /api/admin/live — the phone admin app's Live tab: payments, sign-ups,
// renders and issues, newest first (lib/admin/live-feed.ts).
export const runtime = "nodejs";

export function OPTIONS(request: Request) {
  return preflight(request);
}

export async function GET(request: Request) {
  const auth = await requireAdminFromRequest(request);
  if (auth instanceof Response) return auth;
  return json(request, await loadLiveFeed(auth.admin));
}
