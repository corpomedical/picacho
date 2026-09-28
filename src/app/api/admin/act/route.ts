import { json, preflight, requireAdminFromRequest } from "@/lib/admin/api-auth";
import {
  opAddNote,
  opAdjustCredits,
  opCheckRender,
  opEmailPerson,
  opRefundRender,
  opRestoreModel,
  opSetFeedbackStatus,
  opSetReportStatus,
  opSetUserStatus,
  opStopRender,
  type OpResult,
} from "@/lib/admin/ops";

// POST /api/admin/act — the phone admin app's buttons (2026-09-28 admin
// redesign). { action, fields } with the SAME action names and field names
// as the website's Today list (lib/admin/today.ts InboxAction), so an item
// the API hands the app can be pressed there exactly as it is pressed here.
// Every action is an op from lib/admin/ops.ts: the same code, the same
// checks and the same activity-log line as the website's buttons.

export const runtime = "nodejs";
// Check now / Stop drive a provider call; give them room.
export const maxDuration = 60;

type Fields = Record<string, string | number | boolean | undefined>;
const str = (f: Fields, k: string) => (f[k] === undefined || f[k] === null ? "" : String(f[k]));

const ACTIONS: Record<string, (admin: Parameters<typeof opAddNote>[0], actor: string, f: Fields) => Promise<OpResult>> = {
  resolveReport: (a, u, f) => opSetReportStatus(a, u, { reportId: str(f, "report_id"), status: str(f, "status") || "resolved" }),
  resolveFeedback: (a, u, f) => opSetFeedbackStatus(a, u, { feedbackId: str(f, "feedback_id"), status: str(f, "status") || "resolved" }),
  refundRender: (a, u, f) => opRefundRender(a, u, { generationId: str(f, "generation_id"), reason: str(f, "reason") }),
  checkRender: (a, u, f) => opCheckRender(a, u, { generationId: str(f, "generation_id") }),
  stopRender: (a, u, f) => opStopRender(a, u, { generationId: str(f, "generation_id"), refund: str(f, "refund") === "1" }),
  restoreModel: (a, u, f) => opRestoreModel(a, u, { modelId: str(f, "model_id") }),
  adjustCredits: (a, u, f) =>
    opAdjustCredits(a, u, {
      userId: str(f, "user_id"),
      direction: str(f, "direction") === "take" ? "take" : "give",
      amount: Number.parseInt(str(f, "amount"), 10),
      reason: str(f, "reason"),
    }),
  addNote: (a, u, f) => opAddNote(a, u, { userId: str(f, "user_id"), body: str(f, "body") }),
  setStatus: (a, u, f) => opSetUserStatus(a, u, { userId: str(f, "user_id"), status: str(f, "status") }),
  emailPerson: (a, u, f) =>
    opEmailPerson(a, u, {
      userId: str(f, "user_id"),
      what: str(f, "what"),
      serviceNotice: f.service_notice === true || str(f, "service_notice") === "on" || str(f, "service_notice") === "1",
    }),
};

export function OPTIONS(request: Request) {
  return preflight(request);
}

export async function POST(request: Request) {
  const auth = await requireAdminFromRequest(request);
  if (auth instanceof Response) return auth;

  let body: { action?: string; fields?: Fields };
  try {
    body = await request.json();
  } catch {
    return json(request, { error: "That request couldn't be read." }, 400);
  }
  const run = body.action ? ACTIONS[body.action] : undefined;
  if (!run) return json(request, { error: "Unknown action." }, 400);

  const result = await run(auth.admin, auth.userId, body.fields ?? {});
  return json(request, result.ok ? { ok: true, message: result.message ?? "Done." } : { ok: false, error: result.error }, result.ok ? 200 : 422);
}
