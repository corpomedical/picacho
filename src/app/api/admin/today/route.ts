import { json, preflight, requireAdminFromRequest } from "@/lib/admin/api-auth";
import { loadToday } from "@/lib/admin/today";

// GET /api/admin/today — the phone admin app's Today screen: the same
// numbers, "Needs you" list and render queue as the website's Overview
// (lib/admin/today.ts). Each list item carries its actions; the app presses
// them through /api/admin/act.
export const runtime = "nodejs";

export function OPTIONS(request: Request) {
  return preflight(request);
}

export async function GET(request: Request) {
  const auth = await requireAdminFromRequest(request);
  if (auth instanceof Response) return auth;
  const today = await loadToday(auth.admin);
  return json(request, today);
}
