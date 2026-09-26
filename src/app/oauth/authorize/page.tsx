import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { Card } from "@/components/ui/card";
import { Logo } from "@/components/logo";
import { createAdminClient, createClient } from "@/lib/supabase/server";
import { CONSENT_DECISION_PATH, verifiedHostOf } from "@/lib/mcp/oauth/config";
import { consentFormToken } from "@/lib/mcp/oauth/endpoints";
import { CONSENT_ERRORS, fill, type ConsentErrorCode } from "@/lib/mcp/oauth/messages";
import type { McpScope } from "@/lib/mcp/oauth/config";
import { getServerMessages } from "@/lib/i18n/server";
import type { Messages } from "@/lib/i18n/messages";
import { consentPath, pendingIdFrom } from "@/lib/mcp/oauth/resume";
import { consentSecret, mayConnectApps, oauthEnabled } from "@/lib/mcp/oauth/runtime";
import { bindPending, pendingOpen, readClient, readPending } from "@/lib/mcp/oauth/store";

// The consent page (Press Tour Cut 8; spec §4.2 "Authorize page"): a person
// connecting Claude, ChatGPT or another app to their Picacho account sees
// who is asking, where they go back to, and what the app will be able to
// do, in plain words, and answers once.
//
// ORDER: the switch (press_tour_mcp; to anyone else this page does not
// exist), the pending authorization (made by /api/oauth/authorize; only its
// id is on the URL), sign-in (the login returns HERE, lib/mcp/oauth/
// resume.ts), two-step, the account the request belongs to (the first
// signed-in account to open it holds it), whether the account may connect
// apps, and only then the question.
//
// Plain on purpose: the host's own sign-in window is small, and this page
// asks one question. Its words are i18n's connectApps, in the reader's
// language (lib/mcp/oauth/messages.ts keeps the English wire form and the
// error codes).

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getServerMessages();
  return { title: t.connectApps.metaTitle, robots: { index: false, follow: false } };
}

type Words = Messages["connectApps"];

/** An error code's sentence, in the reader's language. */
function errorWords(code: ConsentErrorCode, c: Words): string {
  switch (code) {
    case "expired":
      return c.errExpired;
    case "other_account":
      return c.errOtherAccount;
    case "not_open":
      return c.errNotOpen;
    case "unknown_client":
      return c.errUnknownClient;
    case "bad_redirect":
      return c.errBadRedirect;
    case "client_disabled":
      return c.errClientDisabled;
    case "unavailable":
      return c.errUnavailable;
    case "failed":
      return c.errFailed;
  }
}

/** What each permission means, in the reader's language. */
function scopeWords(scope: McpScope, c: Words): string {
  return scope === "read" ? c.scopeRead : scope === "brand" ? c.scopeBrand : c.scopeGenerate;
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main className="flex min-h-screen items-center justify-center bg-neutral-50 p-6">
      <div className="w-full max-w-md">
        <div className="mb-6 flex justify-center">
          <Logo className="h-8" />
        </div>
        <Card>{children}</Card>
      </div>
    </main>
  );
}

function DeadEnd({ code, c }: { code: ConsentErrorCode; c: Words }) {
  return (
    <Shell>
      <p role="alert" className="text-sm leading-relaxed text-neutral-700">
        {errorWords(code, c)}
      </p>
    </Shell>
  );
}

function isErrorCode(raw: unknown): raw is ConsentErrorCode {
  return typeof raw === "string" && Object.prototype.hasOwnProperty.call(CONSENT_ERRORS, raw);
}

export default async function ConsentPage({ searchParams }: { searchParams: Promise<{ pending?: string; error?: string }> }) {
  const admin = createAdminClient();
  if (!(await oauthEnabled(admin))) notFound();
  const { t } = await getServerMessages();
  const c = t.connectApps;
  const params = await searchParams;
  // ?error is a CODE mapped to our own wording, never text (the login page's rule).
  if (params.error !== undefined) return <DeadEnd code={isErrorCode(params.error) ? params.error : "failed"} c={c} />;

  const id = pendingIdFrom(params.pending);
  if (!id) return <DeadEnd code="expired" c={c} />;
  const pending = await readPending(admin, id);
  if (pending === "unavailable") return <DeadEnd code="unavailable" c={c} />;
  if (!pending || !pendingOpen(pending, new Date())) return <DeadEnd code="expired" c={c} />;

  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  const user = data.user;
  const here = consentPath(id);
  if (!user) redirect(`/login?next=${encodeURIComponent(here)}`);
  const { data: aal } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
  if (aal && aal.nextLevel === "aal2" && aal.currentLevel !== "aal2") redirect(`/verify-2fa?next=${encodeURIComponent(here)}`);

  const bound = await bindPending(admin, id, user.id);
  if (bound === "unavailable") return <DeadEnd code="unavailable" c={c} />;
  if (bound === "gone") return <DeadEnd code="expired" c={c} />;
  if (bound === "other_user") return <DeadEnd code="other_account" c={c} />;
  if (!(await mayConnectApps(supabase, user))) return <DeadEnd code="not_open" c={c} />;

  const client = await readClient(admin, pending.clientId);
  if (client === "unavailable") return <DeadEnd code="unavailable" c={c} />;
  if (!client) return <DeadEnd code="unknown_client" c={c} />;
  if (client.disabled) return <DeadEnd code="client_disabled" c={c} />;

  const verifiedHost = client.trust === "verified" ? verifiedHostOf(pending.redirectUri) : null;
  let returnsTo = "";
  try {
    const u = new URL(pending.redirectUri);
    returnsTo = u.protocol === "https:" ? u.hostname : "";
  } catch {
    returnsTo = "";
  }
  const token = consentFormToken(id, user.id, consentSecret());

  return (
    <Shell>
      <h1 className="font-display text-xl font-bold tracking-[-0.02em] text-neutral-900">{fill(c.title, { app: client.name })}</h1>
      <p className="mt-2 text-sm text-neutral-600">{fill(c.lead, { app: client.name })}</p>
      <p className="mt-2 text-xs font-medium text-neutral-500">
        {verifiedHost ? (
          <span className="inline-flex items-center gap-1 text-emerald-700">
            <svg aria-hidden="true" viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M3 8.5l3 3 7-7" />
            </svg>
            {fill(c.verified, { host: verifiedHost })}
          </span>
        ) : client.trust === "loopback" ? (
          c.thisComputer
        ) : (
          c.unverified
        )}
      </p>
      {returnsTo && <p className="mt-1 text-xs text-neutral-500">{fill(c.returnsTo, { host: returnsTo })}</p>}

      <p className="mt-5 text-sm font-medium text-neutral-900">{c.itCan}</p>
      <ul className="mt-2 space-y-1.5 text-sm text-neutral-700">
        {pending.scopes.map((s) => (
          <li key={s} className="flex gap-2">
            <span aria-hidden="true" className="mt-2 h-1.5 w-1.5 flex-none rounded-full bg-neutral-400" />
            <span>{scopeWords(s, c)}</span>
          </li>
        ))}
      </ul>
      {pending.scopes.includes("generate") && <p className="mt-3 text-xs leading-relaxed text-neutral-500">{c.moneyLine}</p>}

      <p className="mt-5 text-xs text-neutral-500">{fill(c.signedInAs, { email: user.email ?? "" })}</p>

      <form method="post" action={CONSENT_DECISION_PATH} className="mt-4 flex gap-3">
        <input type="hidden" name="pending" value={id} />
        <input type="hidden" name="form_token" value={token} />
        <button
          type="submit"
          name="decision"
          value="deny"
          className="h-11 flex-1 rounded-control border border-neutral-300 bg-white text-sm font-medium text-neutral-800 hover:bg-neutral-50"
        >
          {c.deny}
        </button>
        <button
          type="submit"
          name="decision"
          value="allow"
          className="h-11 flex-1 rounded-control bg-neutral-900 text-sm font-semibold text-white hover:bg-neutral-800"
        >
          {c.allow}
        </button>
      </form>
      <p className="mt-4 text-xs leading-relaxed text-neutral-500">{fill(c.footer, { path: `${t.settings.title} › ${t.settingsHub.tabSecurity} › ${c.cardTitle}` })}</p>
    </Shell>
  );
}
