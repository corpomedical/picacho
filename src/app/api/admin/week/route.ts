import { json, preflight, requireAdminFromRequest } from "@/lib/admin/api-auth";
import { loadRetention } from "@/lib/retention/load";
import { weekPayload } from "@/lib/retention/api";

// GET /api/admin/week — the phone admin app's "This week" (2026-10-03, Who
// comes back): who was active, the tools they used, and the sign-up weeks.
// The same numbers as Admin → Who comes back on the website.
export const runtime = "nodejs";

export function OPTIONS(request: Request) {
  return preflight(request);
}

export async function GET(request: Request) {
  const auth = await requireAdminFromRequest(request);
  if (auth instanceof Response) return auth;
  try {
    return json(request, weekPayload(await loadRetention(auth.admin, 7)));
  } catch (err) {
    console.error("api/admin/week: failed", err);
    return json(request, { error: "Couldn't load this week right now." }, 500);
  }
}
