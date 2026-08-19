"use client";

import { useState } from "react";
import { Card } from "@/components/ui/card";
import { Input, Label, Textarea } from "@/components/ui/field";
import { SubmitButton } from "@/components/ui/submit-button";
import { LocalDate } from "@/components/local-date";
import { TEMPLATE_VARIABLES } from "@/lib/email/render";
import {
  deleteEmailTemplate,
  saveEmailTemplate,
  sendEmailBlast,
  sendTestEmail,
} from "@/lib/admin/email-actions";

// One email template, with its edit form, preview, test send and the guarded
// blast form. A client component purely so the four panels can open in place
// (same reasoning as promo-code-card) — everything that changes data or
// sends anything still goes through a server action.

export type EmailTemplateRow = {
  id: string;
  key: string;
  subject: string;
  body: string;
  updated_at: string;
};

export type AudienceOption = {
  /** The exact string sendEmailBlast validates AND the confirmation text the admin must type. */
  value: string;
  label: string;
  /** Server-computed with the same filters the blast query uses; null when the count query failed (email.sql not applied). */
  count: number | null;
  /** Same query WITHOUT the marketing opt-out exclusion — what the audience becomes when the send is flagged as a service notice. */
  serviceCount: number | null;
};

// The variables legend, shared between the new-template form (page) and the
// per-template edit form (here) so the two can never document different
// dialects.
export function TemplateVariablesLegend() {
  return (
    <div className="rounded-[12px] bg-neutral-50 p-3.5 text-xs leading-relaxed text-neutral-500">
      <p className="font-medium text-neutral-600">Variables</p>
      <ul className="mt-1 space-y-0.5">
        {TEMPLATE_VARIABLES.map((v) => (
          <li key={v.token}>
            <code className="rounded bg-white px-1 py-0.5 font-mono text-[11px] text-neutral-700">
              {v.token}
            </code>{" "}
            — {v.meaning}
          </li>
        ))}
      </ul>
      <p className="mt-2">
        Unknown variables render as nothing. Formatting: a blank line starts a new paragraph, a
        single line break becomes one. <code className="font-mono text-[11px]">&lt;b&gt;</code>,{" "}
        <code className="font-mono text-[11px]">&lt;i&gt;</code> and{" "}
        <code className="font-mono text-[11px]">&lt;a href=&quot;https://…&quot;&gt;</code> are
        allowed — every other tag is stripped. The Picacho header, footer and unsubscribe link are
        added automatically.
      </p>
    </div>
  );
}

type Panel = "edit" | "preview" | "send" | "delete" | null;

export function EmailTemplateCard({
  template,
  previewHtml,
  audiences,
  emailConfigured,
}: {
  template: EmailTemplateRow;
  /** Server-rendered by the page with the admin's own variables — the same renderTemplate a real send calls. */
  previewHtml: string;
  audiences: AudienceOption[];
  emailConfigured: boolean;
}) {
  const [panel, setPanel] = useState<Panel>(null);
  const [audience, setAudience] = useState(audiences[0]?.value ?? "all");
  // Service-notice flag: reaches opted-out accounts, so every number and
  // hint in the panel switches with it — the count shown must always be the
  // count the send would hit, and the confirmation text the admin is asked
  // to type must be the one the server will actually accept
  // (service:<audience> — re-checked server-side in sendEmailBlast).
  const [serviceNotice, setServiceNotice] = useState(false);

  const selected = audiences.find((a) => a.value === audience);
  const selectedCount = selected ? (serviceNotice ? selected.serviceCount : selected.count) : null;
  const confirmText = serviceNotice ? `service:${audience}` : audience;
  const toggle = (next: Exclude<Panel, null>) => {
    setPanel((prev) => (prev === next ? null : next));
    // The card stays mounted across panel opens, so without this a checked
    // service-notice box would silently survive into the NEXT send session —
    // exactly the stale-decision carryover the flag must never have.
    setServiceNotice(false);
  };

  const panelButton = (target: Exclude<Panel, null>, label: string) => (
    <button
      type="button"
      onClick={() => toggle(target)}
      className={
        target === "delete"
          ? "rounded-[10px] px-2.5 py-1.5 text-xs font-medium text-red-600 transition-colors hover:bg-red-50"
          : "rounded-[10px] border border-neutral-200 bg-white px-3 py-1.5 text-xs font-medium text-neutral-700 transition-colors hover:border-neutral-300"
      }
    >
      {panel === target ? "Close" : label}
    </button>
  );

  return (
    <Card className="p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-sm font-semibold text-neutral-900">{template.key}</span>
          </div>
          <p className="mt-1 truncate text-sm text-neutral-700">{template.subject}</p>
          <p className="mt-0.5 text-xs text-neutral-500">
            updated <LocalDate date={template.updated_at} mode="datetime" />
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {panelButton("edit", "Edit")}
          {panelButton("preview", "Preview")}
          <form action={sendTestEmail}>
            <input type="hidden" name="key" value={template.key} />
            <SubmitButton variant="secondary" size="sm" pendingLabel="Sending…">
              Send test to me
            </SubmitButton>
          </form>
          {panelButton("send", "Send…")}
          {panelButton("delete", "Delete")}
        </div>
      </div>

      {panel === "edit" && (
        <form action={saveEmailTemplate} className="mt-4 border-t border-neutral-100 pt-4">
          {/* The key is the template's identity (upsert target, audit-log
              name) — changing it here would silently create a second
              template, so it rides along hidden instead of being editable. */}
          <input type="hidden" name="key" value={template.key} />
          <div className="grid gap-4">
            <div>
              <Label htmlFor={`subject-${template.id}`}>Subject</Label>
              <Input
                id={`subject-${template.id}`}
                name="subject"
                defaultValue={template.subject}
                maxLength={200}
                required
              />
            </div>
            <div>
              <Label htmlFor={`body-${template.id}`}>Body</Label>
              <Textarea
                id={`body-${template.id}`}
                name="body"
                defaultValue={template.body}
                rows={12}
                maxLength={20000}
                required
                className="font-mono text-[13px]"
              />
            </div>
            <TemplateVariablesLegend />
            <div>
              <SubmitButton size="sm" pendingLabel="Saving…">
                Save template
              </SubmitButton>
            </div>
          </div>
        </form>
      )}

      {panel === "preview" && (
        <div className="mt-4 border-t border-neutral-100 pt-4">
          <p className="mb-2 text-xs text-neutral-400">
            Rendered with your own account&apos;s variables — what a recipient on your plan
            receives, footer and unsubscribe link included. Refreshes on save.
          </p>
          {/* sandbox="" (fully sandboxed): the preview is our own sanitized
              output, but there is no reason to let it script or navigate
              inside the admin area either. */}
          <iframe
            title={`Preview of ${template.key}`}
            sandbox=""
            srcDoc={previewHtml}
            className="h-[460px] w-full rounded-[12px] border border-neutral-200 bg-white"
          />
        </div>
      )}

      {panel === "send" && (
        <div className="mt-4 rounded-[12px] border border-neutral-200 bg-neutral-50/60 p-4">
          {!emailConfigured && (
            <p className="mb-3 rounded-[10px] border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700">
              RESEND_API_KEY is not set — the send will fail until it is configured.
            </p>
          )}
          <form action={sendEmailBlast}>
            <input type="hidden" name="key" value={template.key} />
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <Label htmlFor={`audience-${template.id}`}>Audience</Label>
                <select
                  id={`audience-${template.id}`}
                  name="audience"
                  value={audience}
                  onChange={(e) => setAudience(e.target.value)}
                  className="w-full rounded-[10px] border border-neutral-200 bg-white px-3.5 py-2.5 text-sm text-neutral-900 outline-none transition-shadow focus:border-neutral-400 focus:ring-2 focus:ring-neutral-900/5"
                >
                  {audiences.map((a) => {
                    const count = serviceNotice ? a.serviceCount : a.count;
                    return (
                      <option key={a.value} value={a.value}>
                        {a.label} — {count === null ? "?" : count} recipient
                        {count === 1 ? "" : "s"}
                      </option>
                    );
                  })}
                </select>
                <p className="mt-1.5 text-xs text-neutral-400">
                  {serviceNotice
                    ? "Counts exclude only suspended accounts — a service notice also reaches people who unsubscribed."
                    : "Counts exclude unsubscribed and suspended accounts — the same filter the send itself applies."}
                </p>
              </div>
              <div>
                <Label htmlFor={`confirm-${template.id}`}>
                  Type <code className="font-mono text-[12px] text-neutral-900">{confirmText}</code>{" "}
                  to confirm
                </Label>
                {/* The typed value is re-checked server-side against the
                    posted audience (service:<audience> when the flag is
                    set) — this input is the ritual, the action holds the
                    lock. */}
                <Input
                  id={`confirm-${template.id}`}
                  name="confirm"
                  placeholder={confirmText}
                  autoComplete="off"
                  required
                />
              </div>
            </div>
            {/* Default unchecked, always: the marketing filter is the norm,
                and this flag must be a fresh decision per send — state is
                never carried between panel opens or templates. */}
            <label className="mt-4 flex items-start gap-2.5 text-xs leading-relaxed text-neutral-600">
              <input
                type="checkbox"
                name="service_notice"
                checked={serviceNotice}
                onChange={(e) => setServiceNotice(e.target.checked)}
                className="mt-0.5 h-4 w-4 flex-shrink-0 rounded border-neutral-300 accent-neutral-900"
              />
              <span>
                <span className="font-medium text-neutral-900">Service notice</span> — also reaches
                people who unsubscribed from marketing. Use only for account/service information
                (billing, security, terms). Never promotion.
              </span>
            </label>
            <div className="mt-4 flex flex-wrap items-center gap-3">
              <SubmitButton size="sm" pendingLabel="Sending…">
                Send to {selectedCount === null ? "?" : selectedCount} recipient
                {selectedCount === 1 ? "" : "s"}
              </SubmitButton>
              <p className="text-xs leading-relaxed text-neutral-400">
                Sends once, immediately. Capped at 5,000 recipients per blast; every send is
                recorded below.
              </p>
            </div>
          </form>
        </div>
      )}

      {panel === "delete" && (
        <div className="mt-4 rounded-[12px] border border-red-200 bg-red-50/60 p-4">
          <p className="text-sm font-semibold text-red-900">
            Delete {template.key} permanently?
          </p>
          <p className="mt-1.5 text-xs leading-relaxed text-red-800/90">
            The template can&apos;t be recovered, but the record of blasts already sent with it
            stays in the log below.
          </p>
          <div className="mt-3 flex items-center gap-2">
            <form action={deleteEmailTemplate}>
              <input type="hidden" name="id" value={template.id} />
              <SubmitButton
                variant="destructive"
                size="sm"
                className="bg-red-600 text-white hover:bg-red-700 hover:text-white"
                pendingLabel="Deleting…"
              >
                Yes, delete it
              </SubmitButton>
            </form>
            <button
              type="button"
              onClick={() => setPanel(null)}
              className="rounded-[10px] px-3 py-1.5 text-xs font-medium text-neutral-600 transition-colors hover:bg-white"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </Card>
  );
}
