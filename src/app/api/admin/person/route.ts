import { json, preflight, requireAdminFromRequest } from "@/lib/admin/api-auth";
import { ADMIN_ACTION_COLUMNS, actionLabel, emailsForIds, type AdminActionRow } from "@/lib/admin/audit";
import { creditsHeld, modelName } from "@/lib/admin/today";
import { loadPersonPath } from "@/lib/retention/load";
import { pathSummary } from "@/lib/retention/api";

// GET /api/admin/person?id=<uuid> — one person for the phone admin app's
// person sheet (2026-09-28 admin redesign): who they are, their balances,
// their last renders (and which can still be refunded by hand), admin notes,
// what admins changed on the account, and the email templates that can be
// sent to them. The same facts the website's person page shows.
export const runtime = "nodejs";

export function OPTIONS(request: Request) {
  return preflight(request);
}

export async function GET(request: Request) {
  const auth = await requireAdminFromRequest(request);
  if (auth instanceof Response) return auth;
  const { admin } = auth;

  const id = new URL(request.url).searchParams.get("id") ?? "";
  if (!/^[0-9a-f-]{36}$/i.test(id)) return json(request, { error: "Pick a person." }, 400);

  const { data: person } = await admin
    .from("profiles")
    .select(
      "id, email, full_name, username, role, plan, plan_status, status, bonus_credits, purchased_credits, created_at, last_seen_at, marketing_opt_out, stripe_customer_id",
    )
    .eq("id", id)
    .maybeSingle();
  if (!person) return json(request, { error: "That person wasn't found." }, 404);

  const [{ data: gens }, notes, changes, { data: templates }, path] = await Promise.all([
    admin
      .from("generations")
      .select("id, prompt_input, status, created_at, content_type, video_model_id, model_id, credits_used, purchased_credits_used, bonus_credits_used")
      .eq("user_id", id)
      .order("created_at", { ascending: false })
      .limit(15),
    admin.from("admin_user_notes").select("id, created_at, admin_id, body").eq("user_id", id).order("created_at", { ascending: false }).limit(20),
    admin.from("admin_actions").select(ADMIN_ACTION_COLUMNS).eq("subject_user_id", id).order("created_at", { ascending: false }).limit(15),
    admin.from("email_templates").select("key, subject").order("key"),
    // Who comes back (2026-10-03): their four steps, a banner when they're slipping away, the tools they use.
    loadPersonPath(admin, id),
  ]);

  const genIds = (gens ?? []).map((g) => g.id as string);
  const { data: handRefunds } = genIds.length
    ? await admin.from("admin_actions").select("target_id").eq("action", "render.refund").in("target_id", genIds)
    : { data: [] as { target_id: string }[] };
  const refunded = new Set((handRefunds ?? []).map((r) => r.target_id as string));

  const noteRows = (notes.data ?? []) as { id: string; created_at: string; admin_id: string | null; body: string }[];
  const changeRows = (changes.data ?? []) as AdminActionRow[];
  const emails = await emailsForIds(admin, [...noteRows.map((n) => n.admin_id), ...changeRows.map((c) => c.admin_id)]);

  return json(request, {
    person,
    auditReady: !notes.error && !changes.error,
    renders: (gens ?? []).map((g) => {
      const held = creditsHeld(g);
      return {
        id: g.id,
        prompt: g.prompt_input,
        status: g.status,
        createdAt: g.created_at,
        kind: g.content_type,
        model: modelName((g.video_model_id as string | null) ?? (g.model_id as string | null)),
        credits: held,
        refundedByHand: refunded.has(g.id as string),
        canRefund: held > 0 && !refunded.has(g.id as string),
      };
    }),
    notes: noteRows.map((n) => ({ ...n, admin: (n.admin_id && emails.get(n.admin_id)) || "an admin" })),
    changes: changeRows.map((c) => ({
      ...c,
      label: actionLabel(c.action),
      admin: (c.admin_id && emails.get(c.admin_id)) || "an admin",
    })),
    templates: templates ?? [],
    retention: path ? pathSummary(path) : null,
  });
}
