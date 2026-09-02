import { requireAdmin } from "@/lib/admin/require-admin";
import { saveEmailTemplate } from "@/lib/admin/email-actions";
import { PLAN_LABELS, PLAN_LIMITS, type PlanId } from "@/lib/plans";
import { renderTemplate, type TemplateVars } from "@/lib/email/render";
import { unsubscribeUrl } from "@/lib/email/send";
import { Card } from "@/components/ui/card";
import { Input, Label, Textarea } from "@/components/ui/field";
import { SubmitButton } from "@/components/ui/submit-button";
import { AdminErrorBanner, AdminSuccessBanner } from "@/components/admin-error-banner";
import { LocalDate } from "@/components/local-date";
import {
  EmailTemplateCard,
  TemplateVariablesLegend,
  type AudienceOption,
  type EmailTemplateRow,
} from "@/components/admin/email-template-card";

export const dynamic = "force-dynamic";

// A blast is sequential rate-limited chunks (see sendBatch in
// lib/email/send.ts): 5,000 recipients = 50 requests spaced 600ms apart,
// roughly a minute — over the default function budget. Server actions run
// under the segment config of the page that posted them, so the ceiling is
// raised here; 300 is the Hobby-plan maximum (see the maxDuration note on
// app/generate/page.tsx).
export const maxDuration = 300;

type SendRow = {
  id: string;
  template_key: string | null;
  subject: string | null;
  audience: string | null;
  recipient_count: number | null;
  created_at: string;
};

export default async function AdminEmailsPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; message?: string }>;
}) {
  const { error: actionError, message } = await searchParams;

  // requireAdmin() here rather than trusting the layout gate alone — this
  // page reads service-role-only tables (email_templates / email_sends) with
  // the admin client, so it verifies the caller itself, the same discipline
  // lib/admin/activity.ts documents.
  const { supabase, admin, userId } = await requireAdmin();

  const emailConfigured = Boolean(process.env.RESEND_API_KEY);

  const [templatesRes, sendsRes, profileRes] = await Promise.all([
    admin
      .from("email_templates")
      .select("id, key, subject, body, updated_at")
      .order("key", { ascending: true }),
    admin
      .from("email_sends")
      .select("id, template_key, subject, audience, recipient_count, created_at")
      .order("created_at", { ascending: false })
      .limit(20),
    supabase.from("profiles").select("email, username, plan").eq("id", userId).single(),
  ]);

  // The tables ship in supabase/pending-2026-08-19/email.sql — until it's
  // applied, say so plainly instead of rendering a page where every button
  // fails with a generic banner.
  if (templatesRes.error) {
    return (
      <div>
        <div>
        <p className="text-[10.5px] font-semibold uppercase tracking-[0.14em] text-atelier-muted">Product</p>
        <h1 className="mt-1 font-numeral text-3xl text-atelier-ink">Emails</h1>
      </div>
        <Card className="mt-6 border-amber-200 bg-amber-50">
          <p className="text-sm text-amber-800">
            The email tables aren&apos;t in the database yet. Apply{" "}
            <code className="font-mono text-[13px]">supabase/pending-2026-08-19/email.sql</code> to
            the live project, then reload this page.
          </p>
        </Card>
      </div>
    );
  }

  const templates = (templatesRes.data ?? []) as EmailTemplateRow[];
  const sends = (sendsRes.data ?? []) as SendRow[];

  // Audience options + live recipient counts, computed with EXACTLY the
  // filters sendEmailBlast applies (active, not opted out, plan-scoped) —
  // the number on the send button must be the number the blast would hit.
  // serviceCount is the same query minus the opt-out exclusion, mirroring
  // what the blast query becomes when the service-notice flag is set, so
  // ticking that checkbox shows the true (larger) reach before the send.
  // A failed count (e.g. marketing_opt_out not applied yet) degrades to "?"
  // and the blast itself still fails closed server-side.
  const audienceDefs: { value: string; label: string }[] = [
    { value: "all", label: "All users" },
    { value: "free", label: "Free users" },
    ...(Object.keys(PLAN_LIMITS) as PlanId[])
      .filter((plan) => plan !== "none")
      .map((plan) => ({ value: `plan:${plan}`, label: `${PLAN_LABELS[plan]} plan` })),
  ];
  const audiences: AudienceOption[] = await Promise.all(
    audienceDefs.map(async (def) => {
      const countFor = async (serviceNotice: boolean): Promise<number | null> => {
        let query = admin
          .from("profiles")
          .select("id", { count: "exact", head: true })
          .eq("status", "active");
        if (!serviceNotice) query = query.eq("marketing_opt_out", false);
        if (def.value === "free") query = query.eq("plan", "none");
        else if (def.value.startsWith("plan:")) query = query.eq("plan", def.value.slice(5));
        const { count, error } = await query;
        return error ? null : (count ?? 0);
      };
      const [count, serviceCount] = await Promise.all([countFor(false), countFor(true)]);
      return { ...def, count, serviceCount };
    }),
  );

  // Preview variables: the admin's own profile, run through the same
  // renderTemplate a real send uses — the preview IS the send path, not a
  // lookalike. The unsubscribe link is the admin's real one (the iframe is
  // fully sandboxed, so it can't be clicked from the preview).
  const profile = profileRes.data;
  const previewPlan: PlanId =
    profile?.plan && profile.plan in PLAN_LIMITS ? (profile.plan as PlanId) : "none";
  const previewVars: TemplateVars = {
    username: profile?.username ?? "",
    email: profile?.email ?? "",
    plan: PLAN_LABELS[previewPlan],
    credits: String(PLAN_LIMITS[previewPlan]),
  };
  const adminUnsubscribeUrl = await unsubscribeUrl(userId);

  return (
    <div>
      <AdminErrorBanner error={actionError} />
      <AdminSuccessBanner message={message} />

      <div>
        <p className="text-[10.5px] font-semibold uppercase tracking-[0.14em] text-atelier-muted">Product</p>
        <h1 className="mt-1 font-numeral text-3xl text-atelier-ink">Emails</h1>
      </div>
      <p className="mt-1 text-sm text-neutral-500">
        Announcement templates, sent by hand to a chosen audience. Nothing here ever sends on its
        own, and account emails (sign-up confirmation, password reset) are a separate system.
      </p>

      {!emailConfigured && (
        <Card className="mt-6 border-amber-200 bg-amber-50 p-5">
          <p className="text-sm text-amber-800">
            <span className="font-semibold">RESEND_API_KEY is not set</span> — templates can be
            written and previewed, but every send fails until the key is configured (see
            resend.com, then verify the sending domain and set EMAIL_FROM).
          </p>
        </Card>
      )}

      <div className="mt-6 space-y-3">
        {templates.length === 0 ? (
          <Card>
            <p className="text-sm text-neutral-500">No templates yet — create the first one below.</p>
          </Card>
        ) : (
          templates.map((template) => (
            <EmailTemplateCard
              key={template.id}
              template={template}
              previewHtml={
                renderTemplate(template.subject, template.body, previewVars, adminUnsubscribeUrl)
                  .html
              }
              audiences={audiences}
              emailConfigured={emailConfigured}
            />
          ))
        )}
      </div>

      <Card className="mt-6">
        <h2 className="text-sm font-semibold text-neutral-900">New template</h2>
        <form action={saveEmailTemplate} className="mt-4 grid gap-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <Label htmlFor="new-key">Key</Label>
              <Input
                id="new-key"
                name="key"
                placeholder="spring-launch"
                pattern="[a-z0-9-]{2,40}"
                title="2-40 characters: lowercase letters, numbers and hyphens"
                required
              />
              <p className="mt-1.5 text-xs text-neutral-400">
                Permanent name for this template — it&apos;s how the send log refers to it.
              </p>
            </div>
            <div>
              <Label htmlFor="new-subject">Subject</Label>
              <Input id="new-subject" name="subject" maxLength={200} required />
            </div>
          </div>
          <div>
            <Label htmlFor="new-body">Body</Label>
            <Textarea
              id="new-body"
              name="body"
              rows={10}
              maxLength={20000}
              required
              className="font-mono text-[13px]"
              placeholder={"Hi {{username}},\n\nA blank line starts a new paragraph…"}
            />
          </div>
          <TemplateVariablesLegend />
          <div>
            <SubmitButton pendingLabel="Saving…">Save template</SubmitButton>
          </div>
        </form>
      </Card>

      {sends.length > 0 && (
        <Card className="mt-6 p-0">
          <h2 className="px-5 pt-5 text-sm font-semibold text-neutral-900">Recent sends</h2>
          <div className="mt-3 divide-y divide-neutral-100">
            {sends.map((send) => (
              <div
                key={send.id}
                className="flex flex-wrap items-center justify-between gap-2 px-5 py-3 text-sm"
              >
                <div className="min-w-0">
                  <p className="truncate font-medium text-neutral-900">{send.subject ?? "—"}</p>
                  <p className="text-xs text-neutral-500">
                    <span className="font-mono">{send.template_key ?? "?"}</span> ·{" "}
                    {send.audience ?? "?"} · <LocalDate date={send.created_at} mode="datetime" />
                  </p>
                </div>
                <p className="text-xs text-neutral-600">
                  {send.recipient_count ?? 0} recipient{send.recipient_count === 1 ? "" : "s"}
                </p>
              </div>
            ))}
          </div>
        </Card>
      )}
    </div>
  );
}
